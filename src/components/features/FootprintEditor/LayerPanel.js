/**
 * LayerPanel — layer visibility toggle overlay for the footprint editor.
 *
 * HTML `<details>` panel floating in the top-right corner.
 * Writes directly to store.canvasVisibleLayers on toggle.
 *
 * @module LayerPanel
 */

import { store, subscribe } from '../../../core/State.js';
import { LAYER_COLORS }     from '../../../modules/canvas/render/LayerManager.js';

const TOGGLEABLE_LAYERS = [
  'F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS',
  'F.Courtyard', 'B.Courtyard', 'F.Fab', 'B.Fab',
  'F.Paste', 'B.Paste', 'F.Mask', 'B.Mask',
  'Edge.Cuts',
];

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { position: absolute; top: 8px; right: 8px; z-index: 10; }
  details { background: var(--km-surface); border: 1px solid var(--km-border);
            border-radius: 6px; padding: 4px 0; min-width: 160px;
            font-size: 11px; font-family: var(--km-font); color: var(--km-text); }
  summary { padding: 4px 10px; cursor: pointer; user-select: none; font-weight: 500; }
  .rows   { padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; }
  .row    { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 2px 0; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  label   { cursor: pointer; flex: 1; }
  input   { cursor: pointer; accent-color: var(--km-accent); }
</style>
<details>
  <summary>Layers</summary>
  <div class="rows" id="rows"></div>
</details>
`;

export class LayerPanel extends HTMLElement {
  #rows;
  #unsub;

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
      this.#rows = this.shadowRoot.getElementById('rows');
      this._render();
    }
    this.#unsub = subscribe('canvasVisibleLayers', () => this._syncChecks());
  }

  disconnectedCallback() {
    this.#unsub?.();
  }

  _render() {
    this.#rows.innerHTML = TOGGLEABLE_LAYERS.map(l => {
      const color = '#' + ((LAYER_COLORS[l] ?? 0x666666) | 0x1000000).toString(16).slice(1);
      const vis   = store.canvasVisibleLayers.has(l);
      return `
        <label class="row">
          <input type="checkbox" data-layer="${l}" ${vis ? 'checked' : ''}>
          <span class="swatch" style="background:${color}"></span>
          <span>${l}</span>
        </label>`;
    }).join('');

    this.#rows.addEventListener('change', (e) => {
      const input = e.target;
      if (!input?.dataset.layer) return;
      const vis = new Set(store.canvasVisibleLayers);
      input.checked ? vis.add(input.dataset.layer) : vis.delete(input.dataset.layer);
      store.canvasVisibleLayers = vis;
    });
  }

  _syncChecks() {
    for (const cb of this.#rows?.querySelectorAll('input') ?? []) {
      cb.checked = store.canvasVisibleLayers.has(cb.dataset.layer);
    }
  }
}

customElements.define('km-layer-panel', LayerPanel);
