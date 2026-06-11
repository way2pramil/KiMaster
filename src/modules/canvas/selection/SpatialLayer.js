import { Container, Rectangle } from 'pixi.js';

const HIT_PAD = 0.3;

export class SpatialLayer {
  #items = new Map();
  #scene;

  constructor(scene) {
    this.#scene = scene;
  }

  load(elements) {
    this.clear();
    for (const el of elements) {
      this._addElement(el);
    }
  }

  _addElement(el) {
    const container = this._isSelectable(el) ? this._makeContainer(el) : null;
    this.#items.set(el.id, { element: el, container });
    if (container) this.#scene.addChild(container);
  }

  get(id) {
    return this.#items.get(id) ?? null;
  }

  update(id, data) {
    const rec = this.#items.get(id);
    if (!rec) return;
    Object.assign(rec.element, data);
    if (rec.container) {
      const b  = this.elementAABB(rec.element);
      const cx = (b.minX + b.maxX) * 0.5;
      const cy = (b.minY + b.maxY) * 0.5;
      const hw = (b.maxX - b.minX) * 0.5;
      const hh = (b.maxY - b.minY) * 0.5;
      rec.container.x = cx;
      rec.container.y = cy;
      rec.container.hitArea = new Rectangle(-hw, -hh, hw * 2, hh * 2);
    }
  }

  remove(id) {
    const rec = this.#items.get(id);
    if (!rec) return;
    if (rec.container) {
      this.#scene.removeChild(rec.container);
      rec.container.destroy();
    }
    this.#items.delete(id);
  }

  search(bounds, contain = false) {
    const result = [];
    for (const { element } of this.#items.values()) {
      const b = this.elementAABB(element);
      if (contain) {
        if (b.minX >= bounds.minX && b.maxX <= bounds.maxX &&
            b.minY >= bounds.minY && b.maxY <= bounds.maxY) {
          result.push(element);
        }
      } else {
        if (b.maxX >= bounds.minX && b.minX <= bounds.maxX &&
            b.maxY >= bounds.minY && b.minY <= bounds.maxY) {
          result.push(element);
        }
      }
    }
    return result;
  }

  hitTestPoint(worldX, worldY, toleranceWorld) {
    let best = null;
    let bestDist = toleranceWorld;

    for (const { element } of this.#items.values()) {
      if (!this._isSelectable(element)) continue;
      const b = this.elementAABB(element);
      if (worldX < b.minX - toleranceWorld || worldX > b.maxX + toleranceWorld ||
          worldY < b.minY - toleranceWorld || worldY > b.maxY + toleranceWorld) continue;

      const d = this._distanceToElement(element, worldX, worldY);
      if (d < bestDist) {
        bestDist = d;
        best = element;
      }
    }
    return best;
  }

  lineEndpointHitTest(worldX, worldY, toleranceWorld) {
    for (const { element } of this.#items.values()) {
      if (element.type !== 'line') continue;
      const d1 = Math.hypot(worldX - element.x, worldY - element.y);
      if (d1 < toleranceWorld) return { element, endpoint: 'start' };
      const d2 = Math.hypot(worldX - element.x2, worldY - element.y2);
      if (d2 < toleranceWorld) return { element, endpoint: 'end' };
    }
    return null;
  }

  cullToViewport(viewportBounds) {
    for (const { element, container } of this.#items.values()) {
      if (!container) continue;
      const b = this.elementAABB(element);
      container.visible = (
        b.maxX >= viewportBounds.minX && b.minX <= viewportBounds.maxX &&
        b.maxY >= viewportBounds.minY && b.minY <= viewportBounds.maxY
      );
    }
  }

  clear() {
    for (const { container } of this.#items.values()) {
      if (container) {
        this.#scene.removeChild(container);
        container.destroy();
      }
    }
    this.#items.clear();
  }

  ids() { return this.#items.keys(); }

  allElements() {
    return [...this.#items.values()]
      .filter(r => this._isSelectable(r.element))
      .map(r => r.element);
  }

  selectionBounds(ids) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
    for (const id of ids) {
      const rec = this.#items.get(id);
      if (!rec) continue;
      const b = this.elementAABB(rec.element);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
      count++;
    }
    if (!count) return null;
    return { minX, minY, maxX, maxY };
  }

  _distanceToElement(el, wx, wy) {
    switch (el.type) {
      case 'line': return this._distToSegment(wx, wy, el.x, el.y, el.x2, el.y2);
      case 'arc': {
        const d1 = this._distToSegment(wx, wy, el.x, el.y, el.mid_x ?? el.x, el.mid_y ?? el.y);
        const d2 = this._distToSegment(wx, wy, el.mid_x ?? el.x, el.mid_y ?? el.y, el.x2, el.y2);
        return Math.min(d1, d2);
      }
      case 'circle': {
        const r = el.width != null ? el.width * 0.5 : Math.hypot((el.x2 ?? el.x) - el.x, (el.y2 ?? el.y) - el.y);
        return Math.abs(Math.hypot(wx - el.x, wy - el.y) - r);
      }
      case 'rect': {
        const rx = Math.min(el.x, el.x2), ry = Math.min(el.y, el.y2);
        const rw = Math.abs(el.x2 - el.x), rh = Math.abs(el.y2 - el.y);
        return this._distToRect(wx, wy, rx, ry, rw, rh);
      }
      case 'pad':
      case 'pin': {
        const hw = (el.width ?? 1) * 0.5;
        const hh = (el.height ?? 1) * 0.5;
        const angle = (el.angle ?? 0) * Math.PI / 180;
        let lx = wx - el.x, ly = wy - el.y;
        if (angle) {
          const cos = Math.cos(-angle), sin = Math.sin(-angle);
          const rx = lx * cos - ly * sin;
          const ry = lx * sin + ly * cos;
          lx = rx; ly = ry;
        }
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return 0;
        const dx = Math.max(0, Math.abs(lx) - hw);
        const dy = Math.max(0, Math.abs(ly) - hh);
        return Math.hypot(dx, dy);
      }
      case 'polygon': {
        const pts = el.points ?? [];
        if (pts.length < 6) return Math.hypot(wx - el.x, wy - el.y);
        if ((el.fill === 'solid' || el.fill === 'yes') && this._pointInPolygon(wx, wy, pts)) {
          return 0;
        }
        let minD = Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          const ni = (i + 2) % pts.length;
          const d = this._distToSegment(wx, wy, pts[i], pts[i + 1], pts[ni], pts[ni + 1]);
          if (d < minD) minD = d;
        }
        return minD;
      }
      default: {
        const b = this.elementAABB(el);
        const cx = (b.minX + b.maxX) * 0.5;
        const cy = (b.minY + b.maxY) * 0.5;
        return Math.hypot(wx - cx, wy - cy);
      }
    }
  }

  _pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1];
      const xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  _distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  _distToRect(px, py, rx, ry, rw, rh) {
    const d1 = this._distToSegment(px, py, rx,      ry,      rx + rw, ry);
    const d2 = this._distToSegment(px, py, rx + rw, ry,      rx + rw, ry + rh);
    const d3 = this._distToSegment(px, py, rx + rw, ry + rh, rx,      ry + rh);
    const d4 = this._distToSegment(px, py, rx,      ry + rh, rx,      ry);
    return Math.min(d1, d2, d3, d4);
  }

  _isSelectable(el) {
    return el.type === 'pad'     ||
           el.type === 'pin'     ||
           el.type === 'line'    ||
           el.type === 'arc'     ||
           el.type === 'circle'  ||
           el.type === 'rect'    ||
           el.type === 'polygon' ||
           el.type === 'text';
  }

  elementAABB(el) {
    switch (el.type) {
      case 'pad':
      case 'pin': {
        const hw = (el.width  ?? 1) * 0.5;
        const hh = (el.height ?? 1) * 0.5;
        return { minX: el.x - hw, minY: el.y - hh, maxX: el.x + hw, maxY: el.y + hh };
      }
      case 'line': {
        const p = Math.max((el.stroke_width ?? 0.12) * 0.5, HIT_PAD);
        return {
          minX: Math.min(el.x, el.x2) - p,
          minY: Math.min(el.y, el.y2) - p,
          maxX: Math.max(el.x, el.x2) + p,
          maxY: Math.max(el.y, el.y2) + p,
        };
      }
      case 'arc': {
        const p    = Math.max((el.stroke_width ?? 0.12) * 0.5, HIT_PAD);
        const xs   = [el.x, el.x2, el.mid_x ?? el.x];
        const ys   = [el.y, el.y2, el.mid_y ?? el.y];
        return {
          minX: Math.min(...xs) - p,
          minY: Math.min(...ys) - p,
          maxX: Math.max(...xs) + p,
          maxY: Math.max(...ys) + p,
        };
      }
      case 'circle': {
        const r = (el.width != null
          ? el.width * 0.5
          : Math.hypot((el.x2 ?? el.x) - el.x, (el.y2 ?? el.y) - el.y)) + HIT_PAD;
        return { minX: el.x - r, minY: el.y - r, maxX: el.x + r, maxY: el.y + r };
      }
      case 'rect': {
        const p = Math.max((el.stroke_width ?? 0.12) * 0.5, HIT_PAD);
        return {
          minX: Math.min(el.x, el.x2) - p,
          minY: Math.min(el.y, el.y2) - p,
          maxX: Math.max(el.x, el.x2) + p,
          maxY: Math.max(el.y, el.y2) + p,
        };
      }
      case 'polygon': {
        const pts = el.points ?? [];
        if (pts.length < 4) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        let mnX = pts[0], mxX = pts[0], mnY = pts[1], mxY = pts[1];
        for (let i = 2; i < pts.length; i += 2) {
          if (pts[i] < mnX) mnX = pts[i];
          if (pts[i] > mxX) mxX = pts[i];
          if (pts[i + 1] < mnY) mnY = pts[i + 1];
          if (pts[i + 1] > mxY) mxY = pts[i + 1];
        }
        return { minX: mnX - HIT_PAD, minY: mnY - HIT_PAD, maxX: mxX + HIT_PAD, maxY: mxY + HIT_PAD };
      }
      case 'text': {
        const size = el.font_size ?? 1.27;
        const len  = (el.text?.length ?? 4) * size * 0.6;
        return {
          minX: el.x - len * 0.5,
          minY: el.y - size * 0.5,
          maxX: el.x + len * 0.5,
          maxY: el.y + size * 0.5,
        };
      }
      default: {
        const hw = (el.width  ?? 1) * 0.5;
        const hh = (el.height ?? 1) * 0.5;
        return { minX: el.x - hw, minY: el.y - hh, maxX: el.x + hw, maxY: el.y + hh };
      }
    }
  }

  _makeContainer(el) {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor    = 'pointer';
    c.label     = el.id;

    const b  = this.elementAABB(el);
    const cx = (b.minX + b.maxX) * 0.5;
    const cy = (b.minY + b.maxY) * 0.5;
    const hw = (b.maxX - b.minX) * 0.5;
    const hh = (b.maxY - b.minY) * 0.5;
    c.x = cx;
    c.y = cy;
    c.hitArea = new Rectangle(-hw, -hh, hw * 2, hh * 2);
    return c;
  }
}
