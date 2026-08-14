import { type ImportedSession } from './import-common.ts';
/** Parse one codex rollout file; null for files with no usable turns. */
export declare function parseCodexRollout(file: string): Promise<ImportedSession | null>;
export declare const MAX_TURNS_IMPORT = 120;
