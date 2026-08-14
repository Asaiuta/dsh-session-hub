import { type ImportedSession } from './import-common.ts';
/**
 * Parse one Pi session file.
 * @param file - absolute path to the session jsonl.
 * @returns the canonical imported session, or null when it holds no turns.
 */
export declare function parsePiSession(file: string): Promise<ImportedSession | null>;
