/**
 * Codex CLI session parser: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl
 *
 * Row shape (one JSON object per line):
 *  - session_meta  { id, cwd, timestamp, … }
 *  - response_item { type: 'message', role: user|assistant|developer,
 *                    content: [{ type: 'input_text'|'output_text', text }] }
 *  - response_item { type: 'function_call' | 'function_call_output' }
 */
import { readFile } from 'node:fs/promises'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedTurn, type ImportTool,
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

/** Parse one codex rollout file; null for files with no usable turns. */
export async function parseCodexRollout(file: string): Promise<ImportedSession | null> {
  const rows = await readFile(file, 'utf8')
  let meta: { id?: string; cwd?: string; timestamp?: string } | undefined
  const turns: ImportedTurn[] = []
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
    }
    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      const text = (payload.content ?? [])
        .filter(c => c.type === 'input_text' || c.type === 'output_text')
        .map(c => c.text ?? '')
        .join('\n')
      if (text.trim() === '') continue
      if (payload.role === 'user' && META_TEXT_MARKERS.some(m => text.includes(m))) continue
      turns.push({
        role: payload.role === 'user' ? 'user' : 'assistant',
        text: capText(text),
        time: Date.parse(row.timestamp ?? '') || Date.now(),
      })
    }
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