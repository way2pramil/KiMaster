/**
 * FootprintEditor — route component for the footprint canvas editor.
 *
 * Lifecycle:
 *   connectedCallback  → mount CanvasCore singleton, load mock (Phase 1)
 *   disconnectedCallback → unmount (suspend rendering, remove canvas from DOM)
 *
 * Ctrl+S → cmd_canvas_save_footprint (Phase 2, wired but no-op until Rust command exists)
 * F key  → zoom-to-fit (handled inside CanvasCore)
 *
 * @element km-footprint-editor
 */

import './LayerPanel.js';
import './PadProperties.js';
import { CanvasCore } from '../../../modules/canvas/core/CanvasCore.js';
import { invoke }     from '../../../core/Ipc.js';
import { store }      from '../../../core/State.js';
import { notify }     from '../../../core/Notify.js';
import {
  CANVAS_LOAD_FOOTPRINT,
  CANVAS_SAVE_FOOTPRINT,
  CANVAS_CLOSE,
  CANVAS_PICK_FOOTPRINT,
} from '../../../core/AppCommands.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    background: #0f0f0f;
    overflow: hidden;
  }
  #canvas-host {
    width: 100%;
    height: 100%;
  }
  .toolbar {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 6px;
    z-index: 10;
  }
  .status-bar {
    position: absolute;
    bottom: 8px;
    left: 8px;
    font-family: var(--km-font-mono);
    font-size: 10px;
    color: var(--km-text-muted);
    z-index: 10;
    pointer-events: none;
  }
  .dirty-dot {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--km-accent);
    margin-right: 4px;
    vertical-align: middle;
  }
</style>
<div id="canvas-host"></div>
<div class="toolbar">
  <km-button variant="secondary" size="sm" id="btn-open">Open…</km-button>
  <km-button variant="secondary" size="sm" id="btn-save" disabled>Save (Ctrl+S)</km-button>
  <km-button variant="secondary" size="sm" id="btn-fit">Fit (F)</km-button>
</div>
<km-layer-panel></km-layer-panel>
<km-pad-properties></km-pad-properties>
<div class="status-bar" id="status-bar">No file open</div>
`;

export class FootprintEditor extends HTMLElement {
  #core    = null;
  #onKey   = null;
  #unsubs  = [];
  #loaded  = false;

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
      this._wireButtons();
    }

    const host = this.shadowRoot.getElementById('canvas-host');
    this.#core = CanvasCore.get('footprint');

    // Async mount + load mock
    this.#core.mount(host).then(() => {
      if (!this.#loaded) {
        this._loadMock();
      }
    });

    // Ctrl+S
    this.#onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this._save();
      }
    };
    window.addEventListener('keydown', this.#onKey);

    // Dirty indicator
    this.#unsubs.push(
      import('../../../core/State.js').then(({ subscribe: sub }) => {
        return sub('canvasIsDirty', (dirty) => this._updateStatusBar(dirty));
      }),
    );
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.#onKey);
    this.#core?.unmount();
    // Close cleans up AppState symbol handle on route exit
    invoke(CANVAS_CLOSE).catch(() => {});
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _wireButtons() {
    const root = this.shadowRoot;
    root.getElementById('btn-open')?.addEventListener('km-click', () => this._openFile());
    root.getElementById('btn-save')?.addEventListener('km-click', () => this._save());
    root.getElementById('btn-fit')?.addEventListener('km-click',  () => {
      const els = store.canvasElements;
      if (els?.length) this.#core?.vpHelper?.fitElements(els);
    });
  }

  async _loadMock() {
    await this._loadPath('mock://NE555.kicad_mod');
  }

  async _openFile() {
    try {
      const path = await invoke(CANVAS_PICK_FOOTPRINT);
      if (!path) return; // user cancelled
      await this._loadPath(path);
    } catch (err) {
      notify({ type: 'error', title: 'Open failed', message: String(err?.message ?? err) });
    }
  }

  async _loadPath(path) {
    try {
      const result = await invoke(CANVAS_LOAD_FOOTPRINT, { path });
      store.canvasOriginalPath = path;
      store.canvasTempPath     = result.temp_path ?? '';
      store.canvasOriginalHash = result.original_hash ?? '';
      store.canvasFileType     = 'footprint';
      store.canvasIsDirty      = false;
      store.canvasMutations    = [];
      this.#loaded = true;
      this.#core.load(result.elements);
      this._updateStatusBar(false);
      this._setSaveEnabled(false);
    } catch (err) {
      notify({ type: 'error', title: 'Load failed', message: String(err?.message ?? err) });
    }
  }

  async _save() {
    if (!store.canvasIsDirty) return;
    try {
      await invoke(CANVAS_SAVE_FOOTPRINT, {
        temp_path:     store.canvasTempPath,
        original_path: store.canvasOriginalPath,
        mutations:     store.canvasMutations,
        original_hash: store.canvasOriginalHash,
      });
      store.canvasMutations = [];
      store.canvasIsDirty   = false;
      this._setSaveEnabled(false);
      notify({ type: 'success', title: 'Footprint saved', message: store.canvasOriginalPath });
    } catch (err) {
      notify({ type: 'error', title: 'Save failed', message: String(err?.message ?? err) });
    }
  }

  _updateStatusBar(dirty) {
    const bar  = this.shadowRoot?.getElementById('status-bar');
    const save = this.shadowRoot?.getElementById('btn-save');
    if (!bar) return;
    const name = store.canvasOriginalPath.split(/[/\\]/).pop() || 'No file open';
    bar.innerHTML = dirty
      ? `<span class="dirty-dot"></span>${_esc(name)} — unsaved changes`
      : _esc(name);
    this._setSaveEnabled(dirty);
  }

  _setSaveEnabled(enabled) {
    const btn = this.shadowRoot?.getElementById('btn-save');
    if (!btn) return;
    enabled ? btn.removeAttribute('disabled') : btn.setAttribute('disabled', '');
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

customElements.define('km-footprint-editor', FootprintEditor);
