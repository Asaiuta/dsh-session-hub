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
          { kind: 'method', name: 'serversList', signature: 'serversList(payload: {}): ServerView[]' },
          { kind: 'method', name: 'serversAdd', signature: 'serversAdd(payload: { name: string; baseUrl: string }): ServerView' },
          { kind: 'method', name: 'serversUpdate', signature: 'serversUpdate(payload: { id: ServerId; name?: string; baseUrl?: string }): ServerView' },
          { kind: 'method', name: 'serversRemove', signature: 'serversRemove(payload: { id: ServerId }): { removed: true }' },
          { kind: 'method', name: 'serversProbe', signature: 'serversProbe(payload: { baseUrl: string }): { ok: true; version: string } | { ok: false; error: string }' },
          { kind: 'method', name: 'snapshot', signature: 'snapshot(payload: {}): HubSnapshot' },
          { kind: 'method', name: 'sessionHistory', signature: 'sessionHistory(payload: { serverId: ServerId; sessionId: string; maxMessages?: number }): { events: HistoryEntry[]; hasMore: boolean }' },
          { kind: 'method', name: 'sessionPrompt', signature: 'sessionPrompt(payload: { serverId: ServerId; sessionId: string; text: string }): { accepted: true }' },
          { kind: 'method', name: 'sessionCancel', signature: 'sessionCancel(payload: { serverId: ServerId; sessionId: string }): { accepted: true }' },
          { kind: 'method', name: 'sessionRename', signature: 'sessionRename(payload: { serverId: ServerId; sessionId: string; title: string }): { title: string; seq: number }' },
          { kind: 'method', name: 'sessionFork', signature: 'sessionFork(payload: { serverId: ServerId; sessionId: string; atSeq?: number }): { sessionId: string }' },
          { kind: 'method', name: 'sessionCreate', signature: 'sessionCreate(payload: { serverId: ServerId; workspaceId?: string; cwd?: string; agentPreset?: string }): { sessionId: string; agentPreset?: string }' },
          { kind: 'method', name: 'sessionModels', signature: 'sessionModels(payload: { serverId: ServerId; sessionId: string }): SessionModels' },
          { kind: 'method', name: 'sessionSelectModel', signature: 'sessionSelectModel(payload: { serverId: ServerId; sessionId: string; provider: string; model: string; reasoningEffort?: string }): { selected: ModelSelection }' },
          { kind: 'method', name: 'respond', signature: 'respond(payload: { serverId: ServerId; rpcId: string; value: unknown }): { accepted: true }' },
          { kind: 'method', name: 'modelSync', signature: 'modelSync(payload: { serverId?: ServerId }): { synced: Array<{ serverId: string; updated: string[]; credentials: string[]; skipped: string[] }> }' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: SESSION_HUB_INVOCATIONS,
}