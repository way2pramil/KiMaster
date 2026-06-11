import { Graphics } from 'pixi.js';

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

  show(elementAABB, viewportScale) {
    this.#scale = viewportScale;
    const sw = Math.max(0.02, 1.2 / viewportScale);
    const p  = sw * 0.5;
    this.#g.clear();
    this.#g.rect(
      elementAABB.minX - p, elementAABB.minY - p,
      elementAABB.maxX - elementAABB.minX + p * 2,
      elementAABB.maxY - elementAABB.minY + p * 2,
    );
    this.#g.stroke({ color: HOVER_COLOR, width: sw, alpha: HOVER_ALPHA });
  }

  hide() {
    this.#g.clear();
    this.#currentId = null;
  }

  get currentId() { return this.#currentId; }
  set currentId(id) { this.#currentId = id; }
}
