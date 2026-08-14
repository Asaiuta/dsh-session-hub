/** dsh-session-hub panel copy (zh/en). Function-valued keys take formatting args. */
export declare const NS = "sessionHub";
/** Dictionary shape: plain strings, or formatters with optional args. */
export type HubDict = Record<string, string | ((...args: string[]) => string)>;
export declare const en: HubDict;
export declare const zh: HubDict;
export type HubKey = keyof typeof en;
