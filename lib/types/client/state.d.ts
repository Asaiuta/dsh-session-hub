/**
 * Hub view state shared across the sidebar directory tree and the main
 * conversation pane: the currently selected remote session. The tree lives
 * in `sidebar.workspaces` (shadowing the official browser) and the
 * conversation in `conversation` (shadowing the official chat), so the two
 * components cannot talk through props and share state through this module.
 */
import type { ServerId } from '../contract.ts';
type Listener = () => void;
/** A selected remote session (server + session identifiers). */
export interface HubSelection {
    readonly serverId: ServerId;
    readonly sessionId: string;
}
export declare function getSelection(): HubSelection | null;
/** Select (or clear, with null sessionId) a session for the conversation pane. */
export declare function selectSession(serverId: ServerId, sessionId: string | null): void;
export declare function subscribeSelection(listener: Listener): () => void;
export {};
