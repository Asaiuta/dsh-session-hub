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
import type { ImportStore } from './importer.ts'
import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy'
import { createHash } from 'node:crypto'
import { normalizePath } from './import-common.ts'
import { groupingPath } from './importer.ts'
import { replayInto, type SessionStoreFace } from './promote.ts'
import { isTrustedApiRequest } from './fence.ts'

const MAX_BODY_BYTES = 32 * 1024 * 1024

/**
 * The real project directory an imported session should be adopted under, or
 * undefined when it has none.
 *
 * Grouping folds Codex's per-conversation scratch directories into a shared
 * bucket; that bucket is a display grouping, not a project, so it is never
 * registered as a workspace. Worktree copies report the project they mirror
 * and are adopted through it rather than through their hashed path.
 *
 * @param cwd - the session's recorded working directory.
 * @returns the directory to register, or undefined to leave it synthetic.
 */
function importProjectPath(cwd: string): string | undefined {
  const group = groupingPath(cwd)
  if (group.nameHint !== undefined) return undefined
  if (group.normalized !== normalizePath(cwd)) return undefined
  return group.display
}

/**
 * Synthetic workspace groups for imported sessions whose project directory
 * has no official workspace. Without these every such session collapses into
 * the ungrouped bucket; with them the tree shows one group per project,
 * titled after the directory. The id is derived from the path so the group
 * keeps its identity across refreshes (the official tree keys rows by id).
 *
 * @param orphans - leftover sessions keyed by normalized cwd.
 * @returns one WorkspaceView per project directory.
 */
function importedProjectViews(
  orphans: Map<string, { path: string; ids: string[] }> | undefined,
): WorkspaceView[] {
  if (orphans === undefined) return []
  const epoch = new Date(0).toISOString()
  return [...orphans].map(([normalized, group]) => {
    const digest = createHash('sha256').update(`import-project:${normalized}`).digest('hex').slice(0, 24)
    const segments = group.path.split(/[\\/]/).filter(Boolean)
    return {
      workspaceId: `imp-ws-${digest}`,
      path: group.path,
      title: segments[segments.length - 1] ?? group.path,
      sessionIds: group.ids,
      createdAt: epoch,
      updatedAt: epoch,
    } as WorkspaceView
  })
}

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
  'session.create',
  'workspace.list',
  'workspace.archiveSession',
  'workspace.rename',
  'workspace.delete',
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
    private readonly imports?: ImportStore,
    /** The official session store, when the host exposes one. */
    private readonly sessionStore?: () => SessionStoreFace | undefined,
  ) {}

  /** Project paths already offered to workspace.create (once per process). */
  private readonly materialized = new Set<string>()
  /** Imported session id → the real session it was promoted to. */
  private readonly promoted = new Map<string, string>()

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
      if (method === 'session.create') return this.createSession(rpcId, payload)
      if (ROUTED_SESSION_METHODS.has(method)) return this.bySession(method, rpcId, payload)
      if (method === 'session.search') return this.search(rpcId, payload)
      if (method === 'workspace.list') return this.workspaceList(rpcId, payload)
      if (method === 'workspace.archiveSession') return this.bySession(method, rpcId, payload)
      if (method === 'workspace.rename') return this.renameWorkspace(rpcId, payload)
      if (method === 'workspace.delete') return this.deleteWorkspace(rpcId, payload)
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
    if (this.imports !== undefined) {
      for (const summary of this.imports.rows()) {
        if (seen.has(summary.sessionId)) continue
        seen.add(summary.sessionId)
        items.push(summary as unknown)
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
  /**
   * Register a real official workspace for every imported project directory
   * that does not have one yet.
   *
   * Synthetic groups render fine but are not real workspaces, so official
   * operations (rename, delete, starting a session in them) do not apply to
   * them. `workspace.create` is idempotent and never creates directories — a
   * path that no longer exists fails with `workspace-invalid-path` — so this
   * only ever adopts directories the user really worked in.
   *
   * Each path is attempted once per process: a path the user subsequently
   * deletes from the workspace list must stay deleted, and a failing path
   * must not be retried on every list call.
   *
   * @param rpcId - the in-flight request id, reused for the nested calls.
   */
  private async materializeImportedProjects(rpcId: RpcId): Promise<void> {
    const store = this.imports
    if (store === undefined) return
    const paths = new Set<string>()
    for (const session of store.visible()) {
      const path = importProjectPath(session.cwd)
      if (path === undefined) continue
      if (this.materialized.has(normalizePath(path))) continue
      if (store.isDeclined(path)) continue
      paths.add(path)
    }
    for (const path of paths) {
      this.materialized.add(normalizePath(path))
      try {
        await this.callOfficial('workspace.create', rpcId, { path })
      } catch (error) {
        console.warn(`[dsh-session-hub] workspace.create failed for ${path}:`, error)
      }
    }
  }

  private async workspaceList(rpcId: RpcId, payload: unknown): Promise<RpcResponse<unknown>> {
    if (this.imports !== undefined) await this.materializeImportedProjects(rpcId)
    const local = await this.callOfficial('workspace.list', rpcId, payload)
    if (!local.result.ok || !Array.isArray((local.result.value as { items?: unknown }).items)) {
      return local
    }
    const value = local.result.value as { items: unknown[]; archivedSessionIds?: unknown }
    const localArchived = Array.isArray(value.archivedSessionIds)
      ? value.archivedSessionIds.filter((id): id is string => typeof id === 'string')
      : []
    const remoteArchived = this.registry.linkList().flatMap(link => link.archivedSessionIds())
    const archivedSessionIds = [...new Set([...localArchived, ...remoteArchived])]
    // One assignment pass over all official paths: each imported session goes
    // to its longest containing workspace, and whatever is left over is
    // grouped by project directory below.
    const officialPaths = value.items.flatMap(item => {
      const path = typeof item === 'object' && item !== null ? (item as { path?: unknown }).path : undefined
      return typeof path === 'string' ? [path] : []
    })
    const assignment = this.imports?.assign(officialPaths)
    const items = value.items.map(item => {
      if (assignment === undefined) return item
      const path = typeof item === 'object' && item !== null ? (item as { path?: unknown }).path : undefined
      if (typeof path !== 'string') return item
      const imported = assignment.byWorkspace.get(normalizePath(path))
      if (imported === undefined || imported.length === 0) return item
      const sessionIds = Array.isArray((item as { sessionIds?: unknown }).sessionIds)
        ? (item as { sessionIds: unknown[] }).sessionIds
        : []
      return { ...item as object, sessionIds: [...sessionIds, ...imported] }
    })
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          ...value,
          items: [
            ...items,
            ...this.virtualWorkspaceViews(),
            ...importedProjectViews(assignment?.orphansByCwd),
          ],
          archivedSessionIds,
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

  /**
   * Promote an imported session to a real DSH session, once.
   *
   * The mapping is remembered so a second prompt (or a retry) continues the
   * same session instead of minting another copy, and the imported original
   * is hidden so the conversation does not appear twice in the tree.
   *
   * @param rpcId - the in-flight request id, reused for the nested call.
   * @param sessionId - the imported session to promote.
   * @returns the real session id, or undefined when promotion is unavailable.
   */
  private async promote(rpcId: RpcId, sessionId: string): Promise<string | undefined> {
    const existing = this.promoted.get(sessionId)
    if (existing !== undefined) return existing
    const store = this.sessionStore?.()
    const parsed = this.imports?.sessionById(sessionId)
    if (store === undefined || parsed === undefined) return undefined
    // Mint through the official create so the session gets this deployment's
    // normal agent composition, cwd and workspace attachment.
    const created = await this.callOfficial('session.create', rpcId, { cwd: parsed.cwd })
    if (!created.result.ok) {
      console.warn(`[dsh-session-hub] promotion could not create a session for ${sessionId}`)
      return undefined
    }
    const realId = (created.result.value as { sessionId?: unknown }).sessionId
    if (typeof realId !== 'string') return undefined
    try {
      const count = replayInto(store, realId, parsed)
      this.promoted.set(sessionId, realId)
      this.imports?.markPromoted(sessionId, realId)
      console.info(`[dsh-session-hub] promoted ${parsed.tool} session ${sessionId} to ${realId} (${count} events)`)
      return realId
    } catch (error) {
      console.warn(`[dsh-session-hub] replay failed for ${sessionId}:`, error)
      return undefined
    }
  }

  /** Route one session method to the owning server, else the local host. */
  private async bySession(method: string, rpcId: RpcId, payload: { sessionId?: unknown }): Promise<RpcResponse<unknown>> {
    const sessionId = payload.sessionId
    if (typeof sessionId !== 'string') return this.callOfficial(method, rpcId, payload)
    const link = this.registry.findLinkBySession(sessionId)
    if (link === undefined) {
      // Imported external-tool sessions: history is served from the parsed
      // logs; every other action is read-only and rejected.
      if (this.imports !== undefined && this.imports.sessionById(sessionId) !== undefined) {
        if (method === 'session.history') {
          const events = this.imports.history(sessionId)
          if (events !== undefined) {
            return { type: 'server-response', rpcId, result: { ok: true, value: { events, hasMore: false } } }
          }
        }
        // Sending a message is the point where browsing turns into working:
        // promote the log to a real session the harness owns and let the
        // prompt land there, so the user continues the conversation instead
        // of being told it is read-only.
        if (method === 'session.prompt') {
          const promoted = await this.promote(rpcId, sessionId)
          if (promoted !== undefined) {
            return this.callOfficial(method, rpcId, { ...payload, sessionId: promoted })
          }
        }
        return {
          type: 'server-response',
          rpcId,
          result: {
            ok: false,
            error: {
              code: 'import-readonly' as never,
              message: `session ${sessionId} is an imported read-only session (${this.imports.sessionById(sessionId)?.tool}); it cannot be ${method.slice('session.'.length)}`,
              details: {},
            },
          },
        }
      }
      return this.callOfficial(method, rpcId, payload)
    }
    const result = method === 'workspace.archiveSession'
      ? await link.wireCall(method, payload)
      : await link.invoke(method, payload as Record<string, unknown>)
    if (method === 'workspace.archiveSession' && result.ok) {
      // The archived id is now in the remote archive set; refresh our cached
      // projection so the merged workspace.list keeps the tree honest.
      void link.refreshArchived()
    }
    return { type: 'server-response', rpcId, result }
  }

  /**
   * session.create: a virtual workspace id (a hub server) routes the create
   * to that server — the remote has no such workspace, so the id is dropped
   * and the session lands in the remote's default group. No workspace id
   * (sidebar global New Session) stays on the official path.
   */
  private async createSession(rpcId: RpcId, payload: { workspaceId?: unknown; cwd?: unknown; agentPreset?: unknown; sessionId?: unknown }): Promise<RpcResponse<unknown>> {
    const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined
    const link = workspaceId === undefined ? undefined : this.registry.link(workspaceId as never)
    if (link === undefined) return this.callOfficial('session.create', rpcId, payload)
    const opts: { cwd?: string; agentPreset?: string; sessionId?: string } = {}
    if (typeof payload.cwd === 'string') opts.cwd = payload.cwd
    if (typeof payload.agentPreset === 'string') opts.agentPreset = payload.agentPreset
    if (typeof payload.sessionId === 'string') opts.sessionId = payload.sessionId
    const result = await link.create(opts)
    return { type: 'server-response', rpcId, result }
  }

  /**
   * workspace.rename on a virtual server group renames the server (display
   * name, persisted, no reconnect); everything else stays official.
   */
  private async renameWorkspace(rpcId: RpcId, payload: { workspaceId?: unknown; title?: unknown }): Promise<RpcResponse<unknown>> {
    const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined
    const title = typeof payload.title === 'string' ? payload.title : undefined
    const link = workspaceId === undefined ? undefined : this.registry.link(workspaceId as never)
    if (link === undefined || title === undefined || title.trim() === '') {
      return this.callOfficial('workspace.rename', rpcId, payload)
    }
    this.registry.renameDisplay(workspaceId as never, title.trim())
    const workspace = this.virtualWorkspaceViews().find(view => view.workspaceId === workspaceId)
    if (workspace === undefined) {
      return this.callOfficial('workspace.rename', rpcId, payload)
    }
    return { type: 'server-response', rpcId, result: { ok: true, value: { workspace } } }
  }

  /**
   * workspace.delete on a virtual server group removes the server connection
   * (config entry included); everything else stays official.
   */
  /**
   * workspace.delete on a virtual server group removes the server connection
   * (config entry included); everything else stays official.
   *
   * Deleting a workspace that holds imported sessions also records the
   * project as declined, so adoption does not re-create it on the next list
   * and the sessions do not reappear as a synthetic group.
   */
  private async deleteWorkspace(rpcId: RpcId, payload: { workspaceId?: unknown }): Promise<RpcResponse<unknown>> {
    const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined
    const link = workspaceId === undefined ? undefined : this.registry.link(workspaceId as never)
    if (link === undefined) {
      const path = workspaceId === undefined ? undefined : await this.workspacePath(rpcId, workspaceId)
      const result = await this.callOfficial('workspace.delete', rpcId, payload)
      if (result.result.ok && path !== undefined) this.imports?.decline(path)
      return result
    }
    this.registry.remove(workspaceId as never)
    return { type: 'server-response', rpcId, result: { ok: true, value: { deleted: true } } }
  }

  /**
   * The directory behind a workspace id, read from the official registry.
   * @param rpcId - the in-flight request id, reused for the nested call.
   * @param workspaceId - the workspace to resolve.
   * @returns the path, or undefined when the id is unknown.
   */
  private async workspacePath(rpcId: RpcId, workspaceId: string): Promise<string | undefined> {
    const listed = await this.callOfficial('workspace.list', rpcId, {})
    if (!listed.result.ok) return undefined
    const items = (listed.result.value as { items?: unknown }).items
    if (!Array.isArray(items)) return undefined
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as { workspaceId?: unknown; path?: unknown }
      if (row.workspaceId === workspaceId && typeof row.path === 'string') return row.path
    }
    return undefined
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