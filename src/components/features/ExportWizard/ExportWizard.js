/**
 * @element km-export-wizard
 * @summary Export center for Gerber, SVG, PDF, BOM, drill, and position files.
 *
 * @fires km-export-start  - when an export begins, detail: { type }
 * @fires km-export-done   - when an export completes, detail: { type, result }
 * @fires km-export-error  - when an export fails, detail: { type, error }
 */

import { invoke } from '../../../core/Ipc.js';
import { store, subscribe } from '../../../core/State.js';
import { Logger } from '../../../core/Logger.js';
import {
  EXPORT_GERBERS, EXPORT_DRILL, EXPORT_POS,
  EXPORT_SVG, EXPORT_PDF, EXPORT_BOM,
  EXPORT_SCH_PDF, EXPORT_SCH_SVG,
  EXPORT_FAB_PACK,
} from '../../../core/AppCommands.js';

/** Export type definitions */
const EXPORT_TYPES = [
  { id: 'gerbers',  icon: 'gerber',    label: 'Gerber Files',    desc: 'Industry-standard PCB fabrication files',            fileType: 'pcb' },
  { id: 'drill',    icon: 'via',       label: 'Drill Files',     desc: 'Excellon or Gerber X2 drill files',                  fileType: 'pcb' },
  { id: 'pos',      icon: 'footprint', label: 'Position Files',  desc: 'Component placement for pick-and-place',             fileType: 'pcb' },
  { id: 'svg',      icon: 'layers',    label: 'PCB SVG',         desc: 'Scalable vector graphics of board layers',           fileType: 'pcb' },
  { id: 'pdf',      icon: 'gerber',    label: 'PCB PDF',         desc: 'Print-ready PDF of board layers',                    fileType: 'pcb' },
  { id: 'bom',      icon: 'bom',       label: 'Bill of Materials', desc: 'Component list with values and footprints',        fileType: 'sch' },
  { id: 'sch_pdf',  icon: 'schematic', label: 'Schematic PDF',   desc: 'Multi-page schematic as PDF',                        fileType: 'sch' },
  { id: 'sch_svg',  icon: 'schematic', label: 'Schematic SVG',   desc: 'Schematic sheets as SVG files',                      fileType: 'sch' },
];

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
    gap: var(--km-space-4);
    overflow: hidden;
  }

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

  /* ── File inputs ── */
  .file-section {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
  }
  .file-row {
    display: flex;
    gap: var(--km-space-2);
    align-items: center;
  }
  .file-row label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    width: 70px;
    flex-shrink: 0;
    text-align: right;
  }
  .file-path {
    flex: 1;
    padding: var(--km-space-2) var(--km-space-3);
    border-radius: var(--km-radius-sm);
    border: 1px solid var(--km-border);
    background: var(--km-bg-primary);
    color: var(--km-text-secondary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    outline: none;
    transition: border-color var(--km-duration-fast) var(--km-ease);
  }
  .file-path:focus { border-color: var(--km-accent); }
  .file-path::placeholder { color: var(--km-text-muted); }

  /* ── Output directory ── */
  .output-row {
    display: flex;
    gap: var(--km-space-2);
    align-items: center;
    flex-shrink: 0;
  }
  .output-row label {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    width: 70px;
    flex-shrink: 0;
    text-align: right;
  }

  /* ── Export grid ── */
  .export-grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--km-space-3);
    align-content: start;
    min-height: 0;
    padding-bottom: var(--km-space-4);
  }
  .export-grid::-webkit-scrollbar { width: 6px; }
  .export-grid::-webkit-scrollbar-track { background: transparent; }
  .export-grid::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

  .export-card {
    display: flex;
    flex-direction: column;
    gap: var(--km-space-2);
    padding: var(--km-space-4);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    transition: all var(--km-duration-fast) var(--km-ease);
  }
  .export-card:hover {
    border-color: var(--km-border-strong);
    box-shadow: var(--km-shadow-sm);
    transform: translateY(-1px);
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
  }
  .card-icon { color: var(--km-accent); flex-shrink: 0; }
  .card-label {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
    flex: 1;
  }
  .card-badge {
    font-size: var(--km-font-size-xs);
    padding: 1px var(--km-space-2);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-elevated);
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .card-desc {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    line-height: var(--km-line-height-base);
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--km-space-1);
  }

  /* ── Status indicators ── */
  .export-status {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
  }
  .export-status.success { color: var(--km-success); }
  .export-status.error   { color: var(--km-danger); }

  /* ── Section divider ── */
  .section-label {
    grid-column: 1 / -1;
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-top: var(--km-space-2);
    border-top: 1px solid var(--km-border);
  }
  .section-label:first-child { border-top: none; padding-top: 0; }
</style>

<div class="wizard">
  <div class="header">
    <km-icon name="gerber" size="lg" class="card-icon"></km-icon>
    <span class="header-title">Export Center</span>
    <km-button variant="secondary" size="sm" id="btn-fab-pack">One-click Fab Pack</km-button>
  </div>

  <div class="file-section">
    <div class="file-row">
      <label>PCB</label>
      <input class="file-path" id="pcb-input" type="text" placeholder="Path to .kicad_pcb file..." />
    </div>
    <div class="file-row">
      <label>Schematic</label>
      <input class="file-path" id="sch-input" type="text" placeholder="Path to .kicad_sch file..." />
    </div>
    <div class="output-row">
      <label>Output</label>
      <input class="file-path" id="output-input" type="text" placeholder="Output directory..." />
    </div>
  </div>

  <div class="export-grid" id="export-grid"></div>
</div>
`;

export class ExportWizard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._statuses = {};
    this._unsub = null;
  }

  connectedCallback() {
    this._syncFromProject();
    this._renderGrid();
    this._unsub = subscribe('project', () => this._syncFromProject());

    // One-click fab pack button
    this.shadowRoot.getElementById('btn-fab-pack')
      ?.addEventListener('km-click', () => this._runFabPack());
  }

  disconnectedCallback() {
    this._unsub?.();
  }

  async _runFabPack() {
    const pcbFile   = this.shadowRoot.getElementById('pcb-input').value.trim();
    const schFile   = this.shadowRoot.getElementById('sch-input').value.trim();
    const outputDir = this.shadowRoot.getElementById('output-input').value.trim() || './exports';

    if (!pcbFile) {
      this.dispatchEvent(new CustomEvent('km-export-error', {
        bubbles: true, composed: true,
        detail: { type: 'fab_pack', error: 'No PCB file specified' },
      }));
      return;
    }

    const btn = this.shadowRoot.getElementById('btn-fab-pack');
    btn?.setAttribute('loading', '');

    try {
      const result = await invoke(EXPORT_FAB_PACK, {
        args: {
          pcb_file:   pcbFile,
          sch_file:   schFile || null,
          output_dir: outputDir,
          fab_id:     'jlcpcb_2layer',
        },
      });

      if (result?.success) {
        this.dispatchEvent(new CustomEvent('km-export-done', {
          bubbles: true, composed: true,
          detail: { type: 'fab_pack', result },
        }));
      } else {
        this.dispatchEvent(new CustomEvent('km-export-error', {
          bubbles: true, composed: true,
          detail: { type: 'fab_pack', error: result?.message ?? 'Fab pack failed' },
        }));
      }
    } catch (err) {
      Logger.error('ExportWizard', err, 'runFabPack');
      this.dispatchEvent(new CustomEvent('km-export-error', {
        bubbles: true, composed: true,
        detail: { type: 'fab_pack', error: String(err?.message ?? err) },
      }));
    } finally {
      btn?.removeAttribute('loading');
    }
  }

  _syncFromProject() {
    const proj = store.project;
    if (!proj) return;
    // Rust serialises struct fields as snake_case
    if (proj.pcb_file) {
      this.shadowRoot.getElementById('pcb-input').value = proj.pcb_file;
    }
    if (proj.schematic_file) {
      this.shadowRoot.getElementById('sch-input').value = proj.schematic_file;
    }
    if (proj.pcb_file) {
      // Derive output dir as sibling 'exports/' folder
      const sep = proj.pcb_file.includes('\\') ? '\\' : '/';
      const dir = proj.pcb_file.split(sep).slice(0, -1).join(sep);
      this.shadowRoot.getElementById('output-input').value = dir + sep + 'exports';
    }
  }

  _renderGrid() {
    const grid = this.shadowRoot.getElementById('export-grid');
    const pcbTypes = EXPORT_TYPES.filter(t => t.fileType === 'pcb');
    const schTypes = EXPORT_TYPES.filter(t => t.fileType === 'sch');

    grid.innerHTML = `
      <div class="section-label">PCB Exports</div>
      ${pcbTypes.map(t => this._renderCard(t)).join('')}
      <div class="section-label">Schematic Exports</div>
      ${schTypes.map(t => this._renderCard(t)).join('')}
    `;

    // Stagger card animations
    const cards = grid.querySelectorAll('.export-card');
    cards.forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(10px)';
      setTimeout(() => {
        card.style.transition = 'opacity 180ms var(--km-ease), transform 180ms var(--km-ease)';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, 40 + i * 50);
    });

    // Bind export buttons
    for (const btn of grid.querySelectorAll('[data-export]')) {
      btn.addEventListener('km-click', () => this._runExport(btn.dataset.export));
    }
  }

  _renderCard(type) {
    const status = this._statuses[type.id];
    let statusHtml = '';
    if (status === 'running') {
      statusHtml = `<div class="export-status"><km-icon name="loader" size="sm" animate="spin"></km-icon> Exporting...</div>`;
    } else if (status === 'done') {
      statusHtml = `<div class="export-status success"><km-icon name="success" size="sm"></km-icon> Done</div>`;
    } else if (status === 'error') {
      statusHtml = `<div class="export-status error"><km-icon name="error" size="sm"></km-icon> Failed</div>`;
    }

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
          <km-button variant="secondary" size="sm" data-export="${type.id}" ${status === 'running' ? 'loading' : ''}>
            Export
          </km-button>
        </div>
      </div>
    `;
  }

  async _runExport(typeId) {
    const pcbFile = this.shadowRoot.getElementById('pcb-input').value.trim();
    const schFile = this.shadowRoot.getElementById('sch-input').value.trim();
    const outputDir = this.shadowRoot.getElementById('output-input').value.trim() || './exports';

    const type = EXPORT_TYPES.find(t => t.id === typeId);
    if (!type) return;

    // Validate file inputs
    if (type.fileType === 'pcb' && !pcbFile) {
      this._flashCardError(typeId, 'No PCB file specified');
      return;
    }
    if (type.fileType === 'sch' && !schFile) {
      this._flashCardError(typeId, 'No schematic file specified');
      return;
    }

    this._statuses[typeId] = 'running';
    this._updateCard(typeId);

    this.dispatchEvent(new CustomEvent('km-export-start', {
      bubbles: true, composed: true,
      detail: { type: typeId },
    }));

    try {
      const result = await this._invokeExport(typeId, pcbFile, schFile, outputDir);

      this._statuses[typeId] = result?.raw?.success ? 'done' : 'error';
      this._updateCard(typeId);

      this.dispatchEvent(new CustomEvent('km-export-done', {
        bubbles: true, composed: true,
        detail: { type: typeId, result },
      }));

      // Auto-clear success status after 5s
      if (result?.raw?.success) {
        setTimeout(() => {
          if (this._statuses[typeId] === 'done') {
            this._statuses[typeId] = null;
            this._updateCard(typeId);
          }
        }, 5000);
      }
    } catch (err) {
      this._statuses[typeId] = 'error';
      this._updateCard(typeId);

      this.dispatchEvent(new CustomEvent('km-export-error', {
        bubbles: true, composed: true,
        detail: { type: typeId, error: err.message || String(err) },
      }));
    }
  }

  /**
   * @param {string} typeId
   * @param {string} pcbFile
   * @param {string} schFile
   * @param {string} outputDir
   */
  async _invokeExport(typeId, pcbFile, schFile, outputDir) {
    // All command strings imported from AppCommands — no raw strings (Rule 2)
    switch (typeId) {
      case 'gerbers':
        return invoke(EXPORT_GERBERS, { args: { pcb_file: pcbFile, output_dir: outputDir } });
      case 'drill':
        return invoke(EXPORT_DRILL,   { args: { pcb_file: pcbFile, output_dir: outputDir } });
      case 'pos':
        return invoke(EXPORT_POS,     { args: { pcb_file: pcbFile, output_file: `${outputDir}/positions.csv` } });
      case 'svg':
        return invoke(EXPORT_SVG,     { args: { pcb_file: pcbFile, output_file: `${outputDir}/board.svg` } });
      case 'pdf':
        return invoke(EXPORT_PDF,     { args: { pcb_file: pcbFile, output_file: `${outputDir}/board.pdf` } });
      case 'bom':
        return invoke(EXPORT_BOM,     { args: { sch_file: schFile, output_file: `${outputDir}/bom.csv` } });
      case 'sch_pdf':
        return invoke(EXPORT_SCH_PDF, { args: { sch_file: schFile, output_file: `${outputDir}/schematic.pdf` } });
      case 'sch_svg':
        return invoke(EXPORT_SCH_SVG, { args: { sch_file: schFile, output_dir: outputDir } });
      default:
        throw new Error(`Unknown export type: ${typeId}`);
    }
  }

  _updateCard(typeId) {
    const type = EXPORT_TYPES.find(t => t.id === typeId);
    if (!type) return;
    const card = this.shadowRoot.getElementById(`card-${typeId}`);
    if (!card) return;

    const newHtml = this._renderCard(type);
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    const newCard = temp.firstElementChild;

    card.replaceWith(newCard);

    // Re-bind the export button
    const btn = newCard.querySelector('[data-export]');
    if (btn) {
      btn.addEventListener('km-click', () => this._runExport(typeId));
    }
  }

  _flashCardError(typeId, message) {
    const card = this.shadowRoot.getElementById(`card-${typeId}`);
    if (!card) return;
    AnimationKit.shake(card);
  }
}

customElements.define('km-export-wizard', ExportWizard);
