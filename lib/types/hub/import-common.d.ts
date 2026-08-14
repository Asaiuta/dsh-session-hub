export type ImportTool = 'codex' | 'claude' | 'opencode';
export interface ImportedTurn {
    role: 'user' | 'assistant';
    text: string;
    time: number;
    /**
     * The turn was recorded by the source tool as interrupted by the user.
     * Carried separately because DSH expresses this as a `turn/end` reason,
     * not as conversation text.
     */
    aborted?: boolean;
}
export interface ImportedSession {
    /** Source tool. */
    tool: ImportTool;
    /** Stable id inside the source (rollout id / claude uuid / opencode id). */
    key: string;
    /** Synthesized hub session id (session-imp-… prefix, official-compatible). */
    sessionId: string;
    /** Project working directory the session ran in. */
    cwd: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    turns: ImportedTurn[];
    /** Source file path (JSONL importers only; used for staleness checks). */
    sourceFile?: string;
}
/** Max turns/text kept per session — history browsers, not archives. */
export declare const MAX_TURNS = 120;
export declare const MAX_TURN_CHARS = 40000;
/** Build the deterministic hub session id for an imported session. */
export declare function importSessionId(tool: ImportTool, key: string): string;
/** Normalize a path for workspace matching (case + separator folding). */
export declare function normalizePath(path: string): string;
/** Truncate a turn's text to the per-turn cap. */
export declare function capText(text: string): string;
/** One turn's conversation text separated from the control records around it. */
export interface CleanedTurn {
    /** The text a model should actually read; empty when the turn was pure control. */
    text: string;
    /** The source tool recorded this turn as user-interrupted. */
    aborted: boolean;
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
export declare function cleanTurnText(text: string): CleanedTurn;
/**
 * Best-effort title from the first meaningful user line.
 *
 * Claude Code records slash commands as XML-ish envelopes
 * (`<command-name>/model</command-name>`); those tags are transport noise,
 * not a title, so they are unwrapped to their inner text first.
 */
export declare function deriveTitle(cwd: string, firstUserText: string): string;
