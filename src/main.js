/**
 * KiMaster — application bootstrap.
 * Inline styles BANNED — use CSS classes from views.css / tokens.css.
 */

import './components/ui/index.js';
import './components/features/DrcPanel/DrcPanel.js';
import './components/features/ExportWizard/ExportWizard.js';
import './components/features/SettingsPanel/SettingsPanel.js';
import './components/features/ComponentBrowser/ComponentBrowser.js';
import './components/features/RevisionTimeline/RevisionTimeline.js';
import './components/features/NotesEditor/NotesEditor.js';
import './components/features/ComponentVault/ComponentVault.js';
import './components/features/BoardRender/BoardRender.js';
import './components/features/Dashboard/Dashboard.js';
import './components/features/NetInspector/NetInspector.js';
import './components/features/BomTable/BomTable.js';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCentreH, alignCentreV,
  distributeH, distributeV,
  snapToGrid,
} from './modules/board/AlignService.js';
import { AnimationKit }     from './design/animations/index.js';
import { initIpc, invoke, invokeNow } from './core/Ipc.js';
import { store, subscribe } from './core/State.js';
import { Router }           from './core/Router.js';
import { Logger }           from './core/Logger.js';
import { THEME }            from './core/AppKeys.js';
import { GET_APP_INFO, GET_KICAD_CLI_PATH } from './core/AppCommands.js';
import { KM_NAV, KM_NOTES_LINK_CLICK } from './core/AppEvents.js';
import {
  loadProjectState,
  initProjectListeners,
  pickAndOpenProject,
} from './modules/project/ProjectService.js';
import { autoDrcOnChange, errorCount } from './modules/drc/DrcService.js';
import {
  initBridgeListeners, connectBridge, disconnectBridge, startAutoConnect,
  installBridgePlugin, getPluginInstallPath, requestBoardState,
  highlightComponent, clearHighlight, moveComponent, setLocked, setDnp,
} from './modules/kicad-bridge/BridgeClient.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  AnimationKit.injectViewTransitionStyles();
  await initIpc();

  try {
    const info = await invoke(GET_APP_INFO);
    store.appVersion   = info.version;
    store.kicadCliPath = info.kicad_cli_path;
  } catch (err) {
    Logger.warn('Boot', 'Could not fetch app info', err);
  }

  try {
    const cli = await invoke(GET_KICAD_CLI_PATH);
    if (cli.found) store.kicadCliPath = cli.path;
  } catch (err) {
    Logger.warn('Boot', 'Could not detect kicad-cli path', err);
  }

  await loadProjectState().catch((err) => Logger.warn('Boot', 'loadProjectState failed', err));
  await initProjectListeners().catch((err) => Logger.warn('Boot', 'initProjectListeners failed', err));
  await initBridgeListeners().catch((err) => Logger.warn('Boot', 'initBridgeListeners failed', err));

  setupRouter();
  setupTheme();
  setupSidebarNav();
  setupCommandPalette();

  // Auto-connect to KiCad bridge (polls every 3s until connected)
  startAutoConnect(3000);

  // CSS @keyframes handles initial app reveal — no JS opacity manipulation needed
}

// ── Router ────────────────────────────────────────────────────────────────────

function setupRouter() {
  Router
    .setContainer(document.getElementById('view-container'))
    .notFound('/')
    .on('/',          renderDashboard)
    .on('/drc',       renderDrc)
    .on('/schematic', renderSchematic)
    .on('/pcb',       renderPcb)
    .on('/bom',       renderBom)
    .on('/export',    renderExport)
    .on('/components',renderComponents)
    .on('/history',   renderHistory)
    .on('/notes',     renderNotes)
    .on('/vault',     renderVault)
    .on('/render',    renderBoardRender)
    .on('/bridge',    renderBridge)
    .on('/settings',  renderSettings)
    .start();
}

// ── Bridge → Project resolution ─────────────────────────────────────────────

/**
 * Derive project info from the bridge board name and update sidebar + store.
 * Bridge is the single source of truth — always overrides manual project.
 */
function _updateProjectFromBridge(sidebar) {
  const boardPath = store.bridgeBoardName;
  if (!boardPath || !store.bridgeConnected) return;
  const fileName = boardPath.replace(/\\/g, '/').split('/').pop() || '';
  const projectName = fileName.replace(/\.kicad_pcb$/, '');
  if (projectName) {
    store.project = { name: projectName, path: boardPath, source: 'bridge' };
    sidebar?.setProject?.({ name: projectName, active: true });
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function setupSidebarNav() {
  const sidebar = document.getElementById('main-sidebar');

  sidebar?.addEventListener(KM_NAV, (e) => {
    Router.navigate(e.detail.route);
  });

  // "No project open" chip → open native file picker
  sidebar?.addEventListener('km-open-project', async () => {
    const result = await pickAndOpenProject();
    if (result.success && result.project) {
      sidebar.setProject?.({ name: result.project.name, active: true });
      notify({ type: 'success', title: 'Project Opened', message: result.project.name });
      // Re-render dashboard to reflect project state
      if (location.hash === '' || location.hash === '#/') renderDashboard();
    } else if (!result.success && result.message !== 'No file selected') {
      Logger.warn('Main', 'pickAndOpenProject failed', result.message);
      notify({ type: 'error', title: 'Cannot Open Project', message: result.message });
    }
  });

  // Keep sidebar project indicator in sync with store
  subscribe('project', (proj) => {
    sidebar?.setProject?.({ name: proj?.name ?? '', active: !!proj });
    // Re-render dashboard if it's currently visible
    if (!location.hash || location.hash === '#/' || location.hash === '#') {
      renderDashboard();
    }
  });

  subscribe('bridgeConnected', (connected) => {
    if (connected) {
      notify({ type: 'success', title: 'KiCad Connected', message: 'Bridge plugin active.' });
      // Bridge is the single source of truth — always set project from bridge
      _updateProjectFromBridge(sidebar);
    } else {
      // Clear bridge-sourced project on disconnect
      if (store.project?.source === 'bridge') {
        store.project = null;
        sidebar?.setProject?.({ name: '', active: false });
      }
    }
  });

  // Update sidebar project when board name changes (user switches boards in KiCad)
  subscribe('bridgeBoardName', () => _updateProjectFromBridge(sidebar));

  // ── DRC violation badge on sidebar nav item ──────────────────────────────
  subscribe('drcErrors', () => {
    const count = errorCount();
    sidebar?.setBadge('drc', count);
  });

  // ── Auto-DRC when file watcher fires on .kicad_pcb save ──────────────────
  subscribe('projectFileChanged', async (changedFile) => {
    if (!changedFile) return;
    const isAutoEnabled = JSON.parse(localStorage.getItem('km-settings') ?? '{}').autoDrcOnSave ?? true;
    if (!isAutoEnabled) return;
    if (!changedFile.endsWith('.kicad_pcb')) return;
    const pcbFile = store.project?.pcb_file ?? changedFile;
    const result = await autoDrcOnChange(pcbFile);
    if (!result) return;
    if (result.newErrors > 0) {
      notify({
        type: 'error',
        title: `${result.newErrors} new DRC violation${result.newErrors !== 1 ? 's' : ''}`,
        message: 'Board saved with new errors. Open DRC to review.',
        duration: 8000,
      });
    } else if (result.fixedErrors > 0) {
      notify({
        type: 'success',
        title: `${result.fixedErrors} DRC violation${result.fixedErrors !== 1 ? 's' : ''} fixed`,
        message: 'Board looks better!',
      });
    }
  });
}

// ── Command Palette ───────────────────────────────────────────────────────────

function setupCommandPalette() {
  const palette = document.createElement('km-command-palette');
  palette.id = 'command-palette';
  document.body.appendChild(palette);

  // Rebuild item list whenever board state or project changes
  const rebuild = () => _buildPaletteItems(palette);
  subscribe('boardComponents', rebuild);
  subscribe('project',         rebuild);
  subscribe('bridgeConnected', rebuild);
  rebuild();
}

/** Build the full command palette item list from current app state. */
function _buildPaletteItems(palette) {
  const routes = [
    { id: 'nav-dashboard',   label: 'Dashboard',    icon: 'cpu',       description: 'App overview & status',          action: () => Router.navigate('/') },
    { id: 'nav-drc',         label: 'DRC / ERC',    icon: 'drc',       description: 'Design rule checks',             action: () => Router.navigate('/drc') },
    { id: 'nav-export',      label: 'Export',       icon: 'gerber',    description: 'Gerbers, PDF, SVG, BOM',         action: () => Router.navigate('/export') },
    { id: 'nav-components',  label: 'Components',   icon: 'component', description: 'Browse & search board parts',    action: () => Router.navigate('/components') },
    { id: 'nav-bridge',      label: 'KiCad Bridge', icon: 'plug',      description: 'Live board sync',                action: () => Router.navigate('/bridge') },
    { id: 'nav-settings',    label: 'Settings',     icon: 'settings',  description: 'Configure KiMaster',             action: () => Router.navigate('/settings') },
    { id: 'nav-history',     label: 'History',      icon: 'history',   description: 'Git revision timeline + DRC diff', action: () => Router.navigate('/history') },
    { id: 'nav-schematic',   label: 'Schematic',    icon: 'schematic', description: 'Schematic navigator',              action: () => Router.navigate('/schematic') },
    { id: 'nav-notes',       label: 'Notes',        icon: 'notes',     description: 'Engineering notes + task list',     action: () => Router.navigate('/notes') },
    { id: 'nav-vault',       label: 'Component Vault', icon: 'vault',  description: 'LCSC/EasyEDA → KiCad library (native Rust)', action: () => Router.navigate('/vault') },
    { id: 'nav-render',      label: '3D Render',    icon: 'render',    description: 'Render 3D board views via kicad-cli',          action: () => Router.navigate('/render') },
  ];

  const actions = [
    { id: 'act-run-drc',      label: 'Run DRC',            icon: 'drc',     kbd: ['Shift','D'],
      description: 'Run design rule check on active project',
      action: () => { Router.navigate('/drc'); }
    },
    { id: 'act-open-project', label: 'Open Project',       icon: 'cpu',
      description: 'Open a .kicad_pro file',
      action: () => pickAndOpenProject().then(r => { if (r.success) renderDashboard(); })
    },
    { id: 'act-settings-appearance', label: 'Appearance Settings', icon: 'settings',
      description: 'Change accent color, font, density',
      action: () => Router.navigate('/settings')
    },
  ];

  if (store.bridgeConnected) {
    actions.push(
      { id: 'act-disconnect', label: 'Disconnect Bridge',  icon: 'plug',
        description: 'Disconnect from KiCad WS bridge',
        action: () => disconnectBridge().catch(() => {})
      },
      { id: 'act-clear-hl',  label: 'Clear Highlights',    icon: 'drc',
        description: 'Clear all KiCad highlights',
        action: () => clearHighlight().catch(() => {}),
      },
      { id: 'act-regen-zones', label: 'Regenerate Zones',  icon: 'layers',
        description: 'Re-fill all copper pours (pcbnew.ZONE_FILLER)',
        action: () => _showRegenZonesDialog(),
      },
      { id: 'act-purge-vias',  label: 'Find Orphan Vias',  icon: 'via',
        description: 'Scan and remove vias with no track or pad connection (dry-run first)',
        action: () => _showPurgeViasDialog(),
      },
    );
  } else {
    actions.push({
      id: 'act-connect', label: 'Connect to KiCad', icon: 'plug',
      description: 'Connect to KiCad bridge plugin',
      action: () => Router.navigate('/bridge'),
    });
  }

  const groups = [
    { label: 'Pages',   items: routes },
    { label: 'Actions', items: actions },
  ];

  // Live component quick-jump — only if bridge is connected and limit to 30
  const components = (store.boardComponents ?? []).slice(0, 30);
  if (components.length > 0) {
    groups.push({
      label: 'Components',
      items: components.map(c => ({
        id:          `comp-${c.ref}`,
        label:       c.ref,
        icon:        'component',
        description: `${c.value}  ·  ${c.footprint?.split(':').pop() ?? ''}${c.on_back ? '  ·  Back' : ''}`,
        action: () => {
          Router.navigate('/components');
          // Give the route time to mount, then set selected ref
          setTimeout(() => { store.selectedRefs = [c.ref]; }, 150);
          import('./modules/kicad-bridge/BridgeClient.js')
            .then(m => m.highlightComponent(c.ref))
            .catch(() => {});
        },
      })),
    });
  }

  palette.setItems(groups);
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function setupTheme() {
  const saved = localStorage.getItem(THEME) || 'dark';
  applyTheme(saved);
  subscribe('theme', applyTheme);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME, t);
}

// ── Header helpers ────────────────────────────────────────────────────────────

function setHeader(title, icon = '') {
  document.getElementById('view-header').innerHTML = `
    <div class="km-view-title">
      ${icon ? `<km-icon name="${icon}" size="sm" class="km-view-title__icon"></km-icon>` : ''}
      <span>${esc(title)}</span>
    </div>
  `;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  setHeader('Dashboard', 'cpu');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-dashboard style="height:100%;"></km-dashboard>`;

  // Dashboard emits km-nav for tool shortcuts → route to them
  c.querySelector('km-dashboard')?.addEventListener(KM_NAV, (e) => {
    Router.navigate(e.detail.route);
  });
}

// ── FEATURE VIEWS ─────────────────────────────────────────────────────────────

function renderDrc() {
  setHeader('DRC / ERC', 'drc');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-drc-panel style="height:100%;"></km-drc-panel>`;
  c.querySelector('km-drc-panel')?.addEventListener('km-violation-click', (e) => {
    notify({ type: 'info', title: 'Violation', message: e.detail.violation.description });
  });
}

function renderExport() {
  setHeader('Export', 'gerber');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-export-wizard style="height:100%;"></km-export-wizard>`;
  const w = c.querySelector('km-export-wizard');
  w?.addEventListener('km-export-done',  (e) => { if (e.detail.result?.raw?.success) notify({ type: 'success', title: 'Done', message: `${e.detail.type} export complete.` }); });
  w?.addEventListener('km-export-error', (e) => notify({ type: 'error', title: 'Export Failed', message: e.detail.error }));
}

function renderBom() {
  setHeader('BOM', 'bom');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-bom-table style="height:100%;"></km-bom-table>`;
}

// ── COMPONENT MODIFICATION (Ghost Layer + human-in-the-loop) ─────────────────

/**
 * Show a KmDialog confirmation before applying a board modification.
 * Rule: NO board write ever happens without explicit user confirmation.
 * @param {{ component, op, ...args }} detail
 * @param {HTMLElement} ghostLayer
 */
function _handleModify(detail, ghostLayer) {
  const { component: comp, op } = detail;
  const dialog = document.createElement('km-dialog');
  dialog.setAttribute('size', 'sm');

  let heading, bodyHtml;

  if (op === 'set-locked') {
    const newVal = detail.locked;
    heading  = newVal ? `Lock ${comp.ref}?` : `Unlock ${comp.ref}?`;
    bodyHtml = `<p>${newVal ? 'Prevent' : 'Allow'} movement and edits for <strong>${esc(comp.ref)}</strong> (${esc(comp.value)}).</p>`;
    dialog.setAttribute('heading', heading);
    dialog.innerHTML = `
      ${bodyHtml}
      <div slot="footer">
        <km-button variant="ghost"   id="dlg-cancel" size="sm">Cancel</km-button>
        <km-button variant="primary" id="dlg-ok"     size="sm">${newVal ? 'Lock' : 'Unlock'}</km-button>
      </div>
    `;
    _mountModifyDialog(dialog, async () => {
      const r = await setLocked(comp.ref, newVal).catch(err => ({ success: false, message: String(err) }));
      _handleWriteResult(r, op, comp.ref);
    });

  } else if (op === 'set-dnp') {
    const newVal = detail.dnp;
    heading  = newVal ? `Mark ${comp.ref} as DNP?` : `Clear DNP on ${comp.ref}?`;
    bodyHtml = `<p>${newVal ? 'Mark' : 'Unmark'} <strong>${esc(comp.ref)}</strong> as Do-Not-Place.</p>`;
    dialog.setAttribute('heading', heading);
    dialog.innerHTML = `
      ${bodyHtml}
      <div slot="footer">
        <km-button variant="ghost"                id="dlg-cancel" size="sm">Cancel</km-button>
        <km-button variant="${newVal ? 'danger' : 'primary'}" id="dlg-ok" size="sm">Confirm</km-button>
      </div>
    `;
    _mountModifyDialog(dialog, async () => {
      const r = await setDnp(comp.ref, newVal).catch(err => ({ success: false, message: String(err) }));
      _handleWriteResult(r, op, comp.ref);
    });

  } else if (op === 'move') {
    // Move: show a position input dialog, then push to GhostLayer for preview
    heading = `Move ${comp.ref}`;
    dialog.setAttribute('heading', heading);
    dialog.setAttribute('size', 'sm');
    const cx = comp.position?.x?.toFixed(2) ?? '0';
    const cy = comp.position?.y?.toFixed(2) ?? '0';
    dialog.innerHTML = `
      <div class="km-move-form">
        <p>Current: <code class="km-code">(${esc(cx)}, ${esc(cy)}) mm</code></p>
        <div class="km-move-row">
          <label>X (mm)</label>
          <input class="km-input-num" id="inp-x" type="number" step="0.1" value="${esc(cx)}" />
        </div>
        <div class="km-move-row">
          <label>Y (mm)</label>
          <input class="km-input-num" id="inp-y" type="number" step="0.1" value="${esc(cy)}" />
        </div>
        <p class="km-move-hint">Preview shown on board canvas. Click "Apply Move" to write.</p>
      </div>
      <div slot="footer">
        <km-button variant="ghost"   id="dlg-cancel" size="sm">Cancel</km-button>
        <km-button variant="secondary" id="dlg-preview" size="sm">Preview</km-button>
        <km-button variant="primary" id="dlg-ok"     size="sm">Apply Move</km-button>
      </div>
    `;

    document.getElementById('notification-host').appendChild(dialog);
    dialog.setAttribute('open', '');

    dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => { dialog.close(); ghostLayer?.clearGhost(); });
    dialog.querySelector('#dlg-preview')?.addEventListener('km-click', () => {
      const x = parseFloat(dialog.querySelector('#inp-x')?.value ?? cx);
      const y = parseFloat(dialog.querySelector('#inp-y')?.value ?? cy);
      if (!isNaN(x) && !isNaN(y)) ghostLayer?.setGhost({ ref: comp.ref, x_mm: x, y_mm: y });
    });
    dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
      const x = parseFloat(dialog.querySelector('#inp-x')?.value ?? cx);
      const y = parseFloat(dialog.querySelector('#inp-y')?.value ?? cy);
      dialog.close();
      if (!isNaN(x) && !isNaN(y)) {
        const r = await moveComponent(comp.ref, x, y).catch(err => ({ success: false, message: String(err) }));
        _handleWriteResult(r, op, comp.ref);
      }
    });
    dialog.addEventListener('km-close', () => dialog.remove());
    return; // early return — dialog is fully self-managed
  }
}

/**
 * Handle batch modify: show confirm dialog, then apply all ops.
 * Every write requires human approval — no silent board modifications (Rule 3).
 */
function _handleBatchModify(detail, ghostLayer, browser) {
  const { op, components } = detail;
  if (!components?.length) return;

  const n = components.length;
  const refs = components.map(c => c.ref).join(', ').slice(0, 60) + (n > 3 ? '…' : '');

  // For alignment ops, show align picker dialog
  if (op === 'align') {
    _showAlignDialog(components, ghostLayer, browser);
    return;
  }

  // For lock/DNP ops, show simple confirm
  const opLabel = { 'lock': 'Lock', 'unlock': 'Unlock', 'dnp-on': 'Set DNP on', 'dnp-off': 'Clear DNP on' }[op] ?? op;
  const dialog = document.createElement('km-dialog');
  dialog.setAttribute('heading', `${opLabel} ${n} components?`);
  dialog.setAttribute('size', 'sm');
  dialog.innerHTML = `
    <p>${opLabel} <strong>${n}</strong> selected component${n !== 1 ? 's' : ''}:<br>
    <code class="km-code" style="font-size:10px;">${esc(refs)}</code></p>
    <div slot="footer">
      <km-button variant="ghost"   id="dlg-cancel" size="sm">Cancel</km-button>
      <km-button variant="primary" id="dlg-ok"     size="sm">Apply to all</km-button>
    </div>
  `;
  _mountModifyDialog(dialog, async () => {
    const results = await _applyBatchOp(op, components);
    const failed = results.filter(r => !r.success);
    if (failed.length) {
      notify({ type: 'error', title: 'Batch op partial failure', message: `${failed.length} of ${n} failed`, duration: 0 });
    } else {
      notify({ type: 'success', title: `${opLabel} applied`, message: `${n} components updated` });
    }
  });
}

/** Show an alignment options dialog. */
function _showAlignDialog(components, ghostLayer, browser) {
  const n = components.length;
  const dialog = document.createElement('km-dialog');
  dialog.setAttribute('heading', `Align ${n} components`);
  dialog.setAttribute('size', 'sm');
  dialog.innerHTML = `
    <div class="km-align-grid">
      <km-button variant="secondary" size="sm" data-align="left">Align Left</km-button>
      <km-button variant="secondary" size="sm" data-align="centreH">Centre H</km-button>
      <km-button variant="secondary" size="sm" data-align="right">Align Right</km-button>
      <km-button variant="secondary" size="sm" data-align="top">Align Top</km-button>
      <km-button variant="secondary" size="sm" data-align="centreV">Centre V</km-button>
      <km-button variant="secondary" size="sm" data-align="bottom">Align Bottom</km-button>
      <km-button variant="secondary" size="sm" data-align="distributeH">Distribute H</km-button>
      <km-button variant="secondary" size="sm" data-align="distributeV">Distribute V</km-button>
      <km-button variant="secondary" size="sm" data-align="snap05">Snap 0.5 mm</km-button>
    </div>
    <div slot="footer">
      <km-button variant="ghost" id="dlg-cancel" size="sm">Cancel</km-button>
    </div>
  `;
  document.getElementById('notification-host').appendChild(dialog);
  dialog.setAttribute('open', '');

  dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close());

  for (const btn of dialog.querySelectorAll('[data-align]')) {
    btn.addEventListener('km-click', async () => {
      const alignOp = btn.dataset.align;
      const moves   = _computeAlignMoves(alignOp, components);
      if (!moves.length) { dialog.close(); return; }

      // Show ghost previews on canvas
      if (ghostLayer && moves.length > 0) {
        ghostLayer.setMultiSelect(components.map(c => c.ref));
      }

      dialog.close();

      // Apply all moves with confirmation already given by clicking the align button
      const results = await Promise.all(
        moves.map(m => moveComponent(m.ref, m.x_mm, m.y_mm).catch(err => ({ success: false, message: String(err) })))
      );
      const failed = results.filter(r => r?.success === false);
      if (failed.length) {
        notify({ type: 'error', title: 'Align partial failure', message: `${failed.length} of ${moves.length} moves failed`, duration: 0 });
      } else {
        notify({ type: 'success', title: 'Alignment applied', message: `${moves.length} components moved` });
      }
    });
  }
  dialog.addEventListener('km-close', () => dialog.remove());
}

/** Compute move operations for a given alignment type. */
function _computeAlignMoves(alignOp, components) {
  switch (alignOp) {
    case 'left':       return alignLeft(components);
    case 'right':      return alignRight(components);
    case 'top':        return alignTop(components);
    case 'bottom':     return alignBottom(components);
    case 'centreH':    return alignCentreH(components);
    case 'centreV':    return alignCentreV(components);
    case 'distributeH':return distributeH(components);
    case 'distributeV':return distributeV(components);
    case 'snap05':     return snapToGrid(components, 0.5);
    default:           return [];
  }
}

/** Apply a batch lock/DNP operation to all components. */
async function _applyBatchOp(op, components) {
  return Promise.all(components.map(async (c) => {
    try {
      switch (op) {
        case 'lock':    return await setLocked(c.ref, true);
        case 'unlock':  return await setLocked(c.ref, false);
        case 'dnp-on':  return await setDnp(c.ref, true);
        case 'dnp-off': return await setDnp(c.ref, false);
        default:        return { success: false, message: `Unknown op: ${op}` };
      }
    } catch (err) {
      Logger.error('Main', err, `batch op ${op} on ${c.ref}`);
      return { success: false, message: String(err?.message ?? err) };
    }
  }));
}

/** Mount a simple confirm dialog, call onConfirm on ok. */
function _mountModifyDialog(dialog, onConfirm) {
  document.getElementById('notification-host').appendChild(dialog);
  dialog.setAttribute('open', '');
  dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close());
  dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
    dialog.close();
    await onConfirm();
  });
  dialog.addEventListener('km-close', () => dialog.remove());
}

function _handleWriteResult(result, op, ref) {
  if (result?.success === false) {
    Logger.error('Main', result.message, `${op} on ${ref}`);
    notify({ type: 'error', title: 'Modify Failed', message: result.message ?? 'Unknown error', duration: 0 });
  } else {
    notify({ type: 'success', title: 'Board Updated', message: `${op} applied to ${ref}.` });
  }
}

async function _applyMove({ ref, x_mm, y_mm }) {
  const r = await moveComponent(ref, x_mm, y_mm).catch(err => ({ success: false, message: String(err) }));
  _handleWriteResult(r, 'move', ref);
}

// ── BRIDGE VIEW ───────────────────────────────────────────────────────────────

function renderBridge() {
  setHeader('KiCad Bridge', 'plug');
  const c = document.getElementById('view-container');
  c.style.padding = '';
  _renderBridgeContent(c);

  const unsubs = [
    subscribe('bridgeConnected',    () => _renderBridgeContent(c)),
    subscribe('boardComponents',    () => _renderBridgeContent(c)),
    subscribe('bridgeKicadVersion', () => _renderBridgeContent(c)),
    subscribe('boardDiag',          () => _renderBridgeContent(c)),
  ];
  const orig = Router.navigate.bind(Router);
  Router.navigate = (p) => { unsubs.forEach(f => f()); Router.navigate = orig; orig(p); };
}

function _renderBridgeContent(c) {
  const connected  = store.bridgeConnected;
  const version    = store.bridgeKicadVersion;
  const boardName  = store.bridgeBoardName;
  const components = store.boardComponents || [];
  const nets       = store.boardNets || [];
  const layers     = store.boardLayers || [];

  c.innerHTML = `
    <div class="km-bridge-view">

      <!-- Connection cell -->
      <div class="km-connection-cell${connected ? ' km-connection-cell--live' : ''}">
        <div class="km-dot${connected ? ' km-dot--active' : ''}"></div>
        <div class="km-connection-cell__info">
          <div class="km-connection-cell__status">
            ${connected ? `Connected to KiCad${version ? ` <span class="km-code">${version}</span>` : ''}` : 'Not connected'}
          </div>
          <div class="km-connection-cell__url">ws://127.0.0.1:40001${boardName ? ` · ${boardName}` : ''}</div>
        </div>
        <div class="km-connection-cell__actions">
          ${connected
            ? `<km-button variant="accent"   size="sm" id="btn-refresh">Refresh</km-button>
               <km-button variant="ghost"    size="sm" id="btn-disconnect">Disconnect</km-button>`
            : `<km-button variant="live"     size="sm" id="btn-connect">Connect</km-button>`
          }
        </div>
      </div>

      ${connected ? `
        <!-- Diagnostics (shown when board data is empty) -->
        ${components.length === 0 && (store.boardDiag || []).length > 0 ? `
          <div class="km-diag-bar">
            <strong>Bridge diagnostics:</strong> ${(store.boardDiag || []).join(' · ')}
          </div>
        ` : ''}

        <!-- Live stats -->
        <div class="km-bento km-bento--4">
          ${stat('Components', components.length, 'accent')}
          ${stat('Nets',       nets.length,       '')}
          ${stat('Layers',     layers.length,     '')}
          ${stat('Copper',     layers.filter(l => l.match(/\.Cu$/)).length || layers.length, 'live')}
        </div>

        <!-- Board design rules strip -->
        ${_boardStatsStrip(store.boardState)}

        <!-- Board operations -->
        <div class="km-ops-cell">
          <div class="km-cell-header">
            <km-icon name="layers" size="sm" class="km-cell-header__icon"></km-icon>
            <span class="km-cell-header__title">Board operations</span>
          </div>
          <div class="km-ops-row">
            <km-button variant="secondary" size="sm" id="btn-regen-zones">Regenerate zones…</km-button>
            <km-button variant="secondary" size="sm" id="btn-purge-vias">Find orphan vias…</km-button>
            <span class="km-ops-hint">Cleanup ops always run dry-first.</span>
          </div>
        </div>

        <!-- Component table -->
        <div class="km-bridge-table">
          <div class="km-cell-header">
            <km-icon name="component" size="sm" class="km-cell-header__icon"></km-icon>
            <span class="km-cell-header__title">Live Components (${components.length})</span>
          </div>
          <div class="km-bridge-table__scroll">
            <table class="km-table">
              <thead>
                <tr>
                  <th>Ref</th><th>Value</th><th>Footprint</th><th>Side</th><th>⊕</th>
                </tr>
              </thead>
              <tbody>
                ${components.slice(0, 60).map(comp => `
                  <tr>
                    <td>${esc(comp.ref)}</td>
                    <td class="km-table-value">${esc(comp.value || '—')}</td>
                    <td class="km-table-fp">${esc(shortFp(comp.footprint))}</td>
                    <td>${comp.on_back ? 'Back' : 'Front'}</td>
                    <td class="km-table-hl-col">
                      <span data-hl="${esc(comp.ref)}" class="km-hl-btn" title="Highlight">⊕</span>
                    </td>
                  </tr>
                `).join('')}
                ${components.length > 60 ? `<tr><td colspan="5" class="km-table-overflow">… ${components.length - 60} more components</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <!-- Setup guide -->
        <div class="km-install-card">
          <div class="km-install-card__title">Setup Instructions</div>
          <ol>
            <li>Click <strong>Install Plugin</strong> — copies bridge to your KiCad scripting folder.</li>
            <li>Restart KiCad or run <strong>Tools → Rescan Plugins</strong>.</li>
            <li>In KiCad PCB Editor: <strong>Tools → External Plugins → KiMaster Bridge</strong>.</li>
            <li>Click <strong>Connect</strong> above to establish the connection.</li>
          </ol>
          <div class="km-install-card__footer">
            <km-button variant="secondary" size="sm" id="btn-install">Install Plugin</km-button>
            <span class="km-install-path" id="install-path"></span>
          </div>
        </div>
      `}
    </div>
  `;

  // Wire
  c.querySelector('#btn-connect')?.addEventListener('km-click', async () => {
    const btn = c.querySelector('#btn-connect');
    btn?.setAttribute('loading', '');
    await connectBridge(40001).catch(() => {});
    btn?.removeAttribute('loading');
  });
  c.querySelector('#btn-disconnect')?.addEventListener('km-click', () => disconnectBridge());
  c.querySelector('#btn-refresh')?.addEventListener('km-click', async () => {
    const btn = c.querySelector('#btn-refresh');
    btn?.setAttribute('loading', '');
    await requestBoardState().catch(() => {});
    btn?.removeAttribute('loading');
  });
  c.querySelector('#btn-install')?.addEventListener('km-click', async () => {
    const btn = c.querySelector('#btn-install');
    btn?.setAttribute('loading', '');
    const r = await installBridgePlugin().catch(e => ({ success: false, message: String(e) }));
    btn?.removeAttribute('loading');
    notify({ type: r.success ? 'success' : 'error', title: r.success ? 'Plugin Installed' : 'Install Failed', message: r.message, duration: r.success ? 7000 : 0 });
  });

  const pathEl = c.querySelector('#install-path');
  if (pathEl) getPluginInstallPath().then(p => { pathEl.textContent = p; }).catch(() => {});

  for (const el of c.querySelectorAll('[data-hl]')) {
    el.addEventListener('click', () => highlightComponent(el.dataset.hl));
  }

  // Phase 12 A8 — Regenerate copper zones
  c.querySelector('#btn-regen-zones')?.addEventListener('km-click', () => {
    _showRegenZonesDialog();
  });

  // Phase 12 QA5 — Purge orphan vias (dry-run first)
  c.querySelector('#btn-purge-vias')?.addEventListener('km-click', () => {
    _showPurgeViasDialog();
  });
}

/** Build the regenerate-zones confirmation dialog. */
function _showRegenZonesDialog() {
  const layers = (store.boardLayers ?? []).filter(l => l.match(/\.Cu$/));
  const nets   = (store.boardNets   ?? []).slice(0, 200); // cap dropdown

  const dialog = document.createElement('km-dialog');
  dialog.setAttribute('heading', 'Regenerate copper zones');
  dialog.setAttribute('size', 'sm');
  dialog.innerHTML = `
    <div class="km-move-form">
      <p>Re-fill copper pours via <code class="km-code">pcbnew.ZONE_FILLER</code>. The board file will be saved.</p>
      <div class="km-move-row">
        <label>Layer</label>
        <select class="km-input-num" id="rz-layer">
          <option value="">All copper layers</option>
          ${layers.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
        </select>
      </div>
      <div class="km-move-row">
        <label>Net</label>
        <select class="km-input-num" id="rz-net">
          <option value="">All nets</option>
          ${nets.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select>
      </div>
      <div class="km-move-row">
        <label>Verify fill</label>
        <input type="checkbox" id="rz-check" checked>
      </div>
    </div>
    <div slot="footer">
      <km-button variant="ghost"     id="dlg-cancel" size="sm">Cancel</km-button>
      <km-button variant="primary"   id="dlg-ok"     size="sm">Refill</km-button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.show?.();

  dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close?.());
  dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
    const layer = dialog.querySelector('#rz-layer')?.value || '';
    const net   = dialog.querySelector('#rz-net')?.value   || '';
    const check = dialog.querySelector('#rz-check')?.checked ?? true;
    dialog.close?.();
    await _runRegenZones({ filter_layer: layer, filter_net: net, check_fill: check });
  });
}

/** Kick off the regenerate-zones op and surface the result via toast. */
async function _runRegenZones(opts) {
  const { regenerateZones } = await import('./modules/kicad-bridge/BridgeClient.js');
  const statusEl = document.querySelector('km-sidebar'); void statusEl;

  notify({
    type: 'info',
    title: 'Regenerating zones',
    message: opts.filter_layer || opts.filter_net
      ? `Filter: ${opts.filter_layer || 'all layers'} / ${opts.filter_net || 'all nets'}`
      : 'Re-filling all copper zones…',
    duration: 4000,
  });

  // Listen one-shot for the result event
  const handler = (e) => {
    if (e.detail?.op !== 'regenerate_zones') return;
    document.removeEventListener('km-bridge-op-result', handler);
    const r = e.detail;
    if (r.success) {
      notify({
        type: 'success',
        title: 'Zones refilled',
        message: `${r.message} · ${r.elapsed_ms} ms`,
        duration: 6000,
      });
    } else {
      notify({
        type: 'error',
        title: 'Refill failed',
        message: r.message ?? 'Unknown error',
        duration: 0,
      });
    }
  };
  document.addEventListener('km-bridge-op-result', handler);

  try {
    await regenerateZones(opts);
  } catch (err) {
    document.removeEventListener('km-bridge-op-result', handler);
    notify({ type: 'error', title: 'Refill failed', message: String(err) });
  }
}

// ── Phase 12 QA5 — Orphan via purge ──────────────────────────────────────────

/** Step 1: filter dialog → dry-run scan. */
function _showPurgeViasDialog() {
  const nets = (store.boardNets ?? []).slice(0, 200);

  const dialog = document.createElement('km-dialog');
  dialog.setAttribute('heading', 'Find orphan vias');
  dialog.setAttribute('size', 'sm');
  dialog.innerHTML = `
    <div class="km-move-form">
      <p>Scan the board for vias with no track or pad connection on either side. Runs <strong>dry-first</strong> — you confirm before anything is deleted.</p>
      <div class="km-move-row">
        <label>Net</label>
        <select class="km-input-num" id="pv-net">
          <option value="">All nets</option>
          ${nets.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div slot="footer">
      <km-button variant="ghost"   id="dlg-cancel" size="sm">Cancel</km-button>
      <km-button variant="primary" id="dlg-ok"     size="sm">Scan</km-button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.show?.();

  dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close?.());
  dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
    const net = dialog.querySelector('#pv-net')?.value || '';
    dialog.close?.();
    await _runViaScan({ filter_net: net, dry_run: true });
  });
}

/** Step 2: kick off dry-run scan → show review dialog on result. */
async function _runViaScan(opts) {
  const { purgeOrphanVias } = await import('./modules/kicad-bridge/BridgeClient.js');

  notify({
    type: 'info',
    title: 'Scanning vias',
    message: opts.filter_net ? `Net: ${opts.filter_net}` : 'Walking all vias on board…',
    duration: 3000,
  });

  const handler = (e) => {
    if (e.detail?.op !== 'purge_orphan_vias') return;
    document.removeEventListener('km-bridge-op-result', handler);
    const r = e.detail;
    if (!r.success) {
      notify({ type: 'error', title: 'Scan failed', message: r.message ?? 'Unknown error', duration: 0 });
      return;
    }
    if (r.dry_run) {
      _showPurgeReviewDialog(r, opts);
    } else {
      notify({
        type:    r.removed > 0 ? 'success' : 'info',
        title:   r.removed > 0 ? 'Vias removed' : 'Nothing removed',
        message: `${r.message} · ${r.elapsed_ms} ms`,
        duration: 6000,
      });
    }
  };
  document.addEventListener('km-bridge-op-result', handler);

  try {
    await purgeOrphanVias(opts);
  } catch (err) {
    document.removeEventListener('km-bridge-op-result', handler);
    notify({ type: 'error', title: 'Scan failed', message: String(err) });
  }
}

/** Step 3: review dialog — shows orphan list, lets user confirm destructive purge. */
function _showPurgeReviewDialog(scanResult, opts) {
  const orphans = scanResult.orphans ?? [];
  const dialog  = document.createElement('km-dialog');
  dialog.setAttribute('heading', `Found ${scanResult.orphan_count} orphan via${scanResult.orphan_count === 1 ? '' : 's'}`);
  dialog.setAttribute('size', 'md');

  if (orphans.length === 0) {
    dialog.innerHTML = `
      <div class="km-move-form">
        <p>The board is clean — no orphan vias were found across <strong>${scanResult.via_total}</strong> total vias.</p>
      </div>
      <div slot="footer">
        <km-button variant="primary" id="dlg-close" size="sm">OK</km-button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.show?.();
    dialog.querySelector('#dlg-close')?.addEventListener('km-click', () => dialog.close?.());
    return;
  }

  const sampleRows = orphans.slice(0, 50).map(o => `
    <tr>
      <td>${esc(o.net || '—')}</td>
      <td>${esc(o.top || '?')} → ${esc(o.bot || '?')}</td>
      <td>${(o.x_mm ?? 0).toFixed(3)}</td>
      <td>${(o.y_mm ?? 0).toFixed(3)}</td>
    </tr>
  `).join('');

  dialog.innerHTML = `
    <div class="km-move-form">
      <p><strong>${scanResult.orphan_count}</strong> via${scanResult.orphan_count === 1 ? '' : 's'} of <strong>${scanResult.via_total}</strong> have no connection on either side. Removing them is irreversible (board file will be rewritten).</p>
      <div class="km-via-scroll">
        <table class="km-table km-via-table">
          <thead>
            <tr><th>Net</th><th>Layers</th><th>X (mm)</th><th>Y (mm)</th></tr>
          </thead>
          <tbody>${sampleRows}</tbody>
        </table>
        ${orphans.length > 50 ? `<div class="km-table-overflow">… +${scanResult.orphan_count - 50} more not shown</div>` : ''}
      </div>
    </div>
    <div slot="footer">
      <km-button variant="ghost"  id="dlg-cancel" size="sm">Cancel</km-button>
      <km-button variant="danger" id="dlg-ok"     size="sm">Delete ${scanResult.orphan_count} via${scanResult.orphan_count === 1 ? '' : 's'}</km-button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.show?.();

  dialog.querySelector('#dlg-cancel')?.addEventListener('km-click', () => dialog.close?.());
  dialog.querySelector('#dlg-ok')?.addEventListener('km-click', async () => {
    dialog.close?.();
    await _runViaScan({ ...opts, dry_run: false });
  });
}

/** Render a compact board dimensions + design rules strip. */
function _boardStatsStrip(boardState) {
  const bs = boardState?.board_size;
  const dr = boardState?.design_rules;
  if (!bs && !dr) return '';

  const items = [];
  if (bs) {
    items.push(`<span class="km-board-stat"><span class="km-board-stat__label">Board</span><span class="km-board-stat__val km-tabular">${bs.width_mm?.toFixed(1) ?? '?'} × ${bs.height_mm?.toFixed(1) ?? '?'} mm</span></span>`);
  }
  if (dr) {
    if (dr.min_clearance_mm != null)   items.push(_dstat('Min clearance', dr.min_clearance_mm.toFixed(3) + ' mm'));
    if (dr.min_track_width_mm != null) items.push(_dstat('Min track',     dr.min_track_width_mm.toFixed(3) + ' mm'));
    if (dr.min_via_drill_mm != null)   items.push(_dstat('Min via drill', dr.min_via_drill_mm.toFixed(3) + ' mm'));
  }
  if (items.length === 0) return '';

  return `<div class="km-board-stats-strip">${items.join('')}</div>`;
}

function _dstat(label, value) {
  return `<span class="km-board-stat">
    <span class="km-board-stat__label">${esc(label)}</span>
    <span class="km-board-stat__val km-tabular">${esc(value)}</span>
  </span>`;
}

function stat(label, value, variant, hero = false) {
  const cellCls = hero ? ' km-cell--accent' : '';
  return `
    <div class="km-cell${cellCls}">
      <div class="km-stat-tile">
        <div class="km-stat-tile__label">${label}</div>
        <div class="km-stat-tile__value${variant === 'live' ? ' km-stat-tile__value--live' : variant === 'accent' ? ' km-stat-tile__value--accent' : ''}">${value}</div>
      </div>
    </div>
  `;
}

// ── PLACEHOLDER VIEWS ─────────────────────────────────────────────────────────

function placeholder(title, icon, msg) {
  setHeader(title, icon);
  const c = document.getElementById('view-container');
  c.style.padding = '';
  c.innerHTML = `
    <div class="km-placeholder">
      <km-icon name="${icon}" size="xl" class="km-placeholder__icon"></km-icon>
      <div>
        <div class="km-placeholder__title">${title}</div>
        <div class="km-placeholder__text">${msg}</div>
      </div>
    </div>
  `;
}

function renderHistory() {
  setHeader('Revision History', 'history');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-revision-timeline style="height:100%;"></km-revision-timeline>`;
}

function renderNotes() {
  setHeader('Engineering Notes', 'notes');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-notes-editor style="height:100%;"></km-notes-editor>`;

  // Smart-link clicks in the preview pane → bridge highlight
  c.querySelector('km-notes-editor')?.addEventListener(KM_NOTES_LINK_CLICK, (e) => {
    const { type, ref, net } = e.detail;
    if (type === 'ref' && ref) {
      highlightComponent(ref).catch(err => Logger.warn('Notes', 'Smart-link highlight failed', err));
      notify({ type: 'info', title: `Highlight ${ref}`, message: 'Component highlighted in KiCad.', duration: 2000 });
    } else if (type === 'net' && net) {
      import('./modules/kicad-bridge/BridgeClient.js')
        .then(m => m.highlightNet(net))
        .catch(err => Logger.warn('Notes', 'Smart-link net highlight failed', err));
      notify({ type: 'info', title: `Highlight net ${net}`, message: 'Net highlighted in KiCad.', duration: 2000 });
    }
  });
}

function renderVault() {
  setHeader('Component Vault', 'vault');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-component-vault style="height:100%;"></km-component-vault>`;

  const vault = c.querySelector('km-component-vault');
  vault?.addEventListener('km-uce-vault-added', (e) => {
    notify({ type: 'success', title: 'Added to vault', message: `${e.detail.lcsc_id} ready for use in KiCad.` });
  });
  vault?.addEventListener('km-uce-vault-removed', (e) => {
    notify({ type: 'info', title: 'Removed from vault', message: e.detail.lcsc_id });
  });
}

function renderBoardRender() {
  setHeader('3D Render', 'render');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-board-render style="height:100%;"></km-board-render>`;
  const r = c.querySelector('km-board-render');
  r?.addEventListener('km-render-done',  (e) => notify({ type: 'success', title: 'Render complete', message: e.detail.output_path }));
  r?.addEventListener('km-render-error', (e) => notify({ type: 'error',   title: 'Render failed',   message: e.detail.message }));
}

function renderSchematic()  { placeholder('Schematic', 'schematic', 'Coming in Phase 3 — requires KiCad Bridge.'); }
function renderPcb()        { placeholder('PCB Layout',  'pcb',       'Coming in Phase 3.'); }

function renderComponents() {
  setHeader('Components', 'component');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `
    <div class="km-components-layout">
      <div class="km-components-browser">
        <km-component-browser id="comp-browser"></km-component-browser>
      </div>
      <div class="km-components-canvas" id="components-canvas">
        <km-ghost-layer    id="ghost-layer"></km-ghost-layer>
        <km-net-inspector  id="net-inspector" class="km-hidden"></km-net-inspector>
      </div>
    </div>
  `;

  const ghostLayer   = c.querySelector('#ghost-layer');
  const netInspector = c.querySelector('#net-inspector');
  const browser      = c.querySelector('#comp-browser');

  // Show ghost layer (components mode)
  const showGhost = () => {
    ghostLayer?.classList.remove('km-hidden');
    netInspector?.classList.add('km-hidden');
  };
  // Show net inspector (nets mode)
  const showInspector = () => {
    ghostLayer?.classList.add('km-hidden');
    netInspector?.classList.remove('km-hidden');
  };

  // Single component select → highlight + ghost layer
  browser?.addEventListener('km-component-select', (e) => {
    store.selectedRefs = [e.detail.component.ref];
    ghostLayer?.setMultiSelect([]);
    showGhost();
  });

  // Net select → swap to inspector and query plugin
  browser?.addEventListener('km-net-select', (e) => {
    const net = e.detail.net;
    if (!net) return;
    showInspector();
    netInspector?.inspect(net);
  });

  // Single component modify → human-in-the-loop dialog
  browser?.addEventListener('km-component-modify', (e) => {
    _handleModify(e.detail, ghostLayer);
  });

  // Batch modify → confirm → execute
  browser?.addEventListener('km-component-batch-modify', (e) => {
    _handleBatchModify(e.detail, ghostLayer, browser);
  });

  ghostLayer?.addEventListener('km-ghost-confirm', async (e) => {
    await _applyMove(e.detail);
  });
}
function renderSettings() {
  setHeader('Settings', 'settings');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-settings-panel style="height:100%;"></km-settings-panel>`;
}

// ── Notification ──────────────────────────────────────────────────────────────

export function notify({ type = 'info', title = '', message, duration = 4000 }) {
  const host = document.getElementById('notification-host');
  if (!host) return;
  const el = document.createElement('km-notification');
  el.setAttribute('type', type);
  if (title)    el.setAttribute('title', title);
  el.setAttribute('message', message);
  el.setAttribute('duration', String(duration));
  host.appendChild(el);
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function shortFp(s) {
  return s ? s.split(':').pop() || s : '—';
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch(console.error);
