/**
 * Hub view state shared across the sidebar directory tree and the main
 * conversation pane: the currently selected remote session. The tree lives
 * in `sidebar.workspaces` (shadowing the official browser) and the
 * conversation in `conversation` (shadowing the official chat), so the two
 * components cannot talk through props and share state through this module.
 */

import type { ServerId } from '../contract.ts'

type Listener = () => void

/** A selected remote session (server + session identifiers). */
export interface HubSelection {
  readonly serverId: ServerId
  readonly sessionId: string
}

let selected: HubSelection | null = null
const selectionListeners = new Set<Listener>()

export function getSelection(): HubSelection | null {
  return selected
}

/** Select (or clear, with null sessionId) a session for the conversation pane. */
export function selectSession(serverId: ServerId, sessionId: string | null): void {
  const next: HubSelection | null = sessionId === null
    ? null
    : { serverId, sessionId }
  if (selected?.serverId === next?.serverId && selected?.sessionId === next?.sessionId) return
  selected = next
  emit()
}

export function subscribeSelection(listener: Listener): () => void {
  selectionListeners.add(listener)
  return () => { selectionListeners.delete(listener) }
}

function emit(): void {
  for (const listener of [...selectionListeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-session-hub] selection listener threw:', error)
    }
  }
}
