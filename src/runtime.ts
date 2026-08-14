/**
 * The dsh-session-hub host Remote service (`ctx.sessionHub`, wire namespace
 * `sessionHub`). Registered as a TypertRemoteService so the Host Gateway
 * exports its @Remote methods to the Web client under `/api/sessionHub/*`
 * with zero generated artifacts; the strict manifest (typert.ts) is what
 * actually resolves and invokes the endpoints in a profile-loaded bundle.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { HistoryEntry, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy'
import type { HubSnapshot, PendingRow, ServerId, ServerView } from './contract.ts'
import { ServerRegistry } from './hub/registry.ts'
import type { ActionResult } from './hub/server-link.ts'
import type { ModelSyncService } from './hub/model-sync.ts'

/** Throw an RPC-style error the Typert layer maps into the error result slot. */
function fail(code: string, message: string): never {
  const error = new Error(`dsh-session-hub: ${message}`) as Error & { code?: string }
  error.code = code
  throw error
}

/**
 * Make a business result boundary-safe: the Typert gateway rejects results
 * carrying undefined-valued properties (JSON safety check), so drop them via
 * a JSON round trip before returning. Host-provided objects are already
 * clean; hub-built views carry optional fields (host, lastError, approval,
 * question) that may be undefined.
 */
function out<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Unwrap an ActionResult or throw the business error. */
function unwrap<T>(result: ActionResult<T>, what: string): T {
  if (result.ok) return result.value
  fail(result.error.code, `${what}: ${result.error.message}`)
}

/** Remote-link call with session-id and server-id resolution. */
type Link = NonNullable<ReturnType<ServerRegistry['link']>>

function withLink<T>(
  registry: ServerRegistry,
  serverId: ServerId,
  what: string,
  run: (api: Link) => Promise<ActionResult<T>>,
): Promise<T> {
  const link = registry.link(serverId)
  if (link === undefined) fail('unknown-server', `no server ${JSON.stringify(serverId)}`)
  return run(link as Link).then(result => unwrap(result, what))
}

/** The multi-server control plane: registry CRUD, merged snapshot, actions. */
export class SessionHubRuntime extends TypertRemoteService {
  /**
   * Register the service under the `sessionHub` key (the wire namespace).
   * @param ctx - owning cordis context.
   * @param registry - shared server registry (persistence + links).
   */
  constructor(
    ctx: Context,
    private readonly registry: ServerRegistry,
    private readonly syncService?: ModelSyncService,
  ) {
    super(ctx, 'sessionHub')
  }

  // ---- Model-config sync ----

  /**
   * Incrementally sync the local model configuration (llm-* namespaces +
   * agent-default-model + credential references) to one server, or to every
   * connected server. Additive only: missing pieces are filled, existing
   * remote state is never overwritten.
   */
  @Remote
  async modelSync(payload: { serverId?: ServerId }): Promise<{ synced: Array<{ serverId: string; updated: string[]; credentials: string[]; skipped: string[] }> }> {
    if (this.syncService === undefined) fail('not-configured', 'model sync service unavailable')
    return out(await this.syncService.sync(payload.serverId))
  }

  // ---- Server registry ----

  @Remote
  serversList(_payload: Record<string, never>): ServerView[] {
    return out(this.registry.serversList())
  }

  @Remote
  async serversAdd(payload: { name: string; baseUrl: string }): Promise<ServerView> {
    try {
      const view = await this.registry.add(payload.name, payload.baseUrl)
      return out(view)
    } catch (error) {
      return fail('self-loop', error instanceof Error ? error.message : String(error))
    }
  }

  @Remote
  serversUpdate(payload: { id: ServerId; name?: string; baseUrl?: string }): ServerView {
    return out(this.registry.update(payload.id, {
      ...(payload.name === undefined ? {} : { name: payload.name }),
      ...(payload.baseUrl === undefined ? {} : { baseUrl: payload.baseUrl }),
    }))
  }

  @Remote
  serversRemove(payload: { id: ServerId }): { removed: true } {
    this.registry.remove(payload.id)
    return out({ removed: true })
  }

  // ---- Snapshot ----

  @Remote
  snapshot(_payload: Record<string, never>): HubSnapshot {
    return out(this.registry.snapshot())
  }

  // ---- Session actions (each routed to the owning remote link) ----

  @Remote
  sessionHistory(payload: { serverId: ServerId; sessionId: string; maxMessages?: number }):
    Promise<{ events: HistoryEntry[]; hasMore: boolean }> {
    return withLink(this.registry, payload.serverId, 'history',
      link => link.history(payload.sessionId, payload.maxMessages).then(out))
  }

  @Remote
  sessionPrompt(payload: { serverId: ServerId; sessionId: string; text: string }):
    Promise<{ accepted: true }> {
    return withLink(this.registry, payload.serverId, 'prompt',
      link => link.prompt(payload.sessionId, payload.text).then(out))
  }

  @Remote
  sessionCancel(payload: { serverId: ServerId; sessionId: string }): Promise<{ accepted: true }> {
    return withLink(this.registry, payload.serverId, 'cancel',
      link => link.cancel(payload.sessionId).then(out))
  }

  @Remote
  sessionRename(payload: { serverId: ServerId; sessionId: string; title: string }):
    Promise<{ title: string; seq: number }> {
    return withLink(this.registry, payload.serverId, 'rename',
      link => link.rename(payload.sessionId, payload.title).then(out))
  }

  @Remote
  sessionFork(payload: { serverId: ServerId; sessionId: string; atSeq?: number }):
    Promise<{ sessionId: string }> {
    return withLink(this.registry, payload.serverId, 'fork',
      link => link.fork(payload.sessionId, payload.atSeq).then(out))
  }

  @Remote
  sessionCreate(payload: { serverId: ServerId; workspaceId?: string; cwd?: string; agentPreset?: string }):
    Promise<{ sessionId: string; agentPreset?: string }> {
    return withLink(this.registry, payload.serverId, 'create',
      link => link.create({
        ...(payload.workspaceId === undefined ? {} : { workspaceId: payload.workspaceId }),
        ...(payload.cwd === undefined ? {} : { cwd: payload.cwd }),
        ...(payload.agentPreset === undefined ? {} : { agentPreset: payload.agentPreset }),
      }).then(out))
  }

  @Remote
  sessionModels(payload: { serverId: ServerId; sessionId: string }): Promise<SessionModels> {
    return withLink(this.registry, payload.serverId, 'models',
      link => link.models(payload.sessionId).then(out))
  }

  @Remote
  sessionSelectModel(payload: {
    serverId: ServerId
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
    return withLink(this.registry, payload.serverId, 'selectModel',
      link => link.selectModel(payload.sessionId, {
        provider: payload.provider,
        model: payload.model,
        ...(payload.reasoningEffort === undefined ? {} : { reasoningEffort: payload.reasoningEffort }),
      }).then(out))
  }

  @Remote
  respond(payload: { serverId: ServerId; rpcId: string; value: unknown }): Promise<{ accepted: true }> {
    return withLink(this.registry, payload.serverId, 'respond',
      link => link.respond(payload.rpcId, payload.value).then(result => {
        if (result.ok) {
          if (result.value.accepted) return { ok: true as const, value: { accepted: true as const } }
          fail('not-pending', `remote rejected the response (${result.value.reason})`)
        }
        return result as ActionResult<{ accepted: true }>
      }).then(out))
  }

  /** Probe a candidate endpoint without adding it (used by the panel's Test button). */
  @Remote
  serversProbe(payload: { baseUrl: string }):
    Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    return import('./hub/server-link.ts').then(({ ServerLink }) => ServerLink.probe(payload.baseUrl).then(out))
  }
}

export type { HistoryEntry, SessionSummary, PendingRow }