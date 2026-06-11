/**
 * TextRenderer — BitmapFont atlas and BitmapText factory for the canvas.
 *
 * Uses BitmapText exclusively — never PIXI.Text.
 * PIXI.Text rasterizes a texture per object; creating 1,000 at load time stalls the thread.
 * BitmapText performs atlas glyph lookups — near-zero cost even for BGA pad numbers.
 *
 * @module TextRenderer
 */

import { BitmapFont, BitmapFontManager, BitmapText } from 'pixi.js';

const FONT_NAME = 'KiMasterMono';
let _installed = false;

/**
 * Install the BitmapFont atlas. Call once during CanvasCore.init().
 * Uses JetBrains Mono if loaded via @font-face, falls back to system monospace.
 */
export function installFont() {
  if (_installed) return;
  _installed = true;

  BitmapFont.install({
    name: FONT_NAME,
    style: {
      fontFamily: '"JetBrains Mono", "Consolas", "Courier New", monospace',
      fontSize: 128,
      fill: '#ffffff',
      fontWeight: 'normal',
    },
    resolution: 2,
    chars: BitmapFontManager.ASCII,
  });
}

/**
 * Create a BitmapText node for a KiCad text element.
 *
 * @param {string}  content    text string
 * @param {number}  size       font size in world units (mm)
 * @param {number}  color      hex color
 * @param {boolean} [bold]
 * @returns {import('pixi.js').BitmapText}
 */
export function makeText(content, size, color, bold = false) {
  const t = new BitmapText({
    text:  content,
    style: {
      fontFamily: FONT_NAME,
      fontSize:   size,
      tint:       color,
      fontWeight: bold ? 'bold' : 'normal',
    },
  });
  t.anchor.set(0.5, 0.5);
  return t;
}
