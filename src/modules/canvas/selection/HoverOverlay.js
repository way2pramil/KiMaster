import { Graphics } from 'pixi.js';
import { arcFrom3Points } from '../render/ArcUtils.js';
import { effectiveStroke } from '../render/StrokeUtils.js';

const HOVER_COLOR = 0x00d4ff;
const HOVER_ALPHA = 0.4;

export class HoverOverlay {
  #g;
  #currentId = null;
  #scale     = 1;

  constructor(scene) {
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = 9998;
    scene.addChild(this.#g);
  }

  showForElement(element, viewportScale) {
    this.#scale = viewportScale;
    const sw = Math.max(0.02, 1.2 / viewportScale);
    this.#g.clear();
    this._drawShapeOutline(element, sw);
  }

  show(elementAABB, viewportScale) {
    this.#scale = viewportScale;
    const sw = Math.max(0.02, 1.2 / viewportScale);
    const p  = sw * 0.5;
    this.#g.clear();
    this.#g.roundRect(
      elementAABB.minX - p, elementAABB.minY - p,
      elementAABB.maxX - elementAABB.minX + p * 2,
      elementAABB.maxY - elementAABB.minY + p * 2,
      sw,
    );
    this.#g.stroke({ color: HOVER_COLOR, width: sw, alpha: HOVER_ALPHA });
  }

  hide() {
    this.#g.clear();
    this.#currentId = null;
  }

  get currentId() { return this.#currentId; }
  set currentId(id) { this.#currentId = id; }

  _drawShapeOutline(el, sw) {
    const halo = sw;
    switch (el.type) {
      case 'line': {
        const esw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
        this.#g.moveTo(el.x, el.y).lineTo(el.x2, el.y2);
        this.#g.stroke({ color: HOVER_COLOR, width: esw + halo * 2, alpha: HOVER_ALPHA });
        break;
      }
      case 'arc': {
        const esw = effectiveStroke(el.stroke_width ?? 0.12, this.#scale);
        const result = arcFrom3Points(
          { x: el.x, y: el.y },
          { x: el.mid_x, y: el.mid_y },
          { x: el.x2, y: el.y2 },
        );
        if (result.degenerate) {
          this.#g.moveTo(result.x1, result.y1).lineTo(result.x2, result.y2);
        } else {
          this.#g.arc(result.cx, result.cy, result.r, result.startAngle, result.endAngle, result.anticlockwise);
        }
        this.#g.stroke({ color: HOVER_COLOR, width: esw + halo * 2, alpha: HOVER_ALPHA });
        break;
      }
      case 'circle': {
        const r = el.width != null ? el.width * 0.5 : Math.hypot(el.x2 - el.x, el.y2 - el.y);
        this.#g.circle(el.x, el.y, r);
        this.#g.stroke({ color: HOVER_COLOR, width: halo * 2, alpha: HOVER_ALPHA });
        break;
      }
      case 'rect': {
        const rx = Math.min(el.x, el.x2) - halo;
        const ry = Math.min(el.y, el.y2) - halo;
        const rw = Math.abs(el.x2 - el.x) + halo * 2;
        const rh = Math.abs(el.y2 - el.y) + halo * 2;
        this.#g.roundRect(rx, ry, rw, rh, halo);
        this.#g.stroke({ color: HOVER_COLOR, width: sw, alpha: HOVER_ALPHA });
        break;
      }
      case 'polygon': {
        const pts = el.points;
        if (!pts || pts.length < 4) return;
        this.#g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) this.#g.lineTo(pts[i], pts[i + 1]);
        this.#g.closePath();
        this.#g.stroke({ color: HOVER_COLOR, width: halo * 2, join: 'round', alpha: HOVER_ALPHA });
        break;
      }
      case 'pad':
      case 'pin': {
        const hw = (el.width ?? 1) * 0.5 + halo;
        const hh = (el.height ?? 1) * 0.5 + halo;
        const shape = el.shape ?? 'rect';
        if (shape === 'circle') {
          this.#g.circle(el.x, el.y, hw);
        } else if (shape === 'oval') {
          this.#g.roundRect(el.x - hw, el.y - hh, hw * 2, hh * 2, Math.min(hw, hh));
        } else if (shape === 'roundrect') {
          const rr = (el.roundrect_ratio ?? 0.25) * Math.min(hw, hh);
          this.#g.roundRect(el.x - hw, el.y - hh, hw * 2, hh * 2, rr);
        } else {
          this.#g.rect(el.x - hw, el.y - hh, hw * 2, hh * 2);
        }
        this.#g.stroke({ color: HOVER_COLOR, width: sw, alpha: HOVER_ALPHA });
        break;
      }
      case 'text': {
        const size = el.font_size ?? 1.27;
        const len = (el.text?.length ?? 4) * size * 0.6;
        this.#g.roundRect(
          el.x - len * 0.5 - halo, el.y - size * 0.5 - halo,
          len + halo * 2, size + halo * 2, halo,
        );
        this.#g.stroke({ color: HOVER_COLOR, width: sw, alpha: HOVER_ALPHA * 0.7 });
        break;
      }
    }
  }
}
