/**
 * @element km-command-palette
 * @summary Global Ctrl+K omni-bar — fuzzy search over routes, actions,
 *          and live board components, with a mode prefix to scope results.
 *
 * Activation: set `open` attribute or call `.show()`.
 * Keyboard:   ↑ ↓ navigate  |  Enter select  |  Escape close
 *
 * Items are provided via the `setItems(groups)` method:
 *   groups = [{ label: 'Pages', items: [{ id, label, icon, description, kbd, kind, action }] }]
 *
 * Mode prefix (typed at the start of the search box):
 *   `> foo`  — action mode (only items with kind === 'action')
 *   `/ foo`  — filter mode (items with kind === 'filter', or no kind)
 *   `foo`    — default (all items)
 *
 * @fires km-palette-select  — { item, mode } when an item is chosen
 */

import { createSearcher } from '../../../core/omni-search.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: contents; }
  :host(:not([open])) .overlay { display: none; }

  /* ── Overlay ── */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--km-z-palette, 500);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: var(--km-backdrop-blur, none);
    -webkit-backdrop-filter: var(--km-backdrop-blur, none);
    animation: pal-overlay var(--km-duration-fast) var(--km-ease-compress) both;
  }
  @keyframes pal-overlay {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ── Panel ── */
  .panel {
    width: 560px;
    max-width: calc(100vw - 32px);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border-strong, rgba(255,255,255,0.12));
    border-radius: var(--km-radius-lg);
    box-shadow: var(--km-shadow-lg), var(--km-bezel);
    overflow: hidden;
    animation: pal-panel var(--km-duration-base) var(--km-ease-compress) both;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 160px);
  }
  @keyframes pal-panel {
    from { opacity: 0; transform: translateY(-10px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)    scale(1);     }
  }

  /* ── Search input ── */
  .search-row {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-3) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .search-icon { color: var(--km-text-muted); flex-shrink: 0; display: flex; }
  .search {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-family: var(--km-font);
    font-size: var(--km-font-size-base);
    color: var(--km-text-primary);
    caret-color: var(--km-accent);
  }
  .search::placeholder { color: var(--km-text-muted); }
  .kbd-hint {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    flex-shrink: 0;
  }

  /* mode chip — shown in the search row when the user typed a prefix */
  .mode-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--km-radius-xs);
    background: var(--km-accent-muted);
    color: var(--km-accent);
    font-family: var(--km-font-mono);
    font-size: 11px;
    line-height: 1;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--km-accent) 40%, transparent);
  }
  .mode-chip[hidden] { display: none; }

  /* ── Results ── */
  .results {
    flex: 1;
    overflow-y: auto;
    max-height: 420px;
    padding: var(--km-space-1) 0;
  }
  .results::-webkit-scrollbar { width: 4px; }
  .results::-webkit-scrollbar-track { background: transparent; }
  .results::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 2px; }

  /* group label */
  .group-label {
    padding: var(--km-space-2) var(--km-space-4) var(--km-space-1);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* item row */
  .item {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: var(--km-space-2) var(--km-space-4);
    cursor: pointer;
    border-radius: 0;
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .item:hover, .item.active {
    background: var(--km-accent-muted);
  }
  .item.active .item-label { color: var(--km-accent); }

  .item-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--km-radius-sm);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--km-text-secondary);
  }
  .item.active .item-icon { background: var(--km-accent-muted); color: var(--km-accent); border-color: var(--km-accent); }

  .item-body { flex: 1; min-width: 0; }
  .item-label {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-desc {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* fuzzy match highlight */
  .match { color: var(--km-accent); font-weight: var(--km-font-weight-semibold); }

  /* keyboard shortcut badge */
  .item-kbd {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 18px;
    padding: 0 4px;
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    box-shadow: var(--km-bezel);
    font-size: 10px;
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }

  /* empty */
  .empty {
    padding: var(--km-space-8) var(--km-space-4);
    text-align: center;
    font-size: var(--km-font-size-sm);
    color: var(--km-text-muted);
  }

  /* footer */
  .footer {
    padding: var(--km-space-2) var(--km-space-4);
    border-top: 1px solid var(--km-border);
    display: flex;
    gap: var(--km-space-3);
    flex-shrink: 0;
  }
  .footer-hint {
    display: flex;
    align-items: center;
    gap: var(--km-space-1);
    font-size: 10px;
    color: var(--km-text-muted);
  }
</style>

<div class="overlay" id="overlay" role="presentation">
  <div class="panel" role="dialog" aria-modal="true" aria-label="Command Palette">

    <div class="search-row">
      <span class="search-icon">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="mode-chip" id="mode-chip" hidden></span>
      <input class="search" id="search" type="text" placeholder="Type > for actions · / for filters · name to search…" autocomplete="off" spellcheck="false"/>
      <span class="kbd-hint"><span class="key">Esc</span></span>
    </div>

    <div class="results" id="results" role="listbox"></div>

    <div class="footer">
      <span class="footer-hint">
        <span class="key">↑</span><span class="key">↓</span> navigate
      </span>
      <span class="footer-hint"><span class="key">↵</span> select</span>
      <span class="footer-hint"><span class="key">Esc</span> close</span>
      <span class="footer-hint" style="margin-left:auto;"><span class="key">></span> actions</span>
      <span class="footer-hint"><span class="key">/</span> filters</span>
    </div>

  </div>
</div>
`;

export class KmCommandPalette extends HTMLElement {
  static get observedAttributes() { return ['open']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    /** @type {Array<{label:string, items:Array}>} */
    this._groups    = [];
    /** All items flat, used as the search corpus. */
    this._corpus    = [];
    /** Search results after the current mode + query are applied. */
    this._flatItems = [];
    this._activeIdx = -1;
    this._query     = '';
    /** 'default' | 'action' | 'filter' */
    this._mode      = 'default';
    /** fuse.js searcher, rebuilt whenever setItems() is called. */
    this._searcher  = null;

    this._onKeyDown  = this._onKeyDown.bind(this);
    this._onOverlay  = this._onOverlay.bind(this);
  }

  connectedCallback() {
    document.addEventListener('keydown', this._onKeyDown);
    this.shadowRoot.getElementById('overlay').addEventListener('click', this._onOverlay);
    this.shadowRoot.getElementById('search').addEventListener('input', (e) => {
      this._query = e.target.value;
      this._applyMode(this._query);
      this._renderResults();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  attributeChangedCallback(name, _, val) {
    if (name === 'open' && val !== null) {
      this._query     = '';
      this._mode      = 'default';
      this._activeIdx = -1;
      const inp = this.shadowRoot.getElementById('search');
      inp.value = '';
      this._applyMode('');
      this._renderResults();
      requestAnimationFrame(() => inp.focus());
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  show() { this.setAttribute('open', ''); }

  close() { this.removeAttribute('open'); }

  /**
   * @param {Array<{label:string, items:Array<{id,label,icon?,description?,kbd?,kind?,tags?,action}>}>} groups
   */
  setItems(groups) {
    this._groups   = groups;
    this._corpus   = groups.flatMap(g => g.items);
    this._groupById = new Map();
    for (const g of groups) for (const it of g.items) this._groupById.set(it.id, g);
    this._searcher  = createSearcher(this._corpus);
    if (this.hasAttribute('open')) this._renderResults();
  }

  // ── Mode + query parsing ────────────────────────────────────────────────────

  /**
   * Inspect the raw query for a `>` or `/` mode prefix and update
   * `_mode` + strip the prefix from the effective search string.
   */
  _applyMode(raw) {
    const m = /^\s*([>/])\s*/.exec(raw ?? '');
    if (!m) { this._mode = 'default'; return; }
    this._mode = m[1] === '>' ? 'action' : 'filter';

    const chip = this.shadowRoot.getElementById('mode-chip');
    if (chip) { chip.textContent = m[1]; chip.hidden = false; }
  }

  /** Strip the mode prefix and return the remainder for the searcher. */
  _stripPrefix(raw) {
    return (raw ?? '').replace(/^\s*[>/]\s*/, '').trim();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _renderResults() {
    const results = this.shadowRoot.getElementById('results');
    const chip    = this.shadowRoot.getElementById('mode-chip');
    if (chip) {
      chip.hidden = this._mode === 'default';
      chip.textContent = this._mode === 'action' ? '>' : this._mode === 'filter' ? '/' : '';
    }

    // 1. Filter the corpus by the active mode.
    const filtered = this._mode === 'action'
      ? this._corpus.filter(it => it.kind === 'action')
      : this._mode === 'filter'
        ? this._corpus.filter(it => it.kind !== 'action')
        : this._corpus;

    // 2. Run fuzzy search over the mode-filtered set.
    const searcher = createSearcher(filtered);
    const stripped = this._stripPrefix(this._query);
    const hits     = searcher.search(stripped, 60);

    // 3. Group hits by their original group label, preserving display order.
    //    Use the id-based lookup because fuse.js may return clone objects whose
    //    reference is not in the original `groups[i].items` array.
    const groupOrder = this._groups.map(g => g.label);
    const grouped    = new Map();
    for (const g of this._groups) grouped.set(g.label, []);
    for (const hit of hits) {
      const g = this._groupById.get(hit.id) || this._groups[0];
      if (!g) continue;
      const bucket = grouped.get(g.label);
      if (bucket) bucket.push(hit);
    }
    const filteredGroups = [...grouped.entries()]
      .map(([label, items]) => ({ label, items }))
      .filter(g => g.items.length > 0 && groupOrder.includes(g.label));

    this._flatItems = hits;

    if (hits.length === 0) {
      results.innerHTML = `<div class="empty">No results for "<strong>${esc(stripped)}"</strong>${this._mode !== 'default' ? ` in <em>${this._mode}</em> mode` : ''}</div>`;
      this._activeIdx = -1;
      return;
    }

    if (this._activeIdx >= this._flatItems.length) this._activeIdx = 0;
    if (this._activeIdx < 0 && this._flatItems.length > 0) this._activeIdx = 0;

    let flatIdx = 0;
    results.innerHTML = filteredGroups.map(g => `
      <div class="group-label">${esc(g.label)}</div>
      ${g.items.map(item => {
        const idx      = flatIdx++;
        const isActive = idx === this._activeIdx;
        const label    = _renderWithMatches(item.label, item._matches, 'label');
        const desc     = item.description ? _renderWithMatches(item.description, item._matches, 'description') : '';
        const kbd      = item.kbd ? item.kbd.map(k => `<span class="key">${esc(k)}</span>`).join('') : '';
        const kindTag  = item.kind === 'action' ? '<span class="item-kbd"><span class="key">action</span></span>'
                       : item.kind === 'filter' ? '<span class="item-kbd"><span class="key">filter</span></span>' : '';
        return `
          <div class="item${isActive ? ' active' : ''}" data-idx="${idx}" role="option" aria-selected="${isActive}">
            <div class="item-icon">
              ${item.icon ? `<km-icon name="${esc(item.icon)}" size="sm"></km-icon>` : _defaultIcon()}
            </div>
            <div class="item-body">
              <div class="item-label">${label}</div>
              ${desc ? `<div class="item-desc">${desc}</div>` : ''}
            </div>
            ${kindTag || kbd ? `<div class="item-kbd">${kindTag}${kbd}</div>` : ''}
          </div>
        `;
      }).join('')}
    `).join('');

    for (const el of results.querySelectorAll('.item[data-idx]')) {
      el.addEventListener('click', () => this._selectIdx(+el.dataset.idx));
    }
    this._scrollActive();
  }

  _scrollActive() {
    const el = this.shadowRoot.querySelector(`.item[data-idx="${this._activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  _selectIdx(idx) {
    const item = this._flatItems[idx];
    if (!item) return;
    this.close();
    this.dispatchEvent(new CustomEvent('km-palette-select', {
      bubbles: true, composed: true,
      detail: { item, mode: this._mode },
    }));
    item.action?.();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    // Global Ctrl+K / Cmd+K to open
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      this.hasAttribute('open') ? this.close() : this.show();
      return;
    }

    if (!this.hasAttribute('open')) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this._activeIdx = Math.min(this._activeIdx + 1, this._flatItems.length - 1);
        this._updateActive();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._activeIdx = Math.max(this._activeIdx - 1, 0);
        this._updateActive();
        break;
      case 'Enter':
        e.preventDefault();
        if (this._activeIdx >= 0) this._selectIdx(this._activeIdx);
        break;
    }
  }

  _updateActive() {
    const results = this.shadowRoot.getElementById('results');
    results.querySelectorAll('.item').forEach((el, i) => {
      const active = i === this._activeIdx;
      el.classList.toggle('active', active);
      el.querySelector('.item-label')?.classList.toggle('active', active);
    });
    this._scrollActive();
  }

  _onOverlay(e) {
    if (e.target === this.shadowRoot.getElementById('overlay')) this.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/**
 * Render a string with fuse.js match indices wrapped in <span class="match">.
 * Falls back to plain escaped text when no indices are available.
 *
 * @param {string} text
 * @param {Array<{ key: string, indices: Array<[number, number]> }>} [matches]
 * @param {string} [key]  — only use matches that target this key
 */
function _renderWithMatches(text, matches, key) {
  if (!matches || !text) return esc(text);
  const m = matches.find(m => m.key === key);
  if (!m || !m.indices || m.indices.length === 0) return esc(text);

  let out = '';
  let cursor = 0;
  for (const [start, end] of m.indices) {
    if (start > cursor) out += esc(text.slice(cursor, start));
    out += `<span class="match">${esc(text.slice(start, end + 1))}</span>`;
    cursor = end + 1;
  }
  if (cursor < text.length) out += esc(text.slice(cursor));
  return out;
}

function _defaultIcon() {
  return `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.3" opacity="0.5"/>
  </svg>`;
}

customElements.define('km-command-palette', KmCommandPalette);
