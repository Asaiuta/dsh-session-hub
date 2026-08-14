/** dsh-session-hub Settings → Plugins tab styles: official CSS tokens
 * first, local fallbacks second — nothing overrides the official theme. */

const CSS = `
.dsh-hub-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-hub-settings * { box-sizing: border-box; }
.dsh-hub-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-hub-settings-intro {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #8b90a0);
  max-width: 660px;
}
.dsh-hub-settings-live {
  display: flex;
  align-items: center;
  min-height: 16px;
}
.dsh-hub-live-on {
  color: var(--dsw-alias-state-success-primary, #3ecf8e);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.dsh-hub-settings-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  border-radius: 12px;
  background: var(--dsw-alias-button-elevated-fill, #1b1e25);
}
.dsh-hub-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.dsh-hub-settings-head-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-hub-settings-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
}
.dsh-hub-server-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  min-height: 34px;
  flex: none;
}
.dsh-hub-server-row:hover { background: var(--dsw-alias-interactive-bg-hover, #1d2129); }
.dsh-hub-server-row .dsh-hub-btn {
  flex: none;
  padding: 2px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-hub-server-state {
  flex: none;
  min-width: 52px;
}
.dsh-hub-server-url {
  flex: none;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-hub-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #555);
  flex: none;
}
.dsh-hub-dot.connected { background: var(--dsw-alias-state-success-primary, #3ecf8e); }
.dsh-hub-dot.error { background: var(--dsw-alias-state-error-primary, #e5534b); }
.dsh-hub-dot.connecting { background: var(--dsw-alias-state-warn-primary, #d29922); animation: dsh-hub-pulse 1s infinite alternate; }
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
.dsh-hub-btn.primary {
  background: var(--dsw-alias-button-primary-fill, var(--dsh-hub-accent, #4c8dff));
  border-color: transparent;
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.dsh-hub-btn.primary:hover { filter: brightness(1.08); }
.dsh-hub-btn.icon {
  padding: 1px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
}
.dsh-hub-input {
  background: var(--dsw-alias-bg-layer-1, #101216);
  border: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  width: 100%;
  font-family: inherit;
}
.dsh-hub-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.dsh-hub-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, #2a2e38);
  border-radius: 8px;
}
.dsh-hub-form-actions { display: flex; gap: 6px; }
.dsh-hub-error { color: var(--dsw-alias-state-error-primary, #e5534b); font-size: 11px; }
.dsh-hub-live-off { color: var(--dsw-alias-state-error-primary, #e5534b); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }

/* Settings tab: model-sync card subtext and result line. */
.dsh-hub-settings-sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, #8b909c);
}
.dsh-hub-settings-result {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, #e8e9ed);
}

.dsh-hub-import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--dsw-alias-border-l2, #2a2e37);
}
.dsh-hub-import-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.dsh-hub-import-name { font-weight: 500; }
.dsh-hub-import-count {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #9aa0ab);
}
.dsh-hub-import-path {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.dsh-hub-import-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.dsh-hub-import-auto {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #9aa0ab);
  cursor: pointer;
}

.dsh-hub-modes { display: flex; gap: 4px; }
.dsh-hub-mode {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, #2a2e38);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  border-radius: 6px;
}
.dsh-hub-mode.active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06));
  color: var(--dsw-alias-label-primary, inherit);
  border-color: var(--dsw-alias-brand-primary, #4c8dff);
}
`

let injected = false

/** Inject the stylesheet once (idempotent). */
export function adoptStyles(): void {
  if (injected) return
  injected = true
  const style = document.createElement('style')
  style.id = 'dsh-session-hub-styles'
  const text = document.createTextNode(CSS)
  style.appendChild(text)
  document.head.appendChild(style)
}
