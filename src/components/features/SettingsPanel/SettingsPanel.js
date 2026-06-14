/**
 * @element km-settings-panel
 * @summary Full settings panel — Claude Desktop left-nav + Obsidian section style.
 *
 * Categories: General · KiCad Bridge · Exports · Appearance · Shortcuts · About
 * Persistence: localStorage (Phase 4 migrates to SQLite)
 */

import { store, subscribe } from '../../../core/State.js';
import { invoke, invokeNow } from '../../../core/Ipc.js';
import { Logger } from '../../../core/Logger.js';
import { SETTINGS, THEME } from '../../../core/AppKeys.js';
import {
  GET_VAULT_DIR, SET_VAULT_DIR, SCAN_KICAD_INSTANCES,
} from '../../../core/AppCommands.js';
import { AnimationKit } from '../../../design/animations/index.js';
import { BRIDGE_CONNECTED, BRIDGE_DISCONNECTED, PROJECT_AUTO_DETECTED } from '../../../core/AppEvents.js';

// ── Settings store (localStorage-backed) ──────────────────────────────────

const DEFAULTS = {
  // General
  openLastProject:   true,
  checkCliOnStart:   true,
  notificationsOn:   true,
  notifyDuration:    4000,
  colorScheme:       'dark',
  // KiCad
  kicadCliPath:      '',
  kicadVersion:      'auto',
  // Bridge
  bridgePort:        40001,
  bridgeAutoConnect: true,

  // Exports
  outputDir:         '',
  gerberPrecision:   6,
  gerberX2:          true,
  gerberNetlist:     true,
  bomFields:         'Reference,Value,Footprint,Quantity',
  pdfPageSize:       'A4',
  // Appearance
  accentPreset:      'cobalt',
  interfaceFont:     'geist',
  interfaceScale:    'default',
  contentDensity:    'default',
  hiContrastDark:    true,
  // Advanced
  tabularNums:       true,
  debugLogging:      false,
  // Phase 8 — auto-DRC
  autoDrcOnSave:     true,
};

const ACCENT_PRESETS = {
  cobalt:   { label: 'Cobalt Blue',   value: '#2563EB', hover: '#3B82F6', active: '#1D4ED8', muted: 'rgba(37,99,235,0.12)', border: 'rgba(37,99,235,0.28)', glow: '0 0 16px rgba(37,99,235,0.35)' },
  cyan:     { label: 'Safety Cyan',   value: '#06B6D4', hover: '#22D3EE', active: '#0891B2', muted: 'rgba(6,182,212,0.12)',  border: 'rgba(6,182,212,0.25)',  glow: '0 0 14px rgba(6,182,212,0.35)'  },
  violet:   { label: 'Electric Violet', value: '#7C3AED', hover: '#8B5CF6', active: '#6D28D9', muted: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.28)', glow: '0 0 14px rgba(124,58,237,0.35)' },
  emerald:  { label: 'Trace Green',   value: '#10B981', hover: '#34D399', active: '#059669', muted: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)', glow: '0 0 14px rgba(16,185,129,0.35)' },
  amber:    { label: 'Amber',         value: '#F59E0B', hover: '#FBBF24', active: '#D97706', muted: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', glow: '0 0 14px rgba(245,158,11,0.35)' },
  rose:     { label: 'Rose',          value: '#F43F5E', hover: '#FB7185', active: '#E11D48', muted: 'rgba(244,63,94,0.12)',  border: 'rgba(244,63,94,0.25)',  glow: '0 0 14px rgba(244,63,94,0.35)'  },
};

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS);
    const merged = saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
    // Re-sync the color scheme pill with the live theme so the UI doesn't
    // briefly show "Dark" selected after a reload, even though the theme
    // itself is persisted under a separate THEME key by main.js.
    try {
      const liveTheme = localStorage.getItem(THEME);
      if (liveTheme === 'light' || liveTheme === 'dark') merged.colorScheme = liveTheme;
    } catch { /* localStorage may be blocked — DEFAULTS.colorScheme wins */ }
    return merged;
  } catch (err) {
    Logger.warn('Settings', 'Could not load saved settings — using defaults', err);
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch (err) {
    Logger.error('Settings', err, 'Could not persist settings to localStorage');
  }
}

// ── Nav categories ─────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'general',    label: 'General',     icon: 'settings' },
  { id: 'bridge',     label: 'KiCad Bridge', icon: 'cable' },
  { id: 'exports',    label: 'Exports',     icon: 'gerber' },
  { id: 'appearance', label: 'Appearance',  icon: 'layers' },
  { id: 'shortcuts',  label: 'Shortcuts',   icon: 'search' },
  { id: 'about',      label: 'About',       icon: 'info' },
];

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'],     action: 'Command palette' },
  { keys: ['Ctrl', 'D'],     action: 'Run DRC' },
  { keys: ['Ctrl', 'E'],     action: 'Open Export' },
  { keys: ['Ctrl', 'B'],     action: 'KiCad Bridge' },
  { keys: ['Ctrl', ','],     action: 'Open Settings' },
  { keys: ['Ctrl', 'Shift', 'R'], action: 'Refresh board state' },
  { keys: ['Esc'],           action: 'Close / dismiss' },
];

// ── Template ───────────────────────────────────────────────────────────────

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    height: 100%;
    font-family: var(--km-font);
    color: var(--km-text-primary);
    background: var(--km-bg-primary);
    overflow: hidden;
  }

  /* ── Left nav ── */
  .nav {
    width: 200px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--km-bg-app);
    border-right: 1px solid var(--km-border);
    padding: var(--km-space-4) var(--km-space-2);
    gap: 1px;
    overflow-y: auto;
  }
  .nav-section-label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--km-text-muted);
    padding: var(--km-space-3) var(--km-space-2-5) var(--km-space-1-5);
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2-5);
    padding: var(--km-space-1-5) var(--km-space-2-5);
    border-radius: var(--km-radius-sm);
    cursor: pointer;
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-secondary);
    border-left: 2px solid transparent;
    transition: background var(--km-duration-fast) var(--km-ease),
                color     var(--km-duration-fast) var(--km-ease),
                border-color var(--km-duration-fast) var(--km-ease);
    user-select: none;
  }
  .nav-item:hover { background: rgba(255,255,255,0.04); color: var(--km-text-primary); }
  .nav-item.active {
    background: var(--km-sidebar-active);
    color: var(--km-accent-hover);
    border-left-color: var(--km-accent);
  }
  .nav-item km-icon { flex-shrink: 0; }

  /* ── Content area ── */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--km-space-6) var(--km-space-8);
    max-width: 680px;
    scrollbar-width: thin;
    scrollbar-color: var(--km-scrollbar-thumb) transparent;
  }

  /* ── Section ── */
  .section { margin-bottom: var(--km-space-8); }
  .section-title {
    font-size: var(--km-font-size-lg);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    letter-spacing: -0.015em;
    margin-bottom: var(--km-space-1);
  }
  .section-desc {
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
    margin-bottom: var(--km-space-5);
    line-height: 1.55;
  }

  /* ── Setting group ── */
  .group {
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-md);
    box-shadow: var(--km-bezel);
    overflow: hidden;
    margin-bottom: var(--km-space-4);
  }
  .group-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--km-text-muted);
    padding: var(--km-space-2-5) var(--km-space-4);
    background: var(--km-bg-elevated);
    border-bottom: 1px solid var(--km-border);
  }

  /* ── Setting row ── */
  .row {
    display: flex;
    align-items: center;
    gap: var(--km-space-4);
    padding: var(--km-space-3) var(--km-space-4);
    border-top: 1px solid var(--km-border);
    min-height: 48px;
  }
  .row:first-of-type { border-top: none; }
  .row--top { align-items: flex-start; padding-top: var(--km-space-4); }
  .row__info { flex: 1; min-width: 0; }
  .row__label {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    color: var(--km-text-primary);
    margin-bottom: 2px;
  }
  .row__sub {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    line-height: 1.45;
  }
  .row__ctrl { flex-shrink: 0; }

  /* ── Toggle ── */
  .toggle {
    display: inline-block;
    position: relative;
    width: 36px;
    height: 20px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .toggle-track {
    position: absolute;
    inset: 0;
    border-radius: var(--km-radius-full);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border-strong);
    box-sizing: border-box;
    /* The track is a simple block: the thumb is absolutely positioned
       inside it so the off/on math is exact. The 4px inset on each side
       of the thumb gives 4px of visible gutter in BOTH states, with the
       thumb vertically centred by translateY(-50%). */
    transition: background var(--km-duration-fast), border-color var(--km-duration-fast);
  }
  .toggle-thumb {
    /* Centre math (host 36×20, 1px border, 4px gutter on every visible
       edge of the track):
         off  : left = 4px,  right = 36 − 4 − 12 = 20px   (gap 4 / 20)
         on   : left = 20px, right = 4px                  (gap 20 / 4)
       Vertical: 12px thumb in 20px host → top = 4px, bottom = 4px. */
    position: absolute;
    top: 4px;
    left: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--km-text-muted);
    transform: translateX(0);
    transition: transform var(--km-duration-compress) var(--km-ease-compress),
                background var(--km-duration-fast);
  }
  .toggle input:checked ~ .toggle-thumb {
    /* Travel = 36 − 4·2 − 12 = 16px → thumb sits at left=20px,
       right=4px, perfectly mirroring the off state. */
    transform: translateX(16px);
    background: var(--km-accent-hover);
  }
  .toggle input:checked ~ .toggle-track {
    background: var(--km-accent-muted);
    border-color: var(--km-accent-border);
  }

  /* ── Inline status hint (e.g. bridge port scan result) ── */
  .setting-hint {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
  }
  .setting-hint[data-state="in-use"]   { color: var(--km-text-success); }
  .setting-hint[data-state="free"]     { color: var(--km-text-muted); }
  .setting-hint[data-state="mismatch"] { color: var(--km-text-warning); }
  .setting-hint[data-state="error"]    { color: var(--km-text-danger); }
  .setting-hint[data-state="pending"]  { color: var(--km-text-muted); opacity: 0.7; }

  /* ── Select ── */
  .km-select {
    height: 30px;
    padding: 0 var(--km-space-3);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-primary);
    font-family: var(--km-font);
    font-size: var(--km-font-size-sm);
    cursor: pointer;
    outline: none;
    min-width: 130px;
    box-shadow: var(--km-bezel);
    transition: border-color var(--km-duration-fast);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: var(--km-space-6);
  }
  .km-select:hover  { border-color: var(--km-border-strong); }
  .km-select:focus  { border-color: var(--km-accent); box-shadow: var(--km-bezel), 0 0 0 2px var(--km-accent-muted); }
  .km-select option { background: var(--km-bg-elevated); color: var(--km-text-primary); }
  /* Native <option> popups inherit document colors and ignore our
     shadow-DOM data-theme. Force the UA to use light/dark form widgets to
     match the surrounding surface. */
  :host([data-theme="light"]) .km-select,
  :host-context(html[data-theme="light"]) .km-select {
    color-scheme: light;
  }
  .km-select { color-scheme: dark; }
  /* Chevron stroke reads as ~30% white-on-dark; on light it disappears. */
  :host-context(html[data-theme="light"]) .km-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(0,0,0,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }

  /* ── Text input ── */
  .km-input {
    height: 30px;
    padding: 0 var(--km-space-3);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-primary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-xs);
    font-variant-numeric: tabular-nums;
    outline: none;
    width: 100%;
    box-shadow: var(--km-bezel);
    transition: border-color var(--km-duration-fast);
  }
  .km-input:hover  { border-color: var(--km-border-strong); }
  .km-input:focus  { border-color: var(--km-accent); box-shadow: var(--km-bezel), 0 0 0 2px var(--km-accent-muted); }
  .km-input::placeholder { color: var(--km-text-muted); font-family: var(--km-font); }

  /* Number input */
  .km-input-num {
    height: 30px;
    width: 80px;
    padding: 0 var(--km-space-2);
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    color: var(--km-text-primary);
    font-family: var(--km-font-mono);
    font-size: var(--km-font-size-sm);
    font-variant-numeric: tabular-nums;
    outline: none;
    box-shadow: var(--km-bezel);
    text-align: right;
    transition: border-color var(--km-duration-fast);
  }
  .km-input-num:focus { border-color: var(--km-accent); box-shadow: var(--km-bezel), 0 0 0 2px var(--km-accent-muted); }

  /* ── Path row ── */
  .path-row { display: flex; gap: var(--km-space-2); align-items: center; width: 260px; }

  /* ── Status badge ── */
  .status-ok   { font-size: var(--km-font-size-xs); color: var(--km-success); font-variant-numeric: tabular-nums; }
  .status-warn { font-size: var(--km-font-size-xs); color: var(--km-warning); }
  .status-mono { font-size: 10px; font-family: var(--km-font-mono); color: var(--km-text-muted); font-variant-numeric: tabular-nums; }

  /* ── Circular accent swatches ── */
  .swatches { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 2px 0; }
  .swatch {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform var(--km-duration-compress) var(--km-ease-compress),
                box-shadow var(--km-duration-base) var(--km-ease);
  }
  .swatch:hover { transform: scale(1.12); }
  /* Selection ring: gap uses the surface colour, then a white halo */
  .swatch.active {
    transform: scale(1.05);
    box-shadow: 0 0 0 2.5px var(--km-bg-surface), 0 0 0 4.5px rgba(255,255,255,0.70);
  }

  /* ── Pill-group (segmented selector, like Claude Code) ── */
  .pill-group {
    display: flex;
    background: var(--km-bg-elevated);
    border: 1px solid var(--km-border);
    border-radius: var(--km-radius-sm);
    padding: 2px;
    gap: 2px;
  }
  .pill {
    padding: 4px 12px;
    border-radius: calc(var(--km-radius-sm) - 2px);
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-medium);
    cursor: pointer;
    color: var(--km-text-secondary);
    white-space: nowrap;
    user-select: none;
    transition: background var(--km-duration-fast) var(--km-ease),
                color     var(--km-duration-fast) var(--km-ease);
  }
  .pill:hover:not(.active) { color: var(--km-text-primary); }
  .pill.active {
    background: var(--km-bg-primary);
    color: var(--km-text-primary);
    box-shadow: var(--km-bezel);
  }

  /* ── Shortcut row ── */
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--km-space-2-5) var(--km-space-4);
    border-top: 1px solid var(--km-border);
    font-size: var(--km-font-size-sm);
    color: var(--km-text-secondary);
  }
  .shortcut-row:first-of-type { border-top: none; }
  .keys { display: flex; gap: var(--km-space-1); }
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 6px;
    border: 1px solid var(--km-border-strong);
    border-radius: var(--km-radius-xs);
    background: var(--km-bg-elevated);
    box-shadow: var(--km-bezel), 0 1px 0 rgba(255,255,255,0.03);
    font-family: var(--km-font-mono);
    font-size: 10px;
    color: var(--km-text-primary);
    min-width: 22px;
  }

  /* ── About section ── */
  .about-logo {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--km-space-4);
  }
  .about-logo svg { width: 72px; height: 72px; }
  .about-version {
    font-size: var(--km-font-size-2xl);
    font-weight: var(--km-font-weight-semibold);
    letter-spacing: -0.02em;
    color: var(--km-text-primary);
    margin-bottom: var(--km-space-1);
  }
  .about-sub { font-size: var(--km-font-size-sm); color: var(--km-text-muted); }
  .about-links { display: flex; gap: var(--km-space-3); margin-top: var(--km-space-4); }
  .about-link {
    font-size: var(--km-font-size-xs);
    color: var(--km-accent-hover);
    text-decoration: none;
    cursor: pointer;
  }
  .about-link:hover { text-decoration: underline; }

  /* ── Scrollbar ── */
  .content::-webkit-scrollbar { width: 4px; }
  .content::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 4px; }
</style>

<div class="nav" id="settings-nav"></div>
<div class="content" id="settings-content"></div>
`;

export class SettingsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._settings = loadSettings();
    this._activeId = 'general';
  }

  connectedCallback() {
    this._globalVaultDir  = '';
    this._projectVaultDir = null;
    this._unlisten        = [];
    this._applyAllSettings();
    this._renderNav();
    this._renderContent(this._activeId);
    this._loadVaultDirs();
    this._initEventListeners();

    // main.js clears the hi-contrast inline --km-bg-app / --km-sidebar-bg
    // when crossing into light mode (so stylesheet rules can take over).
    // If the user toggles back to dark, we need to re-write those inline
    // values — otherwise the bg quietly loses its OLED-black variant.
    this._unlisten.push(subscribe('theme', () => {
      this._applyHiContrastInline(this._settings.hiContrastDark);
    }));
  }

  _applyAllSettings() {
    const s = this._settings;
    // Strip any stale inline bg values that a previous dark-mode mount may
    // have left on <html>. The actual hi-contrast values get re-applied
    // below if the current theme is dark.
    if (store.theme === 'light') {
      document.documentElement.style.removeProperty('--km-bg-app');
      document.documentElement.style.removeProperty('--km-sidebar-bg');
    }
    if (s.accentPreset)    this._applyAccent(s.accentPreset);
    if (s.interfaceFont)   this._save('interfaceFont',   s.interfaceFont);
    if (s.interfaceScale)  this._save('interfaceScale',  s.interfaceScale);
    if (s.contentDensity)  this._save('contentDensity',  s.contentDensity);
    if (s.hiContrastDark !== undefined) this._applyHiContrastInline(s.hiContrastDark);
  }

  _applyHiContrastInline(enabled) {
    // Inline styles win over stylesheet rules. Only write them in dark mode;
    // light mode reads bg-app / sidebar-bg straight from tokens.css.
    // main.js clears these on light-toggle; we re-apply them on dark-toggle.
    const root = document.documentElement;
    if (store.theme === 'light') {
      root.style.removeProperty('--km-bg-app');
      root.style.removeProperty('--km-sidebar-bg');
      return;
    }
    root.style.setProperty('--km-bg-app',     enabled ? '#000000' : '#0a0a0b');
    root.style.setProperty('--km-sidebar-bg', enabled ? '#000000' : '#0a0a0b');
  }

  disconnectedCallback() {
    // Clean up Tauri event listeners to avoid leaks
    this._unlisten.forEach(fn => fn());
    this._unlisten = [];
  }

  async _initEventListeners() {
    if (!window.__TAURI_INTERNALS__) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      // Refresh vault dirs when bridge connects (project auto-detected)
      this._unlisten.push(await listen(PROJECT_AUTO_DETECTED, () => this._loadVaultDirs()));
      // Refresh when project is opened/closed manually
      this._unlisten.push(await listen('project:opened', () => this._loadVaultDirs()));
      this._unlisten.push(await listen('project:closed', () => this._loadVaultDirs()));
      // Refresh when bridge disconnects (project vault cleared)
      this._unlisten.push(await listen(BRIDGE_DISCONNECTED, () => this._loadVaultDirs()));
    } catch (err) {
      Logger.warn('Settings', 'Could not init Tauri event listeners', err);
    }
  }

  async _loadVaultDirs() {
    try {
      const r = await invoke(GET_VAULT_DIR);
      this._globalVaultDir  = r.global_vault  || '';
      this._projectVaultDir = r.project_vault || null;
      const g = this.shadowRoot.getElementById('vault-global-input');
      const p = this.shadowRoot.getElementById('vault-project-input');
      if (g) g.value = this._globalVaultDir;
      if (p) p.value = this._projectVaultDir || '(no project open)';
    } catch (err) {
      Logger.warn('Settings', 'Could not load vault dirs', err);
    }
  }

  // ── Nav ──────────────────────────────────────────────────────────────────

  _renderNav() {
    const nav = this.shadowRoot.getElementById('settings-nav');
    nav.innerHTML = `<div class="nav-section-label">Settings</div>`;
    for (const cat of CATEGORIES) {
      const el = document.createElement('div');
      el.className = `nav-item${cat.id === this._activeId ? ' active' : ''}`;
      el.dataset.id = cat.id;
      el.innerHTML = `<km-icon name="${cat.icon}" size="sm"></km-icon>${cat.label}`;
      el.addEventListener('click', () => {
        this._activeId = cat.id;
        this._renderNav();
        this._renderContent(cat.id);
      });
      nav.appendChild(el);
    }
  }

  // ── Content routing ───────────────────────────────────────────────────────

  _renderContent(id) {
    const el = this.shadowRoot.getElementById('settings-content');
    const map = {
      general:    () => this._renderGeneral(),
      bridge:     () => this._renderBridge(),
      exports:    () => this._renderExports(),
      appearance: () => this._renderAppearance(),
      shortcuts:  () => this._renderShortcuts(),
      about:      () => this._renderAbout(),
    };
    el.innerHTML = map[id]?.() || '';
    this._attachHandlers();
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  _renderGeneral() {
    const s = this._settings;
    return `
      <div class="section">
        <div class="section-title">General</div>
        <div class="section-desc">Application behavior and startup preferences.</div>

        <div class="group">
          <div class="group-title">Startup</div>
          ${this._row('Open last project on launch', 'Automatically reopen the most recently used project.', `
            ${this._toggle('openLastProject', s.openLastProject)}
          `)}
          ${this._row('Check for kicad-cli on startup', 'Auto-detect the KiCad CLI binary each time the app launches.', `
            ${this._toggle('checkCliOnStart', s.checkCliOnStart ?? true)}
          `)}
          ${this._row('Auto-DRC on save', 'Run DRC automatically when a .kicad_pcb file is saved. Shows badge on DRC nav item.', `
            ${this._toggle('autoDrcOnSave', s.autoDrcOnSave ?? true)}
          `)}
        </div>

        <div class="group">
          <div class="group-title">Notifications</div>
          ${this._row('Enable toast notifications', 'Show slide-in notifications for DRC results, exports, and bridge events.', `
            ${this._toggle('notificationsOn', s.notificationsOn)}
          `)}
          ${this._row('Auto-dismiss duration', 'How long notifications stay visible (0 = sticky).', `
            <div style="display:flex;align-items:center;gap:6px;">
              <input class="km-input-num" type="number" data-key="notifyDuration" value="${s.notifyDuration}" min="0" max="30000" step="500">
              <span class="status-mono">ms</span>
            </div>
          `)}
        </div>

        <div class="group">
          <div class="group-title">Component Library</div>
          ${this._row('Global vault', 'Shared across all projects. Default: Documents/KiMaster Library.', `
            <div style="display:flex;gap:6px;align-items:center;width:260px;">
              <input class="km-input" type="text" id="vault-global-input" readonly
                     placeholder="Loading…" value="${esc(this._globalVaultDir || '')}"
                     style="flex:1;min-width:0;">
              <km-button variant="secondary" size="sm" id="btn-change-vault-dir">Browse…</km-button>
            </div>
          `, true)}
          ${this._row('Project vault', 'Auto-created inside the open project\'s .kimaster folder. Read-only.', `
            <div style="width:260px;">
              <input class="km-input" type="text" id="vault-project-input" readonly
                     placeholder="(no project open)"
                     value="${esc(this._projectVaultDir || '')}"
                     style="opacity:${this._projectVaultDir ? '1' : '0.45'};">
            </div>
          `, true)}
        </div>

      </div>
    `;
  }

  _renderBridge() {
    const s = this._settings;
    const cliPath = store.kicadCliPath || s.kicadCliPath || '';
    return `
      <div class="section">
        <div class="section-title">KiCad Bridge</div>
        <div class="section-desc">KiCad installation, version preferences, and the WebSocket link to the Python plugin. For live status, scan results, and plugin management, open the <a href="#/bridge" id="link-open-bridge">Bridge monitor</a> in the sidebar.</div>

        <div class="group">
          <div class="group-title">CLI Binary</div>
          ${this._row('kicad-cli path', 'Path to the kicad-cli executable. Leave empty for auto-detection.', `
            <div class="path-row">
              <input class="km-input" type="text" data-key="kicadCliPath" placeholder="Auto-detect..." value="${esc(cliPath)}">
            </div>
          `, true)}
          ${this._row('Detected version', 'Current kicad-cli version found on this machine.', `
            <span class="${cliPath ? 'status-ok' : 'status-warn'}">${cliPath ? '✓ Found' : '✗ Not found'}</span>
          `)}
        </div>

        <div class="group">
          <div class="group-title">Version</div>
          ${this._row('KiCad version target', 'Used to resolve library paths and API compatibility.', `
            <select class="km-select" data-key="kicadVersion">
              <option value="auto"  ${s.kicadVersion === 'auto'  ? 'selected' : ''}>Auto-detect</option>
              <option value="10.0"  ${s.kicadVersion === '10.0'  ? 'selected' : ''}>KiCad 10.0</option>
              <option value="9.0"   ${s.kicadVersion === '9.0'   ? 'selected' : ''}>KiCad 9.0</option>
            </select>
          `)}
        </div>

        <div class="group">
          <div class="group-title">Connection</div>
          ${this._row('WebSocket port', 'Port the KiMaster Python plugin listens on (auto-discovered 40001–40010).', `
            <div style="display:flex;align-items:center;gap:8px;">
              <input id="bridge-port-input" class="km-input-num" type="number" data-key="bridgePort" value="${s.bridgePort}" min="1024" max="65535">
              <km-button id="btn-check-port" variant="secondary" size="sm" title="Scan ports 40001–40010 for a running bridge plugin">Check</km-button>
            </div>
            <div id="bridge-port-status" class="setting-hint" style="margin-top:6px;line-height:1.45;"></div>
          `)}
          ${this._row('Auto-connect on project open', 'Automatically connect to the bridge when a project loads.', `
            ${this._toggle('bridgeAutoConnect', s.bridgeAutoConnect)}
          `)}
        </div>
      </div>
    `;
  }

  _renderExports() {
    const s = this._settings;
    return `
      <div class="section">
        <div class="section-title">Exports</div>
        <div class="section-desc">Default settings for Gerber, PDF, BOM, and other export formats.</div>

        <div class="group">
          <div class="group-title">Output</div>
          ${this._row('Default output directory', 'Root directory for all exported files. Leave empty to use project directory.', `
            <div class="path-row">
              <input class="km-input" type="text" data-key="outputDir" placeholder="<project>/exports" value="${esc(s.outputDir)}">
            </div>
          `, true)}
        </div>

        <div class="group">
          <div class="group-title">Gerber</div>
          ${this._row('Coordinate precision', 'Number of decimal places in Gerber files (4–6).', `
            <select class="km-select" data-key="gerberPrecision" style="min-width:80px;">
              <option value="4" ${s.gerberPrecision == 4 ? 'selected' : ''}>4</option>
              <option value="5" ${s.gerberPrecision == 5 ? 'selected' : ''}>5</option>
              <option value="6" ${s.gerberPrecision == 6 ? 'selected' : ''}>6 (default)</option>
            </select>
          `)}
          ${this._row('Use Gerber X2 attributes', 'Adds extended attributes for CAM systems that support the X2 standard.', `
            ${this._toggle('gerberX2', s.gerberX2)}
          `)}
          ${this._row('Include netlist attributes', 'Embed net names in Gerber X2 output.', `
            ${this._toggle('gerberNetlist', s.gerberNetlist)}
          `)}
        </div>

        <div class="group">
          <div class="group-title">BOM</div>
          ${this._row('Default fields', 'Comma-separated list of component fields to include in BOM exports.', `
            <div class="path-row">
              <input class="km-input" type="text" data-key="bomFields" value="${esc(s.bomFields)}" placeholder="Reference,Value,Footprint,Quantity">
            </div>
          `, true)}
        </div>

        <div class="group">
          <div class="group-title">PDF / SVG</div>
          ${this._row('Paper size', 'Default paper size for PDF exports.', `
            <select class="km-select" data-key="pdfPageSize">
              <option value="A4"     ${s.pdfPageSize === 'A4'     ? 'selected' : ''}>A4</option>
              <option value="A3"     ${s.pdfPageSize === 'A3'     ? 'selected' : ''}>A3</option>
              <option value="Letter" ${s.pdfPageSize === 'Letter' ? 'selected' : ''}>Letter</option>
              <option value="Legal"  ${s.pdfPageSize === 'Legal'  ? 'selected' : ''}>Legal</option>
            </select>
          `)}
        </div>
      </div>
    `;
  }

  _renderAppearance() {
    const s = this._settings;
    const swatches = Object.entries(ACCENT_PRESETS).map(([id, p]) => `
      <div class="swatch${s.accentPreset === id ? ' active' : ''}"
           data-accent="${id}"
           style="background:${p.value};"
           title="${p.label}"></div>
    `).join('');

    return `
      <div class="section">
        <div class="section-title">Appearance</div>
        <div class="section-desc">Customize how KiMaster looks and feels.</div>

        <!-- Theme -->
        <div class="group">
          <div class="group-title">Theme</div>
          ${this._row('High-contrast dark theme',
            'Use OLED-black (#000) background — maximises contrast on dark displays.',
            this._toggle('hiContrastDark', s.hiContrastDark)
          )}
          ${this._row('Color scheme',
            'Switch between dark and light mode.',
            `<div class="pill-group">
              ${this._pill('colorScheme', [
                { val: 'dark',  label: 'Dark'  },
                { val: 'light', label: 'Light' },
              ], s.colorScheme ?? 'dark')}
            </div>`
          )}
        </div>

        <!-- Accent color -->
        <div class="group">
          <div class="group-title">Accent Color</div>
          ${this._row('Brand color',
            'Applied to buttons, focus rings, active indicators, and live telemetry highlights.',
            `<div class="swatches">${swatches}</div>`,
            true
          )}
          <div class="row">
            <div class="row__info">
              <div class="row__label">Current token</div>
              <div class="row__sub">
                <code style="font-family:var(--km-font-mono);font-size:10px;color:var(--km-accent);">
                  --km-accent: ${ACCENT_PRESETS[s.accentPreset]?.value ?? '#2563EB'}
                </code>
              </div>
            </div>
            <div class="row__ctrl">
              <div style="width:52px;height:24px;border-radius:var(--km-radius-sm);background:var(--km-accent);box-shadow:var(--km-accent-glow,none);"></div>
            </div>
          </div>
        </div>

        <!-- Typography -->
        <div class="group">
          <div class="group-title">Typography</div>
          ${this._row('Interface font',
            'Font used throughout menus, labels, and the sidebar.',
            `<div class="pill-group">
              ${this._pill('interfaceFont', [
                { val: 'geist',  label: 'Geist'  },
                { val: 'inter',  label: 'Inter'  },
                { val: 'system', label: 'System' },
              ], s.interfaceFont ?? 'geist')}
            </div>`
          )}
          ${this._row('Interface scale',
            'Base font size for all UI elements.',
            `<div class="pill-group">
              ${this._pill('interfaceScale', [
                { val: 'small',   label: 'Small'  },
                { val: 'default', label: 'Medium' },
                { val: 'large',   label: 'Large'  },
              ], s.interfaceScale ?? 'default')}
            </div>`
          )}
          ${this._row('Tabular numerics',
            'Use fixed-width digits for coordinates, metrics, and measurements.',
            this._toggle('tabularNums', s.tabularNums ?? true)
          )}
        </div>

        <!-- Layout density -->
        <div class="group">
          <div class="group-title">Layout</div>
          ${this._row('Content density',
            'Controls spacing between rows, cells, and panels.',
            `<div class="pill-group">
              ${this._pill('contentDensity', [
                { val: 'compact',     label: 'Compact'     },
                { val: 'default',     label: 'Default'     },
                { val: 'comfortable', label: 'Comfortable' },
              ], s.contentDensity ?? 'default')}
            </div>`
          )}
        </div>

        <!-- Advanced -->
        <div class="group">
          <div class="group-title">Developer</div>
          ${this._row('Debug logging',
            'Print verbose IPC, bridge, and state logs to the console.',
            this._toggle('debugLogging', s.debugLogging)
          )}
        </div>
      </div>
    `;
  }

  _renderShortcuts() {
    return `
      <div class="section">
        <div class="section-title">Keyboard Shortcuts</div>
        <div class="section-desc">Global shortcuts available anywhere in KiMaster. Custom keybindings coming in Phase 6.</div>

        <div class="group">
          <div class="group-title">Navigation</div>
          ${SHORTCUTS.map(s => `
            <div class="shortcut-row">
              <span>${s.action}</span>
              <div class="keys">${s.keys.map(k => `<span class="key">${k}</span>`).join('')}</div>
            </div>
          `).join('')}
        </div>

        <div class="group">
          <div class="group-title">KiCad Bridge</div>
          ${[
            { keys: ['Ctrl', 'Shift', 'H'], action: 'Clear KiCad highlights' },
            { keys: ['Ctrl', 'Shift', 'B'], action: 'Request board state refresh' },
          ].map(s => `
            <div class="shortcut-row">
              <span>${s.action}</span>
              <div class="keys">${s.keys.map(k => `<span class="key">${k}</span>`).join('')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderAbout() {
    const version = store.appVersion || '0.1.0';
    const kicadVer = store.bridgeKicadVersion || (store.kicadCliPath ? 'Detected' : 'Not connected');
    return `
      <div class="section">
        <div class="about-logo">
          <svg viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="152" y1="144" x2="872" y2="144" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="152" y1="880" x2="872" y2="880" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="152" y1="144" x2="152" y2="880" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="872" y1="144" x2="872" y2="880" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="336" y1="342" x2="336" y2="706" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="696" y1="342" x2="696" y2="706" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="336" y1="342" x2="512" y2="524" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <line x1="696" y1="342" x2="512" y2="524" stroke="url(#km-g)" stroke-width="76" stroke-linecap="round"/>
            <defs>
              <linearGradient id="km-g" x1="152" y1="144" x2="872" y2="880" gradientUnits="userSpaceOnUse">
                <stop stop-color="#FFF099"/>
                <stop offset="1" stop-color="#D4AF37"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div class="about-version">KiMaster ${version}</div>
        <div class="about-sub">Advanced KiCad Companion — local-first, no cloud.</div>
        <div class="about-links">
          <a class="about-link" href="https://github.com/way2pramil/KiMaster" target="_blank">GitHub</a>
          <a class="about-link" href="https://github.com/way2pramil/KiMaster/releases" target="_blank">Changelog</a>
          <a class="about-link" href="https://github.com/sponsors/way2pramil" target="_blank">Sponsor ♥</a>
          <a class="about-link" href="https://buymeacoffee.com/pramil" target="_blank">Buy Me a Coffee</a>
          <a class="about-link" href="https://github.com/way2pramil/KiMaster/blob/master/LICENSE" target="_blank">License (Apache 2.0)</a>
        </div>

        <div class="group" style="margin-top:var(--km-space-6);">
          <div class="group-title">System Info</div>
          ${this._row('App version',   '', `<span class="status-mono">${version}</span>`)}
          ${this._row('KiCad',         '', `<span class="status-mono">${kicadVer}</span>`)}
          ${this._row('Bridge status', '', `<span class="${store.bridgeConnected ? 'status-ok' : 'status-mono'}">${store.bridgeConnected ? '● Connected' : '○ Offline'}</span>`)}
          ${this._row('Platform',      '', `<span class="status-mono">${navigator.platform}</span>`)}
        </div>

        <div class="group">
          <div class="group-title">Data</div>
          ${this._row('Settings location', '', `<span class="status-mono">localStorage</span>`)}
          ${this._row('Reset all settings', 'Restore all settings to their defaults.', `
            <km-button variant="danger" size="sm" id="btn-reset-settings">Reset</km-button>
          `)}
        </div>
      </div>
    `;
  }

  // ── Primitives ────────────────────────────────────────────────────────────

  _row(label, sub, ctrl, topAlign = false) {
    return `
      <div class="row${topAlign ? ' row--top' : ''}">
        <div class="row__info">
          <div class="row__label">${label}</div>
          ${sub ? `<div class="row__sub">${sub}</div>` : ''}
        </div>
        <div class="row__ctrl">${ctrl}</div>
      </div>
    `;
  }

  _toggle(key, checked) {
    return `
      <label class="toggle">
        <input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}>
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
      </label>
    `;
  }

  /** Render pills inside an already-open .pill-group wrapper */
  _pill(key, options, currentVal) {
    return options.map(({ val, label }) => `
      <div class="pill${currentVal === val ? ' active' : ''}"
           data-pill-key="${key}" data-pill-val="${val}">${label}</div>
    `).join('');
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  _attachHandlers() {
    const root = this.shadowRoot;

    // Toggles
    for (const el of root.querySelectorAll('input[type="checkbox"][data-key]')) {
      el.addEventListener('change', () => {
        this._settings[el.dataset.key] = el.checked;
        this._save(el.dataset.key, el.checked);
      });
    }

    // Text / number inputs (debounced)
    for (const el of root.querySelectorAll('input[data-key]:not([type="checkbox"])')) {
      el.addEventListener('input', () => {
        clearTimeout(el._saveTimer);
        el._saveTimer = setTimeout(() => {
          const val = el.type === 'number' ? Number(el.value) : el.value;
          this._settings[el.dataset.key] = val;
          this._save(el.dataset.key, val);
        }, 400);
      });
    }

    // Selects
    for (const el of root.querySelectorAll('select[data-key]')) {
      el.addEventListener('change', () => {
        this._settings[el.dataset.key] = el.value;
        this._save(el.dataset.key, el.value);
      });
    }

    // Accent swatches
    for (const el of root.querySelectorAll('[data-accent]')) {
      el.addEventListener('click', () => {
        const id = el.dataset.accent;
        this._settings.accentPreset = id;
        this._applyAccent(id);
        saveSettings(this._settings);
        this._renderContent('appearance');
      });
    }

    // Pill selectors — instant live update, no re-render needed
    for (const el of root.querySelectorAll('.pill[data-pill-key]')) {
      el.addEventListener('click', () => {
        const key = el.dataset.pillKey;
        const val = el.dataset.pillVal;
        this._settings[key] = val;
        this._save(key, val);
        // Toggle active within the same pill-group
        el.closest('.pill-group')?.querySelectorAll('.pill').forEach(p => {
          p.classList.toggle('active', p === el);
        });
      });
    }

    // (Bridge page is opened from this tab via the standard #/bridge hash link
    //  — the global hash router picks it up automatically.)

    // Change global vault directory
    root.getElementById('btn-change-vault-dir')?.addEventListener('km-click', async () => {
      try {
        const r = await invoke(SET_VAULT_DIR, {});
        this._globalVaultDir = r.global_vault || '';
        const input = root.getElementById('vault-global-input');
        if (input) input.value = this._globalVaultDir;
        this.dispatchEvent(new CustomEvent('km-notify', {
          bubbles: true, composed: true,
          detail: { type: 'success', title: 'Global Vault', message: `Set to: ${this._globalVaultDir}` },
        }));
      } catch (err) {
        if (String(err).includes('No folder selected')) return;
        Logger.error('Settings', 'setVaultDir failed', err);
        this.dispatchEvent(new CustomEvent('km-notify', {
          bubbles: true, composed: true,
          detail: { type: 'error', title: 'Vault Error', message: String(err) },
        }));
      }
    });

    // Reset settings
    root.getElementById('btn-reset-settings')?.addEventListener('km-click', () => {
      if (confirm('Reset all settings to defaults?')) {
        this._settings = { ...DEFAULTS };
        saveSettings(this._settings);
        this._renderContent(this._activeId);
      }
    });

    // Bridge: scan 40001–40010 for a live plugin, show which port (if any) the user's chosen port is on
    root.getElementById('btn-check-port')?.addEventListener('km-click', () => this._checkBridgePort());
  }

  async _checkBridgePort() {
    const root = this.shadowRoot;
    const statusEl = root.getElementById('bridge-port-status');
    if (!statusEl) return;
    statusEl.textContent = 'Scanning 40001–40010…';
    statusEl.dataset.state = 'pending';
    try {
      const instances = await invokeNow(SCAN_KICAD_INSTANCES);
      const target = this._settings.bridgePort;
      const onTarget = instances.find(i => i.port === target);
      if (instances.length === 0) {
        statusEl.textContent = `No plugin is listening. Port ${target} is free. Open KiCad and activate Tools → External Plugins → KiMaster Bridge.`;
        statusEl.dataset.state = 'free';
      } else if (onTarget) {
        statusEl.textContent = `Port ${target} is in use by ${onTarget.app || 'a KiCad bridge plugin'} (KiCad ${onTarget.kicad_version || '?'}). Auto-connect will succeed.`;
        statusEl.dataset.state = 'in-use';
      } else {
        const ports = instances.map(i => i.port).join(', ');
        statusEl.textContent = `Port ${target} is free, but the plugin is running on: ${ports}. Update the port above or stop the other instance.`;
        statusEl.dataset.state = 'mismatch';
      }
    } catch (err) {
      Logger.error('Settings', err, 'Bridge port scan failed');
      statusEl.textContent = `Scan failed: ${String(err)}`;
      statusEl.dataset.state = 'error';
    }
  }

  _save(key, value) {
    // Mirror the change into the panel's own _settings object FIRST so the
    // subsequent persist call writes the *new* value to localStorage. Then
    // apply the side-effect to the runtime store / DOM tokens. (Previous
    // order called saveSettings before _settings was updated, so toggles
    // never persisted across reloads — main.js would hydrate the stale
    // value on next boot and re-start auto-connect against the user's wish.)
    this._settings[key] = value;
    saveSettings(this._settings);
    const root = document.documentElement;

    switch (key) {
      case 'colorScheme':
        store.theme = value;
        break;

      case 'hiContrastDark': {
        this._applyHiContrastInline(value);
        break;
      }

      case 'interfaceFont': {
        const fonts = {
          geist:  "'Geist', 'Inter', system-ui, sans-serif",
          inter:  "'Inter', system-ui, sans-serif",
          system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        };
        root.style.setProperty('--km-font', fonts[value] || fonts.geist);
        break;
      }

      case 'interfaceScale': {
        // Calibrated against modern desktop apps (2024-2026):
        //   Linear       13px base · Vercel 14px · GitHub 14px · Notion 16px · Arc 14px
        //   Apple HIG    13px min · Microsoft Fluent 2  14px base
        // Each step is +1px on body, +1px on small captions, +2px on display sizes.
        const scaleMap = {
          small:   { '2xs': '10px', xs: '11px', sm: '12px', base: '13px', md: '14px', lg: '16px', xl: '18px' },
          default: { '2xs': '11px', xs: '12px', sm: '13px', base: '14px', md: '15px', lg: '17px', xl: '20px' },
          large:   { '2xs': '12px', xs: '13px', sm: '14px', base: '15px', md: '16px', lg: '19px', xl: '22px' },
        };
        const s = scaleMap[value] || scaleMap.default;
        root.style.setProperty('--km-font-size-2xs',  s['2xs']);
        root.style.setProperty('--km-font-size-xs',   s.xs);
        root.style.setProperty('--km-font-size-sm',   s.sm);
        root.style.setProperty('--km-font-size-base', s.base);
        root.style.setProperty('--km-font-size-md',   s.md);
        root.style.setProperty('--km-font-size-lg',   s.lg);
        root.style.setProperty('--km-font-size-xl',   s.xl);
        break;
      }

      case 'contentDensity': {
        // Bridge: keep the legacy CSS-var path for the bento grid AND drive
        // the canonical [data-density] attribute via store.density so the
        // global D chord (cycleDensity) and tokens.css see one source of truth.
        const gaps  = { compact: '8px',  default: '12px', comfortable: '16px' };
        const space = { compact: '3px',  default: '4px',  comfortable: '6px'  };
        root.style.setProperty('--km-bento-gap',  gaps[value]  || '12px');
        root.style.setProperty('--km-space-3',    space[value] || '4px');
        const mapped = value === 'default' ? 'cozy' : value;
        if (store.density !== mapped) store.density = mapped;
        break;
      }

      case 'debugLogging':
        console.info('[Settings] Debug logging:', value);
        break;

      case 'bridgePort':
        store.bridgePort = value;
        break;

      case 'bridgeAutoConnect':
        store.bridgeAutoConnect = value;
        break;
    }
  }

  _applyAccent(id) {
    const p = ACCENT_PRESETS[id];
    if (!p) return;
    const root = document.documentElement;
    root.style.setProperty('--km-accent',        p.value);
    root.style.setProperty('--km-accent-hover',  p.hover);
    root.style.setProperty('--km-accent-active', p.active);
    root.style.setProperty('--km-accent-muted',  p.muted);
    root.style.setProperty('--km-accent-border', p.border);
    root.style.setProperty('--km-accent-glow',   p.glow);
  }

  /** Fire a km-notify custom event (picked up by main.js notify()). */
  _notify(type, title, message) {
    this.dispatchEvent(new CustomEvent('km-notify', {
      bubbles: true, composed: true,
      detail: { type, title, message },
    }));
  }
}

customElements.define('km-settings-panel', SettingsPanel);

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
