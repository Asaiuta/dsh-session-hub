import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy';
import { type ImportedSession } from './import-common.ts';
import { ImportWatcher } from './import-watch.ts';
/**
 * The path an imported session groups under.
 *
 * Codex scratch directories are folded so they do not explode into one group
 * per conversation: chat scratch dirs collapse to a single shared bucket, and
 * a worktree copy reports the project name it mirrors so it can be matched to
 * that project's workspace by name rather than by its hashed path.
 *
 * @param cwd - the session's recorded working directory.
 * @returns the grouping key, the path to display, and an optional project
 *   name to match against workspace basenames.
 */
export declare function groupingPath(cwd: string): {
    normalized: string;
    display: string;
    nameHint?: string;
};
export type ImportSource = 'codex' | 'claude' | 'opencode' | 'pi';
export declare const IMPORT_SOURCES: readonly ImportSource[];
/** What the settings tab shows and acts on, per source tool. */
export interface ImportSourceStatus {
    source: ImportSource;
    /** The log location this source reads. */
    path: string;
    /** Whether that location exists on this machine. */
    available: boolean;
    /** Imported at least once (the user opted this source in). */
    imported: boolean;
    /** Follow newly written logs for this source in the background. */
    auto: boolean;
    /** Sessions currently held for this source. */
    count: number;
    /** Epoch ms of the last completed scan, if any. */
    scannedAt?: number;
}
/** Where each source tool keeps its logs on this machine. */
export declare function sourcePath(source: ImportSource): string;
interface HistoryEvent {
    seq: number;
    event: unknown;
}
/** mtime-indexed, persisted, incremental external-session store. */
export declare class ImportStore {
    private sessions;
    private readonly cache;
    private readonly cachePath;
    private scanning;
    /** Memoized project-directory existence, keyed by normalized path. */
    private readonly dirCache;
    /** Live-tail watcher, attached by the plugin when the importer is on. */
    private watcher;
    /** Sessions the most recent opencode scan refreshed (db-backed liveness). */
    private dbLive;
    /** Notified when an already-known session grows new turns. */
    private onGrowth;
    /**
     * Highest seq already pushed live, per session. Live numbering must rise
     * monotonically even though buildHistory renumbers from zero over a turn
     * list that shrinks back once a session is capped.
     */
    private readonly liveSeq;
    /** How many external sessions are currently held. */
    get size(): number;
    constructor(dataFile: string);
    /**
     * Attach the live-tail watcher. Kept out of the constructor so the store
     * still works (as a plain historical importer) when watching is impossible.
     * @param watcher - the watcher whose write records drive `running`.
     */
    attachWatcher(watcher: ImportWatcher): void;
    /**
     * Restore the persisted cache. Scanning is deliberately not part of load:
     * importing is a user decision, so nothing is read from the source tools
     * until a source is imported (or its auto-follow is on, which the caller
     * drives through {@link autoSources}).
     *
     * A cache written before per-source opt-in existed holds sessions but no
     * source records; those sources are adopted as already-imported so an
     * upgrade does not empty the tree.
     */
    load(): Promise<void>;
    /**
     * Treat sources already present in a pre-opt-in cache as imported.
     *
     * Without this an upgrade would silently hide sessions the user has been
     * seeing all along, since a cache from an older version records no consent.
     */
    private adoptLegacyCache;
    /** Per-source state as the settings tab presents it. */
    sourceStatus(): ImportSourceStatus[];
    /** Sources whose newly written logs should be followed in the background. */
    autoSources(): ImportSource[];
    /**
     * Import one source on request: marks it imported and scans it.
     *
     * @param source - the tool to read.
     * @param auto - whether to follow its new logs afterwards.
     * @returns how many sessions that source now holds.
     */
    importSource(source: ImportSource, auto: boolean): Promise<number>;
    /**
     * Drop one source: its sessions leave the tree and its opt-in is revoked.
     *
     * File mtimes for the source are cleared too, so a later re-import re-reads
     * the logs from scratch rather than trusting stale marks.
     */
    removeSource(source: ImportSource): Promise<void>;
    /** Turn background following on or off for an already-imported source. */
    setAuto(source: ImportSource, auto: boolean): Promise<void>;
    /** Re-scan changed/new files (cheap when nothing changed). */
    rescan(enabled: ImportSource[]): Promise<void>;
    private runScan;
    /**
     * Rebuild the id index from the parsed cache, sanitizing turns on the way
     * in.
     *
     * Cleaning happens here rather than in each parser because every source
     * funnels through this point, and because it also repairs caches written by
     * earlier versions that stored the raw control records.
     */
    private rebuildIndex;
    /**
     * Announce turns that appeared since the previous index.
     *
     * The tree learns about new sessions by re-reading `session.list`, but an
     * *open* conversation only ever grows from `session/event` frames. Without
     * this the watcher would keep the running dot honest while the transcript
     * below it stayed frozen until the user reloaded the page.
     *
     * Only the tail is emitted, carrying the same seq numbering `buildHistory`
     * assigns, so the official client's seq-dedup stitches it onto the history
     * it already holds exactly as it does for a remote session.
     *
     * @param previous - the session index as it was before this rebuild.
     */
    private emitGrowth;
    /**
     * The seq the next live event of this session must carry.
     *
     * Pinned on first use to the length of the session's history as
     * {@link buildHistory} numbers it, then advanced only by live pushes — so
     * it stays contiguous with what the client loaded even as the underlying
     * turn list is capped and renumbers itself.
     *
     * @param id - hub session id.
     * @param session - the session's current parsed form.
     * @returns the seq to assign to the next emitted event.
     */
    private seqBase;
    /**
     * Subscribe to turns appearing in already-known sessions.
     * @param listener - receives the session id and one official history event.
     */
    onSessionGrowth(listener: (sessionId: string, event: unknown) => void): void;
    /** Persist the parsed cache (deferred debounce handled by caller). */
    persist(): Promise<void>;
    sessionById(sessionId: string): ImportedSession | undefined;
    /**
     * Record that an imported session was promoted to a real DSH session.
     *
     * The imported copy is hidden from then on: the conversation now lives in a
     * session the harness owns, and showing both would duplicate it in the
     * tree. The mapping is persisted so the copy does not come back on restart.
     *
     * @param sessionId - the imported session id.
     * @param realId - the DSH session it became.
     */
    markPromoted(sessionId: string, realId: string): void;
    /**
     * Whether a project directory was declined by the user.
     *
     * Deleting a workspace is a statement that the project should not be in the
     * tree; without remembering it, the next scan would adopt the directory
     * again and the group would reappear.
     *
     * @param path - the project directory.
     * @returns true when the path must stay out of the tree.
     */
    isDeclined(path: string): boolean;
    /**
     * Record that the user removed a project directory from the tree.
     * @param path - the project directory to stop surfacing.
     */
    decline(path: string): void;
    /**
     * Imported sessions visible to the official UI, newest first.
     *
     * Sessions whose project directory no longer exists are omitted: the work
     * they describe is gone, the directory cannot be adopted as a workspace,
     * and surfacing them only leaves dead groups in the tree. Directories the
     * user removed from the workspace list are omitted for the same reason, as
     * are sessions already promoted to a real DSH session.
     */
    visible(): ImportedSession[];
    /**
     * Whether a session's project directory still exists, memoized per path.
     *
     * `visible()` runs on every session.list and workspace.list, so the check
     * is cached: hundreds of sessions collapse to a few dozen distinct paths,
     * and the cache is cleared on each rescan so a restored directory comes
     * back without a restart.
     *
     * @param cwd - the session's recorded working directory.
     * @returns true when the directory is still present.
     */
    private projectExists;
    /** Hub session rows for the merged session.list. */
    rows(): SessionSummary[];
    /**
     * Whether this imported session's log is being written to right now.
     *
     * Liveness comes from the log file itself, not from the tool: all three
     * tools append while the conversation is still going, so a recent write is
     * the only evidence available — and the only one that needs no cooperation
     * from the tool. Sessions with no `sourceFile` (opencode is db-backed) fall
     * back to the db-level signal.
     * @param s - the imported session to test.
     * @returns true when its log was written within the activity window.
     */
    private isLive;
    /**
     * Assign every imported session to a workspace, given the official
     * workspace paths.
     *
     * A session belongs to the *longest* workspace path that contains its cwd,
     * so a session run in `D:/AI/proj/tools` lands in the `D:/AI/proj`
     * workspace rather than a broader `D:/AI` one. Sessions whose project has
     * no workspace at all are grouped by their own cwd, which the gateway then
     * surfaces as a synthetic project group — otherwise they would all collapse
     * into the ungrouped bucket.
     *
     * @param workspacePaths - official workspace paths (any separator style).
     * @returns ids per matched workspace path, plus leftovers keyed by cwd.
     */
    assign(workspacePaths: readonly string[]): {
        byWorkspace: Map<string, string[]>;
        orphansByCwd: Map<string, {
            path: string;
            ids: string[];
        }>;
    };
    /**
     * Generated HistoryEntries (read-only view).
     *
     * Mirrors `visible()`: a session hidden because its project directory is
     * gone must not stay openable through a stale id either.
     */
    history(sessionId: string): HistoryEvent[] | undefined;
}
export {};
