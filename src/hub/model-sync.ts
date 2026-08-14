/**
 * Incremental model-config sync: hub → each connected server.
 *
 * The hub process shares its machine with the local dsh deployment, so the
 * local model catalog (settings namespaces `llm-*`, `agent-default-model`)
 * and the credential values (`process.env` / `$DSH_HOME/.credentials.yaml`)
 * are directly readable here. Each remote is read through its ServerLink
 * (`settings.describe` / `credentials.describe` — value-free views) and only
 * the *missing* pieces are written back: namespaces absent on the remote are
 * pushed as patches (`settings.update`, merge semantics), empty/nested keys
 * are filled in, and unconfigured credential references receive their local
 * value via `credentials.set` (the single wire direction for secrets).
 *
 * Sync is additive only — nothing the remote already has is overwritten or
 * deleted, and remote-only providers/models are left untouched. Secret
 * values never ride in the read direction: describe returns configured
 * flags, never values.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiProxy, RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { ServerLink } from './server-link.ts'
import type { ServerRegistry } from './registry.ts'

/** Settings namespaces that constitute the shared model configuration. */
const MODEL_NS = /^(llm-|agent-default-model)/

export interface ModelSyncEntry {
  serverId: string
  updated: string[]
  credentials: string[]
  skipped: string[]
}

interface LocalNamespace {
  value: Record<string, unknown>
  revision?: number
  apiKeyRefs: string[]
}

/** Resolve a local credential value: live env wins, then the credentials file. */
function resolveCredentialFile(dshHome: string): Record<string, string> {
  try {
    const text = readFileSync(join(dshHome, '.credentials.yaml'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

/** Collect every `apiKeyEnv` reference nested anywhere in a settings value. */
function collectApiKeyRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectApiKeyRefs(item, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'apiKeyEnv' && typeof child === 'string') out.push(child)
      else collectApiKeyRefs(child, out)
    }
  }
  return out
}

/**
 * Compute the additive patch: every leaf path whose value exists locally but
 * is absent (or empty) on the remote. Objects recurse; arrays are copied
 * only when the remote side is absent or empty (a non-empty remote array is
 * never overwritten — sync is additive by design).
 */
function missingPatch(
  local: unknown,
  remote: unknown,
  path: string[],
  patch: Record<string, unknown>,
): void {
  if (local === null || typeof local !== 'object') {
    if (remote === undefined) setAt(patch, path, local)
    return
  }
  if (Array.isArray(local)) {
    const isEmpty = Array.isArray(remote) && remote.length === 0
    if (remote === undefined || isEmpty) setAt(patch, path, local)
    return
  }
  const localObj = local as Record<string, unknown>
  for (const [key, value] of Object.entries(localObj)) {
    const remoteChild = (remote as Record<string, unknown> | undefined)?.[key]
    missingPatch(value, remoteChild, [...path, key], patch)
  }
}

function setAt(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node = root
  for (const seg of path.slice(0, -1)) {
    const next = node[seg]
    node = (next as Record<string, unknown> | undefined) ?? (node[seg] = {})
  }
  node[path[path.length - 1]] = value
}

/** Incremental model-config sync engine. */
export class ModelSyncService {
  private readonly fileCredentials: Record<string, string>
  private readonly lastAutoSync = new Map<string, number>()

  constructor(
    private readonly official: () => ApiProxy,
    private readonly registry: ServerRegistry,
    dshHome: string,
  ) {
    this.fileCredentials = resolveCredentialFile(dshHome)
  }

  private resolveCredential(ref: string): string | undefined {
    const env = process.env[ref]
    if (typeof env === 'string' && env !== '' && !env.startsWith('$')) return env
    return this.fileCredentials[ref]
  }

  private async localModelNamespaces(): Promise<Map<string, LocalNamespace>> {
    const out = new Map<string, LocalNamespace>()
    const api = this.official()
    const domain = (api as unknown as Record<string, Record<string, (r: { rpcId: RpcId; payload: unknown }) => Promise<{ result: { ok: boolean; value?: unknown } }>>>).settings
    if (domain === undefined || typeof domain.describe !== 'function') return out
    const response = await domain.describe({ rpcId: 'hub-model-sync' as RpcId, payload: {} })
    const result = response.result
    if (!result.ok) return out
    const namespaces = (result.value as { namespaces?: Array<{ ns: string; value?: unknown; revision?: number }> })?.namespaces ?? []
    for (const ns of namespaces) {
      if (!MODEL_NS.test(ns.ns) || typeof ns.value !== 'object' || ns.value === null) continue
      out.set(ns.ns, {
        value: ns.value as Record<string, unknown>,
        revision: ns.revision,
        apiKeyRefs: [...new Set(collectApiKeyRefs(ns.value))],
      })
    }
    return out
  }

  /** Sync one server; additive, missing-only. */
  async syncOne(link: ServerLink): Promise<ModelSyncEntry> {
    const entry: ModelSyncEntry = { serverId: link.id, updated: [], credentials: [], skipped: [] }
    const remoteDescribe = await link.wireCall('settings.describe', {})
    if (!remoteDescribe.ok) {
      entry.skipped.push('settings.describe')
      return entry
    }
    const remoteNs = new Map<string, { value?: unknown; revision?: number }>(
      ((remoteDescribe.value as { namespaces?: Array<{ ns: string; value?: unknown; revision?: number }> })?.namespaces ?? [])
        .map((ns) => [ns.ns, ns]),
    )

    const localNs = await this.localModelNamespaces()
    for (const [ns, local] of localNs) {
      const remote = remoteNs.get(ns)
      const patch: Record<string, unknown> = {}
      missingPatch(local.value, remote?.value, [], patch)
      if (Object.keys(patch).length > 0) {
        const write: Record<string, unknown> = { ns, patch }
        if (remote?.revision !== undefined) write.expectedRevision = remote.revision
        const applied = await link.wireCall('settings.update', write)
        if (applied.ok) entry.updated.push(ns)
        else entry.skipped.push(`settings.update:${ns}`)
      }
      // Credential references: fill unconfigured slots with local values.
      for (const ref of local.apiKeyRefs) {
        const remoteCreds = await link.wireCall('credentials.describe', { refs: [ref] })
        let configured = false
        if (remoteCreds.ok) {
          const creds = (remoteCreds.value as { credentials?: Record<string, { configured?: boolean }> } | undefined)?.credentials
          configured = creds?.[ref]?.configured ?? false
        }
        if (configured) continue
        const value = this.resolveCredential(ref)
        if (value === undefined) continue
        const set = await link.wireCall('credentials.set', { ref, value })
        if (set.ok) entry.credentials.push(ref)
        else entry.skipped.push(`credentials.set:${ref}`)
      }
    }
    return entry
  }

  /** Sync a specific server (or every connected link). */
  async sync(serverId?: string): Promise<{ synced: ModelSyncEntry[] }> {
    const links = this.registry.linkList().filter((link) => {
      if (serverId !== undefined) return link.id === serverId
      return link.stateView === 'connected'
    })
    const synced: ModelSyncEntry[] = []
    for (const link of links) synced.push(await this.syncOne(link))
    return { synced }
  }

  /**
   * Auto-sync watcher: call every few seconds; syncs a link once when it
   * transitions into `connected`, at most once per AUTO_SYNC_MIN_MS.
   */
  autoTick(): void {
    const now = Date.now()
    for (const link of this.registry.linkList()) {
      if (link.stateView !== 'connected') continue
      const last = this.lastAutoSync.get(link.id) ?? 0
      if (now - last < AUTO_SYNC_MIN_MS) continue
      this.lastAutoSync.set(link.id, now)
      void this.syncOne(link).catch(() => {
        // Never let a sync failure take the watcher down.
      })
    }
  }
}

const AUTO_SYNC_MIN_MS = 60_000
