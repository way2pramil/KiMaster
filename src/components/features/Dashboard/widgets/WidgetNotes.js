/**
 * @element km-wgt-notes
 * @summary Quick notes widget — shows last note preview + inline quick-add.
 */

import { store, subscribe }            from '../../../../core/State.js';
import { Logger }                      from '../../../../core/Logger.js';
import { notify }                      from '../../../../core/Notify.js';
import { loadNotes, saveNotes }        from '../../../../modules/notes/NotesService.js';
import { WIDGET_BASE_CSS, navTo, esc } from './WidgetShell.js';

const T = document.createElement('template');
T.innerHTML = /* html */`
<style>
${WIDGET_BASE_CSS}

.preview {
  flex: 1; overflow-y: auto;
  padding: 10px 16px 0;
  display: flex; flex-direction: column; gap: 4px;
}
.preview-line {
  font-size: 12px;
  color: var(--km-alpha-50);
  line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.preview-line.heading {
  color: var(--km-alpha-75);
  font-weight: 600;
}
.preview-line.muted { color: var(--km-alpha-25); }
.preview-more {
  font-size: 10px; color: var(--km-alpha-20);
  font-style: italic; padding-top: 2px;
}

/* ── Quick add ────────────────────────────────────────────────── */
.quick-row {
  display: flex; gap: 6px; align-items: center;
  padding: 8px 14px 12px;
  flex-shrink: 0;
}
.quick-input {
  flex: 1; background: var(--km-alpha-05);
  border: 1px solid var(--km-alpha-08);
  border-radius: 7px; padding: 6px 10px;
  color: var(--km-alpha-75);
  font-family: var(--km-font); font-size: 12px;
  outline: none; transition: border-color 0.15s;
}
.quick-input::placeholder { color: var(--km-alpha-20); }
.quick-input:focus { border-color: rgba(37,99,235,0.5); }
.quick-add-btn {
  background: rgba(37,99,235,0.12);
  border: 1px solid rgba(37,99,235,0.3);
  color: var(--km-accent-hover);
  border-radius: 7px; padding: 6px 10px;
  cursor: pointer; font-family: var(--km-font); font-size: 12px;
  transition: all 0.15s; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 4px;
}
.quick-add-btn:hover { background: rgba(37,99,235,0.2); border-color: var(--km-accent); }
</style>

<div class="wgt-hdr">
  <km-icon class="wgt-icon" name="notes" size="sm"></km-icon>
  <span class="wgt-label">Notes</span>
  <button class="btn-link accent" id="btn-open">Open <km-icon name="arrow-right" size="sm"></km-icon></button>
</div>
<div class="preview" id="preview"></div>
<div class="quick-row">
  <input class="quick-input" id="quick-in" placeholder="Quick note…" />
  <button class="quick-add-btn" id="quick-btn"><km-icon name="plus" size="sm"></km-icon>Add</button>
</div>
`;

export class WidgetNotes extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(T.content.cloneNode(true));
    this._unsubs  = [];
    this._content = '';
  }

  connectedCallback() {
    this._load();
    this.shadowRoot.getElementById('btn-open')
      ?.addEventListener('click', () => navTo(this, '/notes'));

    const input = this.shadowRoot.getElementById('quick-in');
    const btn   = this.shadowRoot.getElementById('quick-btn');
    const add   = () => {
      const text = input.value.trim();
      if (!text) return;
      if (!store.project?.kimaster_dir) {
        notify({ type: 'error', title: 'No project open', message: 'Open a KiCad project to save notes.' });
        return;
      }
      const line = `- ${text}`;
      this._content = this._content ? `${this._content}\n${line}` : line;
      saveNotes(this._content).catch(e => {
        Logger.warn('WidgetNotes', 'save', e);
        notify({ type: 'error', title: 'Save failed', message: String(e?.message ?? e) });
      });
      input.value = '';
      this._renderPreview();
    };
    btn.addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });

    this._unsubs.push(subscribe('project', () => this._load()));
  }

  disconnectedCallback() { this._unsubs.forEach(u => u()); this._unsubs = []; }

  async _load() {
    // Require a real project with a kimaster_dir — mock/bridge-only state has no notes file
    if (!store.project?.kimaster_dir) {
      this._content = '';
      this._renderEmpty();
      return;
    }
    try {
      this._content = await loadNotes();
      if (!this.isConnected) return;
      this._renderPreview();
    } catch (err) {
      // Silently fall back — notes file may not exist yet on a new project
      this._content = '';
      this._renderPreview();
    }
  }

  _renderPreview() {
    const el = this.shadowRoot.getElementById('preview');
    if (!this._content?.trim()) {
      el.innerHTML = `<div class="empty" style="flex:1;padding:12px"><span class="empty-label">No notes yet.<br>Add one below.</span></div>`;
      return;
    }
    const lines = this._content.split('\n').filter(l => l.trim()).slice(0, 5);
    el.innerHTML = lines.map(l => {
      const isH = l.startsWith('#');
      const cls = isH ? 'heading' : (l.startsWith('- ') || l.startsWith('* ') ? '' : 'muted');
      return `<div class="preview-line ${cls}">${esc(l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, ''))}</div>`;
    }).join('') + (this._content.split('\n').filter(l => l.trim()).length > 5
      ? `<div class="preview-more">+ more…</div>` : '');
  }

  _renderEmpty() {
    const el = this.shadowRoot.getElementById('preview');
    el.innerHTML = `
      <div class="empty" style="flex:1;padding:12px">
        <km-icon name="notes" size="xl"></km-icon>
        <span class="empty-label">Open a project<br>to use notes</span>
      </div>`;
  }
}

customElements.define('km-wgt-notes', WidgetNotes);
