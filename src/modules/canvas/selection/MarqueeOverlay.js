import { Graphics } from 'pixi.js';

const CONTAIN_FILL     = 0xffdd00;
const INTERSECT_FILL   = 0x4488ff;
const FILL_ALPHA       = 0.10;
const CONTAIN_STROKE   = 0xccaa00;
const INTERSECT_STROKE = 0x4488ff;

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
    this.#g.rect(rx, ry, rw, rh);
    this.#g.fill({ color: fillColor, alpha: FILL_ALPHA });
    this.#g.rect(rx, ry, rw, rh);
    if (isIntersect) {
      this.#g.stroke({ color: strokeColor, width: sw, alpha: 0.6 });
    } else {
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
}
