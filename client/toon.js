// Anime art style: cel-shaded materials and an ink-outline pass.
//
// Toon shading swaps lit materials for MeshToonMaterial with a three-step light ramp, so
// surfaces fall into flat bands of light and shadow. The outline pass draws dark ink lines
// wherever depth or surface direction changes sharply, then lifts color saturation.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Anime shading on top of MeshToonMaterial: one crisp light/shadow edge instead of a smooth
// falloff, shadows tinted cool blue-violet like painted cels, and a bright rim along silhouettes.
function animeShader(t) {
  t.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', `
        vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
          float d = dot(normal, lightDirection);
          float fw = fwidth(d) * 0.7 + 0.015;
          return vec3(mix(0.22, 1.0, smoothstep(0.08 - fw, 0.08 + fw, d)));
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vec3(0.78, 0.84, 1.22);`)
      .replace('#include <opaque_fragment>', `
        float rimV = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
        outgoingLight += diffuseColor.rgb * smoothstep(0.62, 0.7, rimV) * 0.32;
        #include <opaque_fragment>`);
  };
  t.customProgramCacheKey = () => 'anime-toon';
}

const toonCache = new WeakMap();
function toonOf(m) {
  if (!(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)) return m;
  let t = toonCache.get(m);
  if (!t) {
    t = new THREE.MeshToonMaterial({
      color: m.color, map: m.map?.isCanvasTexture && m.normalMap ? null : m.map,
      vertexColors: m.vertexColors, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, emissiveMap: m.emissiveMap,
      bumpMap: m.bumpMap, bumpScale: m.bumpScale, transparent: m.transparent, opacity: m.opacity, side: m.side,
      depthWrite: m.depthWrite, alphaTest: m.alphaTest, fog: m.fog,
    });
    animeShader(t);
    t.userData.orig = m;
    toonCache.set(m, t);
  }
  return t;
}

// Bold ink outlines around characters: a slightly inflated, inside-out copy of each part drawn
// in ink. The line keeps a steady on-screen width up close and thins out with distance.
let hullMat = null;
function inkHullMaterial() {
  if (hullMat) return hullMat;
  hullMat = new THREE.ShaderMaterial({
    uniforms: { ink: { value: new THREE.Color('#1a1020') }, width: { value: 0.0045 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float width;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * width * min(-mv.z, 25.0);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 ink;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(ink, 1.0);
      }`,
    side: THREE.BackSide,
  });
  return hullMat;
}

export function addInkHull(group) {
  const parts = [];
  group.traverse((o) => { if (o.isMesh && !o.material.isMeshBasicMaterial && !o.material.transparent && !o.userData.noHull) parts.push(o); });
  for (const o of parts) {
    const hull = new THREE.Mesh(o.geometry, inkHullMaterial());
    hull.userData.noInk = true;
    hull.raycast = () => {};
    o.add(hull);
  }
  return group;
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
    this.settings = { thickness: 1.2, depthK: 0.002, normalK: 0.9, saturation: 1.3, ink: new THREE.Color('#1a1020'), speed: 0, time: 0 };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tNormal: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() }, thickness: { value: 1 }, depthK: { value: 0.003 }, normalK: { value: 0.9 },
        saturation: { value: 1.3 }, ink: { value: new THREE.Color() }, speed: { value: 0 }, time: { value: 0 }, aspect: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float thickness; uniform float depthK; uniform float normalK; uniform float saturation; uniform vec3 ink;
        uniform float speed; uniform float time; uniform float aspect;
        varying vec2 vUv;
        float h1(float n) { return fract(sin(n) * 43758.5453); }
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
          vec2 c = (vUv - 0.5) * vec2(aspect, 1.0);
          float r = length(c);
          // Speed lines: thin white streaks rushing out from the center at high speed.
          if (speed > 0.01) {
            float a = atan(c.y, c.x) * 57.0;
            float id = floor(a), f = fract(a);
            float on = step(1.0 - 0.35 * speed, h1(id + floor(time * 14.0) * 7.13));
            float thin = smoothstep(0.5, 0.0, abs(f - 0.5) - 0.1 * h1(id * 3.1));
            float streak = on * thin * smoothstep(0.28, 0.75, r) * speed;
            col.rgb = mix(col.rgb, vec3(1.0), clamp(streak, 0.0, 1.0) * 0.55);
          }
          // A soft vignette, warm at the edges like a film frame.
          col.rgb *= mix(vec3(1.0), vec3(0.82, 0.76, 0.88), smoothstep(0.45, 0.95, r));
          gl_FragColor = col;
        }`,
    }));
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.quad.material.uniforms.texel.value.set(1 / w, 1 / h);
    this.quad.material.uniforms.aspect.value = w / h;
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
    u.speed.value = s.speed; u.time.value = s.time;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
