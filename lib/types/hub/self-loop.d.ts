/**
 * Self-loop detection: verify a candidate server URL is not this same hub
 * process. The hub's /hub/events SSE route accepts exactly one credential —
 * the per-process random eventToken. Probing the candidate's /hub/events with
 * the LOCAL token therefore succeeds only when the candidate IS this process;
 * anything else answers 403 (another hub) or 404 (a plain dsh web), both
 * treated as "not self". The probe opens the SSE stream and closes it
 * immediately.
 */
export declare function detectSelfLoop(baseUrl: string, eventToken: string, timeoutMs?: number): Promise<boolean>;
