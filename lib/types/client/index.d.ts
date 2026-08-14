/**
 * dsh-session-hub client plugin: the browser half of the multi-server
 * session hub. It mounts the `sessionHub` Remote namespace, relays the hub
 * SSE frame stream into the *official* sessions runtime (so remote sessions
 * appear in the official workspace tree and open in the official
 * conversation pane — no UI replacement), and adds one Settings → Plugins
 * tab for server management.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type HubKey } from './locales.ts';
import type { HubSnapshot } from '../contract.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-session-hub section copy. */
        sessionHub: HubKey;
    }
}
/** Required services: slots, the gateway Remote face, locale, and the
 * official sessions + workspaces runtimes (frames are injected into them). */
export declare const inject: string[];
/**
 * Install the bridge + the Settings → Plugins "Session Hub" tab.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
export type { HubSnapshot };
