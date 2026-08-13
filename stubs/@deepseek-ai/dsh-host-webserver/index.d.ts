/**
 * Typecheck stub for @deepseek-ai/dsh-host-webserver — mirrors only the
 * surface the hub plugin uses: ctx.webServer.register(WebRoute).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type WebRouteKind = 'exact' | 'prefix'

export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServer {
  register(route: WebRoute): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

export type { IncomingMessage, ServerResponse }