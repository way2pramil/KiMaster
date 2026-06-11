/**
 * PadProperties — floating HTML panel showing properties of the selected pad.
 *
 * Reads from store.canvasSelectedIds and store.canvasElements.
 * Pushing changes writes to store.canvasMutations.
 *
 * @module PadProperties
 */

import { store, subscribe } from '../../../core/State.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { position: absolute; bottom: 8px; right: 8px; z-index: 10; }
  .panel { background: var(--km-surface); border: 1px solid var(--km-border);
           border-radius: 6px; padding: 8px 10px; min-width: 180px; display: none;
           font-size: 11px; font-family: var(--km-font); color: var(--km-text); }
  .panel.visible { display: block; }
  h4   { margin: 0 0 6px; font-size: 12px; font-weight: 600; }
  .row { display: flex; align-items: center; justify-content: space-between;
         gap: 8px; margin-bottom: 4px; }
  label  { color: var(--km-text-secondary); }
  input, select { background: var(--km-bg); border: 1px solid var(--km-border);
                  color: var(--km-text); border-radius: 3px; padding: 2px 4px;
                  font-size: 11px; width: 90px; }
  .multi { color: var(--km-text-secondary); font-style: italic; }
</style>
<div class="panel" id="panel">
  <h4 id="title">Pad</h4>
  <div id="body"></div>
</div>
`;

export class PadProperties extends HTMLElement {
  #panel; #title; #body;
  #unsubs = [];

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
      this.#panel = this.shadowRoot.getElementById('panel');
      this.#title = this.shadowRoot.getElementById('title');
      this.#body  = this.shadowRoot.getElementById('body');
    }
    this.#unsubs = [
      subscribe('canvasSelectedIds', () => this._update()),
      subscribe('canvasElements',    () => this._update()),
    ];
    this._update();
  }

  disconnectedCallback() {
    this.#unsubs.forEach(f => f());
  }

  _update() {
    const ids  = store.canvasSelectedIds;
    const els  = store.canvasElements;
    const pads = [...ids].map(id => els.find(e => e.id === id)).filter(e => e?.type === 'pad');

    if (!pads.length) {
      this.#panel.classList.remove('visible');
      return;
    }
    this.#panel.classList.add('visible');

    if (pads.length === 1) {
      this._renderSingle(pads[0]);
    } else {
      this.#title.textContent = `${pads.length} pads selected`;
      this.#body.innerHTML = `<div class="multi">Multiple pads — bulk edit coming in Phase 4</div>`;
    }
  }

  _renderSingle(pad) {
    this.#title.textContent = `Pad ${pad.number || '—'}`;
    this.#body.innerHTML = `
      <div class="row"><label>Number</label><input id="num" value="${_esc(pad.number ?? '')}"></div>
      <div class="row"><label>Net</label><input id="net" value="${_esc(pad.net ?? '')}"></div>
      <div class="row"><label>Shape</label>
        <select id="shape">
          ${['circle','oval','rect','roundrect'].map(s =>
            `<option value="${s}" ${pad.shape === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </div>
      <div class="row"><label>Width (mm)</label><input id="w" type="number" step="0.01" value="${pad.width ?? 1}"></div>
      <div class="row"><label>Height (mm)</label><input id="h" type="number" step="0.01" value="${pad.height ?? 1}"></div>
    `;

    const push = (op, field, value) => {
      const m = [...store.canvasMutations, { op, id: pad.id, [field]: value }];
      store.canvasMutations = m;
      store.canvasIsDirty   = true;
    };

    this.#body.querySelector('#num')?.addEventListener('change', (e) =>
      push('set_pad_number', 'num', e.target.value));
    this.#body.querySelector('#net')?.addEventListener('change', (e) =>
      push('set_pad_net', 'net', e.target.value));
    this.#body.querySelector('#shape')?.addEventListener('change', (e) =>
      push('set_pad_shape', 'shape', e.target.value));
    this.#body.querySelector('#w')?.addEventListener('change', (e) => {
      const v = parseFloat(e.target.value); if (isNaN(v)) return;
      push('resize_pad', 'w', v);
    });
    this.#body.querySelector('#h')?.addEventListener('change', (e) => {
      const v = parseFloat(e.target.value); if (isNaN(v)) return;
      push('resize_pad', 'h', v);
    });
  }
}

function _esc(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

customElements.define('km-pad-properties', PadProperties);
