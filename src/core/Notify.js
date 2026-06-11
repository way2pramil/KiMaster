/**
 * Notify — thin wrapper around km-notification host.
 *
 * Safe to import from any module; reads the host element at call-time
 * so it works after DOM is ready regardless of module load order.
 *
 * @param {{ type?: 'success'|'warning'|'error'|'info', title?: string, message: string, duration?: number }} opts
 */
export function notify({ type = 'info', title = '', message, duration = 4000 } = {}) {
  const host = document.getElementById('notification-host');
  if (!host) return;
  const el = document.createElement('km-notification');
  el.setAttribute('type', type);
  if (title)   el.setAttribute('title', title);
  el.setAttribute('message', String(message ?? ''));
  el.setAttribute('duration', String(duration));
  host.appendChild(el);
}
