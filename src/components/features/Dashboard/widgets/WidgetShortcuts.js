/**
 * @element km-wgt-shortcuts
 * @summary Pinned shortcut tiles widget. Drag-to-reorder, add/remove.
 *          Replaces the old bottom shortcuts strip.
 */

import { store }                        from '../../../../core/State.js';
import { invoke }                       from '../../../../core/Ipc.js';
import {
  UCE_GET_VAULT, VAULT_LIST_STACKUPS,
  VAULT_LIST_TEMPLATES, VAULT_LIST_BLOCKS,
} from '../../../../core/AppCommands.js';
import { Logger }                       from '../../../../core/Logger.js';
import { WIDGET_BASE_CSS, navTo, esc }  from './WidgetShell.js';

const ALL_SC = [
  { id:'drc',       icon:'drc',       label:'Design checks', route:'/drc' },
  { id:'export',    icon:'gerber',     label:'Export',        route:'/export' },
  { id:'search',    icon:'search',     label:'Parts catalog', route:'/vault' },
  { id:'notes',     icon:'notes',      label:'Notes',         route:'/notes' },
  { id:'render',    icon:'render',     label:'3D Render',     route:'/render' },
  { id:'history',   icon:'history',    label:'History',       route:'/history' },
  { id:'bom',       icon:'bom',        label:'BOM',           route:'/bom' },
  { id:'bridge',    icon:'plug',       label:'KiCad bridge',  route:'/bridge' },
  { id:'graph',     icon:'graph',      label:'Graph',         route:'/graph' },
  { id:'schematic', icon:'schematic',  label:'Schematic',     route:'/schematic' },
  { id:'v-comp',    icon:'component',  label:'Components',    route:'/vault', vk:'components' },
  { id:'v-stk',     icon:'layers',     label:'Stackup',       route:'/stackup' },
  { id:'v-tpl',     icon:'file',       label:'Templates',     route:'/vault', vk:'templates' },
  { id:'v-blk',     icon:'box',        label:'Blocks',        route:'/vault', vk:'blocks' },
];
const DEFAULT_IDS = ['drc','export','search','notes','render','bridge','graph','v-comp'];
const LS_KEY = 'km-shortcuts-v2';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

/* Grid tile area */
.tiles-wrap {
  flex: 1; overflow: hidden;
  padding: 6px 8px 8px;
  display: flex; flex-direction: column;
}
.tiles-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 5px;
  align-content: start;
  overflow-y: auto;
  scrollbar-width: none;
}
.tiles-grid::-webkit-scrollbar { display: none; }

/* Individual tile */
.tile {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px;
  padding: 8px 4px;
  min-height: 52px;
  background: var(--km-alpha-04);
  border: 1px solid var(--km-border);
  border-radius: 10px;
  cursor: pointer; position: relative;
  transition: transform 0.18s var(--km-ease-spring),
              border-color 0.15s, background 0.15s, box-shadow 0.18s;
  user-select: none;
}
.tile:hover {
  border-color: rgba(37,99,235,0.45);
  background: rgba(37,99,235,0.07);
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(37,99,235,0.2);
}
.tile:active { transform: translateY(0); }
.tile km-icon { color: var(--km-text-muted); transition: color 0.15s; }
.tile:hover km-icon { color: var(--km-accent-hover); }
.tile-label {
  font-size: 8.5px; color: var(--km-text-muted);
  text-align: center; line-height: 1.2;
  width: 100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  padding: 0 3px; box-sizing: border-box;
  transition: color 0.15s;
}
.tile:hover .tile-label { color: var(--km-text-secondary); }

.tile-badge {
  position: absolute; top: 5px; right: 7px;
  font-size: 9px; font-family: var(--km-font-mono); font-weight: 700;
  color: var(--km-accent-hover);
  font-variant-numeric: tabular-nums;
}

/* Remove button — edit mode only */
.tile-rm {
  position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(239,68,68,0.12); border: none;
  color: var(--km-danger); font-size: 10px;
  display: none; align-items: center; justify-content: center;
  cursor: pointer; padding: 0; line-height: 1;
  transition: background 0.1s;
}
:host(.edit-mode) .tile-rm { display: flex; }
.tile-rm:hover { background: rgba(239,68,68,0.3); }

/* Drag states */
.tile.dragging { opacity: 0.45; transform: scale(0.93); }
.tile.drag-over { border-color: var(--km-accent); background: rgba(37,99,235,0.12); }

/* Add button — lives in the grid as the last cell */
.add-btn {
  display: flex; align-items: center; justify-content: center;
  min-height: 52px;
  border: 1px dashed var(--km-border-strong);
  border-radius: 10px; cursor: pointer;
  color: var(--km-text-muted); font-size: 18px;
  transition: all 0.15s;
}
.add-btn:hover {
  border-color: rgba(37,99,235,0.4);
  color: var(--km-accent-hover);
  background: rgba(37,99,235,0.05);
}

/* Picker overlay */
.picker {
  position: absolute; bottom: calc(100% + 8px); right: 8px;
  width: 280px;
  background: var(--km-glass-bg);
  border: 1px solid var(--km-border-strong);
  border-radius: 16px;
  box-shadow: 0 20px 60px var(--km-shadow-card-strong);
  backdrop-filter: blur(20px);
  z-index: 100; overflow: hidden;
  animation: pop-in 0.18s var(--km-ease-spring) both;
}
.picker.hidden { display: none; }
@keyframes pop-in {
  from { opacity:0; transform: scale(0.94) translateY(6px); }
  to   { opacity:1; transform: scale(1) translateY(0); }
}
.picker-hdr {
  padding: 12px 14px 8px;
  font-size: 11px; font-weight: 600;
  color: var(--km-text-secondary);
  border-bottom: 1px solid var(--km-border);
}
.picker-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 6px; padding: 10px;
}
.pick-item {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 8px 4px; border-radius: 10px; cursor: pointer;
  transition: background 0.1s;
}
.pick-item:hover { background: var(--km-alpha-06); }
.pick-item km-icon { color: var(--km-text-muted); }
.pick-item span { font-size: 9px; color: var(--km-text-muted); text-align: center; line-height: 1.2; }
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="grid" size="sm"></km-icon>
  <span class="wgt-label">Shortcuts</span>
</div>
<div class="tiles-wrap">
  <div class="tiles-grid" id="tiles">
    <div class="add-btn" id="add-btn" title="Add shortcut">＋</div>
  </div>
</div>
<!-- Picker positioned relative to host -->
<div class="picker hidden" id="picker">
  <div class="picker-hdr">Add shortcut</div>
  <div class="picker-grid" id="picker-grid"></div>
</div>
`;

export class WidgetShortcuts extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._ids      = this._load();
    this._vault    = { components:0, stackups:0, templates:0, blocks:0 };
    this._dragIdx  = null;
  }

  connectedCallback() {
    this._loadVault();
    this._render();
    this.shadowRoot.addEventListener('click', e => {
      if (!e.target.closest('#picker') && !e.target.closest('#add-btn'))
        this.shadowRoot.getElementById('picker')?.classList.add('hidden');
    });
    this.shadowRoot.getElementById('add-btn')
      ?.addEventListener('click', e => { e.stopPropagation(); this._togglePicker(); });
  }

  _load() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) {
        const ids = JSON.parse(s).filter(id => ALL_SC.some(x => x.id === id));
        if (ids.length) return ids;
      }
    } catch (_) {}
    return [...DEFAULT_IDS];
  }
  _save() { localStorage.setItem(LS_KEY, JSON.stringify(this._ids)); }

  async _loadVault() {
    try {
      const [c,s,t,b] = await Promise.all([
        invoke(UCE_GET_VAULT).catch(()=>[]),
        invoke(VAULT_LIST_STACKUPS).catch(()=>[]),
        invoke(VAULT_LIST_TEMPLATES).catch(()=>[]),
        invoke(VAULT_LIST_BLOCKS).catch(()=>[]),
      ]);
      this._vault = { components:c?.length??0, stackups:s?.length??0, templates:t?.length??0, blocks:b?.length??0 };
      this._render();
    } catch (e) { Logger.warn('WidgetShortcuts','vault',e); }
  }

  _render() {
    const grid = this.shadowRoot.getElementById('tiles');
    if (!grid) return;

    const addBtn = grid.querySelector('#add-btn') ?? grid.querySelector('.add-btn');

    // Remove existing tile elements, keep the add button
    grid.querySelectorAll('.tile').forEach(t => t.remove());

    const frag = document.createDocumentFragment();
    this._ids.forEach((id, i) => {
      const sc = ALL_SC.find(x => x.id === id);
      if (!sc) return;
      const badge = sc.vk ? `<span class="tile-badge">${this._vault[sc.vk]??0}</span>` : '';
      const div = document.createElement('div');
      div.className = 'tile';
      div.dataset.idx   = i;
      div.dataset.route = sc.route;
      div.draggable     = true;
      div.innerHTML = `<button class="tile-rm" data-rm="${i}" title="Remove">×</button>${badge}<km-icon name="${sc.icon}" size="sm"></km-icon><span class="tile-label">${esc(sc.label)}</span>`;
      frag.appendChild(div);
    });

    grid.insertBefore(frag, addBtn);

    for (const tile of grid.querySelectorAll('.tile')) {
      tile.addEventListener('click', e => {
        if (e.target.closest('.tile-rm')) return;
        navTo(this, tile.dataset.route);
      });
      tile.querySelector('.tile-rm')?.addEventListener('click', e => {
        e.stopPropagation();
        this._ids.splice(parseInt(tile.dataset.idx), 1);
        this._save(); this._render();
      });
      tile.addEventListener('dragstart', e => {
        this._dragIdx = parseInt(tile.dataset.idx);
        tile.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', () => {
        tile.classList.remove('dragging');
        grid.querySelectorAll('.tile').forEach(t => t.classList.remove('drag-over'));
        this._dragIdx = null;
      });
      tile.addEventListener('dragover', e => {
        e.preventDefault();
        if (this._dragIdx === null) return;
        const oi = parseInt(tile.dataset.idx);
        grid.querySelectorAll('.tile').forEach(t =>
          t.classList.toggle('drag-over', parseInt(t.dataset.idx) === oi && oi !== this._dragIdx));
      });
      tile.addEventListener('drop', e => {
        e.preventDefault();
        if (this._dragIdx === null) return;
        const to = parseInt(tile.dataset.idx);
        if (to !== this._dragIdx) {
          const item = this._ids.splice(this._dragIdx, 1)[0];
          this._ids.splice(to, 0, item);
          this._save(); this._render();
        }
      });
    }
  }

  _togglePicker() {
    const p = this.shadowRoot.getElementById('picker');
    if (p.classList.contains('hidden')) { this._buildPicker(); p.classList.remove('hidden'); }
    else p.classList.add('hidden');
  }

  _buildPicker() {
    const grid = this.shadowRoot.getElementById('picker-grid');
    const avail = ALL_SC.filter(x => !this._ids.includes(x.id));
    if (!avail.length) {
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--km-text-muted);font-size:11px;padding:12px">All shortcuts added</p>`;
      return;
    }
    grid.innerHTML = avail.map(sc => `
      <div class="pick-item" data-add="${sc.id}">
        <km-icon name="${sc.icon}" size="md"></km-icon>
        <span>${sc.label}</span>
      </div>`).join('');
    grid.querySelectorAll('.pick-item').forEach(item =>
      item.addEventListener('click', () => {
        this._ids.push(item.dataset.add);
        this._save(); this._render();
        this.shadowRoot.getElementById('picker').classList.add('hidden');
      }));
  }
}

customElements.define('km-wgt-shortcuts', WidgetShortcuts);
