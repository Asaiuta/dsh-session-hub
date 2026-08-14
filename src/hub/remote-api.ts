/**
 * Node-side wire client for one remote dsh web deployment.
 *
 * The harness ships this exact carrier pair for browsers (HTTP up +
 * WebSocket down, see client/connection/src/client/web-api-client.ts); this
 * subclass redirects both legs at an absolute origin. Node fetch carries no
 * Origin/Sec-Fetch-* markers, so the remote's browser-trust fence admits the
 * calls when the Host header is loopback (tunnel) or one of the remote's
 * derived/configured trusted authorities — exactly the non-browser path the
 * fence documents (api-request-trust.ts).
 */
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy'
import { serverRequestSchema, type ParsedServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'

/** Browser-compatible WebSocket in Node ≥22 (engines constraint). */
declare const WebSocket: {
  new (url: string): WebSocketLike
}
interface WebSocketLike {
  readonly readyState: number
  close(): void
  addEventListener(type: 'open' | 'message' | 'close', listener: (event: MessageEventLike) => void, options?: { once?: boolean }): void
  removeEventListener(type: 'open' | 'message' | 'close', listener: (event: MessageEventLike) => void): void
}
interface MessageEventLike {
  readonly data: unknown
}

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/**
 * Remote /api carrier: unary/respond use Node fetch against the remote
 * origin; mux/host use one WebSocket each, mirroring WebApiClient.
 */
export class RemoteApiClient extends AbstractApiClient {
  constructor(private readonly origin: string) {
    super()
  }

  protected override resolveBase(): string {
    return this.origin
  }

  protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
    // Internal-forward marker: when the hub routes to a server whose baseUrl
    // points back at this same hub process (the local-test/self-loop shape),
    // the forwarded request would otherwise re-enter the gateway exact routes
    // and recurse forever. The marker makes the gateway delegate straight to
    // the official ApiProxy (local semantics) instead of routing again.
    return globalThis.fetch(input, {
      ...init,
      headers: { ...init?.headers, 'x-dsh-hub-internal': '1' },
    })
  }

  /**
   * Unary RPC to any wire domain (settings/credentials/llm/…), envelope in
   * the standard client-request shape. Privileged methods pass the remote
   * fence when the Host is loopback (SSH tunnel) or a declared trusted
   * authority — the same Node non-browser path the fence documents.
   * @returns the parsed ServerResponse document.
   */
  async call(method: string, payload: unknown, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-host-apiproxy').RpcResponse<unknown>> {
    const target = new URL(this.resolveBase())
    target.pathname = `/api/${method}`
    const response = await this.doFetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        method,
        rpcId: `hub-${crypto.randomUUID()}`,
        payload,
      } as import('@deepseek-ai/dsh-host-apiproxy').ClientRequest),
      signal,
    })
    if (!response.ok) throw new Error(`remote ${method} HTTP ${response.status}`)
    return (await response.json()) as import('@deepseek-ai/dsh-host-apiproxy').RpcResponse<unknown>
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readSocket('/api/events.mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readSocket('/api/events.host', signal, hostFrameSchema, onOpen)
  }

  private async *readSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url.toString())
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEventLike): void => {
      let full: ParsedServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[dsh-session-hub] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      // The base envelope tap keeps observation subscribers (diagnostics) fed.
      this.onEnvelope(full as Parameters<AbstractApiClient['onEnvelope']>[0])
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === 0 || socket.readyState === 1) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
