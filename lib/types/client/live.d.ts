/**
 * Module-level live-event bus: the hub SSE receiver (started from the sidebar
 * tree once a snapshot token is known) publishes remote session events; the
 * conversation fold subscribes. React components in one bundle cannot talk
 * through props across sibling subtrees, so this mirrors hub-ui-state.
 */
import type { ServerId } from '../contract.ts';
/** One forwarded remote `session/event`, filtered down to what the fold needs. */
export interface LiveSessionEvent {
    readonly serverId: ServerId;
    readonly sessionId: string;
    /** The remote session event's own seq — the dedupe key against history. */
    readonly seq: number;
    readonly event: unknown;
}
type LiveListener = (envelope: LiveSessionEvent) => void;
type ChangeListener = () => void;
type StatusListener = (status: LiveStatus) => void;
/** One raw mux/host frame as relayed by the hub SSE (unfiltered). */
export interface LiveFrame {
    readonly serverId: ServerId;
    readonly rpcId: string;
    readonly frame: unknown;
}
type FrameListener = (frame: LiveFrame) => void;
/** Subscribe to live session events; returns the disposer. */
export declare function subscribeLive(listener: LiveListener): () => void;
/** Subscribe to any live frame (session events, approvals, queue, host) so
 *  the caller can trigger an immediate snapshot refresh; returns disposer. */
export declare function subscribeLiveChanges(listener: ChangeListener): () => void;
/** Publish one remote session event (from the SSE receiver). */
export declare function publishLive(envelope: LiveSessionEvent): void;
/** Subscribe to the unfiltered frame relay (official-sessions bridge). */
export declare function subscribeFrames(listener: FrameListener): () => void;
/** Signal that some frame moved hub facts (session list, pending, queue). */
export declare function publishLiveChange(): void;
/** Relay one raw frame to the frame subscribers. */
export declare function publishFrame(frame: LiveFrame): void;
/** Extract the session event payload from a forwarded `session/event` frame. */
export declare function asSessionEvent(frame: unknown): {
    sessionId: string;
    event: unknown;
    seq: number;
} | null;
export type LiveStatus = 'connecting' | 'live' | 'down';
/** Open (or reuse) the hub SSE stream for a snapshot event token. */
export declare function ensureHubLive(token: string): void;
/** Current SSE stream status (stopped/connecting/live/down). */
export declare function getLiveStatus(): LiveStatus;
/** Subscribe to SSE stream status changes. */
export declare function subscribeLiveStatus(listener: StatusListener): () => void;
export {};
