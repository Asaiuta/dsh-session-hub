/**
 * dsh-session-hub client plugin: the browser half of the multi-server
 * session hub. It mounts the `sessionHub` Remote namespace, relays the hub
 * SSE frame stream into the *official* sessions runtime (so remote sessions
 * appear in the official workspace tree and open in the official
 * conversation pane — no UI replacement), and adds one sidebar footer block
 * for server management.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slot registry Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionHubNamespaceFace } from './face.ts'
import { SESSION_HUB_REMOTE } from './remote.ts'
import { NS, en, zh, type HubKey } from './locales.ts'
import { adoptStyles } from './styles.ts'
import { ServerSection } from './section.tsx'
import { sessionsOf, startOfficialBridge } from './bridge.ts'
import { ensureHubLive, subscribeFrames, subscribeLiveChanges } from './live.ts'
import type { HubSnapshot } from '../contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-session-hub section copy. */
    sessionHub: HubKey
  }
}

/** Required services: slots, the gateway Remote face, locale, and the
 * official sessions runtime (frames are injected into it). */
export const inject = ['slots', 'remote', 'locale', 'sessions']

/**
 * Install the bridge + server-management footer block.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  adoptStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-hub: dictionaries')

  let hub: SessionHubNamespaceFace | undefined
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(SESSION_HUB_REMOTE)
    hub = (ctx.reflect as unknown as { get(name: string): unknown })
      .get('remote.sessionHub') as SessionHubNamespaceFace | undefined
    if (hub === undefined) {
      throw new Error('dsh-session-hub: the sessionHub Remote namespace did not mount')
    }
    return () => {
      hub = undefined
      void dispose()
    }
  }, 'dsh-session-hub: remote')

  // Bridge: relay hub SSE frames into the official sessions runtime so the
  // official UI renders remote sessions natively.
  ctx.effect(() => {
    const sessions = sessionsOf(ctx)
    const offFrames = startOfficialBridge(sessions)
    // Keep the SSE stream alive and token-rotated even with no section open:
    // once any hub server exists, its frames must reach the official UI.
    let timer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (hub === undefined || cancelled) return
      try {
        const result = await hub.snapshot({})
        if (result.ok) {
          ensureHubLive(result.value.eventToken)
        }
      } catch {
        // the interval will retry
      }
    }
    void tick()
    pollTimer = setInterval(() => { void tick() }, 3000)
    // Frame reception also debounces a token refresh (host restarts rotate
    // the token; the snapshot poll catches it, this makes it snappier).
    const offChanges = subscribeLiveChanges(() => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void tick()
      }, 250)
    })
    return () => {
      cancelled = true
      offFrames()
      offChanges()
      if (timer !== undefined) clearTimeout(timer)
      if (pollTimer !== undefined) clearInterval(pollTimer)
    }
  }, 'dsh-session-hub: official-sessions bridge')

  // Sidebar footer block: server management (the official tree/conversation
  // are untouched; remote sessions appear there through /api and the bridge).
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-session-hub',
    locale: NS,
    inject: (): { hub: () => SessionHubNamespaceFace | undefined } => ({
      hub: () => hub,
    }),
  }, ServerSection))
}

// Type-only re-export used by the fold spec in older docs; kept for the
// bundle's public surface (HubSnapshot type referenced above).
export type { HubSnapshot }