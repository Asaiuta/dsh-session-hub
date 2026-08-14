/**
 * Pi Coding Agent session parser:
 * `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl`
 *
 * Rows of interest:
 *  - `{ type: 'session', version, id, timestamp, cwd }` — one per file, first
 *    line, and the only place the project directory is recorded.
 *  - `{ type: 'message', id, timestamp, message: { role, content: [...] } }`
 *
 * Other row types (`model_change`, `thinking_level_change`, `custom`) are
 * bookkeeping and carry no conversation text.
 *
 * Content blocks follow the Anthropic shape: `{ type: 'text', text }` plus
 * `toolUse`/`toolResult` variants, which fold into one summary line each so
 * a tool-heavy session still reads as a conversation.
 */
import { readFile } from 'node:fs/promises'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedTurn, type ImportTool,
} from './import-common.ts'

/** Content block as written by Pi (superset of the plain text case). */
interface PiBlock {
  type?: string
  text?: string
  name?: string
  input?: unknown
  content?: unknown
}

/**
 * Flatten one message's content blocks into plain text.
 * @param content - the `message.content` value, string or block array.
 * @param max - cap for a single serialized tool payload.
 * @returns the flattened text, empty when nothing usable was present.
 */
function piText(content: unknown, max: number): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = block as PiBlock
    if (typeof b.text === 'string' && (b.type === 'text' || b.type === undefined)) {
      parts.push(b.text)
      continue
    }
    if (b.type === 'toolUse' || b.type === 'tool_use') {
      const input = typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}).slice(0, max)
      parts.push(`[tool ${b.name ?? 'tool'}] ${input}`)
      continue
    }
    if (b.type === 'toolResult' || b.type === 'tool_result') {
      const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '').slice(0, max)
      parts.push(`[result] ${body}`)
    }
  }
  return parts.join('\n')
}

/**
 * Parse one Pi session file.
 * @param file - absolute path to the session jsonl.
 * @returns the canonical imported session, or null when it holds no turns.
 */
export async function parsePiSession(file: string): Promise<ImportedSession | null> {
  const text = await readFile(file, 'utf8')
  let cwd = ''
  let key = ''
  let createdAt = 0
  let firstUser = ''
  const turns: ImportedTurn[] = []

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row: {
      type?: string
      id?: string
      timestamp?: string
      cwd?: string
      message?: { role?: string, content?: unknown, timestamp?: unknown }
    }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }

    if (row.type === 'session') {
      if (typeof row.cwd === 'string') cwd = row.cwd
      if (typeof row.id === 'string') key = row.id
      const started = Date.parse(row.timestamp ?? '')
      if (Number.isFinite(started)) createdAt = started
      continue
    }
    if (row.type !== 'message') continue

    const role = row.message?.role
    if (role !== 'user' && role !== 'assistant') continue

    // The row-level ISO timestamp is authoritative; the message-level numeric
    // one is only a fallback. Never let a bad parse reach updatedAt: a
    // non-numeric value there strips the field from the emitted summary and
    // breaks the whole official session list.
    const parsed = Date.parse(row.timestamp ?? '')
    const inner = row.message?.timestamp
    const time = Number.isFinite(parsed)
      ? parsed
      : typeof inner === 'number' && Number.isFinite(inner) ? inner : Date.now()

    const body = piText(row.message?.content, 4000)
    if (body.trim() === '') continue
    if (role === 'user' && firstUser === '') firstUser = body
    turns.push({ role, text: capText(body), time })
  }

  if (key === '') {
    // No session header (truncated file): fall back to the uuid in the name.
    const base = file.split(/[\\/]/).pop() ?? ''
    key = base.replace(/\.jsonl$/, '').split('_').pop() ?? ''
  }
  if (key === '' || turns.length === 0) return null
  if (createdAt === 0) createdAt = turns[0].time
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? key.slice(0, 8)

  return {
    tool: 'pi' as ImportTool,
    key,
    sessionId: importSessionId('pi', key),
    sourceFile: file,
    cwd,
    title: deriveTitle(cwd || name, firstUser || name),
    createdAt,
    updatedAt: turns[turns.length - 1].time,
    turns: turns.slice(-120),
  }
}
