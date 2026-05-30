/**
 * @element km-revision-timeline
 * @summary Git revision timeline — lists commits that touched .kicad_pcb / .kicad_sch,
 *          click a commit to run a DRC diff showing added / fixed violations.
 *
 * Reads: store.project, store.kicadCliPath
 * IPC:   cmd_git_status, cmd_git_get_history, cmd_git_diff_drc
 */

import { store, subscribe } from '../../../core/State.js';
import { invoke, invokeNow } from '../../../core/Ipc.js';
import { Logger } from '../../../core/Logger.js';
import {
  GIT_STATUS, GIT_GET_HISTORY, GIT_DIFF_DRC,
} from '../../../core/AppCommands.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: block; height: 100%; font-family: var(--km-font); }

  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
    overflow: hidden;
  }

  /* ── Left: commit list ── */
  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--km-border);
    overflow: hidden;
  }
  .sidebar-header {
    padding: var(--km-space-3) var(--km-space-4);
    border-bottom: 1px solid var(--km-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    background: var(--km-bg-primary);
  }
  .sidebar-title {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
  }
  .commit-count {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .commit-list {
    flex: 1;
    overflow-y: auto;
  }
  .commit-list::-webkit-scrollbar { width: 4px; }
  .commit-list::-webkit-scrollbar-track { background: transparent; }
  .commit-list::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 2px; }

  /* commit row */
  .commit {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-3);
    padding: var(--km-space-3) var(--km-space-4);
    cursor: pointer;
    border-bottom: 1px solid var(--km-border);
    border-left: 2px solid transparent;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .commit:hover { background: var(--km-bg-surface); }
  .commit.active {
    background: var(--km-accent-muted);
    border-left-color: var(--km-accent);
  }
  .commit:last-child { border-bottom: none; }

  /* timeline dot */
  .t-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--km-border-strong, rgba(255,255,255,0.15));
    border: 1.5px solid var(--km-text-muted);
    flex-shrink: 0;
    margin-top: 4px;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .commit.active .t-dot { background: var(--km-accent); border-color: var(--km-accent); }

  .commit-body { flex: 1; min-width: 0; }
  .commit-msg {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }
  .commit-meta {
    display: flex;
    gap: var(--km-space-2);
    margin-top: 2px;
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .commit-hash {
    font-family: var(--km-font-mono);
    color: var(--km-accent);
    font-size: var(--km-font-size-xs);
  }
  .commit-files {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 3px;
  }
  .file-tag {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }

  /* ── Right: diff panel ── */
  .diff-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .diff-header {
    padding: var(--km-space-3) var(--km-space-5);
    border-bottom: 1px solid var(--km-border);
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    flex-shrink: 0;
    background: var(--km-bg-primary);
  }
  .diff-title { font-size: var(--km-font-size-sm); color: var(--km-text-secondary); }
  .diff-title strong { color: var(--km-text-primary); }

  /* summary chips */
  .diff-chips { display: flex; gap: var(--km-space-2); flex-shrink: 0; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--km-space-2);
    border-radius: var(--km-radius-full);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    font-variant-numeric: tabular-nums;
  }
  .chip-added     { background: rgba(239,68,68,0.12);  color: var(--km-danger); }
  .chip-fixed     { background: rgba(16,185,129,0.12); color: var(--km-success, #10B981); }
  .chip-unchanged { background: var(--km-bg-surface);  color: var(--km-text-muted); }

  /* diff body */
  .diff-body { flex: 1; overflow-y: auto; padding: var(--km-space-4) var(--km-space-5); }
  .diff-body::-webkit-scrollbar { width: 4px; }
  .diff-body::-webkit-scrollbar-track { background: transparent; }
  .diff-body::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 2px; }

  .diff-section { margin-bottom: var(--km-space-5); }
  .diff-section-label {
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--km-space-2);
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
  }
  .label-added     { color: var(--km-danger); }
  .label-fixed     { color: var(--km-success, #10B981); }
  .label-unchanged { color: var(--km-text-muted); }

  .viol-row {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    border-left: 2px solid transparent;
    margin-bottom: 2px;
    font-size: var(--km-font-size-sm);
  }
  .viol-row.added     { border-left-color: var(--km-danger);  background: rgba(239,68,68,0.06); }
  .viol-row.fixed     { border-left-color: var(--km-success, #10B981); background: rgba(16,185,129,0.06); }
  .viol-row.unchanged { background: var(--km-bg-surface); opacity: 0.6; }
  .viol-sign { flex-shrink: 0; font-weight: 600; font-family: var(--km-font-mono); font-size: 13px; }
  .sign-add  { color: var(--km-danger); }
  .sign-fix  { color: var(--km-success, #10B981); }
  .viol-text { flex: 1; min-width: 0; color: var(--km-text-secondary); line-height: 1.4; word-break: break-word; }
  .viol-badge {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    color: var(--km-text-muted);
    font-family: var(--km-font-mono);
  }

  /* loading spinner */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    padding: var(--km-space-8) 0;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }

  /* inline sub-text helpers (replaces inline styles) */
  .state-hint {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
  }
  .diff-overflow-hint {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    padding: var(--km-space-2) var(--km-space-3);
  }

  /* empty / error states */
  .state-msg {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    padding: var(--km-space-8) var(--km-space-5);
    color: var(--km-text-muted);
    text-align: center;
    font-size: var(--km-font-size-sm);
  }
  .state-msg km-icon { opacity: 0.3; }
  .state-msg .err-msg { color: var(--km-danger); font-size: var(--km-font-size-xs); }
  @media (max-width: 700px) {
    .layout { grid-template-columns: 1fr; }
    .diff-panel { display: none; }
  }
</style>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Revision History</span>
      <span class="commit-count" id="count"></span>
    </div>
    <div class="commit-list" id="commit-list"></div>
  </div>
  <div class="diff-panel" id="diff-panel">
    <div class="diff-header" id="diff-header">
      <span class="diff-title">Select a commit to compare DRC results</span>
      <div class="diff-chips" id="diff-chips"></div>
    </div>
    <div class="diff-body" id="diff-body">
      <div class="state-msg">
        <km-icon name="drc" size="xl"></km-icon>
        <span>Click a commit on the left to run a DRC diff — see which violations were added or fixed.</span>
      </div>
    </div>
  </div>
</div>
`;

export class RevisionTimeline extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._commits      = [];
    this._activeHash   = null;
    this._diffLoading  = false;
    this._unsubs       = [];
  }

  connectedCallback() {
    this._unsubs.push(
      subscribe('project', () => this._loadHistory()),
    );
    this._loadHistory();
  }

  disconnectedCallback() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Load history ──────────────────────────────────────────────────────────

  async _loadHistory() {
    const list = this.shadowRoot.getElementById('commit-list');

    if (!store.project) {
      list.innerHTML = `<div class="state-msg">
        <km-icon name="cpu" size="xl"></km-icon>
        <span>Open a project to view its revision history.</span>
      </div>`;
      this.shadowRoot.getElementById('count').textContent = '';
      return;
    }

    list.innerHTML = `<div class="loading">
      <km-icon name="loader" size="lg" animate="spin"></km-icon>
      <span>Loading history…</span>
    </div>`;

    try {
      // Check git availability first
      const status = await invokeNow(GIT_STATUS);

      if (!status.available) {
        list.innerHTML = `<div class="state-msg">
          <km-icon name="warning" size="xl"></km-icon>
          <span>Git not found on PATH. Install Git to enable revision history.</span>
        </div>`;
        return;
      }

      if (!status.is_repo) {
        list.innerHTML = `<div class="state-msg">
          <km-icon name="drc" size="xl"></km-icon>
          <span>This project is not in a git repository.</span>
          <span class="state-hint">Run <code class="km-code">git init</code> in the project directory.</span>
        </div>`;
        return;
      }

      const resp = await invokeNow(GIT_GET_HISTORY, { limit: 30 });

      if (resp.error) {
        Logger.warn('RevisionTimeline', resp.error);
        list.innerHTML = `<div class="state-msg">
          <km-icon name="warning" size="xl"></km-icon>
          <span class="err-msg">${esc(resp.error)}</span>
        </div>`;
        return;
      }

      this._commits = resp.commits ?? [];
      this._renderCommitList();
    } catch (err) {
      Logger.error('RevisionTimeline', err, 'loadHistory');
      list.innerHTML = `<div class="state-msg">
        <km-icon name="warning" size="xl"></km-icon>
        <span class="err-msg">${esc(String(err?.message ?? err))}</span>
      </div>`;
    }
  }

  _renderCommitList() {
    const list = this.shadowRoot.getElementById('commit-list');
    const count = this.shadowRoot.getElementById('count');
    count.textContent = `${this._commits.length} commits`;

    if (this._commits.length === 0) {
      list.innerHTML = `<div class="state-msg">
        <km-icon name="drc" size="xl"></km-icon>
        <span>No commits found that touched KiCad files.</span>
      </div>`;
      return;
    }

    list.innerHTML = this._commits.map(c => `
      <div class="commit${c.hash === this._activeHash ? ' active' : ''}" data-hash="${esc(c.hash)}">
        <div class="t-dot"></div>
        <div class="commit-body">
          <div class="commit-msg">${esc(c.message)}</div>
          <div class="commit-meta">
            <span class="commit-hash">${esc(c.short)}</span>
            <span>${esc(c.date)}</span>
            <span>${esc(c.author)}</span>
          </div>
          <div class="commit-files">
            ${(c.files ?? []).map(f => `<span class="file-tag">${esc(f.split(/[\\/]/).pop())}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    for (const el of list.querySelectorAll('.commit[data-hash]')) {
      el.addEventListener('click', () => this._selectCommit(el.dataset.hash));
    }
  }

  // ── DRC Diff ──────────────────────────────────────────────────────────────

  async _selectCommit(hash) {
    if (this._diffLoading) return;
    this._activeHash = hash;
    this._renderCommitList(); // re-render to update active class

    const commit = this._commits.find(c => c.hash === hash);
    const diffBody   = this.shadowRoot.getElementById('diff-body');
    const diffHeader = this.shadowRoot.getElementById('diff-header');
    const diffChips  = this.shadowRoot.getElementById('diff-chips');

    // Check if kicad-cli is available for DRC diff
    if (!store.kicadCliPath) {
      diffBody.innerHTML = `<div class="state-msg">
        <km-icon name="warning" size="xl"></km-icon>
        <span>kicad-cli not found — DRC diff requires KiCad 9.0+ installed.<br>The commit diff view will be available once kicad-cli is on PATH.</span>
      </div>`;
      diffHeader.querySelector('.diff-title').innerHTML =
        `Commit <strong>${esc(commit?.short ?? hash)}</strong>`;
      diffChips.innerHTML = '';
      return;
    }

    this._diffLoading = true;
    diffBody.innerHTML = `<div class="loading">
      <km-icon name="loader" size="lg" animate="spin" class="state-icon--accent"></km-icon>
      <span>Running DRC on both versions…</span>
    </div>`;
    diffHeader.querySelector('.diff-title').innerHTML =
      `Comparing <strong>${esc(commit?.short ?? hash)}</strong>`;
    diffChips.innerHTML = '';

    try {
      const resp = await invokeNow(GIT_DIFF_DRC, { commit_hash: hash });
      this._diffLoading = false;

      if (resp.error) {
        diffBody.innerHTML = `<div class="state-msg">
          <km-icon name="warning" size="xl"></km-icon>
          <span class="err-msg">${esc(resp.error)}</span>
        </div>`;
        return;
      }

      this._renderDiff(resp.diff, commit);
    } catch (err) {
      this._diffLoading = false;
      Logger.error('RevisionTimeline', err, '_selectCommit');
      diffBody.innerHTML = `<div class="state-msg">
        <km-icon name="warning" size="xl"></km-icon>
        <span class="err-msg">${esc(String(err?.message ?? err))}</span>
      </div>`;
    }
  }

  _renderDiff(diff, commit) {
    const diffBody   = this.shadowRoot.getElementById('diff-body');
    const diffHeader = this.shadowRoot.getElementById('diff-header');
    const diffChips  = this.shadowRoot.getElementById('diff-chips');

    const added     = diff?.added     ?? [];
    const fixed     = diff?.fixed     ?? [];
    const unchanged = diff?.unchanged ?? [];

    diffHeader.querySelector('.diff-title').innerHTML =
      `Current vs <strong>${esc(commit?.short ?? 'selected')}</strong> · ${esc(commit?.message ?? '')}`;

    diffChips.innerHTML = `
      <span class="chip chip-added">+${added.length} new</span>
      <span class="chip chip-fixed">-${fixed.length} fixed</span>
      <span class="chip chip-unchanged">${unchanged.length} same</span>
    `;

    if (added.length === 0 && fixed.length === 0) {
      const msg = unchanged.length === 0
        ? 'Both versions are violation-free — clean board!'
        : 'No DRC changes between these versions.';
      diffBody.innerHTML = `<div class="state-msg">
        <km-icon name="success" size="xl"></km-icon>
        <span>${msg}</span>
        <span class="state-hint">${unchanged.length} violations unchanged</span>
      </div>`;
      return;
    }

    diffBody.innerHTML = `
      ${added.length > 0 ? `
        <div class="diff-section">
          <div class="diff-section-label label-added">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M6 3v6M3 6h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            ${added.length} New Violation${added.length !== 1 ? 's' : ''}
          </div>
          ${added.map(v => _violRow(v, 'added')).join('')}
        </div>
      ` : ''}

      ${fixed.length > 0 ? `
        <div class="diff-section">
          <div class="diff-section-label label-fixed">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M3.5 6.2l2 2 3-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${fixed.length} Fixed Violation${fixed.length !== 1 ? 's' : ''}
          </div>
          ${fixed.map(v => _violRow(v, 'fixed')).join('')}
        </div>
      ` : ''}

      ${unchanged.length > 0 ? `
        <div class="diff-section">
          <div class="diff-section-label label-unchanged">
            ${unchanged.length} Unchanged
          </div>
          ${unchanged.slice(0, 5).map(v => _violRow(v, 'unchanged')).join('')}
          ${unchanged.length > 5 ? `<div class="diff-overflow-hint">… ${unchanged.length - 5} more unchanged</div>` : ''}
        </div>
      ` : ''}
    `;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _violRow(v, kind) {
  const sign = kind === 'added' ? '+' : kind === 'fixed' ? '−' : '·';
  const signClass = kind === 'added' ? 'sign-add' : kind === 'fixed' ? 'sign-fix' : '';
  return `
    <div class="viol-row ${kind}">
      <span class="viol-sign ${signClass}">${sign}</span>
      <span class="viol-text">${esc(v.description)}</span>
      <span class="viol-badge">${esc(v.violation_type || v.severity)}</span>
    </div>
  `;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

customElements.define('km-revision-timeline', RevisionTimeline);
