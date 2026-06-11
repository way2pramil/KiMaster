/**
 * KiCad IPC API Client — JS layer.
 *
 * Connects to KiCad's built-in NNG/protobuf IPC server (KiCad 9+).
 * This is the stable replacement for the deprecated SWIG Python bridge for
 * schematic operations — read/write symbols, fields, DNP, netlist.
 *
 * The WS bridge (BridgeClient.js) remains active for push events (selection,
 * board_changed). IpcClient handles all schematic read/write operations.
 *
 * Events emitted via Tauri (subscribed here):
 *   "ipc:connected"    → { socket_path }
 *   "ipc:disconnected" → {}
 *   "ipc:error"        → { message }
 *
 * @module IpcClient
 */

import { invoke, invokeNow } from '../../core/Ipc.js';
import { store } from '../../core/State.js';
import { Logger } from '../../core/Logger.js';
import {
  IPC_CONNECTED, IPC_DISCONNECTED, IPC_ERROR,
} from '../../core/AppEvents.js';
import {
  IPC_SCAN, IPC_CONNECT, IPC_DISCONNECT, IPC_GET_STATUS,
  IPC_GET_PCB_DATA, IPC_GET_SCHEMATIC_SYMBOLS, IPC_GET_SCHEMATIC_NETLIST,
} from '../../core/AppCommands.js';

/** @type {Function|null} Tauri event unsubscribe handle */
let _unlisten = null;

/** @type {boolean} */
let _initialized = false;

// ── Typedefs ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IpcSymbolSummary
 * @property {string} id           - KIID (UUID string)
 * @property {string} reference    - e.g. "U1"
 * @property {string} value        - e.g. "STM32F405"
 * @property {string} footprint    - e.g. "Package_QFP:LQFP-64"
 * @property {string} datasheet
 * @property {string} lib_id       - e.g. "MCU_ST_STM32F4:STM32F405RGTx"
 * @property {boolean} dnp
 * @property {boolean} exclude_from_bom
 */

// ── Init / teardown ───────────────────────────────────────────────────────────

/**
 * Initialize Tauri event listeners for IPC events.
 * Safe to call multiple times (idempotent).
 */
export async function initIpcListeners() {
  if (_initialized) return;
  _initialized = true;

  if (!window.__TAURI_INTERNALS__) {
    Logger.info('IPC', 'Browser mode — using mock IPC listeners');
    _setupDevMockListeners();
    return;
  }

  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unsubs = await Promise.all([
      listen(IPC_CONNECTED,    (e) => _onConnected(e.payload)),
      listen(IPC_DISCONNECTED, ()  => _onDisconnected()),
      listen(IPC_ERROR,        (e) => _onError(e.payload)),
    ]);
    _unlisten = () => unsubs.forEach(fn => fn());
    Logger.info('IPC', 'Event listeners registered');
  } catch (err) {
    Logger.warn('IPC', 'Tauri event API unavailable', err);
  }
}

export function disposeIpcListeners() {
  _unlisten?.();
  _unlisten = null;
  _initialized = false;
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

/**
 * Scan for a running KiCad IPC server and return the result.
 * Also detects token drift (KiCad restart) and clears stale state.
 * @returns {Promise<{ found: boolean, socket_path: string|null, token: string|null }>}
 */
export function scanForKiCad() {
  return invokeNow(IPC_SCAN);
}

/**
 * Auto-scan and connect to KiCad IPC in one step.
 * Updates store.ipcConnected on success.
 * @param {{ socket_path?: string, token?: string }} [opts]
 */
export async function scanAndConnect(opts = {}) {
  try {
    const result = await invokeNow(IPC_CONNECT, opts);
    if (result.success) {
      Logger.info('IPC', 'Connected', result.socket_path);
    } else {
      Logger.warn('IPC', 'Connect failed:', result.message);
    }
    return result;
  } catch (err) {
    Logger.error('IPC', err, 'scanAndConnect failed');
    throw err;
  }
}

/** Disconnect from the KiCad IPC server. */
export async function disconnect() {
  try {
    await invokeNow(IPC_DISCONNECT);
    store.ipcConnected  = false;
    store.ipcSocketPath = null;
  } catch (err) {
    Logger.error('IPC', err, 'disconnect failed');
  }
}

/** Get current IPC connection status from Rust state. */
export function getStatus() {
  return invokeNow(IPC_GET_STATUS);
}

// ── Schematic read ────────────────────────────────────────────────────────────

/**
 * Get full PCB board data via SaveDocumentToString + Rust S-expression parser.
 * Works in KiCad 10 (bypasses GetItems AS_BUSY).
 * Updates store.ipcPcbData on success.
 * @returns {Promise<{ board_name, components, nets, layers, source, parse_error }>}
 */
export async function getPcbData() {
  store.ipcPcbLoading = true;
  try {
    const result = await invokeNow(IPC_GET_PCB_DATA);
    if (!result.parse_error) {
      store.ipcPcbData       = result;
      store.ipcPcbComponents = result.components || [];
      store.ipcPcbNets       = result.nets || [];
      store.ipcPcbLayers     = result.layers || [];
      Logger.info('IPC', `PCB: ${result.components?.length ?? 0} components, ${result.nets?.length ?? 0} nets (${result.source})`);
    } else {
      Logger.warn('IPC', 'PCB parse error:', result.parse_error);
    }
    return result;
  } finally {
    store.ipcPcbLoading = false;
  }
}

/**
 * Retrieve live schematic symbols via the KiCad IPC API.
 *
 * Returns `{ success: false, message, symbols: [] }` if KiCad returns
 * AS_UNIMPLEMENTED — meaning this KiCad version doesn't support schematic IPC yet.
 *
 * @param {string} [docPath] - Optional absolute path to the .kicad_sch file.
 *                             Auto-detects the open schematic if omitted.
 * @returns {Promise<{ success: boolean, message: string, symbols: IpcSymbolSummary[] }>}
 */
export async function getSchematicSymbols(docPath) {
  store.ipcSchematicLoading = true;
  try {
    const result = await invokeNow(IPC_GET_SCHEMATIC_SYMBOLS, { doc_path: docPath ?? null });
    if (result.success) {
      store.ipcSchematicSymbols = result.symbols;
      Logger.info('IPC', `Schematic: ${result.symbols.length} symbols`);
    } else {
      Logger.warn('IPC', 'get_schematic_symbols:', result.message);
    }
    return result;
  } finally {
    store.ipcSchematicLoading = false;
  }
}

/**
 * Retrieve the schematic netlist (net names).
 * @returns {Promise<{ success: boolean, nets: { name: string }[] }>}
 */
export async function getSchematicNetlist() {
  return invokeNow(IPC_GET_SCHEMATIC_NETLIST);
}

// ── Event handlers ────────────────────────────────────────────────────────────

function _onConnected(payload) {
  Logger.info('IPC', 'Connected', payload);
  store.ipcConnected  = true;
  store.ipcSocketPath = payload?.socket_path ?? null;
}

function _onDisconnected() {
  Logger.info('IPC', 'Disconnected');
  store.ipcConnected        = false;
  store.ipcSocketPath       = null;
  store.ipcSchematicSymbols = [];
}

function _onError(payload) {
  Logger.warn('IPC', 'Error:', payload?.message);
}

// ── Browser dev mock ──────────────────────────────────────────────────────────

function _setupDevMockListeners() {
  setTimeout(() => {
    _onConnected({ socket_path: '\\\\.\\pipe\\kicad-mock-api' });
  }, 1500);
}
