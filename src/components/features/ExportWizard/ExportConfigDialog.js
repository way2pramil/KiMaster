/**
 * ExportConfigDialog — type-specific configuration dialogs for each export type.
 * Each dialog reads currentConfig, presents type-appropriate controls,
 * and resolves with the updated config object or null if cancelled.
 */

import { STANDARD_KICAD_LAYERS } from '../../../modules/export/ExportConfigDefaults.js';

// ── CSS injected once into document head ─────────────────────────────────────

const _STYLE = `
.ecd-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0;
  max-height: 60vh;
  overflow-y: auto;
}
.ecd-body::-webkit-scrollbar { width: 5px; }
.ecd-body::-webkit-scrollbar-thumb { background: var(--km-scrollbar-thumb); border-radius: 3px; }

.ecd-section {
  font-size: 10px;
  font-weight: 600;
  color: var(--km-text-muted);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-top: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--km-border);
}
.ecd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--km-font-size-sm);
  color: var(--km-text-secondary);
  min-height: 26px;
}
.ecd-label {
  min-width: 130px;
  flex-shrink: 0;
  font-size: var(--km-font-size-xs);
  color: var(--km-text-muted);
}
.ecd-toggle { accent-color: var(--km-accent); }
.ecd-radio  { accent-color: var(--km-accent); }
.ecd-input {
  padding: 2px 6px;
  border-radius: var(--km-radius-xs);
  border: 1px solid var(--km-border);
  background: var(--km-bg-primary);
  color: var(--km-text-primary);
  font-family: var(--km-font-mono);
  font-size: var(--km-font-size-xs);
  width: 80px;
  outline: none;
}
.ecd-input:focus { border-color: var(--km-accent); }
.ecd-input.wide { width: 180px; }
.ecd-select {
  padding: 2px 6px;
  border-radius: var(--km-radius-xs);
  border: 1px solid var(--km-border);
  background: var(--km-bg-primary);
  color: var(--km-text-primary);
  font-family: var(--km-font);
  font-size: var(--km-font-size-xs);
  outline: none;
}
.ecd-radios { display: flex; flex-wrap: wrap; gap: 6px; }
.ecd-radios label {
  display: flex; align-items: center; gap: 4px;
  font-size: var(--km-font-size-xs); cursor: pointer;
  padding: 3px 8px; border-radius: var(--km-radius-full);
  border: 1px solid var(--km-border); background: var(--km-bg-elevated);
  color: var(--km-text-muted); transition: all 120ms ease;
}
.ecd-radios label:has(input:checked) {
  border-color: var(--km-accent); background: var(--km-accent-muted); color: var(--km-accent);
}
.ecd-radios input[type=radio] { display: none; }

/* Layer checklist */
.ecd-layers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 4px 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 6px;
  background: var(--km-bg-app);
  border: 1px solid var(--km-border);
  border-radius: var(--km-radius-sm);
}
.ecd-layers label { display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; font-family: var(--km-font-mono); color: var(--km-text-secondary); }
.ecd-layers input { accent-color: var(--km-accent); }

.ecd-tag-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--km-font-size-xs);
  color: var(--km-text-muted);
}
.ecd-tag-hint { font-size: 10px; color: var(--km-text-muted); }
`;

let _styleInjected = false;
function _injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = _STYLE;
  document.head.appendChild(s);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _toggle(id, label, checked) {
  return `<div class="ecd-row">
    <span class="ecd-label">${_esc(label)}</span>
    <input type="checkbox" class="ecd-toggle" id="${id}" ${checked ? 'checked' : ''}>
  </div>`;
}

function _radios(name, label, options, value) {
  const opts = options.map(([v, l]) =>
    `<label><input type="radio" class="ecd-radio" name="${name}" value="${_esc(v)}" ${v === value ? 'checked' : ''}> ${_esc(l)}</label>`
  ).join('');
  return `<div class="ecd-row"><span class="ecd-label">${_esc(label)}</span><div class="ecd-radios">${opts}</div></div>`;
}

function _number(id, label, value, step = 1, min = 0) {
  return `<div class="ecd-row">
    <span class="ecd-label">${_esc(label)}</span>
    <input type="number" class="ecd-input" id="${id}" value="${_esc(value)}" step="${step}" min="${min}">
  </div>`;
}

function _text(id, label, value, wide = false) {
  return `<div class="ecd-row">
    <span class="ecd-label">${_esc(label)}</span>
    <input type="text" class="ecd-input ${wide ? 'wide' : ''}" id="${id}" value="${_esc(value ?? '')}">
  </div>`;
}

function _select(id, label, options, value) {
  const opts = options.map(([v, l]) =>
    `<option value="${_esc(v)}" ${v === value ? 'selected' : ''}>${_esc(l)}</option>`
  ).join('');
  return `<div class="ecd-row">
    <span class="ecd-label">${_esc(label)}</span>
    <select class="ecd-select" id="${id}">${opts}</select>
  </div>`;
}

function _layerChecklist(id, allLayers, selectedLayers) {
  const selected = new Set(selectedLayers);
  const items = allLayers.map(l =>
    `<label><input type="checkbox" class="ecd-layer-cb" data-layer="${_esc(l)}" ${selected.has(l) ? 'checked' : ''}> ${_esc(l)}</label>`
  ).join('');
  return `<div id="${id}" class="ecd-layers">${items}</div>`;
}

function _tagList(id, label, values, hint = 'comma-separated') {
  return `<div class="ecd-tag-row">
    <span class="ecd-label">${_esc(label)}</span>
    <input type="text" class="ecd-input wide" id="${id}" value="${_esc(Array.isArray(values) ? values.join(', ') : (values ?? ''))}">
    <span class="ecd-tag-hint">${hint}</span>
  </div>`;
}

function _readChecked(form, id) { return form.querySelector(`#${id}`)?.checked ?? false; }
function _readValue(form, id)   { return form.querySelector(`#${id}`)?.value ?? ''; }
function _readNumber(form, id)  { return parseFloat(form.querySelector(`#${id}`)?.value ?? '0') || 0; }
function _readRadio(form, name) { return form.querySelector(`input[name="${name}"]:checked`)?.value ?? ''; }
function _readLayers(form)      { return [...form.querySelectorAll('.ecd-layer-cb:checked')].map(cb => cb.dataset.layer); }
function _readTags(form, id)    { return (_readValue(form, id)).split(',').map(s => s.trim()).filter(Boolean); }

// ── Per-type form builders ────────────────────────────────────────────────────

function _buildGerbersForm(cfg, layers) {
  return `
    <div class="ecd-section">Layers</div>
    ${_layerChecklist('gerber-layers', layers, cfg.layers ?? [])}
    <div class="ecd-section">Format</div>
    ${_radios('gerber-precision', 'Precision', [['4','4 decimal places'],['5','5'],['6','6 (recommended)']], String(cfg.precision ?? 6))}
    ${_toggle('gerber-x2', 'Gerber X2 attributes', cfg.use_x2 !== false)}
    ${_toggle('gerber-netlist', 'Include netlist (X2)', cfg.include_netlist !== false)}
    <div class="ecd-section">Options</div>
    ${_toggle('gerber-soldermask', 'Subtract soldermask from silk', !!cfg.subtract_soldermask)}
    ${_toggle('gerber-drillorigin', 'Use drill/place file origin', !!cfg.use_drill_origin)}
    ${_toggle('gerber-aperture', 'Disable aperture macros', !!cfg.no_aperture_macros)}
  `;
}
function _readGerbers(form) {
  return {
    layers:              _readLayers(form),
    precision:           parseInt(_readRadio(form, 'gerber-precision')) || 6,
    use_x2:              _readChecked(form, 'gerber-x2'),
    include_netlist:     _readChecked(form, 'gerber-netlist'),
    subtract_soldermask: _readChecked(form, 'gerber-soldermask'),
    use_drill_origin:    _readChecked(form, 'gerber-drillorigin'),
    no_aperture_macros:  _readChecked(form, 'gerber-aperture'),
  };
}

function _buildDrillForm(cfg) {
  return `
    <div class="ecd-section">Format</div>
    ${_radios('drill-format', 'File format', [['excellon','Excellon'],['gerber','Gerber']], cfg.format ?? 'excellon')}
    ${_radios('drill-units',  'Units',       [['mm','mm'],['in','inches']], cfg.units ?? 'mm')}
    ${_radios('drill-origin', 'Origin',      [['absolute','Absolute'],['drill_origin','Drill/Place file']], cfg.origin ?? 'absolute')}
    <div class="ecd-section">Options</div>
    ${_toggle('drill-separate', 'Separate PTH / NPTH files', !!cfg.separate_th)}
    ${_toggle('drill-oval', 'Route oval holes (Excellon)', !!cfg.oval_holes_route)}
    <div class="ecd-section">Drill Map</div>
    ${_toggle('drill-map', 'Generate drill map file', !!cfg.generate_map)}
    ${_select('drill-mapfmt', 'Map format', [['gerberx2','Gerber X2'],['pdf','PDF'],['svg','SVG'],['dxf','DXF'],['ps','PostScript']], cfg.map_format ?? 'gerberx2')}
  `;
}
function _readDrill(form) {
  return {
    format:           _readRadio(form, 'drill-format') || 'excellon',
    units:            _readRadio(form, 'drill-units')  || 'mm',
    origin:           _readRadio(form, 'drill-origin') || 'absolute',
    separate_th:      _readChecked(form, 'drill-separate'),
    oval_holes_route: _readChecked(form, 'drill-oval'),
    generate_map:     _readChecked(form, 'drill-map'),
    map_format:       _readValue(form, 'drill-mapfmt') || null,
  };
}

function _buildPosForm(cfg) {
  return `
    <div class="ecd-section">Output</div>
    ${_radios('pos-side',   'Side',   [['both','Both'],['front','Front'],['back','Back']], cfg.side ?? 'both')}
    ${_radios('pos-format', 'Format', [['csv','CSV'],['ascii','ASCII'],['gerber','Gerber']], cfg.format ?? 'csv')}
    ${_radios('pos-units',  'Units',  [['mm','mm'],['in','inches']], cfg.units ?? 'mm')}
    <div class="ecd-section">Filters</div>
    ${_toggle('pos-dnp',       'Exclude DNP components',      !!cfg.exclude_dnp)}
    ${_toggle('pos-boardonly', 'Exclude board-only footprints', !!cfg.exclude_board_only)}
    ${_toggle('pos-negate',   'Negate X (mirror for bottom)', !!cfg.negate_x)}
  `;
}
function _readPos(form) {
  return {
    side:              _readRadio(form, 'pos-side')   || 'both',
    format:            _readRadio(form, 'pos-format') || 'csv',
    units:             _readRadio(form, 'pos-units')  || 'mm',
    exclude_dnp:       _readChecked(form, 'pos-dnp'),
    exclude_board_only:_readChecked(form, 'pos-boardonly'),
    negate_x:          _readChecked(form, 'pos-negate'),
  };
}

function _buildSvgForm(cfg, layers) {
  return `
    <div class="ecd-section">Layers</div>
    ${_layerChecklist('svg-layers', layers, cfg.layers ?? [])}
    <div class="ecd-section">Appearance</div>
    ${_text('svg-theme', 'Color theme', cfg.theme, false)}
    ${_toggle('svg-bw',      'Black & white',          !!cfg.black_and_white)}
    ${_toggle('svg-area',    'Board area only',         cfg.board_area_only !== false)}
    ${_toggle('svg-mirror',  'Mirror',                  !!cfg.mirror)}
    ${_toggle('svg-neg',     'Negative',                !!cfg.negative)}
    ${_toggle('svg-nosheet', 'Exclude drawing sheet',   !!cfg.exclude_drawing_sheet)}
  `;
}
function _readSvg(form) {
  return {
    layers:                _readLayers(form),
    theme:                 _readValue(form, 'svg-theme') || null,
    black_and_white:       _readChecked(form, 'svg-bw'),
    board_area_only:       _readChecked(form, 'svg-area'),
    mirror:                _readChecked(form, 'svg-mirror'),
    negative:              _readChecked(form, 'svg-neg'),
    exclude_drawing_sheet: _readChecked(form, 'svg-nosheet'),
  };
}

function _buildPdfForm(cfg, layers) {
  return `
    <div class="ecd-section">Layers</div>
    ${_layerChecklist('pdf-layers', layers, cfg.layers ?? [])}
    <div class="ecd-section">Appearance</div>
    ${_text('pdf-theme', 'Color theme', cfg.theme, false)}
    ${_toggle('pdf-bw',      'Black & white',          !!cfg.black_and_white)}
    ${_toggle('pdf-area',    'Board area only',         !!cfg.board_area_only)}
    ${_toggle('pdf-mirror',  'Mirror',                  !!cfg.mirror)}
    ${_toggle('pdf-sep',     'Separate file per layer', !!cfg.separate_files)}
    ${_toggle('pdf-nosheet', 'Exclude drawing sheet',   !!cfg.exclude_drawing_sheet)}
    ${_number('pdf-scale',   'Scale factor (1.0 = 1:1)', cfg.scale ?? 1.0, 0.1, 0.1)}
  `;
}
function _readPdf(form) {
  return {
    layers:                _readLayers(form),
    theme:                 _readValue(form, 'pdf-theme') || null,
    black_and_white:       _readChecked(form, 'pdf-bw'),
    board_area_only:       _readChecked(form, 'pdf-area'),
    mirror:                _readChecked(form, 'pdf-mirror'),
    separate_files:        _readChecked(form, 'pdf-sep'),
    exclude_drawing_sheet: _readChecked(form, 'pdf-nosheet'),
    scale:                 _readNumber(form, 'pdf-scale') || 1.0,
  };
}

function _buildBomForm(cfg) {
  return `
    <div class="ecd-section">Output Format</div>
    ${_radios('bom-fmt', 'File format', [['csv','CSV (.csv)'],['tsv','TSV (.tsv)']], cfg.output_format ?? 'csv')}
    <div class="ecd-section">Fields</div>
    ${_tagList('bom-fields',  'Include fields',  cfg.fields  ?? [], 'comma-separated')}
    ${_tagList('bom-groupby', 'Group by',        cfg.group_by ?? [], 'comma-separated')}
    ${_tagList('bom-sortby',  'Sort by',         cfg.sort_by  ?? [], 'comma-separated')}
    ${_text('bom-refrange', 'Ref range delimiter', cfg.ref_range_delimiter ?? '-')}
    <div class="ecd-section">Filters</div>
    ${_toggle('bom-dnp', 'Exclude DNP components', !!cfg.exclude_dnp)}
  `;
}
function _readBom(form) {
  return {
    output_format:      _readRadio(form, 'bom-fmt') || 'csv',
    fields:             _readTags(form, 'bom-fields'),
    group_by:           _readTags(form, 'bom-groupby'),
    sort_by:            _readTags(form, 'bom-sortby'),
    ref_range_delimiter:_readValue(form, 'bom-refrange') || '-',
    exclude_dnp:        _readChecked(form, 'bom-dnp'),
  };
}

function _buildSchForm(cfg) {
  return `
    <div class="ecd-section">Appearance</div>
    ${_toggle('sch-bw',      'Black & white',        !!cfg.black_and_white)}
    ${_toggle('sch-nosheet', 'Exclude drawing sheet', !!cfg.exclude_drawing_sheet)}
  `;
}
function _readSch(form) {
  return {
    black_and_white:       _readChecked(form, 'sch-bw'),
    exclude_drawing_sheet: _readChecked(form, 'sch-nosheet'),
  };
}

function _buildStepForm(cfg) {
  const coord = cfg.use_drill_origin ? 'drill'
    : cfg.use_grid_origin   ? 'grid'
    : cfg.board_center_origin ? 'center'
    : cfg.user_origin        ? 'user'
    : 'absolute';
  return `
    <div class="ecd-section">Output Format</div>
    ${_select('step-fmt', 'Format', [
      ['step','STEP (.step)'],['brep','BREP (.brep)'],['xao','XAO (.xao)'],
      ['gltf','GLTF (.glb)'],['stl','STL (.stl)'],['vrml','VRML (.wrl)'],
      ['3dpdf','3D PDF (.pdf)'],
    ], cfg.format ?? 'step')}

    <div class="ecd-section">Coordinates</div>
    ${_radios('step-coord', 'Origin', [
      ['absolute',  'Absolute'],
      ['drill',     'Drill/place file origin'],
      ['grid',      'Grid origin'],
      ['center',    'Board center'],
      ['user',      'User defined'],
    ], coord)}
    <div class="ecd-row">
      <span class="ecd-label">User X, Y (mm)</span>
      <input type="text" class="ecd-input wide" id="step-userorigin"
        value="${_esc(cfg.user_origin ?? '')}" placeholder="e.g. 100,150">
    </div>

    <div class="ecd-section">Board Options</div>
    ${_toggle('step-nobody',    'No board body',            !!cfg.no_board_body)}
    ${_toggle('step-nocomp',    'No component models',      !!cfg.no_components)}
    ${_toggle('step-nounspec',  'Exclude unspecified models', !!cfg.no_unspecified)}
    ${_toggle('step-nodnp',     'Exclude DNP components',   !!cfg.no_dnp)}
    ${_toggle('step-subst',     'Substitute missing (bbox)', !!cfg.subst_models)}
    ${_toggle('step-pads',      'Export padstacks',          !!cfg.include_pads)}

    <div class="ecd-section">Conductor Options</div>
    ${_toggle('step-tracks',    'Export tracks & vias',      !!cfg.include_tracks)}
    ${_toggle('step-zones',     'Export zones',              !!cfg.include_zones)}
    ${_toggle('step-inner',     'Export inner copper layers',!!cfg.include_inner_copper)}
    ${_toggle('step-fuse',      'Fuse shapes',               !!cfg.fuse_shapes)}
    ${_toggle('step-fillvias',  'Fill all vias',             !!cfg.fill_all_vias)}
    <div class="ecd-row">
      <span class="ecd-label">Net filter</span>
      <input type="text" class="ecd-input wide" id="step-netfilter"
        value="${_esc(cfg.net_filter ?? '')}" placeholder="GND or * wildcard">
    </div>

    <div class="ecd-section">Other Options</div>
    ${_toggle('step-force',     'Overwrite output file',     cfg.force !== false)}
    ${_toggle('step-nopcurves','No P-curves in STEP',        !!cfg.no_optimize_step)}
    ${_select('step-tolerance', 'Board outline tolerance', [
      ['0.001','Tight (0.001 mm)'],['0.005','Normal (0.005 mm)'],
      ['0.01','Loose (0.01 mm)'],['0.1','Very loose (0.1 mm)'],
    ], String(cfg.min_distance ?? '0.001'))}
  `;
}
function _readStep(form) {
  const coord = _readRadio(form, 'step-coord') || 'absolute';
  return {
    format:               _readValue(form, 'step-fmt') || 'step',
    use_drill_origin:     coord === 'drill',
    use_grid_origin:      coord === 'grid',
    board_center_origin:  coord === 'center',
    user_origin:          coord === 'user' ? (_readValue(form, 'step-userorigin') || null) : null,
    no_board_body:        _readChecked(form, 'step-nobody'),
    no_components:        _readChecked(form, 'step-nocomp'),
    no_unspecified:       _readChecked(form, 'step-nounspec'),
    no_dnp:               _readChecked(form, 'step-nodnp'),
    subst_models:         _readChecked(form, 'step-subst'),
    include_pads:         _readChecked(form, 'step-pads'),
    include_tracks:       _readChecked(form, 'step-tracks'),
    include_zones:        _readChecked(form, 'step-zones'),
    include_inner_copper: _readChecked(form, 'step-inner'),
    fuse_shapes:          _readChecked(form, 'step-fuse'),
    fill_all_vias:        _readChecked(form, 'step-fillvias'),
    net_filter:           _readValue(form, 'step-netfilter') || null,
    force:                _readChecked(form, 'step-force'),
    no_optimize_step:     _readChecked(form, 'step-nopcurves'),
    min_distance:         parseFloat(_readValue(form, 'step-tolerance')) || 0.001,
  };
}

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META = {
  gerbers: { title: 'Gerber Export',       build: _buildGerbersForm, read: _readGerbers, needsLayers: true },
  drill:   { title: 'Drill Export',         build: _buildDrillForm,   read: _readDrill,   needsLayers: false },
  pos:     { title: 'Position File Export', build: _buildPosForm,     read: _readPos,     needsLayers: false },
  svg:     { title: 'PCB SVG Export',       build: _buildSvgForm,     read: _readSvg,     needsLayers: true },
  pdf:     { title: 'PCB PDF Export',       build: _buildPdfForm,     read: _readPdf,     needsLayers: true },
  bom:     { title: 'BOM Export',           build: _buildBomForm,     read: _readBom,     needsLayers: false },
  sch_pdf: { title: 'Schematic PDF Export', build: _buildSchForm,     read: _readSch,     needsLayers: false },
  sch_svg: { title: 'Schematic SVG Export', build: _buildSchForm,     read: _readSch,     needsLayers: false },
  step:    { title: '3D STEP Export',       build: _buildStepForm,    read: _readStep,    needsLayers: false },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Show the configure dialog for a given export type.
 * @param {string} typeId
 * @param {object} currentConfig
 * @param {string[]} boardLayers  — real board layers from bridge, or [] to use defaults
 * @returns {Promise<object|null>}  resolved config or null if cancelled
 */
export function showConfigDialog(typeId, currentConfig, boardLayers) {
  _injectStyle();
  const meta = TYPE_META[typeId];
  if (!meta) return Promise.resolve(null);

  const layers = boardLayers?.length > 0 ? boardLayers : STANDARD_KICAD_LAYERS;
  const cfg    = currentConfig ?? {};

  return new Promise((resolve) => {
    // resolveOnce: km-close fires when close() is called from OK/Cancel, so we
    // must record the result BEFORE calling close(), and ignore the km-close null.
    let _result = null;
    let _resolved = false;
    const finish = (val) => {
      if (_resolved) return;
      _resolved = true;
      _result   = val;
    };

    const dialog = document.createElement('km-dialog');
    dialog.setAttribute('heading', `⚙ ${meta.title}`);
    dialog.setAttribute('size', 'md');
    dialog.innerHTML = `
      <div class="ecd-body" id="ecd-form">
        ${meta.build(cfg, layers)}
      </div>
      <div slot="footer">
        <km-button variant="ghost"   id="ecd-cancel" size="sm">Cancel</km-button>
        <km-button variant="primary" id="ecd-ok"     size="sm">Apply</km-button>
      </div>
    `;

    (document.getElementById('notification-host') ?? document.body).appendChild(dialog);
    dialog.setAttribute('open', '');

    const form = dialog.querySelector('#ecd-form');

    dialog.querySelector('#ecd-cancel')?.addEventListener('km-click', () => {
      finish(null);
      dialog.close?.();
    });
    dialog.querySelector('#ecd-ok')?.addEventListener('km-click', () => {
      finish(meta.read(form));
      dialog.close?.();
    });
    // km-close fires for X button, Escape, backdrop click — resolve with whatever was recorded
    dialog.addEventListener('km-close', () => {
      resolve(_result);
      setTimeout(() => dialog.remove(), 0);
    });
  });
}
