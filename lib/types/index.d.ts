/**
 * dsh-session-hub host plugin: the multi-server session aggregation hub.
 *
 * Each configured remote `dsh web` deployment is reached through its public
 * `/api` protocol (the same surface the harness's own browser client and the
 * official mobile/desktop remote clients use): unary RPCs over HTTP,
 * mux/host event streams over WebSocket. The hub keeps per-server links
 * (reconnecting mux/host pumps, cached session list, pending interaction
 * table) and exposes one merged control plane to the browser via the
 * `sessionHub` Typert Remote namespace. The client half ships in the same
 * package (`./client`) and renders the merged panel.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name (the Loader entry and client bundle id). */
export declare const name = "dsh-session-hub";
/** Services required before load: the Typert registry and the HTTP carrier. */
export declare const inject: string[];
/** Deployment configuration. */
export interface Config {
    /**
     * Where the configured server list persists. Absent, it lives under the
     * harness home: $DSH_HOME/plugins/dsh-session-hub.json.
     */
    dataFile?: string;
    /**
     * Non-loopback authorities this hub serves (same bare host[:port] format
     * as client-connection.trustedHosts). The hub gateway re-checks every
     * intercepted /api request against loopback + this list. Default: loopback
     * only (SSH-tunnel deployments need nothing here).
     */
    trustedHosts?: string[];
}
/**
 * Configuration schema: deployment-varying choices stay tunable from
 * cordis.yml. The inferred schema type keeps the callable form accepting
 * partial input, so `Config({})` yields the defaults.
 */
export declare const Config: any;
/**
 * Mount the session hub service and its strict Typert manifest.
 * @param ctx - host cordis context.
 * @param config - validated plugin configuration (schema defaults applied).
 */
export declare function apply(ctx: Context, config?: Config): void;
