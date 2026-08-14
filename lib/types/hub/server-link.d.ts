/**
 * One configured remote server: a RemoteApiClient with reconnecting mux/host
 * pumps, a cached session summary list, and the pending interaction table
 * mirrored from the remote mux stream. All caches are in-memory snapshots the
 * browser reads through the hub snapshot endpoint (no per-client sockets).
 */
import type { HostFrame, MuxFrame, RpcReceipt, RpcResult, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy';
import type { HistoryEntry, PendingRow, ServerId, ServerState, ServerView } from '../contract.ts';
import { RemoteApiClient } from './remote-api.ts';
/** Callback fired whenever any cached fact changed (link-level dirty signal). */
export type LinkListener = () => void;
/** Callback fired for every raw mux/host frame the link receives. */
export type FrameListener = (rpcId: string, frame: MuxFrame | HostFrame) => void;
/** Business outcome of one hub action — RpcResult semantics without transport noise. */
export type ActionResult<T> = RpcResult<T>;
export declare class ServerLink {
    readonly id: ServerId;
    readonly baseUrl: string;
    private name;
    private readonly notify;
    private readonly onFrame?;
    readonly api: RemoteApiClient;
    private readonly abort;
    private state;
    private lastError;
    private hostFacts;
    private summaries;
    private archivedIds;
    private archivedLoaded;
    private readonly pendingMap;
    private generation;
    private listTimer;
    private running;
    constructor(id: ServerId, baseUrl: string, name: string, notify: LinkListener, onFrame?: FrameListener | undefined);
    /** Update the display name in place (no reconnect). */
    setName(name: string): void;
    get stateView(): ServerState;
    get errorView(): string | undefined;
    get hostView(): ServerView['host'];
    toView(): ServerView;
    /** Begin the connect/pump/reconnect loop (idempotent). */
    start(): void;
    /** Stop the loop and tear down streams. */
    stop(): void;
    sessionRows(): {
        sessionId: string;
        summary: SessionSummary;
    }[];
    pendingRows(): PendingRow[];
    history(sessionId: string, maxMessages?: number): Promise<ActionResult<{
        events: HistoryEntry[];
        hasMore: boolean;
    }>>;
    prompt(sessionId: string, text: string): Promise<ActionResult<{
        accepted: true;
    }>>;
    cancel(sessionId: string): Promise<ActionResult<{
        accepted: true;
    }>>;
    rename(sessionId: string, title: string): Promise<ActionResult<{
        title: string;
        seq: number;
    }>>;
    fork(sessionId: string, atSeq?: number): Promise<ActionResult<{
        sessionId: string;
    }>>;
    create(opts: {
        workspaceId?: string;
        cwd?: string;
        agentPreset?: string;
        sessionId?: string;
    }): Promise<ActionResult<{
        sessionId: string;
        agentPreset?: string;
    }>>;
    models(sessionId: string): Promise<ActionResult<SessionModels>>;
    selectModel(sessionId: string, selection: {
        provider: string;
        model: string;
        reasoningEffort?: string;
    }): Promise<ActionResult<{
        selected: {
            provider: string;
            model: string;
            reasoningEffort?: string;
        };
    }>>;
    /** Answer one approval/question frame on the remote, echoing its rpcId. */
    respond(rpcId: string, value: unknown): Promise<ActionResult<RpcReceipt>>;
    /** Forward an arbitrary wire session method to the remote (gateway routing). */
    invoke(method: string, payload: Record<string, unknown>): Promise<RpcResult<never>>;
    /** Cross-server session.search (best effort; used by the gateway). */
    search(query: string): Promise<RpcResult<{
        items: unknown[];
    }>>;
    /**
     * Generic wire call to any remote domain (settings/credentials/llm/…),
     * used by the model-config sync. Returns the ServerResponse's result
     * (RpcResult semantics), with transport failures folded to RpcError.
     */
    wireCall(method: string, payload: unknown): Promise<RpcResult<never>>;
    /** Probe reachability + handshake without starting a link (servers.add test). */
    static probe(baseUrl: string): Promise<{
        ok: true;
        version: string;
    } | {
        ok: false;
        error: string;
    }>;
    private unary;
    private loop;
    private pumpMux;
    private pumpHost;
    private scheduleListRefresh;
    private refreshList;
    /**
     * Pull the remote archive set (workspace.list) into the cached projection
     * so the merged workspace.list can expose remote archived sessions in the
     * official tree's archive section. Cached for the link's lifetime and kept
     * live via host/archived-sessions-changed frames.
     */
    refreshArchived(signal?: AbortSignal): Promise<void>;
    /** The remote's archived session ids (mirrors workspace.list). */
    archivedSessionIds(): string[];
}
