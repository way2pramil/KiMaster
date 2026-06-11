import { store } from '../../../core/State.js';

export class SelectionManager {
  #spatial;

  constructor(spatial) {
    this.#spatial = spatial;
  }

  selectOne(id) {
    store.canvasSelectedIds = new Set([id]);
  }

  toggleOne(id) {
    const s = new Set(store.canvasSelectedIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    store.canvasSelectedIds = s;
  }

  addToSelection(id) {
    const s = new Set(store.canvasSelectedIds);
    s.add(id);
    store.canvasSelectedIds = s;
  }

  selectInBounds(bounds, contain = false) {
    const hits = this.#spatial.search(bounds, contain);
    store.canvasSelectedIds = new Set(hits.map(e => e.id));
  }

  selectAll() {
    const all = this.#spatial.allElements();
    store.canvasSelectedIds = new Set(all.map(e => e.id));
  }

  clear() {
    if (store.canvasSelectedIds.size === 0) return;
    store.canvasSelectedIds = new Set();
  }

  has(id) { return store.canvasSelectedIds.has(id); }

  get ids() { return store.canvasSelectedIds; }

  get count() { return store.canvasSelectedIds.size; }
}
