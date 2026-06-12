/**
 * KiMaster — application bootstrap.
 * Inline styles BANNED — use CSS classes from views.css / tokens.css.
 */

import './lib/kicanvas/vendor/kicanvas.js';
import './components/ui/index.js';
import './components/features/FootprintEditor/FootprintEditor.js';
import './components/features/DrcPanel/DrcPanel.js';
import './components/features/ExportWizard/ExportWizard.js';
import './components/features/SettingsPanel/SettingsPanel.js';
import './components/features/ComponentBrowser/ComponentBrowser.js';
import './components/features/RevisionTimeline/RevisionTimeline.js';
import './components/features/NotesEditor/NotesEditor.js';
import './components/features/ComponentVault/ComponentVault.js';
import './components/features/BoardRender/BoardRender.js';
import './components/features/Live3D/Live3D.js';
import './components/features/PCB3D/PCB3D.js';
import './components/features/Dashboard/Dashboard.js';
import './components/features/NetInspector/NetInspector.js';
import './components/features/BomTable/BomTable.js';
import './components/features/NetlistGraph/NetlistGraph.js';
import './components/features/StackupManager/StackupManager.js';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignCentreH, alignCentreV,
  distributeH, distributeV,
  snapToGrid,
} from './modules/board/AlignService.js';
import { AnimationKit }     from './design/animations/index.js';
import { kcvOverlay } from './modules/render/KiCanvasView.js';
import { initIpc, invoke, invokeNow } from './core/Ipc.js';
import { store, subscribe } from './core/State.js';
import { Router }           from './core/Router.js';
import { Logger }           from './core/Logger.js';
import { notify }           from './core/Notify.js';
import { THEME, DENSITY, SETTINGS } from './core/AppKeys.js';
import { GET_APP_INFO, GET_KICAD_CLI_PATH, SCAN_KICAD_INSTANCES } from './core/AppCommands.js';
import { KM_NAV, KM_NOTES_LINK_CLICK } from './core/AppEvents.js';
import {
  loadProjectState,
  initProjectListeners,
  pickAndOpenProject,
} from './modules/project/ProjectService.js';
import { autoDrcOnChange, errorCount } from './modules/drc/DrcService.js';
import {
  initBridgeListeners, connectKiCad, disconnectBridge, startAutoConnect,
  installBridgePlugin, getPluginInstallPath, requestBoardState,
  highlightComponent, clearHighlight, moveComponent, setLocked, setDnp,
} from './modules/kicad-bridge/BridgeClient.js';
import { renderPluginSlot } from './modules/kicad-bridge/PluginSlot.js';

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

  hydrateBridgeSettings();

  setupRouter();
  setupTheme();
  setupDensity();
  setupSidebarNav();
  setupCommandPalette();
  setupGlobalKeymap();

  // Auto-connect to KiCad bridge (polls every 3s until connected).
  // Respects the user's `bridgeAutoConnect` and `bridgePort` settings.
  if (store.bridgeAutoConnect) {
    startAutoConnect(3000);
  }

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
    .on('/pcb3d',     renderPcb3d)
    .on('/live3d',    renderLive3D)
    .on('/graph',     renderGraph)
    .on('/stackup',   renderStackup)
    // Board Tools now live docked inside the PCB Layout tab (km-board-tools-rail) —
    // redirect any old links/bookmarks straight there instead of a standalone page.
    .on('/board-tools', () => Router.navigate('/pcb'))
    .on('/bridge',    renderBridge)
    .on('/settings',         renderSettings)
    .on('/footprint-editor', renderFootprintEditor)
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
    kcvOverlay.reset();
    _triggerKicanvasPreload();
  });

  subscribe('bridgeConnected', (connected) => {
    _updateBridgeHeaderChip();
    if (connected) {
      notify({ type: 'success', title: 'KiCad Connected', message: 'Bridge plugin active.' });
      // Bridge is the single source of truth — always set project from bridge
      _updateProjectFromBridge(sidebar);
      // Kick off background KiCanvas parse as soon as bridge connects
      setTimeout(_triggerKicanvasPreload, 200);
    } else {
      // Clear bridge-sourced project on disconnect
      if (store.project?.source === 'bridge') {
        store.project = null;
        sidebar?.setProject?.({ name: '', active: false });
      }
    }
  });

  // Update sidebar project when board name changes (user switches boards in KiCad)
  subscribe('bridgeBoardName', () => { _updateProjectFromBridge(sidebar); _updateBridgeHeaderChip(); });
  subscribe('bridgePort', () => _updateBridgeHeaderChip());

  // ── DRC violation badge on sidebar nav item ──────────────────────────────
  subscribe('drcErrors', () => {
    const count = errorCount();
    sidebar?.setBadge('drc', count);
  });

  // ── Upcoming: Option B badge — component PDN violations ──────────────────
  // subscribe('stackupSegmentResults', results => sidebar?.setBadge('stackup', results?.filter(r => !r.pass).length ?? 0));

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
    { id: 'nav-dashboard',   label: 'Dashboard',    icon: 'cpu',       description: 'App overview & status',          kind: 'filter', action: () => Router.navigate('/') },
    { id: 'nav-drc',         label: 'DRC / ERC',    icon: 'drc',       description: 'Design rule checks',             kind: 'filter', action: () => Router.navigate('/drc') },
    { id: 'nav-export',      label: 'Export',       icon: 'gerber',    description: 'Gerbers, PDF, SVG, BOM',         kind: 'filter', action: () => Router.navigate('/export') },
    { id: 'nav-components',  label: 'Components',   icon: 'component', description: 'Browse & search board parts',    kind: 'filter', action: () => Router.navigate('/components') },
    { id: 'nav-bridge',      label: 'KiCad Bridge', icon: 'plug',      description: 'Live board sync',                kind: 'filter', action: () => Router.navigate('/bridge') },
    { id: 'nav-settings',    label: 'Settings',     icon: 'settings',  description: 'Configure KiMaster',             kind: 'filter', action: () => Router.navigate('/settings') },
    { id: 'nav-history',     label: 'History',      icon: 'history',   description: 'Git revision timeline + DRC diff', kind: 'filter', action: () => Router.navigate('/history') },
    { id: 'nav-schematic',   label: 'Schematic',    icon: 'schematic', description: 'Schematic navigator',              kind: 'filter', action: () => Router.navigate('/schematic') },
    { id: 'nav-notes',       label: 'Notes',        icon: 'notes',     description: 'Engineering notes + task list',     kind: 'filter', action: () => Router.navigate('/notes') },
    { id: 'nav-vault',       label: 'Component Vault', icon: 'vault',  description: 'LCSC/EasyEDA → KiCad library (native Rust)', kind: 'filter', action: () => Router.navigate('/vault') },
    { id: 'nav-render',      label: '3D Render',    icon: 'render',    description: 'Render 3D board views via kicad-cli',          kind: 'filter', action: () => Router.navigate('/render') },
    { id: 'nav-live3d',      label: 'Live 3D',      icon: 'render',    description: 'Photorealistic real-time 3D PCB viewer',       kind: 'filter', action: () => Router.navigate('/live3d') },
    { id: 'nav-stackup',      label: 'Stackup Manager', icon: 'layers', description: 'Impedance calc, track audit, JLCPCB/PCBWay presets', kind: 'filter', action: () => Router.navigate('/stackup') },
    { id: 'nav-board-tools',  label: 'Board Tools',     icon: 'pcb',    description: 'Via stitch, teardrops, panelize — docked in PCB Layout', kind: 'filter', action: () => Router.navigate('/pcb') },
  ];

  const actions = [
    { id: 'act-run-drc',      label: 'Run DRC',            icon: 'drc',     kbd: ['Shift','D'],
      description: 'Run design rule check on active project', kind: 'action',
      action: () => { Router.navigate('/drc'); }
    },
    { id: 'act-open-project', label: 'Open Project',       icon: 'cpu',
      description: 'Open a .kicad_pro file', kind: 'action',
      action: () => pickAndOpenProject().then(r => { if (r.success) renderDashboard(); })
    },
    { id: 'act-settings-appearance', label: 'Appearance Settings', icon: 'settings',
      description: 'Change accent color, font, density', kind: 'action',
      action: () => Router.navigate('/settings')
    },
    { id: 'act-toggle-theme',  label: 'Toggle Theme',  icon: 'sun',     kbd: ['T'],
      description: `Switch to ${store.theme === 'dark' ? 'light' : 'dark'} mode`, kind: 'action',
      action: () => toggleTheme(),
    },
    { id: 'act-toggle-density', label: 'Toggle Density', icon: 'grid',   kbd: ['D'],
      description: `Cycle compact → cozy → comfortable (currently: ${store.density})`, kind: 'action',
      action: () => cycleDensity(),
    },
    { id: 'act-shortcut-sheet',  label: 'Keyboard Shortcuts', icon: 'keyboard',
      description: 'Show all keybinds and gestures', kind: 'action',  kbd: ['?'],
      action: () => toggleShortcutSheet(),
    },
    { id: 'act-reset-dashboard', label: 'Reset Dashboard Layout', icon: 'layout',
      description: 'Restore the default widget order and sizes', kind: 'action',
      action: () => {
        const dash = document.querySelector('km-dashboard');
        if (dash && typeof dash._resetLayout === 'function') dash._resetLayout();
      },
    },
  ];

  if (store.bridgeConnected) {
    actions.push(
      { id: 'act-disconnect', label: 'Disconnect Bridge',  icon: 'plug',
        description: 'Disconnect from KiCad WS bridge', kind: 'action',
        action: () => disconnectBridge().catch(() => {})
      },
      { id: 'act-clear-hl',  label: 'Clear Highlights',    icon: 'drc',
        description: 'Clear all KiCad highlights', kind: 'action',
        action: () => clearHighlight().catch(() => {}),
      },
      { id: 'act-regen-zones', label: 'Regenerate Zones',  icon: 'layers',
        description: 'Re-fill all copper pours (pcbnew.ZONE_FILLER)', kind: 'action',
        action: () => _showRegenZonesDialog(),
      },
      { id: 'act-purge-vias',  label: 'Find Orphan Vias',  icon: 'via',
        description: 'Scan and remove vias with no track or pad connection (dry-run first)', kind: 'action',
        action: () => _showPurgeViasDialog(),
      },
    );
  } else {
    actions.push({
      id: 'act-connect', label: 'Connect to KiCad', icon: 'plug',
      description: 'Connect to KiCad bridge plugin', kind: 'action',
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
        kind:        'filter',
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

/**
 * Pull bridge-related fields out of the saved Settings blob and seed the
 * reactive store. The Settings panel writes to its own `_settings` object +
 * localStorage; this is the bridge into the global store so the rest of
 * the app can react (e.g. main.js decides whether to start auto-connect).
 */
function hydrateBridgeSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved.bridgePort === 'number')        store.bridgePort        = saved.bridgePort;
    if (typeof saved.bridgeAutoConnect === 'boolean') store.bridgeAutoConnect = saved.bridgeAutoConnect;
  } catch (err) {
    Logger.warn('Boot', 'Could not hydrate bridge settings', err);
  }
}

function setupTheme() {
  const saved = localStorage.getItem(THEME) || 'dark';
  // Seed the store BEFORE the subscriber is attached so the initial
  // applyTheme call doesn't fire a no-op write, AND so feature code
  // (e.g. SettingsPanel guards like `if (store.theme === 'light')`) can
  // read the persisted theme at construction time.
  store.theme = saved;
  applyTheme(saved);
  subscribe('theme', applyTheme);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME, t);

  // Strip any inline --km-bg-app / --km-sidebar-bg left over from a previous
  // dark-mode session. SettingsPanel.hiContrastDark writes these inline on
  // <html> in dark mode (so they win over stylesheet rules); if we don't
  // clear them when crossing to light, the sidebar stays dark and masks
  // the light theme.
  if (t === 'light') {
    document.documentElement.style.removeProperty('--km-bg-app');
    document.documentElement.style.removeProperty('--km-sidebar-bg');
  }
}

// ── Density — per plan §10. Drives [data-density] on <html>; tokens.css
// defines the three density token maps (compact / cozy / comfortable).
// Persists in its own localStorage key so it survives even if the user
// nukes the settings blob. Cycle: compact → cozy → comfortable → compact.
const DENSITY_ORDER = ['compact', 'cozy', 'comfortable'];
function setupDensity() {
  const saved = localStorage.getItem(DENSITY) || 'cozy';
  store.density = DENSITY_ORDER.includes(saved) ? saved : 'cozy';
  applyDensity(store.density);
  subscribe('density', applyDensity);
}
function applyDensity(d) {
  document.documentElement.setAttribute('data-density', d);
  localStorage.setItem(DENSITY, d);
}
function cycleDensity() {
  const i = DENSITY_ORDER.indexOf(store.density);
  const next = DENSITY_ORDER[(i + 1) % DENSITY_ORDER.length];
  store.density = next;
  notify({ type: 'info', title: 'Density', message: `Switched to ${next}`, duration: 1800 });
}
function toggleTheme() {
  store.theme = store.theme === 'dark' ? 'light' : 'dark';
  notify({ type: 'info', title: 'Theme', message: `Switched to ${store.theme}`, duration: 1800 });
}

// ── Global keymap — per plan §7.3. Runs once on boot. Listens for keypresses
// that should fire anywhere in the app unless an editable field is focused
// (so typing 'd' in a search box doesn't toggle density). The shortcut sheet
// (`?`) and the omni-bar both surface this same list.
const GLOBAL_KEYMAP = [
  { key: '?', shift: true, label: 'Show shortcut sheet',           run: () => toggleShortcutSheet() },
  { key: 'd', label: 'Toggle density (compact / cozy / comfortable)', run: () => cycleDensity() },
  { key: 't', label: 'Toggle theme (dark / light)',                run: () => toggleTheme() },
  { key: 'k', meta: true, label: 'Open command palette',          run: () => openCommandPalette() },
  { key: '.', meta: true, label: 'Open widget picker',            run: () => document.dispatchEvent(new CustomEvent('km:open-widget-picker')) },
];

/** Toggle the global command palette (km-command-palette). */
function openCommandPalette() {
  const palette = document.getElementById('command-palette');
  if (!palette) return;
  // Rebuild items so the latest bridge/project state is searchable
  _buildPaletteItems(palette);
  if (palette.hasAttribute('open')) {
    palette.close?.();
    palette.removeAttribute('open');
  } else {
    palette.show?.();
    // Focus the search input after the open transition
    setTimeout(() => palette.shadowRoot?.querySelector('.search')?.focus(), 50);
  }
}
function setupGlobalKeymap() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey) return;          // browser / Alt-drag territory
    if (_isEditableTarget(e.target)) return;    // don't hijack typing in inputs
    if (e.metaKey && e.key !== '.') return;     // let ⌘K / ⌘P / ⌘S go to their owners

    for (const chord of GLOBAL_KEYMAP) {
      if (e.key.toLowerCase() !== chord.key) continue;
      if (Boolean(chord.shift) !== e.shiftKey) continue;
      if (Boolean(chord.meta)   !== e.metaKey)  continue;
      if (Boolean(chord.alt)    !== e.altKey)   continue;
      if (Boolean(chord.ctrl)   !== e.ctrlKey)  continue;
      e.preventDefault();
      chord.run();
      return;
    }
  });
}
function _isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  // km-* web components with an open input — treat as editable
  if (typeof t.closest === 'function' && t.closest('km-command-palette[open], km-dialog[open]')) return true;
  return false;
}
function toggleShortcutSheet() {
  const existing = document.getElementById('shortcut-sheet');
  if (existing) { existing.close(); return; }
  const sheet = document.createElement('km-shortcut-sheet');
  sheet.id = 'shortcut-sheet';
  sheet.chords = GLOBAL_KEYMAP;
  document.body.appendChild(sheet);
}

// ── Header helpers ────────────────────────────────────────────────────────────

function setHeader(title, icon = '') {
  // Any non-kicanvas view hides the overlay — kicanvas views call kcvOverlay.show() themselves
  kcvOverlay.hide();
  const titleEl = document.getElementById('view-header-title');
  if (titleEl) {
    titleEl.innerHTML = `
      <div class="km-view-title">
        ${icon ? `<km-icon name="${icon}" size="sm" class="km-view-title__icon"></km-icon>` : ''}
        <span>${esc(title)}</span>
      </div>
    `;
  }
}

function _updateBridgeHeaderChip() {
  const el = document.getElementById('view-header-bridge');
  if (!el) return;
  if (!store.bridgeConnected) {
    el.innerHTML = '';
    return;
  }
  const port = store.bridgePort || 40001;
  const boardName = store.bridgeBoardName
    ? store.bridgeBoardName.replace(/\\/g, '/').split('/').pop()
    : '';
  el.innerHTML = `
    <div class="km-header-bridge">
      <span class="km-header-bridge-port">:${port}</span>
      ${boardName ? `<span class="km-header-bridge-sep">·</span><span class="km-header-bridge-name" title="${esc(store.bridgeBoardName || '')}">${esc(boardName)}</span>` : ''}
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

function renderGraph() {
  setHeader('Net Graph', 'graph');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-netlist-graph style="height:100%;"></km-netlist-graph>`;
}

function renderStackup() {
  setHeader('Stackup Manager', 'layers');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-stackup-panel style="height:100%;"></km-stackup-panel>`;
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

/** Last known scan results for the instances tile. null = not yet scanned. */
let _bridgeInstances = null;

function renderBridge() {
  setHeader('KiCad Bridge', 'cable');
  const c = document.getElementById('view-container');
  c.style.padding = '';
  _renderBridgeContent(c);

  // Settings chip in header — gives a one-click jump to port/auto-connect knobs
  const titleEl = document.getElementById('view-header-title');
  const chip = document.createElement('a');
  chip.href = '#/settings';
  chip.className = 'km-header-bridge-settings';
  chip.title = 'Bridge settings (port, auto-connect)';
  chip.innerHTML = '<km-icon name="settings" size="sm"></km-icon><span>Settings</span>';
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    // Pre-select the Bridge category so the user lands on the right section
    queueMicrotask(() => {
      const panel = document.querySelector('km-settings-panel');
      if (panel && panel._activeId !== undefined) {
        panel._activeId = 'bridge';
        panel._renderContent('bridge');
        panel._renderNav?.();
      }
    });
    Router.navigate('/settings');
  });
  titleEl?.appendChild(chip);

  const unsubs = [
    subscribe('bridgeConnected', (connected) => {
      // Clear stale scan results when bridge disconnects so reconnect
      // starts with a fresh scan instead of showing old port data
      if (!connected) _bridgeInstances = null;
      _renderBridgeContent(c);
    }),
    subscribe('boardComponents',    () => _renderBridgeContent(c)),
    subscribe('bridgeKicadVersion', () => _renderBridgeContent(c)),
    subscribe('boardDiag',          () => _renderBridgeContent(c)),
    subscribe('bridgeServerStopped',() => _renderBridgeContent(c)),
  ];
  const orig = Router.navigate.bind(Router);
  Router.navigate = (p) => { unsubs.forEach(f => f()); Router.navigate = orig; orig(p); };
}

function _renderBridgeContent(c) {
  const connected  = store.bridgeConnected;
  const stopped    = store.bridgeServerStopped;   // user explicitly stopped in KiCad
  const version    = store.bridgeKicadVersion;
  const boardName  = store.bridgeBoardName;
  const components = store.boardComponents || [];
  const nets       = store.boardNets || [];
  const layers     = store.boardLayers || [];
  const port       = store.bridgePort || 40001;

  // Build instances rows from scan results only (no phantom pre-population)
  const instRows = _buildInstanceRows(connected, boardName, port);

  c.innerHTML = `
    <div class="km-bridge-view">

      <!-- ── Connection status cell ── -->
      <div class="km-connection-cell${connected ? ' km-connection-cell--live' : ''}">
        <div class="km-dot${connected ? ' km-dot--active' : stopped ? ' km-dot--warning' : ''}"></div>
        <div class="km-connection-cell__info">
          <div class="km-connection-cell__status">
            ${connected
              ? `Connected to KiCad${version ? ` <span class="km-code">${esc(version)}</span>` : ''}`
              : stopped
                ? `<span style="color:var(--km-warning)">Server stopped</span>`
                : 'Not connected'}
          </div>
          <div class="km-connection-cell__url">
            ${connected
              ? `ws://127.0.0.1:${port}${boardName ? ` · <span style="color:var(--km-text-secondary)">${esc(boardName.replace(/\\/g,'/').split('/').pop())}</span>` : ''}`
              : stopped
                ? `Re-activate the plugin in KiCad: Tools → External Plugins → KiMaster Bridge`
                : 'Auto-connecting to port 40001–40010…'}
          </div>
        </div>
        <div class="km-connection-cell__actions">
          ${connected
            ? `<km-button variant="secondary" size="sm" id="btn-refresh" icon-only title="Refresh board state (Ctrl+Shift+B)" aria-label="Refresh board state"><km-icon name="rotate-ccw" size="sm"></km-icon></km-button>
               <km-button variant="secondary" size="sm" id="btn-scan" title="Scan for other running KiCad instances" aria-label="Scan for instances">Scan now</km-button>
               <km-button variant="danger"  size="sm" id="btn-disconnect">Disconnect</km-button>`
            : `<km-button variant="live"   size="sm" id="btn-connect">Connect</km-button>
               <km-button variant="secondary" size="sm" id="btn-scan" title="Scan ports 40001–40010 for a running bridge plugin" aria-label="Scan for instances">Scan now</km-button>`
          }
        </div>
      </div>

      ${_shouldShowInstancesTile(connected, port)
        ? `<!-- ── KiCad instances tile ── -->
          <div class="km-instances-cell">
            <div class="km-cell-header">
              <km-icon name="monitor" size="sm" class="km-cell-header__icon"></km-icon>
              <span class="km-cell-header__title">KiCad instances</span>
              <span id="scan-status" style="font-size:10px;color:var(--km-text-muted);margin-left:auto;"></span>
            </div>
            <div id="instances-body">
              ${instRows || `<div class="km-instances-empty">
                Click <strong>Scan now</strong> to discover running KiCad instances with the bridge plugin active.
              </div>`}
            </div>
          </div>`
        : ''}

      ${connected ? `
        <!-- Diagnostics bar -->
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

      ` : ''}

      <!-- ── Plugin tile (always visible) ── -->
      <div class="km-plugin-cell" id="km-plugin-cell">
        <div class="km-cell-header">
          <km-icon name="plug" size="sm" class="km-cell-header__icon"></km-icon>
          <span class="km-cell-header__title">Plugin</span>
        </div>
        <div id="plugin-slot-bridge" style="padding:var(--km-space-3) var(--km-space-4);">
          <span style="font-size:11px;color:var(--km-text-muted)">Checking…</span>
        </div>
        <div style="padding:0 var(--km-space-4) var(--km-space-3);font-size:var(--km-font-size-xs);color:var(--km-text-muted)">
          After installing: restart KiCad → <strong>Tools → External Plugins → KiMaster Bridge</strong>
        </div>
      </div>

    </div>
  `;

  // ── Wire connection buttons ─────────────────────────────────────────────
  c.querySelector('#btn-connect')?.addEventListener('km-click', async () => {
    const btn = c.querySelector('#btn-connect');
    btn?.setAttribute('loading', '');
    try {
      await connectKiCad();
    } catch (err) {
      notify({ type: 'error', title: 'Connection failed', message: err.message, duration: 6000 });
    }
    btn?.removeAttribute('loading');
  });
  c.querySelector('#btn-refresh')?.addEventListener('km-click', async () => {
    const btn = c.querySelector('#btn-refresh');
    btn?.setAttribute('loading', '');
    await requestBoardState().catch(() => {});
    btn?.removeAttribute('loading');
  });
  c.querySelector('#btn-disconnect')?.addEventListener('km-click', () => disconnectBridge());

  // ── Scan now ────────────────────────────────────────────────────────────
  c.querySelector('#btn-scan')?.addEventListener('km-click', () => _runBridgeScan(c));

  // ── Wire per-instance connect / disconnect buttons ──────────────────────
  _wireInstanceButtons(c);

  // ── Plugin slot ─────────────────────────────────────────────────────────
  _renderPluginSlotBridge(c);
}

// ── Instances helpers ────────────────────────────────────────────────────────

/**
 * Decide whether to render the "KiCad instances" tile.
 *
 * Hidden when there's nothing useful to show:
 *   - never scanned AND already connected (top cell carries the state)
 *   - scan found exactly one instance AND it IS the current connection
 *     (would just duplicate the top cell)
 *
 * Shown when the user might want to act:
 *   - not connected (need to scan to find something)
 *   - scan found 2+ instances (might want to switch)
 *   - scan found one instance that is NOT the current connection
 *     (e.g. connected to :40001 manually, scan also found :40005)
 */
function _shouldShowInstancesTile(connected, currentPort) {
  // Connected: hide the tile when there's nothing the user could switch to.
  //   - never scanned   → top cell already shows the live state, no need
  //   - scanned, empty  → nothing else to connect to
  //   - scanned, one == current → just a duplicate of the top cell
  if (connected) {
    if (!_bridgeInstances || _bridgeInstances.length === 0) return false;
    if (_bridgeInstances.length === 1 && _bridgeInstances[0].port === currentPort) return false;
    return true;
  }
  // Not connected: show the tile only if a scan has found at least one
  // instance the user can pick. If nothing's been scanned yet, Scan now
  // is already in the top cell, so the tile would just be dead weight.
  if (!_bridgeInstances || _bridgeInstances.length === 0) return false;
  return true;
}

/**
 * Build instance row HTML — scan results ONLY.
 *
 * The currently-connected instance is omitted from this list; the top
 * connection cell already shows it. Rows for other instances give a quick
 * "switch to" affordance.
 */
function _buildInstanceRows(connected, boardName, currentPort) {
  // No scan yet — return empty (the tile shows "Click Scan now" hint)
  if (!_bridgeInstances) return '';

  if (!_bridgeInstances.length) return '';

  return _bridgeInstances
    .filter(inst => !(connected && inst.port === currentPort))
    .map(inst => {
    const proj     = (inst.board_name || '').replace(/\\/g, '/').split('/').pop() || `port ${inst.port}`;
    const dirPath  = inst.board_name
      ? inst.board_name.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      : '';

    return `
      <div class="km-instance-row">
        <div class="km-instance-port">:${inst.port}</div>
        ${dirPath
          ? `<button class="km-icon-btn" data-open-dir="${esc(dirPath)}" title="Open folder">
               <km-icon name="folder-open" size="sm"></km-icon>
             </button>`
          : '<div style="width:24px"></div>'}
        <div class="km-instance-name">
          <span class="km-instance-proj">${esc(proj)}</span>
          ${inst.kicad_version ? `<span class="km-instance-ver">KiCad ${esc(inst.kicad_version)}</span>` : ''}
        </div>
        <km-button variant="secondary" size="sm" data-connect-port="${inst.port}">Connect</km-button>
      </div>`;
  }).join('');
}

/** Wire per-instance connect/disconnect buttons after DOM update. */
function _wireInstanceButtons(c) {
  for (const btn of c.querySelectorAll('[data-connect-port]')) {
    btn.addEventListener('km-click', async () => {
      const port = parseInt(btn.dataset.connectPort);
      btn.setAttribute('loading', '');
      try {
        await connectKiCad({ port });
      } catch (err) {
        notify({ type: 'error', title: 'Connection failed', message: err.message, duration: 6000 });
      }
      btn.removeAttribute('loading');
    });
  }
  for (const btn of c.querySelectorAll('[data-open-dir]')) {
    btn.addEventListener('click', async () => {
      const dir = btn.dataset.openDir;
      if (!dir) return;
      // Open using the shell (Tauri invoke if available, fallback no-op in browser)
      try {
        const { invoke: inv } = await import('./core/Ipc.js');
        await inv('cmd_open_directory', { path: dir });
      } catch { /* no-op in browser mode */ }
    });
  }
}

/** Run a port scan and refresh the instances tile in-place (no full re-render). */
async function _runBridgeScan(c) {
  const scanBtn  = c.querySelector('#btn-scan');
  const scanStat = c.querySelector('#scan-status');
  const body     = c.querySelector('#instances-body');

  if (scanBtn) scanBtn.setAttribute('loading', '');
  if (scanStat) scanStat.textContent = 'Scanning…';

  try {
    const { invoke: inv } = await import('./core/Ipc.js');
    const results = await inv(SCAN_KICAD_INSTANCES);
    _bridgeInstances = results || [];

    if (scanBtn) scanBtn.removeAttribute('loading');
    if (scanStat) scanStat.textContent = `${_bridgeInstances.length} found`;

    // If the tile isn't currently rendered (we hid it as redundant), the
    // scan may have made it relevant — fall back to a full re-render so
    // the tile appears. Otherwise update the body in-place.
    if (!body || !document.body.contains(body)) {
      _renderBridgeContent(c);
    } else {
      const rows = _buildInstanceRows(store.bridgeConnected, store.bridgeBoardName, store.bridgePort || 40001);
      body.innerHTML = rows || `<div class="km-instances-empty">No bridge plugins found on ports 40001–40010.<br>
        Make sure KiCad is open and the plugin is activated.</div>`;
      _wireInstanceButtons(c);
    }
  } catch (err) {
    if (scanBtn) scanBtn.removeAttribute('loading');
    if (scanStat) scanStat.textContent = 'Scan failed';
    Logger.error('Bridge', 'Scan failed', err);
  }
}

/** Render the plugin status slot inside the bridge panel plugin tile. */
function _renderPluginSlotBridge(c) {
  return renderPluginSlot({
    container: c.querySelector('#plugin-slot-bridge'),
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
    if (!store.bridgeConnected) {
      notify({ type: 'error', title: 'Bridge not connected', message: 'Connect the KiCad bridge to highlight components or nets.' });
      return;
    }
    if (type === 'ref' && ref) {
      highlightComponent(ref)
        .then(() => notify({ type: 'info', title: `Highlight ${ref}`, message: 'Component highlighted in KiCad.', duration: 2000 }))
        .catch(err => {
          Logger.warn('Notes', 'Smart-link highlight failed', err);
          notify({ type: 'error', title: 'Highlight failed', message: String(err?.message ?? err) });
        });
    } else if (type === 'net' && net) {
      import('./modules/kicad-bridge/BridgeClient.js')
        .then(m => m.highlightNet(net))
        .then(() => notify({ type: 'info', title: `Highlight net ${net}`, message: 'Net highlighted in KiCad.', duration: 2000 }))
        .catch(err => {
          Logger.warn('Notes', 'Smart-link net highlight failed', err);
          notify({ type: 'error', title: 'Highlight failed', message: String(err?.message ?? err) });
        });
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


function renderPcb3d() {
  setHeader('PCB 3D', 'render');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-pcb3d style="height:100%;"></km-pcb3d>`;
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

function renderLive3D() {
  setHeader('Live 3D', 'render');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-live-3d style="height:100%;"></km-live-3d>`;
  const v = c.querySelector('km-live-3d');
  v?.addEventListener('km-live3d-error', (e) => notify({ type: 'error', title: 'Live 3D error', message: e.detail.message }));
}

function _toKicanvasSrc(path) {
  if (!path) return null;
  return window.__TAURI_INTERNALS__?.convertFileSrc
    ? window.__TAURI_INTERNALS__.convertFileSrc(path)
    : 'file:///' + path.replace(/\\/g, '/');
}

function _triggerKicanvasPreload() {
  const pcbPath = store.boardState?.board_name ?? store.project?.pcb_file ?? null;
  if (!pcbPath) return;
  const pcbSrc = _toKicanvasSrc(pcbPath);
  const schSrc = _toKicanvasSrc(pcbPath.replace(/\.kicad_pcb$/i, '.kicad_sch'));
  kcvOverlay.preload(pcbSrc, schSrc);
}

function renderSchematic() {
  const pcbPath = store.boardState?.board_name ?? store.project?.pcb_file ?? null;
  if (!pcbPath) { setHeader('Schematic', 'schematic'); placeholder('Schematic', 'schematic', 'Open a project or connect the KiCad Bridge to view the schematic.'); return; }
  _triggerKicanvasPreload();
  setHeader('Schematic', 'schematic');
  kcvOverlay.show('sch');
}

function renderPcb() {
  const pcbPath = store.boardState?.board_name ?? store.project?.pcb_file ?? null;
  if (!pcbPath) { setHeader('PCB Layout', 'pcb'); placeholder('PCB Layout', 'pcb', 'Open a project or connect the KiCad Bridge to view the PCB layout.'); return; }
  _triggerKicanvasPreload();
  setHeader('PCB Layout', 'pcb');
  kcvOverlay.show('pcb');
}

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

function renderFootprintEditor() {
  setHeader('Footprint Editor', 'pcb');
  const c = document.getElementById('view-container');
  c.style.padding = '0';
  c.innerHTML = `<km-footprint-editor style="height:100%;"></km-footprint-editor>`;
}

// ── Notification ──────────────────────────────────────────────────────────────

export { notify } from './core/Notify.js';

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
