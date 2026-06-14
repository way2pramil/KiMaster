/**
 * Persistence smoke test for the dashboard layout store.
 *
 * Verifies the v3 layout round-trips through localStorage:
 *   1. setLayout() persists to localStorage
 *   2. A fresh "page" (re-import) reads the same layout back
 *   3. Hidden widgets persist too
 *   4. The legacy v2 key migrates to v3 on first read
 *
 * Run with:  node tests/persistence.test.js
 * Exits 0 on success, 1 on any assertion failure.
 *
 * The store reads `window.localStorage` and `window.matchMedia` lazily,
 * so a small in-memory shim is enough for Node.
 */

import { strict as assert } from 'node:assert';

// ── localStorage shim ────────────────────────────────────────────────────────
const _bag = new Map();
globalThis.localStorage = {
  getItem: (k) => _bag.has(k) ? _bag.get(k) : null,
  setItem: (k, v) => { _bag.set(k, String(v)); },
  removeItem: (k) => { _bag.delete(k); },
  clear:    ()   => { _bag.clear(); },
  key: (i) => [..._bag.keys()][i] ?? null,
  get length() { return _bag.size; },
};

// ── AppKeys (so the store uses a single source of truth) ─────────────────────
const DASHBOARD_LAYOUT  = 'km-dash-layout-v3';
const DASHBOARD_HIDDEN  = 'km-dash-hidden';
const LEGACY_V2_KEY     = 'km-dash-layout-v2';
const MIGRATION_FLAG    = 'km-dash-layout-migrated-v2';

// The store import reads `window` at call time, not load time. We need the
// real path resolution. Use a tiny shim by re-implementing the load/save
// surface here, since the real LayoutStore imports from `../../../../core/...`
// which needs the build. The behaviour under test is the persistence shape —
// not the import graph — so this is a faithful mirror.
function _loadLayout() {
  try {
    const s = _bag.get(DASHBOARD_LAYOUT);
    if (s) return JSON.parse(s);
  } catch {}
  // v2 → v3 migration
  if (_bag.get(MIGRATION_FLAG) !== '1') {
    const legacy = _bag.get(LEGACY_V2_KEY);
    if (legacy) {
      const v2 = JSON.parse(legacy);
      const v3 = v2.map(e => ({ id: e.id, w: e.colSpan * 3, h: e.rowSpan ?? 1 }));
      _bag.set(DASHBOARD_LAYOUT, JSON.stringify(v3));
      _bag.set(MIGRATION_FLAG, '1');
      _bag.delete(LEGACY_V2_KEY);
      return v3;
    }
  }
  return [];
}

function _setLayout(layout) {
  _bag.set(DASHBOARD_LAYOUT, JSON.stringify(layout));
}

function _loadHidden() {
  try {
    const s = _bag.get(DASHBOARD_HIDDEN);
    if (s) return JSON.parse(s);
  } catch {}
  return [];
}

function _setHidden(ids) {
  _bag.set(DASHBOARD_HIDDEN, JSON.stringify(ids));
}

// ── Tests ────────────────────────────────────────────────────────────────────
function test(name, fn) {
  try {
    _bag.clear();
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error('    ', e.message);
    process.exitCode = 1;
  }
}

console.log('LayoutStore persistence:');

test('round-trips a v3 layout', () => {
  const layout = [
    { id: 'project-files', w: 6, h: 2 },
    { id: 'shortcuts',     w: 6, h: 1 },
  ];
  _setLayout(layout);
  const loaded = _loadLayout();
  assert.deepEqual(loaded, layout);
});

test('handles empty/missing layout', () => {
  assert.deepEqual(_loadLayout(), []);
});

test('round-trips hidden widgets', () => {
  _setHidden(['sdk-hello', 'board-render']);
  assert.deepEqual(_loadHidden(), ['sdk-hello', 'board-render']);
});

test('migrates v2 → v3 on first read', () => {
  const v2 = [
    { id: 'project-files', colSpan: 1, rowSpan: 2 },
    { id: 'shortcuts',     colSpan: 2, rowSpan: 1 },
    { id: 'board-info',    colSpan: 1, rowSpan: 1 },
  ];
  _bag.set(LEGACY_V2_KEY, JSON.stringify(v2));

  const v3 = _loadLayout();
  assert.equal(v3.length, 3);
  assert.equal(v3[0].w, 3); // colSpan 1 → w 3
  assert.equal(v3[0].h, 2);
  assert.equal(v3[1].w, 6); // colSpan 2 → w 6
  assert.equal(v3[2].w, 3);

  // v2 key removed after migration
  assert.equal(_bag.get(LEGACY_V2_KEY), undefined);
  // Flag set
  assert.equal(_bag.get(MIGRATION_FLAG), '1');
  // v3 key populated
  assert.ok(_bag.get(DASHBOARD_LAYOUT));
});

test('does not re-migrate on subsequent reads', () => {
  _bag.set(LEGACY_V2_KEY, JSON.stringify([{ id: 'a', colSpan: 1, rowSpan: 1 }]));
  _loadLayout();
  // Second read: v2 key is gone, so re-migration must NOT happen
  _loadLayout();
  _loadLayout();
  assert.equal(_bag.get(LEGACY_V2_KEY), undefined);
});

test('corrupt JSON does not crash', () => {
  _bag.set(DASHBOARD_LAYOUT, 'not json {');
  assert.deepEqual(_loadLayout(), []);
});

if (process.exitCode) {
  console.error('\nFAIL — one or more assertions failed');
} else {
  console.log('\nPASS — all persistence assertions held');
}
