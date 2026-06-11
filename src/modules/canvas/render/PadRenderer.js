/**
 * PadRenderer — draw KiCad pad shapes using PixiJS context transforms.
 *
 * Every shape is drawn at the origin using native PixiJS primitives,
 * then positioned + rotated via g.context.save()/translate()/rotate()/restore().
 *
 * Requires applyTessellationFix() to have been called once at app init so
 * PixiJS generates enough arc segments for mm-scale radii.
 *
 * @module PadRenderer
 */

/**
 * @param {import('pixi.js').Graphics} g
 * @param {{ x, y, width, height, angle, shape, roundrect_ratio? }} pad
 * @param {number} fillColor
 * @param {number} strokeColor
 * @param {number} strokeWidth  world units (mm)
 */
export function drawPad(g, pad, fillColor, strokeColor, strokeWidth) {
  const ctx = g.context;
  const { x, y, width: w, height: h, shape } = pad;
  const angle = (pad.angle ?? 0) * (Math.PI / 180);

  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);

  switch (shape) {
    case 'circle':
      _circle(ctx, w * 0.5, fillColor, strokeColor, strokeWidth);
      break;
    case 'rect':
      _rect(ctx, w, h, fillColor, strokeColor, strokeWidth);
      break;
    case 'oval': {
      const r = Math.min(w, h) * 0.5;
      _roundrect(ctx, w, h, r, fillColor, strokeColor, strokeWidth);
      break;
    }
    case 'roundrect': {
      const ratio = pad.roundrect_ratio ?? 0.25;
      const r     = ratio * Math.min(w, h);
      _roundrect(ctx, w, h, r, fillColor, strokeColor, strokeWidth);
      break;
    }
    default:
      _rect(ctx, w, h, fillColor, strokeColor, strokeWidth);
  }

  // Through-hole drill
  const drill = pad.drill ?? 0;
  if (drill > 0) {
    ctx.circle(0, 0, drill * 0.5);
    ctx.fill({ color: 0x0f0f0f, alpha: 1 });
  }

  ctx.restore();
}

// ── Shape primitives (drawn at origin, context already translated+rotated) ───

function _circle(ctx, r, fill, stroke, sw) {
  ctx.circle(0, 0, r);
  ctx.fill({ color: fill, alpha: 0.85 });
  if (sw > 0) {
    ctx.circle(0, 0, r);
    ctx.stroke({ color: stroke, width: sw });
  }
}

function _rect(ctx, w, h, fill, stroke, sw) {
  ctx.rect(-w * 0.5, -h * 0.5, w, h);
  ctx.fill({ color: fill, alpha: 0.85 });
  if (sw > 0) {
    ctx.rect(-w * 0.5, -h * 0.5, w, h);
    ctx.stroke({ color: stroke, width: sw });
  }
}

function _roundrect(ctx, w, h, r, fill, stroke, sw) {
  ctx.roundRect(-w * 0.5, -h * 0.5, w, h, r);
  ctx.fill({ color: fill, alpha: 0.85 });
  if (sw > 0) {
    ctx.roundRect(-w * 0.5, -h * 0.5, w, h, r);
    ctx.stroke({ color: stroke, width: sw });
  }
}
