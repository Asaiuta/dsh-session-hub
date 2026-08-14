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
  /**
   * The turn was recorded by the source tool as interrupted by the user.
   * Carried separately because DSH expresses this as a `turn/end` reason,
   * not as conversation text.
   */
  aborted?: boolean
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
 * Control records the source tools write into the conversation stream as if
 * they were user messages: Codex's interrupt notice, and Claude's slash
 * command envelopes plus the local echo of their output.
 *
 * They are the tool talking to its own model, not anything the user said. Left
 * in place they would enter the DSH model's context verbatim and imply an
 * interruption or a command that never happened here.
 */
const ABORT_MARKER = /<turn_aborted>[\s\S]*?<\/turn_aborted>/g
const COMMAND_ENVELOPE = /<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g
const LOCAL_COMMAND_OUTPUT = /<local-command-(?:stdout|stderr)>[\s\S]*?<\/local-command-(?:stdout|stderr)>/g

/** One turn's conversation text separated from the control records around it. */
export interface CleanedTurn {
  /** The text a model should actually read; empty when the turn was pure control. */
  text: string
  /** The source tool recorded this turn as user-interrupted. */
  aborted: boolean
}

/**
 * Strip source-tool control records from one turn's text.
 *
 * The interrupt notice is not dropped silently: it is reported so the caller
 * can record it the way DSH does, as a `turn/end` reason rather than as
 * conversation.
 *
 * @param text - the raw turn text as the source tool stored it.
 * @returns the conversational remainder and whether an interrupt was recorded.
 */
export function cleanTurnText(text: string): CleanedTurn {
  const aborted = ABORT_MARKER.test(text)
  ABORT_MARKER.lastIndex = 0
  const stripped = text
    .replace(ABORT_MARKER, ' ')
    .replace(COMMAND_ENVELOPE, ' ')
    .replace(LOCAL_COMMAND_OUTPUT, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return { text: stripped, aborted }
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
