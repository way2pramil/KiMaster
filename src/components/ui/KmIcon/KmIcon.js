/**
 * @element km-icon
 * @summary Animated SVG icon component with a built-in KiCad-focused icon set.
 *
 * @attr {string}  name      - icon name from the built-in registry
 * @attr {'sm'|'md'|'lg'|'xl'} size
 * @attr {'spin'|'pulse'|'bounce'|'none'} animate
 * @attr {string}  color     - CSS color value (defaults to currentColor)
 * @attr {string}  label     - accessible aria-label
 */

import { AnimationKit } from '../../../design/animations/index.js';

/** SVG path registry — all icons at 16×16 viewBox */
const ICONS = {
  // KiCad-domain icons
  'pcb':         `<path d="M2 2h12v12H2z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h2v2H5zm4 0h2v2H9zM5 9h2v2H5zm4 0h2v2H9z"/>`,
  'schematic':   `<path d="M1 8h4M11 8h4M5 4v8M11 4v8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="5" cy="8" r="1" fill="currentColor"/><circle cx="11" cy="8" r="1" fill="currentColor"/>`,
  'component':   `<rect x="4" y="4" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 6h-2M4 10h-2M12 6h2M12 10h2M6 4V2M10 4V2M6 12v2M10 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'gerber':      `<path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 9h4M6 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'drc':         `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'erc':         `<path d="M8 2L14 13H2L8 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.5M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'net':         `<circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="13" cy="4" r="1.5" fill="currentColor"/><circle cx="13" cy="12" r="1.5" fill="currentColor"/><path d="M4.5 8L11.5 4M4.5 8L11.5 12" stroke="currentColor" stroke-width="1.2"/>`,
  'layers':      `<rect x="2" y="4" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.5"/><rect x="2" y="7" width="12" height="2" rx="0.5" fill="currentColor"/><rect x="2" y="10" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.5"/>`,
  'trace':       `<path d="M2 12 Q5 2 8 8 T14 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  'via':         `<circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>`,
  'footprint':   `<rect x="3" y="6" width="10" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 6V4M8 6V4M11 6V4M5 10v2M8 10v2M11 10v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'bom':         `<path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  // UI system icons
  'chevron-down':  `<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'chevron-right': `<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'chevron-left':  `<path d="M10 4L6 8l4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'close':         `<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'check':         `<path d="M3 8l4 4 6-6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'folder':        `<path d="M2 5a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  'settings':      `<circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.34 3.34l1.06 1.06M11.6 11.6l1.06 1.06M3.34 12.66l1.06-1.06M11.6 4.4l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
  'plug':          `<path d="M5 2v4M11 2v4M3 6h10v2a4 4 0 0 1-4 4v2H7v-2A4 4 0 0 1 3 8V6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  'cpu':           `<rect x="4" y="4" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 4V2M10 4V2M6 12v2M10 12v2M4 6H2M4 10H2M12 6h2M12 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'search':        `<circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'info':          `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'warning':       `<path d="M8 2L14 13H2L8 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'error':         `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'success':       `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2.5 2.5L11 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'loader':        `<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="14 22" stroke-linecap="round"/>`,
  'external-link': `<path d="M11 3h2v2M13 3l-6 6M7 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'collapse':      `<path d="M12 9l-4-4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'history':       `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 4l2 2-2 2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`,
  'notes':         `<path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 8h4M6 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'vault':         `<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v1.5M8 10.5V12M4 8h1.5M10.5 8H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  'render':        `<path d="M2 5l6-3 6 3v6l-6 3-6-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 5l6 3 6-3M8 8v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'task':          `<path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l1.5 1.5L10 5M6 9.5h4M6 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Lucide-inspired additions (16×16 adapted)
  'trash':         `<path d="M3 4h10M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M4 4v8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'refresh':       `<path d="M2.5 8a5.5 5.5 0 0 1 9.7-3.5M13.5 8a5.5 5.5 0 0 1-9.7 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12.2 2v2.5H14.5M3.8 14v-2.5H1.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'file':          `<path d="M4 2h5l4 4v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  'folder-open':   `<path d="M2 5a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v1H6l-2 5H3a1 1 0 0 1-1-1V5z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 13l2-5h9l-2 5H4z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  'folder-tree':   `<path d="M2 4h3v3H2zM7 3h3v3H7zM7 8h3v3H7zM7 13h2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5h2M5 5.5v4M5 9.5h2M5 9.5v4h2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  'play':          `<path d="M4 3l9 5-9 5V3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  'power':         `<path d="M8 2v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 4.5a5.5 5.5 0 1 0 7 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  'zap':           `<path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  'box':           `<path d="M2 5l6-3 6 3v6l-6 3-6-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 5l6 3 6-3M8 8v6" stroke="currentColor" stroke-width="1.2" fill="none"/>`,
  'layout-grid':   `<rect x="2" y="2" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  'clock':         `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'arrow-up-right':`<path d="M5 11L12 4M12 4H7M12 4v5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'database':      `<ellipse cx="8" cy="4" rx="5.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`,
  'monitor':       `<rect x="2" y="2" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 13h6M8 10v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
};

const SIZES = { sm: 14, md: 16, lg: 20, xl: 24, '2xl': 32 };

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host { display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
  :host([hidden]) { display: none; }
  svg { display: block; flex-shrink: 0; }
</style>
`;

export class KmIcon extends HTMLElement {
  static get observedAttributes() { return ['name', 'size', 'animate', 'color', 'label']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
    this._cancelAnim = null;
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  _render() {
    this._cancelAnim?.();
    this._cancelAnim = null;

    const name   = this.getAttribute('name') || 'info';
    const size   = SIZES[this.getAttribute('size') || 'md'] || 16;
    const color  = this.getAttribute('color') || 'currentColor';
    const label  = this.getAttribute('label');
    const anim   = this.getAttribute('animate') || 'none';

    const paths  = ICONS[name] || ICONS['info'];
    const existing = this.shadowRoot.querySelector('svg');
    if (existing) existing.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width',  String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', color === 'currentColor' ? 'none' : color);
    svg.style.color = color;
    if (label) svg.setAttribute('aria-label', label);
    else svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths;
    this.shadowRoot.appendChild(svg);

    if (anim === 'spin')   this._cancelAnim = AnimationKit.spin(svg);
    if (anim === 'pulse')  AnimationKit.pulse(svg);
    if (anim === 'bounce') {
      import('motion').then(({ animate }) => {
        animate(svg, { y: [0, -3, 0] }, { duration: 0.6, repeat: Infinity, easing: 'ease-in-out' });
      }).catch(() => {});
    }
  }
}

customElements.define('km-icon', KmIcon);
