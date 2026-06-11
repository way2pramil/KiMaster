/**
 * @module PluginSlot
 * @summary Shared "Plugin" status row used by both the Bridge page and
 *          the Settings → Bridge tab.
 *
 * Renders: install status (green/orange dot) + path + one action button
 *          (Install / Reinstall). Shows a transient inline result line
 *          and dispatches a toast notification on action.
 *
 * Same logic, same IPC commands — just one implementation. The two
 * callers differ only in how they want results shown:
 *   - Bridge page:   toasts only (no inline result line)
 *   - Settings tab:  toasts + persistent inline result line under the slot
 */

import { invoke }                from '../../core/Ipc.js';
import { Logger }                from '../../core/Logger.js';
import {
  CHECK_PLUGIN_INSTALLED,
  REINSTALL_BRIDGE_PLUGIN,
}                                from '../../core/AppCommands.js';
import { installBridgePlugin }   from './BridgeClient.js';
import { notify }                from '../../core/Notify.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Render the plugin slot into `container`. Re-call to refresh.
 *
 * @param {Object}   opts
 * @param {HTMLElement} opts.container  - element to fill with the slot markup
 * @param {HTMLElement} [opts.resultEl] - optional element for inline result line;
 *                                        if omitted, only a toast is shown
 * @param {(type:'success'|'error', title:string, message:string) => void} [opts.notify]
 *                                        - optional override for toast notifier
 *                                        (used by SettingsPanel which fires
 *                                        a km-notify event instead)
 */
export async function renderPluginSlot({ container, resultEl, notify: notifyFn } = {}) {
  if (!container) return;

  container.innerHTML =
    '<div style="font-size:11px;color:var(--km-text-muted)">Checking…</div>';

  const showResult = (success, message) => {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = success
        ? `<span style="color:var(--km-trace)">✓ ${esc(message)}</span>`
        : `<span style="color:var(--km-red)">✗ ${esc(message)}</span>`;
    }
  };

  const fireNotify = (type, title, message) => {
    if (notifyFn) notifyFn(type, title, message);
    else notify({ type, title, message });
  };

  try {
    const status = await invoke(CHECK_PLUGIN_INSTALLED);

    if (status.installed) {
      container.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:var(--km-space-3);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:var(--km-font-size-sm);font-weight:500;color:var(--km-trace)">● Plugin installed</div>
            <div style="font-family:var(--km-font-mono);font-size:10px;color:var(--km-text-muted);margin-top:2px;word-break:break-all;">${esc(status.install_path)}</div>
          </div>
          <km-button variant="secondary" size="sm" data-plugin-action="reinstall" style="flex-shrink:0">Reinstall (clean)</km-button>
        </div>`;
    } else {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:var(--km-space-3);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:var(--km-font-size-sm);font-weight:500;color:var(--km-warning)">○ Plugin not installed</div>
            <div style="font-family:var(--km-font-mono);font-size:10px;color:var(--km-text-muted);margin-top:2px;">${esc(status.install_path)}</div>
          </div>
          <km-button variant="primary" size="sm" data-plugin-action="install" style="flex-shrink:0">Install Plugin</km-button>
        </div>`;
    }
  } catch (err) {
    container.innerHTML =
      '<span style="font-size:11px;color:var(--km-text-muted)">Could not check plugin status.</span>';
    Logger.error('PluginSlot', 'check plugin status failed', err);
    return;
  }

  const btn = container.querySelector('[data-plugin-action]');
  btn?.addEventListener('km-click', async () => {
    const action = btn.dataset.pluginAction;
    btn.setAttribute('loading', '');
    if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }

    try {
      const r = action === 'install'
        ? await installBridgePlugin().catch(e => ({ success: false, message: String(e) }))
        : await invoke(REINSTALL_BRIDGE_PLUGIN).catch(e => ({ success: false, message: String(e) }));

      showResult(r.success, r.message);
      fireNotify(
        r.success ? 'success' : 'error',
        r.success ? 'Plugin ready' : 'Install failed',
        r.message
      );
      // Re-render the slot so the button switches between Install / Reinstall
      await renderPluginSlot({ container, resultEl, notify: notifyFn });
    } catch (err) {
      const msg = String(err);
      showResult(false, msg);
      fireNotify('error', 'Install failed', msg);
      btn.removeAttribute('loading');
    }
  });
}
