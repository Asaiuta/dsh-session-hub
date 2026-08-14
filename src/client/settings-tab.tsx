/**
 * Settings page: the "Session Hub" tab inside the official Plugins settings
 * section (`settings.plugins.tab` slot). Server connections are managed here
 * instead of the sidebar: add/remove/probe servers, per-server new session,
 * live SSE status. The official workspace tree and conversation pane stay
 * untouched — remote sessions arrive through the gateway-merged
 * /api/session.list and the frame bridge.
 */
import { useEffect, useState } from 'react'
import { IconPlusOutline16, IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HubSnapshot, ImportSourceStatusView, ServerId } from '../contract.ts'
import type { SessionHubNamespaceFace } from './face.ts'
import { getLiveStatus, subscribeLiveChanges, subscribeLiveStatus } from './live.ts'
import { en, zh, type HubDict, type HubKey } from './locales.ts'

// Locale pick (module-level by browser language; the harness locale service
// is out of scope for this scaffold).
const zhLocale = typeof navigator !== 'undefined'
  ? navigator.language.toLowerCase().startsWith('zh')
  : false
const dict: HubDict = zhLocale ? zh : en

function t(key: HubKey): string {
  const value = dict[key]
  return typeof value === 'function' ? '' : value
}

function tf(key: HubKey): (...args: string[]) => string {
  const value = dict[key]
  return typeof value === 'function' ? value : () => ''
}

const POLL_MS = 3000
const LIVE_REFRESH_DEBOUNCE_MS = 250

async function fetchSnapshot(
  hub: SessionHubNamespaceFace,
): Promise<HubSnapshot | null> {
  try {
    const result = await hub.snapshot({})
    return result.ok ? result.value : null
  } catch {
    return null
  }
}

/** Polling + live-change debounced refresh shared by the settings page. */
function useSnapshot(hub: SessionHubNamespaceFace | undefined): {
  snapshot: HubSnapshot | null
  error: string | null
} {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (hub === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeLiveChanges(() => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void (async () => {
          const next = await fetchSnapshot(hub)
          if (next !== null) setSnapshot(next)
        })()
      }, LIVE_REFRESH_DEBOUNCE_MS)
    })
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const result = await hub.snapshot({})
        if (!cancelled) {
          setSnapshot(result.ok ? result.value : null)
          setError(result.ok ? null : result.error.code)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void tick()
    const interval = setInterval(() => { void tick() }, POLL_MS)
    return () => {
      cancelled = true
      off()
      clearInterval(interval)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [hub])

  return { snapshot, error }
}

const STATE_KEY: Record<string, HubKey> = {
  connected: 'stateConnected',
  connecting: 'stateConnecting',
  error: 'stateError',
  stopped: 'stateStopped',
}

/**
 * Import card: one row per source tool, each imported on request.
 *
 * Scanning reads hundreds of log files and adds sessions to everyone's tree,
 * so it happens only when asked for. Following new logs afterwards is a
 * separate per-source choice, because wanting a tool's past conversations
 * does not imply wanting every future one.
 */
function ImportCard(props: { hub: SessionHubNamespaceFace | undefined }): JSX.Element {
  const hub = props.hub
  const [sources, setSources] = useState<ImportSourceStatusView[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (hub === undefined) return
    let alive = true
    void hub.importStatus({}).then(result => {
      if (alive && result.ok) setSources(result.value.sources)
    })
    return () => { alive = false }
  }, [hub])

  const act = async (
    source: string,
    action: 'import' | 'remove' | 'auto',
    auto?: boolean,
  ): Promise<void> => {
    if (hub === undefined || busy !== null) return
    setBusy(source)
    setError(null)
    try {
      const result = await hub.importAction({ source, action, ...auto === undefined ? {} : { auto } })
      if (result.ok) setSources(result.value.sources)
      else setError(result.error.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dsh-hub-settings-card">
      <div className="dsh-hub-settings-head">
        <span className="dsh-hub-settings-head-title">{t('imports')}</span>
      </div>
      <p className="dsh-hub-settings-sub">{t('importsIntro')}</p>
      {error !== null && <div className="dsh-hub-error">{tf('actionError')(error)}</div>}
      {sources.map(s => (
        <div key={s.source} className="dsh-hub-import-row">
          <div className="dsh-hub-import-main">
            <span className="dsh-hub-import-name">{t(`tool_${s.source}` as HubKey)}</span>
            {s.imported
              ? <span className="dsh-hub-import-count">{tf('sessionCount')(String(s.count))}</span>
              : <span className="dsh-hub-muted">{s.available ? t('notImported') : t('notInstalled')}</span>}
            <span className="dsh-hub-import-path" title={s.path}>{s.path}</span>
          </div>
          <div className="dsh-hub-import-actions">
            {s.imported && (
              <label className="dsh-hub-import-auto" title={t('autoScanHint')}>
                <input
                  type="checkbox"
                  checked={s.auto}
                  disabled={busy !== null}
                  onChange={e => void act(s.source, 'auto', e.currentTarget.checked)}
                />
                {t('autoScan')}
              </label>
            )}
            <button
              type="button"
              className="dsh-hub-btn"
              disabled={busy !== null || (!s.imported && !s.available)}
              onClick={() => void act(s.source, s.imported ? 'remove' : 'import', true)}
            >
              {busy === s.source
                ? t('importing')
                : s.imported ? t('removeImport') : t('doImport')}
            </button>
            {s.imported && (
              <button
                type="button"
                className="dsh-hub-btn"
                disabled={busy !== null}
                title={t('rescanHint')}
                onClick={() => void act(s.source, 'import', s.auto)}
              >
                <IconRefreshOutline16 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The "Session Hub" tab inside Settings → Plugins. */
export function SessionHubSettingsTab(props: {
  hub: () => SessionHubNamespaceFace | undefined
}): JSX.Element {
  const hub = props.hub()
  const { snapshot, error } = useSnapshot(hub)
  const [live, setLive] = useState(getLiveStatus())
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => subscribeLiveStatus(setLive), [])

  const runModelSync = async (): Promise<void> => {
    const h = hub
    if (h === undefined || syncing) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await h.modelSync({})
      if (result.ok) {
        const entries = result.value.synced
        const updated = entries.reduce((n, e) => n + e.updated.length, 0)
        const credentials = entries.reduce((n, e) => n + e.credentials.length, 0)
        const skipped = entries.reduce((n, e) => n + e.skipped.length, 0)
        setSyncResult(tf('modelSyncDone')(String(entries.length), String(updated), String(credentials), String(skipped)))
      } else {
        setSyncResult(tf('actionError')(result.error.message))
      }
    } finally {
      setSyncing(false)
    }
  }

  const servers = snapshot?.servers ?? []
  const sessions = snapshot?.sessions ?? []

  return (
    <div className="dsh-hub-settings">
      <h2 className="dsh-hub-settings-title">{t('title')}</h2>
      <p className="dsh-hub-settings-intro">{t('settingsIntro')}</p>
      <div className="dsh-hub-settings-live">
        <span className={live === 'live' ? 'dsh-hub-live-on' : 'dsh-hub-live-off'}
          title={tf('liveOffHint')()}>
          {live === 'live' ? `● ${t('stateConnected')}` : t('liveOff')}
        </span>
      </div>

      <div className="dsh-hub-settings-card">
        <div className="dsh-hub-settings-head">
          <span className="dsh-hub-settings-head-title">{t('modelSyncTitle')}</span>
          <button
            type="button"
            className="dsh-hub-btn"
            onClick={() => void runModelSync()}
            disabled={syncing}
          >
            <IconRefreshOutline16 size={14} />
            {syncing ? t('modelSyncRunning') : t('modelSyncRun')}
          </button>
        </div>
        <p className="dsh-hub-settings-sub">{t('modelSyncIntro')}</p>
        {syncResult !== null && <p className="dsh-hub-settings-result">{syncResult}</p>}
      </div>

      <ImportCard hub={hub} />

      <div className="dsh-hub-settings-card">
        <div className="dsh-hub-settings-head">
          <span className="dsh-hub-settings-head-title">{t('servers')}</span>
          <button
            type="button"
            className="dsh-hub-btn"
            onClick={() => setAdding(v => !v)}
          >
            <IconPlusOutline16 size={14} />
            {adding ? t('close') : t('addServer')}
          </button>
        </div>

        {adding && (
          <AddServerForm
            hub={hub}
            onDone={() => setAdding(false)}
          />
        )}

        {error !== null && <div className="dsh-hub-error">{tf('actionError')(error)}</div>}

        {servers.length === 0 && !adding && (
          <div className="dsh-hub-muted dsh-hub-settings-empty">
            {t('noServers')}
            <button type="button" className="dsh-hub-btn" onClick={() => setAdding(true)}>
              {t('addServer')}
            </button>
          </div>
        )}

        {servers.map(server => (
          <ServerRow
            key={server.id}
            hub={hub}
            serverId={server.id}
            name={server.name}
            state={server.state}
            lastError={server.lastError}
            baseUrl={server.baseUrl}
            tunnel={server.tunnel}
            sessionCount={sessions.filter(row => row.serverId === server.id).length}
          />
        ))}
      </div>
    </div>
  )
}

function AddServerForm(props: {
  hub: SessionHubNamespaceFace | undefined
  onDone: () => void
}): JSX.Element {
  const { hub, onDone } = props
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'ssh' | 'direct'>('ssh')
  const [baseUrl, setBaseUrl] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshKey, setSshKey] = useState('')
  const [sshRemotePort, setSshRemotePort] = useState('3080')
  const [probe, setProbe] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The remote's own `dsh web` only listens on its loopback, so an ssh entry
   * is the normal case: the hub opens the forward itself and the user never
   * picks a local port.
   */
  const sshTarget = (): { host: string; username: string; privateKeyPath?: string; remotePort?: number } => {
    const port = Number.parseInt(sshRemotePort, 10)
    return {
      host: sshHost.trim(),
      username: sshUser.trim(),
      ...(sshKey.trim() === '' ? {} : { privateKeyPath: sshKey.trim() }),
      ...(Number.isFinite(port) && port > 0 ? { remotePort: port } : {}),
    }
  }

  const ready = mode === 'direct'
    ? baseUrl.trim() !== ''
    : sshHost.trim() !== '' && sshUser.trim() !== ''

  const payload = (): { baseUrl?: string; ssh?: ReturnType<typeof sshTarget> } =>
    mode === 'direct' ? { baseUrl: baseUrl.trim() } : { ssh: sshTarget() }

  const test = async (): Promise<void> => {
    if (hub === undefined || !ready) return
    setBusy(true)
    setProbe(null)
    try {
      const result = await hub.serversProbe(payload())
      setProbe(result.ok
        ? (result.value.ok ? tf('probeOk')(result.value.version) : tf('probeFail')(result.value.error))
        : tf('probeFail')(result.error.message))
    } catch (e) {
      setProbe(tf('probeFail')(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const add = async (): Promise<void> => {
    if (hub === undefined || name.trim() === '' || !ready) return
    setBusy(true)
    try {
      const result = await hub.serversAdd({ name: name.trim(), ...payload() })
      if (result.ok) {
        setName('')
        setBaseUrl('')
        setSshHost('')
        setSshUser('')
        setSshKey('')
        setProbe(null)
        onDone()
      } else {
        setProbe(tf('probeFail')(result.error.message))
      }
    } catch (e) {
      setProbe(tf('probeFail')(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsh-hub-form">
      <input className="dsh-hub-input" placeholder={t('name')} value={name}
        onChange={e => setName(e.target.value)} />
      <div className="dsh-hub-modes">
        <button type="button" className={`dsh-hub-mode${mode === 'ssh' ? ' active' : ''}`}
          onClick={() => setMode('ssh')}>{t('modeSsh')}</button>
        <button type="button" className={`dsh-hub-mode${mode === 'direct' ? ' active' : ''}`}
          onClick={() => setMode('direct')}>{t('modeDirect')}</button>
      </div>
      {mode === 'direct'
        ? <input className="dsh-hub-input" placeholder={t('url')} value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)} />
        : <>
            <input className="dsh-hub-input" placeholder={t('sshHost')} value={sshHost}
              onChange={e => setSshHost(e.target.value)} />
            <input className="dsh-hub-input" placeholder={t('sshUser')} value={sshUser}
              onChange={e => setSshUser(e.target.value)} />
            <input className="dsh-hub-input" placeholder={t('sshKey')} value={sshKey}
              onChange={e => setSshKey(e.target.value)} />
            <input className="dsh-hub-input" placeholder={t('sshRemotePort')} value={sshRemotePort}
              onChange={e => setSshRemotePort(e.target.value)} />
            <span className="dsh-hub-muted">{t('sshHint')}</span>
          </>}
      <div className="dsh-hub-form-actions">
        <button type="button" className="dsh-hub-btn" disabled={busy || !ready}
          onClick={() => { void test() }}>
          {t('test')}
        </button>
        <button type="button" className="dsh-hub-btn primary"
          disabled={busy || name.trim() === '' || !ready}
          onClick={() => { void add() }}>
          {t('add')}
        </button>
        <button type="button" className="dsh-hub-btn" disabled={busy} onClick={onDone}>
          {t('cancel')}
        </button>
      </div>
      {probe !== null && <span className="dsh-hub-muted">{probe}</span>}
    </div>
  )
}

function ServerRow(props: {
  hub: SessionHubNamespaceFace | undefined
  serverId: ServerId
  name: string
  state: string
  lastError?: string
  baseUrl: string
  sessionCount: number
  tunnel?: { state: string; localPort?: number; error?: string; target: { host: string; username: string } }
}): JSX.Element {
  const [busy, setBusy] = useState(false)

  const removeServer = async (): Promise<void> => {
    if (props.hub === undefined) return
    setBusy(true)
    try {
      await props.hub.serversRemove({ id: props.serverId })
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = STATE_KEY[props.state] ?? 'stateStopped'

  return (
    <div className="dsh-hub-server-row">
      <span className={`dsh-hub-dot ${props.state}`} />
      <span className="dsh-hub-server-name" title={props.baseUrl}>{props.name}</span>
      <span className="dsh-hub-muted dsh-hub-server-state">{t(stateLabel)}</span>
      <span className="dsh-hub-muted dsh-hub-server-url" title={props.baseUrl}>
        {props.tunnel === undefined
          ? props.baseUrl
          : `${props.tunnel.target.username}@${props.tunnel.target.host}`}
      </span>
      {props.tunnel !== undefined && props.tunnel.state !== 'up' && (
        <span className="dsh-hub-error" title={props.tunnel.error ?? ''}>{t('tunnelDown')}</span>
      )}
      <span className="dsh-hub-muted">{tf('sessionCount')(String(props.sessionCount))}</span>
      {props.state !== 'connected' && props.lastError !== undefined && (
        <span className="dsh-hub-error" title={props.lastError}>!</span>
      )}
      {/* No "new session" button here: the official tree already offers one on
          this server's group, where the new session is immediately visible.
          A second entry point in a modal that gives no feedback was only ever
          a way to create sessions nobody could find. */}
      <button type="button" className="dsh-hub-btn icon" title={t('remove')} disabled={busy}
        onClick={() => { void removeServer() }}>
        <IconTrashOutline16 size={14} />
      </button>
    </div>
  )
}
