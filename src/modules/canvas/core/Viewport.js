/**
 * Viewport — coordinate transforms and zoom helpers.
 *
 * Thin wrapper around pixi-viewport that adds KiCad-specific helpers.
 * All coordinates in world units (mm) unless noted.
 *
 * @module Viewport
 */

export class ViewportHelper {
  /** @type {import('pixi-viewport').Viewport} */
  #vp;

  /** @param {import('pixi-viewport').Viewport} viewport */
  constructor(viewport) {
    this.#vp = viewport;
  }

  /** Screen → world transform. */
  screenToWorld(screenX, screenY) {
    return this.#vp.toWorld(screenX, screenY);
  }

  /** World → screen transform. */
  worldToScreen(worldX, worldY) {
    return this.#vp.toScreen(worldX, worldY);
  }

  /** Current zoom scale (world units per screen pixel). */
  get scale() {
    return this.#vp.scaled;
  }

  /**
   * Zoom-to-fit all given elements into the viewport with padding.
   * @param {object[]} elements EDAElement[]
   * @param {number} [paddingMm=5]
   */
  fitElements(elements, paddingMm = 5, animate = true) {
    if (!elements.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const hw = (el.width  ?? 0) * 0.5;
      const hh = (el.height ?? 0) * 0.5;
      minX = Math.min(minX, el.x - hw);
      minY = Math.min(minY, el.y - hh);
      maxX = Math.max(maxX, el.x + hw);
      maxY = Math.max(maxY, el.y + hh);
    }
    const w  = maxX - minX + paddingMm * 2;
    const h  = maxY - minY + paddingMm * 2;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    const scaleX = this.#vp.screenWidth  / w;
    const scaleY = this.#vp.screenHeight / h;
    const s      = Math.min(scaleX, scaleY, 200);

    if (animate) {
      this.#vp.animate({ position: { x: cx, y: cy }, scale: s, time: 300, ease: 'easeInOutSine' });
    } else {
      this.#vp.setZoom(s, true);
      this.#vp.moveCenter(cx, cy);
    }
  }

  resetZoom(animate = true) {
    if (animate) {
      this.#vp.animate({ scale: 1, time: 200, ease: 'easeInOutSine' });
    } else {
      this.#vp.setZoom(1, true);
    }
  }

  zoomTo(scale, animate = true) {
    if (animate) {
      this.#vp.animate({ scale, time: 200, ease: 'easeInOutSine' });
    } else {
      this.#vp.setZoom(scale, true);
    }
  }

  /**
   * Visible world bounds (AABB of current viewport).
   * @returns {{ minX, minY, maxX, maxY }}
   */
  get worldBounds() {
    const tl = this.#vp.toWorld(0, 0);
    const br = this.#vp.toWorld(this.#vp.screenWidth, this.#vp.screenHeight);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }
}
