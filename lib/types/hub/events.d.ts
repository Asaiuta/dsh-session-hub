import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostFrame, MuxFrame } from '@deepseek-ai/dsh-host-apiproxy';
import type { ServerId } from '../contract.ts';
/** One forwarded frame, tagged with its source link. */
export interface HubEventEnvelope {
    readonly serverId: ServerId;
    /** Monotonic per-bus sequence (delivery order on the wire). */
    readonly seq: number;
    /** The remote frame's envelope rpcId (matters for respond echoing). */
    readonly rpcId: string;
    readonly frame: MuxFrame | HostFrame;
}
export type HubEventSink = (envelope: HubEventEnvelope) => void;
/** Fan-out bus owned by the registry; one subscriber per SSE client. */
export declare class HubEventBus {
    private readonly sinks;
    private seq;
    publish(serverId: ServerId, rpcId: string, frame: MuxFrame | HostFrame): void;
    subscribe(sink: HubEventSink): () => void;
    get size(): number;
}
/** Build the `/hub/events` SSE route for one registry instance. */
export declare function createHubEventsRoute(bus: HubEventBus, token: string): {
    kind: 'exact';
    path: '/hub/events';
    handler: (req: IncomingMessage, res: ServerResponse) => void;
};
/** Fresh per-registry token (32 random bytes, hex). */
export declare function newEventToken(): string;
