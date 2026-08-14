/**
 * Hub aggregation gateway: an HTTP dispatch layer for the /api unary
 * endpoints the browser reaches through the official client connection. The
 * official /api prefix route still owns events websockets and everything
 * else; the hub registers exact-path routes (exact beats prefix in the
 * webserver match) for the session-control methods, runs the same
 * browser-trust fence, then routes by session ownership: remote sessions →
 * the owning ServerLink, local sessions (and unknown ids) → the official
 * ApiProxy unchanged. This is what lets the *unmodified* official Web UI
 * open, stream, and control remote sessions.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ApiProxy, ClientRequest, RpcId, RpcReceipt, RpcResponse,
} from '@deepseek-ai/dsh-host-apiproxy'
import type { ServerRegistry } from './registry.ts'
import { isTrustedApiRequest } from './fence.ts'

const MAX_BODY_BYTES = 32 * 1024 * 1024

/** Methods whose session may live on a remote server (unary, envelope-carried). */
const ROUTED_SESSION_METHODS = new Set([
  'session.history',
  'session.prompt',
  'session.cancel',
  'session.rename',
  'session.fork',
  'session.models',
  'session.selectModel',
  'session.updateQueue',
  'session.attachment',
])

/** Methods intercepted by exact routes (browser-facing unary surface). */
export const GATEWAY_METHODS = [
  'session.list',
  ...ROUTED_SESSION_METHODS,
  'session.search',
  'workspace.list',
  'respond',
]

/** Virtual-workspace origin marker for server groups in the official tree. */
const VIRTUAL_WORKSPACE_EPOCH = '1970-01-01T00:00:00.000Z'

/** Read the request body (bounded); null on oversize or missing body. */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

function jsonResponse(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * One intercepted unary request lifecycle. `method` is the /api path segment
 * (e.g. "session.history"); the handler owns the whole response.
 */
export class HubGateway {
  constructor(
    private readonly official: () => ApiProxy,
    private readonly registry: ServerRegistry,
    private readonly trustedHosts: readonly string[],
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
    if (!isTrustedApiRequest(req, this.trustedHosts)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    // Internal-forward marker (set by RemoteApiClient): the hub's own links
    // (local-test self-loop) must not re-route through the gateway; delegate
    // straight to the official ApiProxy so forwarding cannot recurse.
    const internal = String(req.headers['x-dsh-hub-internal'] ?? '') === '1'
    if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') {
      res.writeHead(415)
      res.end('unsupported media type')
      return
    }
    const body = await readBody(req)
    if (body === null) {
      res.writeHead(400)
      res.end('bad request')
      return
    }
    let envelope: ClientRequest
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'))
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
      const candidate = parsed as ClientRequest
      if (candidate.type !== 'client-request' || candidate.method !== method
        || typeof candidate.rpcId !== 'string') throw new Error('invalid envelope')
      envelope = candidate
    } catch {
      res.writeHead(400)
      res.end('bad request')
      return
    }
    const response = await this.dispatch(method, envelope, internal)
    // Official domain methods return the narrow form ({rpcId, result}); the
    // wire layer adds the type tag. Normalize here so the browser's
    // serverResponseSchema validation always passes.
    const full: RpcResponse<unknown> = response.type === 'server-response'
      ? response
      : { type: 'server-response', rpcId: response.rpcId, result: response.result }
    jsonResponse(res, full)
  }

  /** Route one unary envelope; always answers a ServerResponse document. */
  async dispatch(method: string, envelope: ClientRequest, internal = false): Promise<RpcResponse<unknown>> {
    const { rpcId, payload } = envelope
    try {
      if (method === 'session.list') return this.list(rpcId, payload)
      if (ROUTED_SESSION_METHODS.has(method)) return this.bySession(method, rpcId, payload)
      if (method === 'session.search') return this.search(rpcId, payload)
      if (method === 'workspace.list') return this.workspaceList(rpcId, payload)
      if (method === 'respond') return this.respond(rpcId, payload)
      return this.callOfficial(method, rpcId, payload)
    } catch (error) {
      return {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: errorToRpcError(error) },
      }
    }
  }

  /** Merged session list: official local rows + every remote server's rows. */
  private async list(rpcId: RpcId, payload: { cursor?: string }): Promise<RpcResponse<unknown>> {
    const local = await this.callOfficial('session.list', rpcId, payload)
    if (!local.result.ok || !Array.isArray((local.result.value as { items?: unknown }).items)) {
      return local
    }
    const value = local.result.value as { items: unknown[] }
    const seen = new Set<string>()
    const items = [...value.items].filter(item => {
      const id = typeof item === 'object' && item !== null ? (item as { sessionId?: unknown }).sessionId : undefined
      if (typeof id !== 'string') return true
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    for (const link of this.registry.linkList()) {
      for (const row of link.sessionRows()) {
        // The hub itself may be configured as a server (local-test): its rows
        // are the official rows already present; skip duplicates by id.
        if (seen.has(row.sessionId)) continue
        seen.add(row.sessionId)
        items.push(row.summary as unknown)
      }
    }
    items.sort((a, b) => {
      const ta = typeof a === 'object' && a !== null ? (a as { updatedAt?: unknown }).updatedAt : 0
      const tb = typeof b === 'object' && b !== null ? (b as { updatedAt?: unknown }).updatedAt : 0
      return Number(tb) - Number(ta)
    })
    return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
  }

  /**
   * Merged workspace list: official local workspaces + one *virtual* group
   * per configured server. The official tree groups sessions by workspace
   * membership, so each server's remote sessions appear as their own
   * top-level group instead of the ungrouped bucket. Virtual views carry a
   * `dsh-hub://<serverId>` path and the server's display name as title.
   */
  private async workspaceList(rpcId: RpcId, payload: unknown): Promise<RpcResponse<unknown>> {
    const local = await this.callOfficial('workspace.list', rpcId, payload)
    if (!local.result.ok || !Array.isArray((local.result.value as { items?: unknown }).items)) {
      return local
    }
    const value = local.result.value as { items: unknown[]; archivedSessionIds: unknown }
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          ...value,
          items: [...value.items, ...this.virtualWorkspaceViews()],
        },
      },
    }
  }

  /**
   * The virtual workspace projection: one workspace row per configured
   * server, owning that server's remote sessions. Shared by the workspace.list
   * merge and the synthetic `host/workspace-changed` frame watcher, so the
   * official tree stays consistent between cold list and live updates.
   */
  virtualWorkspaceViews(): import('@deepseek-ai/dsh-host-apiproxy').WorkspaceView[] {
    const snapshot = this.registry.snapshot()
    return snapshot.servers.map(server => ({
      workspaceId: server.id,
      path: `dsh-hub://${server.id}`,
      title: server.name,
      sessionIds: snapshot.sessions
        .filter(row => row.serverId === server.id)
        .map(row => row.sessionId),
      createdAt: VIRTUAL_WORKSPACE_EPOCH,
      updatedAt: VIRTUAL_WORKSPACE_EPOCH,
    }))
  }

  /** Search across the local host and every remote server (best effort). */
  private async search(rpcId: RpcId, payload: { query: string }): Promise<RpcResponse<unknown>> {
    const local = await this.callOfficial('session.search', rpcId, payload)
    if (!local.result.ok) return local
    const value = local.result.value as { items: unknown[]; hasMore?: boolean }
    const items = [...value.items]
    for (const link of this.registry.linkList()) {
      try {
        const remote = await link.search(payload.query)
        if (remote.ok) items.push(...(remote.value?.items ?? []))
      } catch {
        // one unreachable server must not fail the whole search
      }
    }
    return { type: 'server-response', rpcId, result: { ok: true, value: { ...value, items } } }
  }

  /** Route one session method to the owning server, else the local host. */
  private async bySession(method: string, rpcId: RpcId, payload: { sessionId?: unknown }): Promise<RpcResponse<unknown>> {
    const sessionId = payload.sessionId
    if (typeof sessionId !== 'string') return this.callOfficial(method, rpcId, payload)
    const link = this.registry.findLinkBySession(sessionId)
    if (link === undefined) return this.callOfficial(method, rpcId, payload)
    const result = await link.invoke(method, payload as Record<string, unknown>)
    return { type: 'server-response', rpcId, result }
  }

  /** Route a client response to the remote server holding the pending rpcId. */
  private async respond(rpcId: RpcId, payload: unknown): Promise<RpcResponse<unknown>> {
    const candidate = payload as { type?: unknown; rpcId?: unknown; result?: { value?: unknown } }
    if (candidate?.type === 'client-response' && typeof candidate.rpcId === 'string') {
      const link = this.registry.findLinkByRpcId(candidate.rpcId)
      if (link !== undefined) {
        const result = await link.respond(candidate.rpcId, (candidate.result as { value?: unknown } | undefined)?.value)
        if (!result.ok) {
          return { type: 'server-response', rpcId, result }
        }
        const accepted = result.value.accepted
        return {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: { accepted, ...(accepted ? {} : { reason: result.value.reason }) },
          },
        }
      }
    }
    try {
      const receipt: RpcReceipt = await this.official().respond(payload as never)
      const accepted = receipt.accepted
      return {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { accepted, ...(accepted ? {} : { reason: receipt.reason }) } },
      }
    } catch (error) {
      return { type: 'server-response', rpcId, result: { ok: false, error: errorToRpcError(error) } }
    }
  }

  /** Delegate to the official ApiProxy domain (local host semantics). The
   * host-side domain methods take the full {rpcId, payload} request shape
   * (the same shape UNARY_ROUTES invokes) and return RpcResponse. */
  private async callOfficial(method: string, rpcId: RpcId, payload: unknown): Promise<RpcResponse<unknown>> {
    const rawDomain = method.split('.')[0]
    const domain = rawDomain === 'session' ? 'sessions' : rawDomain
    const name = method.slice(method.indexOf('.') + 1)
    const official = this.official()
    const api = (official as unknown as Record<string, Record<string, (r: { rpcId: RpcId; payload: unknown }, s?: AbortSignal) => Promise<RpcResponse<unknown>>>>)[domain]
    if (api === undefined || typeof api[name] !== 'function') {
      return {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'no-such-method' as never, message: `method "${method}" does not exist`, details: {} } },
      }
    }
    return await api[name]({ rpcId, payload }, undefined)
  }
}

/** Business-agnostic error → RpcError (transport codes survive). */
function errorToRpcError(error: unknown): ClientRequest extends never ? never : never {
  const e = error as { code?: string; message?: string; details?: unknown }
  return {
    code: (e?.code as never) ?? ('transport' as never),
    message: e?.message ?? String(error),
    ...(e?.details !== undefined ? { details: e.details } : {}),
  } as never
}