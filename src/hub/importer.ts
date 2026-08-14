/**
 * Import store: scans the local Codex CLI / Claude Code / opencode session
 * logs, parses them into canonical ImportedSessions, caches parsed results
 * (mtime-indexed, persisted) and serves the hub gateway:
 *
 *  - session.list     → appended as read-only rows
 *  - workspace.list   → matched by cwd into the corresponding local workspace
 *  - session.history  → generated HistoryEntries the official pane folds
 *  - everything else  → rejected as read-only
 *
 * Sessions are additive and never written back into any tool's logs.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy'
import { parseCodexRollout } from './import-codex.ts'
import { parseClaudeProject } from './import-claude.ts'
import { scanOpencode } from './import-opencode.ts'
import { cleanTurnText, normalizePath, type ImportedSession, type ImportedTurn } from './import-common.ts'

/**
 * Per-conversation scratch directories Codex creates under the user's home:
 * `Documents/Codex/<date>/<chat-slug>` for chats started outside a project,
 * and `.codex/worktrees/<hash>/<project>` for throwaway git worktrees. Left
 * alone, each conversation becomes its own "project" group and floods the
 * tree with dozens of single-session directories.
 */
const CODEX_CHAT_SCRATCH = /^(.*)\/documents\/codex\/\d{4}-\d{2}-\d{2}\/[^/]+$/
const CODEX_WORKTREE = /^.*\/\.codex\/worktrees\/[^/]+\/(.+)$/

/**
 * The path an imported session groups under.
 *
 * Codex scratch directories are folded so they do not explode into one group
 * per conversation: chat scratch dirs collapse to a single shared bucket, and
 * a worktree copy reports the project name it mirrors so it can be matched to
 * that project's workspace by name rather than by its hashed path.
 *
 * @param cwd - the session's recorded working directory.
 * @returns the grouping key, the path to display, and an optional project
 *   name to match against workspace basenames.
 */
export function groupingPath(cwd: string): { normalized: string; display: string; nameHint?: string } {
  const normalized = normalizePath(cwd)
  const chat = CODEX_CHAT_SCRATCH.exec(normalized)
  if (chat !== null) {
    const root = `${chat[1]}/documents/codex`
    return { normalized: root, display: root }
  }
  const worktree = CODEX_WORKTREE.exec(normalized)
  if (worktree !== null) {
    return { normalized, display: cwd, nameHint: worktree[1] }
  }
  return { normalized, display: cwd }
}

export type ImportSource = 'codex' | 'claude' | 'opencode'

export const IMPORT_SOURCES: readonly ImportSource[] = ['codex', 'claude', 'opencode']

/** What the settings tab shows and acts on, per source tool. */
export interface ImportSourceStatus {
  source: ImportSource
  /** The log location this source reads. */
  path: string
  /** Whether that location exists on this machine. */
  available: boolean
  /** Imported at least once (the user opted this source in). */
  imported: boolean
  /** Follow newly written logs for this source in the background. */
  auto: boolean
  /** Sessions currently held for this source. */
  count: number
  /** Epoch ms of the last completed scan, if any. */
  scannedAt?: number
}

/** Where each source tool keeps its logs on this machine. */
export function sourcePath(source: ImportSource): string {
  const home = homedir()
  if (source === 'codex') return join(home, '.codex', 'sessions')
  if (source === 'claude') return join(home, '.claude', 'projects')
  return join(home, '.local', 'share', 'opencode', 'opencode.db')
}

interface CacheFile {
  files: Record<string, number>
  sessions: ImportedSession[]
  /**
   * Project directories the user removed from the workspace list. Adoption
   * must not resurrect them on the next scan, so the refusal outlives the
   * process.
   */
  declined?: string[]
  /**
   * Imported session id → the real DSH session it was promoted to. Promoted
   * copies stay hidden so a conversation that now lives in a real session is
   * not also shown as an imported one.
   */
  promoted?: Record<string, string>
  /**
   * Per-source opt-in. Importing is a deliberate act, so a source appears in
   * the tree only once the user asked for it, and `auto` decides whether its
   * newly written logs are followed afterwards.
   */
  sources?: Record<string, { imported?: boolean; auto?: boolean; scannedAt?: number }>
}

interface HistoryEvent {
  seq: number
  event: unknown
}

/** Walk a directory recursively for files with a given suffix. */
async function walkFiles(root: string, suffix: string): Promise<string[]> {
  const out: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    const dir = queue.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true }) as unknown as import('node:fs').Dirent[]
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile() && entry.name.endsWith(suffix)) out.push(full)
    }
  }
  return out
}

/**
 * Turn a parsed session into a hub session row.
 *
 * The row must match the official SessionSummary wire shape exactly: the
 * client seeds every row's projection baseline with
 * `store.apply(key, value, block.asOfSeq)`, so a projections block without a
 * numeric `asOfSeq` poisons the per-session projection store (seq comparisons
 * against `undefined` are always false) and the whole session list stops
 * settling — the sidebar then renders workspace groups with no session rows.
 */
function toSummary(s: ImportedSession): SessionSummary {
  // Never emit a non-numeric updatedAt: the official summary requires it, and
  // a parser regression must not be able to break the whole session list.
  const updatedAt = Number.isFinite(s.updatedAt) ? s.updatedAt : 0
  return {
    sessionId: s.sessionId,
    updatedAt,
    running: false,
    blank: false,
    cwd: s.cwd,
    agentPreset: 'standard',
    projections: {
      // Imported logs carry no live watermark: -1 is the documented
      // empty-log convention, so any real frame supersedes these values.
      asOfSeq: -1,
      values: {
        title: s.title,
        sessionListMetadata: { blank: false, lastPromptAt: updatedAt },
      },
    },
  } as SessionSummary
}

/**
 * Strip source-tool control records from a parsed session's turns.
 *
 * A turn that was nothing but a control record carries no conversation and is
 * dropped; an interrupt notice is preserved as the turn's `aborted` flag so
 * the promoter can record it as DSH does, through a `turn/end` reason.
 *
 * @param session - the parsed session as the source produced it.
 * @returns the session with conversational turns only.
 */
function sanitize(session: ImportedSession): ImportedSession {
  let dirty = false
  const turns: ImportedTurn[] = []
  for (const turn of session.turns) {
    const cleaned = cleanTurnText(turn.text)
    if (cleaned.aborted) {
      // The notice reports that the turn *before* it was interrupted, so the
      // flag attaches backwards. A notice with nothing before it describes an
      // interruption this log never captured and is simply dropped.
      const previous = turns[turns.length - 1]
      if (previous !== undefined && previous.aborted !== true) {
        turns[turns.length - 1] = { ...previous, aborted: true }
      }
      dirty = true
    }
    if (cleaned.text === '') {
      dirty = true
      continue
    }
    if (cleaned.text !== turn.text) dirty = true
    turns.push({ ...turn, text: cleaned.text })
  }
  return dirty ? { ...session, turns } : session
}

/** Build foldable history events for an imported session. */
function buildHistory(s: ImportedSession): HistoryEvent[] {
  const events: HistoryEvent[] = []
  let seq = 0
  let turn = 0
  for (const t of s.turns) {
    const id = `imp-${s.key}-${seq}`
    if (t.role === 'user') {
      events.push({
        seq,
        event: {
          type: 'user/message', seq, time: t.time, surfaceOp: 'append',
          data: {
            content: [{ type: 'text', text: t.text }],
            source: { kind: 'user', rpcId: id, clientTimeZone: 'Etc/GMT-8' },
            role: 'user',
            id,
          },
        },
      })
      seq += 1
    } else {
      turn += 1
      const step = 1
      events.push({
        seq, event: {
          type: 'assistant/chunk', seq, time: t.time, surfaceOp: 'append',
          data: { turn, step, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        },
      })
      seq += 1
      const deltas = splitDeltas(t.text, 4000)
      for (const text of deltas) {
        events.push({
          seq, event: {
            type: 'assistant/chunk', seq, time: t.time, surfaceOp: 'append',
            data: { turn, step, chunk: { type: 'text-delta', index: 0, text } },
          },
        })
        seq += 1
      }
      events.push({
        seq, event: {
          type: 'assistant/chunk', seq, time: t.time, surfaceOp: 'append',
          data: { turn, step, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: t.text } } },
        },
      })
      seq += 1
      events.push({
        seq, event: {
          type: 'assistant/chunk', seq, time: t.time, surfaceOp: 'append',
          data: { turn, step, chunk: { type: 'finish', reason: { kind: 'stop' } } },
        },
      })
      seq += 1
    }
  }
  return events
}

function splitDeltas(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** Scan one JSONL source with mtime-based incremental parsing. */
async function scanJsonl(
  root: string,
  suffix: string,
  parser: (file: string) => Promise<ImportedSession | null>,
  cache: CacheFile,
): Promise<void> {
  if (root === '') return
  const files = await walkFiles(root, suffix)
  let parsedCount = 0
  for (const file of files) {
    let mtime: number
    try {
      mtime = (await stat(file)).mtimeMs
    } catch {
      continue
    }
    if (cache.files[file] === mtime) continue
    const parsed = await parser(file)
    cache.files[file] = mtime
    if (parsed === null) continue
    parsedCount += 1
    const index = cache.sessions.findIndex(s => s.sessionId === parsed.sessionId)
    if (index >= 0) cache.sessions[index] = parsed
    else cache.sessions.push(parsed)
  }
  if (parsedCount > 0) {
    console.info(`[dsh-session-hub] import scan ${root} → ${files.length} files, ${parsedCount} parsed`)
  }
}

/** mtime-indexed, persisted, incremental external-session store. */
export class ImportStore {
  readonly sessions = new Map<string, ImportedSession>()
  private readonly cache: CacheFile
  private readonly cachePath: string
  private scanning = false
  /** Memoized project-directory existence, keyed by normalized path. */
  private readonly dirCache = new Map<string, boolean>()

  constructor(dataFile: string) {
    this.cachePath = dataFile
    this.cache = { files: {}, sessions: [] }
  }

  /**
   * Restore the persisted cache. Scanning is deliberately not part of load:
   * importing is a user decision, so nothing is read from the source tools
   * until a source is imported (or its auto-follow is on, which the caller
   * drives through {@link autoSources}).
   *
   * A cache written before per-source opt-in existed holds sessions but no
   * source records; those sources are adopted as already-imported so an
   * upgrade does not empty the tree.
   */
  async load(): Promise<void> {
    let restored = 0
    try {
      const raw = await readFile(this.cachePath, 'utf8')
      const parsed = JSON.parse(raw) as CacheFile
      if (Array.isArray(parsed.sessions)) {
        this.cache.sessions = parsed.sessions
        restored = parsed.sessions.length
      }
      if (parsed.files && typeof parsed.files === 'object') this.cache.files = parsed.files
      // The declined list is a user decision, not scan output: it must
      // survive restarts or deleted workspaces reappear on the next boot.
      if (Array.isArray(parsed.declined)) this.cache.declined = parsed.declined
      if (parsed.promoted && typeof parsed.promoted === 'object') this.cache.promoted = parsed.promoted
      if (parsed.sources && typeof parsed.sources === 'object') this.cache.sources = parsed.sources
    } catch (error) {
      console.warn(`[dsh-session-hub] import cache read failed (${this.cachePath}):`, error)
    }
    this.adoptLegacyCache()
    this.rebuildIndex()
    console.info(`[dsh-session-hub] import cache restored ${restored}, total ${this.sessions.size}`)
  }

  /**
   * Treat sources already present in a pre-opt-in cache as imported.
   *
   * Without this an upgrade would silently hide sessions the user has been
   * seeing all along, since a cache from an older version records no consent.
   */
  private adoptLegacyCache(): void {
    if (this.cache.sources !== undefined) return
    this.cache.sources = {}
    for (const source of IMPORT_SOURCES) {
      if (this.cache.sessions.some(s => s.tool === source)) {
        this.cache.sources[source] = { imported: true, auto: true }
      }
    }
    void this.persist()
  }

  /** Per-source state as the settings tab presents it. */
  sourceStatus(): ImportSourceStatus[] {
    const counts = new Map<string, number>()
    for (const s of this.cache.sessions) counts.set(s.tool, (counts.get(s.tool) ?? 0) + 1)
    return IMPORT_SOURCES.map(source => {
      const record = this.cache.sources?.[source]
      const path = sourcePath(source)
      return {
        source,
        path,
        available: existsSync(path),
        imported: record?.imported === true,
        auto: record?.auto === true,
        count: counts.get(source) ?? 0,
        ...record?.scannedAt !== undefined ? { scannedAt: record.scannedAt } : {},
      }
    })
  }

  /** Sources whose newly written logs should be followed in the background. */
  autoSources(): ImportSource[] {
    return IMPORT_SOURCES.filter(s => {
      const record = this.cache.sources?.[s]
      return record?.imported === true && record.auto === true
    })
  }

  /**
   * Import one source on request: marks it imported and scans it.
   *
   * @param source - the tool to read.
   * @param auto - whether to follow its new logs afterwards.
   * @returns how many sessions that source now holds.
   */
  async importSource(source: ImportSource, auto: boolean): Promise<number> {
    this.cache.sources ??= {}
    this.cache.sources[source] = { imported: true, auto }
    await this.rescan([source])
    return this.cache.sessions.filter(s => s.tool === source).length
  }

  /**
   * Drop one source: its sessions leave the tree and its opt-in is revoked.
   *
   * File mtimes for the source are cleared too, so a later re-import re-reads
   * the logs from scratch rather than trusting stale marks.
   */
  async removeSource(source: ImportSource): Promise<void> {
    this.cache.sessions = this.cache.sessions.filter(s => s.tool !== source)
    const prefix = sourcePath(source)
    for (const file of Object.keys(this.cache.files)) {
      if (normalizePath(file).startsWith(normalizePath(prefix))) delete this.cache.files[file]
    }
    this.cache.sources ??= {}
    this.cache.sources[source] = { imported: false, auto: false }
    this.rebuildIndex()
    await this.persist()
  }

  /** Turn background following on or off for an already-imported source. */
  async setAuto(source: ImportSource, auto: boolean): Promise<void> {
    const record = this.cache.sources?.[source]
    if (record?.imported !== true) return
    record.auto = auto
    await this.persist()
  }

  /** Re-scan changed/new files (cheap when nothing changed). */
  async rescan(enabled: ImportSource[]): Promise<void> {
    // Scans walk hundreds of JSONL files: overlapping runs would duplicate
    // that work (and the watcher fires while a slow first scan is still in
    // flight), so a scan in progress simply absorbs the request.
    if (this.scanning) return
    this.scanning = true
    try {
      // A rescan is also the point where a deleted or restored project
      // directory should be reflected in the tree.
      this.dirCache.clear()
      await this.runScan(enabled)
    } finally {
      this.scanning = false
    }
  }

  private async runScan(enabled: ImportSource[]): Promise<void> {
    const jsonlRoots = new Set<string>()
    if (enabled.includes('codex')) {
      const codexRoot = sourcePath('codex')
      for (const file of await walkFiles(codexRoot, '.jsonl')) jsonlRoots.add(file)
      await scanJsonl(codexRoot, '.jsonl', parseCodexRollout, this.cache)
    }
    if (enabled.includes('claude')) {
      const claudeRoot = sourcePath('claude')
      for (const file of await walkFiles(claudeRoot, '.jsonl')) jsonlRoots.add(file)
      await scanJsonl(claudeRoot, '.jsonl', parseClaudeProject, this.cache)
    }
    if (enabled.includes('opencode')) {
      const opencodeDb = sourcePath('opencode')
      try {
        const mtime = (await stat(opencodeDb)).mtimeMs
        if (this.cache.files[opencodeDb] !== mtime) {
          const sessions = await scanOpencode(opencodeDb)
          if (sessions.length > 0) {
            for (const s of sessions) {
              const index = this.cache.sessions.findIndex(x => x.sessionId === s.sessionId)
              if (index >= 0) this.cache.sessions[index] = s
              else this.cache.sessions.push(s)
            }
          }
          // An empty result is treated as a failed/stale read (e.g. missing
          // built-in sqlite): keep retrying instead of pinning the mtime.
          if (sessions.length > 0 || this.cache.files[opencodeDb] === undefined) {
            this.cache.files[opencodeDb] = mtime
          }
        }
      } catch {
        // No opencode install — skip.
      }
    }
    // Drop sessions whose JSONL source file disappeared. Only sources just
    // scanned are judged: another source's files were never enumerated here,
    // so treating them as missing would delete sessions that are perfectly
    // fine (opencode sessions are db-backed and keep no sourceFile).
    this.cache.sessions = this.cache.sessions.filter(s =>
      s.sourceFile === undefined || !enabled.includes(s.tool as ImportSource) || jsonlRoots.has(s.sourceFile))
    const now = Date.now()
    this.cache.sources ??= {}
    for (const source of enabled) {
      const record = this.cache.sources[source] ?? { imported: true }
      record.scannedAt = now
      this.cache.sources[source] = record
    }
    this.rebuildIndex()
    this.persist()
  }

  /**
   * Rebuild the id index from the parsed cache, sanitizing turns on the way
   * in.
   *
   * Cleaning happens here rather than in each parser because every source
   * funnels through this point, and because it also repairs caches written by
   * earlier versions that stored the raw control records.
   */
  private rebuildIndex(): void {
    this.sessions.clear()
    let changed = false
    const sanitized: ImportedSession[] = []
    for (const s of this.cache.sessions) {
      const clean = sanitize(s)
      if (clean !== s) changed = true
      sanitized.push(clean)
      this.sessions.set(clean.sessionId, clean)
    }
    // Write the cleaned form back so the control records are stripped once
    // rather than on every load, and so the abort flags they were converted
    // into survive a restart.
    if (changed) {
      this.cache.sessions = sanitized
      void this.persist()
    }
  }

  /** Persist the parsed cache (deferred debounce handled by caller). */
  async persist(): Promise<void> {
    const raw = JSON.stringify(this.cache)
    try {
      const { dirname } = await import('node:path')
      const { mkdir, rm, rename, writeFile } = await import('node:fs/promises')
      await mkdir(dirname(this.cachePath), { recursive: true })
      const tmp = `${this.cachePath}.tmp`
      await writeFile(tmp, raw, { mode: 0o600 })
      await rm(this.cachePath, { force: true })
      await rename(tmp, this.cachePath)
    } catch {
      // Cache write is best-effort.
    }
  }

  sessionById(sessionId: string): ImportedSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Record that an imported session was promoted to a real DSH session.
   *
   * The imported copy is hidden from then on: the conversation now lives in a
   * session the harness owns, and showing both would duplicate it in the
   * tree. The mapping is persisted so the copy does not come back on restart.
   *
   * @param sessionId - the imported session id.
   * @param realId - the DSH session it became.
   */
  markPromoted(sessionId: string, realId: string): void {
    const promoted = this.cache.promoted ?? {}
    if (promoted[sessionId] === realId) return
    this.cache.promoted = { ...promoted, [sessionId]: realId }
    void this.persist()
  }

  /**
   * Whether a project directory was declined by the user.
   *
   * Deleting a workspace is a statement that the project should not be in the
   * tree; without remembering it, the next scan would adopt the directory
   * again and the group would reappear.
   *
   * @param path - the project directory.
   * @returns true when the path must stay out of the tree.
   */
  isDeclined(path: string): boolean {
    return (this.cache.declined ?? []).includes(normalizePath(path))
  }

  /**
   * Record that the user removed a project directory from the tree.
   * @param path - the project directory to stop surfacing.
   */
  decline(path: string): void {
    const key = normalizePath(path)
    if (key === '') return
    const declined = this.cache.declined ?? []
    if (declined.includes(key)) return
    this.cache.declined = [...declined, key]
    void this.persist()
  }

  /**
   * Imported sessions visible to the official UI, newest first.
   *
   * Sessions whose project directory no longer exists are omitted: the work
   * they describe is gone, the directory cannot be adopted as a workspace,
   * and surfacing them only leaves dead groups in the tree. Directories the
   * user removed from the workspace list are omitted for the same reason, as
   * are sessions already promoted to a real DSH session.
   */
  visible(): ImportedSession[] {
    const promoted = this.cache.promoted ?? {}
    return [...this.sessions.values()]
      .filter(s => promoted[s.sessionId] === undefined
        && this.projectExists(s.cwd)
        && !this.isDeclined(groupingPath(s.cwd).display))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Whether a session's project directory still exists, memoized per path.
   *
   * `visible()` runs on every session.list and workspace.list, so the check
   * is cached: hundreds of sessions collapse to a few dozen distinct paths,
   * and the cache is cleared on each rescan so a restored directory comes
   * back without a restart.
   *
   * @param cwd - the session's recorded working directory.
   * @returns true when the directory is still present.
   */
  private projectExists(cwd: string): boolean {
    const key = normalizePath(cwd)
    if (key === '') return false
    const cached = this.dirCache.get(key)
    if (cached !== undefined) return cached
    let exists = false
    try {
      exists = statSync(cwd).isDirectory()
    } catch {
      exists = false
    }
    this.dirCache.set(key, exists)
    return exists
  }

  /** Hub session rows for the merged session.list. */
  rows(): SessionSummary[] {
    return this.visible().map(toSummary)
  }

  /**
   * Assign every imported session to a workspace, given the official
   * workspace paths.
   *
   * A session belongs to the *longest* workspace path that contains its cwd,
   * so a session run in `D:/AI/proj/tools` lands in the `D:/AI/proj`
   * workspace rather than a broader `D:/AI` one. Sessions whose project has
   * no workspace at all are grouped by their own cwd, which the gateway then
   * surfaces as a synthetic project group — otherwise they would all collapse
   * into the ungrouped bucket.
   *
   * @param workspacePaths - official workspace paths (any separator style).
   * @returns ids per matched workspace path, plus leftovers keyed by cwd.
   */
  assign(workspacePaths: readonly string[]): {
    byWorkspace: Map<string, string[]>
    orphansByCwd: Map<string, { path: string; ids: string[] }>
  } {
    // Longest first: the first containing path wins, which is the most
    // specific one.
    const roots = [...new Set(workspacePaths.map(normalizePath))]
      .filter(p => p !== '' && !p.startsWith('dsh-hub://'))
      .sort((a, b) => b.length - a.length)
    const byBasename = new Map<string, string>()
    for (const root of roots) {
      const base = root.slice(root.lastIndexOf('/') + 1)
      if (base !== '' && !byBasename.has(base)) byBasename.set(base, root)
    }
    const byWorkspace = new Map<string, string[]>()
    const orphansByCwd = new Map<string, { path: string; ids: string[] }>()
    for (const session of this.visible()) {
      const cwd = groupingPath(session.cwd)
      const root = roots.find(r => cwd.normalized === r || cwd.normalized.startsWith(`${r}/`))
        ?? (cwd.nameHint === undefined ? undefined : byBasename.get(cwd.nameHint))
      if (root !== undefined) {
        const ids = byWorkspace.get(root)
        if (ids === undefined) byWorkspace.set(root, [session.sessionId])
        else ids.push(session.sessionId)
        continue
      }
      if (cwd.normalized === '') continue
      const group = orphansByCwd.get(cwd.normalized)
      if (group === undefined) orphansByCwd.set(cwd.normalized, { path: cwd.display, ids: [session.sessionId] })
      else group.ids.push(session.sessionId)
    }
    return { byWorkspace, orphansByCwd }
  }

  /**
   * Generated HistoryEntries (read-only view).
   *
   * Mirrors `visible()`: a session hidden because its project directory is
   * gone must not stay openable through a stale id either.
   */
  history(sessionId: string): HistoryEvent[] | undefined {
    const session = this.sessions.get(sessionId)
    if (session === undefined || !this.projectExists(session.cwd)) return undefined
    return buildHistory(session)
  }
}