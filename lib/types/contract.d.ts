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
import { z } from 'zod';
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
import type { HistoryEntry, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy';
/** Branded stable id of one configured remote server. */
export type ServerId = string & {
    readonly __serverId: unique symbol;
};
/** Wire state of one remote link. */
export declare const serverStateSchema: z.ZodEnum<{
    connecting: "connecting";
    connected: "connected";
    error: "error";
    stopped: "stopped";
}>;
export type ServerState = z.infer<typeof serverStateSchema>;
/** One configured remote server plus its live link facts. */
export interface SshTargetView {
    readonly host: string;
    readonly port?: number;
    readonly username: string;
    readonly privateKeyPath?: string;
    readonly remotePort?: number;
}
export interface ServerView {
    readonly id: ServerId;
    /** Display name chosen by the user. */
    readonly name: string;
    /** HTTP(S) origin of the remote `dsh web` deployment, no trailing slash. */
    readonly baseUrl: string;
    readonly state: ServerState;
    /** describe() facts of the last successful handshake; absent before first connect. */
    readonly host?: {
        readonly version: string;
        readonly cwd: string;
        readonly provider?: string;
        readonly model?: string;
        readonly attachedSessions: number;
        readonly canOpenPath: boolean;
    };
    /** Human-readable failure reason from the last failed generation. */
    readonly lastError?: string;
    /**
     * Tunnel state for ssh-backed entries. Present only when the hub manages
     * the forward itself, and worth surfacing separately: a tunnel that is
     * down explains a dead link far better than the link's own timeout does.
     */
    readonly tunnel?: {
        readonly state: string;
        readonly localPort?: number;
        readonly error?: string;
        readonly target: SshTargetView;
    };
}
/** One merged row: a session on a specific remote server. */
export interface RemoteSessionRow {
    readonly serverId: ServerId;
    /** Host-owned session id (unique per server; the pair is the hub key). */
    readonly sessionId: string;
    readonly summary: SessionSummary;
}
/** One outstanding answerable interaction relayed from a remote mux stream. */
export interface PendingApprovalView {
    readonly approvalId: string;
    readonly toolName: string;
    readonly callId?: string;
    readonly reason?: string;
}
export interface PendingQuestionView {
    readonly questions: readonly {
        readonly id: string;
        readonly prompt: string;
        readonly options?: readonly {
            readonly id: string;
            readonly label: string;
        }[];
        readonly multiSelect?: boolean;
    }[];
}
export interface PendingRow {
    readonly serverId: ServerId;
    /** The remote mux frame's rpcId — must echo in the respond call. */
    readonly rpcId: string;
    readonly sessionId: string;
    readonly kind: 'approval' | 'question';
    readonly approval?: PendingApprovalView;
    readonly question?: PendingQuestionView;
}
/** Full panel snapshot: everything the browser needs in one round trip. */
export interface HubSnapshot {
    /** Stable identity of this hub instance (changes on host restart). */
    readonly hubId: string;
    /** Random SSE credential for `/hub/events` (changes on host restart). */
    readonly eventToken: string;
    readonly servers: readonly ServerView[];
    readonly sessions: readonly RemoteSessionRow[];
    readonly pending: readonly PendingRow[];
}
/** One external source tool as the settings tab presents it. */
export interface ImportSourceStatusView {
    source: string;
    path: string;
    available: boolean;
    imported: boolean;
    auto: boolean;
    count: number;
    scannedAt?: number;
}
/** The sessionHub namespace's strict invocation descriptors (host manifest + client mount share this). */
export declare const SESSION_HUB_INVOCATIONS: readonly InvocationDescriptor[];
/** Extract plain text from a dsh-llm ContentBlock for simple message rendering. */
export declare function blockText(block: unknown): string;
/** Best-effort text of a message event's content list (unknown shapes degrade to ''). */
export declare function messageText(content: unknown): string;
export type { SessionModels, SessionSummary, HistoryEntry };
