/**
 * @element km-sidebar
 * @summary Linear-style sidebar — OLED black, clean nav, accent left-bar active.
 *
 * @attr {boolean} collapsed
 * @fires km-nav — detail: { route, id }
 */

import { AnimationKit } from '../../../design/animations/index.js';

const NAV_ITEMS = [
  { id: 'dashboard',  label: 'Dashboard',   icon: 'cpu',       route: '/' },
  { id: 'drc',        label: 'DRC / ERC',   icon: 'drc',       route: '/drc' },
  { id: 'schematic',  label: 'Schematic',   icon: 'schematic', route: '/schematic' },
  { id: 'pcb',        label: 'PCB Layout',  icon: 'pcb',       route: '/pcb' },
  { id: 'bom',        label: 'BOM',         icon: 'bom',       route: '/bom' },
  { id: 'export',     label: 'Export',      icon: 'gerber',    route: '/export' },
  { id: 'components', label: 'Components',  icon: 'component', route: '/components' },
  { id: 'history',    label: 'History',     icon: 'history',   route: '/history' },
  { id: 'notes',      label: 'Notes',       icon: 'notes',     route: '/notes' },
  { id: 'vault',      label: 'Vault',       icon: 'vault',     route: '/vault' },
  { id: 'render',     label: '3D Render',   icon: 'render',    route: '/render' },
];

const BOTTOM_ITEMS = [
  { id: 'bridge',   label: 'KiCad Bridge', icon: 'plug',     route: '/bridge' },
  { id: 'settings', label: 'Settings',     icon: 'settings', route: '/settings' },
];

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    width: var(--km-sidebar-width);
    height: 100vh;
    background: var(--km-sidebar-bg);
    border-right: 1px solid var(--km-border);
    flex-shrink: 0;
    overflow: hidden;
    transition: width var(--km-duration-slow) var(--km-ease);
    position: relative;
    z-index: var(--km-z-overlay);
  }
  :host([collapsed]) { width: var(--km-sidebar-collapsed); }

  /* ── Brand ── */
  .brand {
    display: flex;
    align-items: center;
    gap: var(--km-space-2-5);
    padding: 0 var(--km-space-3);
    height: var(--km-header-height);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    overflow: hidden;
  }
  .brand-logo {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: var(--km-radius-sm);
    background: var(--km-accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .brand-logo svg { width: 12px; height: 12px; }
  .brand-name {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    white-space: nowrap;
    letter-spacing: -0.01em;
    opacity: 1;
    transition: opacity var(--km-duration-base) var(--km-ease);
    flex: 1;
  }
  :host([collapsed]) .brand-name { opacity: 0; }

  /* ── Collapse ── */
  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--km-radius-xs);
    color: var(--km-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--km-duration-fast), background var(--km-duration-fast);
  }
  .collapse-btn:hover { background: var(--km-bg-elevated); color: var(--km-text-secondary); }
  .collapse-icon {
    width: 12px;
    height: 12px;
    transition: transform var(--km-duration-slow) var(--km-ease);
  }
  :host([collapsed]) .collapse-icon { transform: rotate(180deg); }

  /* ── Project pill ── */
  .project-pill {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    margin: var(--km-space-2) var(--km-space-2);
    padding: var(--km-space-1-5) var(--km-space-2-5);
    border-radius: var(--km-radius-sm);
    background: var(--km-bg-surface);
    border: 1px solid var(--km-border);
    box-shadow: var(--km-bezel);
    cursor: pointer;
    overflow: hidden;
    min-height: 28px;
    transition: background var(--km-duration-fast), border-color var(--km-duration-fast);
  }
  .project-pill:hover { background: var(--km-bg-elevated); }
  .project-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--km-text-muted);
    flex-shrink: 0;
    transition: background var(--km-duration-base), box-shadow var(--km-duration-base);
  }
  .project-dot.active {
    background: var(--km-live);
    box-shadow: 0 0 5px var(--km-live);
  }
  .project-name {
    font-size: var(--km-font-size-xs);
    color: var(--km-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    opacity: 1;
    transition: opacity var(--km-duration-fast);
  }
  :host([collapsed]) .project-name { opacity: 0; }

  /* ── Nav ── */
  nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--km-space-1) var(--km-space-1-5);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  nav:hover { scrollbar-color: var(--km-scrollbar-thumb) transparent; }

  .nav-section {
    font-size: 9px;
    font-weight: var(--km-font-weight-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--km-text-muted);
    padding: var(--km-space-2) var(--km-space-2-5) var(--km-space-1);
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    transition: opacity var(--km-duration-fast), height var(--km-duration-fast);
  }
  :host([collapsed]) .nav-section { opacity: 0; height: 0; padding: 0; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-1-5) var(--km-space-2-5);
    padding-left: var(--km-space-2);  /* room for left bar */
    border-radius: var(--km-radius-sm);
    cursor: pointer;
    color: var(--km-text-secondary);
    font-size: var(--km-font-size-xs);
    font-weight: var(--km-font-weight-medium);
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
    position: relative;
    min-height: 30px;
    border-left: 2px solid transparent;
    transition:
      background    var(--km-duration-fast) var(--km-ease),
      color         var(--km-duration-fast) var(--km-ease),
      border-color  var(--km-duration-fast) var(--km-ease);
  }
  .nav-item:hover {
    background: var(--km-sidebar-hover);
    color: var(--km-text-primary);
  }
  .nav-item.active {
    background: var(--km-sidebar-active);
    color: var(--km-accent-hover);
    border-left-color: var(--km-accent);
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .nav-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 1;
    transition: opacity var(--km-duration-base) var(--km-ease);
  }
  :host([collapsed]) .nav-label { opacity: 0; }

  .nav-badge { flex-shrink: 0; transition: opacity var(--km-duration-fast); }
  :host([collapsed]) .nav-badge { opacity: 0; }

  /* ── Divider ── */
  .divider { height: 1px; background: var(--km-border); margin: var(--km-space-1) var(--km-space-2-5); flex-shrink: 0; }

  /* ── Bottom ── */
  .bottom {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--km-space-1-5);
    border-top: 1px solid var(--km-border);
    flex-shrink: 0;
  }
</style>

<div class="brand">
  <div class="brand-logo">
    <svg viewBox="0 0 12 12" fill="none">
      <path d="M2 10L6 2l4 8" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.5 7h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  </div>
  <span class="brand-name">KiMaster</span>
  <button class="collapse-btn" id="collapse-btn" aria-label="Toggle sidebar">
    <svg class="collapse-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M8 2L4 6l4 4"/>
    </svg>
  </button>
</div>

<div class="project-pill" id="project-indicator">
  <div class="project-dot" id="project-dot"></div>
  <span class="project-name" id="project-name">No project open</span>
</div>

<nav id="main-nav" role="navigation" aria-label="Main navigation">
  <div class="nav-section">Design</div>
</nav>
<div class="divider"></div>
<div class="bottom" id="bottom-nav"></div>
`;

export class KmSidebar extends HTMLElement {
  static get observedAttributes() { return ['collapsed', 'active-route']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._nav         = this.shadowRoot.getElementById('main-nav');
    this._bottomNav   = this.shadowRoot.getElementById('bottom-nav');
    this._collapseBtn = this.shadowRoot.getElementById('collapse-btn');
    this._projectDot  = this.shadowRoot.getElementById('project-dot');
    this._projectName = this.shadowRoot.getElementById('project-name');
  }

  connectedCallback() {
    this._renderNav();
    this._collapseBtn.addEventListener('click', this._onCollapse);
    // "No project open" pill → dispatch km-open-project so main.js can call pickAndOpenProject
    this.shadowRoot.getElementById('project-indicator')
      ?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('km-open-project', { bubbles: true, composed: true }));
      });
  }

  disconnectedCallback() {
    this._collapseBtn.removeEventListener('click', this._onCollapse);
  }

  attributeChangedCallback(name) {
    if (name === 'active-route') this._updateActive();
  }

  _renderNav() {
    for (const item of NAV_ITEMS) this._nav.appendChild(this._makeNavItem(item));
    this._bottomNav.innerHTML = '';
    for (const item of BOTTOM_ITEMS) this._bottomNav.appendChild(this._makeNavItem(item));
  }

  _makeNavItem(item) {
    const el = document.createElement('div');
    el.className = 'nav-item';
    el.dataset.route = item.route;
    el.dataset.id    = item.id;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', item.label);
    el.innerHTML = `
      <span class="nav-icon"><km-icon name="${item.icon}" size="sm"></km-icon></span>
      <span class="nav-label">${item.label}</span>
      ${item.badge ? `<span class="nav-badge"><km-badge variant="danger">${item.badge}</km-badge></span>` : ''}
    `;
    el.addEventListener('click', () => {
      this._setActive(item.route);
      this.dispatchEvent(new CustomEvent('km-nav', {
        bubbles: true, composed: true,
        detail: { route: item.route, id: item.id },
      }));
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    return el;
  }

  _setActive(route) {
    for (const el of this.shadowRoot.querySelectorAll('.nav-item')) {
      el.classList.toggle('active', el.dataset.route === route);
    }
  }

  _updateActive() {
    const route = this.getAttribute('active-route');
    if (route) this._setActive(route);
  }

  _onCollapse = () => {
    const collapsed = this.hasAttribute('collapsed');
    if (collapsed) this.removeAttribute('collapsed');
    else this.setAttribute('collapsed', '');
    AnimationKit.sidebarToggle(this, !collapsed);
  };

  setProject(info) {
    this._projectName.textContent = info.name || 'No project open';
    this._projectDot.classList.toggle('active', !!info.active);
  }

  /**
   * Show or hide a violation badge on a nav item.
   * @param {string} id     — nav item data-id (e.g. 'drc')
   * @param {number} count  — 0 removes badge; > 0 shows count (capped at 99)
   */
  setBadge(id, count) {
    const el = this.shadowRoot.querySelector(`.nav-item[data-id="${id}"]`);
    if (!el) return;

    let wrap  = el.querySelector('.nav-badge');
    let badge = wrap?.querySelector('km-badge');

    if (count <= 0) {
      wrap?.remove();
      return;
    }

    if (!wrap) {
      wrap  = document.createElement('span');
      wrap.className = 'nav-badge';
      badge = document.createElement('km-badge');
      badge.setAttribute('variant', 'danger');
      wrap.appendChild(badge);
      el.appendChild(wrap);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  }
}

customElements.define('km-sidebar', KmSidebar);
