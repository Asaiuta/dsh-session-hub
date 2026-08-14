/**
 * Official-UI bridge: relays the hub SSE frame stream into the *official*
 * browser session runtime, so the unmodified conversation/workspace UI opens
 * and renders remote sessions as if they were local. The official runtime
 * consumes mux frames via `sessions.handleMuxEnvelope(envelope)` (the same
 * entry the official connection websocket feeds); the hub SSE stream carries
 * the exact same wire frames (ServerLink forwards each remote mux frame
 * verbatim), so the bridge rebuilds the envelope shape and injects it. The
 * official /api unary surface (history/prompt/cancel/…) is answered by the
 * hub host gateway routing to the owning server, completing the loop.
 */
import type { ServerId } from '../contract.ts';
/** The official runtime face the bridge drives (duck-typed, not type-linked). */
export interface OfficialSessions {
    handleMuxEnvelope(envelope: {
        type: 'server-request';
        rpcId: string;
        method: string;
        payload: unknown;
    }): void;
}
/** The official workspaces runtime face (host-frame sink). */
export interface OfficialWorkspaces {
    handleHostEnvelope(envelope: {
        type: 'server-request';
        rpcId: string;
        method: string;
        payload: unknown;
    }): void;
}
/**
 * Start relaying hub SSE frames into the official runtimes: mux frames into
 * the sessions runtime, and the hub-synthesized `host/workspace-*` frames
 * (virtual server groups) into the workspaces runtime.
 * @param sessions - the official `ctx.sessions` service instance.
 * @param workspaces - the official `ctx.workspaces` service instance.
 * @returns the disposer (stop relaying).
 */
export declare function startOfficialBridge(sessions: OfficialSessions | undefined, workspaces: OfficialWorkspaces | undefined): () => void;
/** Reflect access helper: read the workspaces service off any context object. */
export declare function workspacesOf(context: unknown): OfficialWorkspaces | undefined;
/** Reflect access helper: read the sessions service off any context object. */
export declare function sessionsOf(context: unknown): OfficialSessions | undefined;
export type { ServerId };
