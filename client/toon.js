// Anime art style: cel-shaded materials and an ink-outline pass.
//
// Toon shading swaps lit materials for MeshToonMaterial with a three-step light ramp, so
// surfaces fall into flat bands of light and shadow. The outline pass draws dark ink lines
// wherever depth or surface direction changes sharply, then lifts color saturation.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

const toonCache = new WeakMap();
function toonOf(m) {
  if (!(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)) return m;
  let t = toonCache.get(m);
  if (!t) {
    t = new THREE.MeshToonMaterial({
      color: m.color, map: m.map?.isCanvasTexture && m.normalMap ? null : m.map, gradientMap: toonRamp(),
      vertexColors: m.vertexColors, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, emissiveMap: m.emissiveMap,
      bumpMap: m.bumpMap, bumpScale: m.bumpScale, transparent: m.transparent, opacity: m.opacity, side: m.side,
      depthWrite: m.depthWrite, alphaTest: m.alphaTest, fog: m.fog,
    });
    t.userData.orig = m;
    toonCache.set(m, t);
  }
  return t;
}

// Swap every lit material in a scene to its toon version (or back).
export function stylize(scene, anime) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    if (anime) {
      if (!o.material.isMeshToonMaterial) o.material = toonOf(o.material);
    } else if (o.material.isMeshToonMaterial && o.material.userData.orig) {
      o.material = o.material.userData.orig;
    }
  });
}

// Ink outlines from a depth + normal pre-pass, plus a saturation lift.
export class InkPass extends Pass {
  constructor() {
    super();
    this.scene = null;
    this.camera = null;
    this.normalMat = new THREE.MeshNormalMaterial();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.target.depthTexture.type = THREE.FloatType;
    this.settings = { thickness: 1.2, depthK: 0.002, normalK: 0.9, saturation: 1.3, ink: new THREE.Color('#1a1020') };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tNormal: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() }, thickness: { value: 1 }, depthK: { value: 0.003 }, normalK: { value: 0.9 },
        saturation: { value: 1.3 }, ink: { value: new THREE.Color() },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float thickness; uniform float depthK; uniform float normalK; uniform float saturation; uniform vec3 ink;
        varying vec2 vUv;
        float D(vec2 uv) { return texture2D(tDepth, uv).x; }
        vec3 N(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          vec2 o = texel * thickness;
          float d0 = D(vUv);
          // Second difference: zero across smooth slopes, large at silhouettes and creases.
          float dd = abs(D(vUv + vec2(o.x, 0.0)) + D(vUv - vec2(o.x, 0.0)) - 2.0 * d0)
                   + abs(D(vUv + vec2(0.0, o.y)) + D(vUv - vec2(0.0, o.y)) - 2.0 * d0);
          vec3 n0 = N(vUv);
          float nd = (1.0 - dot(n0, N(vUv + vec2(o.x, 0.0)))) + (1.0 - dot(n0, N(vUv - vec2(o.x, 0.0))))
                   + (1.0 - dot(n0, N(vUv + vec2(0.0, o.y)))) + (1.0 - dot(n0, N(vUv - vec2(0.0, o.y))));
          // Lines fade out toward the far distance so the horizon stays clean.
          float fade = 1.0 - smoothstep(0.985, 0.999, d0);
          float edge = max(smoothstep(depthK * 0.4, depthK, dd), smoothstep(normalK * 0.5, normalK, nd)) * fade;
          float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
          col.rgb = mix(vec3(l), col.rgb, saturation);
          col.rgb = mix(col.rgb, ink, clamp(edge, 0.0, 1.0) * 0.92);
          gl_FragColor = col;
        }`,
    }));
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.quad.material.uniforms.texel.value.set(1 / w, 1 / h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const scene = this.scene, camera = this.camera;
    // Depth + normals of solid things only: skies, glows, sprites and see-through surfaces skip it.
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      const solid = o.isMesh && o.material && !o.material.transparent && !o.material.isShaderMaterial && !o.userData.noInk;
      if (!solid && (o.isMesh || o.isSprite || o.isPoints || o.isLine)) { o.visible = false; hidden.push(o); }
    });
    const bg = scene.background, ov = scene.overrideMaterial;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.overrideMaterial = ov;
    scene.background = bg;
    for (const o of hidden) o.visible = true;

    const u = this.quad.material.uniforms, s = this.settings;
    u.tDiffuse.value = readBuffer.texture;
    u.thickness.value = s.thickness; u.depthK.value = s.depthK; u.normalK.value = s.normalK;
    u.saturation.value = s.saturation; u.ink.value.copy(s.ink);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
