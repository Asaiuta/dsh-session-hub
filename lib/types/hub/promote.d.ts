/**
 * Promote an imported external-tool session into a real DSH session.
 *
 * Browsing an imported log is read-only by construction: the hub synthesizes
 * its history from Codex/Claude/opencode files it must never write back to.
 * Continuing the conversation is a different act — it needs a session the
 * harness owns, with a durable log of its own.
 *
 * Promotion is deliberately split in two. The session is minted through the
 * official `session.create`, so it gets the deployment's normal agent
 * composition, working directory and workspace attachment; only the history
 * is written here, through the same `append` the live agent uses. Nothing
 * hand-writes a log file, and no private apiProxy internals are reproduced —
 * the harness validates and persists every event as usual, so the result is
 * indistinguishable from a natively created session and outlives this plugin.
 *
 * Only conversation is carried across. Turns become `user/message` and
 * `assistant/message` surface events — the two the model actually reads — and
 * tool activity stays folded into the assistant text as the importers
 * rendered it. Synthesizing `tool/call`/`tool/result` pairs would mean
 * inventing DSH call ids and argument schemas for tools belonging to another
 * product, producing history the harness cannot act on.
 */
import type { ImportedSession } from './import-common.ts';
/** The subset of the official session store the promotion needs. */
export interface SessionStoreFace {
    get(id: string): {
        append(type: string, data: unknown, opts?: unknown): unknown;
    } | undefined;
}
/**
 * Replay an imported conversation into an existing, empty DSH session.
 *
 * @param store - the official session store (`ctx.sessions` on the host).
 * @param sessionId - the freshly created session to fill.
 * @param session - the parsed external session to replay.
 * @returns how many events were appended.
 */
export declare function replayInto(store: SessionStoreFace, sessionId: string, session: ImportedSession): number;
