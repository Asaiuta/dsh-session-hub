/**
 * Self-loop detection: verify a candidate server URL is not this same hub
 * process. The hub's /hub/events SSE route accepts exactly one credential —
 * the per-process random eventToken. Probing the candidate's /hub/events with
 * the LOCAL token therefore succeeds only when the candidate IS this process;
 * anything else answers 403 (another hub) or 404 (a plain dsh web), both
 * treated as "not self". The probe opens the SSE stream and closes it
 * immediately.
 */
export async function detectSelfLoop(
  baseUrl: string,
  eventToken: string,
  timeoutMs = 2000,
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${baseUrl}/hub/events?token=${encodeURIComponent(eventToken)}`, {
        signal: controller.signal,
        headers: { accept: 'text/event-stream' },
      })
      // A plain dsh web serves unknown paths as SPA HTML (200), so status
      // alone would misclassify every non-hub target as self. Only a real
      // event-stream answer with the matching token is this process.
      if (response.ok && (response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        // Drain a byte so the server has really streamed, then close.
        const reader = response.body?.getReader()
        await reader?.read()
        return true
      }
      return false
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
