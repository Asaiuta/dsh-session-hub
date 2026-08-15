/**
 * opencode session parser: ~/.local/share/opencode/opencode.db (SQLite).
 *
 * Reads the session + message + part tables (Node ≥22 built-in node:sqlite).
 *  - session: { id, project_id, directory, title, … }
 *  - message: { id, session_id, time_created, data }  (data.role)
 *  - part:    { id, message_id, session_id, time_created, data }
 *             (data: { type:'text', text } | { type:'tool', tool, … } …)
 */
import type { DatabaseSync } from 'node:sqlite'
import {
  capText, deriveTitle, importSessionId,
  type ImportedSession, type ImportedToolCall, type ImportedTurn,
} from './import-common.ts'

/** Tool calls a single assistant turn may carry; the rest are dropped. */
const MAX_TOOLS_PER_TURN = 12

interface OpRow {
  sessionId: string
  directory: string
  title: string | null
  role: string | null
  partData: string
  timeCreated: number
}

/**
 * Scan the opencode database for browsable sessions. Returns [] when the
 * database is absent or the built-in sqlite module is unavailable.
 */
export async function scanOpencode(dbPath: string): Promise<ImportedSession[]> {
  let db: DatabaseSync
  try {
    // Dynamic import keeps the bundle loadable on runtimes without sqlite.
    const { DatabaseSync: Sync } = await import('node:sqlite') as typeof import('node:sqlite')
    db = new Sync(dbPath, { readOnly: true })
  } catch {
    return []
  }
  try {
    const rows = db.prepare(`
      SELECT
        s.id AS sessionId, s.directory AS directory, s.title AS title,
        m.data AS messageData, p.data AS partData, m.time_created AS timeCreated
      FROM part p
      JOIN message m ON m.id = p.message_id
      JOIN session s ON s.id = p.session_id
      ORDER BY p.time_created ASC
    `).all() as Array<{ sessionId: string; directory: string; title: string | null; messageData: string; partData: string; timeCreated: number }>

    const perSession = new Map<string, ImportedSession>()
    const pending = new Map<string, { role: 'user' | 'assistant'; text: string; time: number; tools?: ImportedToolCall[] }[]>()
    for (const row of rows) {
      let meta = perSession.get(row.sessionId)
      if (meta === undefined) {
        meta = {
          tool: 'opencode',
          key: row.sessionId,
          sessionId: importSessionId('opencode', row.sessionId),
          cwd: row.directory ?? '',
          title: row.title ?? '',
          createdAt: row.timeCreated,
          updatedAt: row.timeCreated,
          turns: [],
        }
        perSession.set(row.sessionId, meta)
        pending.set(row.sessionId, [])
      }
      let role: string | null = null
      try {
        role = (JSON.parse(row.messageData) as { role?: string }).role ?? null
      } catch {
        role = null
      }
      const part = parsePart(row.partData, rows.indexOf(row))
      if (part.text === '' && part.tool === undefined) continue
      const turns = pending.get(row.sessionId)!
      const last = turns[turns.length - 1]
      if (role === 'assistant' && last !== undefined && last.role === 'assistant' && last.time === row.timeCreated) {
        // Different parts of one assistant message share the timestamp — merge.
        if (part.text !== '') last.text = capText(`${last.text}\n${part.text}`)
        if (part.tool !== undefined) {
          last.tools ??= []
          if (last.tools.length < MAX_TOOLS_PER_TURN) last.tools.push(part.tool)
        }
      } else if (role === 'assistant') {
        turns.push({
          role: 'assistant',
          text: part.text,
          time: row.timeCreated,
          ...part.tool === undefined ? {} : { tools: [part.tool] },
        })
      } else {
        turns.push({ role: 'user', text: part.text, time: row.timeCreated })
      }
      meta.updatedAt = Math.max(meta.updatedAt, row.timeCreated)
    }
    const out: ImportedSession[] = []
    for (const [id, meta] of perSession) {
      const turns = pending.get(id) ?? []
      if (turns.length === 0) continue
      meta.turns = turns.slice(-120)
      if (meta.title === '' || meta.title === null) {
        const firstUser = turns.find(t => t.role === 'user')
        meta.title = deriveTitle(meta.cwd, firstUser?.text ?? meta.cwd)
      }
      out.push(meta)
    }
    return out
  } finally {
    db.close()
  }
}

function parsePart(data: string, index: number): { text: string; tool?: ImportedToolCall } {
  try {
    const part = JSON.parse(data) as {
      type?: string; text?: string; tool?: string | { name?: string }; state?: unknown
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      return { text: capText(part.text) }
    }
    if (part.type === 'tool') {
      const name = typeof part.tool === 'string'
        ? part.tool
        : (part.tool as { name?: string } | undefined)?.name ?? 'tool'
      const state = part.state as { input?: unknown; output?: unknown; isError?: boolean } | undefined
      const input = state?.input === undefined ? '' : JSON.stringify(state.input, null, 2)
      const tool: ImportedToolCall = { id: `oc-${index}`, name, arguments: capText(input, 4000) }
      if (state?.output !== undefined) {
        const output = typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2)
        tool.result = capText(output, 4000)
        if (state.isError === true) tool.error = true
      }
      return { text: '', tool }
    }
    return { text: '' }
  } catch {
    return { text: '' }
  }
}