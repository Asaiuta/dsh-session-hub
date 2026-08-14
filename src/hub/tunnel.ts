/**
 * SSH local-forward tunnels, managed inside the hub process.
 *
 * A remote `dsh web` only ever listens on its own loopback — the CLI refuses
 * to bind anything else, on the grounds that it would put remote code
 * execution on the network. The supported way to reach one is therefore an
 * SSH local forward, and until now the user had to run `ssh -N -L` by hand,
 * keep it alive, and remember which local port belonged to which server.
 *
 * This module does that part. A server entry configured with `ssh` gets a
 * listener on an OS-assigned loopback port whose connections are forwarded
 * over an authenticated SSH session to the remote's own 127.0.0.1. The
 * resulting `http://127.0.0.1:<port>` is what the rest of the hub treats as
 * the server's baseUrl, so nothing downstream needs to know a tunnel exists.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** How a server entry is reached. */
export interface SshTarget {
  /** Remote SSH host (name or IP). */
  readonly host: string
  /** SSH port; 22 unless given. */
  readonly port?: number
  readonly username: string
  /** Path to a private key; `~` is expanded. Omit to use the agent. */
  readonly privateKeyPath?: string
  /** Passphrase for an encrypted key. */
  readonly passphrase?: string
  /** Port `dsh web` listens on at the far end; 3080 unless given. */
  readonly remotePort?: number
}

export type TunnelState = 'connecting' | 'up' | 'error'

/** Reconnect backoff — same shape the server links use. */
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 15_000
const READY_TIMEOUT_MS = 20_000
const KEEPALIVE_MS = 15_000

/** Expand a leading `~` so users can write the path the way ssh accepts it. */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(homedir(), path.slice(2))
  return path
}

/**
 * One SSH connection plus the loopback listener that feeds it. Stays down
 * only if `stop()` was called; anything else is retried with backoff.
 */
export class SshTunnel {
  private conn: unknown
  private server: Server | undefined
  private localPort: number | undefined
  private state: TunnelState = 'connecting'
  private lastError: string | undefined
  private stopped = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly sockets = new Set<Socket>()

  constructor(
    private readonly target: SshTarget,
    private readonly notify: () => void,
  ) {}

  /** `http://127.0.0.1:<port>` once the listener is up, else undefined. */
  baseUrl(): string | undefined {
    return this.localPort === undefined ? undefined : `http://127.0.0.1:${this.localPort}`
  }

  status(): { state: TunnelState; localPort?: number; error?: string } {
    return {
      state: this.state,
      ...(this.localPort === undefined ? {} : { localPort: this.localPort }),
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
    }
  }

  /** Bring the tunnel up and keep it up. Resolves once the port is listening. */
  async start(): Promise<void> {
    this.stopped = false
    await this.open()
  }

  /** Tear everything down; no further retries. */
  stop(): void {
    this.stopped = true
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.teardown()
    this.state = 'error'
  }

  private teardown(): void {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server?.close()
    this.server = undefined
    this.localPort = undefined
    const conn = this.conn as { end?: () => void; destroy?: () => void } | undefined
    try {
      conn?.end?.()
    } catch {
      conn?.destroy?.()
    }
    this.conn = undefined
  }

  /** Schedule the next attempt unless we were stopped on purpose. */
  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== undefined) return
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_MAX_MS)
    this.attempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.open()
    }, delay + Math.random() * 250)
  }

  private fail(message: string): void {
    this.lastError = message
    this.state = 'error'
    this.teardown()
    this.notify()
    this.scheduleRetry()
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    this.state = 'connecting'
    this.notify()

    // ssh2 is loaded lazily so a hub with no ssh-backed servers never pays
    // for it, and a missing install degrades to a clear error on that entry
    // rather than breaking plugin load.
    let Client: new () => unknown
    try {
      ;({ Client } = (await import('ssh2')) as unknown as { Client: new () => unknown })
    } catch {
      this.lastError = 'ssh2 is not installed — reinstall the plugin, or use a direct URL'
      this.state = 'error'
      this.notify()
      return
    }

    let privateKey: Buffer | undefined
    if (this.target.privateKeyPath !== undefined && this.target.privateKeyPath !== '') {
      try {
        privateKey = readFileSync(expandHome(this.target.privateKeyPath))
      } catch (error) {
        // A bad key path is a configuration mistake: retrying cannot fix it,
        // so report it and stay down until the entry is edited.
        this.lastError = `cannot read the private key: ${error instanceof Error ? error.message : String(error)}`
        this.state = 'error'
        this.notify()
        return
      }
    }

    const conn = new Client() as {
      on: (event: string, handler: (...args: unknown[]) => void) => unknown
      connect: (config: Record<string, unknown>) => void
      forwardOut: (
        srcIp: string, srcPort: number, dstIp: string, dstPort: number,
        cb: (err: Error | undefined, stream: NodeJS.ReadWriteStream) => void,
      ) => void
      end: () => void
    }
    this.conn = conn

    const remotePort = this.target.remotePort ?? 3080

    const ready = new Promise<void>((res, rej) => {
      conn.on('ready', () => res())
      conn.on('error', (error) => rej(error instanceof Error ? error : new Error(String(error))))
      conn.on('close', () => {
        // A drop after we were up is a transport event, not a config error.
        if (!this.stopped && this.state === 'up') {
          this.lastError = 'ssh connection closed'
          this.state = 'error'
          this.teardown()
          this.notify()
          this.scheduleRetry()
        }
      })
      conn.connect({
        host: this.target.host,
        port: this.target.port ?? 22,
        username: this.target.username,
        ...(privateKey === undefined ? {} : { privateKey }),
        ...(this.target.passphrase === undefined ? {} : { passphrase: this.target.passphrase }),
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_MS,
      })
    })

    try {
      await ready
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
      return
    }
    if (this.stopped) {
      this.teardown()
      return
    }

    const server = createServer((socket: Socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => socket.destroy())
      conn.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort, (err, stream) => {
        if (err !== undefined && err !== null) {
          socket.destroy()
          return
        }
        socket.pipe(stream).pipe(socket)
        ;(stream as unknown as { on: (e: string, h: () => void) => void }).on('error', () => socket.destroy())
      })
    })
    this.server = server

    try {
      // Port 0 lets the OS pick, so two servers never collide and the user
      // never has to choose a number.
      await new Promise<void>((res, rej) => {
        server.once('error', rej)
        server.listen(0, '127.0.0.1', () => res())
      })
    } catch (error) {
      this.fail(`cannot open a local port: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const address = server.address()
    if (address === null || typeof address === 'string') {
      this.fail('the local forward did not report a port')
      return
    }
    this.localPort = address.port
    this.state = 'up'
    this.lastError = undefined
    this.attempt = 0
    this.notify()
  }
}

/**
 * Open a tunnel, wait for it, and hand back its base URL — used by the
 * add-server probe, which needs one round trip and no supervision.
 */
export async function probeTunnel(target: SshTarget): Promise<
  { ok: true; baseUrl: string; close: () => void } | { ok: false; error: string }
> {
  const tunnel = new SshTunnel(target, () => {})
  await tunnel.start()
  const status = tunnel.status()
  const baseUrl = tunnel.baseUrl()
  if (status.state !== 'up' || baseUrl === undefined) {
    tunnel.stop()
    return { ok: false, error: status.error ?? 'the tunnel did not come up' }
  }
  return { ok: true, baseUrl, close: () => tunnel.stop() }
}
