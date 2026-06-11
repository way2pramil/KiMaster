/**
 * LayerRasterizer — Pipeline A step 2.
 *
 * Converts SVG files → Canvas → THREE.DataTexture.
 * Pairs Front+Back into a single RGB texture per layer type:
 *   R channel = Front layer
 *   G channel = Back layer
 *   B channel = 0 (unused)
 *
 * Mirrors pcb2blender's approach (skia → PIL merge), implemented in browser Canvas.
 *
 * Layer inversion (matching pcb2blender logic):
 *   Cu, Silk → INVERT (black-on-white SVG → white=copper/silk in texture)
 *   Mask     → NO INVERT (white=mask opening = pad exposed)
 */

import * as THREE from 'three';
import { Logger }  from '../../../core/Logger.js';

const DPI        = 508;    // matching pcb2blender default / 2
const MM_PER_IN  = 25.4;
const DPMM       = DPI / MM_PER_IN;

/**
 * Parse SVG viewBox/width to get board dimensions in mm.
 * kicad-cli with --page-size-mode 2 exports SVGs where width/height are in mm.
 * @param {string} svgText
 * @returns {{ widthMm: number, heightMm: number, widthPx: number, heightPx: number }}
 */
export function parseSvgBounds(svgText) {
  // Try width/height with mm units: width="100mm"
  const wMatch = svgText.match(/\bwidth="([\d.]+)(mm)?"/);
  const hMatch = svgText.match(/\bheight="([\d.]+)(mm)?"/);

  let widthMm  = wMatch  ? parseFloat(wMatch[1])  : 100;
  let heightMm = hMatch  ? parseFloat(hMatch[1])  : 100;

  // If no unit, assume SVG user units = mm (kicad-cli default)
  const widthPx  = Math.round(widthMm  * DPMM);
  const heightPx = Math.round(heightMm * DPMM);

  return { widthMm, heightMm, widthPx, heightPx };
}

/**
 * Rasterize a single SVG string to an ImageData at DPMM resolution.
 * @param {string} svgText
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {boolean} invert  - invert pixel values (for Cu/Silk layers)
 * @returns {Promise<Uint8Array>}  R-channel pixel array, length = w*h
 */
async function rasterizeSvg(svgText, widthPx, heightPx, invert) {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);

  try {
    const img = await new Promise((res, rej) => {
      const i  = new Image();
      i.onload  = () => res(i);
      i.onerror = rej;
      i.src     = url;
    });

    const canvas = new OffscreenCanvas(widthPx, heightPx);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);

    const imgData = ctx.getImageData(0, 0, widthPx, heightPx).data;
    // Extract R channel (grayscale = R=G=B after b&w export)
    const channel = new Uint8Array(widthPx * heightPx);
    for (let i = 0; i < channel.length; i++) {
      const v = imgData[i * 4]; // R channel
      channel[i] = invert ? (255 - v) : v;
    }
    return channel;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Load an SVG file from disk using Tauri asset URL, rasterize, return channel.
 * @param {string} filePath  - absolute OS path
 * @param {number} w, h      - pixel dimensions
 * @param {boolean} invert
 */
async function loadAndRasterize(filePath, w, h, invert) {
  if (!filePath) return new Uint8Array(w * h); // black channel if layer missing

  const url     = _toAssetUrl(filePath);
  const svgText = await fetch(url).then(r => r.text()).catch(() => '');
  if (!svgText) return new Uint8Array(w * h);

  return rasterizeSvg(svgText, w, h, invert);
}

/**
 * Build THREE.DataTexture for copper, mask, and silkscreen from SVG files.
 * @param {{ FCu, BCu, FMask, BMask, FSilkS, BSilkS }} files  - absolute paths
 * @returns {Promise<LayerTextures>}
 */
export async function buildLayerTextures(files) {
  // Use F.Cu SVG to determine board dimensions
  const ref = files.F_Cu || files.F_Mask || Object.values(files)[0] || '';
  let bounds = { widthMm: 100, heightMm: 100, widthPx: 2048, heightPx: 2048 };

  if (ref) {
    try {
      const url  = _toAssetUrl(ref);
      const text = await fetch(url).then(r => r.text());
      bounds     = parseSvgBounds(text);
    } catch { /* use defaults */ }
  }

  const { widthMm, heightMm, widthPx, heightPx } = bounds;
  const size = widthPx * heightPx;

  Logger.info('PCB3D:Rasterizer', `Board ${widthMm.toFixed(1)}×${heightMm.toFixed(1)}mm → ${widthPx}×${heightPx}px`);

  // Rasterize all 6 layers in parallel
  const [fCu, bCu, fMask, bMask, fSilk, bSilk] = await Promise.all([
    loadAndRasterize(files.F_Cu,    widthPx, heightPx, true),   // invert
    loadAndRasterize(files.B_Cu,    widthPx, heightPx, true),   // invert
    loadAndRasterize(files.F_Mask,  widthPx, heightPx, false),  // no invert
    loadAndRasterize(files.B_Mask,  widthPx, heightPx, false),  // no invert
    loadAndRasterize(files.F_SilkS, widthPx, heightPx, true),   // invert
    loadAndRasterize(files.B_SilkS, widthPx, heightPx, true),   // invert
  ]);

  // Pack pairs into RGBA textures (R=front, G=back, B=0, A=255)
  // WebGL2 has no sized internal format for 3-channel RGB8 texStorage2D;
  // RGB-format DataTextures fail glTexStorage2D with GL_INVALID_ENUM.
  const cuData   = new Uint8Array(size * 4);
  const maskData = new Uint8Array(size * 4);
  const silkData = new Uint8Array(size * 4);

  for (let i = 0; i < size; i++) {
    const j = i * 4;
    cuData[j]   = fCu[i];   cuData[j+1]   = bCu[i];   cuData[j+2]   = 0; cuData[j+3]   = 255;
    maskData[j] = fMask[i]; maskData[j+1] = bMask[i]; maskData[j+2] = 0; maskData[j+3] = 255;
    silkData[j] = fSilk[i]; silkData[j+1] = bSilk[i]; silkData[j+2] = 0; silkData[j+3] = 255;
  }

  const makeTex = (data) => {
    const t = new THREE.DataTexture(data, widthPx, heightPx, THREE.RGBAFormat);
    t.flipY        = true; // match Three.js UV convention
    t.minFilter    = THREE.LinearMipMapLinearFilter;
    t.magFilter    = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate  = true;
    return t;
  };

  return {
    cu:   makeTex(cuData),
    mask: makeTex(maskData),
    silk: makeTex(silkData),
    boardMm: { width: widthMm, height: heightMm },
  };
}

function _toAssetUrl(p) {
  if (!p) return '';
  return window.__TAURI_INTERNALS__?.convertFileSrc
    ? window.__TAURI_INTERNALS__.convertFileSrc(p)
    : 'file:///' + p.replace(/\\/g, '/');
}
