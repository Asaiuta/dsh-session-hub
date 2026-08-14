import { type ImportedSession } from './import-common.ts';
/**
 * Scan the opencode database for browsable sessions. Returns [] when the
 * database is absent or the built-in sqlite module is unavailable.
 */
export declare function scanOpencode(dbPath: string): Promise<ImportedSession[]>;
