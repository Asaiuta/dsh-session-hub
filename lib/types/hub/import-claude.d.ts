import { type ImportedSession } from './import-common.ts';
/** Parse one claude project jsonl; null for files with no usable turns. */
export declare function parseClaudeProject(file: string): Promise<ImportedSession | null>;
