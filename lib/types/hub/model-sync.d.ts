import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy';
import type { ServerLink } from './server-link.ts';
import type { ServerRegistry } from './registry.ts';
export interface ModelSyncEntry {
    serverId: string;
    updated: string[];
    credentials: string[];
    skipped: string[];
}
/** Incremental model-config sync engine. */
export declare class ModelSyncService {
    private readonly official;
    private readonly registry;
    private readonly fileCredentials;
    private readonly lastAutoSync;
    constructor(official: () => ApiProxy, registry: ServerRegistry, dshHome: string);
    private resolveCredential;
    private localModelNamespaces;
    /** Sync one server; additive, missing-only. */
    syncOne(link: ServerLink): Promise<ModelSyncEntry>;
    /** Sync a specific server (or every connected link). */
    sync(serverId?: string): Promise<{
        synced: ModelSyncEntry[];
    }>;
    /**
     * Auto-sync watcher: call every few seconds; syncs a link once when it
     * transitions into `connected`, at most once per AUTO_SYNC_MIN_MS.
     */
    autoTick(): void;
}
