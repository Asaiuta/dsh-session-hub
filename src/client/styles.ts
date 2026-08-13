/** dsh-session-hub footer block styles: official CSS tokens first, local
 * fallbacks second — nothing overrides the official sidebar theme. */

const CSS = `
.dsh-hub-anchor {
  display: flex;
  flex-direction: column;
}
.dsh-hub-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 2px 4px;
  border-top: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  font-size: 13px;
  line-height: 1.4;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, inherit);
  background: transparent;
}
.dsh-hub-section * { box-sizing: border-box; }
.dsh-hub-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh-hub-section-title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, #8b90a0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-hub-section-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 170px;
  overflow: auto;
}
.dsh-hub-section-empty { padding: 4px 6px; }
.dsh-hub-server-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 6px;
  min-height: 26px;
  flex: none;
}
.dsh-hub-server-row:hover { background: var(--dsw-alias-interactive-bg-hover, #1d2129); }
.dsh-hub-server-row .dsh-hub-btn {
  flex: none;
  padding: 1px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  visibility: hidden;
}
.dsh-hub-server-row:hover .dsh-hub-btn { visibility: visible; }
.dsh-hub-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #555);
  flex: none;
}
.dsh-hub-dot.connected { background: var(--dsw-status-success-fg, #3ecf8e); }
.dsh-hub-dot.error { background: var(--dsw-status-danger-fg, #e5534b); }
.dsh-hub-dot.connecting { background: var(--dsw-status-warning-fg, #d29922); animation: dsh-hub-pulse 1s infinite alternate; }
@keyframes dsh-hub-pulse { from { opacity: 0.35; } to { opacity: 1; } }
.dsh-hub-server-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: inherit;
}
.dsh-hub-muted { color: var(--dsw-alias-label-secondary, #8b90a0); font-size: 11px; }
.dsh-hub-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--dsw-alias-label-secondary, #8b90a0);
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dsh-hub-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #1d2129); color: var(--dsw-alias-label-primary, inherit); }
.dsh-hub-btn:disabled { opacity: 0.45; cursor: default; }
.dsh-hub-btn.primary { background: var(--dsw-accent-ui, var(--dsh-hub-accent, #4c8dff)); border-color: transparent; color: #fff; }
.dsh-hub-btn.primary:hover { background: var(--dsw-accent-ui-hover, var(--dsh-hub-accent, #4c8dff)); }
.dsh-hub-btn.icon {
  padding: 1px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
}
.dsh-hub-input {
  background: var(--dsw-alias-input-fill, #101216);
  border: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  width: 100%;
  font-family: inherit;
}
.dsh-hub-input:focus { outline: none; border-color: var(--dsw-accent-ui, #4c8dff); }
.dsh-hub-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, #2a2e38);
  border-radius: 8px;
}
.dsh-hub-form-actions { display: flex; gap: 6px; }
.dsh-hub-error { color: var(--dsw-status-danger-fg, #e5534b); font-size: 11px; }
.dsh-hub-live-off { color: var(--dsw-status-danger-fg, #e5534b); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }

/* Collapsed-rail control: one icon seat mirroring the official icon-button
   geometry (36x36 circle, flex:none) with a status dot overlay. */
.dsh-hub-rail-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #8b90a0);
  cursor: pointer;
  position: relative;
}
.dsh-hub-rail-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #1d2129); color: var(--dsw-alias-label-primary, inherit); }
.dsh-hub-rail-btn .dsh-hub-dot {
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--dsw-specific-sidebar-fill, #17181c);
}

/* Popup (collapsed-rail menu): anchored above the rail seat, styled as the
   official popup surface. */
.dsh-hub-popup {
  position: absolute;
  left: 8px;
  bottom: calc(100% + 8px);
  width: 264px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  border-radius: 12px;
  background: var(--dsw-specific-popup-fill, var(--dsh-hub-bg, #1b1e25));
  box-shadow: var(--dsw-elevation-popup, 0 8px 24px rgba(0, 0, 0, 0.45));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.4;
  z-index: 60;
  box-sizing: border-box;
}
.dsh-hub-popup * { box-sizing: border-box; }
.dsh-hub-popup .dsh-hub-section-list { max-height: 220px; }
`

let injected = false

/** Inject the stylesheet once (idempotent). */
export function adoptStyles(): void {
  if (injected) return
  injected = true
  const style = document.createElement('style')
  style.id = 'dsh-session-hub-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}