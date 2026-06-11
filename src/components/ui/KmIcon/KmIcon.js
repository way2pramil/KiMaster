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

// Lucide icons — paths vendored at build time by unplugin-icons (vite.config.js).
// Importing with `?raw` triggers the lucideTransform, which strips the <svg>
// wrapper and normalizes stroke-width to 1.5. All these icons keep their
// natural 24×24 viewBox — see VIEWBOX below.
import LucideX              from '~icons/lucide/x?raw';
import LucideArrowRight     from '~icons/lucide/arrow-right?raw';
import LucideArrowLeft      from '~icons/lucide/arrow-left?raw';
import LucidePlus           from '~icons/lucide/plus?raw';
import LucideGrid3x3        from '~icons/lucide/grid-3x3?raw';
import LucideMoon           from '~icons/lucide/moon?raw';
import LucideSun            from '~icons/lucide/sun?raw';
import LucideKeyboard       from '~icons/lucide/keyboard?raw';
import LucideMoreHorizontal from '~icons/lucide/more-horizontal?raw';
import LucideChevronUp      from '~icons/lucide/chevron-up?raw';
import LucideEye            from '~icons/lucide/eye?raw';
import LucideEyeOff         from '~icons/lucide/eye-off?raw';
import LucidePanelLeft      from '~icons/lucide/panel-left?raw';
import LucidePanelRight     from '~icons/lucide/panel-right?raw';
import LucideMaximize2      from '~icons/lucide/maximize-2?raw';
import LucideMinimize2      from '~icons/lucide/minimize-2?raw';
import LucideTerminal       from '~icons/lucide/terminal?raw';
import LucidePlugZap        from '~icons/lucide/plug-zap?raw';
import LucideUnplug         from '~icons/lucide/unplug?raw';

/** Lucide-sourced registry. All entries are 24×24 viewBox. */
const LUCIDE = {
  'x':               LucideX,
  'arrow-right':     LucideArrowRight,
  'arrow-left':      LucideArrowLeft,
  'plus':            LucidePlus,
  'grid':            LucideGrid3x3,
  'moon':            LucideMoon,
  'sun':             LucideSun,
  'keyboard':        LucideKeyboard,
  'more-horizontal': LucideMoreHorizontal,
  'chevron-up':      LucideChevronUp,
  'eye':             LucideEye,
  'eye-off':         LucideEyeOff,
  'panel-left':      LucidePanelLeft,
  'panel-right':     LucidePanelRight,
  'maximize':        LucideMaximize2,
  'minimize':        LucideMinimize2,
  'terminal':        LucideTerminal,
  'plug-zap':        LucidePlugZap,
  'unplug':          LucideUnplug,
};

/** Hand-rolled KiCad-domain icons. All 16×16 viewBox. */
const HANDMADE = {
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
  // Lucide `settings` (gear) — 24×24 viewBox, weight matched to the rest of the set
  'settings':      `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  // Lucide `file-sliders` (24×24)
  'file-sliders':  `<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M14 2v5a1 1 0 0 0 1 1h5M8 12h8M10 11v2M8 17h8M14 16v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Lucide `expand` (24×24)
  'expand':        `<path d="m15 15 6 6M15 9l6-6M21 16v5h-5M21 8V3h-5M3 16v5h5M3 8V3h5M9 9 3 3M3 21l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Lucide `download` (24×24)
  'download':      `<path d="M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Lucide `flip-horizontal-2` (24×24)
  'flip-horizontal-2': `<path d="m3 7 5 5-5 5V7M21 7l-5 5 5 5V7M12 20v2M12 14v2M12 8v2M12 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Lucide `frame` (24×24)
  'frame':         `<line x1="22" x2="2" y1="6" y2="6"/><line x1="22" x2="2" y1="18" y2="18"/><line x1="6" x2="6" y1="2" y2="22"/><line x1="18" x2="18" y1="2" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Lucide `grid-2x2` (24×24)
  'grid-2x2':      `<path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>`,
  // Lucide `grip` (24×24)
  'grip':          `<circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="19" cy="5" r="1" fill="currentColor"/><circle cx="5" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/><circle cx="19" cy="19" r="1" fill="currentColor"/><circle cx="5" cy="19" r="1" fill="currentColor"/>`,
  // Lucide `grip-vertical` (24×24)
  'grip-vertical': `<circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>`,
  // Lucide `handshake` (24×24)
  'handshake':     `<path d="m11 17 2 2a1 1 0 1 0 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="m21 3 1 11h-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M3 4h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Lucide `pen-line` (24×24)
  'pen-line':      `<path d="M13 21h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
 
 'plug':          `<path d="M5 2v4M11 2v4M3 6h10v2a4 4 0 0 1-4 4v2H7v-2A4 4 0 0 1 3 8V6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,  // Lucide `cable` (24×24)
  'cable':         `<path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 21v-2M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10M21 21v-2M3 5V3M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2zM7 5V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,  // Lucide `cpu` (24×24)
  'cpu':           `<path d="M12 20v2M12 2v2M17 20v2M17 2v2M2 12h2M2 17h2M2 7h2M20 12h2M20 17h2M20 7h2M7 20v2M7 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="8" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>`,
  'search':        `<circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'info':          `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'warning':       `<path d="M8 2L14 13H2L8 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'error':         `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'success':       `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2.5 2.5L11 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'loader':        `<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="14 22" stroke-linecap="round"/>`,
  // Lucide `external-link` (24×24)
  'external-link': `<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'collapse':      `<path d="M12 9l-4-4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'history':       `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 4l2 2-2 2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`,
  'notes':         `<path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 8h4M6 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  'vault':         `<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v1.5M8 10.5V12M4 8h1.5M10.5 8H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  'render':        `<path d="M2 5l6-3 6 3v6l-6 3-6-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 5l6 3 6-3M8 8v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'task':          `<path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l1.5 1.5L10 5M6 9.5h4M6 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Lucide-inspired additions (16×16 adapted)
  'trash':         `<path d="M3 4h10M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M4 4v8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'refresh':       `<path d="M2.5 8a5.5 5.5 0 0 1 9.7-3.5M13.5 8a5.5 5.5 0 0 1-9.7 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12.2 2v2.5H14.5M3.8 14v-2.5H1.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Lucide `circle-arrow-left` (24×24) — used as the "refresh board state" icon
  'rotate-ccw':    `<circle cx="12" cy="12" r="10"/><path d="m12 8-4 4 4 4"/><path d="M16 12H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'file':          `<path d="M4 2h5l4 4v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 2v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  // Lucide `folder-open` (24×24)
  'folder-open':   `<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'folder-tree':   `<path d="M2 4h3v3H2zM7 3h3v3H7zM7 8h3v3H7zM7 13h2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5h2M5 5.5v4M5 9.5h2M5 9.5v4h2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  // Lucide `play` (24×24)
  'play':          `<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  'power':         `<path d="M8 2v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 4.5a5.5 5.5 0 1 0 7 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  'zap':           `<path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  'box':           `<path d="M2 5l6-3 6 3v6l-6 3-6-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 5l6 3 6-3M8 8v6" stroke="currentColor" stroke-width="1.2" fill="none"/>`,
  'layout-grid':   `<rect x="2" y="2" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  'clock':         `<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'arrow-up-right':`<path d="M5 11L12 4M12 4H7M12 4v5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'database':      `<ellipse cx="8" cy="4" rx="5.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`,
  'monitor':       `<rect x="2" y="2" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 13h6M8 10v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
};

/** Final registry — handwritten KiCad icons + Lucide-vendored paths. */
const ICONS = { ...HANDMADE, ...LUCIDE };

const SIZES = { sm: 14, md: 16, lg: 20, xl: 24, '2xl': 32 };

/** Names whose natural viewBox is 24×24 (i.e. Lucide-sourced). Hand-rolled default is 16×16. */
const VIEWBOX_24 = new Set([
  'settings', 'file-sliders', 'expand', 'external-link', 'download',
  'cpu', 'flip-horizontal-2', 'frame', 'folder-open', 'grid-2x2',
  'grip', 'grip-vertical', 'handshake', 'pen-line', 'play', 'cable',
  'rotate-ccw',
  ...Object.keys(LUCIDE),
]);

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
    svg.setAttribute('viewBox', VIEWBOX_24.has(name) ? '0 0 24 24' : '0 0 16 16');
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
