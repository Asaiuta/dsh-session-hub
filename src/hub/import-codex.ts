/**
 * Codex CLI session parser: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl
 *
 * Row shape (one JSON object per line):
 *  - session_meta  { id, cwd, timestamp, … }
 *  - response_item { type: 'message', role: user|assistant|developer,
 *                    content: [{ type: 'input_text'|'output_text', text }] }
 *  - response_item { type: 'function_call', call_id, name, arguments }
 *  - response_item { type: 'function_call_output', call_id, output }
 */
import { readFile } from 'node:fs/promises'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedToolCall, type ImportedTurn, type ImportTool,
} from './import-common.ts'

const META_TEXT_MARKERS = [
  '<permissions instructions>',
  '<environment_context>',
  '<collaboration_mode>',
  '<automated_reasoning_summary>',
  'AGENTS.md instructions for',
  '<system-reminder>',
  'Files mentioned by the user:',
]

/** Tool calls a single assistant turn may carry; the rest are dropped. */
const MAX_TOOLS_PER_TURN = 12
/** Cap for one serialized tool payload (arguments / result text). */
const TOOL_CAP = 4000

/** Attach one parsed codex row's tools to the turn that produced them. */
function attachTool(
  last: ImportedTurn | undefined,
  byId: Map<string, ImportedToolCall>,
  tool: ImportedToolCall,
): void {
  if (last === undefined || last.role !== 'assistant') return
  if (last.tools === undefined) last.tools = []
  if (last.tools.length >= MAX_TOOLS_PER_TURN) return
  last.tools.push(tool)
  byId.set(tool.id, tool)
}

/** Complete a call once its output row lands (any turn position). */
function completeTool(byId: Map<string, ImportedToolCall>, id: string, output: string, error?: boolean): void {
  const tool = byId.get(id)
  if (tool === undefined || tool.result !== undefined) return
  tool.result = capText(output, TOOL_CAP)
  if (error === true) tool.error = true
}

/** Parse one codex rollout file; null for files with no usable turns. */
export async function parseCodexRollout(file: string): Promise<ImportedSession | null> {
  const rows = await readFile(file, 'utf8')
  let meta: { id?: string; cwd?: string; timestamp?: string } | undefined
  const turns: ImportedTurn[] = []
  // The assistant turn the most recent call rows belong to.
  let lastAssistant: ImportedTurn | undefined
  const byId = new Map<string, ImportedToolCall>()
  for (const line of rows.split('\n')) {
    if (line.trim() === '') continue
    let row: { type?: string; timestamp?: string; payload?: Record<string, unknown> }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type === 'session_meta') {
      meta = row.payload as { id?: string; cwd?: string; timestamp?: string }
      continue
    }
    if (row.type !== 'response_item') continue
    const payload = row.payload as {
      type?: string; role?: string; content?: Array<{ type?: string; text?: string }>
      call_id?: string; name?: string; arguments?: string; output?: string; is_error?: boolean
    }
    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      const text = (payload.content ?? [])
        .filter(c => c.type === 'input_text' || c.type === 'output_text')
        .map(c => c.text ?? '')
        .join('\n')
      if (text.trim() !== '' && !(payload.role === 'user' && META_TEXT_MARKERS.some(m => text.includes(m)))) {
        const turn: ImportedTurn = {
          role: payload.role === 'user' ? 'user' : 'assistant',
          text: capText(text),
          time: Date.parse(row.timestamp ?? '') || Date.now(),
        }
        turns.push(turn)
        if (turn.role === 'assistant') lastAssistant = turn
      }
      continue
    }
    if (payload.type === 'function_call' && typeof payload.call_id === 'string') {
      attachTool(lastAssistant, byId, {
        id: payload.call_id,
        name: payload.name ?? 'tool',
        arguments: capText(payload.arguments ?? '', TOOL_CAP),
      })
      continue
    }
    if (payload.type === 'function_call_output' && typeof payload.call_id === 'string') {
      completeTool(byId, payload.call_id, payload.output ?? '', payload.is_error)
      continue
    }
    if (payload.type === 'message' && payload.role === 'developer') continue
  }
  const id = meta?.id
  const cwdRaw = meta?.cwd ?? ''
  if (id === undefined || turns.length === 0) return null
  const cwd = cwdRaw
  const firstUser = turns.find(t => t.role === 'user')
  const name = file.split(/[\\/]/).pop() ?? id
  return {
    tool: 'codex' as ImportTool,
    key: id,
    sessionId: importSessionId('codex', id),
    sourceFile: file,
    cwd,
    title: deriveTitle(cwd ?? '', firstUser?.text ?? name),
    createdAt: Date.parse(meta?.timestamp ?? '') || Date.now(),
    updatedAt: turns[turns.length - 1]?.time ?? Date.now(),
    turns: turns.slice(-MAX_TURNS_IMPORT),
  }
}

export const MAX_TURNS_IMPORT = 120