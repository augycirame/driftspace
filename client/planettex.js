// Planet textures, generated on the GPU from 3D noise so they're seamless, sharp at any size,
// and quick to make. Produces a color map and a height (bump) map per planet.

import * as THREE from 'three';

export const NOISE_GLSL = `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * noise3(p); n += a; p = p * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}`;

const TYPE_ID = { Rocky: 0, Ice: 1, Gas: 2, Lava: 3, Ocean: 4, Jungle: 5, Desert: 6 };

const FRAG = `
precision highp float;
uniform vec3 base; uniform float seed; uniform int type; uniform int mode;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float lon = vUv.x * 6.2831853, lat = (1.0 - vUv.y) * 3.1415926;
  vec3 dir = vec3(cos(lon) * sin(lat), cos(lat), sin(lon) * sin(lat));
  vec3 p = dir * 2.2 + vec3(seed);
  float warp = fbm3(p * 1.3 + 4.0, 4);
  float h = fbm3(p + warp * 0.8, 7);
  float ridges = 1.0 - abs(fbm3(p * 3.0, 5) * 2.0 - 1.0);
  vec3 c;
  float height = h;
  if (type == 2) {                       // gas giant bands
    float band = sin(dir.y * 18.0 + warp * 7.0 + fbm3(p * 4.0, 4) * 2.0) * 0.5 + 0.5;
    float storm = smoothstep(0.78, 0.85, fbm3(p * 2.5 + 9.0, 4));
    c = base * (0.65 + band * 0.55) + vec3(0.25, 0.12, 0.05) * storm;
    height = band * 0.3;
  } else if (type == 4 || type == 5) {   // oceans with land, ice caps
    float land = smoothstep(0.5, 0.53, h);
    vec3 sea = mix(vec3(0.05, 0.16, 0.35), vec3(0.1, 0.35, 0.55), smoothstep(0.35, 0.5, h));
    vec3 ground = mix(base * 0.7, base * 1.25, ridges) * (type == 5 ? vec3(0.8, 1.1, 0.8) : vec3(1.0));
    c = mix(sea, ground, land);
    float cap = smoothstep(0.82, 0.9, abs(dir.y) + warp * 0.12);
    c = mix(c, vec3(0.92, 0.96, 1.0), cap);
    height = max(h, 0.5) + ridges * 0.1 * land;
  } else if (type == 3) {                // lava cracks
    float crack = smoothstep(0.08, 0.0, abs(fbm3(p * 2.5, 5) - 0.5));
    c = base * (0.18 + h * 0.3) + vec3(1.0, 0.4, 0.08) * crack * 1.6;
    height = h - crack * 0.2;
  } else if (type == 1) {                // ice
    c = mix(base * 0.8, vec3(0.97, 0.99, 1.0), smoothstep(0.4, 0.7, h)) + vec3(0.0, 0.05, 0.1) * ridges;
  } else if (type == 6) {                // desert dunes
    float dune = sin((dir.x + dir.z) * 40.0 + warp * 10.0) * 0.5 + 0.5;
    c = base * (0.75 + h * 0.4 + dune * 0.08);
    height = h + dune * 0.05;
  } else {                               // rocky with craters
    float crater = smoothstep(0.75, 0.8, fbm3(p * 5.0 + 2.0, 3));
    c = base * (0.5 + h * 0.8 + ridges * 0.15) * (1.0 - crater * 0.25);
    height = h + ridges * 0.2 - crater * 0.15;
  }
  gl_FragColor = mode == 0 ? vec4(c, 1.0) : vec4(vec3(height), 1.0);
}`;

let quad = null;
const cache = new Map();

function quadScene() {
  if (quad) return quad;
  const mat = new THREE.ShaderMaterial({
    uniforms: { base: { value: new THREE.Color() }, seed: { value: 0 }, type: { value: 0 }, mode: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  quad = { scene, mat, camera: new THREE.Camera() };
  return quad;
}

export function planetTextures(renderer, p, size = 512) {
  const key = `${p.id}@${size}`;
  let t = cache.get(key);
  if (t) return t;
  const q = quadScene();
  q.mat.uniforms.base.value.set(p.color).convertSRGBToLinear();
  q.mat.uniforms.seed.value = ((p.seed >>> 0) % 1000) * 0.37;
  q.mat.uniforms.type.value = TYPE_ID[p.type] ?? 0;
  const make = (mode) => {
    const rt = new THREE.WebGLRenderTarget(size, size / 2, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: mode === 0 ? THREE.LinearSRGBColorSpace : THREE.NoColorSpace });
    q.mat.uniforms.mode.value = mode;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(q.scene, q.camera);
    renderer.setRenderTarget(prev);
    rt.texture.wrapS = THREE.RepeatWrapping;
    return rt;
  };
  const color = make(0), height = make(1);
  t = { map: color.texture, bump: height.texture, targets: [color, height] };
  if (cache.size > 80) {
    const [k, old] = cache.entries().next().value;
    old.targets.forEach((rt) => rt.dispose());
    cache.delete(k);
  }
  cache.set(key, t);
  return t;
}

// A soft glowing atmosphere shell, brightest at the rim.
export function atmosphereMaterial(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 glow; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
        gl_FragColor = vec4(glow * rim * strength, rim * strength);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
}

// The space sky: drifting nebula clouds in the region's colors and a bright galactic band.
export function nebulaSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { colA: { value: new THREE.Color('#203060') }, colB: { value: new THREE.Color('#602050') }, seed: { value: 0 }, bright: { value: 1 }, anime: { value: 0 }, real: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float;
      uniform vec3 colA; uniform vec3 colB; uniform float seed; uniform float bright; uniform float anime; uniform float real;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 p = d * 2.0 + vec3(seed);
        float w = fbm3(p * 1.5, 4);
        float n = fbm3(p + w * 1.4, 6);
        float clouds = smoothstep(0.45, 0.8, n);
        // Anime: clouds painted in flat bands, a bit brighter and more saturated.
        if (anime > 0.5) clouds = floor(clouds * 4.0 + 0.3) / 4.0 * 1.05;
        float band = exp(-pow(d.y * 3.2 + (w - 0.5) * 0.8, 2.0));
        vec3 c = mix(colA, colB, smoothstep(0.3, 0.7, fbm3(p * 0.7 + 3.0, 3))) * clouds * 0.38;
        c += vec3(0.55, 0.6, 0.75) * band * 0.06 * (0.6 + n);
        float dust = smoothstep(0.62, 0.75, fbm3(p * 3.0 + 7.0, 4)) * band;
        c -= dust * 0.05;
        // Realistic: faint nebulae, the Milky Way as a glow of unresolved stars split by dark dust
        // lanes, and countless faint stars of every color.
        if (real > 0.5) {
          c = max(c, 0.0) * 0.07;
          vec3 gal = normalize(vec3(0.25, 0.92, 0.3));
          float gd = dot(d, gal) + (w - 0.5) * 0.12;
          float mw = exp(-gd * gd * 22.0);
          float core = exp(-pow(length(d - normalize(vec3(0.9, -0.2, 0.4))), 2.0) * 3.0);
          float grain = fbm3(d * 60.0 + seed, 3);
          float clump = fbm3(d * 7.0 + seed * 0.7, 5);
          vec3 mwc = mix(vec3(0.62, 0.66, 0.8), vec3(0.95, 0.82, 0.62), core) * (0.012 + 0.03 * core) * (0.45 + clump * 0.8 + grain * 0.4);
          float lane = smoothstep(0.5, 0.7, fbm3(d * 11.0 + vec3(seed * 1.3), 5)) * smoothstep(0.0, 0.06, 0.12 - abs(gd));
          c += mwc * mw * (1.0 - lane * 0.9);
          vec3 q = d * 700.0;
          vec3 cell = floor(q);
          float h = hash3(cell);
          float density = 0.993 - mw * 0.02;
          if (h > density) {
            vec3 sp = cell + vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3));
            float r = length(q - sp);
            float mag = pow((h - density) / (1.0 - density), 3.0);
            float t = hash3(cell + 9.1);
            vec3 sc = t < 0.15 ? vec3(1.0, 0.75, 0.55) : t < 0.35 ? vec3(1.0, 0.92, 0.8) : t < 0.8 ? vec3(0.95, 0.97, 1.0) : vec3(0.7, 0.8, 1.0);
            c += sc * exp(-r * r * 9.0) * (0.03 + mag * 1.6);
          }
        }
        gl_FragColor = vec4(max(c, 0.0) * bright, 1.0);
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}
