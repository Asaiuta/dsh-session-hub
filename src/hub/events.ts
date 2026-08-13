/**
 * Hub live event channel: the per-link mux/host frames the registry already
 * receives are fanned out to local browser clients over one SSE route
 * (`/hub/events`). This is what makes the panel real-time — the remote
 * harness streams every session/event (assistant chunks, tool calls,
 * approvals, questions) over its own mux WebSocket, and the hub forwards
 * them verbatim to the browser instead of making the panel poll.
 *
 * The route is deliberately NOT a Typert endpoint: SSE needs a raw response
 * stream a browser EventSource can consume. Authentication is a per-registry
 * random token (delivered to the browser through the snapshot endpoint) plus
 * the same loopback/same-origin checks the harness /api fence applies.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HostFrame, MuxFrame } from '@deepseek-ai/dsh-host-apiproxy'
import type { ServerId } from '../contract.ts'

/** One forwarded frame, tagged with its source link. */
export interface HubEventEnvelope {
  readonly serverId: ServerId
  /** Monotonic per-bus sequence (delivery order on the wire). */
  readonly seq: number
  /** The remote frame's envelope rpcId (matters for respond echoing). */
  readonly rpcId: string
  readonly frame: MuxFrame | HostFrame
}

export type HubEventSink = (envelope: HubEventEnvelope) => void

/** Fan-out bus owned by the registry; one subscriber per SSE client. */
export class HubEventBus {
  private readonly sinks = new Set<HubEventSink>()
  private seq = 0

  publish(serverId: ServerId, rpcId: string, frame: MuxFrame | HostFrame): void {
    const envelope: HubEventEnvelope = { serverId, seq: ++this.seq, rpcId, frame }
    for (const sink of [...this.sinks]) {
      try {
        sink(envelope)
      } catch (error) {
        console.error('[dsh-session-hub] event sink threw:', error)
      }
    }
  }

  subscribe(sink: HubEventSink): () => void {
    this.sinks.add(sink)
    return () => { this.sinks.delete(sink) }
  }

  get size(): number {
    return this.sinks.size
  }
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

const HEARTBEAT_MS = 25_000

/** Mirror of the harness fence: localhost, [::1], any 127/8 IPv4. */
function isLoopbackHostname(hostname: string | null): boolean {
  if (hostname === null) return false
  if (hostname === 'localhost' || hostname === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return hostname.split('.').every(part => Number(part) <= 255)
  }
  return false
}

/** The `host:port` authority a same-origin request must carry. */
function authorityOf(hostHeader: string | undefined): { hostname: string; port: number | null } | null {
  if (hostHeader === undefined || hostHeader === '') return null
  const trimmed = hostHeader.trim()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end === -1) return null
    const rest = trimmed.slice(end + 1)
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : null
    return { hostname: trimmed.slice(1, end).toLowerCase(), port: Number.isInteger(port) ? port : null }
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon === -1) return { hostname: trimmed.toLowerCase(), port: null }
  const port = Number(trimmed.slice(colon + 1))
  return { hostname: trimmed.slice(0, colon).toLowerCase(), port: Number.isInteger(port) ? port : null }
}

/** Origin, when present, must equal the request authority (DNS-rebinding fence).
 *  Absent Origin = non-browser client; the token + loopback checks already gate it. */
function sameOrigin(origin: string | undefined, authority: { hostname: string; port: number | null } | null): boolean {
  if (origin === undefined) return true
  if (origin === 'null' || authority === null) return false
  try {
    const url = new URL(origin)
    const originPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
    return url.hostname.toLowerCase() === authority.hostname
      && originPort === (authority.port ?? (url.protocol === 'https:' ? 443 : 80))
  } catch {
    return false
  }
}

function tokenEquals(expected: string, candidate: string | null): boolean {
  if (candidate === null || candidate.length !== expected.length) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(candidate)
  return timingSafeEqual(a, b)
}

/** One EventSource client: validates the request, then streams envelopes. */
function handleEventsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bus: HubEventBus,
  token: string,
): void {
  const url = new URL(req.url ?? '/', 'http://local')
  const authority = authorityOf(req.headers.host)
  const hostname = authority?.hostname ?? null

  // Token (random per registry instance) + loopback host: defeats cross-site
  // reads, DNS rebinding, and drive-by fetches. Origin, when present (browsers
  // always send it on EventSource), must match the request authority.
  if (!tokenEquals(token, url.searchParams.get('token'))
    || !isLoopbackHostname(hostname)
    || !sameOrigin(req.headers.origin, authority)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('forbidden')
    return
  }

  res.writeHead(200, SSE_HEADERS)
  res.write(':ok\n\n')

  const send = (envelope: HubEventEnvelope): void => {
    res.write(`event: frame\ndata: ${JSON.stringify(envelope)}\n\n`)
  }
  const unsubscribe = bus.subscribe(send)
  const heartbeat = setInterval(() => {
    try {
      res.write(':hb\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, HEARTBEAT_MS)

  res.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
  res.on('error', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

/** Build the `/hub/events` SSE route for one registry instance. */
export function createHubEventsRoute(bus: HubEventBus, token: string): {
  kind: 'exact'
  path: '/hub/events'
  handler: (req: IncomingMessage, res: ServerResponse) => void
} {
  return {
    kind: 'exact',
    path: '/hub/events',
    handler: (req, res) => handleEventsRequest(req, res, bus, token),
  }
}

/** Fresh per-registry token (32 random bytes, hex). */
export function newEventToken(): string {
  return randomBytes(32).toString('hex')
}
