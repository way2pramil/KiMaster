/**
 * PcbMaterials — PBR materials calibrated against pcb2blender (mat4cad) values.
 *
 * Reference: https://github.com/30350n/pcb2blender
 *   Surface finish:
 *     ENIG : color #efdfbb, roughness 0.10, metalness 1.0, noise scale 500
 *     HASL : color #eaeae5, roughness 0.15, metalness 1.0
 *     NONE : color #e1bbac, roughness 0.10, metalness 1.0
 *   Solder mask roughness: 0.45 (default), 0.40 (white), 0.80 (matte black)
 *   Silkscreen roughness: 0.25
 *   Board edge: KiCad hardcoded (117,97,47)/255 amber FR-4
 */

import * as THREE from 'three';
// Note: GLB is now the only render path — these materials are no longer applied
// to scene meshes (the GLB carries its own materials). createMaterials/applySettings
// are kept only because Live3DRenderer still drives lighting/SSAO/bloom settings
// through the same settings object (DEFAULT_SETTINGS / Live3DSettings panel).

// ── pcb2blender mask color table (light, dark) ────────────────────────────────

export const MASK_PRESETS = {
  green:       { light: 0x43a142, dark: 0x22521f, roughness: 0.45 },
  red:         { light: 0xde544c, dark: 0x733a38, roughness: 0.45 },
  yellow:      { light: 0xdacb57, dark: 0x6a7c30, roughness: 0.45 },
  blue:        { light: 0x3b69aa, dark: 0x1c3659, roughness: 0.45 },
  purple:      { light: 0x7448aa, dark: 0x3b2359, roughness: 0.45 },
  white:       { light: 0xd3cfc9, dark: 0xe1dddc, roughness: 0.40 },
  black:       { light: 0x10100f, dark: 0x000000, roughness: 0.45 },
  matte_black: { light: 0x191919, dark: 0x191919, roughness: 0.80 },
};

export const FINISH_PRESETS = {
  enig: { color: 0xefdfbb, roughness: 0.10, metalness: 1.0 },
  hasl: { color: 0xeaeae5, roughness: 0.15, metalness: 1.0 },
  none: { color: 0xe1bbac, roughness: 0.10, metalness: 1.0 },
};

/** Default material settings (all user-adjustable). */
export const DEFAULT_SETTINGS = {
  // Surface finish
  finish:           'enig',   // 'enig'|'hasl'|'none'
  finishRoughness:  0.10,
  finishMetalness:  1.0,
  finishColor:      '#efdfbb',

  // Solder mask
  maskColor:              'green',
  maskRoughness:          0.45,
  maskOpacity:            0.92,
  maskCustomColor:        '#43a142',
  // Clearcoat — independent glass-like lacquer lobe (MeshPhysicalMaterial only;
  // GLB mask materials are upgraded at load time so this actually renders).
  maskClearcoat:          0,
  maskClearcoatRoughness: 0.10,

  // Silkscreen
  silkColor:        '#f0f0ee',
  silkRoughness:    0.25,

  // Board substrate (FR-4)
  boardColor:       '#75612f',
  boardRoughness:   0.65,

  // Scene
  background:       '#0d1117',

  // Lighting — tuned for a "studio product shot" look: punchier contrast,
  // richer reflections, less flat ambient wash than the earlier defaults.
  ambientIntensity: 0.18,
  keyIntensity:     2.10,
  exposure:         1.15,
  envIntensity:     0.85,

  // Post-processing
  ssaoEnabled:      true,
  ssaoRadius:       5,
  bloomEnabled:     true,
  bloomStrength:    0.22,
  sharpness:        0.15,

  // Depth of field — softens elements behind the board so it reads as a
  // photographed product, not a flat render. Tuned to leave the board itself
  // sharp at any orbit angle/zoom; dofStrength is a 0-1 multiplier on the
  // scale-corrected base aperture (see Live3DRenderer._setupPostprocessing).
  dofEnabled:       true,
  dofStrength:      0.35,

  // Ground-plane shadow-catcher — grounds the board visually (cast shadow
  // from the key light). shadowStrength is the catcher's ShadowMaterial
  // opacity; raised well above a "physical" value because the dark studio
  // backdrop colors (#0d1117 etc.) give a black shadow very low contrast —
  // it needs to be strong to read at all against them.
  shadowsEnabled:   true,
  shadowStrength:   0.55,

  // Anisotropic texture filtering — keeps thin baked-in decal details
  // (silkscreen strokes, mask/copper boundaries) crisp at grazing view
  // angles instead of shimmering/dimming from mip-level sampling. Off by
  // default has no real use case (cost is negligible on any GPU that
  // supports it), but exposed as a toggle for low-end hardware / comparison.
  anisotropyEnabled: true,
};

/**
 * Render profiles — named bundles of setting overrides applied on top of
 * DEFAULT_SETTINGS. Selecting a profile merges its overrides into the
 * current settings so users get a one-click "look" they can still fine-tune.
 */
export const RENDER_PROFILES = {
  default: {
    label: 'Default',
    overrides: {},
  },
  photorealistic: {
    label: 'Photorealistic',
    overrides: {
      background:       '#4b4b4e',
      maskRoughness:    0.28,
      finishRoughness:  0.08,
      silkRoughness:    0.20,
      boardRoughness:   0.80,
      ambientIntensity: 0.30,
      keyIntensity:     1.75,
      exposure:         1.05,
      envIntensity:     1.05,
      ssaoRadius:       4,
      bloomStrength:    0.10,
      sharpness:        0.30,
    },
  },
  glassy: {
    label: 'Glassy Lacquer',
    overrides: {
      maskRoughness:          0.16,
      maskClearcoat:          1.0,
      // Widened from 0.06 — a near-perfect mirror reflects the studio key
      // softbox as a small, blinding hotspot at certain orbit angles; 0.12
      // keeps the "wet lacquer" look but spreads that reflection enough for
      // the diffused env map + raised bloom threshold to render it cleanly.
      maskClearcoatRoughness: 0.12,
      maskOpacity:            0.96,
      finishRoughness:        0.06,
      silkRoughness:          0.20,
      background:             '#3c3c40',
      ambientIntensity:       0.24,
      keyIntensity:           1.95,
      exposure:               1.05,
      envIntensity:           1.00,
      ssaoRadius:             4,
      bloomStrength:          0.14,
      sharpness:              0.25,
    },
  },
  sharp: {
    label: 'Sharp & Crisp',
    overrides: {
      background:       '#15171c',
      maskRoughness:    0.50,
      finishRoughness:  0.12,
      silkRoughness:    0.22,
      ambientIntensity: 0.12,
      keyIntensity:     2.40,
      exposure:         1.00,
      envIntensity:     0.60,
      ssaoRadius:       3,
      bloomStrength:    0.04,
      sharpness:        0.55,
    },
  },
};

/**
 * Create all PCB materials from a settings object.
 * @param {Partial<typeof DEFAULT_SETTINGS>} s
 */
export function createMaterials(s = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...s };
  const finish = FINISH_PRESETS[cfg.finish] ?? FINISH_PRESETS.enig;

  // ── FR-4 substrate (amber edges) ──────────────────────────────────────────
  const board = new THREE.MeshStandardMaterial({
    color:       new THREE.Color(cfg.boardColor),
    roughness:   cfg.boardRoughness,
    metalness:   0,
    name: 'fr4',
  });

  // ── Copper (traces) ───────────────────────────────────────────────────────
  const copper = new THREE.MeshStandardMaterial({
    color:           new THREE.Color(cfg.finishColor !== DEFAULT_SETTINGS.finishColor ? cfg.finishColor : finish.color),
    metalness:       cfg.finishMetalness,
    roughness:       cfg.finishRoughness,
    envMapIntensity: 2.2,
    name: 'copper',
  });

  // ── Via / plated copper ───────────────────────────────────────────────────
  const via = new THREE.MeshStandardMaterial({
    color:           new THREE.Color(finish.color),
    metalness:       cfg.finishMetalness,
    roughness:       Math.max(0.03, cfg.finishRoughness - 0.03),
    envMapIntensity: 2.5,
    name: 'via',
  });

  // ── Solder mask ───────────────────────────────────────────────────────────
  const maskPreset  = MASK_PRESETS[cfg.maskColor] ?? MASK_PRESETS.green;
  const maskHex     = cfg.maskColor === 'custom' ? cfg.maskCustomColor : null;
  const maskLightC  = maskHex ? new THREE.Color(maskHex) : new THREE.Color(maskPreset.light);
  const maskRough   = cfg.maskRoughness ?? maskPreset.roughness;

  const maskTop = new THREE.MeshStandardMaterial({
    color:       maskLightC,
    roughness:   maskRough,
    metalness:   0,
    transparent: true,
    opacity:     cfg.maskOpacity,
    depthWrite:  false,
    name: 'mask_top',
  });
  const maskBot = maskTop.clone();
  maskBot.name  = 'mask_bot';

  // ── Silkscreen ────────────────────────────────────────────────────────────
  const silk = new THREE.MeshStandardMaterial({
    color:       new THREE.Color(cfg.silkColor),
    roughness:   cfg.silkRoughness,
    metalness:   0,
    name: 'silk',
  });

  // ── Component bodies ──────────────────────────────────────────────────────
  const compDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0f0f12), roughness: 0.62, metalness: 0.06, name: 'comp_dark',
  });
  const compTan = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xa08855), roughness: 0.58, metalness: 0, name: 'comp_tan',
  });

  const _mats = [board, copper, via, maskTop, maskBot, silk, compDark, compTan];

  function dispose() {
    for (const m of _mats) m.dispose();
  }

  return { board, copper, via, maskTop, maskBot, silk, compDark, compTan, dispose };
}

/**
 * Apply changed settings to an existing material set WITHOUT rebuilding everything.
 * Called on every slider change for instant preview.
 * @param {object} mats - from createMaterials()
 * @param {Partial<typeof DEFAULT_SETTINGS>} s
 */
export function applySettings(mats, s) {
  const cfg = { ...DEFAULT_SETTINGS, ...s };
  const finish = FINISH_PRESETS[cfg.finish] ?? FINISH_PRESETS.enig;

  // Copper
  mats.copper.color.set(cfg.finishColor !== DEFAULT_SETTINGS.finishColor ? cfg.finishColor : finish.color);
  mats.copper.metalness  = cfg.finishMetalness;
  mats.copper.roughness  = cfg.finishRoughness;
  mats.copper.needsUpdate = true;

  // Via
  mats.via.color.set(finish.color);
  mats.via.metalness     = cfg.finishMetalness;
  mats.via.roughness     = Math.max(0.03, cfg.finishRoughness - 0.03);
  mats.via.needsUpdate   = true;

  // Mask
  const maskPreset = MASK_PRESETS[cfg.maskColor] ?? MASK_PRESETS.green;
  const maskHex    = cfg.maskColor === 'custom' ? cfg.maskCustomColor : null;
  const maskColor  = maskHex ? new THREE.Color(maskHex) : new THREE.Color(maskPreset.light);
  const maskRough  = cfg.maskRoughness ?? maskPreset.roughness;

  for (const m of [mats.maskTop, mats.maskBot]) {
    m.color.copy(maskColor);
    m.roughness  = maskRough;
    m.opacity    = cfg.maskOpacity;
    m.needsUpdate = true;
  }

  // Silk
  mats.silk.color.set(cfg.silkColor);
  mats.silk.roughness  = cfg.silkRoughness;
  mats.silk.needsUpdate = true;

  // Board
  mats.board.color.set(cfg.boardColor);
  mats.board.roughness  = cfg.boardRoughness;
  mats.board.needsUpdate = true;
}

/**
 * Generate a tileable, high-frequency micro-texture normal map — breaks up
 * the unnaturally flat reflections a perfectly smooth PBR surface produces
 * on silkscreen ink and exposed FR-4. Built once and shared across materials
 * (each with its own `normalScale`); CanvasTexture defaults to NoColorSpace,
 * which is correct for normal data (no sRGB skew on the encoded vectors).
 */
export function generateMicroNormalMap(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let i = 0; i < data.length; i += 4) {
    const nx = Math.floor(Math.random() * 30) - 15;
    const ny = Math.floor(Math.random() * 30) - 15;
    data[i]     = 128 + nx; // X
    data[i + 1] = 128 + ny; // Y
    data[i + 2] = 255;      // Z (up)
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Generate a tileable woven-fiberglass normal map for the FR-4 substrate —
 * alternating warp/weft strand bands with a sinusoidal ridge profile, unlike
 * the isotropic noise of generateMicroNormalMap(). This is what gives resin-
 * coated FR-4 edges their directional "cloth" sheen instead of a flat matte look.
 */
export function generateFiberglassWeaveMap(size = 256, strand = 10) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const warpDominant = (Math.floor(x / strand) + Math.floor(y / strand)) % 2 === 0;
      const across = (warpDominant ? x : y) % strand;
      const t = across / strand;
      const slope = Math.sin(t * Math.PI * 2) * 18;
      const grit  = Math.random() * 8 - 4;
      data[i]     = 128 + (warpDominant ? slope : grit);
      data[i + 1] = 128 + (warpDominant ? grit : slope);
      data[i + 2] = 250;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
