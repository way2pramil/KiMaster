import { ToolBase } from './ToolBase.js';

export class PanTool extends ToolBase {
  static id = 'pan';

  #active = false;
  #origin = { x: 0, y: 0 };
  #vpOrigin = { x: 0, y: 0 };

  onActivate() {
    this.#active = false;
    this._setCursor('grab');
  }

  onDeactivate() {
    this._setCursor('');
    this.#active = false;
  }

  onPointerDown(e) {
    this.#active  = true;
    this.#origin  = { x: e.global.x, y: e.global.y };
    const vp = this.ctx.viewport;
    this.#vpOrigin = { x: vp.x, y: vp.y };
    this.ctx.viewport.pause = true;
    this._setCursor('grabbing');
  }

  onPointerMove(e) {
    if (!this.#active) return;
    const dx = e.global.x - this.#origin.x;
    const dy = e.global.y - this.#origin.y;
    this.ctx.viewport.x = this.#vpOrigin.x + dx;
    this.ctx.viewport.y = this.#vpOrigin.y + dy;
  }

  onPointerUp() {
    this.#active = false;
    this.ctx.viewport.pause = false;
    this._setCursor('grab');
  }

  onPointerLeave() {
    if (this.#active) {
      this.#active = false;
      this.ctx.viewport.pause = false;
      this._setCursor('grab');
    }
  }

  _setCursor(cursor) {
    const canvas = this.ctx.viewport.options?.events?.domElement;
    if (canvas) canvas.style.cursor = cursor;
    else document.body.style.cursor = cursor;
  }
}
