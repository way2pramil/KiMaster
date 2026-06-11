/**
 * PcbExporter — marketing-quality renders, GIF spin, MP4/WebM video, PNG/JPEG export.
 *
 * All encoding runs in the browser — no Blender, no server, no external tools.
 *
 * Exports:
 *   exportPng(renderer, scene, camera, opts)   → downloads PNG
 *   exportJpeg(renderer, scene, camera, opts)  → downloads JPEG
 *   startSpin(renderer, scene, camera, group, opts, onFrame) → animation loop handle
 *   exportGif(frames, opts)                    → downloads GIF (built-in encoder)
 *   startMp4(canvas, opts)                     → MediaRecorder handle
 *   stopMp4(handle)                            → finalizes + downloads
 */

import * as THREE from 'three';

// ── High-resolution still image export ───────────────────────────────────────

/**
 * Render scene at a custom resolution and download as PNG.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {{ width?: number, height?: number, scale?: number, filename?: string }} opts
 */
export async function exportPng(renderer, scene, camera, opts = {}) {
  const blob = await _renderToBlob(renderer, scene, camera, opts, 'image/png', 1.0);
  _download(blob, opts.filename ?? 'pcb-render.png');
}

/**
 * Render scene at custom resolution and download as JPEG.
 * @param {{ width?, height?, scale?, quality?, filename? }} opts
 */
export async function exportJpeg(renderer, scene, camera, opts = {}) {
  const q    = opts.quality ?? 0.95;
  const blob = await _renderToBlob(renderer, scene, camera, opts, 'image/jpeg', q);
  _download(blob, opts.filename ?? 'pcb-render.jpg');
}

/**
 * Render at target resolution using an off-screen renderer to avoid disturbing the live view.
 */
async function _renderToBlob(renderer, scene, camera, opts, mimeType, quality) {
  const scale  = opts.scale  ?? 2;
  const w      = opts.width  ?? Math.round(renderer.domElement.clientWidth  * scale);
  const h      = opts.height ?? Math.round(renderer.domElement.clientHeight * scale);

  // Off-screen canvas + temporary renderer at target resolution
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = w;
  offCanvas.height = h;

  const offRenderer = new THREE.WebGLRenderer({
    canvas:    offCanvas,
    antialias: true,
    logarithmicDepthBuffer: true,
  });
  offRenderer.setSize(w, h, false);
  offRenderer.setPixelRatio(1);
  offRenderer.outputColorSpace    = renderer.outputColorSpace;
  offRenderer.toneMapping         = renderer.toneMapping;
  offRenderer.toneMappingExposure = renderer.toneMappingExposure;
  offRenderer.shadowMap.enabled   = renderer.shadowMap.enabled;
  offRenderer.shadowMap.type      = renderer.shadowMap.type;

  // Sync environment
  offRenderer.render(scene, camera);
  // One extra render pass to warm up shadows
  offRenderer.render(scene, camera);

  return new Promise((resolve) => {
    offCanvas.toBlob(resolve, mimeType, quality);
    offRenderer.dispose();
  });
}

// ── Spin animation ─────────────────────────────────────────────────────────

/**
 * Rotate `boardGroup` 360° and call `onFrame(imageData)` for each frame.
 * Returns a handle with { cancel() }.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}         scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Group}         boardGroup  - object to rotate
 * @param {{ frames?: number, fps?: number, width?: number, height?: number }} opts
 * @param {(imageData: ImageData, frameIdx: number, total: number) => void} onFrame
 */
export function startSpin(renderer, scene, camera, boardGroup, opts, onFrame) {
  const frames    = opts.frames   ?? 72;   // 72 frames = 5° per frame
  const fps       = opts.fps      ?? 24;
  const delayMs   = 1000 / fps;
  const stepRad   = (2 * Math.PI) / frames;
  const w         = opts.width    ?? renderer.domElement.clientWidth;
  const h         = opts.height   ?? renderer.domElement.clientHeight;

  const origRotZ  = boardGroup.rotation.z;
  let   frameIdx  = 0;
  let   cancelled = false;
  let   timer     = null;

  const captureFrame = () => {
    if (cancelled) return;
    if (frameIdx >= frames) {
      boardGroup.rotation.z = origRotZ;
      onFrame(null, frames, frames); // signal done
      return;
    }

    boardGroup.rotation.z = origRotZ + stepRad * frameIdx;
    renderer.render(scene, camera);

    const canvas = renderer.domElement;
    const ctx    = canvas.getContext('2d') ?? _getCtx(canvas);
    const px     = renderer.getPixelRatio();
    const imgData = _readPixels(renderer, Math.round(w * px), Math.round(h * px));

    onFrame(imgData, frameIdx, frames);
    frameIdx++;
    timer = setTimeout(captureFrame, delayMs);
  };

  timer = setTimeout(captureFrame, 0);

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      boardGroup.rotation.z = origRotZ;
    },
  };
}

function _readPixels(renderer, w, h) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  const gl     = renderer.getContext();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // WebGL pixels are Y-flipped
  const flipped = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcRow = h - 1 - row;
    flipped.set(pixels.subarray(srcRow * w * 4, (srcRow + 1) * w * 4), row * w * 4);
  }
  return new ImageData(flipped, w, h);
}

// ── GIF encoder (pure JS, no dependencies) ───────────────────────────────────
// Implements a minimal LZW + GIF89a encoder supporting up to 256 colors.

/**
 * Encode collected frames as an animated GIF Blob.
 * @param {ImageData[]} frames
 * @param {{ fps?: number, width: number, height: number, scale?: number }} opts
 * @returns {Blob}
 */
export function encodeGif(frames, opts) {
  const fps     = opts.fps   ?? 24;
  const delay   = Math.round(100 / fps); // GIF delay in 1/100 sec units
  const w       = opts.width;
  const h       = opts.height;
  const scale   = opts.scale ?? 1;
  const outW    = Math.round(w  / scale);
  const outH    = Math.round(h  / scale);

  const buf = [];

  // GIF89a header
  _writeStr(buf, 'GIF89a');
  _writeU16(buf, outW);
  _writeU16(buf, outH);
  buf.push(0xf7, 0x00, 0x00); // GCT flag, bg, aspect
  // Global color table (256 entries, 768 bytes) — filled per-frame
  for (let i = 0; i < 256 * 3; i++) buf.push(0);

  // Netscape loop extension
  buf.push(0x21, 0xff, 0x0b);
  _writeStr(buf, 'NETSCAPE2.0');
  buf.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    const { palette, indices } = _quantize(frame, outW, outH, scale);

    // Patch global color table for first frame (GIF global CT)
    const gctStart = 13;
    for (let i = 0; i < 256; i++) {
      const c = palette[i] ?? [0, 0, 0];
      buf[gctStart + i * 3 + 0] = c[0];
      buf[gctStart + i * 3 + 1] = c[1];
      buf[gctStart + i * 3 + 2] = c[2];
    }

    // Graphic control extension (delay)
    buf.push(0x21, 0xf9, 0x04, 0x00);
    _writeU16(buf, delay);
    buf.push(0x00, 0x00);

    // Image descriptor
    buf.push(0x2c);
    _writeU16(buf, 0); _writeU16(buf, 0);
    _writeU16(buf, outW); _writeU16(buf, outH);
    buf.push(0x00);

    // LZW compressed image data
    const lzw = _lzwEncode(indices, 8);
    buf.push(8); // min code size
    let pos = 0;
    while (pos < lzw.length) {
      const chunk = Math.min(255, lzw.length - pos);
      buf.push(chunk);
      for (let i = 0; i < chunk; i++) buf.push(lzw[pos++]);
    }
    buf.push(0x00); // block terminator
  }

  buf.push(0x3b); // GIF trailer
  return new Blob([new Uint8Array(buf)], { type: 'image/gif' });
}

function _quantize(frame, outW, outH, scale) {
  const src  = frame.data;
  const srcW = frame.width;
  // Simple median-cut approximation: sample pixels, build palette
  const sampled = {};
  const step    = Math.max(1, Math.round(scale));
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(Math.floor(x * scale), srcW - 1);
      const sy = Math.min(Math.floor(y * scale), frame.height - 1);
      const i  = (sy * srcW + sx) * 4;
      const r  = src[i] >> 3, g = src[i + 1] >> 3, b = src[i + 2] >> 3;
      const key = (r << 10) | (g << 5) | b;
      sampled[key] = sampled[key] ? [src[i], src[i+1], src[i+2]] : [src[i], src[i+1], src[i+2]];
    }
  }

  const keys    = Object.keys(sampled);
  const palette = [];
  for (let i = 0; i < 256; i++) {
    if (i < keys.length) {
      const v = sampled[keys[i]];
      palette.push([v[0], v[1], v[2]]);
    } else {
      palette.push([0, 0, 0]);
    }
  }

  // Build reverse map
  const revMap = {};
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];
    revMap[(c[0] >> 3 << 10) | (c[1] >> 3 << 5) | (c[2] >> 3)] = i;
  }

  const indices = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(Math.floor(x * scale), srcW - 1);
      const sy = Math.min(Math.floor(y * scale), frame.height - 1);
      const i  = (sy * srcW + sx) * 4;
      const key = (src[i] >> 3 << 10) | (src[i+1] >> 3 << 5) | (src[i+2] >> 3);
      indices[y * outW + x] = revMap[key] ?? 0;
    }
  }

  return { palette, indices };
}

function _lzwEncode(indices, minCodeSize) {
  const clearCode  = 1 << minCodeSize;
  const eofCode    = clearCode + 1;
  let   codeSize   = minCodeSize + 1;
  let   nextCode   = eofCode + 1;
  const table      = new Map();

  // Init
  const initTable = () => {
    table.clear();
    for (let i = 0; i < clearCode; i++) table.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = eofCode + 1;
  };

  initTable();

  const output  = [];
  let   bitBuf  = 0;
  let   bitPos  = 0;

  const emit = (code) => {
    bitBuf |= code << bitPos;
    bitPos += codeSize;
    while (bitPos >= 8) {
      output.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitPos  -= 8;
    }
  };

  emit(clearCode);

  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const current = indices[i];
    const chain   = prefix + ',' + current;
    if (table.has(chain)) {
      prefix = chain;
    } else {
      emit(table.get(prefix));
      if (nextCode < 4096) {
        table.set(chain, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        initTable();
      }
      prefix = String(current);
    }
  }

  emit(table.get(prefix));
  emit(eofCode);
  if (bitPos > 0) output.push(bitBuf & 0xff);
  return output;
}

function _writeStr(buf, s) { for (const c of s) buf.push(c.charCodeAt(0)); }
function _writeU16(buf, v) { buf.push(v & 0xff, (v >> 8) & 0xff); }

// ── MP4 / WebM via MediaRecorder ──────────────────────────────────────────────

/**
 * Start recording the canvas as a video stream.
 * Returns a handle with { stop() → Promise<Blob> }.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ fps?: number, bitrate?: number }} opts
 */
export function startVideoRecording(canvas, opts = {}) {
  const fps     = opts.fps     ?? 30;
  const bitrate = opts.bitrate ?? 8_000_000; // 8 Mbps for high quality

  const stream   = canvas.captureStream(fps);
  const mimeType = _pickVideoMime();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start(100); // collect every 100ms

  return {
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.stop();
      });
    },
    get isRecording() { return recorder.state === 'recording'; },
  };
}

function _pickVideoMime() {
  const types = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
}

// ── Download helper ────────────────────────────────────────────────────────────

export function downloadBlob(blob, filename) { _download(blob, filename); }

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
