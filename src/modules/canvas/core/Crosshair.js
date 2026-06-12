import { Graphics } from 'pixi.js';

const COLOR  = 0x555555;
const ALPHA  = 0.35;

export class Crosshair {
  #g;
  #viewport;
  #visible = true;

  constructor(scene, viewport) {
    this.#viewport = viewport;
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = -500;
    scene.addChild(this.#g);
  }

  update(worldX, worldY) {
    if (!this.#visible) return;
    this.#g.clear();

    const vp    = this.#viewport;
    const tl    = vp.toWorld(0, 0);
    const br    = vp.toWorld(vp.screenWidth, vp.screenHeight);
    const sw    = Math.max(0.01, 0.5 / vp.scaled);

    // Horizontal line
    this.#g.moveTo(tl.x, worldY).lineTo(br.x, worldY);
    // Vertical line
    this.#g.moveTo(worldX, tl.y).lineTo(worldX, br.y);
    this.#g.stroke({ color: COLOR, width: sw, alpha: ALPHA });
  }

  hide() {
    this.#g.clear();
  }

  set visible(v) {
    this.#visible = v;
    if (!v) this.#g.clear();
  }

  get visible() { return this.#visible; }
}
