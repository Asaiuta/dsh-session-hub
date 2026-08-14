/**
 * Minimal ssh2 surface the tunnel uses. The real package ships its own types
 * via @types/ssh2, but this project typechecks against local stubs so that a
 * plain `npx tsc` works without a full dependency install.
 */

/// <reference types="node" />

export declare class Client {
  on(event: string, handler: (...args: any[]) => void): this
  connect(config: Record<string, unknown>): void
  forwardOut(
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number,
    cb: (err: Error | undefined, stream: NodeJS.ReadWriteStream) => void,
  ): void
  end(): void
  destroy(): void
}
