/**
 * StackupService — pure calculation module for PCB stackup analysis.
 * No DOM, no Tauri — safe to import anywhere.
 *
 * Formulas:
 *   Impedance: IPC-2141A
 *   Current:   IPC-2221B
 */

// ── Layer type constants ──────────────────────────────────────────────────────

export const LAYER_TYPES = {
  COPPER:     'copper',
  DIELECTRIC: 'dielectric',
  MASK:       'mask',
  PASTE:      'paste',
  SILK:       'silk',
};

// ── Standard presets ──────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id:                  'jlcpcb-2l',
    name:                'JLCPCB 2-Layer (1.6mm)',
    description:         'Standard JLCPCB 2-layer FR4 1.6mm, 1oz copper',
    manufacturer:        'JLCPCB',
    layer_count:         2,
    total_thickness_mm:  1.6,
    layers: [
      { layer_type: 'silk',       name: 'F.Silkscreen', thickness_mm: 0.010, material: 'Ink',        dk: 0,   copper_oz: 0    },
      { layer_type: 'mask',       name: 'F.Mask',       thickness_mm: 0.010, material: 'Solder Mask', dk: 3.5, copper_oz: 0    },
      { layer_type: 'copper',     name: 'F.Cu',         thickness_mm: 0.035, material: 'Copper',      dk: 0,   copper_oz: 1    },
      { layer_type: 'dielectric', name: 'Core',         thickness_mm: 1.510, material: 'FR4',         dk: 4.6, copper_oz: 0    },
      { layer_type: 'copper',     name: 'B.Cu',         thickness_mm: 0.035, material: 'Copper',      dk: 0,   copper_oz: 1    },
      { layer_type: 'mask',       name: 'B.Mask',       thickness_mm: 0.010, material: 'Solder Mask', dk: 3.5, copper_oz: 0    },
      { layer_type: 'silk',       name: 'B.Silkscreen', thickness_mm: 0.010, material: 'Ink',        dk: 0,   copper_oz: 0    },
    ],
  },
  {
    id:                  'jlcpcb-4l-jlc7628',
    name:                'JLCPCB 4-Layer JLC7628 (1.6mm)',
    description:         'JLCPCB 4-layer 1.6mm with JLC7628 prepreg, 1oz outer / 0.5oz inner',
    manufacturer:        'JLCPCB',
    layer_count:         4,
    total_thickness_mm:  1.6,
    layers: [
      { layer_type: 'silk',       name: 'F.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,   copper_oz: 0    },
      { layer_type: 'mask',       name: 'F.Mask',       thickness_mm: 0.010,  material: 'Solder Mask', dk: 3.5, copper_oz: 0    },
      { layer_type: 'copper',     name: 'F.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,   copper_oz: 1    },
      { layer_type: 'dielectric', name: 'Prepreg 1',    thickness_mm: 0.200,  material: 'FR4 7628',    dk: 4.6, copper_oz: 0    },
      { layer_type: 'copper',     name: 'In1.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,   copper_oz: 0.5  },
      { layer_type: 'dielectric', name: 'Core',         thickness_mm: 1.065,  material: 'FR4',         dk: 4.6, copper_oz: 0    },
      { layer_type: 'copper',     name: 'In2.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,   copper_oz: 0.5  },
      { layer_type: 'dielectric', name: 'Prepreg 2',    thickness_mm: 0.200,  material: 'FR4 7628',    dk: 4.6, copper_oz: 0    },
      { layer_type: 'copper',     name: 'B.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,   copper_oz: 1    },
      { layer_type: 'mask',       name: 'B.Mask',       thickness_mm: 0.010,  material: 'Solder Mask', dk: 3.5, copper_oz: 0    },
      { layer_type: 'silk',       name: 'B.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,   copper_oz: 0    },
    ],
  },
  {
    id:                  'jlcpcb-4l-jlc2313',
    name:                'JLCPCB 4-Layer JLC2313 (1.6mm)',
    description:         'JLCPCB 4-layer 1.6mm with JLC2313 prepreg (tighter coupling, Dk=4.05)',
    manufacturer:        'JLCPCB',
    layer_count:         4,
    total_thickness_mm:  1.6,
    layers: [
      { layer_type: 'silk',       name: 'F.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,    copper_oz: 0    },
      { layer_type: 'mask',       name: 'F.Mask',       thickness_mm: 0.010,  material: 'Solder Mask', dk: 3.5,  copper_oz: 0    },
      { layer_type: 'copper',     name: 'F.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,    copper_oz: 1    },
      { layer_type: 'dielectric', name: 'Prepreg 1',    thickness_mm: 0.100,  material: 'FR4 2313',    dk: 4.05, copper_oz: 0    },
      { layer_type: 'copper',     name: 'In1.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,    copper_oz: 0.5  },
      { layer_type: 'dielectric', name: 'Core',         thickness_mm: 1.265,  material: 'FR4',         dk: 4.6,  copper_oz: 0    },
      { layer_type: 'copper',     name: 'In2.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,    copper_oz: 0.5  },
      { layer_type: 'dielectric', name: 'Prepreg 2',    thickness_mm: 0.100,  material: 'FR4 2313',    dk: 4.05, copper_oz: 0    },
      { layer_type: 'copper',     name: 'B.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,    copper_oz: 1    },
      { layer_type: 'mask',       name: 'B.Mask',       thickness_mm: 0.010,  material: 'Solder Mask', dk: 3.5,  copper_oz: 0    },
      { layer_type: 'silk',       name: 'B.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,    copper_oz: 0    },
    ],
  },
  {
    id:                  'pcbway-2l',
    name:                'PCBWay 2-Layer (1.6mm)',
    description:         'Standard PCBWay 2-layer FR4 1.6mm, 1oz copper, Dk=4.5',
    manufacturer:        'PCBWay',
    layer_count:         2,
    total_thickness_mm:  1.6,
    layers: [
      { layer_type: 'silk',       name: 'F.Silkscreen', thickness_mm: 0.010, material: 'Ink',        dk: 0,   copper_oz: 0 },
      { layer_type: 'mask',       name: 'F.Mask',       thickness_mm: 0.012, material: 'Solder Mask', dk: 3.5, copper_oz: 0 },
      { layer_type: 'copper',     name: 'F.Cu',         thickness_mm: 0.035, material: 'Copper',      dk: 0,   copper_oz: 1 },
      { layer_type: 'dielectric', name: 'Core',         thickness_mm: 1.506, material: 'FR4',         dk: 4.5, copper_oz: 0 },
      { layer_type: 'copper',     name: 'B.Cu',         thickness_mm: 0.035, material: 'Copper',      dk: 0,   copper_oz: 1 },
      { layer_type: 'mask',       name: 'B.Mask',       thickness_mm: 0.012, material: 'Solder Mask', dk: 3.5, copper_oz: 0 },
      { layer_type: 'silk',       name: 'B.Silkscreen', thickness_mm: 0.010, material: 'Ink',        dk: 0,   copper_oz: 0 },
    ],
  },
  {
    id:                  'pcbway-4l',
    name:                'PCBWay 4-Layer (1.6mm)',
    description:         'PCBWay standard 4-layer 1.6mm FR4, 1oz outer / 0.5oz inner',
    manufacturer:        'PCBWay',
    layer_count:         4,
    total_thickness_mm:  1.6,
    layers: [
      { layer_type: 'silk',       name: 'F.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,   copper_oz: 0   },
      { layer_type: 'mask',       name: 'F.Mask',       thickness_mm: 0.012,  material: 'Solder Mask', dk: 3.5, copper_oz: 0   },
      { layer_type: 'copper',     name: 'F.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,   copper_oz: 1   },
      { layer_type: 'dielectric', name: 'Prepreg 1',    thickness_mm: 0.180,  material: 'FR4 7628',    dk: 4.5, copper_oz: 0   },
      { layer_type: 'copper',     name: 'In1.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,   copper_oz: 0.5 },
      { layer_type: 'dielectric', name: 'Core',         thickness_mm: 1.100,  material: 'FR4',         dk: 4.5, copper_oz: 0   },
      { layer_type: 'copper',     name: 'In2.Cu',       thickness_mm: 0.0175, material: 'Copper',      dk: 0,   copper_oz: 0.5 },
      { layer_type: 'dielectric', name: 'Prepreg 2',    thickness_mm: 0.180,  material: 'FR4 7628',    dk: 4.5, copper_oz: 0   },
      { layer_type: 'copper',     name: 'B.Cu',         thickness_mm: 0.035,  material: 'Copper',      dk: 0,   copper_oz: 1   },
      { layer_type: 'mask',       name: 'B.Mask',       thickness_mm: 0.012,  material: 'Solder Mask', dk: 3.5, copper_oz: 0   },
      { layer_type: 'silk',       name: 'B.Silkscreen', thickness_mm: 0.010,  material: 'Ink',        dk: 0,   copper_oz: 0   },
    ],
  },
];

// ── Layer location / copper weight helpers ────────────────────────────────────

/**
 * Determine if a KiCad layer name is external (top/bottom) or internal.
 * Gap B fix: per-layer auto-detection used in Track Audit.
 * @param {string} layerName
 * @returns {'external'|'internal'}
 */
export function resolveLayerLocation(layerName) {
  return (layerName === 'F.Cu' || layerName === 'B.Cu') ? 'external' : 'internal';
}

/**
 * Look up the copper oz weight of a named layer from the active stackup.
 * Gap C fix: uses actual stackup value instead of hardcoded 1oz.
 * @param {string} layerName
 * @param {object[]} stackupLayers
 * @returns {number} oz (defaults to 1 if not found)
 */
export function resolveLayerCopperOz(layerName, stackupLayers) {
  const layer = stackupLayers?.find(l => l.name === layerName && l.layer_type === 'copper');
  return layer?.copper_oz ?? 1;
}

// ── Stackup geometry helpers ──────────────────────────────────────────────────

/**
 * Get the dielectric height (H) below a surface copper layer for microstrip calculation.
 * For F.Cu: sum dielectric downward until first reference plane (next copper).
 * For B.Cu: sum dielectric upward until first reference plane (prev copper).
 * @param {object[]} layers
 * @param {string} signalLayerName
 * @returns {{ h_mm: number, er: number, t_mm: number }|null}
 */
export function findMicrostripH(layers, signalLayerName) {
  const copperLayers = layers.filter(l => l.layer_type === 'copper');
  const idx = layers.findIndex(l => l.name === signalLayerName);
  if (idx < 0) return null;

  const isFCu = signalLayerName === 'F.Cu';
  const isBCu = signalLayerName === 'B.Cu';
  if (!isFCu && !isBCu) return null;

  const t_mm = layers[idx]?.thickness_mm ?? 0.035;
  let h_mm = 0;
  let er = 4.6;

  const step = isFCu ? 1 : -1;
  for (let i = idx + step; isFCu ? i < layers.length : i >= 0; i += step) {
    const layer = layers[i];
    if (layer.layer_type === 'dielectric') {
      h_mm += layer.thickness_mm;
      er = layer.dk || 4.6;
    } else if (layer.layer_type === 'copper') {
      break;
    }
  }

  return h_mm > 0 ? { h_mm, er, t_mm } : null;
}

/**
 * Get the total dielectric distance (B) between reference planes above and below
 * an inner signal layer for stripline calculation.
 * @param {object[]} layers
 * @param {string} signalLayerName
 * @returns {{ b_mm: number, er: number, t_mm: number }|null}
 */
export function findStriplineB(layers, signalLayerName) {
  const idx = layers.findIndex(l => l.name === signalLayerName);
  if (idx < 0) return null;

  const t_mm = layers[idx]?.thickness_mm ?? 0.0175;
  let above = 0;
  let below = 0;
  let er = 4.6;

  for (let i = idx - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.layer_type === 'dielectric') { above += l.thickness_mm; er = l.dk || 4.6; }
    else if (l.layer_type === 'copper') break;
  }
  for (let i = idx + 1; i < layers.length; i++) {
    const l = layers[i];
    if (l.layer_type === 'dielectric') { below += l.thickness_mm; er = l.dk || 4.6; }
    else if (l.layer_type === 'copper') break;
  }

  const b_mm = above + below;
  return b_mm > 0 ? { b_mm, er, t_mm } : null;
}

/**
 * Return all copper layer names from a stackup.
 * @param {object[]} layers
 * @returns {string[]}
 */
export function getCopperLayerNames(layers) {
  return layers.filter(l => l.layer_type === 'copper').map(l => l.name);
}

/**
 * Determine the natural impedance type for a layer (microstrip vs stripline).
 * @param {string} layerName
 * @returns {'microstrip'|'stripline'}
 */
export function defaultImpedanceType(layerName) {
  return (layerName === 'F.Cu' || layerName === 'B.Cu') ? 'microstrip' : 'stripline';
}

// ── Impedance calculations ────────────────────────────────────────────────────

/**
 * Microstrip impedance — IPC-2141A closed-form.
 * @param {number} w_mm  trace width
 * @param {number} h_mm  dielectric height to reference plane
 * @param {number} t_mm  copper thickness
 * @param {number} er    dielectric constant
 * @returns {number} impedance in ohms, or NaN if inputs invalid
 */
export function calcMicrostripZ0(w_mm, h_mm, t_mm, er) {
  if (w_mm <= 0 || h_mm <= 0 || t_mm < 0 || er <= 0) return NaN;
  const denom = 0.8 * w_mm + t_mm;
  if (denom <= 0) return NaN;
  return (87 / Math.sqrt(er + 1.41)) * Math.log(5.98 * h_mm / denom);
}

/**
 * Centered stripline impedance — IPC-2141A closed-form.
 * @param {number} w_mm  trace width
 * @param {number} b_mm  total dielectric height between reference planes
 * @param {number} t_mm  copper thickness
 * @param {number} er    dielectric constant
 * @returns {number} impedance in ohms
 */
export function calcStriplineZ0(w_mm, b_mm, t_mm, er) {
  if (w_mm <= 0 || b_mm <= 0 || t_mm < 0 || er <= 0) return NaN;
  const denom = 0.67 * Math.PI * (0.8 * w_mm + t_mm);
  if (denom <= 0) return NaN;
  return (60 / Math.sqrt(er)) * Math.log(4 * b_mm / denom);
}

/**
 * Differential pair impedance.
 * Applies the edge-coupled correction to the single-ended Z0.
 * @param {number} z0_ohm  single-ended impedance
 * @param {number} s_mm    edge-to-edge trace spacing
 * @param {number} h_mm    dielectric height (use b_mm/2 for stripline)
 * @returns {number} differential impedance in ohms
 */
export function calcDiffPairZ0(z0_ohm, s_mm, h_mm) {
  if (z0_ohm <= 0 || s_mm <= 0 || h_mm <= 0) return NaN;
  return 2 * z0_ohm * (1 - 0.48 * Math.exp(-0.96 * (s_mm / h_mm)));
}

/**
 * Coplanar waveguide (CPW) impedance — simplified approximation.
 * Accurate enough for PCB layout guidance (±5% vs full conformal mapping).
 * @param {number} w_mm  trace width
 * @param {number} h_mm  substrate height
 * @param {number} g_mm  gap to coplanar ground (edge to edge)
 * @param {number} er    substrate dielectric constant
 * @returns {number} impedance in ohms
 */
export function calcCoplanarWaveguideZ0(w_mm, h_mm, g_mm, er) {
  if (w_mm <= 0 || h_mm <= 0 || g_mm <= 0 || er <= 0) return NaN;
  const z0_ms = calcMicrostripZ0(w_mm, h_mm, 0.035, er);
  if (!isFinite(z0_ms)) return NaN;
  const correction = 1 + (2 * w_mm) / (Math.PI * g_mm) * Math.log(2);
  return z0_ms / correction;
}

/**
 * Compute single-ended impedance given trace type and geometry params.
 * @param {'microstrip'|'stripline'|'cpw'} type
 * @param {number} w_mm
 * @param {object} geo  { h_mm, b_mm, t_mm, er, g_mm }
 * @returns {number} ohms
 */
export function calcZ0(type, w_mm, geo) {
  if (type === 'microstrip') return calcMicrostripZ0(w_mm, geo.h_mm, geo.t_mm, geo.er);
  if (type === 'stripline')  return calcStriplineZ0(w_mm, geo.b_mm, geo.t_mm, geo.er);
  if (type === 'cpw')        return calcCoplanarWaveguideZ0(w_mm, geo.h_mm, geo.g_mm, geo.er);
  return NaN;
}

/**
 * Find trace width that yields a target impedance — binary search.
 * @param {'microstrip'|'stripline'|'cpw'} type
 * @param {number} target_ohm
 * @param {object} geo  { h_mm, b_mm, t_mm, er, g_mm }
 * @param {number} [tolerance=0.1]
 * @returns {number|null} width in mm, or null if not solvable
 */
export function calcWidthForZ0(type, target_ohm, geo, tolerance = 0.1) {
  let lo = 0.01, hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const z = calcZ0(type, mid, geo);
    if (!isFinite(z)) return null;
    if (Math.abs(z - target_ohm) < tolerance) return mid;
    // Z0 decreases as width increases
    if (z > target_ohm) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── IPC-2221 current capacity ─────────────────────────────────────────────────

/**
 * Maximum current a trace can carry — IPC-2221B.
 * @param {number} w_mm        trace width
 * @param {number} copper_oz   copper weight (1 = 1oz = 0.035mm)
 * @param {number} dT_C        allowable temperature rise in °C
 * @param {'external'|'internal'} location
 * @returns {number} max current in amps
 */
export function calcMaxCurrent(w_mm, copper_oz, dT_C, location) {
  if (w_mm <= 0 || copper_oz <= 0 || dT_C <= 0) return 0;
  const k = location === 'external' ? 0.048 : 0.024;
  const w_mils = w_mm / 0.0254;
  const t_mils = copper_oz * 1.378;
  const area_mil2 = w_mils * t_mils;
  return k * Math.pow(dT_C, 0.44) * Math.pow(area_mil2, 0.725);
}

/**
 * Trace width required to carry a given current — IPC-2221B inverse.
 * @param {number} current_A
 * @param {number} copper_oz
 * @param {number} dT_C
 * @param {'external'|'internal'} location
 * @returns {number} required width in mm
 */
export function calcRequiredWidth(current_A, copper_oz, dT_C, location) {
  if (current_A <= 0 || copper_oz <= 0 || dT_C <= 0) return 0;
  const k = location === 'external' ? 0.048 : 0.024;
  const t_mils = copper_oz * 1.378;
  const area_mil2 = Math.pow(current_A / (k * Math.pow(dT_C, 0.44)), 1 / 0.725);
  const w_mils = area_mil2 / t_mils;
  return w_mils * 0.0254;
}

/**
 * Sum total stackup thickness from layers array.
 * @param {object[]} layers
 * @returns {number} mm
 */
export function calcTotalThickness(layers) {
  return layers.reduce((sum, l) => sum + (l.thickness_mm || 0), 0);
}

/**
 * Deep-clone a preset so edits don't mutate the source.
 * @param {object} preset
 * @returns {object}
 */
export function clonePreset(preset) {
  return JSON.parse(JSON.stringify(preset));
}
