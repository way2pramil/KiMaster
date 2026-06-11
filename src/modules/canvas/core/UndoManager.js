import { store } from '../../../core/State.js';

const MAX_STACK = 100;

export class UndoManager {
  #undoStack = [];
  #redoStack = [];

  snapshot() {
    const state = {
      elements:  structuredClone(store.canvasElements ?? []),
      mutations: structuredClone(store.canvasMutations ?? []),
    };
    this.#undoStack.push(state);
    if (this.#undoStack.length > MAX_STACK) this.#undoStack.shift();
    this.#redoStack.length = 0;
  }

  undo(applyFn) {
    if (!this.#undoStack.length) return false;
    const current = {
      elements:  structuredClone(store.canvasElements ?? []),
      mutations: structuredClone(store.canvasMutations ?? []),
    };
    this.#redoStack.push(current);
    const prev = this.#undoStack.pop();
    store.canvasElements  = prev.elements;
    store.canvasMutations = prev.mutations;
    store.canvasIsDirty   = prev.mutations.length > 0;
    applyFn?.(prev.elements);
    return true;
  }

  redo(applyFn) {
    if (!this.#redoStack.length) return false;
    const current = {
      elements:  structuredClone(store.canvasElements ?? []),
      mutations: structuredClone(store.canvasMutations ?? []),
    };
    this.#undoStack.push(current);
    const next = this.#redoStack.pop();
    store.canvasElements  = next.elements;
    store.canvasMutations = next.mutations;
    store.canvasIsDirty   = next.mutations.length > 0;
    applyFn?.(next.elements);
    return true;
  }

  get canUndo() { return this.#undoStack.length > 0; }
  get canRedo() { return this.#redoStack.length > 0; }

  clear() {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }
}
