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
import type { HubSnapshot, ImportSourceStatusView, PendingRow, ServerId, ServerView } from './contract.ts'
import { ServerRegistry } from './hub/registry.ts'
import type { ActionResult } from './hub/server-link.ts'
import type { ModelSyncService } from './hub/model-sync.ts'
import { IMPORT_SOURCES, type ImportSource, type ImportStore } from './hub/importer.ts'

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
    private readonly imports?: ImportStore,
  ) {
    super(ctx, 'sessionHub')
  }

  // ---- External-session import ----

  /** Per-source import state for the settings tab. */
  @Remote
  importStatus(_payload: Record<string, never>): { sources: ImportSourceStatusView[] } {
    if (this.imports === undefined) fail('not-configured', 'importer unavailable')
    return out({ sources: this.imports.sourceStatus() })
  }

  /**
   * Import, remove or re-configure one source tool, answering with the
   * refreshed state so the caller never has to guess what took effect.
   *
   * A scan runs only for `import`: reading hundreds of logs is the user's
   * explicit request, not a side effect of toggling a checkbox.
   */
  @Remote
  async importAction(payload: {
    source: string
    action: 'import' | 'remove' | 'auto'
    auto?: boolean
  }): Promise<{ sources: ImportSourceStatusView[] }> {
    if (this.imports === undefined) fail('not-configured', 'importer unavailable')
    if (!IMPORT_SOURCES.includes(payload.source as ImportSource)) {
      fail('unknown-source', `unknown import source: ${payload.source}`)
    }
    const source = payload.source as ImportSource
    if (payload.action === 'import') await this.imports.importSource(source, payload.auto ?? true)
    else if (payload.action === 'remove') await this.imports.removeSource(source)
    else await this.imports.setAuto(source, payload.auto ?? false)
    return out({ sources: this.imports.sourceStatus() })
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
  async serversAdd(payload: {
    name: string
    baseUrl?: string
    ssh?: {
      host: string; port?: number; username: string
      privateKeyPath?: string; passphrase?: string; remotePort?: number
    }
  }): Promise<ServerView> {
    try {
      const view = payload.ssh === undefined
        ? await this.registry.add(payload.name, payload.baseUrl ?? '')
        : await this.registry.addSsh(payload.name, payload.ssh)
      return out(view)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Tunnel failures are configuration problems the user can act on, so
      // they get their own code rather than riding the self-loop one.
      return fail(message.startsWith('tunnel:') ? 'tunnel' : 'self-loop', message)
    }
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

  /** Probe a candidate endpoint without adding it (used by the panel's Test button). */
  @Remote
  async serversProbe(payload: {
    baseUrl?: string
    ssh?: {
      host: string; port?: number; username: string
      privateKeyPath?: string; passphrase?: string; remotePort?: number
    }
  }): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const { ServerLink } = await import('./hub/server-link.ts')
    if (payload.ssh === undefined) {
      return out(await ServerLink.probe(payload.baseUrl ?? ''))
    }
    // Probing a tunnelled target means standing the tunnel up, asking once,
    // and tearing it down — the entry is not created yet.
    const { probeTunnel } = await import('./hub/tunnel.ts')
    const opened = await probeTunnel(payload.ssh)
    if (!opened.ok) return out({ ok: false as const, error: opened.error })
    try {
      return out(await ServerLink.probe(opened.baseUrl))
    } finally {
      opened.close()
    }
  }
}

export type { HistoryEntry, SessionSummary, PendingRow }