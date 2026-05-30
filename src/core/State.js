/**
 * KiMaster Reactive State — Proxy-based store with subscriber pattern.
 * No framework. Works with any Custom Element or plain DOM node.
 *
 * Usage:
 *   import { store, subscribe } from './State.js';
 *   subscribe('project', (val) => console.log('project changed', val));
 *   store.project = { name: 'my-board', path: '/path/to/proj' };
 *
 * @module State
 */

/** @typedef {{ [key: string]: any }} StoreShape */

/** @type {Map<string, Set<Function>>} */
const _subscribers = new Map();

/** @type {Set<Function>} */
const _globalSubscribers = new Set();

/**
 * Creates a reactive Proxy store.
 * @template {StoreShape} T
 * @param {T} initialState
 * @returns {T}
 */
function createStore(initialState) {
  const _data = { ...initialState };

  return new Proxy(_data, {
    get(target, key) {
      return target[key];
    },
    set(target, key, value) {
      const prev = target[key];
      target[key] = value;

      if (prev !== value) {
        const keyStr = String(key);
        const subs = _subscribers.get(keyStr);
        if (subs) {
          for (const fn of subs) {
            try { fn(value, prev); } catch (e) { console.error('[State]', e); }
          }
        }
        for (const fn of _globalSubscribers) {
          try { fn(keyStr, value, prev); } catch (e) { console.error('[State]', e); }
        }
      }
      return true;
    },
  });
}

/**
 * Subscribe to a specific state key.
 * @param {string} key
 * @param {(value: any, prev: any) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(key, fn) {
  if (!_subscribers.has(key)) _subscribers.set(key, new Set());
  _subscribers.get(key).add(fn);
  return () => _subscribers.get(key)?.delete(fn);
}

/**
 * Subscribe to all state changes.
 * @param {(key: string, value: any, prev: any) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeAll(fn) {
  _globalSubscribers.add(fn);
  return () => _globalSubscribers.delete(fn);
}

/**
 * Bind a DOM element's text/property to a state key.
 * @param {HTMLElement} el
 * @param {string} key
 * @param {(value: any, el: HTMLElement) => void} [updater]
 * @returns {() => void} unbind
 */
export function bind(el, key, updater) {
  const update = updater ?? ((val, el) => { el.textContent = val ?? ''; });
  update(store[key], el);
  return subscribe(key, (val) => update(val, el));
}

/** The global application state store. */
export const store = createStore({
  /** @type {null|{ name: string, path: string, pcbFile?: string, schematicFile?: string }} */
  project: null,

  /** @type {boolean} */
  bridgeConnected: false,

  /** @type {string|null} */
  bridgeKicadVersion: null,

  /** @type {string|null} */
  bridgeBoardName: null,

  /** @type {any|null} */
  boardState: null,

  /** @type {Array} */
  boardComponents: [],

  /** @type {string[]} */
  boardNets: [],

  /** @type {string[]} */
  boardLayers: [],

  /** @type {string[]} diagnostic messages from BoardExporter */
  boardDiag: [],

  /** @type {{ selection_poll_ms: number, board_poll_ms: number }|null} */
  bridgePollIntervals: null,

  /** @type {any|null} net analytics from get_net_info */
  netInfo: null,

  /** @type {any|null} zone fill result from regenerate_zones */
  zoneFillResult: null,

  /** @type {any|null} via purge result from purge_orphan_vias */
  viaPurgeResult: null,

  /** @type {string[]} */
  selectedRefs: [],

  /** @type {string[]} */
  selectedNets: [],

  /** @type {string|null} */
  kicadCliPath: null,

  /** @type {'idle'|'running'|'done'|'error'} */
  drcStatus: 'idle',

  /** @type {Array} */
  drcErrors: [],

  /** @type {any|null} */
  drcResult: null,

  /** @type {'idle'|'running'|'done'|'error'} */
  ercStatus: 'idle',

  /** @type {Array} */
  ercErrors: [],

  /** @type {any|null} */
  ercResult: null,

  /** @type {'dashboard'|'drc'|'schematic'|'pcb'|'bom'|'export'|'components'|'bridge'|'settings'} */
  activeRoute: '/',

  /** @type {'dark'|'light'} */
  theme: 'dark',

  /** @type {string|null} */
  appVersion: null,
});
