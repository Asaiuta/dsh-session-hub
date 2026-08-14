/**
 * dsh-session-hub host plugin: the multi-server session aggregation hub.
 *
 * Each configured remote `dsh web` deployment is reached through its public
 * `/api` protocol (the same surface the harness's own browser client and the
 * official mobile/desktop remote clients use): unary RPCs over HTTP,
 * mux/host event streams over WebSocket. The hub keeps per-server links
 * (reconnecting mux/host pumps, cached session list, pending interaction
 * table) and exposes one merged control plane to the browser via the
 * `sessionHub` Typert Remote namespace. The client half ships in the same
 * package (`./client`) and renders the merged panel.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
// Type-only: brings the `ctx.typert` Context merge into this program.
import type {} from '@deepseek-ai/dsh-typert-registry'
// Type-only: brings the `ctx.webServer` Context merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createHubEventsRoute } from './hub/events.ts'
import { GATEWAY_METHODS, HubGateway } from './hub/gateway.ts'
import { ModelSyncService } from './hub/model-sync.ts'
import { ImportStore } from './hub/importer.ts'
import { ServerRegistry } from './hub/registry.ts'
import { SessionHubRuntime } from './runtime.ts'
import { TYPERT_MANIFEST } from './typert.ts'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-session-hub'

/** Services required before load: the Typert registry and the HTTP carrier. */
// apiProxy in the inject list: cordis waits for the official ApiProxy
// service before applying this plugin, so the gateway always sees it.
export const inject = ['typert', 'webServer', 'apiProxy', 'sessions']

/** Deployment configuration. */
export interface Config {
  /**
   * Where the configured server list persists. Absent, it lives under the
   * harness home: $DSH_HOME/plugins/dsh-session-hub.json.
   */
  dataFile?: string
  /**
   * Non-loopback authorities this hub serves (same bare host[:port] format
   * as client-connection.trustedHosts). The hub gateway re-checks every
   * intercepted /api request against loopback + this list. Default: loopback
   * only (SSH-tunnel deployments need nothing here).
   */
  trustedHosts?: string[]
}

/**
 * Configuration schema: deployment-varying choices stay tunable from
 * cordis.yml. The inferred schema type keeps the callable form accepting
 * partial input, so `Config({})` yields the defaults.
 */
export const Config = z.object({
  // schemastery 3.x: fields are optional unless marked `.required()`.
  dataFile: z.string(),
  trustedHosts: z.array(z.string()),
})

/**
 * Mount the session hub service and its strict Typert manifest.
 * @param ctx - host cordis context.
 * @param config - validated plugin configuration (schema defaults applied).
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = Config(config ?? {})
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataFile = resolved.dataFile ?? join(dshHome, 'plugins', 'dsh-session-hub.json')

  const registry = new ServerRegistry(dataFile)
  const official = () => ctx.get('apiProxy') as import('@deepseek-ai/dsh-host-apiproxy').ApiProxy
  const modelSync = new ModelSyncService(official, registry, dshHome)

  // External-tool session importer (codex / claude / opencode): parsed logs
  // surface as read-only sessions in the official tree, matched into local
  // workspaces by their project directory. Importing is opt-in per tool from
  // Settings → Plugins → Session Hub; only sources the user also asked to
  // follow are re-scanned here (incremental, by mtime).
  const importsFile = join(dshHome, 'plugins', 'dsh-session-hub-imports.json')
  const importStore = new ImportStore(importsFile)
  new SessionHubRuntime(ctx, registry, modelSync, importStore)
  void importStore.load().then(() => {
    console.info(`[dsh-session-hub] imported ${importStore.sessions.size} external sessions`)
  }).catch((error: unknown) => {
    console.warn('[dsh-session-hub] importer load failed:', error)
  })
  ctx.effect(() => {
    const timer = setInterval(() => {
      const auto = importStore.autoSources()
      if (auto.length === 0) return
      void importStore.rescan(auto).catch(() => {})
    }, 60_000)
    return () => clearInterval(timer)
  }, 'dsh-session-hub: importer watcher')

  // Aggregation gateway: exact-path routes (exact beats the official /api
  // prefix route) re-check the browser-trust fence, then route session
  // methods by ownership — remote sessions to their ServerLink, everything
  // else to the official ApiProxy. This is what makes the unmodified
  // official Web UI open and control remote sessions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gateway = new HubGateway(
    official,
    registry,
    resolved.trustedHosts ?? [],
    importStore,
    // Read lazily and defensively: promotion is an optional capability, and a
    // deployment without a session store must still load the rest of the hub.
    () => {
      try {
        const store = (ctx as unknown as { sessions?: unknown }).sessions
        return typeof (store as { create?: unknown } | undefined)?.create === 'function'
          ? store as never
          : undefined
      } catch {
        return undefined
      }
    },
  )

  // Virtual-workspace live projection: the official client pulls workspace.list
  // only once per connection, so remote session drift (added/removed servers,
  // session create/delete/title) must reach the tree as synthetic host frames
  // over the same SSE bus the bridge consumes. A 1.5s diff watcher publishes
  // host/workspace-changed (full view) and host/workspace-removed deltas.
  ctx.effect(() => {
    let last = new Map<string, string>()
    const timer = setInterval(() => {
      const views = gateway.virtualWorkspaceViews()
      const current = new Map(views.map(view => [view.workspaceId, `${view.title}\u0001${view.sessionIds.join('\u0001')}`]))
      for (const view of views) {
        if (last.get(view.workspaceId) !== current.get(view.workspaceId)) {
          registry.events.publish(view.workspaceId as never, 'hub:workspace', {
            type: 'host/workspace-changed',
            workspace: view,
          })
        }
      }
      for (const id of last.keys()) {
        if (!current.has(id)) {
          registry.events.publish(id as never, 'hub:workspace', { type: 'host/workspace-removed', workspaceId: id })
        }
      }
      last = current
    }, 1500)
    return () => clearInterval(timer)
  }, 'dsh-session-hub: virtual workspace frame watcher')
    ctx.effect(() => {
      const disposers: (() => void)[] = []
      for (const method of GATEWAY_METHODS) {
        const route = {
          kind: 'exact' as const,
          path: `/api/${method}`,
          handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
            void gateway.handle(req, res, method)
          },
        }
        disposers.push(ctx.webServer.register(route as never))
      }
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-session-hub: /api gateway routes')

  // Strict endpoint registration: the gateway resolves sessionHub/<method>
  // from this manifest, independent of decorator marker state.
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-session-hub: typert manifest')

  // Live event SSE: browser clients stream remote mux/host frames here.
  ctx.effect(() => {
    const route = createHubEventsRoute(registry.events, registry.eventToken)
    return ctx.webServer.register(route)
  }, 'dsh-session-hub: /hub/events route')

  // Incremental model-config sync: every 3s, sync a server once right after
  // it reaches `connected` (and at most once per minute per server).
  ctx.effect(() => {
    const timer = setInterval(() => modelSync.autoTick(), 3000)
    return () => clearInterval(timer)
  }, 'dsh-session-hub: model sync watcher')

  // Registry teardown follows the owning fiber.
  ctx.effect(() => () => { registry.dispose() }, 'dsh-session-hub: registry')
}