/**
 * Official sidebar footer block ("HUB servers" management). Renders native
 * to the official sidebar: in the expanded sidebar it is a compact server
 * list under a footer action strip; in the collapsed rail it is one icon
 * button whose popup hosts the same list. The official workspace tree and
 * conversation pane stay untouched — remote sessions arrive through the
 * gateway-merged /api/session.list and the frame bridge.
 */
import { useEffect, useState } from 'react'
import { IconGlobeOutline14, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Shared polling + live-refresh hook for the section and the rail popup. */
function useSnapshot(hub: SessionHubNamespaceFace | undefined): {
  snapshot: HubSnapshot | null
  error: string | null
} {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(getLiveStatus())

  useEffect(() => subscribeLiveStatus(setLive), [])

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

  void live // status surfaced by the caller via a second hook subscription
  return { snapshot, error }
}

/** Sidebar footer entry: wide = inline list, rail = icon button + popup. */
export function ServerSection(props: {
  hub: () => SessionHubNamespaceFace | undefined
  wide?: boolean
}): JSX.Element {
  const hub = props.hub()
  const [open, setOpen] = useState(false)
  const { snapshot, error } = useSnapshot(hub)

  // Close the popup on outside clicks.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.dsh-hub-anchor') === null) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (props.wide === false) {
    return (
      <div className="dsh-hub-anchor" style={{ position: 'relative' }}>
        <button
          type="button"
          className="dsh-hub-rail-btn"
          title={t('servers')}
          onClick={() => setOpen(v => !v)}
        >
          <IconGlobeOutline14 size={18} />
          {snapshot !== null && snapshot.servers.length > 0 && (
            <span className={`dsh-hub-dot ${snapshot.servers.every(s => s.state === 'connected') ? 'connected' : 'error'}`} />
          )}
        </button>
        {open && (
          <ServerList
            hub={hub}
            snapshot={snapshot}
            error={error}
            popup
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="dsh-hub-anchor" style={{ width: '100%' }}>
      <ServerList hub={hub} snapshot={snapshot} error={error} />
    </div>
  )
}

function ServerList(props: {
  hub: SessionHubNamespaceFace | undefined
  snapshot: HubSnapshot | null
  error: string | null
  popup?: boolean
  onClose?: () => void
}): JSX.Element {
  const { hub, snapshot, error, popup, onClose } = props
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [probe, setProbe] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(getLiveStatus())

  useEffect(() => subscribeLiveStatus(setLive), [])

  const servers = snapshot?.servers ?? []
  const sessions = snapshot?.sessions ?? []

  const reset = (): void => {
    setName('')
    setBaseUrl('')
    setProbe(null)
    setAdding(false)
  }

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
      if (result.ok) reset()
      else setProbe(tf('probeFail')(result.error.message))
    } catch (e) {
      setProbe(tf('probeFail')(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const className = popup ? 'dsh-hub-popup' : 'dsh-hub-section'

  return (
    <div className={className}>
      <div className="dsh-hub-section-head">
        <span className="dsh-hub-section-title">{t('servers')}</span>
        {live !== 'live' && (
          <span className="dsh-hub-live-off" title={tf('liveOffHint')()}>{t('liveOff')}</span>
        )}
        <button
          type="button"
          className="dsh-hub-btn"
          onClick={() => {
            if (!adding) {
              setProbe(null)
              setAdding(true)
            } else {
              setAdding(false)
            }
          }}
        >
          <IconPlusOutline16 size={14} />
        </button>
      </div>
      {adding && (
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
            <button type="button" className="dsh-hub-btn primary" disabled={busy || name.trim() === '' || baseUrl.trim() === ''}
              onClick={() => { void add() }}>
              {t('add')}
            </button>
            <button type="button" className="dsh-hub-btn" disabled={busy} onClick={() => { reset(); onClose?.() }}>
              {t('cancel')}
            </button>
          </div>
          {probe !== null && <span className="dsh-hub-muted">{probe}</span>}
        </div>
      )}
      {error !== null && <div className="dsh-hub-error">{tf('actionError')(error)}</div>}
      <div className="dsh-hub-section-list">
        {servers.length === 0 && !adding && (
          <div className="dsh-hub-muted dsh-hub-section-empty">{t('noServers')}</div>
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

  return (
    <div className="dsh-hub-server-row">
      <span className={`dsh-hub-dot ${props.state}`} />
      <span className="dsh-hub-server-name" title={props.baseUrl}>{props.name}</span>
      <span className="dsh-hub-muted">{props.sessionCount}</span>
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