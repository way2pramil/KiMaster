/**
 * MarqueeTool — rubber-band marquee selection.
 *
 * Activated by dragging on empty space (no element under pointer).
 * Selection computed at pointerup (not per-frame) to avoid O(n) per event.
 *
 * @module MarqueeTool
 */

import { ToolBase } from './ToolBase.js';

const DRAG_THRESHOLD_PX = 4;

export class MarqueeTool extends ToolBase {
  static id = 'marquee';

  /** @type {'idle'|'pressed'|'dragging'} */
  #state = 'idle';

  /** Screen-space pointerdown position */
  #pressScreen = { x: 0, y: 0 };

  onActivate() { this.#state = 'idle'; }
  onDeactivate() { this.ctx.marquee.cancel(); this.#state = 'idle'; }

  onPointerDown(e) {
    const { global: g, target } = e;
    if (target && target.label) return; // element under pointer — SelectTool's job
    this.#pressScreen = { x: g.x, y: g.y };
    this.#state = 'pressed';
    this.ctx.viewport.pause = true;

    const world = this.ctx.viewport.toWorld(g.x, g.y);
    this.ctx.marquee.begin(world.x, world.y);
  }

  onPointerMove(e) {
    if (this.#state !== 'pressed' && this.#state !== 'dragging') return;
    const { global: g } = e;
    const dx = g.x - this.#pressScreen.x, dy = g.y - this.#pressScreen.y;
    if (this.#state === 'pressed' && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.#state = 'dragging';

    const world = this.ctx.viewport.toWorld(g.x, g.y);
    this.ctx.marquee.update(world.x, world.y);
  }

  onPointerUp(e) {
    this.ctx.viewport.pause = false;

    if (this.#state === 'dragging') {
      const world  = this.ctx.viewport.toWorld(e.global.x, e.global.y);
      const bounds = this.ctx.marquee.end(world.x, world.y);
      if (bounds) this.ctx.selection.selectInBounds(bounds);
    } else {
      this.ctx.marquee.cancel();
    }
    this.#state = 'idle';
  }
}
