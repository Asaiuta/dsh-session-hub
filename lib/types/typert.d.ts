/**
 * The hand-written host Typert manifest for the sessionHub Remote.
 * Registered through `ctx.typert.register` in the plugin body, it claims the
 * wire endpoints through the strict registry so the Host Gateway resolves and
 * invokes `sessionHub/<method>` without consulting the `@Remote` marker
 * table (marker independence matters when the harness source-launch gateway
 * and a profile-loaded plugin bundle hold separate decorator module state).
 */
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types';
/** The sessionHub namespace's host manifest (strict codecs shared with the client). */
export declare const TYPERT_MANIFEST: TypertContribution;
