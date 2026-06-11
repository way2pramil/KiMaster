/**
 * @element km-wgt-netlist-graph
 * @summary Dashboard graph widget — embeds km-netlist-graph directly.
 *
 * Why a wrapper at all?
 *  - Dashboard needs a registered element named km-wgt-netlist-graph.
 *  - The wrapper guarantees km-netlist-graph is imported & registered.
 *  - On connect it auto-triggers load when bridge data is available,
 *    so the user never has to click "Load Graph" manually from the dashboard.
 */

import { store, subscribe } from '../../../../core/State.js';

// Ensure km-netlist-graph is registered before we stamp the template
import '../../NetlistGraph/NetlistGraph.js';

// ── Template ──────────────────────────────────────────────────────────────────

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
  /*
   * height:100% on km-netlist-graph breaks inside CSS grid auto rows
   * because the row height is "auto" (no definite size) → circular.
   * position:absolute;inset:0 fills by coordinates instead, bypassing
   * the percentage-height chain entirely.
   */
  :host {
    display: block;
    position: relative;   /* containing block for the absolute child */
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  km-netlist-graph {
    position: absolute;
    inset: 0;             /* fill host by position, not height:100% */
  }
</style>
<km-netlist-graph id="panel"></km-netlist-graph>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class WidgetNetlistGraph extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs = [];
  }

  connectedCallback() {
    // Auto-load as soon as bridge connects (or already is)
    this._tryAutoLoad();

    this._unsubs.push(
      subscribe('bridgeConnected', on => { if (on) this._tryAutoLoad(); }),
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  _tryAutoLoad() {
    // If data is already loaded, the inner panel renders it immediately.
    // If not, signal the panel to start loading by setting the status —
    // km-netlist-graph.connectedCallback checks for this and calls _load().
    if (!store.netlistGraph && store.bridgeConnected) {
      store.netlistGraphStatus = 'loading';
    }
  }
}

customElements.define('km-wgt-netlist-graph', WidgetNetlistGraph);
