/**
 * WidgetShell — Shared CSS base and nav helper for all dashboard widgets.
 * Import WIDGET_BASE_CSS into each widget's template <style> block.
 */

export const WIDGET_BASE_CSS = /* css */`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    overflow: hidden;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .wgt-hdr {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 16px 0;
    flex-shrink: 0;
  }
  .wgt-icon { opacity: 0.45; flex-shrink: 0; }
  .wgt-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--km-text-secondary);
    flex: 1;
    letter-spacing: 0.025em;
  }
  .wgt-badge {
    font-size: 10px;
    font-family: var(--km-font-mono);
    font-weight: 600;
    color: var(--km-accent-hover);
    background: rgba(37,99,235,0.12);
    border: 1px solid rgba(37,99,235,0.25);
    padding: 1px 6px;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Body ───────────────────────────────────────────────────── */
  .wgt-body {
    flex: 1;
    overflow: hidden;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
  }
  .wgt-body.no-pad  { padding: 0; }
  .wgt-body.scroll  { overflow-y: auto; }

  /* ── Footer ─────────────────────────────────────────────────── */
  .wgt-footer {
    padding: 0 16px 14px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: 8px;
  }

  /* ── Buttons ────────────────────────────────────────────────── */
  .btn-link {
    background: none; border: none;
    color: var(--km-text-secondary);
    font-size: 11px; font-family: var(--km-font);
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 0;
    transition: color 0.15s;
  }
  .btn-link:hover { color: var(--km-text-primary); }
  .btn-link.accent { color: rgba(37,99,235,0.65); }
  .btn-link.accent:hover { color: var(--km-accent-hover); }

  .btn-sm {
    background: none;
    border: 1px solid var(--km-border);
    color: var(--km-text-secondary);
    font-size: 11px; font-family: var(--km-font);
    cursor: pointer;
    padding: 5px 10px; border-radius: 7px;
    display: inline-flex; align-items: center; gap: 5px;
    transition: all 0.15s;
  }
  .btn-sm:hover { border-color: var(--km-alpha-20); color: var(--km-text-primary); }
  .btn-sm.accent {
    border-color: rgba(37,99,235,0.35);
    color: var(--km-accent-hover);
    background: rgba(37,99,235,0.06);
  }
  .btn-sm.accent:hover {
    border-color: var(--km-accent);
    background: rgba(37,99,235,0.12);
  }
  .btn-primary {
    background: var(--km-accent);
    border: none; color: #fff;
    font-size: 12px; font-family: var(--km-font); font-weight: 500;
    cursor: pointer;
    padding: 7px 14px; border-radius: 8px;
    display: inline-flex; align-items: center; gap: 6px;
    transition: background 0.15s, transform 0.1s;
  }
  .btn-primary:hover { background: var(--km-accent-hover); }
  .btn-primary:active { transform: scale(0.97); }

  /* ── Empty state ────────────────────────────────────────────── */
  .empty {
    flex: 1;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; text-align: center; padding: 20px;
    color: var(--km-text-muted);
  }
  .empty-label { font-size: 12px; line-height: 1.5; }

  /* ── Divider ────────────────────────────────────────────────── */
  .sep {
    height: 1px;
    background: var(--km-border);
    margin: 0;
    flex-shrink: 0;
  }
`;

/**
 * Dispatch km-nav from inside a shadow DOM element.
 * @param {HTMLElement} host
 * @param {string} route
 */
export function navTo(host, route) {
  host.dispatchEvent(new CustomEvent('km-nav', {
    bubbles: true, composed: true,
    detail: { route },
  }));
}

/** Escape HTML special chars. */
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
