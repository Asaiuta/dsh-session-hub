/**
 * Typecheck stubs for @deepseek-ai/dsh-host-apiproxy — the subset of the
 * real apiproxy contract dsh-session-hub uses, copied from the harness
 * source (packages/host/apiproxy). The domain payload types are kept loose
 * where the plugin only passes them through.
 */
import type { ZodType } from 'zod'

// ---- rpc layer ----

export type RpcId = string & { readonly __rpcId: unique symbol }
export function RpcId(id: string): RpcId {
  return id as RpcId
}

export interface RpcError {
  readonly code: string
  readonly message: string
  readonly details: object
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

export function transportError<R>(error: unknown): RpcResult<R> {
  return {
    ok: false,
    error: {
      code: 'transport',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

export interface RpcRequest<P> {
  readonly rpcId: RpcId
  readonly payload: P
}

export interface RpcResponse<T> {
  readonly type: 'server-response'
  readonly rpcId: RpcId
  readonly result: RpcResult<T>
}

export interface ClientRequest {
  readonly type: 'client-request'
  readonly rpcId: RpcId
  readonly method: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly payload: any
}

export type ClientResponse = {
  readonly type: 'client-response'
  readonly rpcId: RpcId
  readonly result: RpcResult<unknown>
}

export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }

/** Full server→client wire envelope (mux/host frames after parse). */
export interface ServerRequest {
  readonly rpcId: RpcId
  readonly payload: unknown
}

/** Server→client response envelope. */
export interface ServerResponse {
  readonly rpcId: RpcId
  readonly result: RpcResult<unknown>
}

export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse

// ---- domains ----

export interface SessionSummary {
  readonly sessionId: string
  readonly title?: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank?: boolean
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly agentPreset?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any
}

export interface HistoryEntry {
  readonly seq: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly event: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly view?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SessionModels extends Record<string, any> {}

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export type PromptContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

// ---- streams ----

export interface QueuedInboxItem {
  readonly id: string
  readonly placement: 'queued' | 'steering' | 'context'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly message: any
}

export interface ApprovalResponsePayload {
  readonly approvalId: string
  readonly sessionId: string
  readonly outcome: 'approved' | 'rejected'
}

export interface QuestionResponsePayload {
  readonly sessionId: string
  readonly answer: { answers: { id: string; selected: string[] }[] }
}

export type MuxFrame =
  | { type: 'session/event'; sessionId: string; event: { type: string; [key: string]: unknown } }
  | { type: 'session/subscribed'; sessionId: string; lastSeq: number }
  | { type: 'approval/requested'; sessionId: string; approvalId: string; toolName: string; callId?: string; reason?: string }
  | { type: 'approval/resolved'; sessionId: string; approvalId: string; outcome: unknown }
  | { type: 'question/requested'; sessionId: string; questions: { id: string; prompt: string; options?: { id: string; label: string }[]; multiSelect?: boolean; detail?: unknown; intent?: unknown }[] }
  | { type: 'question/resolved'; sessionId: string; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  | { type: 'session/queue'; sessionId: string; items: QueuedInboxItem[] }
  | { type: 'session/jobs'; sessionId: string; jobs: unknown[] }
  | { type: 'session/projection'; sessionId: string; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError }

export type HostFrame =
  | { type: 'host/session-added'; sessionId: string }
  | { type: 'host/session-removed'; sessionId: string }
  | { type: 'host/session-status'; sessionId: string; running: boolean }
  | { type: 'host/agent-error'; sessionId: string; error: RpcError }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'host/workspace-order-changed'; workspaceIds: string[] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: string[] }
  | { type: 'host/remote-event'; event: string; args: unknown[] }

/** One workspace row (wire projection; the hub synthesizes views for servers). */
export interface WorkspaceView {
  workspaceId: string
  /** Canonical directory path (virtual views carry a dsh-hub:// origin). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
  /** Sessions accounted under this workspace, in owned order. */
  sessionIds: string[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

// ---- sessions / host / events api (IApiClient surface: payload-direct) ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnaryResult = Promise<RpcResponse<any>>

export interface SessionsApi {
  list(payload: { cursor?: string }, signal?: AbortSignal): UnaryResult
  search(payload: { query: string }, signal?: AbortSignal): UnaryResult
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }, signal?: AbortSignal):
    Promise<RpcResponse<{ sessionId: string; agentPreset?: string }>>
  history(payload: { sessionId: string; beforeSeq?: number; maxMessages?: number }, signal?: AbortSignal):
    Promise<RpcResponse<{ events: HistoryEntry[]; hasMore: boolean }>>
  models(payload: { sessionId: string }, signal?: AbortSignal): Promise<RpcResponse<SessionModels>>
  selectModel(payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal):
    Promise<RpcResponse<{ selected: ModelSelection }>>
  rename(payload: { sessionId: string; title: string }, signal?: AbortSignal):
    Promise<RpcResponse<{ title: string; seq: number }>>
  fork(payload: { sessionId: string; atSeq?: number }, signal?: AbortSignal): Promise<RpcResponse<{ sessionId: string }>>
  prompt(payload: { sessionId: string; mode: 'queue' | 'steer'; content: PromptContentPart[]; clientTimeZone?: string }, signal?: AbortSignal):
    Promise<RpcResponse<{ accepted: true; command?: { kind: 'success'; text?: string } }>>
  attachment(payload: { sessionId: string; attachmentId: string }, signal?: AbortSignal): UnaryResult
  updateQueue(payload: { sessionId: string; itemId: string; action: unknown }, signal?: AbortSignal): UnaryResult
  cancel(payload: { sessionId: string }, signal?: AbortSignal): Promise<RpcResponse<{ accepted: true }>>
}

export interface HostApi {
  describe(payload: Record<string, never>, signal?: AbortSignal): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }>>
  pickDirectory(payload: Record<string, never>, signal?: AbortSignal): UnaryResult
  listDirectory(payload: Record<string, never>, signal?: AbortSignal): UnaryResult
  createDirectory(payload: Record<string, never>, signal?: AbortSignal): UnaryResult
  openPath(payload: Record<string, never>, signal?: AbortSignal): UnaryResult
}

export interface EventsApi {
  mux(payload: Record<string, never>, signal?: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>
  host(payload: Record<string, never>, signal?: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>
}

/** Client consumption face: unary methods take the business payload directly. */
export interface IApiClient {
  readonly sessions: SessionsApi
  readonly host: HostApi
  readonly events: EventsApi
  respond(message: ClientResponse): Promise<RpcReceipt>
}

export interface ApiProxy {
  readonly sessions: SessionsApi
  readonly host: HostApi
  readonly events: EventsApi
  readonly respond: (message: ClientResponse) => Promise<RpcReceipt>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [domain: string]: any
}

// ---- carrier base ----

export abstract class AbstractApiClient implements IApiClient {
  protected constructor(protected readonly timeoutMs?: number) {}
  protected abstract doFetch(input: URL, init?: RequestInit): Promise<Response>
  protected resolveBase(): string { return 'http://harness.internal' }
  protected onEnvelope(_message: RpcMessage): void {}
  protected openMux(
    _payload: Record<string, never>,
    _signal: AbortSignal,
    _onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> { throw new Error('abstract') }
  protected openHost(
    _payload: Record<string, never>,
    _signal: AbortSignal,
    _onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> { throw new Error('abstract') }
  readonly sessions!: SessionsApi
  readonly host!: HostApi
  readonly events!: EventsApi
  respond!: (message: ClientResponse) => Promise<RpcReceipt>
}