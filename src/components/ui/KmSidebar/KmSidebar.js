/**
 * @element km-sidebar
 * @summary Linear-style sidebar — OLED black, clean nav, accent left-bar active.
 *
 * @attr {boolean} collapsed
 * @fires km-nav — detail: { route, id }
 */

import { AnimationKit } from '../../../design/animations/index.js';

const DASHBOARD_ITEM = { id: 'dashboard', label: 'Dashboard', icon: 'cpu', route: '/' };

const NAV_GROUPS = [
  {
    id: 'design', label: 'Design',
    items: [
      { id: 'schematic', label: 'Schematic', icon: 'schematic', route: '/schematic' },
      { id: 'pcb',       label: 'PCB Layout', icon: 'pcb',      route: '/pcb' },
      { id: 'render',    label: '3D Render',  icon: 'render',   route: '/render',   hidden: true },
      { id: 'live3d',    label: 'Live 3D',    icon: 'render',   route: '/live3d' },
      { id: 'pcb3d',     label: 'PCB 3D ✦',   icon: 'render',   route: '/pcb3d',    hidden: true },
      { id: 'drc',         label: 'DRC / ERC',   icon: 'drc',    route: '/drc' },
      // Board Tools (Via Stitch / Teardrops / Panelize) now dock directly
      // inside the PCB Layout tab — see km-board-tools-rail in KiCanvasView.
      { id: 'stackup',          label: 'Stackup',          icon: 'layers',    route: '/stackup' },
      { id: 'footprint-editor', label: 'Footprint Editor', icon: 'pcb',       route: '/footprint-editor' },
      { id: 'graph',            label: 'Net Graph',        icon: 'net',        route: '/graph' },
    ],
  },
  {
    id: 'assets', label: 'Assets',
    items: [
      { id: 'components', label: 'Components', icon: 'component', route: '/components' },
      { id: 'vault',      label: 'Vault',       icon: 'vault',     route: '/vault' },
      { id: 'bom',        label: 'BOM',         icon: 'bom',       route: '/bom' },
      { id: 'notes',      label: 'Notes',       icon: 'notes',     route: '/notes' },
    ],
  },
  {
    id: 'production', label: 'Production',
    items: [
      { id: 'export',  label: 'Export',  icon: 'gerber',  route: '/export' },
      { id: 'history', label: 'History', icon: 'history', route: '/history' },
    ],
  },
];

const BOTTOM_ITEMS = [
  { id: 'bridge',   label: 'KiCad Bridge', icon: 'plug',     route: '/bridge' },
  { id: 'settings', label: 'Settings',     icon: 'settings', route: '/settings' },
];

const LS_KEY = 'km-sidebar-groups-collapsed';

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
    font-family: var(--km-font);
  }
  :host([collapsed]) { width: var(--km-sidebar-collapsed); }

  /* ── Brand ── */
  .brand {
    display: flex;
    align-items: center;
    gap: var(--km-space-2-5);
    padding: 0 var(--km-space-2-5);
    height: var(--km-header-height);
    border-bottom: 1px solid var(--km-border);
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
  }
  .brand-logo {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--km-accent);
    transition: color var(--km-duration-base) var(--km-ease);
  }
  .brand-logo svg { width: 22px; height: 22px; display: block; }
  .brand-name {
    font-size: var(--km-font-size-sm);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-primary);
    white-space: nowrap;
    letter-spacing: -0.01em;
    opacity: 1;
    transition: opacity var(--km-duration-base) var(--km-ease);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :host([collapsed]) .brand-name { opacity: 0; pointer-events: none; }

  /* ── Collapse ── */
  .collapse-btn {
    position: absolute;
    right: var(--km-space-2);
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--km-radius-xs);
    color: var(--km-text-muted);
    cursor: pointer;
    transition: color var(--km-duration-fast), background var(--km-duration-fast);
  }
  .collapse-btn:hover { background: var(--km-bg-elevated); color: var(--km-text-secondary); }
  .collapse-btn:focus-visible { outline: 1px solid var(--km-accent); outline-offset: 1px; }
  .collapse-icon {
    width: 12px;
    height: 12px;
    display: block;
    stroke: currentColor;
    fill: none;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--km-font-size-2xs);
    font-weight: var(--km-font-weight-semibold);
    color: var(--km-text-muted);
    padding: var(--km-space-3) var(--km-space-2-5) var(--km-space-1-5);
    margin-top: var(--km-space-1);
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    cursor: pointer;
    user-select: none;
    transition: opacity var(--km-duration-fast), height var(--km-duration-fast);
  }
  :host([collapsed]) .nav-section { opacity: 0; height: 0; padding: 0; margin-top: 0; pointer-events: none; }

  .nav-section:hover { color: var(--km-text-secondary); }

  .nav-section-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

  .nav-section-chevron {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    transition: transform var(--km-duration-fast) var(--km-ease);
    color: var(--km-text-muted);
  }
  .nav-section.collapsed .nav-section-chevron { transform: rotate(-90deg); }

  .nav-group-items {
    overflow: hidden;
    transition: max-height var(--km-duration-base) var(--km-ease);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nav-group-items.collapsed { max-height: 0 !important; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--km-space-2);
    padding: var(--km-space-1-5) var(--km-space-2-5);
    padding-left: var(--km-space-2);
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
  .nav-item:focus-visible {
    outline: 1px solid var(--km-accent);
    outline-offset: -1px;
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
    <svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- outer frame -->
      <rect x="1.5" y="1.5" width="19" height="19" rx="3.5"
            stroke="currentColor" stroke-width="1.8" fill="none"/>
      <!-- left pillar of M -->
      <line x1="6" y1="16" x2="6" y2="6"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <!-- right pillar of M -->
      <line x1="16" y1="16" x2="16" y2="6"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <!-- left diagonal (top-left → center-V) -->
      <line x1="6" y1="6" x2="11" y2="11.5"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <!-- right diagonal (top-right → center-V) -->
      <line x1="16" y1="6" x2="11" y2="11.5"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
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
    this._collapsedGroups = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
  }

  connectedCallback() {
    this._renderNav();
    this._collapseBtn.addEventListener('click', this._onCollapse);
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
    this._nav.innerHTML = '';
    this._nav.appendChild(this._makeNavItem(DASHBOARD_ITEM));

    for (const group of NAV_GROUPS) {
      const section = this._makeNavSection(group);
      if (!section.header) continue;
      this._nav.appendChild(section.header);
      this._nav.appendChild(section.items);
    }

    this._bottomNav.innerHTML = '';
    for (const item of BOTTOM_ITEMS) this._bottomNav.appendChild(this._makeNavItem(item));
  }

  _makeNavSection(group) {
    const visibleItems = group.items.filter((item) => !item.hidden);
    if (visibleItems.length === 0) return { header: null, items: null };

    const isCollapsed = this._collapsedGroups.has(group.id);

    const header = document.createElement('div');
    header.className = 'nav-section' + (isCollapsed ? ' collapsed' : '');
    header.dataset.groupId = group.id;
    header.innerHTML = `
      <span class="nav-section-label">${group.label}</span>
      <svg class="nav-section-chevron" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M2 3.5L5 6.5L8 3.5"/>
      </svg>
    `;

    const itemsWrapper = document.createElement('div');
    itemsWrapper.className = 'nav-group-items' + (isCollapsed ? ' collapsed' : '');

    for (const item of visibleItems) {
      itemsWrapper.appendChild(this._makeNavItem(item));
    }

    // Measure real height once items are attached, then animate from there.
    requestAnimationFrame(() => {
      const naturalHeight = itemsWrapper.scrollHeight;
      itemsWrapper.style.maxHeight = isCollapsed ? '0px' : `${naturalHeight}px`;
    });

    header.addEventListener('click', () => {
      const collapsed = this._collapsedGroups.has(group.id);
      if (collapsed) {
        this._collapsedGroups.delete(group.id);
        header.classList.remove('collapsed');
        itemsWrapper.classList.remove('collapsed');
        itemsWrapper.style.maxHeight = `${itemsWrapper.scrollHeight}px`;
      } else {
        this._collapsedGroups.add(group.id);
        header.classList.add('collapsed');
        itemsWrapper.classList.add('collapsed');
        itemsWrapper.style.maxHeight = '0px';
      }
      localStorage.setItem(LS_KEY, JSON.stringify([...this._collapsedGroups]));
    });

    return { header, items: itemsWrapper };
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
