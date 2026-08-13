/** Typecheck stubs for @deepseek-ai/dsh-typert-protocol. */

import type { Context } from '@deepseek-ai/cordis'
import type { Service } from '@deepseek-ai/cordis'
import type { ZodType } from 'zod'

/** Result envelope of a Remote call (same shape as RpcResult). */
export type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

/** One strict wire parameter codec. */
export interface InvocationParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: { mode: 'strict'; typeSymbol: string; schema: ZodType }
}

/** One strict wire endpoint descriptor. */
export interface InvocationDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { kind: 'direct' }
  readonly parameters: readonly InvocationParameter[]
  readonly result: { mode: 'strict'; typeSymbol: string; schema: ZodType }
}

/** Client contribution handed to `ctx.remote.$mount`. */
export interface TypertRemoteContribution {
  readonly package: string
  readonly descriptors: readonly InvocationDescriptor[]
}

/** Namespace map merge point (client augmentations). */
export interface TypertRemoteNamespaceMap {}
/** Method map merge point (client augmentations). */
export interface TypertRemoteMap {}

/** The `ctx.remote` service face the client half uses. */
export interface RemoteService {
  $mount(contribution: TypertRemoteContribution): Promise<() => void>
  $on(event: string, listener: (...args: unknown[]) => void): () => void
  $dispatch(event: string, args: readonly unknown[]): void
}

/** Host-side Remote service base class. */
export class TypertRemoteService extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name)
  }
}

/** Marks a host Remote method for gateway source-mode discovery.
 *  Standard (TC39) method decorator: `@Remote` or `@Remote('exportName')`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Remote(method: any, context: any): void

declare module '@deepseek-ai/cordis' {
  interface Context {
    remote: RemoteService
  }
}