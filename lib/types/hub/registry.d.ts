import type { HubSnapshot, ServerId, ServerView } from '../contract.ts';
import { HubEventBus } from './events.ts';
import { ServerLink } from './server-link.ts';
import { type SshTarget } from './tunnel.ts';
export declare class ServerRegistry {
    private readonly dataFile;
    private readonly links;
    /** Tunnels keyed by the server they serve; absent for direct entries. */
    private readonly tunnels;
    /** SSH targets keyed by server, so persist() can write them back. */
    private readonly sshTargets;
    private readonly listeners;
    private writeTimer;
    /** Live frame fan-out; the SSE route subscribes here. */
    readonly events: HubEventBus;
    /** Stable identity of this hub instance (changes on host restart). */
    readonly hubId: `${string}-${string}-${string}-${string}-${string}`;
    /** Random SSE credential; changes every host restart. */
    readonly eventToken: string;
    constructor(dataFile: string);
    /**
     * Add a server, persist, and start its link. Rejects a self-loop (a baseUrl
     * pointing back at this same hub process — it would forward into itself and
     * wedge hub-local history).
     */
    add(name: string, baseUrl: string): Promise<ServerView>;
    /**
     * Add a server reached over an SSH local forward. The tunnel comes up
     * first, because its OS-assigned port is what the link's baseUrl is made
     * of; a tunnel that cannot start is a failed add, not a dead entry.
     */
    addSsh(name: string, target: SshTarget): Promise<ServerView>;
    /**
     * A tunnel changed state. When it comes back on a different port the link
     * is rebuilt against the new URL, which is what makes a dropped SSH
     * session heal without the user touching anything.
     */
    private onTunnelChange;
    /** Tunnel status for a server, if it has one. */
    tunnelStatus(id: ServerId): {
        state: string;
        localPort?: number;
        error?: string;
    } | undefined;
    /** Update display name and/or endpoint; a baseUrl change rebuilds the link. */
    update(id: ServerId, patch: {
        name?: string;
        baseUrl?: string;
    }): ServerView;
    remove(id: ServerId): void;
    /**
     * Rename a server's display name in place — no link rebuild, no
     * reconnect. Used by the official tree's workspace rename on virtual
     * server groups.
     */
    renameDisplay(id: ServerId, title: string): ServerView;
    dispose(): void;
    serversList(): ServerView[];
    /** Merged snapshot: servers, every session grouped by server, pending interactions. */
    snapshot(): HubSnapshot;
    /** Live configured links (every server view with a running link). */
    linkList(): ServerLink[];
    /** The link owning a session (by cached session id), or undefined. */
    findLinkBySession(sessionId: string): ServerLink | undefined;
    /** The link holding a pending interaction with this rpcId, or undefined. */
    findLinkByRpcId(rpcId: string): ServerLink | undefined;
    link(id: ServerId): ServerLink | undefined;
    /** Subscribe to any registry/link change; returns the disposer. */
    subscribe(listener: () => void): () => void;
    private load;
    /** Tag a frame with its source server before fanning out. */
    private frameHook;
    private schedulePersist;
    private persist;
    private require;
    private emitChange;
}
/** Accept http(s) origins; strip trailing slashes; reject anything else loud. */
export declare function normalizeBaseUrl(input: string): string;
