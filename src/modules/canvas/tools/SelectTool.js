import { ToolBase }  from './ToolBase.js';
import { store }     from '../../../core/State.js';

const DRAG_THRESHOLD_PX = 4;
const HIT_TOLERANCE_PX  = 10;
const NUDGE_SMALL       = 0.1;
const NUDGE_LARGE       = 1.0;

export class SelectTool extends ToolBase {
  static id = 'select';

  /** @type {'idle'|'pressed-cp'|'dragging-cp'|'pressed-element'|'dragging-elements'|'pressed-empty'|'dragging-marquee'|'grabbing'} */
  #state = 'idle';

  #pressScreen = { x: 0, y: 0 };
  #pressWorld  = { x: 0, y: 0 };
  #dragOrigins = new Map();

  #activeCP       = null;
  #cpElement      = null;
  #cpOriginal     = null;
  #cpStartBounds  = null;

  onActivate() {
    this.#state = 'idle';
  }

  onDeactivate() {
    this.ctx.marquee.cancel();
    this.ctx.hover?.hide();
    this.ctx.controlPoints?.hide();
    this.#state = 'idle';
  }

  onPointerDown(e) {
    const { global: g, data } = e;
    const world = this.ctx.viewport.toWorld(g.x, g.y);
    const scale = this.ctx.viewport.scaled;
    const tolerance = HIT_TOLERANCE_PX / scale;

    this.ctx.hover?.hide();

    if (this.#state === 'grabbing') {
      this._commitGrab();
      return;
    }

    this.#pressScreen = { x: g.x, y: g.y };
    this.#pressWorld  = { x: world.x, y: world.y };

    // 1) Control point hit?
    if (this.ctx.controlPoints) {
      const cp = this.ctx.controlPoints.hitTest(world.x, world.y);
      if (cp) {
        this.#activeCP = cp;
        if (this.ctx.controlPoints.elementId) {
          const rec = this.ctx.spatial.get(this.ctx.controlPoints.elementId);
          if (rec) {
            this.#cpElement  = rec.element;
            this.#cpOriginal = structuredClone(rec.element);
          }
        } else if (cp.bounds) {
          this.#cpStartBounds = { ...cp.bounds };
        }
        this.#state = 'pressed-cp';
        this.ctx.viewport.pause = true;
        return;
      }
    }

    // 2) Element hit?
    const hit = this.ctx.spatial.hitTestPoint(world.x, world.y, tolerance);

    if (hit) {
      if (data.shiftKey) {
        this.ctx.selection.toggleOne(hit.id);
      } else if (!store.canvasSelectedIds.has(hit.id)) {
        this.ctx.selection.selectOne(hit.id);
      }
      this._beginDragSetup();
      this.#state = 'pressed-element';
      this.ctx.viewport.pause = true;
      this._showControlPoints(scale);
      return;
    }

    // 3) Empty space → marquee
    if (!data.shiftKey) this.ctx.selection.clear();
    this.ctx.controlPoints?.hide();
    this.ctx.marquee.begin(world.x, world.y);
    this.#state = 'pressed-empty';
    this.ctx.viewport.pause = true;
  }

  onPointerMove(e) {
    const { global: g, data } = e;
    const world = this.ctx.viewport.toWorld(g.x, g.y);
    const scale = this.ctx.viewport.scaled;
    const noSnap = data?.ctrlKey;

    if (this.#state === 'idle') {
      this._updateHover(world, scale);
      this._updateCursor(world, scale);
      return;
    }

    if (this.#state === 'grabbing') {
      this._applyElementMove(world, noSnap);
      return;
    }

    const dx = g.x - this.#pressScreen.x;
    const dy = g.y - this.#pressScreen.y;
    const pastThreshold = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;

    // ── Control point drag ──
    if (this.#state === 'pressed-cp') {
      if (!pastThreshold) return;
      this.#state = 'dragging-cp';
    }
    if (this.#state === 'dragging-cp') {
      const snapped = noSnap ? world : (this.ctx.grid?.snap(world) ?? world);
      this._applyControlPointDrag(snapped, scale);
      return;
    }

    // ── Element drag ──
    if (this.#state === 'pressed-element') {
      if (!pastThreshold) return;
      this.#state = 'dragging-elements';
      this.ctx.controlPoints?.hide();
    }
    if (this.#state === 'dragging-elements') {
      this._applyElementMove(world, noSnap);
      return;
    }

    // ── Marquee drag ──
    if (this.#state === 'pressed-empty') {
      if (!pastThreshold) return;
      this.#state = 'dragging-marquee';
    }
    if (this.#state === 'dragging-marquee') {
      this.ctx.marquee.update(world.x, world.y);
      return;
    }
  }

  onPointerUp(e) {
    if (this.#state === 'grabbing') return;

    this.ctx.viewport.pause = false;
    const { global: g, data } = e;
    const world = this.ctx.viewport.toWorld(g.x, g.y);
    const scale = this.ctx.viewport.scaled;
    const noSnap = data?.ctrlKey;

    // ── Control point commit ──
    if (this.#state === 'dragging-cp') {
      const snapped = noSnap ? world : (this.ctx.grid?.snap(world) ?? world);
      this._commitControlPointDrag(snapped, scale);
      this._reset();
      return;
    }
    if (this.#state === 'pressed-cp') {
      this._reset();
      return;
    }

    // ── Element move commit ──
    if (this.#state === 'dragging-elements') {
      this._commitElementMove(scale);
      this._reset();
      return;
    }

    // ── Marquee commit ──
    if (this.#state === 'dragging-marquee') {
      const contain = world.x >= this.#pressWorld.x;
      const bounds = this.ctx.marquee.end(world.x, world.y);
      if (bounds) this.ctx.selection.selectInBounds(bounds, contain);
      this._showControlPoints(scale);
      this._reset();
      return;
    }

    if (this.#state === 'pressed-empty') {
      this.ctx.marquee.cancel();
      this.ctx.controlPoints?.hide();
    }

    if (this.#state === 'pressed-element') {
      this._showControlPoints(scale);
    }

    this._reset();
  }

  onPointerLeave(_e) {
    if (this.#state === 'grabbing') {
      this._cancelGrab();
    } else if (this.#state !== 'idle') {
      this.ctx.viewport.pause = false;
      this.ctx.marquee.cancel();
      if (this.#state === 'dragging-elements') {
        this._restoreFromDragOrigins();
      }
      if (this.#state === 'dragging-cp' && this.#cpOriginal && this.#cpElement) {
        this.ctx.spatial.update(this.#cpElement.id, this.#cpOriginal);
        this.ctx.renderer.markDirty(this.#cpElement.layer ?? 'all');
        this._showControlPoints(this.ctx.viewport.scaled);
      }
      this._reset();
    }
    this.ctx.hover?.hide();
  }

  onKeyDown(e) {
    if (e.key === 'Escape' && this.#state === 'grabbing') {
      this._cancelGrab();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      this._deleteSelected(); return;
    }
    if (e.key === 'Escape') {
      this.ctx.selection.clear();
      this.ctx.controlPoints?.hide();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      this.ctx.selection.selectAll();
      this._showControlPoints(this.ctx.viewport.scaled);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.ctx.undo?.undo((els) => this._reloadFromUndo(els));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.ctx.undo?.redo((els) => this._reloadFromUndo(els));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      this._duplicateSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      this._copySelected(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      this._pasteClipboard(); return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      this._nudgeSelected(e);
      return;
    }

    // KiCad shortcuts — idle with selection, no modifier
    if (this.#state === 'idle' && !e.ctrlKey && !e.metaKey) {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this._rotateSelected(e.shiftKey);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this._flipSelected();
        return;
      }
      if (e.key === 'm' || e.key === 'M' || e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this._enterGrabMode();
        return;
      }
    }
  }

  // ── Element move (shared between drag and grab) ───────────────────────────

  _applyElementMove(world, noSnap) {
    const rawDx = world.x - this.#pressWorld.x;
    const rawDy = world.y - this.#pressWorld.y;

    let dx = rawDx, dy = rawDy;
    if (!noSnap && this.ctx.grid) {
      const firstOrigin = this.#dragOrigins.values().next().value;
      if (firstOrigin) {
        const snapped = this.ctx.grid.snap({ x: firstOrigin.x + rawDx, y: firstOrigin.y + rawDy });
        dx = snapped.x - firstOrigin.x;
        dy = snapped.y - firstOrigin.y;
      }
    }

    for (const [id, origin] of this.#dragOrigins) {
      const upd = { x: origin.x + dx, y: origin.y + dy };
      if (origin.x2 != null) upd.x2 = origin.x2 + dx;
      if (origin.y2 != null) upd.y2 = origin.y2 + dy;
      if (origin.mid_x != null) upd.mid_x = origin.mid_x + dx;
      if (origin.mid_y != null) upd.mid_y = origin.mid_y + dy;
      if (origin.points) {
        upd.points = origin.points.map((v, i) => v + (i % 2 === 0 ? dx : dy));
      }
      this.ctx.spatial.update(id, upd);
    }
    this.ctx.renderer.markDirty('all');
  }

  _commitElementMove(scale) {
    let moved = false;
    for (const [id, origin] of this.#dragOrigins) {
      const rec = this.ctx.spatial.get(id);
      if (rec && (Math.abs(rec.element.x - origin.x) > 1e-6 ||
                  Math.abs(rec.element.y - origin.y) > 1e-6)) {
        moved = true;
        break;
      }
    }

    if (moved) {
      this.ctx.undo?.snapshot();
      const mutations = [...store.canvasMutations];
      for (const [id, origin] of this.#dragOrigins) {
        const rec = this.ctx.spatial.get(id);
        if (!rec) continue;
        const dx = rec.element.x - origin.x;
        const dy = rec.element.y - origin.y;
        mutations.push({ op: 'move_element', id, dx, dy });
      }
      store.canvasMutations = mutations;
      store.canvasIsDirty   = true;
    } else {
      this._restoreFromDragOrigins();
    }
    this._showControlPoints(scale);
  }

  _restoreFromDragOrigins() {
    for (const [id, origin] of this.#dragOrigins) {
      this.ctx.spatial.update(id, origin);
    }
    this.ctx.renderer.markDirty('all');
  }

  // ── Grab mode (M / G key) ─────────────────────────────────────────────────

  _enterGrabMode() {
    if (!store.canvasSelectedIds.size) return;
    this._beginDragSetup();

    const bounds = this.ctx.spatial.selectionBounds(store.canvasSelectedIds);
    if (!bounds) return;
    this.#pressWorld = {
      x: (bounds.minX + bounds.maxX) * 0.5,
      y: (bounds.minY + bounds.maxY) * 0.5,
    };

    this.#state = 'grabbing';
    this.ctx.controlPoints?.hide();
    this.ctx.viewport.pause = true;
  }

  _commitGrab() {
    this._commitElementMove(this.ctx.viewport.scaled);
    this.ctx.viewport.pause = false;
    this._reset();
  }

  _cancelGrab() {
    this._restoreFromDragOrigins();
    this.ctx.viewport.pause = false;
    this._showControlPoints(this.ctx.viewport.scaled);
    this._reset();
  }

  // ── Control point editing ──────────────────────────────────────────────────

  _applyControlPointDrag(snapped, scale) {
    const cp = this.#activeCP;
    if (!cp) return;

    if (this.#cpElement) {
      const updates = this.ctx.controlPoints.applyDrag(cp, this.#cpElement, snapped.x, snapped.y, snapped);
      if (updates && !updates.__bbox) {
        this.ctx.spatial.update(this.#cpElement.id, updates);
        this.ctx.renderer.markDirty(this.#cpElement.layer ?? 'all');
        const rec = this.ctx.spatial.get(this.#cpElement.id);
        if (rec) this.ctx.controlPoints.showForElement(rec.element, scale);
      }
    } else if (this.#cpStartBounds) {
      const result = this.ctx.controlPoints.applyDrag(cp, null, snapped.x, snapped.y, snapped);
      if (result?.__bbox) {
        this.ctx.controlPoints.showBBoxForMulti(result.bounds, scale);
      }
    }
  }

  _commitControlPointDrag(snapped, scale) {
    const cp = this.#activeCP;
    if (!cp) return;

    if (this.#cpElement && this.#cpOriginal) {
      this.ctx.undo?.snapshot();
      const rec = this.ctx.spatial.get(this.#cpElement.id);
      if (!rec) return;
      const current = rec.element;
      const mutations = [...store.canvasMutations];
      const diff = {};
      for (const key of Object.keys(current)) {
        if (JSON.stringify(current[key]) !== JSON.stringify(this.#cpOriginal[key])) {
          diff[key] = current[key];
        }
      }
      if (Object.keys(diff).length > 0) {
        mutations.push({ op: 'edit_element', id: this.#cpElement.id, updates: diff });
        store.canvasMutations = mutations;
        store.canvasIsDirty   = true;
      }
      this._showControlPoints(scale);

    } else if (this.#cpStartBounds) {
      const result = this.ctx.controlPoints.applyDrag(cp, null, snapped.x, snapped.y, snapped);
      if (result?.__bbox) {
        this._applyBBoxResize(this.#cpStartBounds, result.bounds);
        this._showControlPoints(scale);
      }
    }
  }

  _applyBBoxResize(oldBounds, newBounds) {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    this.ctx.undo?.snapshot();

    const ow = oldBounds.maxX - oldBounds.minX;
    const oh = oldBounds.maxY - oldBounds.minY;
    if (ow < 1e-9 || oh < 1e-9) return;
    const sx = (newBounds.maxX - newBounds.minX) / ow;
    const sy = (newBounds.maxY - newBounds.minY) / oh;

    const mutations = [...store.canvasMutations];
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const el = rec.element;
      const relX = (el.x - oldBounds.minX) / ow;
      const relY = (el.y - oldBounds.minY) / oh;
      const updates = {
        x: newBounds.minX + relX * (newBounds.maxX - newBounds.minX),
        y: newBounds.minY + relY * (newBounds.maxY - newBounds.minY),
      };
      if (el.x2 != null) updates.x2 = newBounds.minX + ((el.x2 - oldBounds.minX) / ow) * (newBounds.maxX - newBounds.minX);
      if (el.y2 != null) updates.y2 = newBounds.minY + ((el.y2 - oldBounds.minY) / oh) * (newBounds.maxY - newBounds.minY);
      if (el.width  != null) updates.width  = el.width  * sx;
      if (el.height != null) updates.height = el.height * sy;
      mutations.push({ op: 'resize_element', id, updates });
      this.ctx.spatial.update(id, updates);
    }
    store.canvasMutations = mutations;
    store.canvasIsDirty   = true;
    this.ctx.renderer.markDirty('all');
  }

  // ── Rotation (R = CCW, Shift+R = CW) ──────────────────────────────────────

  _rotateSelected(clockwise) {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    this.ctx.undo?.snapshot();

    const bounds = this.ctx.spatial.selectionBounds(store.canvasSelectedIds);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;

    const mutations = [...store.canvasMutations];
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const updates = this._rotateElement(rec.element, cx, cy, clockwise);
      mutations.push({ op: 'edit_element', id, updates });
      this.ctx.spatial.update(id, updates);
    }
    store.canvasMutations = mutations;
    store.canvasIsDirty   = true;
    this.ctx.renderer.markDirty('all');
    this._showControlPoints(this.ctx.viewport.scaled);
  }

  _rotateElement(el, cx, cy, clockwise) {
    const rot = (px, py) => {
      if (clockwise) return { x: cx + (py - cy), y: cy - (px - cx) };
      return { x: cx - (py - cy), y: cy + (px - cx) };
    };

    const updates = {};
    const p = rot(el.x, el.y);
    updates.x = p.x;
    updates.y = p.y;

    if (el.x2 != null && el.y2 != null) {
      const p2 = rot(el.x2, el.y2);
      updates.x2 = p2.x;
      updates.y2 = p2.y;
    }

    if (el.mid_x != null && el.mid_y != null) {
      const pm = rot(el.mid_x, el.mid_y);
      updates.mid_x = pm.x;
      updates.mid_y = pm.y;
    }

    if (el.type === 'polygon' && el.points) {
      const pts = [];
      for (let i = 0; i < el.points.length; i += 2) {
        const rp = rot(el.points[i], el.points[i + 1]);
        pts.push(rp.x, rp.y);
      }
      updates.points = pts;
    }

    if ((el.type === 'pad' || el.type === 'pin') && el.width != null && el.height != null) {
      updates.width  = el.height;
      updates.height = el.width;
    }

    return updates;
  }

  // ── Flip — horizontal mirror (F key) ───────────────────────────────────────

  _flipSelected() {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    this.ctx.undo?.snapshot();

    const bounds = this.ctx.spatial.selectionBounds(store.canvasSelectedIds);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) * 0.5;

    const mutations = [...store.canvasMutations];
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const updates = this._flipElement(rec.element, cx);
      mutations.push({ op: 'edit_element', id, updates });
      this.ctx.spatial.update(id, updates);
    }
    store.canvasMutations = mutations;
    store.canvasIsDirty   = true;
    this.ctx.renderer.markDirty('all');
    this._showControlPoints(this.ctx.viewport.scaled);
  }

  _flipElement(el, cx) {
    const mirror = (x) => 2 * cx - x;
    const updates = { x: mirror(el.x) };

    if (el.x2 != null) updates.x2 = mirror(el.x2);
    if (el.mid_x != null) updates.mid_x = mirror(el.mid_x);

    if (el.type === 'polygon' && el.points) {
      const pts = [...el.points];
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] = mirror(pts[i]);
      }
      updates.points = pts;
    }

    return updates;
  }

  // ── Hover + cursor ─────────────────────────────────────────────────────────

  _updateHover(world, scale) {
    if (!this.ctx.hover) return;
    const tolerance = HIT_TOLERANCE_PX / scale;
    const hit = this.ctx.spatial.hitTestPoint(world.x, world.y, tolerance);
    if (hit && !store.canvasSelectedIds.has(hit.id)) {
      if (this.ctx.hover.currentId !== hit.id) {
        this.ctx.hover.currentId = hit.id;
        const bb = this.ctx.spatial.elementAABB(hit);
        this.ctx.hover.show(bb, scale);
      }
    } else {
      if (this.ctx.hover.currentId) this.ctx.hover.hide();
    }
  }

  _updateCursor(world, scale) {
    const canvas = this.ctx.viewport.options?.events?.domElement;
    if (!canvas) return;

    if (this.ctx.controlPoints) {
      const cp = this.ctx.controlPoints.hitTest(world.x, world.y);
      if (cp) {
        canvas.style.cursor = this.ctx.controlPoints.cursorForPoint(cp);
        return;
      }
    }

    const tolerance = HIT_TOLERANCE_PX / scale;
    const hit = this.ctx.spatial.hitTestPoint(world.x, world.y, tolerance);
    canvas.style.cursor = hit ? 'move' : 'default';
  }

  // ── Control point display ──────────────────────────────────────────────────

  _showControlPoints(scale) {
    if (!this.ctx.controlPoints) return;
    const ids = store.canvasSelectedIds;
    if (ids.size === 0) {
      this.ctx.controlPoints.hide();
      return;
    }
    if (ids.size === 1) {
      const id  = ids.values().next().value;
      const rec = this.ctx.spatial.get(id);
      if (rec) {
        this.ctx.controlPoints.showForElement(rec.element, scale);
        return;
      }
    }
    const bounds = this.ctx.spatial.selectionBounds(ids);
    if (bounds) this.ctx.controlPoints.showBBoxForMulti(bounds, scale);
    else this.ctx.controlPoints.hide();
  }

  // ── Drag setup ─────────────────────────────────────────────────────────────

  _beginDragSetup() {
    this.#dragOrigins = new Map();
    for (const id of store.canvasSelectedIds) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const el = rec.element;
      const snap = { x: el.x, y: el.y };
      if (el.x2 != null) snap.x2 = el.x2;
      if (el.y2 != null) snap.y2 = el.y2;
      if (el.mid_x != null) snap.mid_x = el.mid_x;
      if (el.mid_y != null) snap.mid_y = el.mid_y;
      if (el.points) snap.points = [...el.points];
      this.#dragOrigins.set(id, snap);
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  _deleteSelected() {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    this.ctx.undo?.snapshot();
    const mutations = [...store.canvasMutations, ...ids.map(id => ({ op: 'delete_element', id }))];
    for (const id of ids) this.ctx.spatial.remove(id);
    store.canvasMutations   = mutations;
    store.canvasSelectedIds = new Set();
    store.canvasIsDirty     = true;
    this.ctx.renderer.markDirty('all');
    this.ctx.controlPoints?.hide();
  }

  _duplicateSelected() {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    this.ctx.undo?.snapshot();
    const offset = 1.0;
    const mutations = [...store.canvasMutations];
    const newIds = new Set();
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const newId = `${id}_dup_${Date.now()}`;
      const clone = { ...structuredClone(rec.element), id: newId, x: rec.element.x + offset, y: rec.element.y + offset };
      if (clone.x2 != null) clone.x2 += offset;
      if (clone.y2 != null) clone.y2 += offset;
      mutations.push({ op: 'add_element', element: clone });
      newIds.add(newId);
    }
    store.canvasMutations   = mutations;
    store.canvasSelectedIds = newIds;
    store.canvasIsDirty     = true;
    this.ctx.renderer.markDirty('all');
  }

  _copySelected() {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    const elements = [];
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (rec) elements.push(structuredClone(rec.element));
    }
    store._canvasClipboard = elements;
  }

  _pasteClipboard() {
    const clipboard = store._canvasClipboard;
    if (!clipboard?.length) return;
    this.ctx.undo?.snapshot();
    const offset = 1.5;
    const mutations = [...store.canvasMutations];
    const newIds = new Set();
    for (const el of clipboard) {
      const newId = `${el.id}_paste_${Date.now()}`;
      const clone = { ...structuredClone(el), id: newId, x: el.x + offset, y: el.y + offset };
      if (clone.x2 != null) clone.x2 += offset;
      if (clone.y2 != null) clone.y2 += offset;
      mutations.push({ op: 'add_element', element: clone });
      newIds.add(newId);
    }
    store.canvasMutations   = mutations;
    store.canvasSelectedIds = newIds;
    store.canvasIsDirty     = true;
    this.ctx.renderer.markDirty('all');
  }

  _nudgeSelected(e) {
    const ids = [...store.canvasSelectedIds];
    if (!ids.length) return;
    const step = e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
    let ndx = 0, ndy = 0;
    switch (e.key) {
      case 'ArrowUp':    ndy = -step; break;
      case 'ArrowDown':  ndy =  step; break;
      case 'ArrowLeft':  ndx = -step; break;
      case 'ArrowRight': ndx =  step; break;
    }
    this.ctx.undo?.snapshot();
    const mutations = [...store.canvasMutations];
    for (const id of ids) {
      const rec = this.ctx.spatial.get(id);
      if (!rec) continue;
      const el = rec.element;
      const upd = { x: el.x + ndx, y: el.y + ndy };
      if (el.x2 != null) upd.x2 = el.x2 + ndx;
      if (el.y2 != null) upd.y2 = el.y2 + ndy;
      if (el.mid_x != null) upd.mid_x = el.mid_x + ndx;
      if (el.mid_y != null) upd.mid_y = el.mid_y + ndy;
      if (el.points) {
        upd.points = el.points.map((v, i) => v + (i % 2 === 0 ? ndx : ndy));
      }
      mutations.push({ op: 'move_element', id, dx: ndx, dy: ndy });
      this.ctx.spatial.update(id, upd);
    }
    store.canvasMutations = mutations;
    store.canvasIsDirty   = true;
    this.ctx.renderer.markDirty('all');
    this._showControlPoints(this.ctx.viewport.scaled);
  }

  _reloadFromUndo(elements) {
    this.ctx.renderer?.load(elements);
    this.ctx.spatial?.load(elements);
    this.ctx.selection.clear();
    this.ctx.controlPoints?.hide();
  }

  _reset() {
    this.#state         = 'idle';
    this.#dragOrigins   = new Map();
    this.#activeCP      = null;
    this.#cpElement     = null;
    this.#cpOriginal    = null;
    this.#cpStartBounds = null;
  }
}
