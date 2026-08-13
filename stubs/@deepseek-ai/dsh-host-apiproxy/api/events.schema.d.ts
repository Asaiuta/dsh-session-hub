/** Typecheck stub: wire envelope schemas (@deepseek-ai/dsh-host-apiproxy/api/events.schema). */

import type { HostFrame, MuxFrame } from '../index'

export declare const muxFrameSchema: { parse(value: unknown): MuxFrame }
export declare const hostFrameSchema: { parse(value: unknown): HostFrame }