/**
 * BoardMesh — builds the PCB board geometry and applies the layer shader.
 *
 * Geometry:
 *   - Top face:    flat plane at Z = boardThickness (receives F.Cu/F.Mask/F.SilkS textures)
 *   - Bottom face: flat plane at Z = 0             (receives B.Cu/B.Mask/B.SilkS textures)
 *   - Edge:        ExtrudeGeometry of board outline (FR-4 amber)
 *
 * Shader approach (matching pcb2blender Cycles nodes):
 *   Uses MeshStandardMaterial.onBeforeCompile to inject pcb2blender-style
 *   layer compositing into Three.js's own PBR pipeline.
 *   Result: physically correct lighting on photorealistic PCB surface.
 */

import * as THREE from 'three';

// ── pcb2blender-calibrated material constants ─────────────────────────────────

const FR4_COLOR    = new THREE.Color(117/255, 97/255, 47/255); // KiCad hardcoded
const SILK_COLOR   = new THREE.Color(0.92, 0.92, 0.88);

export const MASK_COLORS = {
  green:       new THREE.Color(0x43a142 / 0xffffff * 255 / 255, 0xa1 / 255, 0x42 / 255),
  red:         new THREE.Color(0xde / 255, 0x54 / 255, 0x4c / 255),
  blue:        new THREE.Color(0x3b / 255, 0x69 / 255, 0xaa / 255),
  yellow:      new THREE.Color(0xda / 255, 0xcb / 255, 0x57 / 255),
  purple:      new THREE.Color(0x74 / 255, 0x48 / 255, 0xaa / 255),
  white:       new THREE.Color(0xd3 / 255, 0xcf / 255, 0xc9 / 255),
  black:       new THREE.Color(0x10 / 255, 0x10 / 255, 0x0f / 255),
  matte_black: new THREE.Color(0x19 / 255, 0x19 / 255, 0x19 / 255),
};

export const FINISH_COLORS = {
  enig: new THREE.Color(0xef / 255, 0xdf / 255, 0xbb / 255), // pcb2blender ENIG
  hasl: new THREE.Color(0xea / 255, 0xea / 255, 0xe5 / 255), // pcb2blender HASL
  none: new THREE.Color(0xe1 / 255, 0xbb / 255, 0xac / 255), // pcb2blender OSP
};

// ── GLSL injection (onBeforeCompile) ─────────────────────────────────────────

const UNIFORMS_GLSL = /* glsl */`
  uniform sampler2D tCu;
  uniform sampler2D tMask;
  uniform sampler2D tSilk;
  uniform vec3  uMaskColor;
  uniform vec3  uCopperColor;
  uniform vec3  uSilkColor;
  uniform float uSide;        // 1.0 = front face, -1.0 = back face
  uniform float uMaskRoughness;
  uniform float uCopperRoughness;
`;

// Injected after #include <color_fragment>
const COLOR_INJECT = /* glsl */`
  float _cu   = uSide > 0.0 ? texture2D(tCu,   vUv).r : texture2D(tCu,   vUv).g;
  float _mask = uSide > 0.0 ? texture2D(tMask, vUv).r : texture2D(tMask, vUv).g;
  float _silk = uSide > 0.0 ? texture2D(tSilk, vUv).r : texture2D(tSilk, vUv).g;

  // kicad-cli --black-and-white: copper/silk exported as black on white → inverted
  // mask: white=mask removed (pad opening), black=mask present — NOT inverted
  float hasCu     = _cu;                      // 1.0 = copper trace here
  float maskOpen  = _mask;                    // 1.0 = pad opening (no mask)
  float hasSilk   = _silk;                    // 1.0 = silk mark here

  // Layer compositing (pcb2blender node order):
  // 1. FR4 base
  // 2. Solder mask covers most of board
  // 3. Copper visible under mask (dim)
  // 4. Exposed copper at pad openings (bright ENIG/HASL)
  // 5. Silkscreen on top of masked areas

  vec3 _c = diffuseColor.rgb;                  // starts as FR4 color
  _c = mix(_c, uMaskColor, 1.0 - maskOpen);   // mask present on most of board
  _c = mix(_c, uCopperColor * 0.55, hasCu * (1.0 - maskOpen) * 0.45); // cu under mask
  _c = mix(_c, uCopperColor, hasCu * maskOpen);  // bright exposed pads
  _c = mix(_c, uSilkColor,   hasSilk * (1.0 - maskOpen)); // silk on masked areas
  diffuseColor.rgb = _c;
`;

// Injected after #include <roughnessmap_fragment>
const ROUGHNESS_INJECT = /* glsl */`
  float _exposedCu = hasCu * maskOpen;
  roughnessFactor  = mix(uMaskRoughness, uCopperRoughness, _exposedCu);
`;

// Injected after #include <metalnessmap_fragment>
const METALNESS_INJECT = /* glsl */`
  metalnessFactor = hasCu * maskOpen; // exposed pads only = metallic
`;

function makePcbMaterial(side, textures, opts = {}) {
  const maskColor   = MASK_COLORS[opts.maskColor ?? 'green']  ?? MASK_COLORS.green;
  const copperColor = FINISH_COLORS[opts.finish   ?? 'enig']  ?? FINISH_COLORS.enig;

  const mat = new THREE.MeshStandardMaterial({
    color:         FR4_COLOR,
    roughness:     0.45,
    metalness:     0,
    side:          side === 'front' ? THREE.FrontSide : THREE.BackSide,
    name:          `pcb_${side}`,
  });

  // Force UV varyings: the injected GLSL reads vUv, but Three.js only
  // declares it when USE_UV is set (normally implied by a map texture).
  mat.defines = { ...mat.defines, USE_UV: '' };

  // Without a unique cache key, Three.js may reuse a compiled program from
  // another MeshStandardMaterial that never ran our onBeforeCompile injection,
  // silently skipping the layer-compositing GLSL (flat FR4 color result).
  mat.customProgramCacheKey = () => `pcb_${side}`;

  const uniforms = {
    tCu:             { value: textures?.cu   ?? null },
    tMask:           { value: textures?.mask ?? null },
    tSilk:           { value: textures?.silk ?? null },
    uMaskColor:      { value: maskColor.clone() },
    uCopperColor:    { value: copperColor.clone() },
    uSilkColor:      { value: SILK_COLOR.clone() },
    uSide:           { value: side === 'front' ? 1.0 : -1.0 },
    uMaskRoughness:  { value: opts.maskRoughness  ?? 0.45 },
    uCopperRoughness:{ value: opts.copperRoughness ?? 0.08 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    mat.userData.shader = shader;

    shader.fragmentShader = UNIFORMS_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>',       '#include <color_fragment>\n'       + COLOR_INJECT)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + ROUGHNESS_INJECT)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + METALNESS_INJECT);
  };

  mat.userData.pcbUniforms = uniforms;
  return mat;
}

/** Update material uniforms live (settings panel changes). */
export function applyBoardSettings(frontMat, backMat, opts) {
  for (const mat of [frontMat, backMat]) {
    const u = mat.userData.pcbUniforms;
    if (!u) continue;
    const maskColor   = MASK_COLORS[opts.maskColor ?? 'green']  ?? MASK_COLORS.green;
    const copperColor = FINISH_COLORS[opts.finish   ?? 'enig']  ?? FINISH_COLORS.enig;
    u.uMaskColor.value.copy(maskColor);
    u.uCopperColor.value.copy(copperColor);
    u.uSilkColor.value.copy(SILK_COLOR);
    u.uMaskRoughness.value   = opts.maskRoughness   ?? 0.45;
    u.uCopperRoughness.value = opts.copperRoughness ?? 0.08;
    mat.needsUpdate = true;
  }
}

// ── Board mesh builder ────────────────────────────────────────────────────────

/**
 * Build the complete PCB board mesh group.
 *
 * @param {{ width: number, height: number }} boardMm  - board dimensions in mm
 * @param {number} thickness                           - board thickness (mm, default 1.6)
 * @param {LayerTextures} textures                     - from LayerRasterizer
 * @param {object} opts                                - material options
 * @returns {{ group, frontMat, backMat, edgeMat }}
 */
export function buildBoardMesh(boardMm, thickness = 1.6, textures = null, opts = {}) {
  const { width: w, height: h } = boardMm;

  const group = new THREE.Group();
  group.name  = 'pcb_board';

  // Front face — at Z = thickness, facing +Z
  const frontMat = makePcbMaterial('front', textures, opts);
  const frontGeo = new THREE.PlaneGeometry(w, h);
  const frontMesh = new THREE.Mesh(frontGeo, frontMat);
  frontMesh.position.z = thickness;
  frontMesh.name = 'pcb_front';
  frontMesh.receiveShadow = true;
  group.add(frontMesh);

  // Back face — at Z = 0, facing -Z
  const backMat  = makePcbMaterial('back', textures, opts);
  const backGeo  = new THREE.PlaneGeometry(w, h);
  const backMesh = new THREE.Mesh(backGeo, backMat);
  backMesh.position.z   = 0;
  backMesh.rotation.x   = Math.PI;
  backMesh.name  = 'pcb_back';
  backMesh.receiveShadow = true;
  group.add(backMesh);

  // Edge (FR-4 fiberglass sides)
  const edgeMat = new THREE.MeshStandardMaterial({
    color:     FR4_COLOR,
    roughness: 0.88,
    metalness: 0,
    name: 'pcb_edge',
  });
  const edgeShape = new THREE.Shape();
  edgeShape.moveTo(-w / 2, -h / 2);
  edgeShape.lineTo( w / 2, -h / 2);
  edgeShape.lineTo( w / 2,  h / 2);
  edgeShape.lineTo(-w / 2,  h / 2);
  edgeShape.closePath();
  const edgeGeo = new THREE.ExtrudeGeometry(edgeShape, { depth: thickness, bevelEnabled: false });
  // ExtrudeGeometry extrudes in +Z, reposition so Z 0→thickness
  const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
  edgeMesh.name  = 'pcb_edge';
  edgeMesh.receiveShadow = edgeMesh.castShadow = true;
  // Clip edge: slightly smaller than faces to avoid z-fighting
  edgeMesh.scale.set(0.9998, 0.9998, 1);
  group.add(edgeMesh);

  return { group, frontMat, backMat, edgeMat };
}

/** Swap in new textures (e.g. after file change) without rebuilding geometry. */
export function updateBoardTextures(frontMat, backMat, textures) {
  for (const mat of [frontMat, backMat]) {
    const u = mat.userData.pcbUniforms;
    if (!u) continue;
    u.tCu.value   = textures.cu;
    u.tMask.value = textures.mask;
    u.tSilk.value = textures.silk;
    mat.needsUpdate = true;
  }
}
