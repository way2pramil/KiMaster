import { Graphics, Container, BitmapText } from 'pixi.js';
import { arcFrom3Points }  from './ArcUtils.js';
import { effectiveStroke } from './StrokeUtils.js';
import { layerColor, sortLayers } from './LayerManager.js';
import { drawPad }         from './PadRenderer.js';

const TEXT_CULL_SCALE = 2.0;
const SEL_COLOR       = 0x589cff;
const SEL_ALPHA       = 0.45;

export class EDARenderer {
  #scene;
  #layers     = new Map();
  #textLayers = new Map();
  #selGfx;
  #elements   = [];
  #elementMap = new Map();
  #dirty      = new Set();
  #visibleLayers;
  #rafId      = null;
  #scale      = 1;
  #selectedIds = new Set();

  constructor(scene, visibleLayers) {
    this.#scene = scene;
    this.#visibleLayers = visibleLayers;

    this.#selGfx = new Graphics();
    this.#selGfx.eventMode = 'none';
    this.#selGfx.zIndex    = 9000;
    this.#scene.addChild(this.#selGfx);
  }

  load(elements) {
    this.#elements = elements;
    this.#elementMap.clear();
    for (const el of elements) this.#elementMap.set(el.id, el);
    this._clearAllGraphics();
    this._buildLayers();
    this.markDirty('all');
  }

  markDirty(layer = 'all') {
    if (layer === 'all') {
      for (const l of this.#layers.keys()) this.#dirty.add(l);
    } else {
      this.#dirty.add(layer);
    }
    this._scheduleFlush();
  }

  onZoomChange(scale) {
    this.#scale = scale;
    this.markDirty('all');
  }

  syncSelection(selectedIds) {
    this.#selectedIds = selectedIds;
    this.#selGfx.clear();
    if (!selectedIds.size) return;

    const halo = Math.max(0.06, 2.0 / this.#scale);

    for (const id of selectedIds) {
      const el = this.#elementMap.get(id);
      if (!el) continue;
      this._drawSelectionHalo(this.#selGfx, el, halo);
    }
  }

  setVisibleLayers(layers) {
    this.#visibleLayers = layers instanceof Set ? layers : new Set(layers);
    this._updateLayerVisibility();
    this.markDirty('all');
  }

  _clearAllGraphics() {
    for (const g of this.#layers.values()) g.clear();
    for (const tc of this.#textLayers.values()) tc.removeChildren();
    this.#selGfx.clear();
  }

  _buildLayers() {
    const layerSet = new Set(this.#elements.map(e => e.layer));
    const ordered  = sortLayers([...layerSet]);

    for (const [l, g] of this.#layers) {
      if (!layerSet.has(l)) {
        this.#scene.removeChild(g);
        this.#layers.delete(l);
      }
    }
    for (const l of ordered) {
      if (!this.#layers.has(l)) {
        const g = new Graphics();
        g.eventMode = 'none';
        g.label     = `layer:${l}`;
        this.#layers.set(l, g);
        this.#scene.addChild(g);
      }
      if (!this.#textLayers.has(l)) {
        const tc = new Container();
        tc.eventMode = 'none';
        this.#textLayers.set(l, tc);
        this.#scene.addChild(tc);
      }
    }
    this._updateLayerVisibility();
    this.#scene.removeChild(this.#selGfx);
    this.#scene.addChild(this.#selGfx);
  }

  _updateLayerVisibility() {
    for (const [l, g] of this.#layers) {
      const vis = this.#visibleLayers.has(l);
      g.visible = vis;
      const tc = this.#textLayers.get(l);
      if (tc) tc.visible = vis;
    }
  }

  _scheduleFlush() {
    if (this.#rafId !== null) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;
      this._flush();
    });
  }

  _flush() {
    for (const layerName of this.#dirty) {
      this._rebuildLayer(layerName);
    }
    this.#dirty.clear();
    if (this.#selectedIds.size) this.syncSelection(this.#selectedIds);
  }

  _rebuildLayer(layerName) {
    const g = this.#layers.get(layerName);
    if (!g) return;
    g.clear();

    const tc = this.#textLayers.get(layerName);
    if (tc) tc.removeChildren();

    const showText = this.#scale >= TEXT_CULL_SCALE;
    const color    = layerColor(layerName);
    const elements = this.#elements.filter(e => e.layer === layerName);

    for (const el of elements) {
      this._drawElement(g, tc, el, color, showText);
    }
  }

  _drawElement(g, tc, el, color, showText) {
    switch (el.type) {
      case 'line':    this._drawLine(g, el, color); break;
      case 'arc':     this._drawArc(g, el, color);  break;
      case 'circle':  this._drawCircle(g, el, color); break;
      case 'rect':    this._drawRect(g, el, color);  break;
      case 'polygon': this._drawPolygon(g, el, color); break;
      case 'pad':     this._drawPad(g, el, color);
        if (showText && tc) this._drawPadNumber(tc, el);
        break;
      case 'text':
        if (showText && tc) this._drawText(tc, el, color);
        break;
    }
  }

  // ── Selection halo (Figma-style shape-conforming outline) ─────────────────

  _drawSelectionHalo(g, el, halo) {
    switch (el.type) {
      case 'line': {
        const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
        const hr = (sw + halo * 2) * 0.5;
        g.moveTo(el.x, el.y).lineTo(el.x2, el.y2);
        g.stroke({ color: SEL_COLOR, width: sw + halo * 2, alpha: SEL_ALPHA });
        g.circle(el.x, el.y, hr).fill({ color: SEL_COLOR, alpha: SEL_ALPHA });
        g.circle(el.x2, el.y2, hr).fill({ color: SEL_COLOR, alpha: SEL_ALPHA });
        break;
      }
      case 'arc': {
        const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
        const hr = (sw + halo * 2) * 0.5;
        const result = arcFrom3Points(
          { x: el.x, y: el.y },
          { x: el.mid_x, y: el.mid_y },
          { x: el.x2, y: el.y2 },
        );
        if (result.degenerate) {
          g.moveTo(result.x1, result.y1).lineTo(result.x2, result.y2);
        } else {
          g.arc(result.cx, result.cy, result.r, result.startAngle, result.endAngle, result.anticlockwise);
        }
        g.stroke({ color: SEL_COLOR, width: sw + halo * 2, alpha: SEL_ALPHA });
        g.circle(el.x, el.y, hr).fill({ color: SEL_COLOR, alpha: SEL_ALPHA });
        g.circle(el.x2, el.y2, hr).fill({ color: SEL_COLOR, alpha: SEL_ALPHA });
        break;
      }
      case 'circle': {
        const r = el.width != null ? el.width * 0.5 : Math.hypot(el.x2 - el.x, el.y2 - el.y);
        g.circle(el.x, el.y, r);
        const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
        g.stroke({ color: SEL_COLOR, width: sw + halo * 2, alpha: SEL_ALPHA });
        break;
      }
      case 'rect': {
        const rx = Math.min(el.x, el.x2) - halo;
        const ry = Math.min(el.y, el.y2) - halo;
        const rw = Math.abs(el.x2 - el.x) + halo * 2;
        const rh = Math.abs(el.y2 - el.y) + halo * 2;
        g.roundRect(rx, ry, rw, rh, halo * 0.5);
        g.stroke({ color: SEL_COLOR, width: halo, alpha: SEL_ALPHA });
        break;
      }
      case 'polygon': {
        const pts = el.points;
        if (!pts || pts.length < 4) return;
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.closePath();
        g.stroke({ color: SEL_COLOR, width: halo * 2, join: 'round', alpha: SEL_ALPHA });
        break;
      }
      case 'pad':
      case 'pin': {
        const hw = (el.width ?? 1) * 0.5 + halo;
        const hh = (el.height ?? 1) * 0.5 + halo;
        const shape = el.shape ?? 'rect';
        if (shape === 'circle') {
          g.circle(el.x, el.y, hw);
        } else if (shape === 'oval') {
          g.roundRect(el.x - hw, el.y - hh, hw * 2, hh * 2, Math.min(hw, hh));
        } else if (shape === 'roundrect') {
          const r = (el.roundrect_ratio ?? 0.25) * Math.min(hw, hh);
          g.roundRect(el.x - hw, el.y - hh, hw * 2, hh * 2, r);
        } else {
          g.rect(el.x - hw, el.y - hh, hw * 2, hh * 2);
        }
        g.stroke({ color: SEL_COLOR, width: halo, alpha: SEL_ALPHA });
        break;
      }
      case 'text': {
        const size = el.font_size ?? 1.27;
        const len = (el.text?.length ?? 4) * size * 0.6;
        g.roundRect(
          el.x - len * 0.5 - halo, el.y - size * 0.5 - halo,
          len + halo * 2, size + halo * 2, halo * 0.5,
        );
        g.stroke({ color: SEL_COLOR, width: halo * 0.5, alpha: SEL_ALPHA * 0.7 });
        break;
      }
    }
  }

  // ── Element drawing ───────────────────────────────────────────────────────

  _drawLine(g, el, color) {
    const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
    const r  = sw * 0.5;
    g.moveTo(el.x, el.y).lineTo(el.x2, el.y2);
    g.stroke({ color, width: sw });
    g.circle(el.x, el.y, r).fill({ color });
    g.circle(el.x2, el.y2, r).fill({ color });
  }

  _drawArc(g, el, color) {
    const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
    const hr = sw * 0.5;
    const result = arcFrom3Points(
      { x: el.x,    y: el.y    },
      { x: el.mid_x, y: el.mid_y },
      { x: el.x2,   y: el.y2   },
    );
    if (result.degenerate) {
      g.moveTo(result.x1, result.y1).lineTo(result.x2, result.y2);
      g.stroke({ color, width: sw });
    } else {
      const { cx, cy, r, startAngle, endAngle, anticlockwise } = result;
      g.arc(cx, cy, r, startAngle, endAngle, anticlockwise);
      g.stroke({ color, width: sw });
    }
    g.circle(el.x, el.y, hr).fill({ color });
    g.circle(el.x2, el.y2, hr).fill({ color });
  }

  _drawCircle(g, el, color) {
    const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
    const r  = el.width != null ? el.width * 0.5 : Math.hypot(el.x2 - el.x, el.y2 - el.y);
    g.circle(el.x, el.y, r);
    g.stroke({ color, width: sw, cap: 'round', join: 'round' });
  }

  _drawRect(g, el, color) {
    const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
    g.rect(Math.min(el.x, el.x2), Math.min(el.y, el.y2),
           Math.abs(el.x2 - el.x), Math.abs(el.y2 - el.y));
    g.stroke({ color, width: sw, join: 'round' });
  }

  _drawPolygon(g, el, color) {
    const pts = el.points;
    if (!pts || pts.length < 4) return;
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) {
      g.lineTo(pts[i], pts[i + 1]);
    }
    g.closePath();
    if (el.fill === 'solid' || el.fill === 'yes') {
      g.fill({ color, alpha: 0.85 });
    }
    const sw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
    if (sw > 0) {
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        g.lineTo(pts[i], pts[i + 1]);
      }
      g.closePath();
      g.stroke({ color, width: sw, join: 'round' });
    }
  }

  _drawPad(g, el, color) {
    const sw = effectiveStroke(0.05, this.#scale);
    drawPad(g, el, color, 0x000000, sw);
  }

  _drawPadNumber(tc, el) {
    const num = el.number;
    if (!num) return;
    const size = Math.min(el.width ?? 1, el.height ?? 1) * 0.5;
    if (size < 0.01) return;
    const t = new BitmapText({
      text: String(num),
      style: { fontFamily: 'KiMasterMono', fontSize: size, tint: 0xffffff },
    });
    t.anchor.set(0.5, 0.5);
    t.x = el.x;
    t.y = el.y;
    tc.addChild(t);
  }

  _drawText(tc, el, color) {
    const t = new BitmapText({
      text: el.text ?? '',
      style: { fontFamily: 'KiMasterMono', fontSize: el.font_size ?? 1.27, tint: color },
    });
    t.anchor.set(0.5, 0.5);
    t.x = el.x;
    t.y = el.y;
    tc.addChild(t);
  }
}
