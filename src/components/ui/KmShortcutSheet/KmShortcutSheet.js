/**
 * @element km-shortcut-sheet
 * @summary Per plan §7.4 — a non-modal overlay listing every keybind and
 * gesture in the app. Toggled by the `?` shortcut or the omni-bar action
 * "Keyboard Shortcuts". Closes on Escape, click-outside, or pressing `?`
 * again.
 *
 * The chord list is passed in by the host (main.js exports GLOBAL_KEYMAP)
 * so the sheet always reflects the live keymap — no drift between what
 * the shortcuts do and what the sheet says.
 *
 * @attr {Array<{key:string,label:string,shift?:boolean,meta?:boolean,ctrl?:boolean,alt?:boolean}>} chords
 *        — array of keybind descriptors. Rendered as a grouped list, with
 *          the chord on the right (kbd-style) and the action on the left.
 *        — Use the `setChords(arr)` method to set after construction.
 *
 * Usage:
 *   const sheet = document.createElement('km-shortcut-sheet');
 *   sheet.chords = [{ key: 'd', label: 'Toggle density' }, ...];
 *   document.body.appendChild(sheet);
 */

const _isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function _formatChord(c) {
  const parts = [];
  if (c.meta)   parts.push(_isMac ? '⌘' : 'Ctrl');
  if (c.ctrl)   parts.push('Ctrl');
  if (c.alt)    parts.push(_isMac ? '⌥' : 'Alt');
  if (c.shift)  parts.push(_isMac ? '⇧' : 'Shift');
  let key = c.key;
  if (key === ' ')      key = 'Space';
  if (key === 'arrowup' || key === 'ArrowUp')      key = '↑';
  if (key === 'arrowdown' || key === 'ArrowDown')  key = '↓';
  if (key === 'arrowleft' || key === 'ArrowLeft')  key = '←';
  if (key === 'arrowright' || key === 'ArrowRight') key = '→';
  if (key === 'enter' || key === 'Enter')          key = '↵';
  if (key === 'escape' || key === 'Escape')        key = 'Esc';
  if (key === '?' && c.shift)                      key = '?';
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts;
}

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: contents; }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--km-z-palette, 700);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: sheet-overlay var(--km-duration-base) var(--km-ease-compress) both;
  }
  :host(:not([open])) .overlay { display: none; }

  .panel {
    width: min(640px, calc(100vw - 32px));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-lg);
    box-shadow: var(--km-shadow-xl), var(--km-bezel);
    overflow: hidden;
    animation: sheet-panel var(--km-duration-base) var(--km-ease-compress) both;
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-4) var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .header h1 {
    font-family: var(--km-font);
    font-size: var(--km-font-size-md);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    margin: 0;
    flex: 1;
  }
  .header .sub {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
  }

  .list {
    overflow-y: auto;
    padding: var(--km-space-3) 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--km-space-4);
    padding: var(--km-space-2) var(--km-space-5);
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .row:hover { background: var(--km-alpha-04); }
  .row .label {
    flex: 1;
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
  }
  .row .keys {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .row .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    box-shadow: 0 1px 0 var(--km-border-strong);
    font-family: var(--km-font-mono);
    font-size: 11px;
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
  }

  .group-label {
    padding: var(--km-space-3) var(--km-space-5) var(--km-space-1);
    font-size: 10px;
    font-weight: var(--km-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--km-text-muted);
  }

  .footer {
    padding: var(--km-space-3) var(--km-space-5);
    border-top: 1px solid var(--km-border);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    display: flex;
    justify-content: space-between;
    flex-shrink: 0;
  }

  @keyframes sheet-overlay {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes sheet-panel {
    from { opacity: 0; transform: translateY(-12px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }
</style>

<div class="overlay" id="overlay" role="presentation">
  <div class="panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <div class="header">
      <h1>Keyboard shortcuts</h1>
      <span class="sub">Press <span class="key" style="display:inline-flex;min-width:18px;height:18px;padding:0 4px;border-radius:3px;background:var(--km-bg-surface);border:1px solid var(--km-border);font-family:var(--km-font-mono);font-size:10px;align-items:center;justify-content:center;">?</span> to toggle</span>
    </div>
    <div class="list" id="list"></div>
    <div class="footer">
      <span>Keys adapt to your OS (⌘ on macOS, Ctrl elsewhere).</span>
      <span><span class="key" style="display:inline-flex;min-width:18px;height:18px;padding:0 4px;border-radius:3px;background:var(--km-bg-surface);border:1px solid var(--km-border);font-family:var(--km-font-mono);font-size:10px;align-items:center;justify-content:center;">Esc</span> to close</span>
    </div>
  </div>
</div>
`;

export class KmShortcutSheet extends HTMLElement {
  static get observedAttributes() { return ['open']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._onKey    = this._onKey.bind(this);
    this._onClick  = this._onClick.bind(this);
  }

  /** @param {Array<{key:string,label:string,shift?:boolean,meta?:boolean,ctrl?:boolean,alt?:boolean}>} chords */
  set chords(chords) { this.setChords(chords); }
  setChords(chords) {
    this._chords = chords ?? [];
    this._render();
  }

  connectedCallback() {
    document.addEventListener('keydown', this._onKey);
    this.shadowRoot.getElementById('overlay').addEventListener('click', this._onClick);
  }
  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
  }

  show() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); this.remove(); }

  attributeChangedCallback(name, _, val) {
    if (name === 'open' && val !== null) {
      this._render();
      requestAnimationFrame(() => this.shadowRoot.querySelector('.panel')?.focus());
    }
  }

  _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
  }
  _onClick(e) {
    // click on the overlay (not its children) closes
    if (e.target.id === 'overlay') this.close();
  }

  _render() {
    const list = this.shadowRoot.getElementById('list');
    if (!list) return;
    if (!this._chords?.length) {
      list.innerHTML = `<div class="row"><div class="label" style="color:var(--km-text-muted);">No keybinds registered.</div></div>`;
      return;
    }
    // The omni-bar chord (Cmd+K / Ctrl+K) is owned by KmCommandPalette, not
    // GLOBAL_KEYMAP, so we merge it in for completeness.
    const omniChord = { key: 'k', meta: true, label: _isMac ? 'Open omni-bar (action mode)' : 'Open omni-bar (action mode)' };
    const all = [omniChord, ...this._chords];

    list.innerHTML = `
      <div class="group-label">Global</div>
      ${all.map(c => `
        <div class="row">
          <div class="label">${_esc(c.label)}</div>
          <div class="keys">${_formatChord(c).map(k => `<span class="key">${_esc(k)}</span>`).join('')}</div>
        </div>
      `).join('')}
    `;
  }
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

if (!customElements.get('km-shortcut-sheet')) {
  customElements.define('km-shortcut-sheet', KmShortcutSheet);
}
