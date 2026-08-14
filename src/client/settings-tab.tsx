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
import type { HubSnapshot, ServerId } from '../contract.ts'
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
  const [baseUrl, setBaseUrl] = useState('')
  const [probe, setProbe] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const test = async (): Promise<void> => {
    if (hub === undefined || baseUrl.trim() === '') return
    setBusy(true)
    setProbe(null)
    try {
      const result = await hub.serversProbe({ baseUrl: baseUrl.trim() })
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
    if (hub === undefined || name.trim() === '' || baseUrl.trim() === '') return
    setBusy(true)
    try {
      const result = await hub.serversAdd({ name: name.trim(), baseUrl: baseUrl.trim() })
      if (result.ok) {
        setName('')
        setBaseUrl('')
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
      <input className="dsh-hub-input" placeholder={t('url')} value={baseUrl}
        onChange={e => setBaseUrl(e.target.value)} />
      <div className="dsh-hub-form-actions">
        <button type="button" className="dsh-hub-btn" disabled={busy || baseUrl.trim() === ''}
          onClick={() => { void test() }}>
          {t('test')}
        </button>
        <button type="button" className="dsh-hub-btn primary"
          disabled={busy || name.trim() === '' || baseUrl.trim() === ''}
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
}): JSX.Element {
  const [busy, setBusy] = useState(false)

  const createSession = async (): Promise<void> => {
    if (props.hub === undefined) return
    setBusy(true)
    try {
      await props.hub.sessionCreate({ serverId: props.serverId })
    } finally {
      setBusy(false)
    }
  }

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
      <span className="dsh-hub-muted dsh-hub-server-url" title={props.baseUrl}>{props.baseUrl}</span>
      <span className="dsh-hub-muted">{tf('sessionCount')(String(props.sessionCount))}</span>
      {props.state !== 'connected' && props.lastError !== undefined && (
        <span className="dsh-hub-error" title={props.lastError}>!</span>
      )}
      <button type="button" className="dsh-hub-btn icon" title={t('new')} disabled={busy}
        onClick={() => { void createSession() }}>
        <IconPlusOutline16 size={14} />
      </button>
      <button type="button" className="dsh-hub-btn icon" title={t('remove')} disabled={busy}
        onClick={() => { void removeServer() }}>
        <IconTrashOutline16 size={14} />
      </button>
    </div>
  )
}
