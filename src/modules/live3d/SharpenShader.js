/**
 * SharpenShader — unsharp-mask style convolution for ShaderPass.
 * three/addons does not ship a sharpen shader; this is a minimal
 * 4-neighbor Laplacian kernel scaled by `amount`.
 */

import * as THREE from 'three';

export const SharpenShader = {
  uniforms: {
    tDiffuse:   { value: null },
    resolution: { value: new THREE.Vector2() },
    amount:     { value: 0.2 },
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 texel = 1.0 / resolution;
      vec4 center = texture2D(tDiffuse, vUv);
      vec4 sum = texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0))
               + texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0))
               + texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0))
               + texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0));
      gl_FragColor = center + (center * 4.0 - sum) * amount;
    }
  `,
};
