/**
 * Persistent server registry: the configured remote server list lives in a
 * JSON file under DSH_HOME/plugins, each entry maps to a live ServerLink.
 * The registry owns link lifecycle (create/update/remove) and emits the
 * merged snapshot the browser panel renders.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { HostFrame, MuxFrame } from '@deepseek-ai/dsh-host-apiproxy'
import type { HubSnapshot, PendingRow, RemoteSessionRow, ServerId, ServerView } from '../contract.ts'
import { HubEventBus, newEventToken } from './events.ts'
import { detectSelfLoop } from './self-loop.ts'
import { ServerLink } from './server-link.ts'
import { SshTunnel, type SshTarget } from './tunnel.ts'

/**
 * Persisted shape of the registry file. An ssh-backed entry stores its target
 * rather than a baseUrl: the local forward port is assigned by the OS on each
 * start, so yesterday's URL means nothing today.
 */
interface StoredServer {
  readonly id: ServerId
  readonly name: string
  /** Direct entries only. */
  readonly baseUrl?: string
  /** Tunnelled entries only. */
  readonly ssh?: SshTarget
}

interface StoredRegistry {
  readonly version: 1
  readonly servers: readonly StoredServer[]
}

const STORAGE_VERSION = 1 as const

export class ServerRegistry {
  private readonly links = new Map<ServerId, ServerLink>()
  /** Tunnels keyed by the server they serve; absent for direct entries. */
  private readonly tunnels = new Map<ServerId, SshTunnel>()
  /** SSH targets keyed by server, so persist() can write them back. */
  private readonly sshTargets = new Map<ServerId, SshTarget>()
  private readonly listeners = new Set<() => void>()
  private writeTimer: ReturnType<typeof setTimeout> | undefined

  /** Live frame fan-out; the SSE route subscribes here. */
  readonly events = new HubEventBus()
  /** Stable identity of this hub instance (changes on host restart). */
  readonly hubId = randomUUID()
  /** Random SSE credential; changes every host restart. */
  readonly eventToken = newEventToken()

  constructor(private readonly dataFile: string) {
    void this.load()
  }

  // ---- Lifecycle ----

  /**
   * Add a server, persist, and start its link. Rejects a self-loop (a baseUrl
   * pointing back at this same hub process — it would forward into itself and
   * wedge hub-local history).
   */
  async add(name: string, baseUrl: string): Promise<ServerView> {
    const normalized = normalizeBaseUrl(baseUrl)
    if (await detectSelfLoop(normalized, this.eventToken)) {
      throw new Error('self-loop: refusing to link the hub to itself')
    }
    const id = randomUUID() as ServerId
    const link = new ServerLink(id, normalized, name, () => this.emitChange(), this.frameHook(id))
    this.links.set(id, link)
    this.schedulePersist()
    link.start()
    this.emitChange()
    return link.toView()
  }

  /**
   * Add a server reached over an SSH local forward. The tunnel comes up
   * first, because its OS-assigned port is what the link's baseUrl is made
   * of; a tunnel that cannot start is a failed add, not a dead entry.
   */
  async addSsh(name: string, target: SshTarget): Promise<ServerView> {
    const id = randomUUID() as ServerId
    const tunnel = new SshTunnel(target, () => this.onTunnelChange(id))
    this.tunnels.set(id, tunnel)
    this.sshTargets.set(id, target)
    await tunnel.start()
    const baseUrl = tunnel.baseUrl()
    if (baseUrl === undefined) {
      const reason = tunnel.status().error ?? 'the tunnel did not come up'
      tunnel.stop()
      this.tunnels.delete(id)
      this.sshTargets.delete(id)
      throw new Error(`tunnel: ${reason}`)
    }
    if (await detectSelfLoop(baseUrl, this.eventToken)) {
      tunnel.stop()
      this.tunnels.delete(id)
      this.sshTargets.delete(id)
      throw new Error('self-loop: refusing to link the hub to itself')
    }
    const link = new ServerLink(id, baseUrl, name, () => this.emitChange(), this.frameHook(id))
    this.links.set(id, link)
    this.schedulePersist()
    link.start()
    this.emitChange()
    return link.toView()
  }

  /**
   * A tunnel changed state. When it comes back on a different port the link
   * is rebuilt against the new URL, which is what makes a dropped SSH
   * session heal without the user touching anything.
   */
  private onTunnelChange(id: ServerId): void {
    const tunnel = this.tunnels.get(id)
    const link = this.links.get(id)
    if (tunnel === undefined || link === undefined) {
      this.emitChange()
      return
    }
    const baseUrl = tunnel.baseUrl()
    if (baseUrl !== undefined && baseUrl !== link.toView().baseUrl) {
      const name = link.toView().name
      link.stop()
      const rebuilt = new ServerLink(id, baseUrl, name, () => this.emitChange(), this.frameHook(id))
      this.links.set(id, rebuilt)
      rebuilt.start()
    }
    this.emitChange()
  }

  /** Tunnel status for a server, if it has one. */
  tunnelStatus(id: ServerId): { state: string; localPort?: number; error?: string } | undefined {
    return this.tunnels.get(id)?.status()
  }

  /** Update display name and/or endpoint; a baseUrl change rebuilds the link. */
  update(id: ServerId, patch: { name?: string; baseUrl?: string }): ServerView {
    const link = this.require(id)
    const name = patch.name ?? link.toView().name
    const baseUrl = patch.baseUrl === undefined ? link.toView().baseUrl : normalizeBaseUrl(patch.baseUrl)
    if (patch.baseUrl !== undefined && baseUrl !== link.toView().baseUrl) {
      link.stop()
      const rebuilt = new ServerLink(id, baseUrl, name, () => this.emitChange(), this.frameHook(id))
      this.links.set(id, rebuilt)
      rebuilt.start()
    } else if (patch.name !== undefined) {
      // Link caches its display name at construction; rebuild is simplest for
      // the rare rename path too.
      const rebuilt = new ServerLink(id, baseUrl, name, () => this.emitChange(), this.frameHook(id))
      this.links.set(id, rebuilt)
      rebuilt.start()
    }
    this.schedulePersist()
    this.emitChange()
    return this.require(id).toView()
  }

  remove(id: ServerId): void {
    const tunnel = this.tunnels.get(id)
    if (tunnel !== undefined) {
      tunnel.stop()
      this.tunnels.delete(id)
      this.sshTargets.delete(id)
    }
    const link = this.links.get(id)
    if (link === undefined) return
    link.stop()
    this.links.delete(id)
    this.schedulePersist()
    this.emitChange()
  }

  /**
   * Rename a server's display name in place — no link rebuild, no
   * reconnect. Used by the official tree's workspace rename on virtual
   * server groups.
   */
  renameDisplay(id: ServerId, title: string): ServerView {
    const link = this.require(id)
    link.setName(title)
    this.schedulePersist()
    this.emitChange()
    return link.toView()
  }

  dispose(): void {
    for (const tunnel of this.tunnels.values()) tunnel.stop()
    this.tunnels.clear()
    this.sshTargets.clear()
    for (const link of this.links.values()) link.stop()
    this.links.clear()
    this.listeners.clear()
    if (this.writeTimer !== undefined) clearTimeout(this.writeTimer)
  }

  // ---- Reads ----

  serversList(): ServerView[] {
    return [...this.links.values()].map(link => {
      const view = link.toView()
      const tunnel = this.tunnels.get(view.id)
      const target = this.sshTargets.get(view.id)
      if (tunnel === undefined || target === undefined) return view
      const status = tunnel.status()
      return {
        ...view,
        tunnel: {
          state: status.state,
          ...(status.localPort === undefined ? {} : { localPort: status.localPort }),
          ...(status.error === undefined ? {} : { error: status.error }),
          target: {
            host: target.host,
            username: target.username,
            ...(target.port === undefined ? {} : { port: target.port }),
            ...(target.privateKeyPath === undefined ? {} : { privateKeyPath: target.privateKeyPath }),
            ...(target.remotePort === undefined ? {} : { remotePort: target.remotePort }),
          },
        },
      }
    })
  }

  /** Merged snapshot: servers, every session grouped by server, pending interactions. */
  snapshot(): HubSnapshot {
    const servers = this.serversList()
    const sessions: RemoteSessionRow[] = []
    const pending: PendingRow[] = []
    for (const server of servers) {
      const link = this.links.get(server.id)
      if (link === undefined) continue
      for (const row of link.sessionRows()) {
        sessions.push({ serverId: server.id, sessionId: row.sessionId, summary: row.summary })
      }
      pending.push(...link.pendingRows())
    }
    // Newest activity first across servers; stable per-server order.
    sessions.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
    return {
      hubId: this.hubId,
      eventToken: this.eventToken,
      servers,
      sessions,
      pending,
    }
  }

  /** Live configured links (every server view with a running link). */
  linkList(): ServerLink[] {
    return [...this.links.values()]
  }

  /** The link owning a session (by cached session id), or undefined. */
  findLinkBySession(sessionId: string): ServerLink | undefined {
    for (const link of this.linkList()) {
      if (link.sessionRows().some(row => row.sessionId === sessionId)) return link
    }
    return undefined
  }

  /** The link holding a pending interaction with this rpcId, or undefined. */
  findLinkByRpcId(rpcId: string): ServerLink | undefined {
    for (const link of this.linkList()) {
      if (link.pendingRows().some(row => row.rpcId === rpcId)) return link
    }
    return undefined
  }

  link(id: ServerId): ServerLink | undefined {
    return this.links.get(id)
  }

  /** Subscribe to any registry/link change; returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // ---- Persistence ----

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = readFileSync(this.dataFile, 'utf8')
    } catch {
      return // first run: no file yet
    }
    try {
      const parsed = JSON.parse(raw) as StoredRegistry
      if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.servers)) return
      for (const entry of parsed.servers) {
        if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
        const id = entry.id as ServerId

        if (entry.ssh !== undefined) {
          // Tunnelled entry: bring the forward up, then hang a link off
          // whatever port it landed on. A tunnel that fails here keeps
          // retrying in the background, so the entry recovers on its own
          // once the network or the far end comes back.
          const tunnel = new SshTunnel(entry.ssh, () => this.onTunnelChange(id))
          this.tunnels.set(id, tunnel)
          this.sshTargets.set(id, entry.ssh)
          await tunnel.start()
          const baseUrl = tunnel.baseUrl()
          if (baseUrl === undefined) {
            console.warn(`[dsh-session-hub] tunnel for "${entry.name}" is down: ${tunnel.status().error ?? 'unknown'}`)
            continue
          }
          const link = new ServerLink(id, baseUrl, entry.name, () => this.emitChange(), this.frameHook(id))
          this.links.set(id, link)
          link.start()
          continue
        }

        if (typeof entry.baseUrl !== 'string') continue
        const normalized = normalizeBaseUrl(entry.baseUrl)
        if (await detectSelfLoop(normalized, this.eventToken)) {
          console.warn(`[dsh-session-hub] skipping self-loop server "${entry.name}" (${normalized})`)
          continue
        }
        const link = new ServerLink(id, normalized, entry.name, () => this.emitChange(), this.frameHook(id))
        this.links.set(id, link)
        link.start()
      }
    } catch (error) {
      console.error('[dsh-session-hub] ignoring unparsable registry file:', this.dataFile, error)
    }
  }

  /** Tag a frame with its source server before fanning out. */
  private frameHook(id: ServerId): (rpcId: string, frame: MuxFrame | HostFrame) => void {
    return (rpcId, frame) => { this.events.publish(id, rpcId, frame) }
  }

  private schedulePersist(): void {
    if (this.writeTimer !== undefined) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      this.persist()
    }, 200)
  }

  private persist(): void {
    const stored: StoredRegistry = {
      version: STORAGE_VERSION,
      servers: [...this.links.values()].map(link => {
        const view = link.toView()
        const ssh = this.sshTargets.get(view.id)
        // A tunnelled entry's baseUrl is this run's forward port, which is
        // meaningless next time — persist the target instead.
        return ssh === undefined
          ? { id: view.id, name: view.name, baseUrl: view.baseUrl }
          : { id: view.id, name: view.name, ssh }
      }),
    }
    try {
      mkdirSync(dirname(this.dataFile), { recursive: true })
      const tmp = `${this.dataFile}.tmp`
      writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 })
      renameSync(tmp, this.dataFile)
    } catch (error) {
      console.error('[dsh-session-hub] failed to persist server registry:', error)
    }
  }

  private require(id: ServerId): ServerLink {
    const link = this.links.get(id)
    if (link === undefined) throw new Error(`dsh-session-hub: unknown server id ${JSON.stringify(id)}`)
    return link
  }

  private emitChange(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-session-hub] registry listener threw:', error)
      }
    }
  }
}

/** Accept http(s) origins; strip trailing slashes; reject anything else loud. */
export function normalizeBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error(`dsh-session-hub: invalid server URL ${JSON.stringify(input)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`dsh-session-hub: server URL must be http(s), got ${JSON.stringify(input)}`)
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`dsh-session-hub: server URL must be an origin (no path), got ${JSON.stringify(input)}`)
  }
  const origin = url.origin
  return origin.endsWith('/') ? origin.slice(0, -1) : origin
}