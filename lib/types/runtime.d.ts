/**
 * The dsh-session-hub host Remote service (`ctx.sessionHub`, wire namespace
 * `sessionHub`). Registered as a TypertRemoteService so the Host Gateway
 * exports its @Remote methods to the Web client under `/api/sessionHub/*`
 * with zero generated artifacts; the strict manifest (typert.ts) is what
 * actually resolves and invokes the endpoints in a profile-loaded bundle.
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { HistoryEntry, SessionModels, SessionSummary } from '@deepseek-ai/dsh-host-apiproxy';
import type { HubSnapshot, ImportSourceStatusView, PendingRow, ServerId, ServerView } from './contract.ts';
import { ServerRegistry } from './hub/registry.ts';
import type { ModelSyncService } from './hub/model-sync.ts';
import { type ImportStore } from './hub/importer.ts';
/** The multi-server control plane: registry CRUD, merged snapshot, actions. */
export declare class SessionHubRuntime extends TypertRemoteService {
    private readonly registry;
    private readonly syncService?;
    private readonly imports?;
    /**
     * Register the service under the `sessionHub` key (the wire namespace).
     * @param ctx - owning cordis context.
     * @param registry - shared server registry (persistence + links).
     */
    constructor(ctx: Context, registry: ServerRegistry, syncService?: ModelSyncService | undefined, imports?: ImportStore | undefined);
    /** Per-source import state for the settings tab. */
    importStatus(_payload: Record<string, never>): {
        sources: ImportSourceStatusView[];
    };
    /**
     * Import, remove or re-configure one source tool, answering with the
     * refreshed state so the caller never has to guess what took effect.
     *
     * A scan runs only for `import`: reading hundreds of logs is the user's
     * explicit request, not a side effect of toggling a checkbox.
     */
    importAction(payload: {
        source: string;
        action: 'import' | 'remove' | 'auto';
        auto?: boolean;
    }): Promise<{
        sources: ImportSourceStatusView[];
    }>;
    /**
     * Incrementally sync the local model configuration (llm-* namespaces +
     * agent-default-model + credential references) to one server, or to every
     * connected server. Additive only: missing pieces are filled, existing
     * remote state is never overwritten.
     */
    modelSync(payload: {
        serverId?: ServerId;
    }): Promise<{
        synced: Array<{
            serverId: string;
            updated: string[];
            credentials: string[];
            skipped: string[];
        }>;
    }>;
    serversList(_payload: Record<string, never>): ServerView[];
    serversAdd(payload: {
        name: string;
        baseUrl: string;
    }): Promise<ServerView>;
    serversUpdate(payload: {
        id: ServerId;
        name?: string;
        baseUrl?: string;
    }): ServerView;
    serversRemove(payload: {
        id: ServerId;
    }): {
        removed: true;
    };
    snapshot(_payload: Record<string, never>): HubSnapshot;
    sessionHistory(payload: {
        serverId: ServerId;
        sessionId: string;
        maxMessages?: number;
    }): Promise<{
        events: HistoryEntry[];
        hasMore: boolean;
    }>;
    sessionPrompt(payload: {
        serverId: ServerId;
        sessionId: string;
        text: string;
    }): Promise<{
        accepted: true;
    }>;
    sessionCancel(payload: {
        serverId: ServerId;
        sessionId: string;
    }): Promise<{
        accepted: true;
    }>;
    sessionRename(payload: {
        serverId: ServerId;
        sessionId: string;
        title: string;
    }): Promise<{
        title: string;
        seq: number;
    }>;
    sessionFork(payload: {
        serverId: ServerId;
        sessionId: string;
        atSeq?: number;
    }): Promise<{
        sessionId: string;
    }>;
    sessionCreate(payload: {
        serverId: ServerId;
        workspaceId?: string;
        cwd?: string;
        agentPreset?: string;
    }): Promise<{
        sessionId: string;
        agentPreset?: string;
    }>;
    sessionModels(payload: {
        serverId: ServerId;
        sessionId: string;
    }): Promise<SessionModels>;
    sessionSelectModel(payload: {
        serverId: ServerId;
        sessionId: string;
        provider: string;
        model: string;
        reasoningEffort?: string;
    }): Promise<{
        selected: {
            provider: string;
            model: string;
            reasoningEffort?: string;
        };
    }>;
    respond(payload: {
        serverId: ServerId;
        rpcId: string;
        value: unknown;
    }): Promise<{
        accepted: true;
    }>;
    /** Probe a candidate endpoint without adding it (used by the panel's Test button). */
    serversProbe(payload: {
        baseUrl: string;
    }): Promise<{
        ok: true;
        version: string;
    } | {
        ok: false;
        error: string;
    }>;
}
export type { HistoryEntry, SessionSummary, PendingRow };
