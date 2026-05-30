/**
 * FabRules — manufacturing rule presets for common PCB fabs.
 *
 * Rule 1: Pure JS constants — no IPC, no DOM, no store imports.
 * Each preset defines minimum track/space/via requirements and the
 * list of files required for board submission.
 *
 * Sources (as of 2026):
 *   JLCPCB — https://jlcpcb.com/capabilities/pcb-capabilities
 *   OSHPark — https://docs.oshpark.com/design-tools/
 *   PCBWay  — https://www.pcbway.com/capabilities.html
 *
 * @module FabRules
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FabCheck
 * @property {string}  id          — unique check identifier
 * @property {string}  label       — human-readable name
 * @property {string}  description — detail tooltip
 * @property {'design_rule'|'drc_result'|'layer_count'|'board_size'} kind
 *
 * For kind==='design_rule':
 * @property {string}  property    — key in `boardState.design_rules`
 * @property {number}  min_mm      — minimum acceptable value in mm
 *
 * For kind==='drc_result':
 * @property {'error'|'warning'} severity — max acceptable severity count
 * @property {number}  max_count   — 0 = must be zero
 *
 * For kind==='layer_count':
 * @property {number}  max_layers  — maximum copper layers supported
 *
 * For kind==='board_size':
 * @property {number}  max_width_mm
 * @property {number}  max_height_mm
 */

/**
 * @typedef {Object} FabPreset
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {string}   url
 * @property {string[]} required_exports  — export type IDs needed for submission
 * @property {FabCheck[]} checks
 */

// ── Presets ───────────────────────────────────────────────────────────────────

/** @type {Record<string, FabPreset>} */
export const FAB_PRESETS = {

  jlcpcb_2layer: {
    id:          'jlcpcb_2layer',
    name:        'JLCPCB 2-layer',
    description: 'JLC PCB standard 2-layer service (most popular)',
    url:         'https://jlcpcb.com/capabilities/pcb-capabilities',
    required_exports: ['gerbers', 'drill'],
    checks: [
      {
        id: 'trace_width', label: 'Min trace width ≥ 0.127 mm',
        description: 'JLCPCB minimum track width for standard service.',
        kind: 'design_rule', property: 'min_track_width_mm', min_mm: 0.127,
      },
      {
        id: 'trace_space', label: 'Min clearance ≥ 0.127 mm',
        description: 'Minimum copper-to-copper clearance.',
        kind: 'design_rule', property: 'min_clearance_mm', min_mm: 0.127,
      },
      {
        id: 'via_drill', label: 'Min via drill ≥ 0.3 mm',
        description: 'JLCPCB minimum via drill diameter.',
        kind: 'design_rule', property: 'min_via_drill_mm', min_mm: 0.3,
      },
      {
        id: 'layer_count', label: 'Layer count ≤ 2',
        description: 'This preset targets the 2-layer service.',
        kind: 'layer_count', max_layers: 2,
      },
      {
        id: 'board_size', label: 'Board ≤ 500 × 500 mm',
        description: 'Maximum board size for standard pricing.',
        kind: 'board_size', max_width_mm: 500, max_height_mm: 500,
      },
      {
        id: 'no_drc_errors', label: 'Zero DRC errors',
        description: 'Board must have no DRC errors before submission.',
        kind: 'drc_result', severity: 'error', max_count: 0,
      },
    ],
  },

  jlcpcb_4layer: {
    id:          'jlcpcb_4layer',
    name:        'JLCPCB 4-layer',
    description: 'JLC PCB 4-layer service (tighter rules)',
    url:         'https://jlcpcb.com/capabilities/pcb-capabilities',
    required_exports: ['gerbers', 'drill'],
    checks: [
      { id: 'trace_width', label: 'Min trace width ≥ 0.1 mm',  kind: 'design_rule', property: 'min_track_width_mm', min_mm: 0.1,   description: '4-layer minimum.' },
      { id: 'trace_space', label: 'Min clearance ≥ 0.1 mm',   kind: 'design_rule', property: 'min_clearance_mm',   min_mm: 0.1,   description: '4-layer minimum clearance.' },
      { id: 'via_drill',   label: 'Min via drill ≥ 0.2 mm',   kind: 'design_rule', property: 'min_via_drill_mm',   min_mm: 0.2,   description: '4-layer via drill.' },
      { id: 'layer_count', label: 'Layer count ≤ 4',           kind: 'layer_count', max_layers: 4,                               description: '4-layer service.' },
      { id: 'board_size',  label: 'Board ≤ 500 × 500 mm',     kind: 'board_size',  max_width_mm: 500, max_height_mm: 500,        description: 'Board size limit.' },
      { id: 'no_drc_errors', label: 'Zero DRC errors',         kind: 'drc_result',  severity: 'error', max_count: 0,             description: 'No errors allowed.' },
    ],
  },

  oshpark_2layer: {
    id:          'oshpark_2layer',
    name:        'OSHPark 2-layer',
    description: 'OSH Park purple 2-layer boards (tighter tolerances)',
    url:         'https://docs.oshpark.com/design-tools/',
    required_exports: ['gerbers', 'drill'],
    checks: [
      { id: 'trace_width', label: 'Min trace width ≥ 0.152 mm', kind: 'design_rule', property: 'min_track_width_mm', min_mm: 0.152, description: 'OSHPark 6 mil minimum.' },
      { id: 'trace_space', label: 'Min clearance ≥ 0.152 mm',  kind: 'design_rule', property: 'min_clearance_mm',   min_mm: 0.152, description: 'OSHPark 6 mil spacing.' },
      { id: 'via_drill',   label: 'Min via drill ≥ 0.254 mm',  kind: 'design_rule', property: 'min_via_drill_mm',   min_mm: 0.254, description: 'OSHPark 10 mil drill.' },
      { id: 'layer_count', label: 'Layer count ≤ 2',            kind: 'layer_count', max_layers: 2,                               description: '2-layer service.' },
      { id: 'no_drc_errors', label: 'Zero DRC errors',          kind: 'drc_result',  severity: 'error', max_count: 0,             description: 'Clean board required.' },
    ],
  },

  pcbway_standard: {
    id:          'pcbway_standard',
    name:        'PCBWay Standard',
    description: 'PCBWay standard manufacturing service',
    url:         'https://www.pcbway.com/capabilities.html',
    required_exports: ['gerbers', 'drill', 'bom', 'pos'],
    checks: [
      { id: 'trace_width', label: 'Min trace width ≥ 0.1 mm',  kind: 'design_rule', property: 'min_track_width_mm', min_mm: 0.1,   description: 'PCBWay 4 mil minimum.' },
      { id: 'trace_space', label: 'Min clearance ≥ 0.1 mm',   kind: 'design_rule', property: 'min_clearance_mm',   min_mm: 0.1,   description: 'PCBWay 4 mil spacing.' },
      { id: 'via_drill',   label: 'Min via drill ≥ 0.2 mm',   kind: 'design_rule', property: 'min_via_drill_mm',   min_mm: 0.2,   description: 'PCBWay via drill.' },
      { id: 'layer_count', label: 'Layer count ≤ 14',          kind: 'layer_count', max_layers: 14,                              description: 'Up to 14 layers.' },
      { id: 'board_size',  label: 'Board ≤ 600 × 600 mm',     kind: 'board_size',  max_width_mm: 600, max_height_mm: 600,        description: 'Max board size.' },
      { id: 'no_drc_errors', label: 'Zero DRC errors',         kind: 'drc_result',  severity: 'error', max_count: 0,             description: 'No errors.' },
    ],
  },
};

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CheckResult
 * @property {string}  id
 * @property {string}  label
 * @property {string}  description
 * @property {'pass'|'fail'|'warn'|'unknown'} status
 * @property {string}  detail   — human-readable result detail
 */

/**
 * Evaluate a fab preset against current board state.
 *
 * @param {FabPreset} preset
 * @param {{
 *   design_rules?: {min_track_width_mm?:number, min_clearance_mm?:number, min_via_drill_mm?:number},
 *   board_size?:   {width_mm?:number, height_mm?:number},
 *   copper_layer_count?: number,
 * }|null} boardState
 * @param {Array<{severity:string}>} drcErrors
 * @returns {CheckResult[]}
 */
export function evaluatePreset(preset, boardState, drcErrors = []) {
  const dr = boardState?.design_rules ?? null;
  const bs = boardState?.board_size   ?? null;
  const layerCount = boardState?.copper_layer_count ?? null;
  const errorCount   = drcErrors.filter(v => v.severity === 'error').length;
  const warningCount = drcErrors.filter(v => v.severity === 'warning').length;

  return preset.checks.map(check => {
    switch (check.kind) {
      case 'design_rule': {
        if (!dr || dr[check.property] == null) {
          return { ...check, status: 'unknown', detail: 'Bridge not connected — connect KiCad for live rules' };
        }
        const val = dr[check.property];
        const pass = val >= check.min_mm;
        return {
          ...check,
          status: pass ? 'pass' : 'fail',
          detail: `Board: ${val.toFixed(3)} mm  ·  Required: ≥ ${check.min_mm} mm`,
        };
      }

      case 'layer_count': {
        if (layerCount == null) {
          return { ...check, status: 'unknown', detail: 'Connect bridge to read layer count' };
        }
        const pass = layerCount <= check.max_layers;
        return {
          ...check,
          status: pass ? 'pass' : 'fail',
          detail: `Board: ${layerCount} layers  ·  Max: ${check.max_layers}`,
        };
      }

      case 'board_size': {
        if (!bs || bs.width_mm == null) {
          return { ...check, status: 'unknown', detail: 'Connect bridge to read board size' };
        }
        const wOk = bs.width_mm  <= check.max_width_mm;
        const hOk = bs.height_mm <= check.max_height_mm;
        const pass = wOk && hOk;
        return {
          ...check,
          status: pass ? 'pass' : 'fail',
          detail: `Board: ${bs.width_mm?.toFixed(1)} × ${bs.height_mm?.toFixed(1)} mm  ·  Max: ${check.max_width_mm} × ${check.max_height_mm} mm`,
        };
      }

      case 'drc_result': {
        if (drcErrors.length === 0 && errorCount === 0) {
          return { ...check, status: 'unknown', detail: 'Run DRC first to evaluate' };
        }
        const count = check.severity === 'error' ? errorCount : warningCount;
        const pass  = count <= check.max_count;
        return {
          ...check,
          status: pass ? 'pass' : 'fail',
          detail: `${count} ${check.severity}${count !== 1 ? 's' : ''}  ·  Max allowed: ${check.max_count}`,
        };
      }

      default:
        return { ...check, status: 'unknown', detail: 'Unknown check type' };
    }
  });
}

/**
 * Return a readiness score (0–100) for a fab preset evaluation.
 * @param {CheckResult[]} results
 * @returns {{ score: number, passed: number, failed: number, unknown: number }}
 */
export function readinessScore(results) {
  const passed  = results.filter(r => r.status === 'pass').length;
  const failed  = results.filter(r => r.status === 'fail').length;
  const unknown = results.filter(r => r.status === 'unknown').length;
  const scored  = passed + failed; // unknowns don't count
  const score   = scored > 0 ? Math.round((passed / scored) * 100) : 0;
  return { score, passed, failed, unknown };
}
