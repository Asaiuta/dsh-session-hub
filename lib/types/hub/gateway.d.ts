/**
 * Hub aggregation gateway: an HTTP dispatch layer for the /api unary
 * endpoints the browser reaches through the official client connection. The
 * official /api prefix route still owns events websockets and everything
 * else; the hub registers exact-path routes (exact beats prefix in the
 * webserver match) for the session-control methods, runs the same
 * browser-trust fence, then routes by session ownership: remote sessions →
 * the owning ServerLink, local sessions (and unknown ids) → the official
 * ApiProxy unchanged. This is what lets the *unmodified* official Web UI
 * open, stream, and control remote sessions.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiProxy, ClientRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy';
import type { ServerRegistry } from './registry.ts';
import type { ImportStore } from './importer.ts';
import { type SessionStoreFace } from './promote.ts';
/** Methods intercepted by exact routes (browser-facing unary surface). */
export declare const GATEWAY_METHODS: string[];
/**
 * One intercepted unary request lifecycle. `method` is the /api path segment
 * (e.g. "session.history"); the handler owns the whole response.
 */
export declare class HubGateway {
    private readonly official;
    private readonly registry;
    private readonly trustedHosts;
    private readonly imports?;
    /** The official session store, when the host exposes one. */
    private readonly sessionStore?;
    constructor(official: () => ApiProxy, registry: ServerRegistry, trustedHosts: readonly string[], imports?: ImportStore | undefined, 
    /** The official session store, when the host exposes one. */
    sessionStore?: (() => SessionStoreFace | undefined) | undefined);
    /** Project paths already offered to workspace.create (once per process). */
    private readonly materialized;
    /** Imported session id → the real session it was promoted to. */
    private readonly promoted;
    handle(req: IncomingMessage, res: ServerResponse, method: string): Promise<void>;
    /** Route one unary envelope; always answers a ServerResponse document. */
    dispatch(method: string, envelope: ClientRequest, internal?: boolean): Promise<RpcResponse<unknown>>;
    /** Merged session list: official local rows + every remote server's rows. */
    private list;
    /**
     * Merged workspace list: official local workspaces + one *virtual* group
     * per configured server. The official tree groups sessions by workspace
     * membership, so each server's remote sessions appear as their own
     * top-level group instead of the ungrouped bucket. Virtual views carry a
     * `dsh-hub://<serverId>` path and the server's display name as title.
     */
    /**
     * Register a real official workspace for every imported project directory
     * that does not have one yet.
     *
     * Synthetic groups render fine but are not real workspaces, so official
     * operations (rename, delete, starting a session in them) do not apply to
     * them. `workspace.create` is idempotent and never creates directories — a
     * path that no longer exists fails with `workspace-invalid-path` — so this
     * only ever adopts directories the user really worked in.
     *
     * Each path is attempted once per process: a path the user subsequently
     * deletes from the workspace list must stay deleted, and a failing path
     * must not be retried on every list call.
     *
     * @param rpcId - the in-flight request id, reused for the nested calls.
     */
    private materializeImportedProjects;
    private workspaceList;
    /**
     * The virtual workspace projection: one workspace row per configured
     * server, owning that server's remote sessions. Shared by the workspace.list
     * merge and the synthetic `host/workspace-changed` frame watcher, so the
     * official tree stays consistent between cold list and live updates.
     */
    virtualWorkspaceViews(): import('@deepseek-ai/dsh-host-apiproxy').WorkspaceView[];
    /** Search across the local host and every remote server (best effort). */
    private search;
    /**
     * Promote an imported session to a real DSH session, once.
     *
     * The mapping is remembered so a second prompt (or a retry) continues the
     * same session instead of minting another copy, and the imported original
     * is hidden so the conversation does not appear twice in the tree.
     *
     * @param rpcId - the in-flight request id, reused for the nested call.
     * @param sessionId - the imported session to promote.
     * @returns the real session id, or undefined when promotion is unavailable.
     */
    private promote;
    /** Route one session method to the owning server, else the local host. */
    private bySession;
    /**
     * session.create: a virtual workspace id (a hub server) routes the create
     * to that server — the remote has no such workspace, so the id is dropped
     * and the session lands in the remote's default group. No workspace id
     * (sidebar global New Session) stays on the official path.
     */
    private createSession;
    /**
     * workspace.rename on a virtual server group renames the server (display
     * name, persisted, no reconnect); everything else stays official.
     */
    private renameWorkspace;
    /**
     * workspace.delete on a virtual server group removes the server connection
     * (config entry included); everything else stays official.
     */
    /**
     * workspace.delete on a virtual server group removes the server connection
     * (config entry included); everything else stays official.
     *
     * Deleting a workspace that holds imported sessions also records the
     * project as declined, so adoption does not re-create it on the next list
     * and the sessions do not reappear as a synthetic group.
     */
    private deleteWorkspace;
    /**
     * The directory behind a workspace id, read from the official registry.
     * @param rpcId - the in-flight request id, reused for the nested call.
     * @param workspaceId - the workspace to resolve.
     * @returns the path, or undefined when the id is unknown.
     */
    private workspacePath;
    /** Route a client response to the remote server holding the pending rpcId. */
    private respond;
    /** Delegate to the official ApiProxy domain (local host semantics). The
     * host-side domain methods take the full {rpcId, payload} request shape
     * (the same shape UNARY_ROUTES invokes) and return RpcResponse. */
    private callOfficial;
}
