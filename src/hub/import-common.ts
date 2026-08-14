/**
 * Shared model for imported external-tool sessions (Codex CLI, Claude Code,
 * opencode). Each parser reads the tool's own on-disk history and produces
 * this canonical shape; ImportStore caches, dedupes and serves them to the
 * hub gateway, which surfaces them as read-only rows in the official tree.
 */
import { createHash } from 'node:crypto'

export type ImportTool = 'codex' | 'claude' | 'opencode'

export interface ImportedTurn {
  role: 'user' | 'assistant'
  text: string
  time: number
}

export interface ImportedSession {
  /** Source tool. */
  tool: ImportTool
  /** Stable id inside the source (rollout id / claude uuid / opencode id). */
  key: string
  /** Synthesized hub session id (session-imp-… prefix, official-compatible). */
  sessionId: string
  /** Project working directory the session ran in. */
  cwd: string
  title: string
  createdAt: number
  updatedAt: number
  turns: ImportedTurn[]
  /** Source file path (JSONL importers only; used for staleness checks). */
  sourceFile?: string
}

/** Max turns/text kept per session — history browsers, not archives. */
export const MAX_TURNS = 120
export const MAX_TURN_CHARS = 40_000

/** Build the deterministic hub session id for an imported session. */
export function importSessionId(tool: ImportTool, key: string): string {
  const digest = createHash('sha256').update(`${tool}:${key}`).digest('hex').slice(0, 24)
  return `session-imp-${digest}`
}

/** Normalize a path for workspace matching (case + separator folding). */
export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Truncate a turn's text to the per-turn cap. */
export function capText(text: string): string {
  return text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)}\n…(truncated)` : text
}

/**
 * Best-effort title from the first meaningful user line.
 *
 * Claude Code records slash commands as XML-ish envelopes
 * (`<command-name>/model</command-name>`); those tags are transport noise,
 * not a title, so they are unwrapped to their inner text first.
 */
export function deriveTitle(cwd: string, firstUserText: string): string {
  const unwrapped = firstUserText
    .replace(/<command-name>([^<]*)<\/command-name>/g, '$1')
    .replace(/<[^>]{1,40}>/g, ' ')
  const line = unwrapped.split('\n').map(l => l.trim()).find(l => l.length > 0)
  const cleaned = (line ?? '').replace(/^[#>*\-\s]+/, '').trim().slice(0, 80)
  if (cleaned.length >= 3) return cleaned
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}
