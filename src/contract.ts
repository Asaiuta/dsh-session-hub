/**
 * The dsh-session-hub wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in typert.ts) and the client contribution
 * (`ctx.remote.$mount` in client/remote.ts). One `sessionHub` namespace
 * exposes the merged multi-server control plane: server registry, aggregated
 * session snapshot, per-session history/actions, and approval/question
 * answering. Domain-heavy values (SessionSummary, HistoryEntry, SessionModels)
 * ride through passthrough codecs — the hub caches host-returned objects
 * verbatim and the browser renders them generically, so the wire schema only
 * pins the fields the plugin itself reads.
 */
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { HistoryEntry, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy'

// ---- Domain types (shared between host hub and browser panel) ----

/** Branded stable id of one configured remote server. */
export type ServerId = string & { readonly __serverId: unique symbol }

/** Wire state of one remote link. */
export const serverStateSchema = z.enum(['connecting', 'connected', 'error', 'stopped'])
export type ServerState = z.infer<typeof serverStateSchema>

/** One configured remote server plus its live link facts. */
export interface SshTargetView {
  readonly host: string
  readonly port?: number
  readonly username: string
  readonly privateKeyPath?: string
  readonly remotePort?: number
}

export interface ServerView {
  readonly id: ServerId
  /** Display name chosen by the user. */
  readonly name: string
  /** HTTP(S) origin of the remote `dsh web` deployment, no trailing slash. */
  readonly baseUrl: string
  readonly state: ServerState
  /** describe() facts of the last successful handshake; absent before first connect. */
  readonly host?: {
    readonly version: string
    readonly cwd: string
    readonly provider?: string
    readonly model?: string
    readonly attachedSessions: number
    readonly canOpenPath: boolean
  }
  /** Human-readable failure reason from the last failed generation. */
  readonly lastError?: string
  /**
   * Tunnel state for ssh-backed entries. Present only when the hub manages
   * the forward itself, and worth surfacing separately: a tunnel that is
   * down explains a dead link far better than the link's own timeout does.
   */
  readonly tunnel?: {
    readonly state: string
    readonly localPort?: number
    readonly error?: string
    readonly target: SshTargetView
  }
}

/** One merged row: a session on a specific remote server. */
export interface RemoteSessionRow {
  readonly serverId: ServerId
  /** Host-owned session id (unique per server; the pair is the hub key). */
  readonly sessionId: string
  readonly summary: SessionSummary
}

/** One outstanding answerable interaction relayed from a remote mux stream. */
export interface PendingApprovalView {
  readonly approvalId: string
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
}
export interface PendingQuestionView {
  readonly questions: readonly {
    readonly id: string
    readonly prompt: string
    readonly options?: readonly { readonly id: string; readonly label: string }[]
    readonly multiSelect?: boolean
  }[]
}
export interface PendingRow {
  readonly serverId: ServerId
  /** The remote mux frame's rpcId — must echo in the respond call. */
  readonly rpcId: string
  readonly sessionId: string
  readonly kind: 'approval' | 'question'
  readonly approval?: PendingApprovalView
  readonly question?: PendingQuestionView
}

/** Full panel snapshot: everything the browser needs in one round trip. */
export interface HubSnapshot {
  /** Stable identity of this hub instance (changes on host restart). */
  readonly hubId: string
  /** Random SSE credential for `/hub/events` (changes on host restart). */
  readonly eventToken: string
  readonly servers: readonly ServerView[]
  readonly sessions: readonly RemoteSessionRow[]
  readonly pending: readonly PendingRow[]
}

// ---- Wire codecs ----

const serverIdSchema = z.string().min(1) as unknown as z.ZodType<ServerId>

const hostFactsSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number(),
  canOpenPath: z.boolean(),
}).passthrough()

const serverViewSchema = z.object({
  id: serverIdSchema,
  name: z.string(),
  baseUrl: z.string(),
  state: serverStateSchema,
  host: hostFactsSchema.optional(),
  lastError: z.string().optional(),
}).passthrough()

/** Host-owned SessionSummary rides through untouched; only fields the hub reads are pinned. */
const sessionSummarySchema = z.object({
  sessionId: z.string(),
  title: z.string().optional(),
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean().optional(),
  parentSessionId: z.string().optional(),
  cwd: z.string().optional(),
  agentPreset: z.string().optional(),
}).passthrough()

const remoteSessionRowSchema = z.object({
  serverId: serverIdSchema,
  sessionId: z.string(),
  summary: sessionSummarySchema,
}).passthrough()

const pendingApprovalViewSchema = z.object({
  approvalId: z.string(),
  toolName: z.string(),
  callId: z.string().optional(),
  reason: z.string().optional(),
}).passthrough()

const pendingQuestionViewSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    prompt: z.string(),
    options: z.array(z.object({
      id: z.string(),
      label: z.string(),
    })).optional(),
    multiSelect: z.boolean().optional(),
  }).passthrough()),
}).passthrough()

const pendingRowSchema = z.object({
  serverId: serverIdSchema,
  rpcId: z.string(),
  sessionId: z.string(),
  kind: z.enum(['approval', 'question']),
  approval: pendingApprovalViewSchema.optional(),
  question: pendingQuestionViewSchema.optional(),
}).passthrough()

const hubSnapshotSchema = z.object({
  hubId: z.string(),
  eventToken: z.string(),
  servers: z.array(serverViewSchema),
  sessions: z.array(remoteSessionRowSchema),
  pending: z.array(pendingRowSchema),
}).passthrough()

/** An SSH local-forward target; the hub opens and supervises the tunnel. */
const sshTargetSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().optional(),
  username: z.string().min(1),
  privateKeyPath: z.string().optional(),
  passphrase: z.string().optional(),
  remotePort: z.number().int().optional(),
}).passthrough()

/** Either a direct URL or an ssh target — the UI offers one or the other. */
const serverAddPayloadSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().optional(),
  ssh: sshTargetSchema.optional(),
}).passthrough()


const serverIdPayloadSchema = z.object({ id: serverIdSchema }).passthrough()







const modelSyncPayloadSchema = z.object({
  serverId: serverIdSchema.optional(),
}).passthrough()

const modelSyncEntrySchema = z.object({
  serverId: serverIdSchema,
  updated: z.array(z.string()),
  credentials: z.array(z.string()),
  skipped: z.array(z.string()),
}).passthrough()

const modelSyncResultSchema = z.object({
  synced: z.array(modelSyncEntrySchema),
}).passthrough()

/** One external source tool as the settings tab presents it. */
export interface ImportSourceStatusView {
  source: string
  path: string
  available: boolean
  imported: boolean
  auto: boolean
  count: number
  scannedAt?: number
}

const importStatusEntrySchema = z.object({
  source: z.string(),
  path: z.string(),
  available: z.boolean(),
  imported: z.boolean(),
  auto: z.boolean(),
  count: z.number(),
  scannedAt: z.number().optional(),
}).passthrough()

const importStatusResultSchema = z.object({
  sources: z.array(importStatusEntrySchema),
}).passthrough()

const emptyPayloadSchema = z.object({}).passthrough()

/**
 * Import action: `import` reads the source's logs (and sets whether its new
 * ones are followed), `remove` drops them, `auto` only toggles following.
 */
const importActionPayloadSchema = z.object({
  source: z.string().min(1),
  action: z.enum(['import', 'remove', 'auto']),
  auto: z.boolean().optional(),
}).passthrough()



const probePayloadSchema = z.object({
  baseUrl: z.string().optional(),
  ssh: sshTargetSchema.optional(),
}).passthrough()

const probeResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), version: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

const removedResultSchema = z.object({ removed: z.literal(true) }).passthrough()

function codec(typeSymbol: string, schema: z.ZodType): InvocationDescriptor['parameters'][number]['codec'] {
  return { mode: 'strict', typeSymbol, schema }
}

function param(schema: z.ZodType, typeSymbol: string): InvocationDescriptor['parameters'] {
  return [{
    name: 'payload',
    wire: 'payload',
    source: 'json',
    codec: codec(typeSymbol, schema),
  }]
}

function descriptor(
  method: string,
  payloadSchema: z.ZodType,
  payloadTypeSymbol: string,
  resultSchema: z.ZodType,
  resultTypeSymbol: string,
): InvocationDescriptor {
  return {
    id: `dsh-session-hub#sessionHub/${method}`,
    service: 'sessionHub',
    namespace: 'sessionHub',
    method,
    invocation: { kind: 'direct' },
    parameters: param(payloadSchema, payloadTypeSymbol),
    result: { mode: 'strict', typeSymbol: resultTypeSymbol, schema: resultSchema },
  }
}

/** The sessionHub namespace's strict invocation descriptors (host manifest + client mount share this). */
export const SESSION_HUB_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('serversAdd', serverAddPayloadSchema, 'dsh-session-hub#ServerAddPayload', serverViewSchema, 'dsh-session-hub#ServerView'),
  descriptor('serversRemove', serverIdPayloadSchema, 'dsh-session-hub#ServerIdPayload', removedResultSchema, 'dsh-session-hub#RemovedResult'),
  descriptor('snapshot', z.object({}), 'dsh-session-hub#Empty', hubSnapshotSchema, 'dsh-session-hub#HubSnapshot'),
  descriptor('modelSync', modelSyncPayloadSchema, 'dsh-session-hub#ModelSyncPayload', modelSyncResultSchema, 'dsh-session-hub#ModelSyncResult'),
  descriptor('importStatus', emptyPayloadSchema, 'dsh-session-hub#EmptyPayload', importStatusResultSchema, 'dsh-session-hub#ImportStatusResult'),
  descriptor('importAction', importActionPayloadSchema, 'dsh-session-hub#ImportActionPayload', importStatusResultSchema, 'dsh-session-hub#ImportStatusResult'),
  descriptor('serversProbe', probePayloadSchema, 'dsh-session-hub#ProbePayload', probeResultSchema, 'dsh-session-hub#ProbeResult'),
]

// ---- Renderer helpers shared by the browser panel ----

/** Extract plain text from a dsh-llm ContentBlock for simple message rendering. */
export function blockText(block: unknown): string {
  if (typeof block !== 'object' || block === null) return ''
  const b = block as { type?: unknown; text?: unknown }
  if (b.type === 'text' && typeof b.text === 'string') return b.text
  return ''
}

/** Best-effort text of a message event's content list (unknown shapes degrade to ''). */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(blockText).filter(Boolean).join('\n')
  }
  return ''
}

export type { SessionModels, SessionSummary, HistoryEntry }
