/**
 * One configured remote server: a RemoteApiClient with reconnecting mux/host
 * pumps, a cached session summary list, and the pending interaction table
 * mirrored from the remote mux stream. All caches are in-memory snapshots the
 * browser reads through the hub snapshot endpoint (no per-client sockets).
 */
import type {
  ClientResponse, HostFrame, MuxFrame, RpcError, RpcReceipt, RpcRequest, RpcResult,
  SessionModels, SessionSummary,
} from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { HistoryEntry, PendingRow, ServerId, ServerState, ServerView } from '../contract.ts'
import { RemoteApiClient } from './remote-api.ts'

/** Callback fired whenever any cached fact changed (link-level dirty signal). */
export type LinkListener = () => void

/** Callback fired for every raw mux/host frame the link receives. */
export type FrameListener = (rpcId: string, frame: MuxFrame | HostFrame) => void

const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 10_000
/** Coalesce host/mux-driven session refresh bursts (streaming chunk storms included). */
const LIST_DEBOUNCE_MS = 400

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Business outcome of one hub action — RpcResult semantics without transport noise. */
export type ActionResult<T> = RpcResult<T>

export class ServerLink {
  readonly api: RemoteApiClient
  private readonly abort = new AbortController()
  private state: ServerState = 'connecting'
  private lastError: string | undefined
  private hostFacts: ServerView['host']
  private summaries: SessionSummary[] = []
  private archivedIds: string[] = []
  private archivedLoaded = false
  private readonly pendingMap = new Map<string, PendingRow>()
  private generation = 0
  private listTimer: ReturnType<typeof setTimeout> | undefined
  private running = false

  constructor(
    readonly id: ServerId,
    readonly baseUrl: string,
    private name: string,
    private readonly notify: LinkListener,
    private readonly onFrame?: FrameListener,
  ) {
    this.api = new RemoteApiClient(baseUrl)
  }

  /** Update the display name in place (no reconnect). */
  setName(name: string): void {
    this.name = name
    this.notify()
  }

  get stateView(): ServerState { return this.state }
  get errorView(): string | undefined { return this.lastError }
  get hostView(): ServerView['host'] { return this.hostFacts }

  toView(): ServerView {
    return {
      id: this.id,
      name: this.name,
      baseUrl: this.baseUrl,
      state: this.state,
      host: this.hostFacts,
      lastError: this.lastError,
    }
  }

  /** Begin the connect/pump/reconnect loop (idempotent). */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stop the loop and tear down streams. */
  stop(): void {
    this.running = false
    this.abort.abort()
    this.state = 'stopped'
    if (this.listTimer !== undefined) clearTimeout(this.listTimer)
    this.notify()
  }

  // ---- Cached facts ----

  sessionRows(): { sessionId: string; summary: SessionSummary }[] {
    return this.summaries.map(summary => ({ sessionId: summary.sessionId, summary }))
  }

  pendingRows(): PendingRow[] {
    return [...this.pendingMap.values()]
  }

  // ---- Actions (thin wrappers over the remote /api) ----

  async history(sessionId: string, maxMessages?: number): Promise<ActionResult<{ events: HistoryEntry[]; hasMore: boolean }>> {
    return this.unary('history', { sessionId, ...(maxMessages === undefined ? {} : { maxMessages }) })
  }

  async prompt(sessionId: string, text: string): Promise<ActionResult<{ accepted: true }>> {
    return this.unary('prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  }

  async cancel(sessionId: string): Promise<ActionResult<{ accepted: true }>> {
    return this.unary('cancel', { sessionId })
  }

  async rename(sessionId: string, title: string): Promise<ActionResult<{ title: string; seq: number }>> {
    return this.unary('rename', { sessionId, title })
  }

  async fork(sessionId: string, atSeq?: number): Promise<ActionResult<{ sessionId: string }>> {
    return this.unary('fork', { sessionId, ...(atSeq === undefined ? {} : { atSeq }) })
  }

  async create(opts: { workspaceId?: string; cwd?: string; agentPreset?: string; sessionId?: string }): Promise<ActionResult<{ sessionId: string; agentPreset?: string }>> {
    return this.unary('create', opts)
  }

  async models(sessionId: string): Promise<ActionResult<SessionModels>> {
    return this.unary('models', { sessionId })
  }

  async selectModel(
    sessionId: string,
    selection: { provider: string; model: string; reasoningEffort?: string },
  ): Promise<ActionResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
    return this.unary('selectModel', { sessionId, ...selection })
  }

  /** Answer one approval/question frame on the remote, echoing its rpcId. */
  async respond(rpcId: string, value: unknown): Promise<ActionResult<RpcReceipt>> {
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: RpcId(rpcId),
      result: { ok: true as const, value },
    }
    try {
      const receipt = await this.api.respond(message)
      return { ok: true, value: receipt }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  /** Forward an arbitrary wire session method to the remote (gateway routing). */
  async invoke(method: string, payload: Record<string, unknown>): Promise<RpcResult<never>> {
    if (method === 'session.search') {
      const result = await this.search(String(payload.query ?? ''))
      return result as RpcResult<never>
    }
    const kind = method.slice('session.'.length) as 'history' | 'prompt' | 'cancel' | 'rename'
      | 'fork' | 'models' | 'selectModel' | 'updateQueue' | 'attachment'
    if (kind !== 'history' && kind !== 'prompt' && kind !== 'cancel' && kind !== 'rename'
      && kind !== 'fork' && kind !== 'models' && kind !== 'selectModel' && kind !== 'updateQueue'
      && kind !== 'attachment') {
      return { ok: false, error: {
        code: 'no-such-method' as never, message: `method "${method}" does not exist`, details: {},
      } }
    }
    return this.unary(kind, payload)
  }

  /** Cross-server session.search (best effort; used by the gateway). */
  async search(query: string): Promise<RpcResult<{ items: unknown[] }>> {
    try {
      const response = await this.api.sessions.search({ query }, this.abort.signal)
      return response.result as RpcResult<{ items: unknown[] }>
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  /**
   * Generic wire call to any remote domain (settings/credentials/llm/…),
   * used by the model-config sync. Returns the ServerResponse's result
   * (RpcResult semantics), with transport failures folded to RpcError.
   */
  async wireCall(method: string, payload: unknown): Promise<RpcResult<never>> {
    try {
      const response = await this.api.call(method, payload, this.abort.signal)
      return response.result as RpcResult<never>
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  /** Probe reachability + handshake without starting a link (servers.add test). */
  static async probe(baseUrl: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const api = new RemoteApiClient(baseUrl)
    try {
      const response = await api.host.describe({})
      if (!response.result.ok) {
        return { ok: false, error: `describe failed: ${response.result.error.code}` }
      }
      return { ok: true, version: response.result.value.version }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---- Internals ----

  private async unary<K extends 'history' | 'prompt' | 'cancel' | 'rename' | 'fork' | 'create' | 'models' | 'selectModel' | 'updateQueue' | 'attachment'>(
    kind: K,
    payload: Record<string, unknown>,
  ): Promise<ActionResult<never>> {
    const sessions = this.api.sessions as unknown as {
      [M in K]: (payload: Record<string, unknown>, signal?: AbortSignal) => Promise<{ result: RpcResult<never> }>
    }
    try {
      const response = await sessions[kind](payload, this.abort.signal)
      return response.result as ActionResult<never>
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const generation = ++this.generation
      const ac = new AbortController()
      let failed = false
      try {
        // Handshake: describe proves the /api surface and refreshes host facts.
        const describe = await this.api.host.describe({})
        if (!describe.result.ok) throw new Error(`describe: ${describe.result.error.code}`)
        const value = describe.result.value
        this.hostFacts = {
          version: value.version,
          cwd: value.cwd,
          ...(value.provider === undefined ? {} : { provider: value.provider }),
          ...(value.model === undefined ? {} : { model: value.model }),
          attachedSessions: value.attachedSessions,
          canOpenPath: value.canOpenPath,
        }
        this.state = 'connected'
        this.lastError = undefined
        await this.refreshList(generation, ac.signal)
        this.notify()
        const mux = this.api.events.mux({}, ac.signal)
        const host = this.api.events.host({}, ac.signal)
        const [muxDone, hostDone] = await Promise.allSettled([
          this.pumpMux(mux, generation, ac.signal),
          this.pumpHost(host, generation, ac.signal),
        ])
        for (const settled of [muxDone, hostDone]) {
          if (settled.status === 'rejected' && !ac.signal.aborted) {
            failed = true
            this.lastError = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
          }
        }
      } catch (error) {
        failed = true
        this.lastError = error instanceof Error ? error.message : String(error)
      } finally {
        ac.abort()
      }
      if (!this.running) return
      if (failed) {
        this.state = 'error'
        this.notify()
      } else if (this.state === 'connected') {
        // Clean close (remote restarting) — treat as transient, keep last facts.
        this.state = 'error'
      }
      if (this.running) {
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, generation - 1))
        await sleep(delay / 2 + Math.random() * (delay / 2), this.abort.signal)
      }
    }
  }

  private async pumpMux(stream: AsyncIterable<RpcRequest<MuxFrame>>, generation: number, signal: AbortSignal): Promise<void> {
    for await (const envelope of stream) {
      if (signal.aborted) return
      const frame = envelope.payload
      this.onFrame?.(envelope.rpcId, frame)
      let touched = false
      switch (frame.type) {
        case 'approval/requested':
          this.pendingMap.set(envelope.rpcId, {
            serverId: this.id,
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            kind: 'approval',
            approval: {
              approvalId: frame.approvalId,
              toolName: frame.toolName,
              ...(frame.callId === undefined ? {} : { callId: frame.callId }),
              ...(frame.reason === undefined ? {} : { reason: frame.reason }),
            },
          })
          touched = true
          break
        case 'question/requested':
          this.pendingMap.set(envelope.rpcId, {
            serverId: this.id,
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            kind: 'question',
            question: { questions: frame.questions },
          })
          touched = true
          break
        case 'approval/resolved': {
          // The resolved frame rides its own envelope, so its rpcId is not the
          // one the request arrived under — the approvalId is the correlation.
          for (const [key, row] of this.pendingMap) {
            if (row.kind === 'approval' && row.approval?.approvalId === frame.approvalId) {
              touched = this.pendingMap.delete(key) || touched
            }
          }
          break
        }
        case 'question/resolved':
          // Questions echo the requesting envelope's rpcId back verbatim.
          touched = this.pendingMap.delete(frame.questionRpcId)
          break
        case 'session/event':
          // Any event can move list facts (title, running, updatedAt, jobs).
          touched = true
          break
        default:
          break
      }
      if (touched) {
        this.scheduleListRefresh(generation)
        this.notify()
      }
    }
  }

  private async pumpHost(stream: AsyncIterable<RpcRequest<HostFrame>>, generation: number, signal: AbortSignal): Promise<void> {
    for await (const envelope of stream) {
      if (signal.aborted) return
      const frame = envelope.payload
      this.onFrame?.(envelope.rpcId, frame)
      switch (frame.type) {
        case 'host/session-added':
        case 'host/session-removed':
        case 'host/session-status':
        case 'host/workspace-changed':
        case 'host/workspace-removed':
        case 'host/agent-error':
        case 'host/archived-sessions-changed':
          this.scheduleListRefresh(generation)
          break
        default:
          break
      }
      if (frame.type === 'host/archived-sessions-changed') {
        const ids = frame.archivedSessionIds
        if (Array.isArray(ids)) {
          this.archivedIds = ids.filter((id): id is string => typeof id === 'string')
          this.archivedLoaded = true
        }
      }
    }
  }

  private scheduleListRefresh(generation: number): void {
    if (this.listTimer !== undefined) return
    this.listTimer = setTimeout(() => {
      this.listTimer = undefined
      if (!this.running || generation !== this.generation) return
      void this.refreshList(generation, this.abort.signal).then(() => this.notify())
    }, LIST_DEBOUNCE_MS)
  }

  private async refreshList(generation: number, signal: AbortSignal): Promise<void> {
    const response = await this.api.sessions.list({}, signal)
    if (!response.result.ok || generation !== this.generation) return
    this.summaries = response.result.value.items
    if (!this.archivedLoaded) void this.refreshArchived(signal)
  }

  /**
   * Pull the remote archive set (workspace.list) into the cached projection
   * so the merged workspace.list can expose remote archived sessions in the
   * official tree's archive section. Cached for the link's lifetime and kept
   * live via host/archived-sessions-changed frames.
   */
  async refreshArchived(signal: AbortSignal = this.abort.signal): Promise<void> {
    try {
      const response = await this.wireCall('workspace.list', {})
      if (!response.ok) return
      const ids = (response.value as { archivedSessionIds?: unknown } | undefined)?.archivedSessionIds
      if (Array.isArray(ids)) {
        this.archivedIds = ids.filter((id): id is string => typeof id === 'string')
        this.archivedLoaded = true
        this.notify()
      }
    } catch {
      // Stale link: keep the previous archive set.
    }
  }

  /** The remote's archived session ids (mirrors workspace.list). */
  archivedSessionIds(): string[] {
    return this.archivedIds
  }
}

function transportError(error: unknown): RpcError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as RpcError
  }
  return {
    code: 'transport',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}