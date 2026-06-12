import { Graphics, BitmapText } from 'pixi.js';

const BG_COLOR   = 0x1a1a1a;
const TEXT_COLOR  = 0xcccccc;
const LINE_COLOR  = 0x666666;
const OFFSET_PX   = 20;

export class DragMeasure {
  #container;
  #bg;
  #label;
  #line;
  #viewport;

  constructor(scene, viewport) {
    this.#viewport  = viewport;
    this.#container = new Graphics();
    this.#container.eventMode = 'none';
    this.#container.zIndex    = 10001;
    this.#container.visible   = false;

    this.#line = new Graphics();
    this.#line.eventMode = 'none';
    this.#line.zIndex    = 9300;
    this.#line.visible   = false;

    this.#bg = new Graphics();
    this.#bg.eventMode = 'none';

    this.#label = new BitmapText({
      text: '',
      style: { fontFamily: 'KiMasterMono', fontSize: 1, tint: TEXT_COLOR },
    });
    this.#label.anchor.set(0, 0.5);

    this.#container.addChild(this.#bg);
    this.#container.addChild(this.#label);
    scene.addChild(this.#line);
    scene.addChild(this.#container);
  }

  show(fromX, fromY, toX, toY) {
    const scale   = this.#viewport.scaled;
    const dx      = toX - fromX;
    const dy      = toY - fromY;
    const dist    = Math.hypot(dx, dy);
    const offsetW = OFFSET_PX / scale;
    const fontSize = Math.max(0.3, 10 / scale);

    this.#label.style.fontSize = fontSize;
    this.#label.text = `Δ ${dx.toFixed(3)}, ${dy.toFixed(3)}  (${dist.toFixed(3)})`;

    const tx = toX + offsetW;
    const ty = toY - offsetW;
    this.#label.x = tx;
    this.#label.y = ty;

    // Background pill
    const pad = fontSize * 0.3;
    const tw  = this.#label.width  || fontSize * 10;
    const th  = this.#label.height || fontSize;
    this.#bg.clear();
    this.#bg.roundRect(tx - pad, ty - th * 0.5 - pad, tw + pad * 2, th + pad * 2, pad);
    this.#bg.fill({ color: BG_COLOR, alpha: 0.85 });

    // Dashed measurement line from → to
    const sw = Math.max(0.01, 0.7 / scale);
    this.#line.clear();
    this.#line.moveTo(fromX, fromY).lineTo(toX, toY);
    this.#line.stroke({ color: LINE_COLOR, width: sw, alpha: 0.4 });

    this.#container.visible = true;
    this.#line.visible      = true;
  }

  hide() {
    this.#container.visible = false;
    this.#line.visible      = false;
    this.#line.clear();
    this.#bg.clear();
  }
}
