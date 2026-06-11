import { Graphics } from 'pixi.js';

const CP_SCREEN_PX  = 5;
const CP_FILL       = 0xffffff;
const CP_STROKE     = 0x00d4ff;
const CP_ACTIVE     = 0xff6644;
const BBOX_COLOR    = 0x00d4ff;

export class ControlPoints {
  #g;
  #scene;
  #points = [];
  #scale  = 1;
  #elementId = null;

  constructor(scene) {
    this.#scene = scene;
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = 9999;
    scene.addChild(this.#g);
  }

  showForElement(element, viewportScale) {
    this.#scale     = viewportScale;
    this.#elementId = element.id;
    this.#points    = this._computePoints(element);
    this._redraw();
  }

  showBBoxForMulti(bounds, viewportScale) {
    this.#scale     = viewportScale;
    this.#elementId = null;
    this.#points    = this._bboxHandles(bounds);
    this._redraw(bounds);
  }

  hide() {
    this.#points    = [];
    this.#elementId = null;
    this.#g.clear();
  }

  hitTest(worldX, worldY) {
    const r = (CP_SCREEN_PX * 1.2) / this.#scale;
    for (const cp of this.#points) {
      if (Math.hypot(worldX - cp.x, worldY - cp.y) <= r) return cp;
    }
    return null;
  }

  cursorForPoint(cp) {
    if (!cp) return 'default';
    if (cp.role === 'vertex' || cp.role === 'endpoint') return 'crosshair';
    if (cp.role === 'center') return 'move';
    if (cp.role === 'radius') return 'ew-resize';
    if (cp.role === 'corner') return 'nwse-resize';
    if (cp.role === 'bbox-corner' || cp.role === 'bbox-edge') return 'nwse-resize';
    return 'pointer';
  }

  applyDrag(cp, element, worldX, worldY, snappedPt) {
    const pt = snappedPt || { x: worldX, y: worldY };
    const updates = {};

    switch (cp.role) {
      case 'endpoint':
        if (cp.key === 'start') { updates.x = pt.x; updates.y = pt.y; }
        else { updates.x2 = pt.x; updates.y2 = pt.y; }
        break;

      case 'center':
        updates.x = pt.x;
        updates.y = pt.y;
        break;

      case 'radius': {
        const r = Math.hypot(pt.x - element.x, pt.y - element.y);
        if (element.width != null) updates.width = r * 2;
        else { updates.x2 = pt.x; updates.y2 = pt.y; }
        break;
      }

      case 'mid':
        updates.mid_x = pt.x;
        updates.mid_y = pt.y;
        break;

      case 'corner': {
        const ci = cp.index;
        if (element.type === 'rect') {
          if (ci === 0) { updates.x = pt.x; updates.y = pt.y; }
          else if (ci === 1) { updates.x2 = pt.x; updates.y = pt.y; }
          else if (ci === 2) { updates.x2 = pt.x; updates.y2 = pt.y; }
          else { updates.x = pt.x; updates.y2 = pt.y; }
        }
        break;
      }

      case 'vertex': {
        const vi = cp.index;
        if (element.points && vi * 2 + 1 < element.points.length) {
          const pts = [...element.points];
          pts[vi * 2]     = pt.x;
          pts[vi * 2 + 1] = pt.y;
          updates.points = pts;
        }
        break;
      }

      case 'oval-corner': {
        const ci = cp.index;
        const cx = element.x, cy = element.y;
        const dx = Math.abs(pt.x - cx);
        const dy = Math.abs(pt.y - cy);
        updates.width  = dx * 2;
        updates.height = dy * 2;
        break;
      }

      case 'bbox-corner': {
        return this._bboxResize(cp, pt);
      }
      case 'bbox-edge': {
        return this._bboxResize(cp, pt);
      }
    }
    return updates;
  }

  get points() { return this.#points; }
  get elementId() { return this.#elementId; }

  _computePoints(el) {
    switch (el.type) {
      case 'line': return [
        { x: el.x,  y: el.y,  role: 'endpoint', key: 'start' },
        { x: el.x2, y: el.y2, role: 'endpoint', key: 'end'   },
      ];

      case 'circle': {
        const r = el.width != null
          ? el.width * 0.5
          : Math.hypot((el.x2 ?? el.x) - el.x, (el.y2 ?? el.y) - el.y);
        return [
          { x: el.x,     y: el.y,     role: 'center' },
          { x: el.x + r, y: el.y,     role: 'radius' },
          { x: el.x,     y: el.y - r, role: 'radius' },
          { x: el.x - r, y: el.y,     role: 'radius' },
          { x: el.x,     y: el.y + r, role: 'radius' },
        ];
      }

      case 'arc': return [
        { x: el.x,                  y: el.y,                  role: 'endpoint', key: 'start' },
        { x: el.mid_x ?? el.x,     y: el.mid_y ?? el.y,     role: 'mid',      key: 'mid'   },
        { x: el.x2,                 y: el.y2,                 role: 'endpoint', key: 'end'   },
      ];

      case 'rect': {
        const x1 = Math.min(el.x, el.x2), y1 = Math.min(el.y, el.y2);
        const x2 = Math.max(el.x, el.x2), y2 = Math.max(el.y, el.y2);
        return [
          { x: x1, y: y1, role: 'corner', index: 0 },
          { x: x2, y: y1, role: 'corner', index: 1 },
          { x: x2, y: y2, role: 'corner', index: 2 },
          { x: x1, y: y2, role: 'corner', index: 3 },
        ];
      }

      case 'polygon': {
        const pts = el.points ?? [];
        const result = [];
        for (let i = 0; i < pts.length; i += 2) {
          result.push({ x: pts[i], y: pts[i + 1], role: 'vertex', index: i / 2 });
        }
        return result;
      }

      case 'pad':
      case 'pin': {
        const hw = (el.width  ?? 1) * 0.5;
        const hh = (el.height ?? 1) * 0.5;
        return [
          { x: el.x,      y: el.y,      role: 'center' },
          { x: el.x + hw, y: el.y - hh, role: 'oval-corner', index: 0 },
          { x: el.x + hw, y: el.y + hh, role: 'oval-corner', index: 1 },
          { x: el.x - hw, y: el.y + hh, role: 'oval-corner', index: 2 },
          { x: el.x - hw, y: el.y - hh, role: 'oval-corner', index: 3 },
        ];
      }

      case 'text':
        return [{ x: el.x, y: el.y, role: 'center' }];

      default: return [];
    }
  }

  _bboxHandles(bounds) {
    if (!bounds) return [];
    const { minX, minY, maxX, maxY } = bounds;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    return [
      { x: minX, y: minY, role: 'bbox-corner', anchor: 'nw', bounds },
      { x: cx,   y: minY, role: 'bbox-edge',   anchor: 'n',  bounds },
      { x: maxX, y: minY, role: 'bbox-corner', anchor: 'ne', bounds },
      { x: maxX, y: cy,   role: 'bbox-edge',   anchor: 'e',  bounds },
      { x: maxX, y: maxY, role: 'bbox-corner', anchor: 'se', bounds },
      { x: cx,   y: maxY, role: 'bbox-edge',   anchor: 's',  bounds },
      { x: minX, y: maxY, role: 'bbox-corner', anchor: 'sw', bounds },
      { x: minX, y: cy,   role: 'bbox-edge',   anchor: 'w',  bounds },
    ];
  }

  _bboxResize(cp, pt) {
    const b = { ...cp.bounds };
    switch (cp.anchor) {
      case 'nw': b.minX = pt.x; b.minY = pt.y; break;
      case 'n':  b.minY = pt.y; break;
      case 'ne': b.maxX = pt.x; b.minY = pt.y; break;
      case 'e':  b.maxX = pt.x; break;
      case 'se': b.maxX = pt.x; b.maxY = pt.y; break;
      case 's':  b.maxY = pt.y; break;
      case 'sw': b.minX = pt.x; b.maxY = pt.y; break;
      case 'w':  b.minX = pt.x; break;
    }
    if (b.minX > b.maxX) { const t = b.minX; b.minX = b.maxX; b.maxX = t; }
    if (b.minY > b.maxY) { const t = b.minY; b.minY = b.maxY; b.maxY = t; }
    return { __bbox: true, bounds: b };
  }

  _redraw(bboxBounds) {
    this.#g.clear();
    const sw = Math.max(0.02, 1.0 / this.#scale);
    const hr = CP_SCREEN_PX / this.#scale;

    if (bboxBounds) {
      const b = bboxBounds;
      this.#g.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      this.#g.stroke({ color: BBOX_COLOR, width: sw, alpha: 0.5 });
    }

    for (const cp of this.#points) {
      if (cp.role === 'center') {
        this.#g.circle(cp.x, cp.y, hr);
        this.#g.fill({ color: CP_FILL, alpha: 0.9 });
        this.#g.circle(cp.x, cp.y, hr);
        this.#g.stroke({ color: CP_STROKE, width: sw });
        const crossSz = hr * 0.6;
        this.#g.moveTo(cp.x - crossSz, cp.y).lineTo(cp.x + crossSz, cp.y);
        this.#g.moveTo(cp.x, cp.y - crossSz).lineTo(cp.x, cp.y + crossSz);
        this.#g.stroke({ color: CP_STROKE, width: sw * 0.7 });
      } else {
        this.#g.rect(cp.x - hr, cp.y - hr, hr * 2, hr * 2);
        this.#g.fill({ color: CP_FILL, alpha: 0.9 });
        this.#g.rect(cp.x - hr, cp.y - hr, hr * 2, hr * 2);
        this.#g.stroke({ color: CP_STROKE, width: sw });
      }
    }
  }
}
