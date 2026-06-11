/**
 * ArcUtils — KiCad 3-point arc → circumscribed circle parameters for PixiJS.
 *
 * Algorithm adapted from KiCad's common/geometry/arc_utils.cpp.
 * KiCad uses (start, mid, end) where mid is a point ON the arc.
 * PixiJS arc() takes (cx, cy, r, startAngle, endAngle, anticlockwise).
 *
 * @module ArcUtils
 */

const EPSILON = 1e-9;
const TWO_PI  = Math.PI * 2;

/**
 * Convert a KiCad 3-point arc to circumscribed circle parameters.
 *
 * @param {{ x: number, y: number }} start  arc start point (mm)
 * @param {{ x: number, y: number }} mid    a point on the arc (mm)
 * @param {{ x: number, y: number }} end    arc end point (mm)
 * @returns {ArcResult} circle params or degenerate line
 *
 * @typedef {{ degenerate: true,  x1: number, y1: number, x2: number, y2: number }} DegenerateArc
 * @typedef {{ degenerate: false, cx: number, cy: number, r: number,
 *             startAngle: number, endAngle: number, anticlockwise: boolean }} CircleArc
 * @typedef {DegenerateArc | CircleArc} ArcResult
 */
export function arcFrom3Points(start, mid, end) {
  const dx1 = mid.x - start.x, dy1 = mid.y - start.y;
  const dx2 = end.x  - mid.x,  dy2 = end.y  - mid.y;

  // Midpoints of segments start→mid and mid→end
  const ax = (start.x + mid.x) * 0.5, ay = (start.y + mid.y) * 0.5;
  const bx = (mid.x  + end.x)  * 0.5, by = (mid.y  + end.y)  * 0.5;

  // Determinant of the linear system formed by perpendicular bisectors.
  // det ≈ 0 means points are collinear.
  const det = dy1 * dx2 - dy2 * dx1;

  if (Math.abs(det) < EPSILON) {
    return { degenerate: true, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  // Cramer's rule — parameter t along the perpendicular bisector of start→mid
  const t = ((bx - ax) * (-dx2) - dy2 * (by - ay)) / det;

  const cx = ax + t * (-dy1);
  const cy = ay + t * dx1;
  const r  = Math.hypot(start.x - cx, start.y - cy);

  // Guard against numerically near-collinear (very shallow arc → giant radius).
  // Clamp to 10× the footprint extent to avoid GPU precision artifacts.
  const extent = Math.max(
    Math.abs(end.x - start.x),
    Math.abs(end.y - start.y),
    1e-6,
  );
  if (r > extent * 10) {
    return { degenerate: true, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  const startAngle = Math.atan2(start.y - cy, start.x - cx);
  const endAngle   = Math.atan2(end.y   - cy, end.x   - cx);
  const midAngle   = Math.atan2(mid.y   - cy, mid.x   - cx);

  // Determine direction: the arc must pass through `mid`.
  // anticlockwise = false  →  PixiJS sweeps CW (angle increasing in screen coords where +y=down)
  // anticlockwise = true   →  PixiJS sweeps CCW (angle decreasing)
  const anticlockwise = !_midOnCwSweep(startAngle, endAngle, midAngle);

  return { degenerate: false, cx, cy, r, startAngle, endAngle, anticlockwise };
}

/**
 * Returns true if going CW (increasing angle mod 2π) from startAngle to endAngle
 * passes through midAngle before reaching endAngle.
 */
function _midOnCwSweep(startAngle, endAngle, midAngle) {
  const endDelta = _normRelative(endAngle, startAngle);
  const midDelta = _normRelative(midAngle, startAngle);
  return midDelta < endDelta;
}

/** Normalize angle to [0, 2π) relative to a reference. */
function _normRelative(angle, ref) {
  let d = angle - ref;
  while (d < 0)    d += TWO_PI;
  while (d >= TWO_PI) d -= TWO_PI;
  return d;
}
