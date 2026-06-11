/**
 * @element km-board-tools-rail
 * @summary Collapsible side rail docking Via Stitch / Teardrops / Panelize
 *          panels directly into the PCB Layout tab, alongside the live
 *          KiCanvas board view — so preview happens on the ACTUAL board,
 *          not a separate route/minimap.
 *
 * Wiring: panels broadcast `km-board-preview` (composed, bubbling) whenever
 * their dry-run preview changes; the host (PcbLayout/KiCanvasView) listens
 * and forwards it straight to km-live-overlay, which draws the geometry in
 * lockstep with the real KiCanvas viewport. No separate preview widget.
 */

import '../BoardTools/ViaStitchPanel.js';
import '../BoardTools/TeardropPanel.js';
import '../BoardTools/PanelizePanel.js';

const TABS = [
  { id: 'via-stitch', label: 'Via Stitch', tag: 'km-via-stitch-panel' },
  { id: 'teardrops',  label: 'Teardrops',  tag: 'km-teardrop-panel'   },
  { id: 'panelize',   label: 'Panelize',   tag: 'km-panelize-panel'   },
];

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 360px;
    min-width: 280px;
    max-width: 460px;
    background: var(--km-bg-elevated);
    border-left: 1px solid var(--km-border);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    overflow: hidden;
    transition: width 0.16s ease, min-width 0.16s ease;
  }
  :host([collapsed]) {
    width: 40px;
    min-width: 40px;
  }

  .rail-head {
    display: flex;
    align-items: center;
    height: 40px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    padding: 0 var(--km-space-2);
    gap: var(--km-space-1);
  }
  .rail-title {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :host([collapsed]) .rail-title,
  :host([collapsed]) .tabs { display: none; }

  .collapse-btn {
    background: none;
    border: none;
    color: var(--km-text-secondary);
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: var(--km-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
  }
  .collapse-btn:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }

  .tabs {
    display: flex;
    gap: 2px;
    padding: var(--km-space-1) var(--km-space-2) 0;
    border-bottom: 1px solid var(--km-border);
  }
  .tab {
    background: none;
    border: none;
    padding: var(--km-space-1) var(--km-space-2);
    border-radius: var(--km-radius-sm) var(--km-radius-sm) 0 0;
    color: var(--km-text-secondary);
    font-size: var(--km-font-size-xs);
    cursor: pointer;
  }
  .tab:hover { color: var(--km-text-primary); }
  .tab.active { color: var(--km-accent); background: var(--km-accent-muted); }

  .panes {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  .pane {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    display: none;
  }
  .pane.active { display: block; }
</style>

<div class="rail-head">
  <span class="rail-title">Board Tools</span>
  <div class="tabs" id="tab-bar"></div>
  <button class="collapse-btn" id="btn-collapse" title="Collapse">⟩</button>
</div>
<div class="panes" id="panes"></div>
`;

export class KmBoardToolsRail extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._tabBar  = this.shadowRoot.getElementById('tab-bar');
    this._panes   = this.shadowRoot.getElementById('panes');
    this._collapseBtn = this.shadowRoot.getElementById('btn-collapse');
    this._activeTab = TABS[0].id;
  }

  connectedCallback() {
    this._buildTabs();
    this._buildPanes();
    this._activateTab(TABS[0].id);

    this._collapseBtn.addEventListener('click', () => this._toggleCollapse());

    // NOTE: panels dispatch `km-board-preview` with {bubbles:true, composed:true},
    // which already crosses every shadow-DOM boundary on its way up to PcbLayout —
    // no relay/re-dispatch needed here (and re-dispatching would create a feedback
    // loop with this rail's own 'clear' broadcast in _activateTab below).
  }

  // ── Tabs / panes ──────────────────────────────────────────────────────────

  _buildTabs() {
    TABS.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.id = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => this._activateTab(tab.id));
      this._tabBar.appendChild(btn);
    });
  }

  _buildPanes() {
    TABS.forEach(tab => {
      const pane = document.createElement('div');
      pane.className = 'pane';
      pane.dataset.id = tab.id;
      pane.appendChild(document.createElement(tab.tag));
      this._panes.appendChild(pane);
    });
  }

  _activateTab(id) {
    this._activeTab = id;
    this._tabBar.querySelectorAll('.tab').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.id === id));
    this._panes.querySelectorAll('.pane').forEach(pane =>
      pane.classList.toggle('active', pane.dataset.id === id));

    // Switching tools clears any stale preview from the previously active tool.
    this.dispatchEvent(new CustomEvent('km-board-preview', {
      bubbles: true, composed: true,
      detail: { source: 'rail', kind: 'clear', payload: null },
    }));
  }

  _toggleCollapse() {
    const collapsed = this.hasAttribute('collapsed');
    if (collapsed) {
      this.removeAttribute('collapsed');
      this._collapseBtn.textContent = '⟩';
      this._collapseBtn.title = 'Collapse';
    } else {
      this.setAttribute('collapsed', '');
      this._collapseBtn.textContent = '⟨';
      this._collapseBtn.title = 'Expand';
    }
  }
}

customElements.define('km-board-tools-rail', KmBoardToolsRail);
