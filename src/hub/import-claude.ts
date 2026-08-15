/**
 * Claude Code session parser: ~/.claude/projects/<encoded-path>/*.jsonl
 *
 * Rows of interest:
 *  - { type: 'user', cwd, message: { content }, timestamp, uuid, isMeta?, … }
 *  - { type: 'assistant', message: { content: string | blocks[] }, timestamp }
 *  - { type: 'summary', cwd, ts, … } (metadata only)
 * Meta/system rows are skipped; tool_use blocks become structured tool
 * calls (rendered as real DSH tool cards), tool_result blocks fill their
 * results back by tool_use_id.
 */
import { readFile } from 'node:fs/promises'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedToolCall, type ImportedTurn, type ImportTool,
} from './import-common.ts'

const SKIP_MARKERS = ['<local-command-caveat>', 'Caveat: The messages below were generated', '<system-reminder>']

/** Tool calls a single assistant turn may carry; the rest are dropped. */
const MAX_TOOLS_PER_TURN = 12
/** Cap for one serialized tool payload (arguments / result text). */
const TOOL_CAP = 4000

/** Extract plain text + structured tool calls from claude content blocks. */
function claudeContent(message: unknown, max: number): { text: string; tools: ImportedToolCall[] } {
  const content = (message as { content?: unknown } | null)?.content
  if (typeof content === 'string') return { text: content, tools: [] }
  const text: string[] = []
  const tools: ImportedToolCall[] = []
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as { type?: string; text?: string; name?: string; input?: unknown; id?: string }
      if (b.type === 'text' && typeof b.text === 'string') {
        text.push(b.text)
      } else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        if (tools.length < MAX_TOOLS_PER_TURN) {
          const input = typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}, null, 2)
          tools.push({ id: b.id, name: b.name, arguments: capText(input, max) })
        }
      }
    }
  }
  return { text: text.join('\n'), tools }
}

/** Parse one claude project jsonl; null for files with no usable turns. */
export async function parseClaudeProject(file: string): Promise<ImportedSession | null> {
  const text = await readFile(file, 'utf8')
  let cwd = ''
  let createdAt = 0
  let firstUser = ''
  const turns: ImportedTurn[] = []
  // Tool results may arrive many user rows after their call; keep the whole
  // parse in one id map so results reach the right turn.
  const toolById = new Map<string, ImportedToolCall>()
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
      if (row.isMeta) continue
      const msg = row.message as { content?: unknown } | null
      // A user row may carry tool_result blocks instead of (or beside) text:
      // fill their results back into the matching tool_use call by id.
      const content = Array.isArray(msg?.content) ? msg.content : []
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const tool = toolById.get(b.tool_use_id)
          if (tool !== undefined && tool.result === undefined) {
            const body = typeof b.content === 'string'
              ? b.content
              : JSON.stringify(b.content ?? '').slice(0, TOOL_CAP)
            tool.result = capText(body, TOOL_CAP)
            if (b.is_error === true) tool.error = true
          }
        }
      }
      const body = typeof msg?.content === 'string' ? msg.content : ''
      if (body === '' || SKIP_MARKERS.some(m => body.includes(m))) continue
      if (!firstUser) firstUser = body
      if (!cwd && typeof row.cwd === 'string') cwd = row.cwd
      turns.push({ role: 'user', text: capText(body), time })
    } else {
      const { text: body, tools } = claudeContent(row.message, TOOL_CAP)
      if (body.trim() === '' && tools.length === 0) continue
      const turn: ImportedTurn = { role: 'assistant', text: capText(body), time }
      if (tools.length > 0) {
        turn.tools = tools
        for (const tool of tools) toolById.set(tool.id, tool)
      }
      turns.push(turn)
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