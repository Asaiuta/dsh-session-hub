/**
 * The callable face of the `sessionHub` Remote namespace as the panel sees
 * it. One definition shared by the components (face.ts), the Typert client
 * contribution (remote.ts), and the mount code in index.ts.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { HistoryEntry } from '../contract.ts';
import type { HubSnapshot, ImportSourceStatusView, ServerId, ServerView } from '../contract.ts';
export type ProbeOutcome = {
    ok: true;
    version: string;
} | {
    ok: false;
    error: string;
};
export interface SessionHubNamespaceFace {
    serversAdd(payload: {
        name: string;
        baseUrl: string;
    }): Promise<RemoteResult<ServerView>>;
    serversRemove(payload: {
        id: ServerId;
    }): Promise<RemoteResult<{
        removed: true;
    }>>;
    serversProbe(payload: {
        baseUrl: string;
    }): Promise<RemoteResult<ProbeOutcome>>;
    snapshot(payload: Record<string, never>): Promise<RemoteResult<HubSnapshot>>;
    modelSync(payload: {
        serverId?: ServerId;
    }): Promise<RemoteResult<{
        synced: Array<{
            serverId: string;
            updated: string[];
            credentials: string[];
            skipped: string[];
        }>;
    }>>;
    importStatus(payload: Record<string, never>): Promise<RemoteResult<{
        sources: ImportSourceStatusView[];
    }>>;
    importAction(payload: {
        source: string;
        action: 'import' | 'remove' | 'auto';
        auto?: boolean;
    }): Promise<RemoteResult<{
        sources: ImportSourceStatusView[];
    }>>;
}
export type { RemoteResult, HistoryEntry };
