/**
 * The client-side Typert Remote contribution for the dsh-session-hub host
 * service: mounts the shared strict descriptors into `ctx.remote.sessionHub`.
 * The descriptors and codecs come from the shared contract module, so the
 * browser bundle and the host manifest stay on one wire definition.
 */
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionHubNamespaceFace } from './face.ts';
import type { ServerView, HubSnapshot, PendingRow, ServerId, HistoryEntry } from '../contract.ts';
/** The sessionHub Remote namespace's client contribution. */
export declare const SESSION_HUB_REMOTE: TypertRemoteContribution;
declare module '@deepseek-ai/dsh-typert-protocol' {
    /** The `sessionHub` namespace face mounted under `ctx.remote.sessionHub`. */
    interface TypertRemoteNamespace$73657373696f6e487562 extends SessionHubNamespaceFace {
    }
    interface TypertRemoteMap {
        'sessionHub/serversAdd': SessionHubNamespaceFace['serversAdd'];
        'sessionHub/serversRemove': SessionHubNamespaceFace['serversRemove'];
        'sessionHub/serversProbe': SessionHubNamespaceFace['serversProbe'];
        'sessionHub/snapshot': SessionHubNamespaceFace['snapshot'];
        'sessionHub/modelSync': SessionHubNamespaceFace['modelSync'];
        'sessionHub/importStatus': SessionHubNamespaceFace['importStatus'];
        'sessionHub/importAction': SessionHubNamespaceFace['importAction'];
    }
    interface TypertRemoteNamespaceMap {
        sessionHub: TypertRemoteNamespace$73657373696f6e487562;
    }
}
export type { ServerView, HubSnapshot, PendingRow, ServerId, HistoryEntry };
