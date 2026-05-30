/**
 * KiCad Bridge Client — Phase 3.
 *
 * The Rust WsClient manages the actual WebSocket connection to the Python plugin.
 * This module provides the JS API for IPC commands and listens to Tauri events
 * that the Rust task emits when board state / selection / connection changes.
 *
 * Events emitted by Rust (subscribed here):
 *   "bridge:connected"        → { port, kicad_version, board_name, plugin_version }
 *   "bridge:disconnected"     → {}
 *   "bridge:board_state"      → raw board state object
 *   "bridge:board_changed"    → {}  (signal to request fresh state)
 *   "bridge:selection"        → { refs: string[], nets: string[] }
 *   "bridge:error"            → { message }
 *
 * @module BridgeClient
 */

import { invoke, invokeNow } from '../../core/Ipc.js';
import { store } from '../../core/State.js';
import { Logger } from '../../core/Logger.js';
import {
  BRIDGE_CONNECTED, BRIDGE_DISCONNECTED, BRIDGE_BOARD_STATE,
  BRIDGE_BOARD_CHANGED, BRIDGE_SELECTION, BRIDGE_NET_INFO,
  BRIDGE_OP_RESULT, BRIDGE_ERROR, BRIDGE_POLL_INTERVALS,
} from '../../core/AppEvents.js';
import {
  BRIDGE_CONNECT, BRIDGE_DISCONNECT, BRIDGE_SEND,
  BRIDGE_REQUEST_BOARD_STATE,
  BRIDGE_GET_BOARD_STATE, BRIDGE_HIGHLIGHT_COMPONENT, BRIDGE_HIGHLIGHT_NET,
  BRIDGE_REQUEST_NET_INFO, BRIDGE_REGENERATE_ZONES,
  BRIDGE_PURGE_ORPHAN_VIAS,
  BRIDGE_CLEAR_HIGHLIGHT, INSTALL_BRIDGE_PLUGIN, GET_PLUGIN_INSTALL_PATH,
  BRIDGE_MOVE_COMPONENT, BRIDGE_ROTATE_COMPONENT,
  BRIDGE_SET_LOCKED, BRIDGE_SET_DNP,
} from '../../core/AppCommands.js';

/** @type {Function|null} unsubscribe handle from Tauri event listener */
let _unlisten = null;

/** @type {boolean} */
let _initialized = false;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BoardComponent
 * @property {string} ref
 * @property {string} value
 * @property {string} footprint
 * @property {{ x: number, y: number }} position
 * @property {number} rotation
 * @property {boolean} on_back
 * @property {boolean} locked
 * @property {boolean} dnp
 * @property {Record<string, string>} fields
 */

/**
 * @typedef {Object} BridgeConnectedPayload
 * @property {number} port
 * @property {string|null} kicad_version
 * @property {string|null} board_name
 * @property {string|null} plugin_version
 */

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialize Tauri event listeners for bridge events.
 * Call once during app boot. Safe to call multiple times (idempotent).
 */
export async function initBridgeListeners() {
  if (_initialized) return;
  _initialized = true;

  let tauriListen;
  if (!window.__TAURI_INTERNALS__) {
    Logger.info('Bridge', 'Browser mode — using dev mock listeners');
    _setupDevModeListeners();
    return;
  }
  try {
    const evtModule = await import('@tauri-apps/api/event');
    tauriListen = evtModule.listen;
  } catch (err) {
    Logger.warn('Bridge', 'Tauri event API unavailable — skipping', err);
    return;
  }

  // Register all bridge event listeners using AppEvents constants (no raw strings)
  const unsubs = await Promise.all([
    tauriListen(BRIDGE_CONNECTED,     (e) => _onConnected(e.payload)),
    tauriListen(BRIDGE_DISCONNECTED,  ()  => _onDisconnected()),
    tauriListen(BRIDGE_BOARD_STATE,   (e) => _onBoardState(e.payload)),
    tauriListen(BRIDGE_BOARD_CHANGED, ()  => _onBoardChanged()),
    tauriListen(BRIDGE_SELECTION,     (e) => _onSelection(e.payload)),
    tauriListen(BRIDGE_NET_INFO,      (e) => _onNetInfo(e.payload)),
    tauriListen(BRIDGE_OP_RESULT,     (e) => _onOpResult(e.payload)),
    tauriListen(BRIDGE_ERROR,         (e) => _onBridgeError(e.payload)),
    tauriListen(BRIDGE_POLL_INTERVALS,(e) => _onPollIntervals(e.payload)),
  ]);

  _unlisten = () => unsubs.forEach(fn => fn());
  Logger.info('Bridge', 'Tauri event listeners registered');
}

/** Remove all Tauri event listeners. */
export function disposeBridgeListeners() {
  _unlisten?.();
  _unlisten = null;
  _initialized = false;
}

// ── Auto-connect ─────────────────────────────────────────────────────────────

/** @type {number|null} auto-connect timer handle */
let _autoConnectTimer = null;

/**
 * Start auto-connect loop.
 * Tries to connect every `intervalMs` until connected.
 * Stops automatically on success; resumes on disconnect.
 * Safe to call multiple times — idempotent.
 */
export function startAutoConnect(intervalMs = 3000) {
  if (_autoConnectTimer) return; // already running
  if (store.bridgeConnected) return; // already connected

  Logger.info('Bridge', 'Auto-connect started (every ' + (intervalMs / 1000) + 's)');

  const attempt = async () => {
    if (store.bridgeConnected) {
      _stopAutoConnect();
      return;
    }
    try {
      await connectBridge(40001);
      // connectBridge succeeded → Rust task is running, actual connection
      // result arrives via bridge:connected event. Auto-connect will stop
      // when _onConnected sets store.bridgeConnected = true.
    } catch {
      // Connection failed — will retry on next tick
    }
  };

  // First attempt immediately
  attempt();
  _autoConnectTimer = setInterval(attempt, intervalMs);
}

function _stopAutoConnect() {
  if (_autoConnectTimer) {
    clearInterval(_autoConnectTimer);
    _autoConnectTimer = null;
    Logger.debug('Bridge', 'Auto-connect stopped');
  }
}

// ── Connect / Disconnect ──────────────────────────────────────────────────────

/**
 * Connect to the KiCad bridge plugin WS server.
 * @param {number} [port=40001]
 */
export async function connectBridge(port = 40001) {
  try {
    const result = await invokeNow(BRIDGE_CONNECT, { port });
    Logger.info('Bridge', 'Connect requested', result.message);
    return result;
  } catch (err) {
    Logger.error('Bridge', err, 'Connect failed');
    throw err;
  }
}

/** Disconnect from the bridge plugin. */
export async function disconnectBridge() {
  try {
    await invokeNow(BRIDGE_DISCONNECT);
    store.bridgeConnected = false;
    store.boardState      = null;
    store.boardComponents = [];
    store.boardNets       = [];
  } catch (err) {
    Logger.error('Bridge', err, 'Disconnect failed');
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/** Request a fresh board state snapshot from KiCad. */
export function requestBoardState() {
  return invoke(BRIDGE_REQUEST_BOARD_STATE);
}

/**
 * Highlight a component by reference designator.
 * Arg name `reference` must match Rust handler exactly.
 * @param {string} ref — e.g. "U1", "R5"
 */
export function highlightComponent(ref) {
  return invoke(BRIDGE_HIGHLIGHT_COMPONENT, { reference: ref });
}

/**
 * Highlight a net by name.
 * Arg name `net` must match Rust handler exactly.
 * @param {string} net — e.g. "GND", "VCC"
 */
export function highlightNet(net) {
  return invoke(BRIDGE_HIGHLIGHT_NET, { net });
}

/**
 * Request analytics for a net (pad/via/track counts, trace length, layers,
 * connected refs). Result arrives asynchronously via `bridge:net_info` →
 * lands in `store.netInfo`.
 * @param {string} net — e.g. "GND", "VCC"
 */
export function requestNetInfo(net) {
  // Optimistic: mark loading so the UI can show a spinner
  store.netInfo = { net, loading: true };
  return invoke(BRIDGE_REQUEST_NET_INFO, { net });
}

/**
 * Trigger pcbnew.ZONE_FILLER to re-fill copper zones.
 * Result lands via `bridge:op_result` event with op='regenerate_zones'
 * → store.zoneFillResult.
 * @param {{ filter_layer?: string, filter_net?: string, check_fill?: boolean }} [opts]
 */
export function regenerateZones(opts = {}) {
  // Optimistic loading state
  store.zoneFillResult = { loading: true, op: 'regenerate_zones' };
  return invoke(BRIDGE_REGENERATE_ZONES, {
    filter_layer: opts.filter_layer ?? '',
    filter_net:   opts.filter_net   ?? '',
    check_fill:   opts.check_fill   ?? true,
  });
}

/**
 * Find / remove orphan vias. Result lands via `bridge:op_result` op='purge_orphan_vias'.
 * In dry-run mode (default), returns the orphan list without modifying the board.
 * @param {{ filter_net?: string, dry_run?: boolean }} [opts]
 */
export function purgeOrphanVias(opts = {}) {
  store.viaPurgeResult = { loading: true, op: 'purge_orphan_vias', dry_run: opts.dry_run ?? true };
  return invoke(BRIDGE_PURGE_ORPHAN_VIAS, {
    filter_net: opts.filter_net ?? '',
    dry_run:    opts.dry_run    ?? true,
  });
}

/** Clear all KiCad highlights. */
export function clearHighlight() {
  return invoke(BRIDGE_CLEAR_HIGHLIGHT);
}

// ── Poll interval control ────────────────────────────────────────────────────

/**
 * Set watcher poll intervals on the bridge plugin.
 * @param {{ selection_poll_ms?: number, board_poll_ms?: number }} intervals
 */
export function setPollIntervals(intervals) {
  return invoke(BRIDGE_SEND, {
    payload: { type: 'set_poll_intervals', data: intervals },
  });
}

/**
 * Request current poll intervals from the bridge plugin.
 * Result arrives via `bridge:poll_intervals` event → store.bridgePollIntervals
 */
export function getPollIntervals() {
  return invoke(BRIDGE_SEND, {
    payload: { type: 'get_poll_intervals' },
  });
}

/** Get the last cached board state (from Rust state, not live). */
export function getBoardState() {
  return invokeNow(BRIDGE_GET_BOARD_STATE);
}

/** Install the bridge plugin to the KiCad scripting plugins directory. */
export function installBridgePlugin() {
  return invokeNow(INSTALL_BRIDGE_PLUGIN);
}

/** Get the expected plugin install path for display. */
export function getPluginInstallPath() {
  return invokeNow(GET_PLUGIN_INSTALL_PATH);
}

// ── Phase 5 write commands ─────────────────────────────────────────────────────
// All writes must be gated behind human confirmation BEFORE calling these.
// Arg names must match Rust handler parameter names exactly (Rule 3).

/**
 * Move a footprint to an absolute board position.
 * @param {string} reference   e.g. "U1"
 * @param {number} x_mm        X position in millimetres
 * @param {number} y_mm        Y position in millimetres
 * @returns {Promise<{success:boolean, message:string}>}
 */
export function moveComponent(reference, x_mm, y_mm) {
  return invokeNow(BRIDGE_MOVE_COMPONENT, { reference, x_mm, y_mm });
}

/**
 * Set absolute rotation of a footprint.
 * @param {string} reference   e.g. "U1"
 * @param {number} angle_deg   Angle in degrees (0–360)
 * @returns {Promise<{success:boolean, message:string}>}
 */
export function rotateComponent(reference, angle_deg) {
  return invokeNow(BRIDGE_ROTATE_COMPONENT, { reference, angle_deg });
}

/**
 * Lock or unlock a footprint.
 * @param {string}  reference
 * @param {boolean} locked
 * @returns {Promise<{success:boolean, message:string}>}
 */
export function setLocked(reference, locked) {
  return invokeNow(BRIDGE_SET_LOCKED, { reference, locked });
}

/**
 * Set or clear the DNP (Do Not Place) flag.
 * @param {string}  reference
 * @param {boolean} dnp
 * @returns {Promise<{success:boolean, message:string}>}
 */
export function setDnp(reference, dnp) {
  return invokeNow(BRIDGE_SET_DNP, { reference, dnp });
}

// ── Event handlers ────────────────────────────────────────────────────────────

/** @param {BridgeConnectedPayload} payload */
function _onConnected(payload) {
  Logger.info('Bridge', 'Connected', payload);
  store.bridgeConnected     = true;
  store.bridgeKicadVersion  = payload.kicad_version || null;
  store.bridgeBoardName     = payload.board_name    || null;

  _stopAutoConnect();

  // Immediately request full board state
  requestBoardState().catch(() => {});
}

function _onDisconnected() {
  Logger.info('Bridge', 'Disconnected');
  store.bridgeConnected    = false;
  store.bridgeKicadVersion = null;
  store.bridgeBoardName    = null;

  // Resume auto-connect so we reconnect when KiCad restarts
  startAutoConnect();
}

function _onBoardState(data) {
  if (!data) return;
  store.boardState      = data;
  store.boardComponents = data.components || [];
  store.boardNets       = (data.nets || []).map(n => (typeof n === 'string' ? n : n.name));
  store.boardLayers     = data.layers || [];
  store.boardDiag       = data._diag || [];
  Logger.info('Bridge', `Board state: ${store.boardComponents.length} components, ${store.boardNets.length} nets, diag: ${(data._diag || []).join(' | ')}`);
}

function _onBoardChanged() {
  // Board was modified in KiCad — request a fresh snapshot
  requestBoardState().catch(() => {});
}

/** @param {{ refs: string[], nets: string[] }} data */
function _onSelection(data) {
  store.selectedRefs = data.refs || [];
  store.selectedNets = data.nets || [];
}

/**
 * Net analytics result from the plugin.
 * @param {{
 *   net: string, found: boolean,
 *   pad_count?: number, via_count?: number, track_count?: number,
 *   total_length_mm?: number, min_width_mm?: number, max_width_mm?: number,
 *   layers?: string[], connected_refs?: string[], error?: string
 * }} data
 */
function _onNetInfo(data) {
  store.netInfo = { ...data, loading: false };
}

/**
 * Forwarded write-op result from the bridge (move/rotate/lock/dnp/regenerate_zones).
 * Routes by `op` field — currently surfaces `regenerate_zones` into store.zoneFillResult.
 * Move/rotate/lock/dnp already drive their own dialogs, so they're emitted but not stored.
 * @param {{ type: 'op_result', op: string, success: boolean, message: string, [k:string]: any }} payload
 */
function _onOpResult(payload) {
  if (!payload) return;
  if (payload.op === 'regenerate_zones') {
    store.zoneFillResult = { ...payload, loading: false };
  } else if (payload.op === 'purge_orphan_vias') {
    store.viaPurgeResult = { ...payload, loading: false };
  }
  // Component write ops keep their existing handling — emit a generic DOM event so
  // anyone interested (e.g. notifications) can listen.
  try {
    document.dispatchEvent(new CustomEvent('km-bridge-op-result', { detail: payload }));
  } catch (err) {
    Logger.warn('Bridge', 'op_result dispatch failed', err);
  }
}

/** @param {{ selection_poll_ms: number, board_poll_ms: number }} data */
function _onPollIntervals(data) {
  if (!data) return;
  store.bridgePollIntervals = data;
  Logger.info('Bridge', `Poll intervals: selection=${data.selection_poll_ms}ms, board=${data.board_poll_ms}ms`);
}

/** @param {{ message: string }} payload */
function _onBridgeError(payload) {
  Logger.warn('Bridge', 'Error from plugin', payload.message);
}

// ── Browser dev mode ──────────────────────────────────────────────────────────

function _setupDevModeListeners() {
  // Simulate a connection after 1s for browser testing
  setTimeout(() => {
    _onConnected({
      port: 40001,
      kicad_version: '10.0.1',
      board_name: 'mock_board.kicad_pcb',
      plugin_version: '0.1.0',
    });
    _onBoardState({
      board_name:         'mock_board.kicad_pcb',
      copper_layer_count: 4,
      component_count:    42,
      net_count:          18,
      layers:             ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'],
      nets: [
        { name: 'GND',      netcode: 1 },
        { name: 'VCC',      netcode: 2 },
        { name: 'VCC_3V3',  netcode: 3 },
        { name: 'SDA',      netcode: 4 },
        { name: 'SCL',      netcode: 5 },
        { name: 'UART_TX',  netcode: 6 },
        { name: 'UART_RX',  netcode: 7 },
      ],
      components: [
        { ref: 'U1', value: 'STM32F4', footprint: 'Package_QFP:LQFP-64', position: { x: 50, y: 40 }, rotation: 0,   on_back: false, locked: false, dnp: false, fields: { MPN: 'STM32F405RGT6' } },
        { ref: 'U2', value: 'TPS62130', footprint: 'Package_TO_SOT_SMD:SOT-23-6', position: { x: 20, y: 60 }, rotation: 90, on_back: false, locked: false, dnp: false, fields: {} },
        { ref: 'C1', value: '100nF', footprint: 'Capacitor_SMD:C_0402', position: { x: 45, y: 35 }, rotation: 0,   on_back: false, locked: false, dnp: false, fields: {} },
        { ref: 'C2', value: '10uF',  footprint: 'Capacitor_SMD:C_0805', position: { x: 55, y: 35 }, rotation: 0,   on_back: false, locked: false, dnp: false, fields: {} },
        { ref: 'R1', value: '10k',   footprint: 'Resistor_SMD:R_0402',  position: { x: 30, y: 50 }, rotation: 90, on_back: false, locked: false, dnp: false, fields: {} },
      ],
      board_size: { width_mm: 80, height_mm: 60, x_mm: 0, y_mm: 0 },
      design_rules: { min_clearance_mm: 0.15, min_track_width_mm: 0.127, min_via_drill_mm: 0.3 },
    });
  }, 1000);
}
