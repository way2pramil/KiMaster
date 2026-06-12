import { Graphics } from 'pixi.js';

const CONTAIN_FILL     = 0xffdd00;
const INTERSECT_FILL   = 0x4488ff;
const FILL_ALPHA       = 0.10;
const CONTAIN_STROKE   = 0xccaa00;
const INTERSECT_STROKE = 0x4488ff;
const DASH_LENGTH      = 6;
const GAP_LENGTH       = 4;

export class MarqueeOverlay {
  #g;
  #start = null;
  #scale = 1;

  constructor(scene) {
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.visible   = false;
    this.#g.zIndex    = 10000;
    scene.addChild(this.#g);
  }

  begin(x, y) {
    this.#start  = { x, y };
    this.#g.visible = true;
  }

  update(x, y) {
    if (!this.#start) return;
    const { x: sx, y: sy } = this.#start;
    const rx = Math.min(sx, x), ry = Math.min(sy, y);
    const rw = Math.abs(x - sx), rh = Math.abs(y - sy);

    const isIntersect = x < sx;
    const fillColor   = isIntersect ? INTERSECT_FILL   : CONTAIN_FILL;
    const strokeColor = isIntersect ? INTERSECT_STROKE : CONTAIN_STROKE;
    const sw = Math.max(0.02, 1.0 / this.#scale);

    this.#g.clear();

    // Fill
    this.#g.rect(rx, ry, rw, rh);
    this.#g.fill({ color: fillColor, alpha: FILL_ALPHA });

    if (isIntersect) {
      // Dashed border for intersect/crossing selection
      this._dashedRect(rx, ry, rw, rh, sw, strokeColor);
    } else {
      this.#g.rect(rx, ry, rw, rh);
      this.#g.stroke({ color: strokeColor, width: sw });
    }
  }

  end(x, y) {
    if (!this.#start) return null;
    const { x: sx, y: sy } = this.#start;
    this.#start = null;
    this.#g.clear();
    this.#g.visible = false;
    return {
      minX: Math.min(sx, x),
      minY: Math.min(sy, y),
      maxX: Math.max(sx, x),
      maxY: Math.max(sy, y),
    };
  }

  cancel() {
    this.#start = null;
    this.#g.clear();
    this.#g.visible = false;
  }

  setScale(scale) {
    this.#scale = scale;
  }

  _dashedRect(x, y, w, h, sw, color) {
    const dash = DASH_LENGTH / this.#scale;
    const gap  = GAP_LENGTH / this.#scale;
    const opts = { color, width: sw, alpha: 0.7 };

    // Top edge
    this._dashedLine(x, y, x + w, y, dash, gap, opts);
    // Right edge
    this._dashedLine(x + w, y, x + w, y + h, dash, gap, opts);
    // Bottom edge
    this._dashedLine(x + w, y + h, x, y + h, dash, gap, opts);
    // Left edge
    this._dashedLine(x, y + h, x, y, dash, gap, opts);
  }

  _dashedLine(x1, y1, x2, y2, dash, gap, opts) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = dx / len, ny = dy / len;
    let d = 0;
    let drawing = true;

    while (d < len) {
      const seg = drawing ? dash : gap;
      const end = Math.min(d + seg, len);
      if (drawing) {
        this.#g.moveTo(x1 + nx * d, y1 + ny * d);
        this.#g.lineTo(x1 + nx * end, y1 + ny * end);
        this.#g.stroke(opts);
      }
      d = end;
      drawing = !drawing;
    }
  }
}
