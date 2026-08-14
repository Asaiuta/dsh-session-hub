/**
 * Live-tail watcher for external tool logs.
 *
 * The three supported tools all append to their logs *while the conversation
 * is still going* (measured: a Codex rollout grew from 10 to 11 lines 27s
 * apart mid-session; a Claude project file spans 3.5 hours of timestamps;
 * opencode writes message rows seconds apart). So a session that is running
 * right now is observable from the log alone — no tool integration needed.
 *
 * This module only answers two questions:
 *   1. "something changed under these roots" → fire a debounced callback,
 *      which drives an immediate incremental rescan (the existing mtime path).
 *   2. "which sessions are being written to right now" → an activity index
 *      used to mark rows `running` in the session list.
 *
 * Four platform hazards were measured before writing this, and each is
 * handled here rather than assumed away:
 *
 *   - **Windows recursive watch works but is noisy.** One `writeFile` +
 *     one `appendFile` produced 4 events including a directory-level
 *     `change`. Everything is therefore debounced, never acted on per-event.
 *   - **Reads can land mid-line.** Consumers must cut at the last newline
 *     and carry the remainder; {@link completeLineEnd} exposes that cut.
 *   - **UTF-8 splits mid-codepoint.** Truncating `"你"` and calling
 *     `toString('utf8')` yields U+FFFD *irreversibly*, so the newline scan
 *     happens on the Buffer, before any decoding.
 *   - **opencode is SQLite in WAL mode.** Writes land in `-wal` first, so
 *     watching only the main db file misses them; both are watched.
 *
 * Watch handles are cheap: recursive mode covers a whole tree with one
 * handle (measured: 2 handles for both JSONL roots).
 */
import { watch, type FSWatcher } from 'node:fs'
import { existsSync } from 'node:fs'

/** How long a log must be quiet before its session stops counting as live. */
export const ACTIVE_WINDOW_MS = 90_000

/** Coalescing window for the noisy per-event storm described above. */
const DEBOUNCE_MS = 400

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
export function completeLineEnd(buf: Buffer): number {
  const nl = buf.lastIndexOf(0x0a)
  return nl < 0 ? -1 : nl + 1
}

/**
 * Collapse a path to one separator form.
 *
 * Watch events carry platform-native separators while parsers record paths as
 * they walked them (measured: Claude `sourceFile` values use backslashes on
 * Windows while the watch root arrives half-normalized). Comparing the two
 * verbatim never matches, which leaves every row permanently non-running —
 * so both the stored key and the lookup go through here.
 * @param path - any path fragment.
 * @returns the fragment with forward slashes and no trailing slash.
 */
function unifySeparators(path: string): string {
  const unified = path.replace(/\\/g, '/')
  return unified.endsWith('/') ? unified.slice(0, -1) : unified
}

/** One watched root and the disposer for its handle. */
interface WatchEntry {
  readonly path: string
  readonly watcher: FSWatcher
}

/**
 * Watches external log roots and reports *that* something changed, plus which
 * paths changed recently. Parsing stays with the importer: this class never
 * interprets log content, so a parser change cannot break watching and a
 * watch failure cannot corrupt the cache.
 */
export class ImportWatcher {
  private readonly entries: WatchEntry[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Absolute path → last time we saw a write to it. */
  private readonly touched = new Map<string, number>()
  private disposed = false

  /**
   * @param onChange - called after the debounce window whenever any watched
   *   root reported activity. Receives the paths touched in that window.
   */
  constructor(private readonly onChange: (paths: readonly string[]) => void) {}

  /**
   * Start watching one root. Missing roots and unsupported platforms are
   * skipped with a warning rather than throwing: losing live updates for one
   * tool must never take down the plugin.
   * @param root - directory (recursive) or single file to watch.
   */
  add(root: string): void {
    if (this.disposed || root === '' || !existsSync(root)) return
    const base = unifySeparators(root)
    if (this.entries.some(e => e.path === base)) return
    try {
      const watcher = watch(root, { recursive: true }, (_event, name) => {
        const full = typeof name === 'string' && name !== ''
          ? `${base}/${unifySeparators(name)}`
          : base
        this.touched.set(full, Date.now())
        this.schedule()
      })
      watcher.on('error', error => {
        console.warn(`[dsh-session-hub] import watch error on ${root}:`, error)
      })
      this.entries.push({ path: base, watcher })
    } catch (error) {
      console.warn(`[dsh-session-hub] cannot watch ${root} (live updates off for it):`, error)
    }
  }

  /**
   * Paths written to within {@link ACTIVE_WINDOW_MS}. Used to decide which
   * sessions render as running.
   * @returns normalized paths, most recent first.
   */
  activePaths(): readonly string[] {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS
    const live: Array<{ path: string, at: number }> = []
    for (const [path, at] of this.touched) {
      if (at >= cutoff) live.push({ path, at })
      else this.touched.delete(path)
    }
    live.sort((a, b) => b.at - a.at)
    return live.map(x => x.path)
  }

  /**
   * Last write time for one path, or 0 when it was never seen (or has gone
   * stale). Expired entries are dropped on read so the map cannot grow
   * without bound across a long-lived process.
   * @param path - absolute path, any separator style.
   * @returns epoch ms of the last write inside the activity window, else 0.
   */
  lastWrite(path: string): number {
    const key = unifySeparators(path)
    const at = this.touched.get(key)
    if (at === undefined) return 0
    if (Date.now() - at >= ACTIVE_WINDOW_MS) {
      this.touched.delete(key)
      return 0
    }
    return at
  }

  /** Stop all watchers and drop pending work. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    for (const entry of this.entries) {
      try {
        entry.watcher.close()
      } catch {
        // a watcher already torn down by the platform is not an error here
      }
    }
    this.entries.length = 0
  }

  /** Coalesce the event storm into one callback per quiet window. */
  private schedule(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      const paths = this.activePaths()
      try {
        this.onChange(paths)
      } catch (error) {
        console.error('[dsh-session-hub] import watch callback failed:', error)
      }
    }, DEBOUNCE_MS)
  }
}
