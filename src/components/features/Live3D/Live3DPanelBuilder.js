/**
 * Live3DPanelBuilder — shared HTML builder for viewer settings drawers.
 *
 * Used by both the GLB Viewer panel (Live3D.js) and the V2 panel (Live3dV2.js).
 * The `pfx` parameter namespaces <output> IDs so both panels can coexist in
 * the same shadow root without getElementById collisions.
 *
 * @module Live3DPanelBuilder
 */

function _spSection(title, open = true) {
  return `<details${open ? ' open' : ''}><summary class="sp-sec">${title}</summary>`;
}
function _spEnd() { return `</details>`; }

function _spToggle(sec, key, label, val) {
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <input type="checkbox" data-section="${sec}" data-key="${key}" data-type="bool"${val ? ' checked' : ''}>
  </label>`;
}

function _spRange(sec, key, label, val, min, max, step, pfx = 'out') {
  const disp = fmtVal(val, step);
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <span class="sp-range-wrap">
      <input type="range" data-section="${sec}" data-key="${key}" data-type="float"
             data-step="${step}" min="${min}" max="${max}" step="${step}" value="${val}">
      <output id="${pfx}-${sec}-${key}" class="sp-out">${disp}</output>
    </span>
  </label>`;
}

function _spColor(sec, key, label, val) {
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <input type="color" data-section="${sec}" data-key="${key}" data-type="color" value="${val}">
  </label>`;
}

function _spSelect(sec, key, label, val, options) {
  const opts = options.map(o => `<option value="${o}"${o === String(val) ? ' selected' : ''}>${o}</option>`).join('');
  return `<label class="sp-row">
    <span class="sp-lbl">${label}</span>
    <select data-section="${sec}" data-key="${key}" data-type="select">${opts}</select>
  </label>`;
}

export function fmtVal(v, step) {
  if (step < 0.0001) return Number(v).toFixed(5);
  if (step < 0.01)   return Number(v).toFixed(4);
  if (step < 0.1)    return Number(v).toFixed(2);
  if (step < 1)      return Number(v).toFixed(1);
  return Math.round(v).toString();
}

/**
 * Build the full settings panel HTML from a VIEWER_DEFAULTS-shaped object.
 * @param {object} s  — settings state (VIEWER_DEFAULTS shape)
 * @param {string} pfx — output element ID prefix ('out' for GLB, 'v2out' for V2)
 */
export function buildSettingsPanelHtml(s, pfx = 'out') {
  const R = (sec, key, label, val, min, max, step) =>
    _spRange(sec, key, label, val, min, max, step, pfx);

  return [
    _spSection('Export Options'),
    _spToggle ('glbExport', 'substModels', 'Substitute missing models',  s.glbExport.substModels),
    _spToggle ('glbExport', 'noDnp',       'Exclude DNP components',     s.glbExport.noDnp),
    _spEnd(),

    _spSection('Renderer'),
    R        ('renderer', 'pixelRatio',          'Pixel ratio',          s.renderer.pixelRatio,          0.5,  3,    0.25),
    _spSelect ('renderer', 'toneMapping',          'Tone mapping',         s.renderer.toneMapping,
               ['None','Linear','Reinhard','Cineon','ACESFilmic','AgX','NeutralToneMapping']),
    R        ('renderer', 'toneMappingExposure',  'Exposure',             s.renderer.toneMappingExposure, 0.1,  5,    0.05),
    _spToggle ('renderer', 'shadowsEnabled',       'Shadows enabled',      s.renderer.shadowsEnabled),
    _spSelect ('renderer', 'shadowMapType',        'Shadow map type',      s.renderer.shadowMapType,
               ['Basic','PCF','PCFSoft','VSM']),
    _spColor  ('renderer', 'clearColor',           'Background colour',    s.renderer.clearColor),
    _spEnd(),

    _spSection('Fog', false),
    _spToggle ('fog', 'enabled', 'Fog enabled',  s.fog.enabled),
    _spColor  ('fog', 'color',   'Fog colour',   s.fog.color),
    R        ('fog', 'near',    'Near',         s.fog.near,  1,   200,  1),
    R        ('fog', 'far',     'Far',          s.fog.far,   10,  500,  5),
    _spEnd(),

    _spSection('Spot Light'),
    _spToggle ('spotLight', 'enabled',       'Enabled',           s.spotLight.enabled),
    _spColor  ('spotLight', 'color',         'Colour',            s.spotLight.color),
    R        ('spotLight', 'intensity',     'Intensity',         s.spotLight.intensity,    0,      8000,    50),
    R        ('spotLight', 'distance',      'Distance',          s.spotLight.distance,     0,      500,     5),
    R        ('spotLight', 'angle',         'Cone angle (rad)',  s.spotLight.angle,         0,      1.57,    0.01),
    R        ('spotLight', 'penumbra',      'Penumbra',          s.spotLight.penumbra,      0,      1,       0.01),
    R        ('spotLight', 'posX',          'Position X',        s.spotLight.posX,         -150,   150,     1),
    R        ('spotLight', 'posY',          'Position Y',        s.spotLight.posY,          0,     200,     1),
    R        ('spotLight', 'posZ',          'Position Z',        s.spotLight.posZ,         -150,   150,     1),
    _spToggle ('spotLight', 'castShadow',    'Cast shadow',       s.spotLight.castShadow),
    R        ('spotLight', 'shadowBias',    'Shadow bias',       s.spotLight.shadowBias,   -0.001,  0.001,  0.00001),
    _spSelect ('spotLight', 'shadowMapSize', 'Shadow map size',   String(s.spotLight.shadowMapSize),
               ['256','512','1024','2048','4096']),
    _spEnd(),

    _spSection('Ambient Light', false),
    _spToggle ('ambientLight', 'enabled',   'Enabled',   s.ambientLight.enabled),
    _spColor  ('ambientLight', 'color',     'Colour',    s.ambientLight.color),
    R        ('ambientLight', 'intensity', 'Intensity', s.ambientLight.intensity, 0, 5, 0.05),
    _spEnd(),

    _spSection('Hemisphere Light', false),
    _spToggle ('hemiLight', 'enabled',     'Enabled',       s.hemiLight.enabled),
    _spColor  ('hemiLight', 'skyColor',    'Sky colour',    s.hemiLight.skyColor),
    _spColor  ('hemiLight', 'groundColor', 'Ground colour', s.hemiLight.groundColor),
    R        ('hemiLight', 'intensity',   'Intensity',     s.hemiLight.intensity, 0, 5, 0.05),
    R        ('hemiLight', 'posX',        'Position X',    s.hemiLight.posX, -100, 100, 1),
    R        ('hemiLight', 'posY',        'Position Y',    s.hemiLight.posY,    0, 200, 1),
    R        ('hemiLight', 'posZ',        'Position Z',    s.hemiLight.posZ, -100, 100, 1),
    _spEnd(),

    _spSection('Camera', false),
    R        ('camera', 'fov',  'Field of view',  s.camera.fov,   10,  120, 1),
    R        ('camera', 'near', 'Near clip',      s.camera.near,  0.0001, 10, 0.0001),
    R        ('camera', 'far',  'Far clip',       s.camera.far,   50, 5000, 50),
    R        ('camera', 'posX', 'Camera pos X',   s.camera.posX, -100, 100, 0.5),
    R        ('camera', 'posY', 'Camera pos Y',   s.camera.posY, -100, 100, 0.5),
    R        ('camera', 'posZ', 'Camera pos Z',   s.camera.posZ,    0, 200, 0.5),
    _spEnd(),

    _spSection('Orbit Controls', false),
    _spToggle ('controls', 'enableDamping',    'Damping enabled',    s.controls.enableDamping),
    R        ('controls', 'dampingFactor',    'Damping factor',     s.controls.dampingFactor,   0.01, 0.5,  0.01),
    _spToggle ('controls', 'enablePan',        'Pan enabled',        s.controls.enablePan),
    _spToggle ('controls', 'enableZoom',       'Zoom enabled',       s.controls.enableZoom),
    R        ('controls', 'minDistance',      'Min distance',       s.controls.minDistance,     0.0001, 50, 0.0001),
    R        ('controls', 'maxDistance',      'Max distance',       s.controls.maxDistance,     5,    500,  5),
    R        ('controls', 'minPolarAngle',    'Min polar (rad)',    s.controls.minPolarAngle,   0,    3.14, 0.01),
    R        ('controls', 'maxPolarAngle',    'Max polar (rad)',    s.controls.maxPolarAngle,   0,    3.14, 0.01),
    _spToggle ('controls', 'autoRotate',       'Auto rotate',        s.controls.autoRotate),
    R        ('controls', 'autoRotateSpeed',  'Rotate speed',       s.controls.autoRotateSpeed, 0.1,  20,   0.1),
    R        ('controls', 'targetX',          'Orbit target X',     s.controls.targetX, -20, 20, 0.1),
    R        ('controls', 'targetY',          'Orbit target Y',     s.controls.targetY, -10, 20, 0.1),
    R        ('controls', 'targetZ',          'Orbit target Z',     s.controls.targetZ, -20, 20, 0.1),
    _spEnd(),

    _spSection('Ground', false),
    _spToggle ('ground', 'visible',   'Visible',   s.ground.visible),
    _spColor  ('ground', 'color',     'Colour',    s.ground.color),
    R        ('ground', 'metalness', 'Metalness', s.ground.metalness, 0, 1, 0.01),
    R        ('ground', 'roughness', 'Roughness', s.ground.roughness, 0, 1, 0.01),
    R        ('ground', 'size',      'Size',      s.ground.size,      1, 500, 1),
    _spEnd(),

    _spSection('Helpers', false),
    _spToggle ('helpers', 'axesVisible',   'Show axes',       s.helpers.axesVisible),
    R        ('helpers', 'axesSize',      'Axes size',       s.helpers.axesSize,       1, 50, 1),
    _spToggle ('helpers', 'gridVisible',   'Show grid',       s.helpers.gridVisible),
    R        ('helpers', 'gridSize',      'Grid size',       s.helpers.gridSize,       1, 200, 1),
    R        ('helpers', 'gridDivisions', 'Grid divisions',  s.helpers.gridDivisions,  1,  80, 1),
    _spColor  ('helpers', 'gridColor',     'Grid colour',     s.helpers.gridColor),
    _spEnd(),

    _spSection('Model', false),
    _spToggle ('model', 'wireframe',     'Wireframe',      s.model.wireframe),
    _spToggle ('model', 'castShadow',    'Cast shadow',    s.model.castShadow),
    _spToggle ('model', 'receiveShadow', 'Receive shadow', s.model.receiveShadow),
    _spEnd(),
  ].join('');
}
