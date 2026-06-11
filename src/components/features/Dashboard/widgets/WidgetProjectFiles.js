/**
 * @element km-wgt-project-files
 * @summary Project file tree widget — shows active project's files with colored nodes.
 */

import { store, subscribe }   from '../../../../core/State.js';
import { KM_NAV }             from '../../../../core/AppEvents.js';
import { WIDGET_BASE_CSS, navTo, esc } from './WidgetShell.js';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

/* ── Tree root ────────────────────────────────────────────────── */
.root-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.root-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--km-accent);
  box-shadow: 0 0 8px rgba(37,99,235,0.55);
  flex-shrink: 0;
  animation: breathe 3s ease-in-out infinite;
}
@keyframes breathe {
  0%,100% { box-shadow: 0 0 5px rgba(37,99,235,0.5); }
  50%      { box-shadow: 0 0 14px rgba(37,99,235,0.8); }
}
.root-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.02em;
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Tree lines ───────────────────────────────────────────────── */
.tree-wrap { flex: 1; overflow-y: auto; padding-bottom: 8px; }
.level {
  position: relative;
  padding-left: 20px;
  margin-left: 20px;
}
.level::before {
  content: '';
  position: absolute; left: 0; top: 6px; bottom: 10px; width: 1px;
  background: rgba(37,99,235,0.18);
}

/* ── Tree item ────────────────────────────────────────────────── */
.item {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 12px 5px 0;
  cursor: pointer; border-radius: 6px;
  font-size: 12px; color: var(--km-text-secondary);
  position: relative; margin-bottom: 1px;
  transition: background 0.1s, color 0.1s;
}
.item:hover { background: var(--km-alpha-04); color: var(--km-text-primary); }
.item::before {
  content: ''; position: absolute;
  left: -20px; top: 50%; width: 14px; height: 1px;
  background: rgba(37,99,235,0.18);
}

/* Colored node dot */
.node-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid; transition: transform 0.1s;
}
.item:hover .node-dot { transform: scale(1.4); }
.item[data-t="pro"]    .node-dot { border-color:var(--km-accent);  background:rgba(37,99,235,0.25); }
.item[data-t="pcb"]    .node-dot { border-color:var(--km-accent);  background:rgba(37,99,235,0.12); }
.item[data-t="sch"]    .node-dot { border-color:var(--km-trace);   background:rgba(16,185,129,0.15); }
.item[data-t="km"]     .node-dot { border-color:var(--km-live);    background:rgba(6,182,212,0.12); }
.item[data-t="lib"]    .node-dot { border-color:var(--km-live);    background:rgba(6,182,212,0.08); }
.item[data-t="notes"]  .node-dot { border-color:var(--km-warning); background:rgba(245,158,11,0.12); }
.item[data-t="folder"] .node-dot { border-color:var(--km-border-strong); background:var(--km-alpha-05); }

.item-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ext {
  font-family: var(--km-font-mono); font-size: 9px;
  color: var(--km-text-muted); padding: 0 4px;
  background: var(--km-alpha-04); border-radius: 3px; flex-shrink: 0;
}

/* ── Level 2 (inside .kimaster) ───────────────────────────────── */
.level-2 { position: relative; padding-left: 18px; margin-left: 10px; }
.level-2::before { content:''; position:absolute; left:0; top:6px; bottom:10px; width:1px; background:rgba(6,182,212,0.12); }
.level-2 .item { font-size: 11px; }
.level-2 .item::before { left:-18px; width:12px; background:rgba(6,182,212,0.12); }
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="folder-tree" size="sm"></km-icon>
  <span class="wgt-label">Project files</span>
</div>
<div id="root-row" class="root-row" style="display:none">
  <div class="root-dot"></div>
  <km-icon name="folder-open" size="sm" style="color:var(--km-accent);opacity:0.7;flex-shrink:0"></km-icon>
  <span class="root-name" id="root-name"></span>
</div>
<div class="sep" id="sep" style="display:none"></div>
<div class="tree-wrap" id="tree-wrap"></div>
`;

export class WidgetProjectFiles extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs = [];
  }

  connectedCallback() {
    this._render();
    this._unsubs.push(
      subscribe('project',        () => this._render()),
      subscribe('bridgeBoardName',() => this._render()),
      subscribe('boardComponents',() => this._render()),
    );
  }

  disconnectedCallback() { this._unsubs.forEach(u => u()); this._unsubs = []; }

  _render() {
    const root   = this.shadowRoot.getElementById('root-row');
    const rootNm = this.shadowRoot.getElementById('root-name');
    const sep    = this.shadowRoot.getElementById('sep');
    const wrap   = this.shadowRoot.getElementById('tree-wrap');
    const proj   = store.project;
    const board  = store.bridgeBoardName;

    if (!proj && !board) {
      root.style.display = 'none';
      sep.style.display  = 'none';
      wrap.innerHTML = `
        <div class="empty">
          <km-icon name="folder-open" size="xl"></km-icon>
          <span class="empty-label">No project open</span>
          <button class="btn-primary" id="btn-open">Open project</button>
        </div>`;
      wrap.querySelector('#btn-open')?.addEventListener('click', () =>
        import('../../../../modules/project/ProjectService.js').then(m => m.pickAndOpenProject()));
      return;
    }

    const name = proj?.name
      || board?.replace(/\\/g,'/')?.split('/').pop()?.replace(/\.kicad_pcb$/,'')
      || 'Project';
    const pcb  = proj?.pcb_file?.split(/[\\/]/).pop()
      || board?.split(/[\\/]/).pop() || null;
    const sch  = proj?.schematic_file?.split(/[\\/]/).pop()
      || (pcb ? pcb.replace(/\.kicad_pcb$/,'.kicad_sch') : null);
    const pro  = pcb ? pcb.replace(/\.kicad_pcb$/,'.kicad_pro') : null;

    rootNm.textContent = name;
    root.style.display  = 'flex';
    sep.style.display   = 'block';

    wrap.innerHTML = `
      <div class="level">
        ${pro ? _ti(pro,'pro') : ''}
        ${pcb ? _ti(pcb,'pcb') : ''}
        ${sch ? _ti(sch,'sch') : ''}
        ${_ti('.kimaster/','km')}
        <div class="level-2">
          ${_ti('library/','lib')}
          ${_ti('notes.md','notes')}
          ${_ti('tasks.json','folder')}
        </div>
      </div>`;

    wrap.querySelector('.item[data-t="notes"]')?.addEventListener('click', () =>
      navTo(this, '/notes'));
  }
}

function _ti(label, type) {
  const m = label.match(/(\.[a-z0-9_]+)$/i);
  const ext  = m ? m[1] : '';
  const base = ext ? label.slice(0,-ext.length) : label;
  return `
    <div class="item" data-t="${type}">
      <div class="node-dot"></div>
      <span class="item-name">${esc(base)}</span>
      ${ext ? `<span class="ext">${esc(ext)}</span>` : ''}
    </div>`;
}

customElements.define('km-wgt-project-files', WidgetProjectFiles);
