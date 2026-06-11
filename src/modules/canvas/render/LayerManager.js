/**
 * LayerManager — KiCad layer colors, ordering, and visibility.
 *
 * Colors match KiCad's default dark theme palette.
 * Layer render order: B.Cu → B.* → F.Cu → F.* → F.Courtyard on top.
 *
 * @module LayerManager
 */

/** KiCad layer ID → hex color (KiCad dark-theme defaults). */
export const LAYER_COLORS = {
  'F.Cu':        0xb73333,
  'B.Cu':        0x4466bb,
  'In1.Cu':      0xddaa00,
  'In2.Cu':      0x33aa33,
  'In3.Cu':      0xaa33aa,
  'In4.Cu':      0x33aaaa,
  'F.SilkS':     0x66aacc,
  'B.SilkS':     0x338888,
  'F.Mask':      0xcc4444,
  'B.Mask':      0x664444,
  'F.Paste':     0x888888,
  'B.Paste':     0x555566,
  'F.Courtyard': 0xdddddd,
  'B.Courtyard': 0x888899,
  'F.Fab':       0x888888,
  'B.Fab':       0x555555,
  'Edge.Cuts':   0xeeee00,
  'Eco1.User':      0x558855,
  'Eco2.User':      0x885555,
  'Cmts.User':      0x0000aa,
  'User.Comments':  0x0000aa,
  'User.Eco1':      0x558855,
  'User.Eco2':      0x885555,
};

/** Render order — back layers first, front layers last (front drawn on top). */
export const LAYER_ORDER = [
  'B.Fab', 'B.Cu', 'B.Mask', 'B.Paste', 'B.SilkS', 'B.Courtyard',
  'In4.Cu', 'In3.Cu', 'In2.Cu', 'In1.Cu',
  'Edge.Cuts',
  'F.Fab', 'F.Cu', 'F.Mask', 'F.Paste', 'F.SilkS', 'F.Courtyard',
  'Eco1.User', 'Eco2.User', 'Cmts.User',
  'User.Comments', 'User.Eco1', 'User.Eco2',
];

/** Layers that are selectable (pads, pins live here). */
export const INTERACTIVE_LAYERS = new Set(['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu']);

/**
 * Return the hex color for a layer, defaulting to grey for unknown layers.
 * @param {string} layer
 * @returns {number}
 */
export function layerColor(layer) {
  return LAYER_COLORS[layer] ?? 0x666666;
}

/**
 * Sort layer names by render order (back-to-front).
 * Unknown layers are appended at the end.
 * @param {string[]} layers
 * @returns {string[]}
 */
export function sortLayers(layers) {
  const idx = (l) => {
    const i = LAYER_ORDER.indexOf(l);
    return i === -1 ? 999 : i;
  };
  return [...layers].sort((a, b) => idx(a) - idx(b));
}
