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
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy'
import { parseCodexRollout } from './import-codex.ts'
import { parseClaudeProject } from './import-claude.ts'
import { scanOpencode } from './import-opencode.ts'
import { normalizePath, type ImportedSession } from './import-common.ts'

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

interface CacheFile {
  files: Record<string, number>
  sessions: ImportedSession[]
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

  /** Load persisted cache + scan every enabled source (incremental). */
  async load(enabled: ImportSource[]): Promise<void> {
    let restored = 0
    try {
      const raw = await readFile(this.cachePath, 'utf8')
      const parsed = JSON.parse(raw) as CacheFile
      if (Array.isArray(parsed.sessions)) {
        this.cache.sessions = parsed.sessions
        restored = parsed.sessions.length
      }
      if (parsed.files && typeof parsed.files === 'object') this.cache.files = parsed.files
    } catch (error) {
      console.warn(`[dsh-session-hub] import cache read failed (${this.cachePath}):`, error)
    }
    await this.rescan(enabled)
    console.info(`[dsh-session-hub] import cache restored ${restored}, total ${this.sessions.size}`)
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
    const home = homedir()
    const codexRoot = join(home, '.codex', 'sessions')
    const claudeRoot = join(home, '.claude', 'projects')
    const opencodeDb = join(home, '.local', 'share', 'opencode', 'opencode.db')
    const jsonlRoots = new Set<string>()
    if (enabled.includes('codex')) {
      for (const file of await walkFiles(codexRoot, '.jsonl')) jsonlRoots.add(file)
      await scanJsonl(codexRoot, '.jsonl', parseCodexRollout, this.cache)
    }
    if (enabled.includes('claude')) {
      for (const file of await walkFiles(claudeRoot, '.jsonl')) jsonlRoots.add(file)
      await scanJsonl(claudeRoot, '.jsonl', parseClaudeProject, this.cache)
    }
    if (enabled.includes('opencode')) {
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
    // Drop sessions whose JSONL source file disappeared (opencode sessions
    // are db-backed and keep no sourceFile).
    this.cache.sessions = this.cache.sessions.filter(s => s.sourceFile === undefined || jsonlRoots.has(s.sourceFile))
    this.rebuildIndex()
    this.persist()
  }

  private rebuildIndex(): void {
    this.sessions.clear()
    for (const s of this.cache.sessions) this.sessions.set(s.sessionId, s)
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
   * Imported sessions visible to the official UI, newest first.
   *
   * Sessions whose project directory no longer exists are omitted: the work
   * they describe is gone, the directory cannot be adopted as a workspace,
   * and surfacing them only leaves dead groups in the tree.
   */
  visible(): ImportedSession[] {
    return [...this.sessions.values()]
      .filter(s => this.projectExists(s.cwd))
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