/**
 * ExportConfigDefaults — default configs per export type and built-in profile templates.
 * Used as fallback in browser dev mode and to initialize config dialogs.
 */

// ── Standard KiCad layer list (shown when bridge not connected) ───────────────

export const STANDARD_KICAD_LAYERS = [
  'F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu',
  'In7.Cu', 'In8.Cu', 'B.Cu',
  'F.Adhes', 'B.Adhes',
  'F.Paste', 'B.Paste',
  'F.SilkS', 'B.SilkS',
  'F.Mask',  'B.Mask',
  'Dwgs.User', 'Cmts.User', 'Eco1.User', 'Eco2.User',
  'Edge.Cuts', 'Margin',
  'F.CrtYd', 'B.CrtYd',
  'F.Fab',   'B.Fab',
  'User.1', 'User.2', 'User.3', 'User.4', 'User.5', 'User.6', 'User.7', 'User.8',
];

// ── Default configs per export type ──────────────────────────────────────────

export const EXPORT_TYPE_DEFAULTS = {
  gerbers: {
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
    precision: 6,
    use_x2: true,
    include_netlist: true,
    subtract_soldermask: false,
    use_drill_origin: false,
    no_aperture_macros: false,
  },
  drill: {
    format: 'excellon',
    units: 'mm',
    origin: 'absolute',
    separate_th: false,
    generate_map: false,
    map_format: null,
    oval_holes_route: false,
  },
  pos: {
    side: 'both',
    format: 'csv',
    units: 'mm',
    exclude_dnp: false,
    exclude_board_only: false,
    negate_x: false,
  },
  svg: {
    layers: [],
    theme: null,
    black_and_white: false,
    board_area_only: true,
    mirror: false,
    negative: false,
    exclude_drawing_sheet: false,
  },
  pdf: {
    layers: [],
    theme: null,
    black_and_white: false,
    board_area_only: false,
    separate_files: false,
    mirror: false,
    scale: 1.0,
    exclude_drawing_sheet: false,
  },
  bom: {
    output_format: 'csv',
    fields: ['Reference', 'Value', 'Footprint', 'Quantity'],
    group_by: ['Value', 'Footprint'],
    sort_by: ['Reference'],
    ref_range_delimiter: '-',
    exclude_dnp: false,
  },
  sch_pdf: {
    black_and_white: false,
    exclude_drawing_sheet: false,
  },
  sch_svg: {
    black_and_white: false,
    exclude_drawing_sheet: false,
  },
  step: {
    format: 'step',
    use_drill_origin: true, use_grid_origin: false,
    board_center_origin: false, user_origin: null,
    no_board_body: false, no_components: false,
    no_unspecified: false, no_dnp: false,
    subst_models: true, include_pads: false,
    include_tracks: false, include_zones: false,
    include_inner_copper: false, fuse_shapes: false,
    fill_all_vias: false, net_filter: null,
    force: true, no_optimize_step: false,
    min_distance: 0.001,
  },
};

/**
 * Get the merged config for a type — profile config takes precedence over defaults.
 * @param {string} typeId
 * @param {object|null} profileConfigs
 * @returns {object}
 */
export function mergeConfig(typeId, profileConfigs) {
  const defaults = EXPORT_TYPE_DEFAULTS[typeId] ?? {};
  const override = profileConfigs?.[typeId] ?? {};
  return { ...defaults, ...override };
}

// ── Built-in profile objects (used as JS mock in browser dev mode) ────────────

const _gerberJlcpcb = {
  layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
  precision: 6, use_x2: true, include_netlist: true,
  subtract_soldermask: true, use_drill_origin: false, no_aperture_macros: false,
};
const _drillDefault = {
  format: 'excellon', units: 'mm', origin: 'absolute',
  separate_th: false, generate_map: false, map_format: null, oval_holes_route: false,
};
const _posDefault  = { side: 'both', format: 'csv', units: 'mm', exclude_dnp: false, exclude_board_only: false, negate_x: false };
const _svgDefault  = { layers: [], theme: null, black_and_white: false, board_area_only: true, mirror: false, negative: false, exclude_drawing_sheet: false };
const _pdfDefault  = { layers: [], theme: null, black_and_white: false, board_area_only: false, separate_files: false, mirror: false, scale: 1.0, exclude_drawing_sheet: false };
const _schPdf      = { black_and_white: false, exclude_drawing_sheet: false };
const _stepDefault = { format: 'step', use_drill_origin: true, use_grid_origin: false, board_center_origin: false, user_origin: null, no_board_body: false, no_components: false, no_unspecified: false, no_dnp: false, subst_models: true, include_pads: false, include_tracks: false, include_zones: false, include_inner_copper: false, fuse_shapes: false, fill_all_vias: false, net_filter: null, force: true, no_optimize_step: false, min_distance: 0.001 };

export const BUILTIN_PROFILES = [
  {
    id: 'kimaster_universal', name: 'KiMaster Universal', is_builtin: true,
    target: 'project_relative', rootPath: 'exports', pattern: '{output_type}',
    openOnComplete: true, cleanTarget: false,
    configs: {
      gerbers: { ...EXPORT_TYPE_DEFAULTS.gerbers },
      drill:   { ..._drillDefault },
      pos:     { ..._posDefault },
      svg:     { ..._svgDefault },
      pdf:     { ..._pdfDefault },
      bom:     { ...EXPORT_TYPE_DEFAULTS.bom },
      sch_pdf: { ..._schPdf }, sch_svg: { ..._schPdf },
      step:    { ..._stepDefault },
    },
  },
  {
    id: 'jlcpcb', name: 'JLCPCB', is_builtin: true,
    target: 'project_relative', rootPath: 'JLCPCB_Fab', pattern: '{version}/{output_type}',
    openOnComplete: true, cleanTarget: false,
    configs: {
      gerbers: { ..._gerberJlcpcb },
      drill:   { ..._drillDefault, separate_th: true },
      pos:     { ..._posDefault, exclude_dnp: true, exclude_board_only: true },
      svg:     { ..._svgDefault },
      pdf:     { ..._pdfDefault },
      bom:     { ...EXPORT_TYPE_DEFAULTS.bom, fields: ['Reference', 'Value', 'Footprint', 'Quantity', 'LCSC'] },
      sch_pdf: { ..._schPdf }, sch_svg: { ..._schPdf },
      step:    { ..._stepDefault, no_dnp: true },
    },
  },
  {
    id: 'pcbway', name: 'PCBWay', is_builtin: true,
    target: 'project_relative', rootPath: 'PCBWay_Fab', pattern: '{version}/{output_type}',
    openOnComplete: true, cleanTarget: false,
    configs: {
      gerbers: { ..._gerberJlcpcb, subtract_soldermask: false },
      drill:   { ..._drillDefault, separate_th: true },
      pos:     { ..._posDefault, exclude_dnp: true, exclude_board_only: true },
      svg:     { ..._svgDefault },
      pdf:     { ..._pdfDefault },
      bom:     { ...EXPORT_TYPE_DEFAULTS.bom, fields: ['Reference', 'Value', 'Footprint', 'Quantity', 'MPN'] },
      sch_pdf: { ..._schPdf }, sch_svg: { ..._schPdf },
      step:    { ..._stepDefault, no_dnp: true },
    },
  },
  {
    id: 'global', name: 'Global (IPC-compatible)', is_builtin: true,
    target: 'project_relative', rootPath: 'Global_Fab', pattern: '{version}/{output_type}',
    openOnComplete: true, cleanTarget: false,
    configs: {
      gerbers: { ..._gerberJlcpcb, use_x2: false, include_netlist: false, subtract_soldermask: false, layers: ['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'Edge.Cuts'] },
      drill:   { ..._drillDefault, generate_map: true, map_format: 'gerberx2' },
      pos:     { ..._posDefault },
      svg:     { ..._svgDefault, board_area_only: false },
      pdf:     { ..._pdfDefault },
      bom:     { ...EXPORT_TYPE_DEFAULTS.bom, fields: ['Reference', 'Value', 'Footprint', 'Quantity', 'MPN', 'Datasheet'] },
      sch_pdf: { ..._schPdf }, sch_svg: { ..._schPdf },
      step:    { ..._stepDefault, no_unspecified: true, subst_models: true },
    },
  },
];
