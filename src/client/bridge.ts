/**
 * Official-UI bridge: relays the hub SSE frame stream into the *official*
 * browser session runtime, so the unmodified conversation/workspace UI opens
 * and renders remote sessions as if they were local. The official runtime
 * consumes mux frames via `sessions.handleMuxEnvelope(envelope)` (the same
 * entry the official connection websocket feeds); the hub SSE stream carries
 * the exact same wire frames (ServerLink forwards each remote mux frame
 * verbatim), so the bridge rebuilds the envelope shape and injects it. The
 * official /api unary surface (history/prompt/cancel/…) is answered by the
 * hub host gateway routing to the owning server, completing the loop.
 */
import type { ServerId } from '../contract.ts'
import { subscribeFrames } from './live.ts'

/** The official runtime face the bridge drives (duck-typed, not type-linked). */
export interface OfficialSessions {
  handleMuxEnvelope(envelope: {
    type: 'server-request'
    rpcId: string
    method: string
    payload: unknown
  }): void
  /**
   * Host-frame sink. The sessions runtime handles `host/*` frames here — most
   * importantly `host/session-status`, which drives the per-session running
   * indicator. Routing a host frame into {@link handleMuxEnvelope} instead is
   * silently ignored by the mux switch, which is why this face is required.
   */
  handleHostEnvelope(envelope: {
    type: 'server-request'
    rpcId: string
    method: string
    payload: unknown
  }): void
}

/** The official workspaces runtime face (host-frame sink). */
export interface OfficialWorkspaces {
  handleHostEnvelope(envelope: {
    type: 'server-request'
    rpcId: string
    method: string
    payload: unknown
  }): void
}

/**
 * Start relaying hub SSE frames into the official runtimes, mirroring the
 * official connection dispatch exactly: every `host/*` frame goes to BOTH
 * `sessions.handleHostEnvelope` and `workspaces.handleHostEnvelope`, and
 * every other (mux) frame goes to `sessions.handleMuxEnvelope`.
 *
 * The earlier split — only `host/workspace-*` treated as a host frame, all
 * the rest funnelled into the mux entry — dropped `host/session-status` on
 * the floor, so a remote session that finished while the UI was open kept
 * spinning forever.
 * @param sessions - the official `ctx.sessions` service instance.
 * @param workspaces - the official `ctx.workspaces` service instance.
 * @returns the disposer (stop relaying).
 */
export function startOfficialBridge(
  sessions: OfficialSessions | undefined,
  workspaces: OfficialWorkspaces | undefined,
): () => void {
  if (sessions === undefined) return () => {}
  return subscribeFrames(({ rpcId, frame }) => {
    const type = typeof frame === 'object' && frame !== null
      ? (frame as { type?: unknown }).type
      : undefined
    if (typeof type === 'string' && type.startsWith('host/')) {
      const envelope = {
        type: 'server-request' as const,
        rpcId,
        method: 'events.host',
        payload: frame,
      }
      try {
        sessions.handleHostEnvelope(envelope)
      } catch (error) {
        console.error('[dsh-session-hub] official sessions host frame rejected:', error)
      }
      if (workspaces !== undefined) {
        try {
          workspaces.handleHostEnvelope(envelope)
        } catch (error) {
          console.error('[dsh-session-hub] official workspaces frame rejected:', error)
        }
      }
      return
    }
    try {
      sessions.handleMuxEnvelope({
        type: 'server-request',
        rpcId,
        method: 'events.mux',
        payload: frame,
      })
    } catch (error) {
      console.error('[dsh-session-hub] official sessions frame rejected:', error)
    }
  })
}

/** Reflect access helper: read the workspaces service off any context object. */
export function workspacesOf(context: unknown): OfficialWorkspaces | undefined {
  const candidate = (context as { workspaces?: unknown }).workspaces
  if (candidate !== undefined
    && typeof (candidate as { handleHostEnvelope?: unknown }).handleHostEnvelope === 'function') {
    return candidate as OfficialWorkspaces
  }
  return undefined
}

/** Reflect access helper: read the sessions service off any context object. */
export function sessionsOf(context: unknown): OfficialSessions | undefined {
  const candidate = (context as { sessions?: unknown }).sessions
  if (candidate !== undefined
    && typeof (candidate as { handleMuxEnvelope?: unknown }).handleMuxEnvelope === 'function'
    && typeof (candidate as { handleHostEnvelope?: unknown }).handleHostEnvelope === 'function') {
    return candidate as OfficialSessions
  }
  return undefined
}

// Re-export type only; the section uses ServerId for the add/remove rows.
export type { ServerId }