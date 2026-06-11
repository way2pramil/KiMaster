/**
 * TessellationFix — patch PixiJS shape builders for mm-scale EDA rendering.
 *
 * PixiJS computes arc segments from world-unit radius:
 *   circle/ellipse/roundRect: n = ceil(2.3 * sqrt(r))  → r=0.3mm → 16 verts (octagon)
 *   arc:                      steps = max(6, floor(6 * r^(1/3) * arc/PI))
 *
 * With PCB mm coordinates, these produce 8–20 segments — visible faceting.
 * This module replaces the build functions at runtime with versions that
 * enforce n >= 8 per quadrant (64 vertices minimum for any full circle).
 *
 * Call applyTessellationFix() once before any Graphics drawing.
 *
 * @module TessellationFix
 */

import {
  buildCircle,
  buildEllipse,
  buildRoundedRectangle,
  ShapePath,
} from 'pixi.js';

let _applied = false;

const MIN_N          = 8;   // per-quadrant → 64 verts minimum for a full circle
const MIN_ARC_STEPS  = 32;  // minimum steps for any arc() call

export function applyTessellationFix() {
  if (_applied) return;
  _applied = true;

  // ── Patch circle / ellipse / roundedRectangle builder ──────────────────────
  //
  // Original formula:  n = ceil(2.3 * sqrt(rx + ry))
  // For r=0.3mm:       n = ceil(2.3 * 0.77) = 2  → 16 verts (octagon)
  // With MIN_N=8:      n = 8                      → 64 verts (smooth)

  const buildWithMinN = function (shape, points) {
    let x, y, dx, dy, rx, ry;

    if (shape.type === 'circle') {
      rx = ry = shape.radius;
      if (rx <= 0) return false;
      x = shape.x;
      y = shape.y;
      dx = dy = 0;
    } else if (shape.type === 'ellipse') {
      rx = shape.halfWidth;
      ry = shape.halfHeight;
      if (rx <= 0 || ry <= 0) return false;
      x = shape.x;
      y = shape.y;
      dx = dy = 0;
    } else {
      const halfWidth  = shape.width / 2;
      const halfHeight = shape.height / 2;
      x  = shape.x + halfWidth;
      y  = shape.y + halfHeight;
      rx = ry = Math.max(0, Math.min(shape.radius, Math.min(halfWidth, halfHeight)));
      dx = halfWidth  - rx;
      dy = halfHeight - ry;
    }

    if (dx < 0 || dy < 0) return false;

    const n = Math.max(MIN_N, Math.ceil(2.3 * Math.sqrt(rx + ry)));
    const m = n * 8 + (dx ? 4 : 0) + (dy ? 4 : 0);
    if (m === 0) return false;

    if (n === 0) {
      points[0] = points[6] = x + dx;
      points[1] = points[3] = y + dy;
      points[2] = points[4] = x - dx;
      points[5] = points[7] = y - dy;
      return true;
    }

    let j1 = 0;
    let j2 = n * 4 + (dx ? 2 : 0) + 2;
    let j3 = j2;
    let j4 = m;

    let x0 = dx + rx;
    let y0 = dy;
    let x1 = x + x0;
    let x2 = x - x0;
    let y1 = y + y0;

    points[j1++] = x1;
    points[j1++] = y1;
    points[--j2] = y1;
    points[--j2] = x2;

    if (dy) {
      const y22 = y - y0;
      points[j3++] = x2;
      points[j3++] = y22;
      points[--j4] = y22;
      points[--j4] = x1;
    }

    for (let i = 1; i < n; i++) {
      const a   = (Math.PI / 2) * (i / n);
      const x02 = dx + Math.cos(a) * rx;
      const y02 = dy + Math.sin(a) * ry;
      const x12 = x + x02;
      const x22 = x - x02;
      const y12 = y + y02;
      const y22 = y - y02;
      points[j1++] = x12;
      points[j1++] = y12;
      points[--j2] = y12;
      points[--j2] = x22;
      points[j3++] = x22;
      points[j3++] = y22;
      points[--j4] = y22;
      points[--j4] = x12;
    }

    x0 = dx;
    y0 = dy + ry;
    x1 = x + x0;
    x2 = x - x0;
    y1 = y + y0;
    const y2 = y - y0;

    points[j1++] = x1;
    points[j1++] = y1;
    points[--j4] = y2;
    points[--j4] = x1;

    if (dx) {
      points[j1++] = x2;
      points[j1++] = y1;
      points[--j4] = y2;
      points[--j4] = x2;
    }

    return true;
  };

  buildCircle.build           = buildWithMinN;
  buildEllipse.build          = buildWithMinN;
  buildRoundedRectangle.build = buildWithMinN;

  // ── Patch ShapePath.prototype.arc ──────────────────────────────────────────
  //
  // Original formula inside buildArc():
  //   steps = max(6, floor(6 * pow(radius, 1/3) * (dist/PI)))
  // For r=0.3mm full circle: steps = max(6, 8) = 8
  //
  // ShapePath.arc() calls buildArc(points, ...) without passing a steps arg.
  // We override arc() to always pass MIN_ARC_STEPS as the steps parameter.
  // buildArc uses the passed value if truthy: `steps || (steps = formula)`.

  const origArc = ShapePath.prototype.arc;
  ShapePath.prototype.arc = function (x, y, radius, startAngle, endAngle, counterclockwise) {
    this._ensurePoly(false);
    const points = this._currentPoly.points;

    // Compute dist to scale steps proportionally for partial arcs
    let dist = Math.abs(startAngle - endAngle);
    if (!counterclockwise && startAngle > endAngle) {
      dist = 2 * Math.PI - dist;
    } else if (counterclockwise && endAngle > startAngle) {
      dist = 2 * Math.PI - dist;
    }
    const fraction = dist / (2 * Math.PI);
    const steps = Math.max(MIN_ARC_STEPS, Math.ceil(MIN_ARC_STEPS / Math.max(fraction, 0.01)));

    // buildArc is captured in closure by the original module — we can't call it
    // directly. Instead, replicate its logic inline with our higher step count.
    let f = dist / steps;
    let t = startAngle;
    f *= counterclockwise ? -1 : 1;
    for (let i = 0; i <= steps; i++) {
      points.push(x + Math.cos(t) * radius, y + Math.sin(t) * radius);
      t += f;
    }
    return this;
  };
}
