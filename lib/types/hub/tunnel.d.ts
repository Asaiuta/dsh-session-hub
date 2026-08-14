/**
 * SSH local-forward tunnels, managed inside the hub process.
 *
 * A remote `dsh web` only ever listens on its own loopback — the CLI refuses
 * to bind anything else, on the grounds that it would put remote code
 * execution on the network. The supported way to reach one is therefore an
 * SSH local forward, and until now the user had to run `ssh -N -L` by hand,
 * keep it alive, and remember which local port belonged to which server.
 *
 * This module does that part. A server entry configured with `ssh` gets a
 * listener on an OS-assigned loopback port whose connections are forwarded
 * over an authenticated SSH session to the remote's own 127.0.0.1. The
 * resulting `http://127.0.0.1:<port>` is what the rest of the hub treats as
 * the server's baseUrl, so nothing downstream needs to know a tunnel exists.
 */
/** How a server entry is reached. */
export interface SshTarget {
    /** Remote SSH host (name or IP). */
    readonly host: string;
    /** SSH port; 22 unless given. */
    readonly port?: number;
    readonly username: string;
    /** Path to a private key; `~` is expanded. Omit to use the agent. */
    readonly privateKeyPath?: string;
    /** Passphrase for an encrypted key. */
    readonly passphrase?: string;
    /** Port `dsh web` listens on at the far end; 3080 unless given. */
    readonly remotePort?: number;
}
export type TunnelState = 'connecting' | 'up' | 'error';
/**
 * One SSH connection plus the loopback listener that feeds it. Stays down
 * only if `stop()` was called; anything else is retried with backoff.
 */
export declare class SshTunnel {
    private readonly target;
    private readonly notify;
    private conn;
    private server;
    private localPort;
    private state;
    private lastError;
    private stopped;
    private attempt;
    private retryTimer;
    private readonly sockets;
    constructor(target: SshTarget, notify: () => void);
    /** `http://127.0.0.1:<port>` once the listener is up, else undefined. */
    baseUrl(): string | undefined;
    status(): {
        state: TunnelState;
        localPort?: number;
        error?: string;
    };
    /** Bring the tunnel up and keep it up. Resolves once the port is listening. */
    start(): Promise<void>;
    /** Tear everything down; no further retries. */
    stop(): void;
    private teardown;
    /** Schedule the next attempt unless we were stopped on purpose. */
    private scheduleRetry;
    private fail;
    private open;
}
/**
 * Open a tunnel, wait for it, and hand back its base URL — used by the
 * add-server probe, which needs one round trip and no supervision.
 */
export declare function probeTunnel(target: SshTarget): Promise<{
    ok: true;
    baseUrl: string;
    close: () => void;
} | {
    ok: false;
    error: string;
}>;
