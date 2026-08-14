/**
 * The hand-written host Typert manifest for the sessionHub Remote.
 * Registered through `ctx.typert.register` in the plugin body, it claims the
 * wire endpoints through the strict registry so the Host Gateway resolves and
 * invokes `sessionHub/<method>` without consulting the `@Remote` marker
 * table (marker independence matters when the harness source-launch gateway
 * and a profile-loaded plugin bundle hold separate decorator module state).
 */
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { SESSION_HUB_INVOCATIONS } from './contract.ts'

/** The sessionHub namespace's host manifest (strict codecs shared with the client). */
export const TYPERT_MANIFEST: TypertContribution = {
  package: 'dsh-session-hub',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'sessionHub',
        exportName: 'SessionHubRuntime',
        description: 'Aggregated multi-server session control: server registry, merged session snapshot, per-session history/actions, and approval/question answering.',
        tags: [],
        members: [
          { kind: 'method', name: 'serversAdd', signature: 'serversAdd(payload: { name: string; baseUrl?: string; ssh?: { host: string; port?: number; username: string; privateKeyPath?: string; passphrase?: string; remotePort?: number } }): ServerView' },
          { kind: 'method', name: 'serversRemove', signature: 'serversRemove(payload: { id: ServerId }): { removed: true }' },
          { kind: 'method', name: 'serversProbe', signature: 'serversProbe(payload: { baseUrl?: string; ssh?: { host: string; port?: number; username: string; privateKeyPath?: string; passphrase?: string; remotePort?: number } }): { ok: true; version: string } | { ok: false; error: string }' },
          { kind: 'method', name: 'snapshot', signature: 'snapshot(payload: {}): HubSnapshot' },
          { kind: 'method', name: 'modelSync', signature: 'modelSync(payload: { serverId?: ServerId }): { synced: Array<{ serverId: string; updated: string[]; credentials: string[]; skipped: string[] }> }' },
          { kind: 'method', name: 'importStatus', signature: 'importStatus(payload: Record<string, never>): { sources: ImportSourceStatusView[] }' },
          { kind: 'method', name: 'importAction', signature: 'importAction(payload: { source: string; action: string; auto?: boolean }): { sources: ImportSourceStatusView[] }' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: SESSION_HUB_INVOCATIONS,
}