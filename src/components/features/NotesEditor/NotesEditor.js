/**
 * @element km-notes-editor
 * @summary Engineering notes editor with Markdown preview, smart-links,
 *          auto-save, and integrated project task list.
 *
 * Reads/writes:
 *   .kimaster/notes.md   — via NotesService.loadNotes / scheduleAutoSave
 *   .kimaster/tasks.json — via NotesService load/add/toggle/deleteTask
 *
 * Smart-links in Markdown preview:
 *   [R1], [C5], [U2]   → designator links → highlight component in KiCad
 *   {GND}, {VCC}       → net links → highlight net in KiCad
 *
 * Toolbar quick-inserts: Bold, Italic, Code, Heading, Separator, Insert Metadata
 * Auto-save: 800 ms debounce after any keystroke (uses NotesService.scheduleAutoSave)
 *
 * @fires km-notes-saved      — after auto-save: { timestamp }
 * @fires km-notes-link-click — user clicked a smart-link: { ref|net, type }
 */

import { store, subscribe } from '../../../core/State.js';
import { Logger            } from '../../../core/Logger.js';
import {
  loadNotes, scheduleAutoSave,
  loadTasks, addTask, toggleTask, deleteTask,
} from '../../../modules/notes/NotesService.js';
import { KM_NOTES_SAVED, KM_NOTES_LINK_CLICK } from '../../../core/AppEvents.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--km-font);
    font-size: var(--km-font-size-base);
    color: var(--km-text-primary);
  }

  /* ── Header / Tabs ── */
  .notes-header {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: 0 var(--km-space-3);
    height: 38px;
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-elevated);
  }

  .tab-btn {
    background: none;
    border: none;
    padding: var(--km-space-1) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    font-size: var(--km-font-size-sm);
    font-family: var(--km-font);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
  }
  .tab-btn:hover { color: var(--km-text-primary); background: var(--km-bg-surface); }
  .tab-btn.active {
    color: var(--km-accent);
    background: var(--km-accent-muted);
  }

  .header-sep { flex: 1; }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: var(--km-space-1) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    background: var(--km-bg-surface);
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1;
  }
  .toolbar.hidden { display: none; }

  .tool-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--km-radius-xs);
    padding: 2px 7px;
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    cursor: pointer;
    transition: color var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease),
                background var(--km-duration-fast) var(--km-ease);
    white-space: nowrap;
  }
  .tool-btn:hover {
    color: var(--km-text-primary);
    border-color: var(--km-border);
    background: var(--km-bg-elevated);
  }
  .tool-sep {
    width: 1px;
    height: 14px;
    background: var(--km-border);
    margin: 0 var(--km-space-1);
    flex-shrink: 0;
  }

  /* Preview toggle in toolbar */
  .preview-toggle {
    margin-left: auto;
    font-size: var(--km-font-size-xs);
    font-family: var(--km-font);
  }
  .preview-toggle.active {
    color: var(--km-accent);
    border-color: var(--km-accent);
    background: var(--km-accent-muted);
  }

  /* ── Editor Body ── */
  .editor-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    position: relative;
  }

  /* Markdown textarea */
  .md-textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    padding: var(--km-space-4);
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-sm);
    line-height: 1.6;
    tab-size: 2;
    overflow-y: auto;
    height: 100%;
    box-sizing: border-box;
  }
  .md-textarea::placeholder { color: var(--km-text-muted); }
  .md-textarea.hidden { display: none; }

  /* Markdown preview pane */
  .md-preview {
    flex: 1;
    padding: var(--km-space-4) var(--km-space-5);
    background: var(--km-bg-primary);
    overflow-y: auto;
    line-height: 1.7;
  }
  .md-preview.hidden { display: none; }

  /* Rendered Markdown styling */
  .md-preview h1,h2,h3,h4 { color: var(--km-text-primary); margin: 0.8em 0 0.4em; line-height: 1.3; }
  .md-preview h1 { font-size: 18px; border-bottom: 1px solid var(--km-border); padding-bottom: 0.3em; }
  .md-preview h2 { font-size: 15px; }
  .md-preview h3 { font-size: 14px; color: var(--km-text-secondary); }
  .md-preview p  { margin: 0 0 0.8em; color: var(--km-text-secondary); }
  .md-preview a  { color: var(--km-accent); text-decoration: none; }
  .md-preview a:hover { text-decoration: underline; }
  .md-preview code {
    font-family: var(--km-font-mono);
    font-size: 11px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    padding: 1px 5px;
    color: var(--km-cyan);
  }
  .md-preview pre {
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-3);
    overflow-x: auto;
    margin: 0.6em 0;
  }
  .md-preview pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: 11.5px;
    color: var(--km-text-primary);
  }
  .md-preview ul, .md-preview ol {
    margin: 0 0 0.8em;
    padding-left: 1.4em;
    color: var(--km-text-secondary);
  }
  .md-preview li { margin: 0.2em 0; }
  .md-preview blockquote {
    border-left: 3px solid var(--km-accent);
    margin: 0.6em 0;
    padding: 0.4em var(--km-space-3);
    color: var(--km-text-muted);
    background: var(--km-accent-muted);
    border-radius: 0 var(--km-radius-xs) var(--km-radius-xs) 0;
  }
  .md-preview hr {
    border: none;
    border-top: 1px solid var(--km-border);
    margin: 1.2em 0;
  }
  .md-preview table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--km-font-size-sm);
    margin: 0.8em 0;
  }
  .md-preview th, .md-preview td {
    border: 1px solid var(--km-border);
    padding: var(--km-space-1) var(--km-space-2);
    text-align: left;
  }
  .md-preview th { background: var(--km-bg-elevated); color: var(--km-text-primary); font-weight: 500; }

  /* Smart-link chips */
  .smart-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-xs);
    padding: 0 5px;
    font-family: var(--km-font-mono);
    font-size: 11px;
    cursor: pointer;
    transition: border-color var(--km-duration-fast) var(--km-ease),
                color var(--km-duration-fast) var(--km-ease);
    text-decoration: none;
    vertical-align: middle;
    line-height: 1.8;
  }
  .smart-link.ref-link {
    color: var(--km-accent);
    border-color: rgba(37, 99, 235, 0.3);
  }
  .smart-link.ref-link:hover {
    border-color: var(--km-accent);
    background: var(--km-accent-muted);
  }
  .smart-link.net-link {
    color: var(--km-cyan);
    border-color: rgba(6, 182, 212, 0.3);
  }
  .smart-link.net-link:hover {
    border-color: var(--km-cyan);
    background: rgba(6, 182, 212, 0.1);
  }

  /* ── No-project state ── */
  .no-project {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--km-space-3);
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }
  .no-project.hidden { display: none; }

  /* ── Tasks Panel ── */
  .tasks-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .tasks-panel.hidden { display: none; }

  .task-input-row {
    display: flex;
    gap: var(--km-space-2);
    padding: var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .task-input {
    flex: 1;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-1) var(--km-space-2);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    outline: none;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .task-input:focus { border-color: var(--km-accent); }
  .task-input::placeholder { color: var(--km-text-muted); }

  .add-task-btn {
    background: var(--km-accent);
    border: none;
    border-radius: var(--km-radius-sm);
    padding: var(--km-space-1) var(--km-space-3);
    color: #fff;
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .add-task-btn:hover { background: var(--km-accent-hover); }

  .task-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--km-space-2) 0;
  }

  .task-item {
    display: flex;
    align-items: flex-start;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    border-bottom: 1px solid var(--km-border);
    transition: background var(--km-duration-fast) var(--km-ease);
  }
  .task-item:hover { background: var(--km-bg-surface); }
  .task-item:last-child { border-bottom: none; }

  .task-cb {
    width: 15px;
    height: 15px;
    margin-top: 1px;
    accent-color: var(--km-accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .task-text {
    flex: 1;
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    line-height: 1.5;
    word-break: break-word;
  }
  .task-text.done {
    text-decoration: line-through;
    color: var(--km-text-muted);
  }

  .task-del {
    background: none;
    border: none;
    color: var(--km-text-muted);
    cursor: pointer;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
    opacity: 0;
    transition: color var(--km-duration-fast) var(--km-ease),
                opacity var(--km-duration-fast) var(--km-ease);
  }
  .task-item:hover .task-del { opacity: 1; }
  .task-del:hover { color: var(--km-red, #ef4444); }

  .tasks-empty {
    padding: var(--km-space-6);
    text-align: center;
    color: var(--km-text-muted);
    font-size: var(--km-font-size-sm);
  }
  .tasks-empty.hidden { display: none; }

  .tasks-summary {
    padding: var(--km-space-2) var(--km-space-3);
    border-top: 1px solid var(--km-border);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* ── Footer status bar ── */
  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    padding: 3px var(--km-space-3);
    border-top: 1px solid var(--km-border);
    background: var(--km-bg-elevated);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .status-bar.hidden { display: none; }

  .save-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .save-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--km-text-muted);
    flex-shrink: 0;
    transition: background var(--km-duration-base) var(--km-ease);
  }
  .save-dot.saved  { background: var(--km-green); }
  .save-dot.saving { background: var(--km-cyan); animation: pulse-dot 0.8s ease-in-out infinite; }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  .status-sep { flex: 1; }
</style>

<!-- Tab header -->
<div class="notes-header">
  <button class="tab-btn active" data-tab="notes">notes</button>
  <button class="tab-btn"        data-tab="tasks">tasks</button>
  <span class="header-sep"></span>
</div>

<!-- No-project state -->
<div class="no-project hidden" id="no-project">
  <km-icon name="notes" size="xl"></km-icon>
  <span>Open a KiCad project to write engineering notes.</span>
</div>

<!-- ── Notes tab ── -->
<div id="notes-tab" class="editor-body">
  <!-- Toolbar (only shown in notes tab) -->
  <div class="toolbar" id="toolbar">
    <button class="tool-btn" data-insert="**bold**"    title="Bold (Ctrl+B)"><b>B</b></button>
    <button class="tool-btn" data-insert="_italic_"   title="Italic (Ctrl+I)"><i>I</i></button>
    <button class="tool-btn" data-insert="\`code\`"    title="Inline code">&lt;&gt;</button>
    <div class="tool-sep"></div>
    <button class="tool-btn" data-insert="## Heading" title="Heading">H2</button>
    <button class="tool-btn" data-insert="\n---\n"     title="Horizontal rule">—</button>
    <div class="tool-sep"></div>
    <button class="tool-btn" id="insert-meta"         title="Insert board metadata">⊕ metadata</button>
    <div class="tool-sep"></div>
    <button class="tool-btn preview-toggle" id="preview-toggle" title="Toggle preview">preview</button>
  </div>
  <!-- Editor panes -->
  <textarea
    class="md-textarea"
    id="md-textarea"
    placeholder="# Engineering Notes&#10;&#10;Write Markdown here. Use [R1] to link components, {GND} to link nets.&#10;&#10;Auto-saved to .kimaster/notes.md"
    spellcheck="false"
  ></textarea>
  <div class="md-preview hidden" id="md-preview"></div>
</div>

<!-- ── Tasks tab ── -->
<div id="tasks-tab" class="tasks-panel hidden">
  <div class="task-input-row">
    <input class="task-input" id="task-input" placeholder="Add a task…" type="text" />
    <button class="add-task-btn" id="add-task-btn">Add</button>
  </div>
  <div class="task-list" id="task-list">
    <div class="tasks-empty" id="tasks-empty">No tasks yet. Add one above.</div>
  </div>
  <div class="tasks-summary" id="tasks-summary"></div>
</div>

<!-- Status bar -->
<div class="status-bar hidden" id="status-bar">
  <div class="save-indicator">
    <div class="save-dot" id="save-dot"></div>
    <span id="save-label">unsaved</span>
  </div>
  <span class="status-sep"></span>
  <span id="word-count">0 words</span>
</div>
`;

// ── Minimal Markdown renderer ─────────────────────────────────────────────────
// We intentionally avoid importing a full MD library. This covers the common
// engineering-notes subset: headings, bold/italic, code, blockquote, lists,
// horizontal rules, tables, and smart-links. Inline HTML is NOT allowed.

/**
 * Render a small, safe subset of Markdown to sanitised HTML.
 * Processes smart-links: `[REF]` → designator chip, `{NET}` → net chip.
 * @param {string} md
 * @returns {string} HTML string (no <script>, no event attributes)
 */
function renderMarkdown(md) {
  if (!md) return '';
  // Escape HTML characters in raw input first
  const escape = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const lines  = md.split('\n');
  let   html   = '';
  let   inCode = false;
  let   inList = false;
  let   inTable= false;
  let   codeBuf= '';

  const flushList  = () => { if (inList)  { html += '</ul>\n'; inList  = false; } };
  const flushTable = () => { if (inTable) { html += '</tbody></table>\n'; inTable = false; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code blocks
    if (raw.startsWith('```')) {
      if (!inCode) { flushList(); flushTable(); inCode = true; codeBuf = ''; html += '<pre><code>'; }
      else          { inCode = false; html += escape(codeBuf) + '</code></pre>\n'; codeBuf = ''; }
      continue;
    }
    if (inCode) { codeBuf += raw + '\n'; continue; }

    // Headings
    const hm = raw.match(/^(#{1,4})\s+(.*)/);
    if (hm) { flushList(); flushTable(); html += `<h${hm[1].length}>${inlineRender(escape(hm[2]))}</h${hm[1].length}>\n`; continue; }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(raw.trim())) { flushList(); flushTable(); html += '<hr>\n'; continue; }

    // Blockquote
    if (raw.startsWith('> ')) { flushList(); flushTable(); html += `<blockquote>${inlineRender(escape(raw.slice(2)))}</blockquote>\n`; continue; }

    // Table row (very basic — uses | separator)
    if (raw.includes('|') && raw.trim().startsWith('|')) {
      flushList();
      if (!inTable) { html += '<table><thead><tr>'; inTable = 'head'; }
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (inTable === 'head' && cells.every(c => /^[-:]+$/.test(c))) {
        html += '</tr></thead><tbody>'; inTable = 'body'; continue;
      }
      const tag = inTable === 'head' ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${inlineRender(escape(c))}</${tag}>`).join('') + '</tr>\n';
      continue;
    }
    flushTable();

    // Unordered list
    const lm = raw.match(/^[\s]*[-*+]\s+(.*)/);
    if (lm) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inlineRender(escape(lm[1]))}</li>\n`; continue; }

    // Ordered list
    const om = raw.match(/^[\s]*\d+\.\s+(.*)/);
    if (om) { flushList(); html += `<li>${inlineRender(escape(om[1]))}</li>\n`; continue; }

    flushList();

    // Empty line → paragraph break
    if (!raw.trim()) { html += '<br>\n'; continue; }

    // Paragraph
    html += `<p>${inlineRender(escape(raw))}</p>\n`;
  }

  flushList();
  flushTable();
  if (inCode) html += escape(codeBuf) + '</code></pre>\n';

  return html;
}

/**
 * Process inline Markdown: bold, italic, code, links, smart-links.
 * @param {string} text  Already HTML-escaped line text.
 * @returns {string}
 */
function inlineRender(text) {
  return text
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Smart-link designators: [R1], [C5], [U2], [D12]
    .replace(/\[([A-Z][A-Z]?\d+[A-Z]?(?:\.\d+)?)\]/g,
      (_, ref) => `<button class="smart-link ref-link" data-ref="${ref}" data-type="ref" title="Highlight ${ref} in KiCad">${ref}</button>`)
    // Smart-link nets: {GND}, {VCC}, {NET_NAME}
    .replace(/\{([A-Za-z_][A-Za-z0-9_/]*)\}/g,
      (_, net) => `<button class="smart-link net-link" data-net="${net}" data-type="net" title="Highlight net ${net} in KiCad">${net}</button>`)
    // Bare URLs
    .replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

// ── Component ─────────────────────────────────────────────────────────────────

export class KmNotesEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    this._activeTab   = 'notes';
    this._showPreview = false;
    this._unsubs      = [];

    /** @type {Array<import('../../../modules/notes/NotesService.js').Task>} */
    this._tasks       = [];
    this._taskBusy    = false;  // debounce rapid task saves
  }

  connectedCallback() {
    this._unsubs.push(
      subscribe('project', () => this._onProjectChange()),
    );

    this._wireTabButtons();
    this._wireToolbar();
    this._wireTaskInput();
    this._onProjectChange();
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── Project change ────────────────────────────────────────────────────────

  _onProjectChange() {
    const hasProject = !!store.project;
    const noProj     = this.shadowRoot.getElementById('no-project');
    const noteTab    = this.shadowRoot.getElementById('notes-tab');
    const taskTab    = this.shadowRoot.getElementById('tasks-tab');
    const statusBar  = this.shadowRoot.getElementById('status-bar');

    if (!hasProject) {
      noProj.classList.remove('hidden');
      noteTab.classList.add('hidden');
      taskTab.classList.add('hidden');
      statusBar.classList.add('hidden');
      return;
    }
    noProj.classList.add('hidden');
    statusBar.classList.remove('hidden');
    this._showTab(this._activeTab);
    this._load();
  }

  async _load() {
    if (!store.project) return;
    // Load notes
    const content = await loadNotes();
    const ta = this.shadowRoot.getElementById('md-textarea');
    ta.value = content;
    this._updateWordCount(content);
    this._setSaveState('saved', '');

    // Load tasks
    this._tasks = await loadTasks();
    this._renderTasks();
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  _wireTabButtons() {
    const btns = this.shadowRoot.querySelectorAll('.tab-btn');
    for (const btn of btns) {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab;
        btns.forEach(b => b.classList.toggle('active', b.dataset.tab === this._activeTab));
        this._showTab(this._activeTab);
      });
    }
  }

  _showTab(tab) {
    const noteTab  = this.shadowRoot.getElementById('notes-tab');
    const taskTab  = this.shadowRoot.getElementById('tasks-tab');
    const toolbar  = this.shadowRoot.getElementById('toolbar');
    const statusBar= this.shadowRoot.getElementById('status-bar');

    // Toolbar & status only visible in notes tab
    toolbar.classList.toggle('hidden', tab !== 'notes');
    statusBar.classList.toggle('hidden', tab !== 'notes' || !store.project);

    if (tab === 'notes') {
      noteTab.classList.remove('hidden');
      taskTab.classList.add('hidden');
      // Adjust textarea top-padding for inline toolbar
      this._adjustTextareaPadding();
    } else {
      noteTab.classList.add('hidden');
      taskTab.classList.remove('hidden');
    }
  }

  _adjustTextareaPadding() {
    const toolbar = this.shadowRoot.getElementById('toolbar');
    const ta      = this.shadowRoot.getElementById('md-textarea');
    const preview = this.shadowRoot.getElementById('md-preview');
    if (!toolbar || !ta) return;
    // toolbar is position:absolute inside notes-tab — give editor top padding
    const tbH = toolbar.offsetHeight || 34;
    ta.style.paddingTop      = `${tbH + 8}px`;
    preview.style.paddingTop = `${tbH + 8}px`;
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _wireToolbar() {
    const toolbar = this.shadowRoot.getElementById('toolbar');

    // Insert snippets
    toolbar.querySelectorAll('.tool-btn[data-insert]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._insertSnippet(btn.dataset.insert);
      });
    });

    // Insert metadata
    this.shadowRoot.getElementById('insert-meta')?.addEventListener('click', () => {
      this._insertMetadata();
    });

    // Preview toggle
    this.shadowRoot.getElementById('preview-toggle')?.addEventListener('click', (e) => {
      this._showPreview = !this._showPreview;
      e.currentTarget.classList.toggle('active', this._showPreview);
      this._togglePreview();
    });

    // Textarea input → auto-save + word count
    const ta = this.shadowRoot.getElementById('md-textarea');
    ta.addEventListener('input', () => {
      this._updateWordCount(ta.value);
      this._setSaveState('saving', 'saving…');
      if (this._showPreview) this._updatePreview(ta.value);
      scheduleAutoSave(ta.value, (ts) => {
        this._setSaveState('saved', `saved ${_formatTime(ts)}`);
        this.dispatchEvent(new CustomEvent(KM_NOTES_SAVED, {
          bubbles: true, composed: true,
          detail: { timestamp: ts },
        }));
      });
    });

    // Keyboard shortcuts in textarea
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        this._insertSnippet('**bold**');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        this._insertSnippet('_italic_');
      }
    });
  }

  _insertSnippet(snippet) {
    const ta    = this.shadowRoot.getElementById('md-textarea');
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.substring(start, end);
    // If text is selected, wrap it; otherwise insert at cursor
    const toInsert = sel
      ? snippet.replace('bold', sel).replace('italic', sel).replace('code', sel)
      : snippet;
    const before  = ta.value.substring(0, start);
    const after   = ta.value.substring(end);
    ta.value      = before + toInsert + after;
    const cursor  = start + toInsert.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  _insertMetadata() {
    const bs  = store.boardState;
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    let meta  = `\n---\n**Board snapshot** — ${now}\n`;
    if (bs) {
      const size = bs.board_size;
      if (size) meta += `- Size: ${(size.width_mm||0).toFixed(1)} × ${(size.height_mm||0).toFixed(1)} mm\n`;
      const dr = bs.design_rules;
      if (dr) {
        if (dr.min_track_width)  meta += `- Min track width: ${(dr.min_track_width*1000).toFixed(0)} µm\n`;
        if (dr.min_clearance)    meta += `- Min clearance: ${(dr.min_clearance*1000).toFixed(0)} µm\n`;
        if (dr.min_via_drill)    meta += `- Min via drill: ${(dr.min_via_drill*1000).toFixed(0)} µm\n`;
      }
    }
    const comps = store.boardComponents ?? [];
    if (comps.length) meta += `- Component count: ${comps.length}\n`;
    const drcErrors = (store.drcErrors ?? []).filter(v => v.severity === 'error').length;
    if (drcErrors > 0) meta += `- DRC errors: ${drcErrors}\n`;
    meta += `---\n`;
    this._insertSnippet(meta);
  }

  _togglePreview() {
    const ta      = this.shadowRoot.getElementById('md-textarea');
    const preview = this.shadowRoot.getElementById('md-preview');
    if (this._showPreview) {
      ta.classList.add('hidden');
      preview.classList.remove('hidden');
      this._updatePreview(ta.value);
    } else {
      ta.classList.remove('hidden');
      preview.classList.add('hidden');
    }
  }

  _updatePreview(md) {
    const preview = this.shadowRoot.getElementById('md-preview');
    preview.innerHTML = renderMarkdown(md);
    // Wire smart-link clicks in preview
    for (const btn of preview.querySelectorAll('.smart-link')) {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const ref  = btn.dataset.ref;
        const net  = btn.dataset.net;
        this.dispatchEvent(new CustomEvent(KM_NOTES_LINK_CLICK, {
          bubbles: true, composed: true,
          detail: { type, ref, net },
        }));
      });
    }
  }

  // ── Save state indicator ──────────────────────────────────────────────────

  _setSaveState(state, label) {
    const dot = this.shadowRoot.getElementById('save-dot');
    const lbl = this.shadowRoot.getElementById('save-label');
    if (!dot || !lbl) return;
    dot.className = `save-dot ${state}`;
    lbl.textContent = label;
  }

  _updateWordCount(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wc    = this.shadowRoot.getElementById('word-count');
    if (wc) wc.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  _wireTaskInput() {
    const input = this.shadowRoot.getElementById('task-input');
    const btn   = this.shadowRoot.getElementById('add-task-btn');

    const add = async () => {
      const text = input.value.trim();
      if (!text || this._taskBusy) return;
      input.value = '';
      this._taskBusy = true;
      try {
        this._tasks = await addTask(this._tasks, text);
        this._renderTasks();
      } catch (err) {
        Logger.error('NotesEditor', 'Failed to add task', err);
      } finally {
        this._taskBusy = false;
      }
    };

    btn.addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  _renderTasks() {
    const list    = this.shadowRoot.getElementById('task-list');
    const empty   = this.shadowRoot.getElementById('tasks-empty');
    const summary = this.shadowRoot.getElementById('tasks-summary');

    const tasks   = this._tasks;
    empty.classList.toggle('hidden', tasks.length > 0);

    const done    = tasks.filter(t => t.done).length;
    summary.textContent = tasks.length
      ? `${done} / ${tasks.length} done`
      : '';

    // Re-render task rows
    const rows = list.querySelectorAll('.task-item');
    rows.forEach(r => r.remove());

    for (const task of tasks) {
      const item = document.createElement('div');
      item.className = 'task-item';
      item.innerHTML = `
        <input class="task-cb" type="checkbox" ${task.done ? 'checked' : ''} title="Toggle done">
        <span class="task-text${task.done ? ' done' : ''}">${_esc(task.text)}</span>
        <button class="task-del" title="Delete task">✕</button>
      `;
      // Toggle
      item.querySelector('.task-cb').addEventListener('change', async () => {
        if (this._taskBusy) return;
        this._taskBusy = true;
        try {
          this._tasks = await toggleTask(this._tasks, task.id);
          this._renderTasks();
        } catch (err) {
          Logger.error('NotesEditor', 'Failed to toggle task', err);
        } finally {
          this._taskBusy = false;
        }
      });
      // Delete
      item.querySelector('.task-del').addEventListener('click', async () => {
        if (this._taskBusy) return;
        this._taskBusy = true;
        try {
          this._tasks = await deleteTask(this._tasks, task.id);
          this._renderTasks();
        } catch (err) {
          Logger.error('NotesEditor', 'Failed to delete task', err);
        } finally {
          this._taskBusy = false;
        }
      });
      list.insertBefore(item, empty);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _formatTime(isoTs) {
  try {
    return new Date(isoTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

customElements.define('km-notes-editor', KmNotesEditor);
