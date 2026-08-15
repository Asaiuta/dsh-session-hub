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
  /**
   * Which halves of the plugin actually run. Everything is on by default —
   * this exists so a deployment that only wants one of them does not pay for
   * the rest: a disabled feature is never constructed, never scans, never
   * registers a route, and never shows up in the settings tab.
   */
  features?: {
    /** Merge remote servers into the official tree (the gateway). */
    aggregate?: boolean
    /** Open and supervise SSH tunnels for server entries. */
    tunnel?: boolean
    /** Push local llm-* settings to connected servers. */
    modelSync?: boolean
    /** Surface Codex / Claude Code / opencode logs as sessions. */
    importer?: boolean
  }
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
  features: z.object({
    aggregate: z.boolean().default(true),
    tunnel: z.boolean().default(true),
    modelSync: z.boolean().default(true),
    importer: z.boolean().default(true),
  }).default({}),
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

  const features = resolved.features ?? {}
  const useAggregate = features.aggregate !== false
  const useTunnel = features.tunnel !== false
  const useModelSync = features.modelSync !== false
  const useImporter = features.importer !== false

  const registry = new ServerRegistry(dataFile, { tunnels: useTunnel })
  registry.features = {
    aggregate: useAggregate, tunnel: useTunnel, modelSync: useModelSync, importer: useImporter,
  }
  const official = () => ctx.get('apiProxy') as import('@deepseek-ai/dsh-host-apiproxy').ApiProxy
  const modelSync = useModelSync ? new ModelSyncService(official, registry, dshHome) : undefined

  // External-tool session importer (codex / claude / opencode): parsed logs
  // surface as read-only sessions in the official tree, matched into local
  // workspaces by their project directory. Importing is opt-in per tool from
  // Settings → Plugins → Session Hub; only sources the user also asked to
  // follow are re-scanned here (incremental, by mtime).
  const importsFile = join(dshHome, 'plugins', 'dsh-session-hub-imports.json')
  // Disabled means absent, not idle: no store, so nothing reads the cache
  // file, nothing walks a log directory, and the merge paths in the gateway
  // take their already-existing "no importer" branch.
  const importStore = useImporter ? new ImportStore(importsFile) : undefined
  new SessionHubRuntime(ctx, registry, modelSync, importStore)
  if (importStore !== undefined) {
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
  }

  // Aggregation gateway: exact-path routes (exact beats the official /api
  // prefix route) re-check the browser-trust fence, then route session
  // methods by ownership — remote sessions to their ServerLink, everything
  // else to the official ApiProxy. This is what makes the unmodified
  // official Web UI open and control remote sessions.
  //
  // Both halves of the plugin want it, for different reasons: aggregation
  // needs it to reach remote servers, and the importer needs it to put
  // imported sessions in the tree. It is skipped only when neither is on,
  // in which case the plugin registers no /api routes at all.
  const gateway = (useAggregate || useImporter)
    ? new HubGateway(
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
    : undefined

  if (gateway !== undefined) {
    ctx.effect(() => {
      const disposers: (() => void)[] = []
      const release = (): void => { for (const dispose of disposers) dispose() }
      try {
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
      } catch (error: unknown) {
        // Another plugin already owns one of these paths: the web server
        // refuses a duplicate exact route on purpose. Give back the ones we
        // did take — a half-installed gateway would answer some session
        // methods and not others, which breaks the harness worse than not
        // loading at all.
        //
        // Then stop, rather than throw. An exception here fails the whole
        // loader entry, which fails the plugin tree, which leaves the user
        // with no dsh at all — a route collision between two plugins must
        // not take the harness down. The rest of this plugin keeps working;
        // only the halves that need the gateway go quiet, and the log says
        // exactly which route and how to configure around it.
        release()
        const detail = error instanceof Error ? error.message : String(error)
        console.error(
          `[dsh-session-hub] gateway DISABLED — ${detail}. Another plugin intercepts the same route, `
          + 'so remote servers and imported sessions will not appear. Set features.aggregate and '
          + 'features.importer to false to silence this, or remove the conflicting plugin.',
        )
      }
      return release
    }, 'dsh-session-hub: /api gateway routes')
  }

  // Virtual-workspace live projection: the official client pulls workspace.list
  // only once per connection, so remote session drift (added/removed servers,
  // session create/delete/title) must reach the tree as synthetic host frames
  // over the same SSE bus the bridge consumes. A 1.5s diff watcher publishes
  // host/workspace-changed (full view) and host/workspace-removed deltas.
  // Only aggregation mints virtual groups, so this watcher follows it.
  if (useAggregate && gateway !== undefined) {
    ctx.effect(() => {
      let last = new Map<string, string>()
      const timer = setInterval(() => {
        const views = gateway.virtualWorkspaceViews()
        const current = new Map(views.map(view => [view.workspaceId, `${view.title}${view.sessionIds.join('')}`]))
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
  }

  // Strict endpoint registration: the gateway resolves sessionHub/<method>
  // from this manifest, independent of decorator marker state.
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-session-hub: typert manifest')

  // Live event SSE: browser clients stream remote mux/host frames here.
  ctx.effect(() => {
    const route = createHubEventsRoute(registry.events, registry.eventToken)
    try {
      return ctx.webServer.register(route)
    } catch (error: unknown) {
      // Same rule as the gateway routes: losing a path to another plugin
      // costs this plugin its live stream, not the user their harness.
      // Sessions still open and send; they fall back to polling.
      console.error(
        `[dsh-session-hub] live stream DISABLED — ${error instanceof Error ? error.message : String(error)}. `
        + 'Remote sessions still work, but updates arrive on refresh instead of live.',
      )
      return () => {}
    }
  }, 'dsh-session-hub: /hub/events route')

  // Incremental model-config sync: every 3s, sync a server once right after
  // it reaches `connected` (and at most once per minute per server).
  if (modelSync !== undefined) {
    ctx.effect(() => {
      const timer = setInterval(() => modelSync.autoTick(), 3000)
      return () => clearInterval(timer)
    }, 'dsh-session-hub: model sync watcher')
  }

  // Registry teardown follows the owning fiber.
  ctx.effect(() => () => { registry.dispose() }, 'dsh-session-hub: registry')
}