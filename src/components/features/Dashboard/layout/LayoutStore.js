/**
 * @module Dashboard/layout/LayoutStore
 * @summary Single source of truth for dashboard layout state (v3 plan §11).
 *
 * Owns:
 *  • Local persistence — `km-dash-layout-v3` and `km-dash-hidden`
 *  • v2 → v3 migration — one-time toast on first load (plan §11.2)
 *  • Debounced writes — 250ms after the last change (plan §11.3)
 *  • Global store mirror — `store.dashboardLayout` and `store.hiddenWidgets`
 *
 * The shape stored under `km-dash-layout-v3` is the v3 spec:
 *   [{ id: 'board-info', w: 2, h: 1 }, ...]   // 12-col grid; w/h in cells
 *
 * v2 stored `colSpan`/`rowSpan` against a fixed 4-col grid. We translate
 * the old values by multiplying colSpan×3 so a 1-cell v2 widget = 3 cells
 * in the new 12-col grid. The migration runs once and the v2 key is then
 * deleted (keeps storage tidy; no chance of re-migrating).
 */

import { store }                 from '../../../../core/State.js';
import { Logger }                from '../../../../core/Logger.js';
import { notify }                from '../../../../core/Notify.js';
import { DASHBOARD_LAYOUT, DASHBOARD_HIDDEN } from '../../../../core/AppKeys.js';

const LEGACY_V2_KEY   = 'km-dash-layout-v2';
const MIGRATION_FLAG  = 'km-dash-layout-migrated-v2';
const DEBOUNCE_MS     = 250;

// ── Validators ────────────────────────────────────────────────────────────────

/**
 * @param {unknown} x
 * @returns {boolean} true if `x` is a positive integer ≤ 12.
 */
function _isCell(x) {
  return Number.isInteger(x) && x >= 1 && x <= 12;
}

/**
 * @param {unknown} arr
 * @returns {Array|null} a clean layout array, or null if `arr` is unusable.
 */
function _sanitize(arr, knownIds) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object')              continue;
    if (typeof e.id !== 'string')                 continue;
    if (!knownIds.has(e.id))                      continue;
    if (!_isCell(e.w) || !_isCell(e.h))           continue;
    out.push({ id: e.id, w: e.w, h: e.h });
  }
  return out.length ? out : null;
}

/**
 * @param {unknown} arr
 * @returns {string[]|null} a clean array of widget ids, or null.
 */
function _sanitizeHidden(arr, knownIds) {
  if (!Array.isArray(arr)) return null;
  const out = arr.filter(id => typeof id === 'string' && knownIds.has(id));
  return out.length ? out : [];
}

// ── v2 → v3 migration ─────────────────────────────────────────────────────────

/**
 * Translate a v2 layout entry (colSpan/rowSpan on a 4-col grid) to v3
 * (w/h on a 12-col grid). The 4×3 multiplier gives roughly the same
 * proportional width in the new system. Heights are kept as-is — they
 * already work in the same 1-cell-increment model.
 */
function _v2ToV3(v2) {
  if (!Array.isArray(v2)) return null;
  return v2
    .filter(e => e && typeof e.id === 'string' && Number.isInteger(e.colSpan) && Number.isInteger(e.rowSpan))
    .map(e => ({
      id: e.id,
      w:  Math.min(12, Math.max(1, e.colSpan * 3)),
      h:  Math.min(8,  Math.max(1, e.rowSpan)),
    }));
}

// ── Module state ──────────────────────────────────────────────────────────────

let _knownIds   = new Set();           // populated by init()
let _debounceId = null;
let _lastSerial = null;                // JSON of last-persisted state; skip no-op writes

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {Iterable<string>} widgetIds — every widget id the registry knows about.
 *   Layout entries pointing at unknown ids are dropped on load (forward-compat
 *   with widget removals: deleting a widget also drops its slot from saved layouts).
 */
export function initLayoutStore(widgetIds) {
  _knownIds = new Set(widgetIds);

  const [layoutV3, hiddenV3] = _load();
  store.dashboardLayout = layoutV3;
  store.hiddenWidgets   = hiddenV3;
}

/**
 * @returns {Array<{id:string,w:number,h:number}>} a defensive copy.
 */
export function getLayout() {
  return (store.dashboardLayout ?? []).map(e => ({ ...e }));
}

/**
 * @returns {string[]}
 */
export function getHidden() {
  return [...(store.hiddenWidgets ?? [])];
}

/**
 * Replace the entire layout. Triggers a debounced write.
 * @param {Array<{id:string,w:number,h:number}>} layout
 */
export function setLayout(layout) {
  const clean = _sanitize(layout, _knownIds) ?? [];
  if (_shallowEqual(store.dashboardLayout, clean)) return;
  store.dashboardLayout = clean;
  _scheduleWrite();
}

/**
 * Mutate a single widget's size. Pass `null` w/h to leave unchanged.
 * @param {string} id
 * @param {{w?:number,h?:number}} delta
 */
export function resizeWidget(id, { w, h } = {}) {
  const cur = store.dashboardLayout ?? [];
  const next = cur.map(e => {
    if (e.id !== id) return e;
    return {
      id,
      w: w != null ? Math.min(12, Math.max(1, w | 0)) : e.w,
      h: h != null ? Math.min(8,  Math.max(1, h | 0)) : e.h,
    };
  });
  setLayout(next);
}

/**
 * Reorder the layout by moving `id` to `toIndex`.
 */
export function moveWidget(id, toIndex) {
  const cur = getLayout();
  const fromIndex = cur.findIndex(e => e.id === id);
  if (fromIndex < 0) return;
  const [entry] = cur.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(cur.length, toIndex | 0));
  cur.splice(clamped, 0, entry);
  setLayout(cur);
}

/**
 * @param {string} id
 */
export function hideWidget(id) {
  const cur = new Set(store.hiddenWidgets ?? []);
  if (cur.has(id)) return;
  cur.add(id);
  store.hiddenWidgets = [...cur];
  _scheduleWrite();
}

/**
 * @param {string} id
 */
export function showWidget(id) {
  const cur = new Set(store.hiddenWidgets ?? []);
  if (!cur.has(id)) return;
  cur.delete(id);
  store.hiddenWidgets = [...cur];
  _scheduleWrite();
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isHidden(id) {
  return (store.hiddenWidgets ?? []).includes(id);
}

/**
 * Reset layout to the v3 default supplied by the caller. The caller owns
 * the default — we just persist whatever it gives us.
 * @param {Array<{id:string,w:number,h:number}>} defaultLayout
 */
export function resetLayout(defaultLayout) {
  setLayout(defaultLayout);
  store.hiddenWidgets = [];
  _flushWrite();
  notify({
    type:    'info',
    title:   'Dashboard reset',
    message: 'Layout restored to default.',
    duration: 2200,
  });
}

// ── Legacy-grid adapters (interim, until the 12-col rewrite in phase A) ─────

/**
 * @param {number} w — v3 width in 12-col units
 * @returns {number} colSpan for the current 4-col auto-fit grid.
 *   The 4-col grid uses `auto-fit, minmax(...)`, so spans 1–4 are valid.
 *   Mapping: v3 w → v2 colSpan = round(w / 3) clamped to [1, 4].
 */
export function toLegacyColSpan(w) {
  return Math.max(1, Math.min(4, Math.round((w ?? 3) / 3)));
}

/**
 * @param {number} h — v3 height in row units
 * @returns {number} rowSpan for the current grid (1–4 typical).
 */
export function toLegacyRowSpan(h) {
  return Math.max(1, Math.min(4, h | 0));
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _load() {
  const layout  = _loadLayout();
  const hidden  = _loadHidden();
  return [layout, hidden];
}

function _loadLayout() {
  // 1. v3 key (current).
  try {
    const s = localStorage.getItem(DASHBOARD_LAYOUT);
    if (s) {
      const parsed = JSON.parse(s);
      const clean = _sanitize(parsed, _knownIds);
      if (clean) return clean;
    }
  } catch (err) {
    Logger.warn('LayoutStore', 'v3 layout unreadable, falling back', err);
  }

  // 2. v2 → v3 migration (one-time).
  const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG) === '1';
  if (!alreadyMigrated) {
    try {
      const legacy = localStorage.getItem(LEGACY_V2_KEY);
      if (legacy) {
        const translated = _v2ToV3(JSON.parse(legacy));
        const clean = _sanitize(translated, _knownIds);
        if (clean) {
          localStorage.setItem(DASHBOARD_LAYOUT, JSON.stringify(clean));
          localStorage.setItem(MIGRATION_FLAG, '1');
          localStorage.removeItem(LEGACY_V2_KEY);
          // Defer the toast so the dashboard component has a chance to mount.
          setTimeout(() => notify({
            type:    'info',
            title:   'Dashboard upgraded',
            message: 'Your layout was migrated from v2. Drag to rearrange.',
            duration: 4000,
          }), 800);
          return clean;
        }
      }
    } catch (err) {
      Logger.warn('LayoutStore', 'v2 migration failed', err);
    }
  }
  return [];
}

function _loadHidden() {
  try {
    const s = localStorage.getItem(DASHBOARD_HIDDEN);
    if (s) {
      const clean = _sanitizeHidden(JSON.parse(s), _knownIds);
      if (clean !== null) return clean;
    }
  } catch (err) {
    Logger.warn('LayoutStore', 'hidden list unreadable', err);
  }
  return [];
}

function _scheduleWrite() {
  if (_debounceId) clearTimeout(_debounceId);
  _debounceId = setTimeout(_flushWrite, DEBOUNCE_MS);
}

function _flushWrite() {
  _debounceId = null;
  try {
    const layout = store.dashboardLayout ?? [];
    const hidden = store.hiddenWidgets   ?? [];
    const layoutSerial = JSON.stringify(layout);
    const hiddenSerial = JSON.stringify(hidden);

    if (layoutSerial !== _lastSerial?.layout) {
      localStorage.setItem(DASHBOARD_LAYOUT, JSON.stringify(layout));
    }
    if (hiddenSerial !== _lastSerial?.hidden) {
      localStorage.setItem(DASHBOARD_HIDDEN, JSON.stringify(hidden));
    }
    _lastSerial = { layout: layoutSerial, hidden: hiddenSerial };
  } catch (err) {
    Logger.error('LayoutStore', 'write failed', err);
  }
}

function _shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].w !== b[i].w || a[i].h !== b[i].h) return false;
  }
  return true;
}
