/**
 * KiMaster IPC Batcher — single-frame batched Tauri invoke calls.
 * Queues multiple IPC calls and flushes once per animation frame,
 * preventing IPC congestion when multiple modules update simultaneously.
 *
 * Usage:
 *   import { invoke, batchInvoke } from './Ipc.js';
 *   const result = await invoke('cmd_get_app_info');
 *
 * @module Ipc
 */

import { Logger } from './Logger.js';

/** @type {Function|null} lazy-loaded tauri invoke */
let _tauriInvoke = null;

/** @type {boolean} */
let _isTauri = false;

/** @type {Array<{ cmd: string, args: any, resolve: Function, reject: Function }>} */
let _queue = [];

/** @type {number|null} */
let _flushScheduled = null;

/**
 * Initializes the IPC module. Called once from main.js.
 */
export async function initIpc() {
  // window.__TAURI_INTERNALS__ is injected by the Tauri runtime.
  // Without it, @tauri-apps/api/core imports fine but invoke() hangs forever.
  if (!window.__TAURI_INTERNALS__) {
    _isTauri = false;
    Logger.info('Ipc', 'Running outside Tauri — using mock responses.');
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _tauriInvoke = invoke;
    _isTauri = true;
  } catch (err) {
    _isTauri = false;
    Logger.warn('Ipc', 'Tauri API import failed — using mock responses.', err);
  }
}

/**
 * Invoke a Tauri backend command. Batched per animation frame.
 * @template T
 * @param {string} cmd
 * @param {Record<string, any>} [args]
 * @returns {Promise<T>}
 */
export function invoke(cmd, args = {}) {
  if (!_isTauri) {
    return _mockInvoke(cmd, args);
  }

  return new Promise((resolve, reject) => {
    _queue.push({ cmd, args, resolve, reject });
    _scheduleFlush();
  });
}

function _scheduleFlush() {
  if (_flushScheduled !== null) return;
  _flushScheduled = requestAnimationFrame(_flush);
}

function _flush() {
  _flushScheduled = null;
  const batch = _queue.splice(0);
  for (const { cmd, args, resolve, reject } of batch) {
    _tauriInvoke(cmd, args).then(resolve).catch(reject);
  }
}

/**
 * Invoke immediately, bypassing the batch queue.
 * Use for commands where the result is needed synchronously before the next frame.
 * @template T
 * @param {string} cmd
 * @param {Record<string, any>} [args]
 * @returns {Promise<T>}
 */
export function invokeNow(cmd, args = {}) {
  if (!_isTauri) return _mockInvoke(cmd, args);
  return _tauriInvoke(cmd, args);
}

/**
 * Mock responses for browser dev without Tauri.
 * @param {string} cmd
 * @param {any} _args
 * @returns {Promise<any>}
 */
async function _mockInvoke(cmd, _args) {
  await new Promise(r => setTimeout(r, 20));
  const mocks = {
    cmd_get_app_info: {
      name: 'KiMaster',
      version: '0.1.0',
      kicad_cli_path: null,
    },
    cmd_get_kicad_cli_path: {
      found: false,
      path: null,
      version: null,
    },
    cmd_get_bridge_status: {
      connected: false,
      port: 40001,
      ws_url: 'ws://127.0.0.1:40001',
    },
    cmd_get_project_state: { active_project: null },
    cmd_open_project:      { success: false, project: null, message: 'Mock: cannot open project in browser mode' },
    cmd_close_project:     null,
    cmd_get_recent_projects: [
      { name: 'TCU',        path: 'D:\\Projects\\TCU\\TCU.kicad_pro',               last_opened: '2026-05-30' },
      { name: 'PowerBoard', path: 'D:\\Projects\\PowerBoard\\PowerBoard.kicad_pro', last_opened: '2026-05-28' },
      { name: 'USBHub',     path: 'D:\\Projects\\USBHub\\USBHub.kicad_pro',         last_opened: '2026-05-25' },
    ],
    cmd_pick_and_open_project: { success: false, project: null, message: 'Mock: file picker unavailable in browser mode' },
    cmd_run_drc: {
      report: {
        kicad_version: '10.0.1',
        source: 'mock.kicad_pcb',
        date: new Date().toISOString(),
        coordinate_units: 'mm',
        violations: [
          { description: 'Clearance violation (0.2mm; actual 0.15mm)', severity: 'error', violation_type: 'clearance', items: [
            { description: 'Pad 1 on F.Cu', pos: { x: 100.5, y: 50.2 }, uuid: 'mock-001' }
          ]},
          { description: 'Silk-to-mask clearance', severity: 'warning', violation_type: 'silk_edge_clearance', items: [
            { description: 'Text on F.SilkS', pos: { x: 80.0, y: 30.0 }, uuid: 'mock-002' }
          ]},
        ],
        unconnected_items: [],
        schematic_parity: [],
      },
      raw: { exit_code: 0, stdout: '', stderr: '', success: true },
      output_file: null,
    },
    cmd_run_erc: {
      report: {
        kicad_version: '10.0.1',
        source: 'mock.kicad_sch',
        date: new Date().toISOString(),
        coordinate_units: 'mm',
        sheets: [{
          path: '/',
          uuid_path: '/mock-sheet',
          violations: [
            { description: 'Pin unconnected', severity: 'error', violation_type: 'pin_not_connected', items: [
              { description: 'Pin 3 of U1', pos: { x: 50, y: 80 }, uuid: 'erc-001' }
            ]},
          ],
        }],
      },
      raw: { exit_code: 0, stdout: '', stderr: '', success: true },
      output_file: null,
    },
    // KiCad IPC API commands
    // KiCad 10 on Windows: socket at %LOCALAPPDATA%\Temp\kicad\api.sock (named pipe, not a file)
    cmd_ipc_scan:                    { found: true, socket_path: 'C:\\Users\\mock\\AppData\\Local\\Temp\\kicad\\api.sock', token: '' },
    cmd_ipc_connect:                 { success: true, message: 'Mock: connected to KiCad IPC', socket_path: 'C:\\Users\\mock\\AppData\\Local\\Temp\\kicad\\api.sock' },
    cmd_ipc_disconnect:              null,
    cmd_ipc_get_status:              { connected: true, socket_path: 'C:\\Users\\mock\\AppData\\Local\\Temp\\kicad\\api.sock', kicad_version: '10.0.1' },
    cmd_ipc_get_pcb_data: {
      board_name: 'mock_board.kicad_pcb',
      source: 'ipc_string',
      parse_error: null,
      layers: ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'],
      nets: [
        { name: 'GND', netcode: 1 }, { name: 'VCC', netcode: 2 },
        { name: 'VCC_3V3', netcode: 3 }, { name: 'SDA', netcode: 4 },
      ],
      components: [
        { ref_: 'U1', value: 'STM32F405', footprint: 'Package_QFP:LQFP-64',  position: { x: 50, y: 40 }, rotation: 0,   on_back: false, locked: false, dnp: false, fields: { MPN: 'STM32F405RGT6' } },
        { ref_: 'C1', value: '100nF',      footprint: 'Capacitor_SMD:C_0402', position: { x: 45, y: 35 }, rotation: 0,   on_back: false, locked: false, dnp: false, fields: {} },
        { ref_: 'R1', value: '10k',        footprint: 'Resistor_SMD:R_0402',  position: { x: 30, y: 50 }, rotation: 90, on_back: false, locked: false, dnp: false, fields: {} },
      ],
    },
    cmd_ipc_get_schematic_symbols: {
      success: true,
      message: '5 symbols',
      symbols: [
        { id: 'uuid-001', reference: 'U1', value: 'STM32F405RGT6', footprint: 'Package_QFP:LQFP-64',       lib_id: 'MCU_ST_STM32F4:STM32F405RGTx', dnp: false, exclude_from_bom: false, datasheet: '' },
        { id: 'uuid-002', reference: 'U2', value: 'TPS62130',       footprint: 'Package_TO_SOT_SMD:SOT-23-6', lib_id: 'Regulator_Switching:TPS62130',  dnp: false, exclude_from_bom: false, datasheet: '' },
        { id: 'uuid-003', reference: 'C1', value: '100nF',           footprint: 'Capacitor_SMD:C_0402',        lib_id: 'Device:C',                      dnp: false, exclude_from_bom: false, datasheet: '' },
        { id: 'uuid-004', reference: 'C2', value: '10uF',            footprint: 'Capacitor_SMD:C_0805',        lib_id: 'Device:C',                      dnp: false, exclude_from_bom: false, datasheet: '' },
        { id: 'uuid-005', reference: 'R1', value: '10k',             footprint: 'Resistor_SMD:R_0402',         lib_id: 'Device:R',                      dnp: false, exclude_from_bom: false, datasheet: '' },
      ],
    },
    cmd_ipc_get_schematic_netlist:   { success: true, nets: [{ name: 'GND' }, { name: 'VCC' }, { name: 'VCC_3V3' }, { name: 'SDA' }, { name: 'SCL' }] },
    cmd_get_netlist_graph: {
      nodes: [
        { id: 'comp:U1', label: 'U1',  sub: 'STM32F405',  node_type: 'ic',        degree: 4 },
        { id: 'comp:U2', label: 'U2',  sub: 'TPS62130',   node_type: 'ic',        degree: 3 },
        { id: 'comp:C1', label: 'C1',  sub: '100nF',      node_type: 'passive',   degree: 2 },
        { id: 'comp:C2', label: 'C2',  sub: '10uF',       node_type: 'passive',   degree: 2 },
        { id: 'comp:R1', label: 'R1',  sub: '10k',        node_type: 'passive',   degree: 2 },
        { id: 'comp:J1', label: 'J1',  sub: 'USB-C',      node_type: 'connector', degree: 2 },
        { id: 'net:GND',     label: 'GND',     sub: '', node_type: 'power_net',  degree: 4 },
        { id: 'net:VCC',     label: 'VCC',     sub: '', node_type: 'power_net',  degree: 3 },
        { id: 'net:VCC_3V3', label: 'VCC_3V3', sub: '', node_type: 'power_net',  degree: 3 },
        { id: 'net:SDA',     label: 'SDA',     sub: '', node_type: 'signal_net', degree: 2 },
        { id: 'net:NET001',  label: 'NET001',  sub: '', node_type: 'signal_net', degree: 1 },
      ],
      links: [
        { source: 'comp:U1', target: 'net:GND',     pin: '12' },
        { source: 'comp:U1', target: 'net:VCC',     pin: '1'  },
        { source: 'comp:U1', target: 'net:VCC_3V3', pin: '3'  },
        { source: 'comp:U1', target: 'net:SDA',     pin: '23' },
        { source: 'comp:U2', target: 'net:GND',     pin: '2'  },
        { source: 'comp:U2', target: 'net:VCC',     pin: '1'  },
        { source: 'comp:U2', target: 'net:VCC_3V3', pin: '5'  },
        { source: 'comp:C1', target: 'net:GND',     pin: '2'  },
        { source: 'comp:C1', target: 'net:VCC_3V3', pin: '1'  },
        { source: 'comp:C2', target: 'net:GND',     pin: '2'  },
        { source: 'comp:C2', target: 'net:VCC',     pin: '1'  },
        { source: 'comp:R1', target: 'net:SDA',     pin: '1'  },
        { source: 'comp:R1', target: 'net:NET001',  pin: '2'  },
        { source: 'comp:J1', target: 'net:GND',     pin: '1'  },
        { source: 'comp:J1', target: 'net:NET001',  pin: '3'  },
      ],
      floating_nets: ['NET001'],
      isolated_components: [],
      stats: { component_count: 6, net_count: 5, link_count: 15, floating_net_count: 1 },
    },
    // Bridge commands (Phase 3)
    cmd_get_bridge_status:             { connected: false, port: 40001, ws_url: 'ws://127.0.0.1:40001', board_name: null, kicad_version: null, component_count: 0, net_count: 0, layers: [] },
    cmd_bridge_connect:                { success: true, message: 'Connecting to ws://127.0.0.1:40001 …', port: 40001 },
    cmd_bridge_disconnect:             null,
    cmd_bridge_send:                   null,
    cmd_bridge_request_board_state:       null,
    cmd_bridge_get_board_state:           null,
    cmd_bridge_request_schematic_state:   null,
    cmd_bridge_get_schematic_state:       null,
    cmd_bridge_highlight_component:    null,
    cmd_bridge_highlight_net:          null,
    cmd_bridge_request_net_info:       null,
    cmd_bridge_request_stackup:        null,
    cmd_bridge_regenerate_zones:       null,
    cmd_bridge_purge_orphan_vias:      null,
    cmd_bridge_clear_highlight:        null,
    cmd_bridge_move_component:         { success: true,  message: 'Mock: move_component' },
    cmd_bridge_rotate_component:       { success: true,  message: 'Mock: rotate_component' },
    cmd_bridge_set_locked:             { success: true,  message: 'Mock: set_locked' },
    cmd_bridge_set_dnp:                { success: true,  message: 'Mock: set_dnp' },
    cmd_open_directory:                null,
    cmd_check_plugin_installed:        { installed: true, install_path: 'C:\\Users\\prami\\AppData\\Roaming\\kicad\\10.0\\scripting\\plugins\\kimaster_plugin' },
    cmd_install_bridge_plugin:         { success: false, install_path: null, message: 'Mock: cannot install plugin in browser mode' },
    cmd_reinstall_bridge_plugin:       { success: false, install_path: null, message: 'Mock: cannot reinstall plugin in browser mode' },
    cmd_scan_kicad_instances:          [
      { port: 40001, board_name: 'D:/Upwork Project/TVS/TCU/TCU.kicad_pcb', kicad_version: '10.0.1' },
    ],
    cmd_get_plugin_install_path:       'C:\\Users\\user\\AppData\\Roaming\\kicad\\10.0\\scripting\\plugins\\kimaster_plugin',
    cmd_export_prepare_dir: (args) => ({ resolved_path: (args?.args?.path ?? './exports'), existed: false }),
    cmd_export_gerbers: { raw: { exit_code: 0, stdout: 'Mock gerber export complete', stderr: '', success: true }, output_path: './gerbers' },
    cmd_export_drill:   { raw: { exit_code: 0, stdout: 'Mock drill export complete', stderr: '', success: true }, output_path: './drill' },
    cmd_export_pos:     { raw: { exit_code: 0, stdout: 'Mock pos export complete', stderr: '', success: true }, output_path: './positions.csv' },
    cmd_export_svg:     { raw: { exit_code: 0, stdout: '', stderr: '', success: true }, output_path: './board.svg' },
    cmd_export_pdf:     { raw: { exit_code: 0, stdout: '', stderr: '', success: true }, output_path: './board.pdf' },
    cmd_export_bom:     { raw: { exit_code: 0, stdout: '', stderr: '', success: true }, output_path: './bom.csv' },
    cmd_export_sch_pdf: { raw: { exit_code: 0, stdout: '', stderr: '', success: true }, output_path: './schematic.pdf' },
    cmd_export_sch_svg: { raw: { exit_code: 0, stdout: '', stderr: '', success: true }, output_path: './schematic' },
    // Git (Phase 7)
    cmd_git_status:      { available: false, is_repo: false, git_version: null, repo_root: null },
    cmd_git_get_history: { commits: [
      { hash: 'abc123def456', short: 'abc123de', date: '2026-05-28', author: 'Engineer', message: 'Add bypass caps on VCC rails', files: ['board.kicad_pcb'] },
      { hash: 'fedcba987654', short: 'fedcba98', date: '2026-05-27', author: 'Engineer', message: 'Route differential pairs on B.Cu', files: ['board.kicad_pcb'] },
      { hash: '111222333444', short: '11122233', date: '2026-05-26', author: 'Engineer', message: 'Initial component placement', files: ['board.kicad_pcb', 'board.kicad_sch'] },
    ], error: null },
    cmd_git_diff_drc:    { diff: { added: [], fixed: [], unchanged: [] }, commit_short: 'abc123de', error: null },
    cmd_git_show_file:   '',
    // Fab pack (Phase 8)
    cmd_export_step:     { raw: { exit_code: 0, stdout: 'Mock STEP export complete', stderr: '', success: true }, output_path: './board.step' },
    cmd_export_fab_pack: { success: true, output_dir: './fab_jlcpcb_2layer_mock', files: [], message: 'Mock: fab pack export (browser mode)' },
    // Export profile commands
    cmd_list_export_profiles: [
      { id: 'kimaster_universal', name: 'KiMaster Universal',    is_builtin: true },
      { id: 'jlcpcb',            name: 'JLCPCB',                is_builtin: true },
      { id: 'pcbway',            name: 'PCBWay',                is_builtin: true },
      { id: 'global',            name: 'Global (IPC-compatible)', is_builtin: true },
    ],
    cmd_load_export_profile:   (args) => {
      // Return a minimal profile for browser mock
      const builtins = {
        kimaster_universal: { id: 'kimaster_universal', name: 'KiMaster Universal', is_builtin: true, target: 'project_relative', rootPath: 'exports', pattern: '{output_type}', openOnComplete: true, cleanTarget: false, configs: {} },
        jlcpcb:  { id: 'jlcpcb',  name: 'JLCPCB',  is_builtin: true, target: 'project_relative', rootPath: 'JLCPCB_Fab',  pattern: '{version}/{output_type}', openOnComplete: true, cleanTarget: false, configs: { gerbers: { layers: ['F.Cu','B.Cu','F.SilkS','B.SilkS','F.Mask','B.Mask','Edge.Cuts'], precision: 6, use_x2: true, include_netlist: true, subtract_soldermask: true }, drill: { format: 'excellon', units: 'mm', separate_th: true }, pos: { side: 'both', format: 'csv', units: 'mm', exclude_dnp: true }, bom: { fields: ['Reference','Value','Footprint','Quantity','LCSC'], group_by: ['Value','Footprint'], sort_by: ['Reference'] } } },
        pcbway:  { id: 'pcbway',  name: 'PCBWay',  is_builtin: true, target: 'project_relative', rootPath: 'PCBWay_Fab',  pattern: '{version}/{output_type}', openOnComplete: true, cleanTarget: false, configs: { bom: { fields: ['Reference','Value','Footprint','Quantity','MPN'], group_by: ['Value','Footprint'], sort_by: ['Reference'] } } },
        global:  { id: 'global',  name: 'Global (IPC-compatible)', is_builtin: true, target: 'project_relative', rootPath: 'Global_Fab', pattern: '{version}/{output_type}', openOnComplete: true, cleanTarget: false, configs: { gerbers: { use_x2: false }, bom: { fields: ['Reference','Value','Footprint','Quantity','MPN','Datasheet'] } } },
      };
      return builtins[args?.args?.id] ?? builtins['kimaster_universal'];
    },
    cmd_save_export_profile:   (args) => ({ id: args?.args?.profile?.id ?? 'user_new' }),
    cmd_delete_export_profile: null,
    cmd_clone_builtin_profile: (args) => ({ id: `user_${args?.args?.builtin_id ?? 'clone'}`, name: args?.args?.name ?? 'Cloned', is_builtin: false, target: 'project_relative', rootPath: 'exports', pattern: '{output_type}', openOnComplete: true, cleanTarget: false, configs: {} }),
    // Live 3D viewer
    cmd_read_pcb_file: '', // Cannot read files in browser mode — Live 3D shows empty state
    cmd_file_exists:   false,
    cmd_export_glb:    { raw: { exit_code: 0, stdout: 'Mock GLB export', stderr: '', success: true }, output_path: '' },
    // PCB 3D parallel pipeline
    cmd_pcb3d_export_layers:        { success: false, output_dir: '', layers: [], message: 'Browser mock' },
    cmd_pcb3d_export_vrml:          { success: false, pcb_wrl: '', components_dir: '', message: 'Browser mock' },
    cmd_pcb3d_export_marketing_glb: { success: false, output_file: '', message: 'Browser mock', file_size_kb: 0 },
    cmd_pcb3d_file_exists:          false,
    cmd_pcb3d_read_file:            '',
    cmd_pcb3d_list_dir:             [],
    // 3D Render (Phase 11)
    cmd_render_pcb:        { raw: { exit_code: 0, stdout: 'Mock 3D render complete', stderr: '', success: true }, output_path: './render_top.png' },
    cmd_render_all_sides:  {
      success: true,
      output_dir: './renders_mock',
      files: [
        './renders_mock/render_top.png', './renders_mock/render_bottom.png',
        './renders_mock/render_front.png', './renders_mock/render_back.png',
        './renders_mock/render_left.png', './renders_mock/render_right.png',
      ],
      failures: [],
      message: 'Mock: 6 views rendered (browser mode).',
    },
    // UCE (Phase 9B)
    cmd_uce_search: {
      total: 3,
      results: [
        { lcsc: 'C49678',  name: 'NE555P',       mpn: 'NE555P',          manufacturer: 'Texas Instruments', package: 'SOIC-8',  description: 'Single Precision Timer',         stock: 10000, price: 0.12,  part_type: 'Basic',    datasheet: '', category: 'Timer',          in_vault: false },
        { lcsc: 'C25804',  name: 'CC0603KRX7R9BB104', mpn: 'CC0603KRX7R9BB104', manufacturer: 'YAGEO', package: 'C0603', description: '100nF 50V 10% X7R MLCC',     stock: 50000, price: 0.005, part_type: 'Basic',    datasheet: '', category: 'Capacitor',      in_vault: true  },
        { lcsc: 'C2837920',name: 'ESP32-S3-WROOM-1', mpn: 'ESP32-S3-WROOM-1-N16R8', manufacturer: 'Espressif', package: 'SMD-32x18', description: 'ESP32-S3 WiFi/BT module', stock: 8000,  price: 3.50,  part_type: 'Extended', datasheet: '', category: 'WiFi Module',    in_vault: false },
      ],
    },
    cmd_uce_preview_component: {
      lcsc_id:       'C49678',
      title:         'NE555P',
      package:       'SOIC-8',
      manufacturer:  'Texas Instruments',
      mpn:           'NE555P',
      datasheet:     'https://datasheet.lcsc.com/lcsc/NE555P.pdf',
      pin_count:     8,
      pad_count:     8,
      has_symbol:    true,
      has_footprint: true,
      in_vault:      false,
    },
    cmd_uce_add_to_vault: {
      success:                    true,
      lcsc_id:                    'C49678',
      sym_path:                   'D:\\Project\\.kimaster\\library\\KiMaster.kicad_sym',
      mod_path:                   'D:\\Project\\.kimaster\\library\\KiMaster.pretty\\C49678.kicad_mod',
      has_symbol:                 true,
      has_footprint:              true,
      has_3d_model:               true,
      lib_registered:             true,
      lib_registered_first_time:  true,
      message:                    'Component C49678 added to vault (mock).',
      timings: { fetch_ms: 120, parse_ms: 8, model_ms: 210, model_cached: false, generate_ms: 3, write_ms: 4, total_ms: 345 },
    },
    cmd_uce_get_vault: [
      { lcsc_id: 'C25804', name: 'CC0603KRX7R9BB104', package: 'C0603',   manufacturer: 'YAGEO', mpn: 'CC0603KRX7R9BB104', description: '100nF 50V 10% X7R', added_at: '2026-05-28 14:22:00' },
      { lcsc_id: 'C17414', name: 'CC0603JRNPO9BN101', package: 'C0603',   manufacturer: 'YAGEO', mpn: 'CC0603JRNPO9BN101', description: '100pF NP0',         added_at: '2026-05-28 14:20:00' },
    ],
    cmd_uce_remove_from_vault: null,
    cmd_get_vault_dir: { path: 'C:\\Users\\user\\AppData\\Roaming\\com.kimaster.app\\vault' },
    cmd_set_vault_dir: { path: 'C:\\Users\\user\\AppData\\Roaming\\com.kimaster.app\\vault' },
    // Vault — Stackups
    cmd_vault_list_stackups: [
      { id: '4-layer-standard', name: '4-Layer Standard', layers: 4, description: 'Standard FR4 4-layer 1.6mm', thickness_mm: 1.6, added_at: '2026-05-28 10:00:00' },
      { id: '2-layer-budget',   name: '2-Layer Budget',   layers: 2, description: 'Budget 2-layer 1.0mm FR4',   thickness_mm: 1.0, added_at: '2026-05-28 10:00:00' },
    ],
    cmd_vault_save_stackup: '4-layer-standard',
    cmd_vault_load_stackup: { name: '4-Layer Standard', description: 'Standard FR4 4-layer 1.6mm', layers: [], total_thickness_mm: 1.6 },
    cmd_vault_remove_stackup: null,
    // Vault — Templates
    cmd_vault_list_templates: [
      { id: 'default-4layer', name: 'Default 4-Layer', description: 'Standard 4-layer with JLCPCB DRC rules', layers: 4, tags: 'jlcpcb,4-layer', added_at: '2026-05-28 10:00:00' },
    ],
    cmd_vault_import_template: 'default-4layer',
    cmd_vault_instantiate_template: null,
    cmd_vault_remove_template: null,
    // Vault — Blocks
    cmd_vault_list_blocks: [
      { id: 'buck-5v-3a', name: 'Buck 5V 3A', description: 'TPS5430 5V 3A step-down', category: 'Power', has_layout: true, tags: 'buck,5v,power', added_at: '2026-05-28 10:00:00' },
      { id: 'usb-c-power', name: 'USB-C Power Delivery', description: 'USB-C connector with CC resistors', category: 'Connector', has_layout: true, tags: 'usb-c,connector', added_at: '2026-05-28 10:00:00' },
    ],
    cmd_vault_import_block: 'buck-5v-3a',
    cmd_vault_remove_block: null,
    // Notes (Phase 10)
    cmd_read_notes: `# Engineering Notes\n\nOpen a KiCad project to start writing notes.\n\nExample smart-links:\n- Component: [R1], [C5], [U2]\n- Net: {GND}, {VCC}, {USB_DP}\n`,
    cmd_save_notes: null,
    cmd_read_tasks: [
      { id: 'mock-task-1', text: 'Verify bypass capacitor values on U1 VCC pins', done: false, created_at: new Date().toISOString() },
      { id: 'mock-task-2', text: 'Run DRC and fix clearance violations', done: true,  created_at: new Date().toISOString() },
      { id: 'mock-task-3', text: 'Submit Gerbers to JLCPCB for review', done: false, created_at: new Date().toISOString() },
    ],
    cmd_save_tasks: null,

    // ── Canvas (Footprint + Symbol editor) ──────────────────────────────────
    cmd_canvas_load_footprint: {
      elements: [
        // ── SOIC-8 mock footprint — exercises all primitive types ──
        // Pads (oval, SMD, F.Cu)
        { type: 'pad', id: 'pad-1', layer: 'F.Cu', x: -3.0, y: -1.905, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '1', net: 'VCC',  drill: 0 },
        { type: 'pad', id: 'pad-2', layer: 'F.Cu', x: -3.0, y: -0.635, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '2', net: '',     drill: 0 },
        { type: 'pad', id: 'pad-3', layer: 'F.Cu', x: -3.0, y:  0.635, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '3', net: '',     drill: 0 },
        { type: 'pad', id: 'pad-4', layer: 'F.Cu', x: -3.0, y:  1.905, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '4', net: 'GND',  drill: 0 },
        { type: 'pad', id: 'pad-5', layer: 'F.Cu', x:  3.0, y:  1.905, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '5', net: 'GND',  drill: 0 },
        { type: 'pad', id: 'pad-6', layer: 'F.Cu', x:  3.0, y:  0.635, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '6', net: '',     drill: 0 },
        { type: 'pad', id: 'pad-7', layer: 'F.Cu', x:  3.0, y: -0.635, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '7', net: '',     drill: 0 },
        { type: 'pad', id: 'pad-8', layer: 'F.Cu', x:  3.0, y: -1.905, shape: 'oval', width: 1.6, height: 0.6, angle: 0, number: '8', net: 'VCC',  drill: 0 },
        // Rotated rect pad for rendering validation
        { type: 'pad', id: 'pad-th1', layer: 'F.Cu', x: 0, y: 3.5, shape: 'rect', width: 1.2, height: 1.2, angle: 45, number: 'TP', net: '', drill: 0.8 },
        // F.Courtyard
        { type: 'line', id: 'cyd-t', layer: 'F.Courtyard', x: -4.5, y: -2.5, x2:  4.5, y2: -2.5, stroke_width: 0.05 },
        { type: 'line', id: 'cyd-r', layer: 'F.Courtyard', x:  4.5, y: -2.5, x2:  4.5, y2:  2.5, stroke_width: 0.05 },
        { type: 'line', id: 'cyd-b', layer: 'F.Courtyard', x:  4.5, y:  2.5, x2: -4.5, y2:  2.5, stroke_width: 0.05 },
        { type: 'line', id: 'cyd-l', layer: 'F.Courtyard', x: -4.5, y:  2.5, x2: -4.5, y2: -2.5, stroke_width: 0.05 },
        // F.SilkS body outline
        { type: 'line', id: 'silk-t',  layer: 'F.SilkS', x: -1.0, y: -2.2, x2:  3.8, y2: -2.2, stroke_width: 0.12 },
        { type: 'line', id: 'silk-r',  layer: 'F.SilkS', x:  3.8, y: -2.2, x2:  3.8, y2:  2.2, stroke_width: 0.12 },
        { type: 'line', id: 'silk-b',  layer: 'F.SilkS', x:  3.8, y:  2.2, x2: -3.8, y2:  2.2, stroke_width: 0.12 },
        { type: 'line', id: 'silk-l',  layer: 'F.SilkS', x: -3.8, y:  2.2, x2: -3.8, y2: -2.2, stroke_width: 0.12 },
        // Pin 1 notch arc on F.SilkS (3-point: start, mid, end)
        { type: 'arc', id: 'silk-arc', layer: 'F.SilkS', x: -1.0, y: -2.2, x2: 1.0, y2: -2.2, mid_x: 0.0, mid_y: -2.8, stroke_width: 0.12 },
        // F.Fab body (inner outline)
        { type: 'line', id: 'fab-t', layer: 'F.Fab', x: -3.5, y: -2.0, x2:  3.5, y2: -2.0, stroke_width: 0.1 },
        { type: 'line', id: 'fab-r', layer: 'F.Fab', x:  3.5, y: -2.0, x2:  3.5, y2:  2.0, stroke_width: 0.1 },
        { type: 'line', id: 'fab-b', layer: 'F.Fab', x:  3.5, y:  2.0, x2: -3.5, y2:  2.0, stroke_width: 0.1 },
        { type: 'line', id: 'fab-l', layer: 'F.Fab', x: -3.5, y:  2.0, x2: -3.5, y2: -2.0, stroke_width: 0.1 },
        // Pin 1 indicator polygon (triangle on F.Fab)
        { type: 'polygon', id: 'fab-pin1', layer: 'F.Fab', x: -3.167, y: -1.667, points: [-3.5, -2.0, -2.5, -2.0, -3.5, -1.0], stroke_width: 0.1, fill: 'solid' },
        // Cmts.User pin 1 mark (small cross)
        { type: 'line', id: 'cmts-x1', layer: 'Cmts.User', x: -3.0, y: -1.905, x2: -3.3, y2: -1.6, stroke_width: 0.05 },
        { type: 'line', id: 'cmts-x2', layer: 'Cmts.User', x: -3.3, y: -1.905, x2: -3.0, y2: -1.6, stroke_width: 0.05 },
        // Reference + value text
        { type: 'text', id: 'ref', layer: 'F.SilkS', x: 0, y: -3.5, text: 'U1',     font_size: 1.27, bold: false, italic: false },
        { type: 'text', id: 'val', layer: 'F.Fab',   x: 0, y:  3.5, text: 'NE555P', font_size: 1.27, bold: false, italic: false },
      ],
      temp_path: 'mock://temp/NE555.kicad_mod',
      original_hash: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    },
    cmd_canvas_save_footprint: { new_hash: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb' },
    cmd_canvas_load_symbol:    { elements: [], original_hash: '' },
    cmd_canvas_save_symbol:    { new_hash: '' },
    cmd_canvas_close:          null,
    cmd_canvas_pick_footprint: null, // null → dialog cancelled (browser has no native picker)
  };
  const resp = mocks[cmd];
  if (resp !== undefined) return typeof resp === 'function' ? resp(_args) : resp;
  const err = new Error(`No mock for command: ${cmd}`);
  Logger.warn('Ipc', err.message);
  throw err;
}
