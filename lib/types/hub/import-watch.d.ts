/** How long a log must be quiet before its session stops counting as live. */
export declare const ACTIVE_WINDOW_MS = 90000;
/**
 * Byte offset just past the last complete line, or -1 when the buffer holds
 * no complete line at all.
 *
 * Scans the Buffer directly: decoding first would corrupt a multi-byte
 * codepoint straddling the boundary, and that corruption cannot be undone
 * once the bytes are gone.
 * @param buf - raw bytes as read from the log.
 * @returns exclusive end offset of the last complete line, or -1.
 */
export declare function completeLineEnd(buf: Buffer): number;
/**
 * Watches external log roots and reports *that* something changed, plus which
 * paths changed recently. Parsing stays with the importer: this class never
 * interprets log content, so a parser change cannot break watching and a
 * watch failure cannot corrupt the cache.
 */
export declare class ImportWatcher {
    private readonly onChange;
    private readonly entries;
    private timer;
    /** Absolute path → last time we saw a write to it. */
    private readonly touched;
    private disposed;
    /**
     * @param onChange - called after the debounce window whenever any watched
     *   root reported activity. Receives the paths touched in that window.
     */
    constructor(onChange: (paths: readonly string[]) => void);
    /**
     * Start watching one root. Missing roots and unsupported platforms are
     * skipped with a warning rather than throwing: losing live updates for one
     * tool must never take down the plugin.
     * @param root - directory (recursive) or single file to watch.
     */
    add(root: string): void;
    /**
     * Paths written to within {@link ACTIVE_WINDOW_MS}. Used to decide which
     * sessions render as running.
     * @returns normalized paths, most recent first.
     */
    activePaths(): readonly string[];
    /**
     * Last write time for one path, or 0 when it was never seen (or has gone
     * stale). Expired entries are dropped on read so the map cannot grow
     * without bound across a long-lived process.
     * @param path - absolute path, any separator style.
     * @returns epoch ms of the last write inside the activity window, else 0.
     */
    lastWrite(path: string): number;
    /** Stop all watchers and drop pending work. */
    dispose(): void;
    /** Coalesce the event storm into one callback per quiet window. */
    private schedule;
}
