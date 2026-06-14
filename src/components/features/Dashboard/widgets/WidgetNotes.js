/**
 * @summary Quick notes widget — last-note preview + inline quick-add input.
 *
 * Built on the `defineWidget()` SDK. See `widget-sdk/defineWidget.js` for the
 * lifecycle contract and `widget-sdk/_template.js` for a copy-paste starter.
 *
 * Body content lives in the shell's light DOM (slotted via the default slot).
 * All event listeners must attach to `shell`, not `host` — `closest()` would
 * otherwise miss the slotted nodes.
 */

import { store, subscribe }     from '../../../../core/State.js';
import { Logger }               from '../../../../core/Logger.js';
import { notify }               from '../../../../core/Notify.js';
import { loadNotes, saveNotes } from '../../../../modules/notes/NotesService.js';
import { defineWidget }         from '../widget-sdk/defineWidget.js';

const BODY_CSS = /* css */`
  :host { display: block; height: 100%; }
  .body-inner {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
  }

  .preview {
    flex: 1; overflow-y: auto; min-height: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .preview-line {
    font-size: 12px; color: var(--km-alpha-50);
    line-height: 1.5;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .preview-line.heading { color: var(--km-alpha-75); font-weight: 600; }
  .preview-line.muted   { color: var(--km-alpha-25); }
  .preview-more {
    font-size: 10px; color: var(--km-alpha-20);
    font-style: italic; padding-top: 2px;
  }

  .quick-row {
    display: flex; gap: 6px; align-items: center;
    padding: 8px 0 0; flex-shrink: 0;
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

  .open-link {
    background: none; border: none; padding: 0;
    color: var(--km-accent-hover);
    font-size: 11px; font-family: var(--km-font);
    cursor: pointer; display: inline-flex; align-items: center; gap: 3px;
    transition: color 0.15s;
  }
  .open-link:hover { color: var(--km-accent); }
`;

export const WIDGET_NOTES_TAG = defineWidget({
  id: 'notes',
  label: 'Notes',
  icon: 'notes',
  defaultW: 3,
  defaultH: 1,
  emptyMessage: 'No notes yet — add one below',
  loadingMessage: 'Loading notes…',

  setup({ setState }) {
    // Initial empty state; load() will fill in real content if a project is open.
    setState({ content: '', __noProject: !store.project?.kimaster_dir });
  },

  async load({ setState, signal, shell }) {
    if (!store.project?.kimaster_dir) return; // setup() already set the empty state.
    try {
      const content = await loadNotes();
      if (signal?.aborted) return;
      if (shell) shell._kmNotesContent = content ?? '';
      setState({ content: content ?? '', __noProject: false });
    } catch (err) {
      Logger.warn('WidgetNotes', 'load', err);
      if (shell) shell._kmNotesContent = '';
      setState({ content: '', __noProject: false });
    }
  },

  isEmpty: (state) => !state.content?.trim(),

  onMount({ shell, setState, state }) {
    // Sync the tracker with whatever load() wrote to state.
    shell._kmNotesContent = state?.content ?? '';

    // Re-load when the project changes.
    const unsub = subscribe('project', () => {
      if (store.project?.kimaster_dir) {
        loadNotes().then(c => {
          shell._kmNotesContent = c ?? '';
          setState({ content: c ?? '', __noProject: false });
        }).catch(() => {
          shell._kmNotesContent = '';
          setState({ content: '', __noProject: false });
        });
      } else {
        shell._kmNotesContent = '';
        setState({ content: '', __noProject: true });
      }
    });

    // Listeners on the shell (light DOM) so they see slotted children.
    shell.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'open') {
        import('../../../../core/Router.js').then(m => m.Router.navigate('/notes'));
        return;
      }
      if (act === 'add') {
        const input = shell.querySelector('#quick-in');
        if (!input) return;
        doAdd(input, setState);
      }
    });
    shell.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('#quick-in');
      if (!input) return;
      e.preventDefault();
      doAdd(input, setState);
    });

    shell._kmUnsubs = [unsub];
  },

  onUnmount({ shell }) {
    for (const u of shell._kmUnsubs ?? []) try { u(); } catch {}
  },

  render({ state }) {
    const lines = (state.content ?? '').split('\n').filter(l => l.trim());
    const previewHtml = lines.length
      ? lines.slice(0, 5).map(l => {
          const isH  = l.startsWith('#');
          const cls  = isH ? 'heading' : (l.startsWith('- ') || l.startsWith('* ') ? '' : 'muted');
          const text = l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '');
          return `<div class="preview-line ${cls}">${esc(text)}</div>`;
        }).join('') + (lines.length > 5 ? `<div class="preview-more">+ more…</div>` : '')
      : `<div class="preview-line muted">${state.__noProject ? 'Open a project to use notes' : 'No notes yet — add one below'}</div>`;

    return /* html */`
      <style>${BODY_CSS}</style>
      <button slot="header" class="open-link" data-act="open">
        Open <km-icon name="arrow-right" size="sm"></km-icon>
      </button>
      <div class="body-inner">
        <div class="preview">${previewHtml}</div>
        <div class="quick-row">
          <input class="quick-input" id="quick-in" placeholder="Quick note…" />
          <button class="quick-add-btn" data-act="add">
            <km-icon name="plus" size="sm"></km-icon>Add
          </button>
        </div>
      </div>
    `;
  },

  badge({ state }) {
    if (!state.content) return '';
    const lines = state.content.split('\n').filter(l => l.trim()).length;
    return lines > 0 ? String(lines) : '';
  },
}).tag;

function doAdd(input, setState) {
  const text = (input.value || '').trim();
  if (!text) return;
  // Track the last-set content on the shell so subsequent adds keep appending
  // (re-render replaces the body, losing any property on the input itself).
  const shell = input.closest('km-wgt-shell');
  const prev  = shell?._kmNotesContent ?? '';
  const next  = prev ? `${prev}\n- ${text}` : `- ${text}`;
  if (shell) shell._kmNotesContent = next;
  input.value = '';
  setState({ content: next });
  if (!store.project?.kimaster_dir) {
    notify({ type: 'error', title: 'No project open', message: 'Open a KiCad project to save notes.' });
    return;
  }
  saveNotes(next).catch(err => {
    Logger.warn('WidgetNotes', 'save', err);
    notify({ type: 'error', title: 'Save failed', message: String(err?.message ?? err) });
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
