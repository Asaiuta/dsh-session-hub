/**
 * The client-side Typert Remote contribution for the dsh-session-hub host
 * service: mounts the shared strict descriptors into `ctx.remote.sessionHub`.
 * The descriptors and codecs come from the shared contract module, so the
 * browser bundle and the host manifest stay on one wire definition.
 */
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { SESSION_HUB_INVOCATIONS } from '../contract.ts'
import type { SessionHubNamespaceFace } from './face.ts'
import type { ServerView, HubSnapshot, PendingRow, ServerId, HistoryEntry } from '../contract.ts'

/** The sessionHub Remote namespace's client contribution. */
export const SESSION_HUB_REMOTE: TypertRemoteContribution = {
  package: 'dsh-session-hub',
  descriptors: SESSION_HUB_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  // Typed face of the mounted namespace. Note: the runtime access is NOT the
  // dotted `ctx.remote.sessionHub` read — that path walks the cordis fiber
  // chain and stops at the Loader's runtime-less internal forks between a
  // plugin entry and the root fiber. The plugin resolves the namespace
  // service through `ctx.reflect.get('remote.sessionHub')` instead (see
  // client/index.ts).
  /** The `sessionHub` namespace face mounted under `ctx.remote.sessionHub`. */
  interface TypertRemoteNamespace$73657373696f6e487562 extends SessionHubNamespaceFace {}
  interface TypertRemoteMap {
    'sessionHub/serversAdd': SessionHubNamespaceFace['serversAdd']
    'sessionHub/serversRemove': SessionHubNamespaceFace['serversRemove']
    'sessionHub/serversProbe': SessionHubNamespaceFace['serversProbe']
    'sessionHub/snapshot': SessionHubNamespaceFace['snapshot']
    'sessionHub/modelSync': SessionHubNamespaceFace['modelSync']
    'sessionHub/importStatus': SessionHubNamespaceFace['importStatus']
    'sessionHub/importAction': SessionHubNamespaceFace['importAction']
  }
  interface TypertRemoteNamespaceMap {
    sessionHub: TypertRemoteNamespace$73657373696f6e487562
  }
}

export type { ServerView, HubSnapshot, PendingRow, ServerId, HistoryEntry }