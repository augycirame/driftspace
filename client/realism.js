// Realistic rendering: physically based sky and image-based lighting, detailed terrain with
// cliffs, sand, snow and wet shores, wind-blown grass, leafy trees, rocks, reflective water,
// and triplanar surface detail for buildings, ships and people.
//
// Surface detail comes from CC0 normal maps (@pmndrs/assets, served at /cc0/) blended with
// procedural noise in world space, so nothing stretches and nothing visibly tiles.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- the realistic switch ----------------------------------------------------------------------

let enabled = false;
export const setRealism = (on) => { enabled = !!on; };
export const realism = () => enabled;

// ---- CC0 normal maps --------------------------------------------------------------------------

const NORMAL_IDS = {
  ground: '0010', fine: '0028', rock: '0005', rough: '0002', cracked: '0003', sand: '0027', fineSand: '0018', mud: '0024',
  water: '0007', cobble: '0026', pebbles: '0009', wood: '0004', planks: '0012', siding: '0016', bark: '0011', metal: '0008',
  scratched: '0022', fabric: '0017', plaster: '0006', tiles: '0025', concrete: '0001', leather: '0019', crumpled: '0014',
};
const normalCache = new Map();
export function cc0Normal(name) {
  let tex = normalCache.get(name);
  if (tex) return tex;
  const flat = document.createElement('canvas');
  flat.width = flat.height = 1;
  const fc = flat.getContext('2d');
  fc.fillStyle = 'rgb(128,128,255)';
  fc.fillRect(0, 0, 1, 1);
  tex = new THREE.Texture(flat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  normalCache.set(name, tex);
  import(`/cc0/normals/${NORMAL_IDS[name] || NORMAL_IDS.fine}.webp.js`).then((m) => {
    const img = new Image();
    // The placeholder's GPU storage is 1x1: free it so the real image gets fresh storage.
    img.onload = () => { tex.dispose(); tex.image = img; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true; };
    img.src = m.default;
  }).catch(() => {});
  return tex;
}

// ---- shared GLSL --------------------------------------------------------------------------------

const NOISE = `
  float rHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float rNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rHash(i), rHash(i + vec3(1,0,0)), f.x), mix(rHash(i + vec3(0,1,0)), rHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(rHash(i + vec3(0,0,1)), rHash(i + vec3(1,0,1)), f.x), mix(rHash(i + vec3(0,1,1)), rHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float rFbm(vec3 p) { return rNoise(p) * 0.5 + rNoise(p * 2.03 + 7.1) * 0.25 + rNoise(p * 4.07 + 3.3) * 0.15 + rNoise(p * 8.1 + 1.7) * 0.1; }
  // Whiteout-blended triplanar normal mapping in world space.
  vec3 rTriNormal(sampler2D map, vec3 p, vec3 n, float scale, float strength) {
    vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 tx = texture2D(map, p.zy * scale).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(map, p.xz * scale).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(map, p.xy * scale).xyz * 2.0 - 1.0;
    tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  }`;

const WORLD_VARYINGS_VS = `
  vec4 rwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    rwp = instanceMatrix * rwp;
  #endif
  vRWorld = (modelMatrix * rwp).xyz;
  vRNormal = inverseTransformDirection(transformedNormal, viewMatrix);`;

const LOCAL_VARYINGS_VS = `
  vRWorld = transformed;
  vRNormal = normalize(objectNormal);`;

// Add world-space surface detail to any standard material: a triplanar CC0 normal map,
// weathering of the color and a little roughness variation.
// Moving things (people, ships) take local=true so the detail sticks to them.
export function realSurface(material, { normal = 'fine', scale = 0.5, strength = 1, dirt = 0.18, roughVar = 0.25, local = false } = {}) {
  if (!enabled || !material || material.userData.realSurface) return material;
  material.userData.realSurface = true;
  const map = cc0Normal(normal);
  material.onBeforeCompile = (sh) => {
    sh.uniforms.rNormalMap = { value: map };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRWorld;\nvarying vec3 vRNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${local ? LOCAL_VARYINGS_VS : WORLD_VARYINGS_VS}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRWorld;\nvarying vec3 vRNormal;\nuniform sampler2D rNormalMap;\n${local ? 'uniform mat3 normalMatrix;' : ''}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rWeather = rFbm(vRWorld * 0.35) * 0.7 + rFbm(vRWorld * 2.7) * 0.3;
        diffuseColor.rgb *= 1.0 + (rWeather - 0.5) * ${(dirt * 2).toFixed(3)};`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (rWeather - 0.5) * ${roughVar.toFixed(3)} * 2.0), 0.03, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nW = normalize(vRNormal);
          vec3 dW = rTriNormal(rNormalMap, vRWorld, nW, ${scale.toFixed(3)}, ${strength.toFixed(3)});
          normal = normalize(${local ? 'normalMatrix * dW' : '(viewMatrix * vec4(dW, 0.0)).xyz'});
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif
        }`);
  };
  material.customProgramCacheKey = () => `real-${normal}-${scale}-${strength}-${dirt}-${local}`;
  material.needsUpdate = true;
  return material;
}

// Surface detail for building blocks (planet bases, stations and ships).
const BLOCK_DETAIL = {
  hull: { normal: 'metal', scale: 0.9, strength: 0.8, dirt: 0.22, rough: 0.42, metal: 0.75 },
  solar: { normal: 'tiles', scale: 2, strength: 0.4, dirt: 0.05, rough: 0.15, metal: 0.3 },
  gold: { normal: 'scratched', scale: 1.2, strength: 0.5, dirt: 0.1, rough: 0.28, metal: 1 },
  wood: { normal: 'planks', scale: 0.5, strength: 1, dirt: 0.22, rough: 0.85, metal: 0 },
  stone: { normal: 'cobble', scale: 0.45, strength: 1.2, dirt: 0.28, rough: 0.92, metal: 0 },
  door: { normal: 'planks', scale: 0.6, strength: 1, dirt: 0.2, rough: 0.8, metal: 0 },
  bed: { normal: 'fabric', scale: 2, strength: 0.8, dirt: 0.1, rough: 0.95, metal: 0 },
  chest: { normal: 'wood', scale: 0.8, strength: 1, dirt: 0.2, rough: 0.75, metal: 0 },
  bench: { normal: 'wood', scale: 0.8, strength: 1, dirt: 0.2, rough: 0.75, metal: 0 },
  turret: { normal: 'scratched', scale: 1, strength: 0.7, dirt: 0.2, rough: 0.4, metal: 0.8 },
};
export function realBlock(material, id, local = false) {
  const d = BLOCK_DETAIL[id];
  if (!enabled || !d || material.transparent) return material;
  material.roughness = d.rough;
  material.metalness = d.metal;
  return realSurface(material, { ...d, local });
}

// ---- the physical sky ----------------------------------------------------------------------------

// Rayleigh scattering for a planet's air: Earth for Earth-like worlds, tinted for alien skies.
const EARTH_RAYLEIGH = new THREE.Vector3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
export function rayleighFor(skyColor, earthLike) {
  if (earthLike) return EARTH_RAYLEIGH.clone();
  const c = new THREE.Color(skyColor);
  const v = new THREE.Vector3(c.r * c.r + 0.02, c.g * c.g + 0.02, c.b * c.b + 0.02);
  const mean = (EARTH_RAYLEIGH.x + EARTH_RAYLEIGH.y + EARTH_RAYLEIGH.z) / 3;
  return v.multiplyScalar((mean * 3) / (v.x + v.y + v.z));
}

const SKY_VS = `
  uniform vec3 sunDir; uniform float rayleigh; uniform float turbidity; uniform float mieCoefficient; uniform vec3 betaRBase;
  varying vec3 vDir; varying float vSunE; varying vec3 vBetaR; varying vec3 vBetaM;
  const float e = 2.718281828459045; const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
  const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
  float sunIntensity(float c) { c = clamp(c, -1.0, 1.0); return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(c)) / steepness))); }
  void main() {
    vDir = normalize(position);
    vSunE = sunIntensity(sunDir.y);
    vBetaR = betaRBase * rayleigh;
    float c = (0.2 * turbidity) * 10E-18;
    vBetaM = 0.434 * c * MieConst * mieCoefficient;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99999;   // always at the far plane
  }`;

const SKY_FS = `
  uniform vec3 sunDir; uniform float mieDirectionalG; uniform float time; uniform float coverage; uniform float cloudDark; uniform float night; uniform float clouds; uniform float skyGain;
  varying vec3 vDir; varying float vSunE; varying vec3 vBetaR; varying vec3 vBetaM;
  const float pi = 3.141592653589793;
  const float rayleighZenithLength = 8.4E3; const float mieZenithLength = 1.25E3;
  const float sunAngularDiameterCos = 0.9999566769;
  ${NOISE}
  float rayleighPhase(float c) { return 0.05968310365946075 * (1.0 + c * c); }
  float hgPhase(float c, float g) { float g2 = g * g; return 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5)); }
  // Scattered light toward direction d (Preetham-style).
  vec3 skyAt(vec3 d, out vec3 Fex) {
    float zenithAngle = acos(max(0.0, d.y));
    float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
    float sR = rayleighZenithLength * inv, sM = mieZenithLength * inv;
    Fex = exp(-(vBetaR * sR + vBetaM * sM));
    float cosTheta = dot(d, sunDir);
    vec3 betaRTheta = vBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
    vec3 betaMTheta = vBetaM * hgPhase(cosTheta, mieDirectionalG);
    vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
    Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
    return Lin;
  }
  // Cloud density on a layer above: domain-warped noise with a coverage threshold.
  float cloudDensity(vec2 p) {
    vec2 w = vec2(rFbm(vec3(p * 0.6, 1.3)), rFbm(vec3(p * 0.6 + 5.2, 2.1)));
    float n = rFbm(vec3(p + w * 1.4 + vec2(time * 0.01, time * 0.004), 0.5));
    float detail = rFbm(vec3(p * 4.0 + vec2(time * 0.03, 0.0), 3.0));
    return clamp((n + detail * 0.22 - (1.0 - coverage) * 0.8 - 0.18) * 2.6, 0.0, 1.0);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 Fex;
    vec3 Lin = skyAt(d, Fex);
    float cosTheta = dot(d, sunDir);
    vec3 L0 = vec3(0.1) * Fex;
    L0 += (vSunE * 19000.0 * Fex) * smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
    vec3 col = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    col = pow(col, vec3(1.0 / 2.4));
    // Stars and the Milky Way when the sun is down.
    if (night > 0.0 && d.y > 0.0) {
      vec3 sc = floor(d * 420.0);
      float s = rHash(sc);
      float star = smoothstep(0.9975, 1.0, s) * (0.5 + 0.5 * sin(time * 1.7 + s * 80.0));
      float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.45, 0.84))) * 3.0, 2.0));
      float milky = rFbm(d * 9.0) * band;
      col += night * (vec3(star) * (0.6 + 0.8 * rHash(sc + 3.0)) + vec3(0.45, 0.47, 0.55) * milky * 0.12) * (1.0 - coverage * 0.85);
      // The moon, opposite the sun.
      float m = dot(d, -sunDir);
      col += night * (vec3(0.9, 0.92, 1.0) * smoothstep(0.99985, 0.9999, m) * 1.4 + vec3(0.25, 0.3, 0.4) * pow(max(m, 0.0), 300.0) * 0.4);
    }
    // Clouds: lit by the sun through the atmosphere, darker underneath, glowing at the edges.
    if (clouds > 0.5 && d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.06) * 0.9;
      float dens = cloudDensity(uv);
      if (dens > 0.001) {
        vec3 sFex; vec3 sunCol = skyAt(normalize(vec3(sunDir.x, max(sunDir.y, 0.02), sunDir.z)), sFex);
        vec3 sunLight = sFex * vec3(1.0, 0.96, 0.9) * clamp(vSunE / 600.0, 0.0, 1.5);
        // March a few steps toward the sun to shade the cloud.
        float shade = 0.0;
        vec2 toSun = normalize(sunDir.xz + 1e-4) * 0.08;
        for (int i = 1; i <= 4; i++) shade += cloudDensity(uv + toSun * float(i));
        float lightT = exp(-shade * 0.9 * cloudDark);
        float silver = pow(max(cosTheta, 0.0), 12.0) * (1.0 - dens) * 2.0;
        vec3 ambient = mix(vec3(0.35, 0.4, 0.5), col * 1.4, 0.5) * (0.35 + 0.65 * (1.0 - night));
        vec3 cloudCol = ambient * (0.55 + 0.45 * (1.0 - dens)) + sunLight * (lightT * 0.9 + silver);
        cloudCol *= mix(1.0, 0.45, cloudDark * dens);
        float fade = smoothstep(0.0, 0.12, d.y);
        col = mix(col, cloudCol, dens * fade);
      }
    }
    // Below the horizon: haze.
    if (d.y < 0.0) col = mix(col, col * 0.7, clamp(-d.y * 4.0, 0.0, 1.0));
    gl_FragColor = vec4(col * skyGain, 1.0);
  }`;

// The sky's brightness against sunlight: a sunlit white wall is a few times brighter than the sky.
export const SKY_GAIN = 0.3;

export function physicalSky({ skyColor = '#88b4e0', earthLike = true, turbidity = 4, rayleigh = 1.6 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() }, betaRBase: { value: rayleighFor(skyColor, earthLike) },
      rayleigh: { value: rayleigh }, turbidity: { value: turbidity }, mieCoefficient: { value: 0.005 }, mieDirectionalG: { value: 0.8 },
      time: { value: 0 }, coverage: { value: 0.35 }, cloudDark: { value: 0.6 }, night: { value: 0 }, clouds: { value: 1 }, skyGain: { value: SKY_GAIN },
    },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

// The same sky formula on the CPU: the color of the horizon (for fog) and of sunlight.
export function skyColors(sunDir, betaR, turbidity = 4, rayleigh = 1.6) {
  const e = Math.E, cutoff = 1.6110731556870734, steep = 1.5;
  const sunE = 1000 * Math.max(0, 1 - Math.pow(e, -((cutoff - Math.acos(Math.max(-1, Math.min(1, sunDir.y)))) / steep)));
  const bR = [betaR.x * rayleigh, betaR.y * rayleigh, betaR.z * rayleigh];
  const c = 0.2 * turbidity * 10e-18, mie = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14].map((m) => 0.434 * c * m * 0.005);
  const fex = (dy) => {
    const za = Math.acos(Math.max(0, dy));
    const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
    return [0, 1, 2].map((i) => Math.exp(-(bR[i] * 8400 * inv + mie[i] * 1250 * inv)));
  };
  const sunF = fex(Math.max(sunDir.y, 0.02));
  const sun = new THREE.Color(sunF[0], sunF[1], sunF[2]);
  // Horizon color: average of looking toward and away from the sun.
  const hor = new THREE.Color();
  for (const s of [1, -1]) {
    const d = new THREE.Vector3(sunDir.x * s, 0.04, sunDir.z * s).normalize();
    const F = fex(d.y), cos = d.dot(sunDir);
    const rP = 0.0597 * (1 + Math.pow(cos * 0.5 + 0.5, 2));
    const g = 0.8, mP = 0.0796 * ((1 - g * g) / Math.pow(1 - 2 * g * cos + g * g, 1.5));
    const L = [0, 1, 2].map((i) => {
      const ratio = (bR[i] * rP + mie[i] * mP) / (bR[i] + mie[i]);
      let lin = Math.pow(sunE * ratio * (1 - F[i]), 1.5);
      lin *= 1 + (Math.pow(sunE * ratio * F[i], 0.5) - 1) * Math.min(1, Math.pow(1 - sunDir.y, 5));
      return Math.pow((lin + 0.1 * F[i]) * 0.04 + [0, 0.0003, 0.00075][i], 1 / 2.4);
    });
    hor.r += L[0] / 2; hor.g += L[1] / 2; hor.b += L[2] / 2;
  }
  hor.multiplyScalar(SKY_GAIN);
  return { sun, horizon: hor, sunE };
}

// Image-based lighting captured from a sky, refreshed as the sun moves.
export class SkyEnvironment {
  constructor(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.target = null;
    this.lastDir = new THREE.Vector3(9, 9, 9);
    this.lastAt = 0;
  }
  setSky(skyMesh) {
    this.scene.clear();
    this.sky = new THREE.Mesh(skyMesh.geometry, skyMesh.material);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }
  update(sunDir, now, force = false) {
    if (!this.sky) return null;
    if (!force && sunDir.distanceTo(this.lastDir) < 0.03 && now - this.lastAt < 30000) return this.target?.texture || null;
    this.lastDir.copy(sunDir);
    this.lastAt = now;
    const old = this.target;
    this.target = this.pmrem.fromScene(this.scene, 0, 1, 10000);
    old?.dispose();
    return this.target.texture;
  }
  dispose() { this.target?.dispose(); this.pmrem.dispose(); }
}

// ---- terrain ----------------------------------------------------------------------------------------

// Detailed ground: the height-based colors from the terrain, broken up by large and small
// variation, with rock on cliffs, sand at the shore, snow up high on cold worlds and dark wet
// ground where the water laps. Detail normals come from CC0 scans, triplanar on cliffs.
export function terrainMaterial({ rock = '#6e6a64', sand = '#c8b48a', water = null, snowLine = 9999, wetness = 1, dry = false }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const ground = cc0Normal(dry ? 'fineSand' : 'ground'), fine = cc0Normal('fine'), cliff = cc0Normal('rock'), sandN = cc0Normal('sand');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGround: { value: ground }, tFine: { value: fine }, tCliff: { value: cliff }, tSand: { value: sandN },
      rockCol: { value: new THREE.Color(rock) }, sandCol: { value: new THREE.Color(sand) },
      waterLevel: { value: water ?? -9999 }, snowLine: { value: snowLine }, wetK: { value: wetness },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRWorld;\nvarying vec3 vRNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${WORLD_VARYINGS_VS}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRWorld; varying vec3 vRNormal;
        uniform sampler2D tGround; uniform sampler2D tFine; uniform sampler2D tCliff; uniform sampler2D tSand;
        uniform vec3 rockCol; uniform vec3 sandCol; uniform float waterLevel; uniform float snowLine; uniform float wetK;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nW = normalize(vRNormal);
        float macro = rFbm(vRWorld * 0.012), mid = rFbm(vRWorld * 0.09), micro = rNoise(vRWorld * 1.7);
        float slope = 1.0 - nW.y;
        float cliffK = smoothstep(0.32, 0.5, slope + (mid - 0.5) * 0.18);
        float h = vRWorld.y;
        float shore = waterLevel > -9000.0 ? 1.0 - smoothstep(0.4, 2.6 + mid * 1.5, h - waterLevel) : 0.0;
        float snow = smoothstep(snowLine, snowLine + 6.0, h + (macro - 0.5) * 10.0) * (1.0 - cliffK * 0.7);
        vec3 base = diffuseColor.rgb;
        float lum = dot(base, vec3(0.3, 0.59, 0.11));
        base = mix(vec3(lum), base, 0.82);                       // natural, slightly muted
        base *= 0.78 + macro * 0.38 + (mid - 0.5) * 0.22 + (micro - 0.5) * 0.08;
        vec3 rockC = rockCol * (0.7 + rFbm(vRWorld * vec3(0.2, 0.9, 0.2)) * 0.6);   // strata
        vec3 col = mix(base, rockC, cliffK);
        col = mix(col, sandCol * (0.85 + micro * 0.25), shore * (1.0 - cliffK));
        col = mix(col, vec3(0.92, 0.94, 0.98), snow);
        float wet = waterLevel > -9000.0 ? (1.0 - smoothstep(0.0, 0.9, h - waterLevel)) * wetK : 0.0;
        col *= 1.0 - wet * 0.45;
        diffuseColor.rgb = col;
        float rTerrainRough = mix(mix(0.96, 0.82, cliffK), 0.55, snow);
        rTerrainRough = mix(rTerrainRough, 0.18, wet);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = rTerrainRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Ground detail from the top, cliff detail from all sides.
          vec3 g1 = texture2D(tGround, vRWorld.xz * 0.28).xyz * 2.0 - 1.0;
          vec3 g2 = texture2D(tFine, vRWorld.xz * 1.3).xyz * 2.0 - 1.0;
          vec3 s1 = texture2D(tSand, vRWorld.xz * 0.35).xyz * 2.0 - 1.0;
          vec2 gxy = (g1.xy * 0.9 + g2.xy * 0.5) * (1.0 - shore) + s1.xy * shore * 0.8;
          vec3 topN = normalize(vec3(gxy.x + nW.x, nW.y, gxy.y + nW.z));
          vec3 cliffN = rTriNormal(tCliff, vRWorld, nW, 0.09, 1.3);
          vec3 dW = normalize(mix(topN, cliffN, cliffK));
          dW = normalize(mix(dW, nW, snow * 0.6 + wet * 0.5));
          normal = normalize((viewMatrix * vec4(dW, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => `real-terrain-${dry}`;
  return mat;
}

// ---- water -------------------------------------------------------------------------------------------

export function waterMaterial(color, lava = false) {
  if (lava) return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.6 });
  const normal = cc0Normal('water');
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).multiplyScalar(0.35), roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9,
    normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.1, specularIntensity: 1, ior: 1.33,
  });
  mat.userData.waves = true;
  return mat;
}

// ---- grass ----------------------------------------------------------------------------------------------

// A field of wind-blown grass blades around the camera. Each blade has a fixed spot in the
// world inside a window that wraps around as you move, so nothing pops; the terrain's height
// and color come from textures, so the grass follows digging too.
export class GrassField {
  constructor({ count, radius, half, verts, cell, water, dry = false }) {
    this.radius = radius;
    const blade = new THREE.BufferGeometry();
    // A tapered blade: five vertices, two segments and a tip.
    const p = [-0.5, 0, 0, 0.5, 0, 0, -0.38, 0.45, 0, 0.38, 0.45, 0, 0, 1, 0];
    const uv = [0, 0, 1, 0, 0, 0.45, 1, 0.45, 0.5, 1];
    blade.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const geo = new THREE.InstancedBufferGeometry().copy(blade);
    geo.instanceCount = count;
    const off = new Float32Array(count * 4);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      off[i * 4] = (rnd() * 2 - 1) * radius;
      off[i * 4 + 1] = (rnd() * 2 - 1) * radius;
      off[i * 4 + 2] = rnd();          // random seed: height, lean, color
      off[i * 4 + 3] = rnd() * Math.PI * 2;
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.heightTex = new THREE.DataTexture(new Float32Array(verts * verts * 4), verts, verts, THREE.RGBAFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.verts = verts;
    this.uniforms = {
      gCenter: { value: new THREE.Vector2() }, gTime: { value: 0 }, gRadius: { value: radius }, gHeights: { value: this.heightTex },
      gHalf: { value: half }, gSpan: { value: (verts - 1) * cell }, gWater: { value: water ?? -9999 }, gDry: { value: dry ? 1 : 0 },
      gWind: { value: 1 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, vertexColors: false });
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 offset;
          uniform vec2 gCenter; uniform float gTime; uniform float gRadius; uniform sampler2D gHeights; uniform float gHalf; uniform float gSpan; uniform float gWater; uniform float gDry; uniform float gWind;
          varying vec3 vGColor; varying float vGTip;
          vec4 gSample(vec2 xz) { return texture2D(gHeights, (xz + gHalf) / gSpan); }`)
        .replace('#include <begin_vertex>', `
          vec2 rel = mod(offset.xy - gCenter + gRadius, 2.0 * gRadius) - gRadius;
          vec2 wxz = gCenter + rel;
          vec4 hs = gSample(wxz);
          float e = 1.5;
          float slope = abs(gSample(wxz + vec2(e, 0.0)).r - hs.r) + abs(gSample(wxz + vec2(0.0, e)).r - hs.r);
          vec3 gc = hs.gba;
          float green = gc.g - max(gc.r, gc.b) * 0.92;
          float keep = (gDry > 0.5 ? 0.6 : smoothstep(-0.02, 0.05, green)) * (1.0 - smoothstep(1.0, 1.8, slope)) * step(gWater + 0.25, hs.r);
          float edge = 1.0 - smoothstep(gRadius * 0.7, gRadius, length(rel));
          float hgt = (0.24 + offset.z * 0.42) * keep * edge;
          float c = cos(offset.w), s = sin(offset.w);
          vec3 transformed = vec3(position.x * 0.042 * (1.0 + offset.z) * c, position.y * hgt, position.x * 0.042 * (1.0 + offset.z) * s);
          float sway = sin(gTime * 1.6 + wxz.x * 0.21 + wxz.y * 0.17) * 0.5 + sin(gTime * 2.7 + wxz.x * 0.7) * 0.2;
          float bend = position.y * position.y * hgt * (0.35 + 0.25 * sway) * gWind;
          transformed.x += bend * 0.8 + position.y * (offset.z - 0.5) * 0.25 * hgt;
          transformed.z += bend * 0.35;
          transformed += vec3(wxz.x, hs.r - 0.03, wxz.y);
          vGTip = position.y;
          vec3 base = gDry > 0.5 ? vec3(0.62, 0.55, 0.36) : gc * vec3(0.85, 1.05, 0.7);
          vGColor = base * (0.75 + offset.z * 0.5);`)
        .replace('#include <beginnormal_vertex>', `
          // A blade curls a little across its width, and faces mostly up so fields read as one surface.
          float gc0 = cos(offset.w), gs0 = sin(offset.w);
          vec3 objectNormal = normalize(vec3(-gs0, 0.0, gc0) * 0.45 + vec3(gc0, 0.0, gs0) * position.x * 0.9 + vec3(0.0, 1.0, 0.0));`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGColor; varying float vGTip;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = vGColor * mix(0.28, 1.1, pow(vGTip, 0.8));`);
    };
    mat.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.noCast = true;
  }

  // Copy heights and colors from the terrain geometry.
  syncTerrain(geo) {
    const pos = geo.attributes.position, col = geo.attributes.color, data = this.heightTex.image.data;
    for (let k = 0; k < this.verts * this.verts; k++) {
      data[k * 4] = pos.getY(k);
      data[k * 4 + 1] = col.getX(k); data[k * 4 + 2] = col.getY(k); data[k * 4 + 3] = col.getZ(k);
    }
    this.heightTex.needsUpdate = true;
  }

  update(t, camPos, wind = 1) {
    this.uniforms.gCenter.value.set(camPos.x, camPos.z);
    this.uniforms.gTime.value = t % 3600;
    this.uniforms.gWind.value = wind;
  }
}

// ---- trees and rocks ----------------------------------------------------------------------------------

// A clump of leaves painted on a canvas, with transparency, for leaf cards.
function leafTexture(kind) {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  let s = kind === 'pine' ? 99 : 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (kind === 'pine') {
    for (let i = 0; i < 46; i++) {
      const bx = N * 0.5 + (r() - 0.5) * N * 0.15, by = N * (0.1 + r() * 0.8);
      const len = N * (0.18 + r() * 0.25), ang = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.9);
      for (let j = 0; j < 22; j++) {
        const t = j / 22;
        const px = bx + Math.sin(ang) * len * t, py = by - Math.cos(ang) * len * t * 0.4;
        const g = 60 + r() * 50;
        x.strokeStyle = `rgba(${25 + r() * 25},${g},${30 + r() * 20},0.95)`;
        x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 18, py + 10 + r() * 10); x.stroke();
      }
    }
  } else {
    for (let i = 0; i < 140; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * N * 0.42;
      const px = N / 2 + Math.cos(a) * d, py = N / 2 + Math.sin(a) * d;
      const g = 85 + r() * 70, shade = 0.6 + r() * 0.4;
      x.fillStyle = `rgba(${Math.round((40 + r() * 40) * shade)},${Math.round(g * shade)},${Math.round((25 + r() * 25) * shade)},1)`;
      x.save(); x.translate(px, py); x.rotate(r() * Math.PI * 2);
      x.beginPath(); x.ellipse(0, 0, 4 + r() * 4, 9 + r() * 6, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(20,40,15,0.35)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(0, -8); x.lineTo(0, 8); x.stroke();
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const leafTex = {};
function leafMaterial(kind, tint) {
  leafTex[kind] ||= leafTexture(kind);
  const m = new THREE.MeshStandardMaterial({ map: leafTex[kind], alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: tint || '#ffffff' });
  m.userData.leaves = true;
  return m;
}
export function leafDepthMaterial(kind) {
  leafTex[kind] ||= leafTexture(kind);
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex[kind], alphaTest: 0.45 });
}

// Leaf cards in a crown, each lit as if it were part of a round mass of foliage.
function crown(cards, center, rx, ry, size, seed, droop = 0) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geos = [];
  for (let i = 0; i < cards; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.cbrt(0.35 + r() * 0.65);
    const p = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th) * rx * rr, u * ry * rr, Math.sqrt(1 - u * u) * Math.sin(th) * rx * rr).add(center);
    const g = new THREE.PlaneGeometry(size * (0.8 + r() * 0.5), size * (0.8 + r() * 0.5));
    g.rotateX(r() * Math.PI); g.rotateY(r() * Math.PI); g.rotateZ(droop ? -droop : r() * Math.PI);
    g.translate(p.x, p.y, p.z);
    // Normals point out of the crown, so the foliage shades like a soft round mass.
    const n = g.attributes.normal, pos = g.attributes.position;
    for (let k = 0; k < n.count; k++) {
      const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(center).normalize();
      n.setXYZ(k, v.x, v.y * 1.2 + 0.2, v.z);
    }
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Tree models with their base at the origin: { trunk, leaves } geometries plus materials.
export function treeModels(kind, seed = 1) {
  if (kind === 'pine') {
    const trunk = new THREE.CylinderGeometry(0.16, 0.38, 11, 8).translate(0, 5.5, 0);
    const tiers = [];
    for (let i = 0; i < 7; i++) {
      const y = 3 + i * 1.25, rad = 2.6 - i * 0.33;
      tiers.push(crown(9, new THREE.Vector3(0, y, 0), rad, 0.55, 2.0 - i * 0.12, seed + i * 31, 0.35));
    }
    return { trunk, leaves: mergeGeometries(tiers), leafKind: 'pine' };
  }
  const parts = [new THREE.CylinderGeometry(0.22, 0.42, 6, 8).translate(0, 3, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const b = new THREE.CylinderGeometry(0.07, 0.14, 2.4, 6);
    b.rotateZ(0.8); b.rotateY(a); b.translate(Math.cos(a) * 0.7, 5 + i * 0.25, -Math.sin(a) * 0.7);
    parts.push(b);
  }
  const leaves = mergeGeometries([crown(30, new THREE.Vector3(0, 6.6, 0), 2.9, 2.3, 2.4, seed), crown(14, new THREE.Vector3(1.0, 5.6, 0.6), 1.8, 1.4, 1.9, seed + 5), crown(14, new THREE.Vector3(-1.1, 5.8, -0.5), 1.8, 1.5, 1.9, seed + 9)]);
  return { trunk: mergeGeometries(parts), leaves, leafKind: 'broad' };
}

export function treeMaterials(leafKind, tint) {
  const bark = realSurface(new THREE.MeshStandardMaterial({ color: leafKind === 'pine' ? '#5a4436' : '#5e4a3a', roughness: 0.95 }), { normal: 'bark', scale: 1.6, strength: 1.4, dirt: 0.25 });
  return { bark, leaves: leafMaterial(leafKind === 'pine' ? 'pine' : 'broad', tint), depth: leafDepthMaterial(leafKind === 'pine' ? 'pine' : 'broad') };
}

// A weathered boulder.
export function rockGeometry(seed = 3) {
  const g = new THREE.IcosahedronGeometry(1.4, 3);
  const pos = g.attributes.position;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const k = [r() * 10, r() * 10, r() * 10];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = Math.sin(v.x * 1.7 + k[0]) * Math.sin(v.y * 2.1 + k[1]) * Math.sin(v.z * 1.9 + k[2]);
    v.multiplyScalar(1 + n * 0.22 + Math.sin(v.x * 4.3 + v.z * 3.1) * 0.05);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
