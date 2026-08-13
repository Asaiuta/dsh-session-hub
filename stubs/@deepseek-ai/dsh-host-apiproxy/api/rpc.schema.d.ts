/** Typecheck stub: wire envelope schemas (@deepseek-ai/dsh-host-apiproxy/api/rpc.schema). */

import type { ServerRequest, RpcId } from '../index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

/** Parsed wire envelope; payload is the raw frame JSON re-typed by the frame schema. */
export interface ParsedServerRequest extends AnyRecord {
  rpcId: RpcId
  payload: unknown
}

export declare const serverRequestSchema: { parse(value: unknown): ParsedServerRequest }
export declare const serverResponseSchema: { parse(value: unknown): ParsedServerRequest }
export declare const clientRequestSchema: { parse(value: unknown): ParsedServerRequest }
export declare const clientResponseSchema: { parse(value: unknown): ParsedServerRequest }