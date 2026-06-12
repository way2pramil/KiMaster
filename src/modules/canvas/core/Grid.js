import { Graphics } from 'pixi.js';

const MIL = 0.0254;

const MM_DOT_SIZES = [
  { minScale: 500, spacing: 0.01   },
  { minScale: 100, spacing: 0.1    },
  { minScale: 20,  spacing: 0.25   },
  { minScale: 8,   spacing: 0.5    },
  { minScale: 2,   spacing: 1.0    },
  { minScale: 0.8, spacing: 2.5    },
  { minScale: 0.3, spacing: 5.0    },
  { minScale: 0.1, spacing: 10.0   },
  { minScale: 0.05,spacing: 25.0   },
  { minScale: 0,   spacing: 50.0   },
];

const MIL_DOT_SIZES = [
  { minScale: 400, spacing: MIL        },
  { minScale: 80,  spacing: MIL * 5    },
  { minScale: 40,  spacing: MIL * 10   },
  { minScale: 16,  spacing: MIL * 25   },
  { minScale: 8,   spacing: MIL * 50   },
  { minScale: 2,   spacing: MIL * 100  },
  { minScale: 0.8, spacing: MIL * 250  },
  { minScale: 0.3, spacing: MIL * 500  },
  { minScale: 0.1, spacing: MIL * 1000 },
  { minScale: 0,   spacing: MIL * 2500 },
];

const DOT_COLOR       = 0x404040;
const DOT_SCREEN_PX   = 1.2;
const MINOR_DOT_COLOR = 0x333333;
const MINOR_DOT_PX    = 0.8;
const MINOR_MIN_PX    = 2;
const MINOR_DIVISOR   = 10;
const MAX_DOTS        = 60000;
const ORIGIN_COLOR    = 0x666666;
const ORIGIN_LENGTH   = 2.0;

export class Grid {
  #g;
  #viewport;
  #unit    = 'mm';
  #spacing = null;
  #autoSpacing = 2.5;
  #lastDrawnKey = '';

  constructor(scene, viewport) {
    this.#viewport = viewport;
    this.#g        = new Graphics();
    this.#g.eventMode = 'none';
    this.#g.zIndex    = -1000;
    scene.addChild(this.#g);

    viewport.on('moved',  () => this._redraw());
    viewport.on('zoomed', () => this._redraw());
    this._redraw();
  }

  setUnit(unit) {
    this.#unit    = unit;
    this.#spacing = null;
    this.#lastDrawnKey = '';
    this._redraw();
  }

  get unit() { return this.#unit; }

  setSpacing(value) {
    if (value == null) {
      this.#spacing = null;
    } else {
      this.#spacing = this.#unit === 'mil' ? value * MIL : value;
    }
    this.#lastDrawnKey = '';
    this._redraw();
  }

  snap(pt) {
    const s = this.#spacing ?? this.#autoSpacing;
    return { x: Math.round(pt.x / s) * s, y: Math.round(pt.y / s) * s };
  }

  _redraw() {
    const vp    = this.#viewport;
    const scale = vp.scaled;

    const sizes = this.#unit === 'mil' ? MIL_DOT_SIZES : MM_DOT_SIZES;
    const majorIdx = sizes.findIndex(d => scale >= d.minScale);
    const majorEntry = sizes[majorIdx >= 0 ? majorIdx : sizes.length - 1];
    this.#autoSpacing = majorEntry.spacing;

    let spacing = this.#spacing ?? this.#autoSpacing;

    const corner  = vp.toWorld(0, 0);
    const far     = vp.toWorld(vp.screenWidth, vp.screenHeight);
    const viewW   = far.x - corner.x;
    const viewH   = far.y - corner.y;

    // Auto-widen spacing if dot count would exceed limit
    while ((viewW / spacing) * (viewH / spacing) > MAX_DOTS && spacing < viewW) {
      spacing *= 2;
    }

    const countX = Math.ceil(viewW / spacing);
    const countY = Math.ceil(viewH / spacing);

    const startX = Math.floor(corner.x / spacing) * spacing;
    const startY = Math.floor(corner.y / spacing) * spacing;

    // Minor grid: 10x10 subdivision of major spacing (KiCad style)
    const minorSpacing = spacing / MINOR_DIVISOR;
    const minorScreen  = minorSpacing * scale;
    const showMinor    = minorScreen >= MINOR_MIN_PX;

    const key = `${spacing.toFixed(6)}|${startX.toFixed(4)}|${startY.toFixed(4)}|${countX}|${countY}|${scale.toFixed(4)}|${showMinor}`;
    if (key === this.#lastDrawnKey) return;
    this.#lastDrawnKey = key;

    this.#g.clear();

    const screenSpacing = spacing * scale;
    if (countX < 1 || countY < 1 || screenSpacing < 4) return;

    // Minor grid dots (10x10 subdivisions)
    if (showMinor) {
      const minorR = MINOR_DOT_PX / scale;
      const mStartX = Math.floor(corner.x / minorSpacing) * minorSpacing;
      const mStartY = Math.floor(corner.y / minorSpacing) * minorSpacing;
      const mCountX = Math.ceil(viewW / minorSpacing);
      const mCountY = Math.ceil(viewH / minorSpacing);

      if (mCountX * mCountY <= MAX_DOTS) {
        for (let ix = 0; ix <= mCountX + 1; ix++) {
          const wx = mStartX + ix * minorSpacing;
          const onMajorX = Math.abs(wx / spacing - Math.round(wx / spacing)) < 0.01;
          for (let iy = 0; iy <= mCountY + 1; iy++) {
            if (onMajorX) {
              const wy = mStartY + iy * minorSpacing;
              if (Math.abs(wy / spacing - Math.round(wy / spacing)) < 0.01) continue;
            }
            this.#g.circle(wx, mStartY + iy * minorSpacing, minorR);
          }
        }
        this.#g.fill({ color: MINOR_DOT_COLOR, alpha: 0.35 });
      }
    }

    // Major grid dots
    const r = DOT_SCREEN_PX / scale;

    for (let ix = 0; ix <= countX + 1; ix++) {
      for (let iy = 0; iy <= countY + 1; iy++) {
        this.#g.circle(startX + ix * spacing, startY + iy * spacing, r);
      }
    }
    this.#g.fill({ color: DOT_COLOR, alpha: 0.65 });

    if (corner.x <= ORIGIN_LENGTH && far.x >= -ORIGIN_LENGTH &&
        corner.y <= ORIGIN_LENGTH && far.y >= -ORIGIN_LENGTH) {
      const sw = Math.max(0.02, 0.08 / scale);
      this.#g.moveTo(-ORIGIN_LENGTH, 0).lineTo(ORIGIN_LENGTH, 0);
      this.#g.moveTo(0, -ORIGIN_LENGTH).lineTo(0, ORIGIN_LENGTH);
      this.#g.stroke({ color: ORIGIN_COLOR, width: sw });
    }
  }
}
