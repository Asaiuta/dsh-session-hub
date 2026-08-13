/**
 * Module-level live-event bus: the hub SSE receiver (started from the sidebar
 * tree once a snapshot token is known) publishes remote session events; the
 * conversation fold subscribes. React components in one bundle cannot talk
 * through props across sibling subtrees, so this mirrors hub-ui-state.
 */
import type { ServerId } from '../contract.ts'

/** One forwarded remote `session/event`, filtered down to what the fold needs. */
export interface LiveSessionEvent {
  readonly serverId: ServerId
  readonly sessionId: string
  /** The remote session event's own seq — the dedupe key against history. */
  readonly seq: number
  readonly event: unknown
}

type LiveListener = (envelope: LiveSessionEvent) => void
type ChangeListener = () => void
type StatusListener = (status: LiveStatus) => void

/** One raw mux/host frame as relayed by the hub SSE (unfiltered). */
export interface LiveFrame {
  readonly serverId: ServerId
  readonly rpcId: string
  readonly frame: unknown
}

type FrameListener = (frame: LiveFrame) => void

const liveListeners = new Set<LiveListener>()
const changeListeners = new Set<ChangeListener>()
const statusListeners = new Set<StatusListener>()
const frameListeners = new Set<FrameListener>()

/** Subscribe to live session events; returns the disposer. */
export function subscribeLive(listener: LiveListener): () => void {
  liveListeners.add(listener)
  return () => { liveListeners.delete(listener) }
}

/** Subscribe to any live frame (session events, approvals, queue, host) so
 *  the caller can trigger an immediate snapshot refresh; returns disposer. */
export function subscribeLiveChanges(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}

/** Publish one remote session event (from the SSE receiver). */
export function publishLive(envelope: LiveSessionEvent): void {
  for (const listener of [...liveListeners]) {
    try {
      listener(envelope)
    } catch (error) {
      console.error('[dsh-session-hub] live listener threw:', error)
    }
  }
}

/** Subscribe to the unfiltered frame relay (official-sessions bridge). */
export function subscribeFrames(listener: FrameListener): () => void {
  frameListeners.add(listener)
  return () => { frameListeners.delete(listener) }
}

/** Signal that some frame moved hub facts (session list, pending, queue). */
export function publishLiveChange(): void {
  for (const listener of [...changeListeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-session-hub] change listener threw:', error)
    }
  }
}

/** Relay one raw frame to the frame subscribers. */
export function publishFrame(frame: LiveFrame): void {
  for (const listener of [...frameListeners]) {
    try {
      listener(frame)
    } catch (error) {
      console.error('[dsh-session-hub] frame listener threw:', error)
    }
  }
}

/** Extract the session event payload from a forwarded `session/event` frame. */
export function asSessionEvent(frame: unknown): { sessionId: string; event: unknown; seq: number } | null {
  if (typeof frame !== 'object' || frame === null) return null
  const f = frame as { type?: unknown; sessionId?: unknown; event?: unknown }
  if (f.type !== 'session/event') return null
  const event = f.event
  if (typeof event !== 'object' || event === null) return null
  const e = event as { seq?: unknown }
  if (typeof f.sessionId !== 'string' || typeof e.seq !== 'number') return null
  return { sessionId: f.sessionId, event, seq: e.seq }
}

// ---- SSE stream singleton ----
//
// One EventSource per event token, opened lazily by whichever component first
// learns a snapshot token (the sidebar tree). A host restart rotates the
// token; ensureHubLive then rebuilds the stream. EventSource owns its own
// auto-reconnect for transient network failures.

export type LiveStatus = 'connecting' | 'live' | 'down'

let source: EventSource | null = null
let sourceToken: string | null = null
let status: LiveStatus = 'connecting'

/** Open (or reuse) the hub SSE stream for a snapshot event token. */
export function ensureHubLive(token: string): void {
  if (sourceToken === token && source !== null) return
  if (source !== null) source.close()
  sourceToken = token
  setStatus('connecting')
  const next = new EventSource(
    new URL(`/hub/events?token=${encodeURIComponent(token)}`, location.origin),
  )
  source = next
  next.addEventListener('frame', (message: MessageEvent<string>) => {
    if (message.data === undefined || message.data === '') return
    let envelope: unknown
    try {
      envelope = JSON.parse(message.data)
    } catch {
      return
    }
    if (typeof envelope !== 'object' || envelope === null) return
    const env = envelope as { serverId?: unknown; rpcId?: unknown; frame?: unknown }
    if (typeof env.serverId !== 'string' || typeof env.rpcId !== 'string'
      || typeof env.frame !== 'object' || env.frame === null) return
    // Any frame can move hub facts (running, title, pending, queue).
    publishLiveChange()
    publishFrame({ serverId: env.serverId as ServerId, rpcId: env.rpcId, frame: env.frame })
    const sessionEvent = asSessionEvent(env.frame)
    if (sessionEvent !== null) {
      publishLive({
        serverId: env.serverId as ServerId,
        sessionId: sessionEvent.sessionId,
        seq: sessionEvent.seq,
        event: sessionEvent.event,
      })
    }
  })
  next.onopen = () => setStatus('live')
  next.onerror = () => setStatus('down')
}

/** Current SSE stream status (stopped/connecting/live/down). */
export function getLiveStatus(): LiveStatus {
  return status
}

/** Subscribe to SSE stream status changes. */
export function subscribeLiveStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}

function setStatus(next: LiveStatus): void {
  if (status === next) return
  status = next
  for (const listener of [...statusListeners]) {
    try {
      listener(status)
    } catch (error) {
      console.error('[dsh-session-hub] status listener threw:', error)
    }
  }
}