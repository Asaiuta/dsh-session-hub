/**
 * The callable face of the `sessionHub` Remote namespace as the panel sees
 * it. One definition shared by the components (face.ts), the Typert client
 * contribution (remote.ts), and the mount code in index.ts.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HistoryEntry } from '../contract.ts'
import type { HubSnapshot, ServerId, ServerView } from '../contract.ts'

export type ProbeOutcome = { ok: true; version: string } | { ok: false; error: string }

export interface SessionHubNamespaceFace {
  serversList(payload: Record<string, never>): Promise<RemoteResult<ServerView[]>>
  serversAdd(payload: { name: string; baseUrl: string }): Promise<RemoteResult<ServerView>>
  serversUpdate(payload: { id: ServerId; name?: string; baseUrl?: string }): Promise<RemoteResult<ServerView>>
  serversRemove(payload: { id: ServerId }): Promise<RemoteResult<{ removed: true }>>
  serversProbe(payload: { baseUrl: string }): Promise<RemoteResult<ProbeOutcome>>
  snapshot(payload: Record<string, never>): Promise<RemoteResult<HubSnapshot>>
  sessionHistory(payload: { serverId: ServerId; sessionId: string; maxMessages?: number }):
    Promise<RemoteResult<{ events: HistoryEntry[]; hasMore: boolean }>>
  sessionPrompt(payload: { serverId: ServerId; sessionId: string; text: string }): Promise<RemoteResult<{ accepted: true }>>
  sessionCancel(payload: { serverId: ServerId; sessionId: string }): Promise<RemoteResult<{ accepted: true }>>
  sessionRename(payload: { serverId: ServerId; sessionId: string; title: string }): Promise<RemoteResult<{ title: string; seq: number }>>
  sessionFork(payload: { serverId: ServerId; sessionId: string; atSeq?: number }): Promise<RemoteResult<{ sessionId: string }>>
  sessionCreate(payload: { serverId: ServerId; workspaceId?: string; cwd?: string; agentPreset?: string }):
    Promise<RemoteResult<{ sessionId: string; agentPreset?: string }>>
  sessionModels(payload: { serverId: ServerId; sessionId: string }): Promise<RemoteResult<unknown>>
  sessionSelectModel(payload: {
    serverId: ServerId
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<RemoteResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>
  respond(payload: { serverId: ServerId; rpcId: string; value: unknown }): Promise<RemoteResult<{ accepted: true }>>
}

export type { RemoteResult, HistoryEntry }