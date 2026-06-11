/**
 * @element km-wgt-recent-projects
 * @summary Recent projects widget — lists recently opened KiCad projects.
 */

import { store, subscribe }              from '../../../../core/State.js';
import { invoke }                        from '../../../../core/Ipc.js';
import { Logger }                        from '../../../../core/Logger.js';
import { GET_RECENT_PROJECTS, PICK_AND_OPEN_PROJECT } from '../../../../core/AppCommands.js';
import { WIDGET_BASE_CSS, navTo, esc }   from './WidgetShell.js';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

/* ── List ─────────────────────────────────────────────────────── */
.list { flex:1; overflow-y:auto; }

.item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 16px;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid var(--km-alpha-04);
}
.item:last-child { border-bottom: none; }
.item:hover { background: var(--km-alpha-04); }

.dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--km-alpha-15);
  transition: background 0.2s, box-shadow 0.2s;
}
.dot.live {
  background: var(--km-live);
  box-shadow: 0 0 6px var(--km-live);
}

.info { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.name {
  font-size: 12px; font-weight: 500;
  color: var(--km-text-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.path {
  font-size: 10px; font-family: var(--km-font-mono);
  color: var(--km-text-muted);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

.item-actions { display:flex; gap:4px; flex-shrink:0; opacity:0; transition:opacity 0.1s; }
.item:hover .item-actions { opacity:1; }
.icon-btn {
  background:none; border:none; padding:4px; border-radius:5px;
  color:var(--km-text-muted); cursor:pointer;
  display:inline-flex; align-items:center;
  transition: color 0.1s, background 0.1s;
}
.icon-btn:hover { color:var(--km-text-secondary); background:var(--km-alpha-06); }

/* ── Footer open button ───────────────────────────────────────── */
.footer-row {
  padding: 10px 16px;
  border-top: 1px solid var(--km-alpha-04);
  flex-shrink: 0;
}
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="clock" size="sm"></km-icon>
  <span class="wgt-label">Recent projects</span>
  <button class="btn-sm accent" id="btn-open">
    <km-icon name="folder-open" size="sm"></km-icon>
    Open
  </button>
</div>
<div class="list" id="list"></div>
`;

export class WidgetRecentProjects extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs = [];
  }

  connectedCallback() {
    this._load();
    this.shadowRoot.getElementById('btn-open')?.addEventListener('click', () =>
      import('../../../../modules/project/ProjectService.js').then(m => m.pickAndOpenProject()));
    this._unsubs.push(
      subscribe('project', () => this._load()),
    );
  }

  disconnectedCallback() { this._unsubs.forEach(u => u()); this._unsubs = []; }

  async _load() {
    const list = this.shadowRoot.getElementById('list');
    try {
      const recents = await invoke(GET_RECENT_PROJECTS);
      if (!this.isConnected) return;

      if (!recents?.length) {
        list.innerHTML = `
          <div class="empty" style="padding:24px 16px">
            <km-icon name="history" size="xl"></km-icon>
            <span class="empty-label">Open a project to see it here</span>
          </div>`;
        return;
      }

      const current = store.project?.path || '';
      list.innerHTML = recents.slice(0, 10).map(p => {
        const name = p.name || p.path?.split(/[\\/]/).pop()?.replace(/\.kicad_pro$/,'') || '?';
        const live = p.path === current;
        return `
          <div class="item" data-path="${esc(p.path||'')}">
            <div class="dot${live?' live':''}"></div>
            <div class="info">
              <span class="name">${esc(name)}</span>
              <span class="path">${esc(p.path||'')}</span>
            </div>
            <div class="item-actions">
              <button class="icon-btn" data-folder="${esc(p.path||'')}" title="Show in explorer">
                <km-icon name="folder-open" size="sm"></km-icon>
              </button>
            </div>
          </div>`;
      }).join('');

      for (const item of list.querySelectorAll('.item')) {
        item.addEventListener('click', e => {
          if (e.target.closest('.icon-btn')) return;
          const path = item.dataset.path;
          if (path) import('../../../../modules/project/ProjectService.js')
            .then(m => m.openProject?.(path)
              ?? import('../../../../core/Ipc.js').then(({invoke:inv}) =>
                  inv('cmd_open_project', { pro_path: path })));
        });
        item.querySelector('[data-folder]')?.addEventListener('click', e => {
          e.stopPropagation();
          const p = e.currentTarget.dataset.folder;
          const dir = p.replace(/[\\/][^\\/]+$/, '');
          import('../../../../core/Ipc.js')
            .then(({invoke:inv}) => inv('cmd_open_directory', { path: dir }));
        });
      }
    } catch (err) {
      Logger.warn('WidgetRecentProjects', 'load failed', err);
      list.innerHTML = `<div class="empty"><span class="empty-label">Could not load recents</span></div>`;
    }
  }
}

customElements.define('km-wgt-recent-projects', WidgetRecentProjects);
