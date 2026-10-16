// Anime art styles: cel-shaded materials and an ink-outline pass.
//
// Toon shading swaps lit materials for MeshToonMaterial with a crisp light/shadow edge, so
// surfaces fall into flat bands of light and shadow. The outline pass draws ink lines wherever
// depth or surface direction changes sharply, then grades the colors.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Look settings shared by every toon material, switched with the art style:
//  anime - grounded, painted seinen-anime look: soft shadows, thin sepia ink, painted texture
//          on surfaces and hand-drawn stonework on stone.
//  chibi - bright and cute: hard blue-violet shadows, bold black ink, a strong rim light.
export const TOON = {
  shadowFloor: { value: 0.42 }, ambientTint: { value: new THREE.Color(0.9, 0.93, 1.06) }, rim: { value: 0.1 },
  paint: { value: 1 }, stone: { value: 1 },
};
const TOON_STYLES = {
  anime: { shadowFloor: 0.42, ambientTint: [0.9, 0.93, 1.06], rim: 0.1, paint: 1, stone: 1 },
  chibi: { shadowFloor: 0.22, ambientTint: [0.78, 0.84, 1.22], rim: 0.32, paint: 0, stone: 0 },
};
export function setToonStyle(style) {
  const st = TOON_STYLES[style] || TOON_STYLES.anime;
  TOON.shadowFloor.value = st.shadowFloor;
  TOON.ambientTint.value.setRGB(...st.ambientTint);
  TOON.rim.value = st.rim;
  TOON.paint.value = st.paint;
  TOON.stone.value = st.stone;
}

const PAINT_GLSL = `
  varying vec3 vWorldP;
  uniform float toonShadowFloor; uniform vec3 toonAmbientTint; uniform float toonRim; uniform float toonPaint; uniform float toonStone;
  float dsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dsNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dsHash(i), dsHash(i + vec3(1,0,0)), f.x), mix(dsHash(i + vec3(0,1,0)), dsHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dsHash(i + vec3(0,0,1)), dsHash(i + vec3(1,0,1)), f.x), mix(dsHash(i + vec3(0,1,1)), dsHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Distance to the nearest and second-nearest cell point: their difference is small along
  // cell borders, which draws irregular stone outlines across any surface.
  vec3 dsCells(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = vec3(dsHash(i + g), dsHash(i + g + 17.3), dsHash(i + g + 41.7)) * 0.8 + 0.1;
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = dsHash(i + g + 5.1); } else if (d < d2) d2 = d;
    }
    return vec3(d1, d2, id);
  }`;

// Anime shading on top of MeshToonMaterial: one crisp light/shadow edge instead of a smooth
// falloff, tinted shadows, a rim light, and (in the anime style) a painted, hand-made surface.
function animeShader(t, opts) {
  t.onBeforeCompile = (sh) => {
    sh.uniforms.toonShadowFloor = TOON.shadowFloor;
    sh.uniforms.toonAmbientTint = TOON.ambientTint;
    sh.uniforms.toonRim = TOON.rim;
    sh.uniforms.toonPaint = TOON.paint;
    sh.uniforms.toonStone = TOON.stone;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWorldP = (modelMatrix * wp).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PAINT_GLSL)
      .replace('#include <gradientmap_pars_fragment>', `
        vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
          float d = dot(normal, lightDirection);
          float fw = fwidth(d) * 0.7 + 0.015;
          return vec3(mix(toonShadowFloor, 1.0, smoothstep(0.08 - fw, 0.08 + fw, d)));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float amt = toonPaint * ${opts.paint.toFixed(2)};
          if (amt > 0.0) {
            // Painted surface: broad tonal patches and finer brush mottling.
            float m = dsNoise(vWorldP * 0.07) * 0.4 + dsNoise(vWorldP * 0.45) * 0.4 + dsNoise(vWorldP * 2.1) * 0.2;
            diffuseColor.rgb *= clamp(1.0 + (m - 0.5) * 1.3 * amt, 0.6, 1.4);
          }
          ${opts.stone ? `
          if (toonStone > 0.0) {
            // Hand-drawn stonework: irregular stones with darker mortar lines and varied tones.
            vec3 c = dsCells(vWorldP * ${opts.stone.toFixed(2)});
            float e = c.y - c.x;
            float w = fwidth(e) * 1.2 + 0.02;
            float line = 1.0 - smoothstep(0.04, 0.04 + w, e);
            diffuseColor.rgb *= mix(1.0, 0.86 + c.z * 0.24, toonStone);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.42, line * 0.85 * toonStone);
          }` : ''}
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= toonAmbientTint;`)
      .replace('#include <opaque_fragment>', `
        float rimV = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
        outgoingLight += diffuseColor.rgb * smoothstep(0.62, 0.7, rimV) * toonRim;
        #include <opaque_fragment>`);
  };
  t.customProgramCacheKey = () => `anime-toon-${opts.paint}-${opts.stone}`;
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
    // Original materials can ask for more or less painted texture, and for stonework (cells per meter).
    animeShader(t, { paint: m.userData.paint ?? 1, stone: m.userData.stone || 0 });
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

export function setHullStyle(ink, width) {
  const m = inkHullMaterial();
  m.uniforms.ink.value.set(ink);
  m.uniforms.width.value = width;
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
    this.settings = { thickness: 1.2, depthK: 0.002, normalK: 0.9, saturation: 1.3, ink: new THREE.Color('#1a1020'), inkAlpha: 0.92, vignette: 1, grade: new THREE.Color(1, 1, 1), speed: 0, time: 0 };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tNormal: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() }, thickness: { value: 1 }, depthK: { value: 0.003 }, normalK: { value: 0.9 },
        saturation: { value: 1.3 }, ink: { value: new THREE.Color() }, inkAlpha: { value: 0.92 }, vignette: { value: 1 }, grade: { value: new THREE.Color() }, speed: { value: 0 }, time: { value: 0 }, aspect: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float thickness; uniform float depthK; uniform float normalK; uniform float saturation; uniform vec3 ink; uniform float inkAlpha; uniform float vignette; uniform vec3 grade;
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
          col.rgb *= grade;
          col.rgb = mix(col.rgb, ink, clamp(edge, 0.0, 1.0) * inkAlpha);
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
          col.rgb *= mix(vec3(1.0), vec3(0.82, 0.76, 0.88), smoothstep(0.45, 0.95, r) * vignette);
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
    u.inkAlpha.value = s.inkAlpha; u.vignette.value = s.vignette; u.grade.value.copy(s.grade);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
