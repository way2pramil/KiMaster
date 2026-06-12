import { Graphics } from 'pixi.js';

const GUIDE_COLOR = 0xff44aa;
const GUIDE_ALPHA = 0.5;
const SNAP_THRESH_PX = 6;

export class AlignGuides {
  #g;
  #viewport;
  #spatial;
  #anchors = [];

  constructor(scene, viewport, spatial) {
    this.#viewport = viewport;
    this.#spatial  = spatial;
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = 9400;
    scene.addChild(this.#g);
  }

  buildAnchors(excludeIds) {
    this.#anchors = [];
    for (const el of this.#spatial.allElements()) {
      if (excludeIds.has(el.id)) continue;
      const b = this.#spatial.elementAABB(el);
      const cx = (b.minX + b.maxX) * 0.5;
      const cy = (b.minY + b.maxY) * 0.5;
      this.#anchors.push(
        { x: cx, y: cy },
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
        { x: b.maxX, y: b.minY },
      );
    }
  }

  check(bounds) {
    this.#g.clear();
    if (!this.#anchors.length) return null;

    const scale  = this.#viewport.scaled;
    const thresh = SNAP_THRESH_PX / scale;
    const sw     = Math.max(0.01, 0.7 / scale);
    const vp     = this.#viewport;
    const tl     = vp.toWorld(0, 0);
    const br     = vp.toWorld(vp.screenWidth, vp.screenHeight);

    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;

    const testPoints = [
      { x: cx, y: cy },
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY },
    ];

    let snapX = null, snapY = null;
    let bestDx = thresh, bestDy = thresh;
    let matchedTpX = null, matchedTpY = null;

    for (const tp of testPoints) {
      for (const anchor of this.#anchors) {
        const dx = Math.abs(tp.x - anchor.x);
        const dy = Math.abs(tp.y - anchor.y);
        if (dx < bestDx) { bestDx = dx; snapX = anchor.x; matchedTpX = tp.x; }
        if (dy < bestDy) { bestDy = dy; snapY = anchor.y; matchedTpY = tp.y; }
      }
    }

    if (snapX !== null) {
      this.#g.moveTo(snapX, tl.y).lineTo(snapX, br.y);
      this.#g.stroke({ color: GUIDE_COLOR, width: sw, alpha: GUIDE_ALPHA });
    }
    if (snapY !== null) {
      this.#g.moveTo(tl.x, snapY).lineTo(br.x, snapY);
      this.#g.stroke({ color: GUIDE_COLOR, width: sw, alpha: GUIDE_ALPHA });
    }

    return {
      snapX, snapY,
      deltaX: snapX !== null ? snapX - matchedTpX : 0,
      deltaY: snapY !== null ? snapY - matchedTpY : 0,
    };
  }

  hide() {
    this.#g.clear();
    this.#anchors = [];
  }
}
