/**
 * Claude Code session parser: ~/.claude/projects/<encoded-path>/*.jsonl
 *
 * Rows of interest:
 *  - { type: 'user', cwd, message: { content }, timestamp, uuid, isMeta?, … }
 *  - { type: 'assistant', message: { content: string | blocks[] }, timestamp }
 *  - { type: 'summary', cwd, ts, … } (metadata only)
 * Meta/system rows are skipped; tool_use blocks are folded into one line.
 */
import { readFile } from 'node:fs/promises'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedTurn, type ImportTool,
} from './import-common.ts'

const SKIP_MARKERS = ['<local-command-caveat>', 'Caveat: The messages below were generated', '<system-reminder>']

/** Extract plain text from claude content (string or block list). */
function claudeText(message: unknown, max: number): string {
  const content = (message as { content?: unknown } | null)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const b = block as { type?: string; text?: string; name?: string; input?: unknown; tool_use_id?: string }
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else if (b.type === 'tool_use') {
        const input = typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}).slice(0, max)
        parts.push(`[tool_use ${b.name ?? 'tool'}] ${input}`)
      }
    }
    return parts.join('\n')
  }
  return ''
}

/** Parse one claude project jsonl; null for files with no usable turns. */
export async function parseClaudeProject(file: string): Promise<ImportedSession | null> {
  const text = await readFile(file, 'utf8')
  let cwd = ''
  let createdAt = 0
  let firstUser = ''
  const turns: ImportedTurn[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row: {
      type?: string; cwd?: string; timestamp?: string; ts?: unknown; uuid?: string
      isMeta?: boolean; message?: unknown
    }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type === 'summary' && !row.message) {
      if (!cwd && typeof row.cwd === 'string') cwd = row.cwd
      if (!createdAt && typeof row.ts === 'number') createdAt = row.ts
      continue
    }
    if (row.type !== 'user' && row.type !== 'assistant') continue
    if (row.uuid === undefined) continue
    // Precedence matters: the ISO `timestamp` is the primary source and the
    // numeric `ts` only a fallback. Mixing `||` with `?:` here previously
    // resolved to `row.ts` (absent on Claude rows) and produced NaN/undefined
    // timestamps, which stripped `updatedAt` from the emitted summary and
    // broke the official session list.
    const parsed = Date.parse(row.timestamp ?? '')
    const time = Number.isFinite(parsed)
      ? parsed
      : typeof row.ts === 'number' ? row.ts : Date.now()
    if (row.type === 'user') {
      const msg = row.message as { content?: string } | undefined
      if (row.isMeta) continue
      const body = typeof msg?.content === 'string' ? msg.content : ''
      if (body === '' || SKIP_MARKERS.some(m => body.includes(m))) continue
      if (!firstUser) firstUser = body
      if (!cwd && typeof row.cwd === 'string') cwd = row.cwd
      turns.push({ role: 'user', text: capText(body), time })
    } else {
      const body = claudeText(row.message, 4000)
      if (body.trim() === '') continue
      turns.push({ role: 'assistant', text: capText(body), time })
    }
  }
  const key = file.split(/[\\/]/).pop()?.replace(/\.jsonl$/, '') ?? ''
  if (key === '' || turns.length === 0) return null
  if (!createdAt) createdAt = turns[0].time
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? key.slice(0, 8)
  return {
    tool: 'claude' as ImportTool,
    key,
    sessionId: importSessionId('claude', key),
    sourceFile: file,
    cwd,
    title: deriveTitle(cwd || name, firstUser || name),
    createdAt,
    updatedAt: turns[turns.length - 1].time,
    turns: turns.slice(-120),
  }
}