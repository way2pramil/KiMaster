import { Graphics } from 'pixi.js';

const SNAP_COLOR  = 0x00ff88;
const SNAP_ALPHA  = 0.7;
const FADE_MS     = 300;

export class SnapIndicator {
  #g;
  #viewport;
  #fadeTimer = null;

  constructor(scene, viewport) {
    this.#viewport = viewport;
    this.#g = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = 9500;
    scene.addChild(this.#g);
  }

  flash(worldX, worldY) {
    const scale = this.#viewport.scaled;
    const r     = 3 / scale;
    const armLen = 8 / scale;
    const sw    = Math.max(0.01, 1 / scale);

    this.#g.clear();

    // Small diamond at snap point
    this.#g.moveTo(worldX, worldY - r)
      .lineTo(worldX + r, worldY)
      .lineTo(worldX, worldY + r)
      .lineTo(worldX - r, worldY)
      .closePath();
    this.#g.fill({ color: SNAP_COLOR, alpha: SNAP_ALPHA });

    // Short crosshair arms
    this.#g.moveTo(worldX - armLen, worldY).lineTo(worldX + armLen, worldY);
    this.#g.moveTo(worldX, worldY - armLen).lineTo(worldX, worldY + armLen);
    this.#g.stroke({ color: SNAP_COLOR, width: sw, alpha: SNAP_ALPHA * 0.5 });

    if (this.#fadeTimer) clearTimeout(this.#fadeTimer);
    this.#fadeTimer = setTimeout(() => {
      this.#g.clear();
      this.#fadeTimer = null;
    }, FADE_MS);
  }

  hide() {
    if (this.#fadeTimer) { clearTimeout(this.#fadeTimer); this.#fadeTimer = null; }
    this.#g.clear();
  }
}
