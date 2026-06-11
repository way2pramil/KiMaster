/**
 * ToolBase — tldraw-style tool state machine interface.
 *
 * Each tool implements pointer and keyboard handlers.
 * The active tool receives routed events from CanvasCore.
 *
 * Inspired by tldraw's StateNode.ts — read:
 *   packages/editor/src/lib/tools/StateNode.ts
 *
 * @module ToolBase
 */

export class ToolBase {
  /** @type {string} unique tool identifier */
  static id = 'base';

  /** @type {{ viewport: import('pixi-viewport').Viewport, spatial: SpatialLayer, selection: SelectionManager, marquee: MarqueeOverlay }} */
  ctx;

  /** @param ctx  shared canvas context object */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** Called when this tool becomes active. */
  onActivate() {}

  /** Called when this tool is deactivated. */
  onDeactivate() {}

  /**
   * @param {{ global: {x,y}, data: PointerEvent, target: import('pixi.js').Container|null }} e
   */
  onPointerDown(_e) {}

  /**
   * @param {{ global: {x,y}, data: PointerEvent }} e
   */
  onPointerMove(_e) {}

  /**
   * @param {{ global: {x,y}, data: PointerEvent }} e
   */
  onPointerUp(_e) {}

  /**
   * Called when pointer leaves the canvas — tools must recover drag state.
   */
  onPointerLeave(_e) {}

  /**
   * @param {KeyboardEvent} e
   */
  onKeyDown(_e) {}
}
