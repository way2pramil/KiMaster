/**
 * @element km-export-wizard
 * @summary Export center — profile-driven, per-type configurable output.
 *
 * Profiles (KiMaster Universal, JLCPCB, PCBWay, Global + user profiles)
 * store both path settings and per-type kicad-cli options.
 * All paths derive from the active KiCad bridge connection.
 *
 * @fires km-export-start  - detail: { type }
 * @fires km-export-done   - detail: { type, result }
 * @fires km-export-error  - detail: { type, error }
 */

import { invoke } from '../../../core/Ipc.js';
import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import { notify } from '../../../core/Notify.js';
import {
  EXPORT_GERBERS, EXPORT_DRILL, EXPORT_POS,
  EXPORT_SVG, EXPORT_PDF, EXPORT_BOM,
  EXPORT_SCH_PDF, EXPORT_SCH_SVG, EXPORT_STEP,
  EXPORT_FAB_PACK,
} from '../../../core/AppCommands.js';
import {
  OUTPUT_TYPE_LABELS,
  listProfiles, loadProfile, saveProfile, deleteProfile, cloneBuiltinProfile,
  buildConfigs, resolveOutputDir, prepareDir, openOutputDir,
} from '../../../modules/export/ExportProfileService.js';
import { showConfigDialog } from './ExportConfigDialog.js';

// ── Export type definitions (9 types including STEP) ─────────────────────────

const EXPORT_TYPES = [
  { id: 'gerbers',  icon: 'gerber',    label: 'Gerber Files',      desc: 'Industry-standard PCB fabrication files',           fileType: 'pcb' },
  { id: 'drill',    icon: 'via',       label: 'Drill Files',       desc: 'Excellon or Gerber X2 drill files',                 fileType: 'pcb' },
  { id: 'pos',      icon: 'footprint', label: 'Position Files',    desc: 'Component placement for pick-and-place',            fileType: 'pcb' },
  { id: 'svg',      icon: 'layers',    label: 'PCB SVG',           desc: 'Scalable vector graphics of board layers',          fileType: 'pcb' },
  { id: 'pdf',      icon: 'gerber',    label: 'PCB PDF',           desc: 'Print-ready PDF of board layers',                   fileType: 'pcb' },
  { id: 'step',     icon: 'render',    label: '3D STEP',           desc: 'STEP 3D model for mechanical CAD integration',      fileType: 'pcb' },
  { id: 'bom',      icon: 'bom',       label: 'Bill of Materials', desc: 'Component list with values and footprints',         fileType: 'sch' },
  { id: 'sch_pdf',  icon: 'schematic', label: 'Schematic PDF',     desc: 'Multi-page schematic as PDF',                       fileType: 'sch' },
  { id: 'sch_svg',  icon: 'schematic', label: 'Schematic SVG',     desc: 'Schematic sheets as SVG files',                     fileType: 'sch' },
];

const TOKEN_CHIPS = [
  { token: '{variant}',      label: 'variant' },
  { token: '{version}',      label: 'version' },
  { token: '{project_name}', label: 'project_name' },
  { token: '{output_type}',  label: 'output_type' },
  { token: '{timestamp}',    label: 'timestamp' },
];

// ── Template ──────────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    font-family: var(--km-font);
    height: 100%;
  }

  .wizard {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--km-space-4) var(--km-space-6);
    gap: var(--km-space-3);
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: var(--km-space-3);
    flex-shrink: 0;
  }
  .header-title {
    font-size: var(--km-font-size-lg);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    flex: 1;
  }

  /* ── Bridge banner ── */
  .bridge-banner {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    background: rgba(6,182,212,0.06);
    border: 1px solid rgba(6,182,212,0.18);
    border-radius: var(--km-radius-sm);
    flex-shrink: 0;
  }
  .bridge-banner-label { font-size: var(--km-font-size-xs); color: var(--km-text-muted); flex-shrink: 0; }
  .bridge-banner-path {
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }

  /* ── Profile section ── */
  .profile-section {
    flex-shrink: 0;
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    overflow: hidden;
  }
  .profile-section summary {
    display: flex; align-items: center; gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    cursor: pointer;
    font-size: var(--km-font-size-xs); font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary); user-select: none; list-style: none;
  }
  .profile-section summary::-webkit-details-marker { display: none; }
  .profile-section summary::before {
    content: '▶'; font-size: 9px; color: var(--km-text-muted);
    transition: transform var(--km-duration-fast) var(--km-ease);
  }
  .profile-section[open] summary::before { transform: rotate(90deg); }
  .profile-body {
    padding: var(--km-space-3) var(--km-space-4) var(--km-space-4);
    display: flex; flex-direction: column; gap: var(--km-space-3);
    border-top: 1px solid var(--km-border);
  }

  /* ── Profile selector row ── */
  .profile-selector-row { display: flex; align-items: center; gap: var(--km-space-2); }
  .profile-select {
    flex: 1; padding: var(--km-space-1-5) var(--km-space-2);
    border-radius: var(--km-radius-sm); border: 1px solid var(--km-border);
    background: var(--km-bg-primary); color: var(--km-text-primary);
    font-family: var(--km-font); font-size: var(--km-font-size-sm);
    outline: none; min-width: 0;
  }
  .profile-select:focus { border-color: var(--km-accent); }
  .profile-name-input {
    flex: 1; padding: var(--km-space-1-5) var(--km-space-2);
    border-radius: var(--km-radius-sm); border: 1px solid var(--km-accent);
    background: var(--km-accent-muted); color: var(--km-text-primary);
    font-family: var(--km-font); font-size: var(--km-font-size-sm); outline: none;
  }
  .profile-btn {
    padding: var(--km-space-1) var(--km-space-2);
    border-radius: var(--km-radius-sm); border: 1px solid var(--km-border);
    background: var(--km-bg-elevated); color: var(--km-text-secondary);
    font-family: var(--km-font); font-size: var(--km-font-size-xs);
    cursor: pointer; white-space: nowrap; flex-shrink: 0;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .profile-btn:hover { border-color: var(--km-border-strong); color: var(--km-text-primary); }
  .profile-btn--danger:hover { border-color: var(--km-danger); color: var(--km-danger); }
  .profile-btn--lock { opacity: 0.5; cursor: default; }

  /* ── Form rows ── */
  .form-row { display: flex; align-items: center; gap: var(--km-space-2); }
  .form-label { font-size: var(--km-font-size-xs); color: var(--km-text-muted); width: 64px; flex-shrink: 0; text-align: right; }
  .form-input {
    flex: 1; padding: var(--km-space-1-5) var(--km-space-2);
    border-radius: var(--km-radius-sm); border: 1px solid var(--km-border);
    background: var(--km-bg-primary); color: var(--km-text-secondary);
    font-family: var(--km-font-mono); font-size: var(--km-font-size-xs);
    outline: none; transition: border-color var(--km-duration-fast) var(--km-ease); min-width: 0;
  }
  .form-input:focus { border-color: var(--km-accent); color: var(--km-text-primary); }

  /* ── Base target radios ── */
  .radio-group { display: flex; flex-direction: column; gap: var(--km-space-1); }
  .radio-row { display: flex; align-items: center; gap: var(--km-space-2); }
  .radio-row input[type=radio] { accent-color: var(--km-accent); flex-shrink: 0; }
  .radio-label { font-size: var(--km-font-size-xs); color: var(--km-text-secondary); flex-shrink: 0; width: 110px; }

  /* ── Breadcrumb path builder ── */
  .path-builder {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3px;
    padding: 5px 8px;
    background: var(--km-bg-app);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    min-height: 32px;
    flex: 1;
  }
  .path-builder.readonly { opacity: 0.55; pointer-events: none; }
  .pb-sep {
    font-size: 13px; color: var(--km-text-muted); user-select: none; padding: 0 1px;
  }
  .pb-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 7px; border-radius: var(--km-radius-full);
    font-size: 11px; font-family: var(--km-font-mono);
    border: 1px solid; cursor: default; transition: all var(--km-duration-fast);
  }
  .pb-chip--token {
    background: rgba(6,182,212,0.12); border-color: rgba(6,182,212,0.3);
    color: var(--km-live);
  }
  .pb-chip--text {
    background: var(--km-bg-elevated); border-color: var(--km-border);
    color: var(--km-text-secondary);
  }
  .pb-chip__remove {
    font-size: 12px; line-height: 1; cursor: pointer; opacity: 0.6;
    background: none; border: none; padding: 0; color: inherit;
    transition: opacity var(--km-duration-fast);
  }
  .pb-chip__remove:hover { opacity: 1; }
  .pb-add {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--km-radius-full);
    border: 1px dashed var(--km-border); background: none;
    color: var(--km-text-muted); font-size: 11px; cursor: pointer;
    transition: all var(--km-duration-fast);
    position: relative;
  }
  .pb-add:hover { border-color: var(--km-accent); color: var(--km-accent); }
  .pb-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 50;
    background: var(--km-bg-elevated); border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md); box-shadow: var(--km-shadow-md);
    min-width: 180px; padding: 4px;
  }
  .pb-dropdown-item {
    display: block; width: 100%; text-align: left;
    padding: 5px 10px; border-radius: var(--km-radius-xs);
    border: none; background: none; cursor: pointer;
    font-size: var(--km-font-size-xs); font-family: var(--km-font-mono);
    color: var(--km-text-secondary);
    transition: background var(--km-duration-fast);
  }
  .pb-dropdown-item:hover { background: var(--km-bg-surface); color: var(--km-text-primary); }
  .pb-dropdown-item--token { color: var(--km-live); }
  .pb-dropdown-sep { height: 1px; background: var(--km-border); margin: 3px 0; }
  .pb-custom-row { display: flex; gap: 4px; padding: 4px; }
  .pb-custom-input {
    flex: 1; padding: 3px 6px; border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border); background: var(--km-bg-primary);
    color: var(--km-text-primary); font-family: var(--km-font-mono); font-size: 11px; outline: none;
  }
  .pb-custom-input:focus { border-color: var(--km-accent); }
  .pb-custom-add {
    padding: 3px 8px; border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-accent); background: var(--km-accent-muted);
    color: var(--km-accent); font-size: 11px; cursor: pointer;
  }

  /* ── Run context ── */
  .context-row { display: flex; gap: var(--km-space-3); align-items: center; }
  .context-field { display: flex; align-items: center; gap: var(--km-space-1-5); flex: 1; min-width: 0; }
  .context-field-label { font-size: var(--km-font-size-xs); color: var(--km-text-muted); flex-shrink: 0; }

  /* ── Path preview ── */
  .path-preview {
    display: flex; align-items: flex-start; gap: var(--km-space-2);
    padding: var(--km-space-2) var(--km-space-3);
    background: var(--km-bg-app); border-radius: var(--km-radius-sm); border: 1px solid var(--km-border);
    flex-shrink: 0;
  }
  .path-preview-icon { font-size: var(--km-font-size-sm); flex-shrink: 0; }
  .path-preview-text {
    font-family: var(--km-font-mono); font-size: var(--km-font-size-xs);
    color: var(--km-text-secondary); word-break: break-all; flex: 1;
  }
  .path-preview-text.empty { color: var(--km-text-muted); font-style: italic; }
  .path-preview-create {
    padding: 2px var(--km-space-2); border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border); background: var(--km-bg-elevated);
    color: var(--km-text-muted); font-family: var(--km-font); font-size: 10px;
    cursor: pointer; white-space: nowrap; flex-shrink: 0;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .path-preview-create:hover { border-color: var(--km-accent); color: var(--km-accent); }
  .path-preview-create.exists { border-color: var(--km-success); color: var(--km-success); cursor: default; }

  /* ── Flags row ── */
  .flags-row { display: flex; align-items: center; gap: var(--km-space-5); flex-shrink: 0; }
  .flag-item {
    display: flex; align-items: center; gap: var(--km-space-1-5);
    font-size: var(--km-font-size-xs); color: var(--km-text-secondary); cursor: pointer; user-select: none;
  }
  .flag-item input[type=checkbox] { accent-color: var(--km-accent); }

  /* ── Export grid ── */
  .export-grid {
    flex: 1; overflow-y: auto;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--km-space-3); align-content: start; min-height: 0; padding-bottom: var(--km-space-4);
  }
  .export-grid::-webkit-scrollbar { width: 6px; }
  .export-grid::-webkit-scrollbar-track { background: transparent; }
  .export-grid::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

  .export-card {
    display: flex; flex-direction: column; gap: var(--km-space-2);
    padding: var(--km-space-4); background: var(--km-bg-surface);
    border: 1px solid var(--km-border); border-radius: var(--km-radius-md);
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .export-card:hover { border-color: var(--km-border-strong); box-shadow: var(--km-shadow-sm); transform: translateY(-1px); }

  .card-top { display: flex; align-items: center; gap: var(--km-space-2); }
  .card-icon { color: var(--km-accent); flex-shrink: 0; }
  .card-label { font-size: var(--km-font-size-sm); font-weight: var(--km-font-weight-medium); color: var(--km-text-primary); flex: 1; }
  .card-badge {
    font-size: var(--km-font-size-xs); padding: 1px var(--km-space-2);
    border-radius: var(--km-radius-xs); background: var(--km-bg-elevated);
    color: var(--km-text-muted); text-transform: uppercase; letter-spacing: 0.04em;
  }
  .card-desc { font-size: var(--km-font-size-xs); color: var(--km-text-muted); line-height: var(--km-line-height-base); }
  .card-actions { display: flex; justify-content: flex-end; gap: var(--km-space-2); margin-top: var(--km-space-1); align-items: center; }
  .card-configure {
    padding: 3px var(--km-space-2); border-radius: var(--km-radius-xs);
    border: 1px solid var(--km-border); background: var(--km-bg-elevated);
    color: var(--km-text-muted); font-size: 11px; cursor: pointer;
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .card-configure:hover { border-color: var(--km-accent); color: var(--km-accent); background: var(--km-accent-muted); }

  .export-status { display: flex; align-items: center; gap: var(--km-space-2); font-size: var(--km-font-size-xs); color: var(--km-text-muted); }
  .export-status.success { color: var(--km-success); }
  .export-status.error   { color: var(--km-danger); }

  .section-label {
    grid-column: 1 / -1; font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold); color: var(--km-text-muted);
    text-transform: uppercase; letter-spacing: 0.06em;
    padding-top: var(--km-space-2); border-top: 1px solid var(--km-border);
  }
  .section-label:first-child { border-top: none; padding-top: 0; }

  .hidden { display: none !important; }
</style>

<div class="wizard">
  <div class="header">
    <km-icon name="gerber" size="lg" class="card-icon"></km-icon>
    <span class="header-title">Export Center</span>
    <km-button variant="secondary" size="sm" id="btn-fab-pack">One-click Fab Pack</km-button>
  </div>

  <div class="bridge-banner hidden" id="bridge-banner">
    <km-icon name="plug" size="sm" style="color:var(--km-live);flex-shrink:0;"></km-icon>
    <span class="bridge-banner-label">Project</span>
    <span class="bridge-banner-path" id="bridge-banner-path"></span>
  </div>

  <details class="profile-section" id="profile-section" open>
    <summary>Output Profile</summary>
    <div class="profile-body" id="profile-body"></div>
  </details>

  <div class="path-preview" id="path-preview">
    <span class="path-preview-icon">📂</span>
    <span class="path-preview-text empty" id="preview-text">Connect the KiCad bridge to see the output path.</span>
    <button class="path-preview-create hidden" id="btn-create-folder">Create Folder</button>
  </div>

  <div class="flags-row">
    <label class="flag-item">
      <input type="checkbox" id="chk-clean"> Clean target before export
    </label>
    <label class="flag-item">
      <input type="checkbox" id="chk-open" checked> Open folder on complete
    </label>
  </div>

  <div class="export-grid" id="export-grid"></div>
</div>
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class ExportWizard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

    /** @type {Array<{ id, name, is_builtin }>} */
    this._profileMetas  = [];
    /** @type {object|null} full currently-active profile */
    this._profile       = null;
    /** @type {{ variant: string, version: string }} */
    this._context       = { variant: '', version: '' };
    /** @type {object} per-type config objects */
    this._configs       = {};
    this._statuses      = {};
    this._unsubs        = [];
    this._editingNew    = false;
    this._renaming      = false;
  }

  async connectedCallback() {
    this._syncBridgeBanner();
    await this._loadProfileList();
    this._renderProfileBody();
    this._renderGrid();
    this._updatePreview();

    this.shadowRoot.getElementById('chk-open')
      .addEventListener('change', () => {});
    this.shadowRoot.getElementById('btn-fab-pack')
      ?.addEventListener('km-click', () => this._runFabPack());

    this._unsubs = [
      subscribe('bridgeConnected', () => { this._syncBridgeBanner(); this._renderGrid(); this._updatePreview(); }),
      subscribe('bridgeBoardName', () => { this._syncBridgeBanner(); this._updatePreview(); }),
    ];
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── Bridge banner ──────────────────────────────────────────────────────────

  _syncBridgeBanner() {
    const banner = this.shadowRoot.getElementById('bridge-banner');
    const pathEl = this.shadowRoot.getElementById('bridge-banner-path');
    const connected = store.bridgeConnected;
    banner?.classList.toggle('hidden', !connected || !store.bridgeBoardName);
    if (pathEl && store.bridgeBoardName) pathEl.textContent = store.bridgeBoardName;
    const fabBtn = this.shadowRoot.getElementById('btn-fab-pack');
    if (fabBtn) connected ? fabBtn.removeAttribute('disabled') : fabBtn.setAttribute('disabled', '');
  }

  // ── Profile list loading ───────────────────────────────────────────────────

  async _loadProfileList() {
    this._profileMetas = await listProfiles().catch(() => []);
    if (!this._profileMetas.length) return;
    const first = this._profileMetas[0];
    await this._activateProfile(first.id);
  }

  async _activateProfile(id) {
    try {
      this._profile = await loadProfile(id);
      this._configs = buildConfigs(this._profile);
      this._syncFlagsFromProfile();
      this._updatePreview();
      this._renderGrid();
    } catch (err) {
      Logger.warn('ExportWizard', 'Could not load profile', err);
    }
  }

  // ── Profile body rendering ─────────────────────────────────────────────────

  _renderProfileBody() {
    const body = this.shadowRoot.getElementById('profile-body');
    if (!body) return;

    const p          = this._profile;
    const isBuiltin  = p?.is_builtin ?? true;
    const editMode   = this._editingNew || this._renaming;

    const options = this._profileMetas
      .map(m => `<option value="${this._esc(m.id)}"${m.id === p?.id ? ' selected' : ''}>${this._esc(m.name)}${m.is_builtin ? ' 🔒' : ''}</option>`)
      .join('');

    body.innerHTML = `
      <div class="profile-selector-row">
        ${editMode
          ? `<input class="profile-name-input" id="profile-name-input" type="text" value="${this._esc(p?.name ?? '')}" placeholder="Profile name…">`
          : `<select class="profile-select" id="profile-select">${options}</select>`
        }
        <button class="profile-btn" id="btn-new-profile">+ New</button>
        ${isBuiltin && !editMode
          ? `<button class="profile-btn" id="btn-clone-profile">Clone</button>`
          : ''
        }
        ${!isBuiltin && !editMode
          ? `<button class="profile-btn" id="btn-rename-profile" title="Rename">✎</button>
             <button class="profile-btn profile-btn--danger" id="btn-delete-profile">Delete</button>`
          : ''
        }
      </div>

      <div class="form-row">
        <span class="form-label">Base</span>
        <div class="radio-group">
          <div class="radio-row">
            <input type="radio" name="target" id="radio-relative" value="project_relative" ${p?.target === 'project_relative' ? 'checked' : ''} ${isBuiltin ? 'disabled' : ''}>
            <label class="radio-label" for="radio-relative">Project Relative</label>
            <input class="form-input" id="input-root-rel" type="text"
              value="${this._esc(p?.target === 'project_relative' ? p.rootPath : '')}"
              placeholder="exports" ${p?.target !== 'project_relative' || isBuiltin ? 'disabled' : ''}>
          </div>
          <div class="radio-row">
            <input type="radio" name="target" id="radio-absolute" value="absolute" ${p?.target === 'absolute' ? 'checked' : ''} ${isBuiltin ? 'disabled' : ''}>
            <label class="radio-label" for="radio-absolute">Absolute Path</label>
            <input class="form-input" id="input-root-abs" type="text"
              value="${this._esc(p?.target === 'absolute' ? p.rootPath : '')}"
              placeholder="${/Mac|iPhone|iPad/.test(navigator.platform) ? '/Users/me/Fabrication' : navigator.platform?.startsWith?.('Linux') ? '/home/me/fabrication' : 'C:\\\\Fabrication'}" ${p?.target !== 'absolute' || isBuiltin ? 'disabled' : ''}>
          </div>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">Pattern</span>
        <div class="path-builder${isBuiltin ? ' readonly' : ''}" id="path-builder">
          ${this._renderPathBuilder(p?.pattern ?? '{output_type}', isBuiltin)}
        </div>
      </div>

      <div class="context-row">
        <div class="context-field">
          <span class="context-field-label">Variant</span>
          <input class="form-input" id="ctx-variant" type="text" value="${this._esc(this._context.variant)}" placeholder="e.g. 4S1P_Full">
        </div>
        <div class="context-field">
          <span class="context-field-label">Version</span>
          <input class="form-input" id="ctx-version" type="text" value="${this._esc(this._context.version)}" placeholder="e.g. Rev_C">
        </div>
      </div>
    `;

    this._wireProfileBody();
  }

  _wireProfileBody() {
    const body = this.shadowRoot.getElementById('profile-body');
    if (!body) return;

    const nameInput = body.querySelector('#profile-name-input');
    if (nameInput) {
      nameInput.focus(); nameInput.select();
      nameInput.addEventListener('blur',    () => this._commitProfileName(nameInput.value));
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  nameInput.blur();
        if (e.key === 'Escape') { this._editingNew = false; this._renaming = false; this._renderProfileBody(); }
      });
    }

    body.querySelector('#profile-select')?.addEventListener('change', async (e) => {
      await this._activateProfile(e.target.value);
      this._renderProfileBody();
    });
    body.querySelector('#btn-new-profile')?.addEventListener('click',    () => this._createNewProfile());
    body.querySelector('#btn-clone-profile')?.addEventListener('click',  () => this._cloneCurrentProfile());
    body.querySelector('#btn-rename-profile')?.addEventListener('click', () => { this._renaming = true; this._renderProfileBody(); });
    body.querySelector('#btn-delete-profile')?.addEventListener('click', () => this._deleteCurrentProfile());

    for (const radio of body.querySelectorAll('input[name=target]')) {
      radio.addEventListener('change', () => {
        if (!this._profile) return;
        this._profile.target = radio.value;
        body.querySelector('#input-root-rel').disabled = radio.value !== 'project_relative';
        body.querySelector('#input-root-abs').disabled = radio.value !== 'absolute';
        this._autosaveProfile();
        this._updatePreview();
      });
    }
    body.querySelector('#input-root-rel')?.addEventListener('input', (e) => {
      if (this._profile?.target === 'project_relative') { this._profile.rootPath = e.target.value; this._autosaveProfile(); this._updatePreview(); }
    });
    body.querySelector('#input-root-abs')?.addEventListener('input', (e) => {
      if (this._profile?.target === 'absolute') { this._profile.rootPath = e.target.value; this._autosaveProfile(); this._updatePreview(); }
    });
    // Wire breadcrumb path builder
    this._wirePathBuilder();

    body.querySelector('#ctx-variant')?.addEventListener('input', (e) => { this._context.variant = e.target.value; this._updatePreview(); });
    body.querySelector('#ctx-version')?.addEventListener('input', (e) => { this._context.version = e.target.value; this._updatePreview(); });
  }

  _syncFlagsFromProfile() {
    const cleanEl = this.shadowRoot.getElementById('chk-clean');
    const openEl  = this.shadowRoot.getElementById('chk-open');
    if (cleanEl) cleanEl.checked = !!this._profile?.cleanTarget;
    if (openEl)  openEl.checked  = this._profile?.openOnComplete !== false;
  }

  // ── Profile CRUD ───────────────────────────────────────────────────────────

  async _createNewProfile() {
    const newP = {
      id: `user_${Date.now()}`, name: 'New Profile', is_builtin: false,
      target: 'project_relative', rootPath: 'exports', pattern: '{output_type}',
      openOnComplete: true, cleanTarget: false, configs: {},
    };
    await saveProfile(newP).catch(() => {});
    this._profileMetas = await listProfiles().catch(() => this._profileMetas);
    this._profile = newP;
    this._configs = buildConfigs(newP);
    this._editingNew = true;
    this._renderProfileBody();
    this._updatePreview();
  }

  async _cloneCurrentProfile() {
    if (!this._profile) return;
    const name = `${this._profile.name} (copy)`;
    const cloned = await cloneBuiltinProfile(this._profile.id, name).catch(() => null);
    if (!cloned) return;
    this._profileMetas = await listProfiles().catch(() => this._profileMetas);
    this._profile = cloned;
    this._configs = buildConfigs(cloned);
    this._renaming = true;
    this._renderProfileBody();
    this._updatePreview();
    this._renderGrid();
  }

  async _commitProfileName(name) {
    this._editingNew = false;
    this._renaming   = false;
    if (this._profile) {
      this._profile.name = (name.trim() || 'New Profile');
      await saveProfile(this._profile).catch(() => {});
      this._profileMetas = await listProfiles().catch(() => this._profileMetas);
    }
    this._renderProfileBody();
  }

  async _deleteCurrentProfile() {
    if (!this._profile || this._profile.is_builtin) return;
    const dialog = document.createElement('km-dialog');
    dialog.setAttribute('heading', `Delete "${this._profile.name}"?`);
    dialog.setAttribute('size', 'sm');
    dialog.innerHTML = `
      <p>This export profile will be permanently removed.</p>
      <div slot="footer">
        <km-button variant="ghost"  id="dlg-cancel" size="sm">Cancel</km-button>
        <km-button variant="danger" id="dlg-ok"     size="sm">Delete</km-button>
      </div>
    `;
    document.getElementById('notification-host')?.appendChild(dialog);
    dialog.setAttribute('open', '');
    dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close?.());
    dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
      dialog.close?.();
      await deleteProfile(this._profile.id).catch(() => {});
      this._profileMetas = await listProfiles().catch(() => this._profileMetas);
      const first = this._profileMetas[0];
      if (first) await this._activateProfile(first.id);
      this._renderProfileBody();
    });
    dialog.addEventListener('km-close', () => dialog.remove());
  }

  async _autosaveProfile() {
    if (!this._profile || this._profile.is_builtin) return;
    this._profile.configs = { ...this._configs };
    await saveProfile(this._profile).catch(() => {});
  }

  // ── Breadcrumb path builder ────────────────────────────────────────────────

  /** Parse a pattern string into an array of segment objects. */
  _parsePattern(pattern) {
    if (!pattern) return [{ type: 'token', value: '{output_type}' }];
    const parts = pattern.split('/').filter(Boolean);
    return parts.map(p => TOKEN_CHIPS.find(c => c.token === p)
      ? { type: 'token', value: p }
      : { type: 'text',  value: p }
    );
  }

  /** Serialize segments array back to a pattern string. */
  _serializePattern(segments) {
    return segments.map(s => s.value).join('/');
  }

  /** Render the breadcrumb path builder HTML from a pattern string. */
  _renderPathBuilder(pattern, readonly) {
    const segs = this._parsePattern(pattern);
    const chips = segs.map((seg, i) => {
      const sep  = i > 0 ? `<span class="pb-sep">/</span>` : '';
      const cls  = seg.type === 'token' ? 'pb-chip--token' : 'pb-chip--text';
      const lbl  = seg.type === 'token' ? seg.value.replace(/[{}]/g, '') : seg.value;
      const rm   = readonly ? '' : `<button class="pb-chip__remove" data-idx="${i}" title="Remove">×</button>`;
      return `${sep}<span class="pb-chip ${cls}" data-idx="${i}">${this._esc(lbl)}${rm}</span>`;
    }).join('');

    const addBtn = readonly ? '' : `
      <button class="pb-add" id="pb-add-btn" title="Add segment">+ Add</button>
    `;

    return chips + addBtn;
  }

  /** Wire all path builder interactions after rendering. */
  _wirePathBuilder() {
    const body    = this.shadowRoot.getElementById('profile-body');
    const builder = this.shadowRoot.getElementById('path-builder');
    if (!builder || !body) return;

    const getSegs = () => this._parsePattern(this._profile?.pattern ?? '{output_type}');
    const commit  = (segs) => {
      if (!this._profile) return;
      this._profile.pattern = this._serializePattern(segs);
      builder.innerHTML = this._renderPathBuilder(this._profile.pattern, false);
      this._wirePathBuilder();
      this._autosaveProfile();
      this._updatePreview();
    };

    // Remove chip
    for (const btn of builder.querySelectorAll('.pb-chip__remove')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const segs = getSegs();
        segs.splice(idx, 1);
        commit(segs);
      });
    }

    // Add segment dropdown
    const addBtn = builder.querySelector('#pb-add-btn');
    if (!addBtn) return;

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = builder.querySelector('.pb-dropdown');
      if (existing) { existing.remove(); return; }

      const dd = document.createElement('div');
      dd.className = 'pb-dropdown';
      dd.innerHTML = `
        ${TOKEN_CHIPS.map(c =>
          `<button class="pb-dropdown-item pb-dropdown-item--token" data-token="${this._esc(c.token)}">{${c.label}}</button>`
        ).join('')}
        <div class="pb-dropdown-sep"></div>
        <div class="pb-custom-row">
          <input class="pb-custom-input" id="pb-custom" type="text" placeholder="custom text…">
          <button class="pb-custom-add" id="pb-custom-ok">Add</button>
        </div>
      `;
      addBtn.appendChild(dd);

      const closeDropdown = (e) => {
        if (!dd.contains(e.target) && e.target !== addBtn) {
          dd.remove();
          document.removeEventListener('click', closeDropdown);
        }
      };
      setTimeout(() => document.addEventListener('click', closeDropdown), 0);

      for (const item of dd.querySelectorAll('.pb-dropdown-item')) {
        item.addEventListener('click', () => {
          const segs = getSegs();
          segs.push({ type: 'token', value: item.dataset.token });
          dd.remove();
          document.removeEventListener('click', closeDropdown);
          commit(segs);
        });
      }

      dd.querySelector('#pb-custom-ok')?.addEventListener('click', () => {
        const val = dd.querySelector('#pb-custom')?.value?.trim();
        if (!val) return;
        const segs = getSegs();
        segs.push({ type: 'text', value: val });
        dd.remove();
        document.removeEventListener('click', closeDropdown);
        commit(segs);
      });
      dd.querySelector('#pb-custom')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dd.querySelector('#pb-custom-ok')?.click();
      });
    });
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  _updatePreview() {
    const el        = this.shadowRoot.getElementById('preview-text');
    const createBtn = this.shadowRoot.getElementById('btn-create-folder');
    if (!el) return;

    if (!store.bridgeConnected || !store.bridgeBoardName || !this._profile) {
      el.textContent = 'Connect the KiCad bridge to see the output path.';
      el.classList.add('empty');
      createBtn?.classList.add('hidden');
      return;
    }

    const resolved = resolveOutputDir(this._profile, this._context, 'gerbers');
    el.textContent = resolved || '—';
    el.classList.toggle('empty', !resolved);

    if (createBtn && resolved) {
      createBtn.classList.remove('hidden');
      createBtn.classList.remove('exists');
      createBtn.textContent = 'Create Folder';
      createBtn.onclick = () => this._createPreviewFolder(resolved, createBtn);
    } else {
      createBtn?.classList.add('hidden');
    }
  }

  async _createPreviewFolder(resolved, btn) {
    if (btn.classList.contains('exists')) return;
    btn.textContent = '…'; btn.style.pointerEvents = 'none';
    try {
      await prepareDir(resolved, 'keep');
      btn.classList.add('exists'); btn.textContent = '✓ Created';
    } catch { btn.textContent = 'Failed'; }
    finally  { btn.style.pointerEvents = ''; }
  }

  // ── Directory preparation ──────────────────────────────────────────────────

  async _prepareOutputDir(outputTypeId) {
    const resolved = resolveOutputDir(this._profile, this._context, outputTypeId);
    if (!resolved) return null;

    const cleanTarget = this.shadowRoot.getElementById('chk-clean')?.checked ?? false;
    if (!cleanTarget) {
      const result = await prepareDir(resolved, 'keep');
      return result.resolved_path;
    }

    return new Promise((resolve) => {
      const dialog = document.createElement('km-dialog');
      dialog.setAttribute('heading', 'Output directory exists');
      dialog.setAttribute('size', 'sm');
      dialog.innerHTML = `
        <p>The target directory may already have content:</p>
        <p style="font-family:var(--km-font-mono);font-size:11px;color:var(--km-text-muted);word-break:break-all;margin-top:4px;">${this._esc(resolved)}</p>
        <p style="margin-top:var(--km-space-3);">How would you like to proceed?</p>
        <div slot="footer" style="display:flex;gap:var(--km-space-2);flex-wrap:wrap;justify-content:flex-end;">
          <km-button variant="ghost"     id="dlg-cancel"  size="sm">Cancel</km-button>
          <km-button variant="secondary" id="dlg-version" size="sm">New Version (_v2…)</km-button>
          <km-button variant="secondary" id="dlg-keep"    size="sm">Overwrite</km-button>
          <km-button variant="danger"    id="dlg-clean"   size="sm">Clean &amp; Export</km-button>
        </div>
      `;
      document.getElementById('notification-host')?.appendChild(dialog);
      dialog.setAttribute('open', '');
      const handle = async (mode) => {
        dialog.close?.();
        if (!mode) { resolve(null); return; }
        const result = await prepareDir(resolved, mode).catch(() => null);
        const final = result?.resolved_path ?? null;
        const el = this.shadowRoot.getElementById('preview-text');
        if (el && final) el.textContent = final;
        resolve(final);
      };
      dialog.querySelector('#dlg-cancel')?.addEventListener('km-click',  () => handle(null));
      dialog.querySelector('#dlg-keep')?.addEventListener('km-click',    () => handle('keep'));
      dialog.querySelector('#dlg-version')?.addEventListener('km-click', () => handle('version'));
      dialog.querySelector('#dlg-clean')?.addEventListener('km-click',   () => handle('clean'));
      dialog.addEventListener('km-close', () => { resolve(null); dialog.remove(); });
    });
  }

  // ── Export grid ────────────────────────────────────────────────────────────

  _renderGrid() {
    const grid = this.shadowRoot.getElementById('export-grid');
    if (!grid) return;

    if (!store.bridgeConnected) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--km-space-3);padding:var(--km-space-8) 0;color:var(--km-text-muted);text-align:center;">
          <km-icon name="plug" size="xl" style="opacity:0.3;"></km-icon>
          <span style="font-size:var(--km-font-size-sm);">Connect the KiCad bridge to enable exports.</span>
        </div>
      `;
      return;
    }

    const pcbTypes = EXPORT_TYPES.filter(t => t.fileType === 'pcb');
    const schTypes = EXPORT_TYPES.filter(t => t.fileType === 'sch');

    grid.innerHTML = `
      <div class="section-label">PCB Exports</div>
      ${pcbTypes.map(t => this._renderCard(t)).join('')}
      <div class="section-label">Schematic Exports</div>
      ${schTypes.map(t => this._renderCard(t)).join('')}
    `;

    const cards = grid.querySelectorAll('.export-card');
    cards.forEach((card, i) => {
      card.style.opacity = '0'; card.style.transform = 'translateY(8px)';
      setTimeout(() => {
        card.style.transition = 'opacity 160ms var(--km-ease), transform 160ms var(--km-ease)';
        card.style.opacity = '1'; card.style.transform = 'translateY(0)';
      }, 30 + i * 35);
    });

    // Event delegation — handles both export and configure via km-click bubbling
    grid.addEventListener('km-click', (e) => {
      const exportBtn    = e.target.closest('[data-export]');
      const configureBtn = e.target.closest('[data-configure]');
      if (exportBtn)    this._runExport(exportBtn.dataset.export);
      if (configureBtn) this._openConfigDialog(configureBtn.dataset.configure);
    });
  }

  _renderCard(type) {
    const status = this._statuses[type.id];
    let statusHtml = '';
    if (status === 'running') statusHtml = `<div class="export-status"><km-icon name="loader" size="sm" animate="spin"></km-icon> Exporting…</div>`;
    else if (status === 'done')  statusHtml = `<div class="export-status success"><km-icon name="success" size="sm"></km-icon> Done</div>`;
    else if (status === 'error') statusHtml = `<div class="export-status error"><km-icon name="error" size="sm"></km-icon> Failed</div>`;

    return `
      <div class="export-card" id="card-${type.id}">
        <div class="card-top">
          <km-icon class="card-icon" name="${type.icon}" size="md"></km-icon>
          <span class="card-label">${type.label}</span>
          <span class="card-badge">${type.fileType}</span>
        </div>
        <div class="card-desc">${type.desc}</div>
        ${statusHtml}
        <div class="card-actions">
          <km-button variant="ghost" size="sm" data-configure="${type.id}">⚙</km-button>
          <km-button variant="secondary" size="sm" data-export="${type.id}" ${status === 'running' ? 'loading' : ''}>Export</km-button>
        </div>
      </div>
    `;
  }

  // ── Configure dialog ───────────────────────────────────────────────────────

  async _openConfigDialog(typeId) {
    try {
      const currentConfig = this._configs[typeId] ?? {};
      const boardLayers   = store.boardLayers ?? [];
      const result = await showConfigDialog(typeId, currentConfig, boardLayers);
      if (!result) return;
      this._configs[typeId] = result;
      if (this._profile && !this._profile.is_builtin) {
        this._profile.configs = { ...this._profile.configs, [typeId]: result };
        await saveProfile(this._profile).catch(() => {});
      }
    } catch (err) {
      Logger.error('ExportWizard', err, `openConfigDialog ${typeId}`);
      this.dispatchEvent(new CustomEvent('km-export-error', {
        bubbles: true, composed: true,
        detail: { type: typeId, error: `Configure failed: ${err?.message ?? err}` },
      }));
    }
  }

  // ── Run export ─────────────────────────────────────────────────────────────

  async _runExport(typeId) {
    if (!store.bridgeConnected) {
      notify({ type: 'error', title: 'Bridge not connected', message: 'Open KiCad and connect the KiMaster bridge plugin before exporting.' });
      return;
    }
    if (!this._profile) {
      notify({ type: 'error', title: 'No profile', message: 'Select an export profile before running an export.' });
      return;
    }
    const type = EXPORT_TYPES.find(t => t.id === typeId);
    if (!type) return;

    const boardPath = store.bridgeBoardName || '';
    const pcbFile   = boardPath;
    const schFile   = boardPath.replace(/\.kicad_pcb$/i, '.kicad_sch');

    if (type.fileType === 'pcb' && !pcbFile) {
      this._flashCardError(typeId);
      notify({ type: 'error', title: 'No board file', message: 'No .kicad_pcb file found. Open a PCB in KiCad first.' });
      return;
    }
    if (type.fileType === 'sch' && !schFile) {
      this._flashCardError(typeId);
      notify({ type: 'error', title: 'No schematic file', message: 'No .kicad_sch file found. Open a schematic in KiCad first.' });
      return;
    }

    try {
      const outputDir = await this._prepareOutputDir(typeId);
      if (!outputDir) return;

      this._statuses[typeId] = 'running';
      this._updateCard(typeId);
      this.dispatchEvent(new CustomEvent('km-export-start', { bubbles: true, composed: true, detail: { type: typeId } }));

      const cfg    = this._configs[typeId] ?? {};
      const result = await this._invokeExport(typeId, pcbFile, schFile, outputDir, cfg);
      this._statuses[typeId] = result?.raw?.success ? 'done' : 'error';
      this._updateCard(typeId);

      this.dispatchEvent(new CustomEvent('km-export-done', { bubbles: true, composed: true, detail: { type: typeId, result } }));

      if (result?.raw?.success) {
        const openEl = this.shadowRoot.getElementById('chk-open');
        if (openEl?.checked) openOutputDir(outputDir).catch(() => {});
        setTimeout(() => {
          if (this._statuses[typeId] === 'done') { this._statuses[typeId] = null; this._updateCard(typeId); }
        }, 5000);
      } else {
        const detail = result?.raw?.stderr || result?.raw?.message || 'Export failed.';
        notify({ type: 'error', title: `${type.label} failed`, message: detail });
      }
    } catch (err) {
      Logger.error('ExportWizard', err, `export ${typeId}`);
      this._statuses[typeId] = 'error';
      this._updateCard(typeId);
      notify({ type: 'error', title: `${type.label} failed`, message: err.message || String(err) });
      this.dispatchEvent(new CustomEvent('km-export-error', { bubbles: true, composed: true, detail: { type: typeId, error: err.message || String(err) } }));
    }
  }

  async _invokeExport(typeId, pcbFile, schFile, outputDir, cfg) {
    // cfg fields are snake_case matching Rust arg struct field names — spread directly
    switch (typeId) {
      case 'gerbers': return invoke(EXPORT_GERBERS, { args: { pcb_file: pcbFile, output_dir: outputDir, ...cfg }});
      case 'drill':   return invoke(EXPORT_DRILL,   { args: { pcb_file: pcbFile, output_dir: outputDir, ...cfg }});
      case 'pos': {
        const ext = cfg.format === 'csv' ? '.csv' : cfg.format === 'gerber' ? '.gbr' : '.pos';
        return invoke(EXPORT_POS, { args: { pcb_file: pcbFile, output_file: `${outputDir}/positions${ext}`, ...cfg }});
      }
      case 'svg':
        return invoke(EXPORT_SVG, { args: { pcb_file: pcbFile, output_file: `${outputDir}/board.svg`, ...cfg }});
      case 'pdf':
        return invoke(EXPORT_PDF, { args: { pcb_file: pcbFile, output_file: `${outputDir}/board.pdf`, ...cfg }});
      case 'step':
        return invoke(EXPORT_STEP, { args: { pcb_file: pcbFile, output_file: `${outputDir}/board.step`, ...cfg }});
      case 'bom': {
        const { output_format, ...bomCfg } = cfg;
        const ext = output_format === 'tsv' ? '.tsv' : '.csv';
        return invoke(EXPORT_BOM, { args: { sch_file: schFile, output_file: `${outputDir}/bom${ext}`, ...bomCfg }});
      }
      case 'sch_pdf':
        return invoke(EXPORT_SCH_PDF, { args: { sch_file: schFile, output_file: `${outputDir}/schematic.pdf`, ...cfg }});
      case 'sch_svg':
        return invoke(EXPORT_SCH_SVG, { args: { sch_file: schFile, output_dir: outputDir, ...cfg }});
      default:
        throw new Error(`Unknown export type: ${typeId}`);
    }
  }

  // ── Fab pack ───────────────────────────────────────────────────────────────

  async _runFabPack() {
    if (!store.bridgeConnected) {
      notify({ type: 'error', title: 'Bridge not connected', message: 'Open KiCad and connect the KiMaster bridge plugin before exporting.' });
      return;
    }
    if (!this._profile) {
      notify({ type: 'error', title: 'No profile', message: 'Select an export profile before running a fab pack.' });
      return;
    }
    const pcbFile = store.bridgeBoardName || '';
    const schFile = pcbFile.replace(/\.kicad_pcb$/i, '.kicad_sch');
    if (!pcbFile) {
      notify({ type: 'error', title: 'No board file', message: 'No .kicad_pcb file found. Open a PCB in KiCad first.' });
      return;
    }

    const btn = this.shadowRoot.getElementById('btn-fab-pack');
    btn?.setAttribute('loading', '');

    try {
      const outputDir = await this._prepareOutputDir('gerbers');
      if (!outputDir) { btn?.removeAttribute('loading'); return; }

      const result = await invoke(EXPORT_FAB_PACK, {
        args: { pcb_file: pcbFile, sch_file: schFile || null, output_dir: outputDir, fab_id: 'jlcpcb_2layer' },
      });
      if (result?.success) {
        this.dispatchEvent(new CustomEvent('km-export-done', { bubbles: true, composed: true, detail: { type: 'fab_pack', result } }));
        const openEl = this.shadowRoot.getElementById('chk-open');
        if (openEl?.checked) openOutputDir(outputDir).catch(() => {});
      } else {
        const detail = result?.message ?? 'Fab pack failed.';
        notify({ type: 'error', title: 'Fab Pack failed', message: detail });
        this.dispatchEvent(new CustomEvent('km-export-error', { bubbles: true, composed: true, detail: { type: 'fab_pack', error: detail } }));
      }
    } catch (err) {
      Logger.error('ExportWizard', err, 'runFabPack');
      notify({ type: 'error', title: 'Fab Pack failed', message: err.message || String(err) });
      this.dispatchEvent(new CustomEvent('km-export-error', { bubbles: true, composed: true, detail: { type: 'fab_pack', error: String(err?.message ?? err) } }));
    } finally {
      btn?.removeAttribute('loading');
    }
  }

  // ── Card update helpers ────────────────────────────────────────────────────

  _updateCard(typeId) {
    const type = EXPORT_TYPES.find(t => t.id === typeId);
    if (!type) return;
    const card = this.shadowRoot.getElementById(`card-${typeId}`);
    if (!card) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderCard(type);
    const newCard = tmp.firstElementChild;
    card.replaceWith(newCard);
    // km-click delegation is on the grid; individual card re-wiring not needed.
  }

  _flashCardError(typeId) {
    const card = this.shadowRoot.getElementById(`card-${typeId}`);
    if (!card) return;
    card.style.transition = 'outline 0ms';
    card.style.outline = '2px solid var(--km-danger)';
    setTimeout(() => { card.style.outline = ''; }, 800);
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }
}

customElements.define('km-export-wizard', ExportWizard);
