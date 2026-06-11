/**
 * StrokeUtils — sub-pixel visibility threshold for KiCad line widths.
 *
 * Physical widths are always preserved.
 * The threshold ONLY activates when a line would become invisible at extreme zoom-out.
 *
 * @module StrokeUtils
 */

/** Minimum visible line width in screen pixels. Below this, lines disappear entirely. */
const MIN_PX = 0.5;

/**
 * Compute the effective stroke width in world units (mm) for the current viewport scale.
 *
 * @param {number} kicadWidth  Physical width in mm from the KiCad file
 * @param {number} scale       Current viewport zoom scale (viewport.scale.x)
 * @returns {number}           Stroke width in world units to pass to PixiJS Graphics
 */
export function effectiveStroke(kicadWidth, scale) {
  const screenWidth = kicadWidth * scale;
  return screenWidth < MIN_PX ? MIN_PX / scale : kicadWidth;
}
