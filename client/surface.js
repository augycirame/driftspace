// The 3D planet-surface scene: diggable terrain, liquids, flora, ore deposits, Haven Landing,
// precursor relics, player structures, other pilots, creatures, and parked ships.

import * as THREE from 'three';
import { findPlanet } from '/shared/universe.js';
import {
  CELL, VERTS, SURFACE_HALF, SETTLEMENT, profileOf, vertexHeight, heightAt, standHeight, deposits, floraFor, structuresOf, structureBase,
} from '/shared/planet.js';
import { ORES, BLOCKS, SURFACE_GRID } from '/shared/rules.js';
import { PLAYER_SPEED, RUN_SPEED } from '/shared/items.js';
import { buildShip, buildPerson, buildCreature, buildStructure, buildNative, buildWerewolf, buildMech, label, healthBar, setHealth, glowSprite } from './meshes.js';
import { RANKS } from '/shared/guild.js';
import { townsOf, townFootprints, insideFootprint, sunAt, weatherAt, weatherInfo } from '/shared/towns.js';
import { buildTown, realmColor } from './towns.js';
import { gravityOf, spireOf, SPIRE_RADIUS } from '/shared/planet.js';
import { realism, physicalSky, skyColors, SkyEnvironment, terrainMaterial, waterMaterial, GrassField, treeModels, treeMaterials, rockGeometry, realSurface, realBlock } from './realism.js';
import { climateOf } from '/shared/towns.js';
import { CREATURES } from '/shared/content/creatures.js';
import { STRUCTURES } from '/shared/content/structures.js';
import { GODS } from '/shared/content/factions.js';
import { ALIEN_RACES } from '/shared/content/aliens.js';
import { DUNGEON_THEMES } from '/shared/content/dungeons.js';
import { FX } from './fx.js';
import { NOISE_GLSL } from './planettex.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Tiling textures shared by every planet: fine ground detail and rippling water.
let detail = null;
function detailTextures() {
  if (detail) return detail;
  const N = 256, h = new Float32Array(N * N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Sum a few octaves of smoothed random grids, wrapping at the edges so the texture tiles.
  for (const [cells, amp] of [[8, 0.5], [16, 0.25], [32, 0.15], [64, 0.1]]) {
    const g = Array.from({ length: cells * cells }, rnd);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, fy = (y / N) * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const at = (i, j) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      h[y * N + x] += amp * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
    }
  }
  const mk = (fn) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const [r, g, b] = fn(i); img.data.set([r, g, b, 255], i * 4); }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const normal = mk((i) => {
    const x = i % N, y = (i - x) / N;
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 6, ny = -dy * 6, l = Math.hypot(nx, ny, 1);
    return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
  const color = mk((i) => { const v = 205 + h[i] * 50; return [v, v, v]; });
  color.colorSpace = THREE.SRGBColorSpace;
  detail = { normal, color };
  return detail;
}

// A sky dome: horizon haze fading up to a deeper zenith, with the sun's disk.
function skyDome(prof, sunDir, anime = false, soft = false) {
  const zenith = new THREE.Color(prof.sky).lerp(new THREE.Color(soft ? '#4f9ee6' : anime ? '#1f5fe0' : '#1a3a7a'), soft ? 0.6 : anime ? 0.65 : 0.35);
  const mat = new THREE.ShaderMaterial({
    uniforms: { horizon: { value: new THREE.Color(prof.fog).lerp(new THREE.Color('#e8f6ff'), anime ? 0.45 : 0) }, zenith: { value: zenith }, sunDir: { value: sunDir.clone().normalize() }, anime: { value: anime ? 1 : 0 }, soft: { value: soft ? 1 : 0 }, time: { value: 0 }, day: { value: 1 }, gloom: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform float anime; uniform float soft; uniform float time; uniform float day; uniform float gloom; varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.6));
        float s = max(dot(d, sunDir), 0.0);
        if (anime > 0.5) {
          // Anime sky, painted like a film background: a deep gradient, a crisp sun with a halo,
          // towering cloud banks on the horizon, big sunlit cumulus and thin high streaks.
          c = mix(horizon, zenith, smoothstep(0.0, 0.75, pow(h, 0.7)));
          c += vec3(1.0, 0.97, 0.85) * (step(0.9993, s) * 2.0 + pow(s, 24.0) * 0.35 + step(0.985, s) * step(s, 0.9875) * 0.25);
          float az = atan(d.z, d.x);
          vec3 lit = vec3(1.0, 0.99, 0.96), mid = mix(vec3(0.86, 0.88, 0.98), vec3(0.86, 0.9, 0.95), soft), dark = mix(vec3(0.66, 0.66, 0.86), vec3(0.68, 0.75, 0.86), soft);
          float sw = 1.0 + soft * 5.0;  // painted style: softer, brushier cloud edges
          float toward = dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))) * 0.5 + 0.5;
          // Horizon towers.
          float top = 0.1 + 0.32 * pow(fbm3(vec3(az * 2.2, 1.0, 9.0), 5), 1.6) * smoothstep(0.25, 0.75, fbm3(vec3(az * 0.7, 2.0, 4.0), 3));
          float tower = smoothstep(top + 0.004 * sw, top - 0.004 * sw, d.y) * smoothstep(-0.02, 0.03, d.y);
          float tshade = fbm3(vec3(az * 6.0, d.y * 14.0, 5.0), 4);
          vec3 tc = mix(dark, mid, smoothstep(0.44 - 0.02 * sw, 0.44 + 0.02 * sw, tshade + (d.y / max(top, 0.01)) * 0.25));
          tc = mix(tc, lit, smoothstep(0.64 - 0.02 * sw, 0.64 + 0.02 * sw, tshade + toward * 0.35 + (d.y / max(top, 0.01)) * 0.2));
          c = mix(c, mix(tc, horizon, 0.25 + soft * 0.2), tower);
          // Cumulus overhead.
          vec2 uv = d.xz / (d.y + 0.18) * 2.2 + vec2(time * 0.01, 0.0);
          float n = fbm3(vec3(uv, 3.0), 5) + (fbm3(vec3(uv * 0.25, 1.0), 3) - 0.5) * 0.5;
          float cloud = smoothstep(0.55 - 0.012 * sw, 0.55 + 0.03 * sw, n) * smoothstep(0.08, 0.2, d.y);
          float body = fbm3(vec3(uv * 2.0 + 0.05, 3.0), 4) + (n - 0.55) * 1.5;
          vec3 cc = mix(dark, mid, smoothstep(0.48 - 0.02 * sw, 0.48 + 0.02 * sw, body));
          cc = mix(cc, lit, smoothstep(0.6 - 0.02 * sw, 0.6 + 0.02 * sw, body + toward * 0.15));
          float edge = smoothstep(0.55, 0.58, n) - smoothstep(0.58, 0.62, n);
          cc = mix(cc, lit, edge * 0.8);
          c = mix(c, cc, cloud);
          // Cirrus streaks high up.
          float cir = smoothstep(0.64, 0.74, fbm3(vec3(uv.x * 1.2 + uv.y * 0.6, uv.y * 7.0, 8.0), 4)) * smoothstep(0.3, 0.6, d.y) * (1.0 - cloud);
          c = mix(c, vec3(1.0), cir * 0.25);
        } else {
          c += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 4.0 + pow(s, 12.0) * 0.25);
        }
        // Weather greys the sky; evening reddens the horizon; night brings stars and a moon.
        float lum = dot(c, vec3(0.3, 0.55, 0.15));
        c = mix(c, vec3(lum * 0.85 + 0.05), gloom * 0.85);
        float sunset = smoothstep(0.35, 0.0, abs(sunDir.y)) * day;
        vec3 sflat = normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-4);
        c += vec3(1.0, 0.42, 0.18) * sunset * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), sflat), 0.0), 3.0) * (1.0 - h) * 0.55;
        vec3 night = mix(vec3(0.06, 0.09, 0.2), vec3(0.015, 0.025, 0.08), pow(h, 0.5)) + c * 0.07;
        float star = step(0.9965, hash3(floor(d * 260.0))) * (0.6 + 0.4 * sin(time * 2.0 + hash3(floor(d * 260.0) + 3.0) * 30.0)) * smoothstep(0.02, 0.2, d.y);
        float moon = smoothstep(0.9985, 0.9991, dot(d, -sunDir)) + pow(max(dot(d, -sunDir), 0.0), 60.0) * 0.25;
        night += vec3(0.85, 0.9, 1.0) * (star * (1.0 - gloom) + moon * 0.9);
        c = mix(night, c, day);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), mat);
  m.renderOrder = -1000;
  m.frustumCulled = false;
  return m;
}

// Anime ambience: things drifting in the air around the pilot. Cherry petals on green worlds,
// snow on ice, embers over lava and sunlit motes everywhere else.
function driftTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (kind === 'petal') {
    x.translate(32, 32); x.rotate(0.6);
    x.fillStyle = '#ffc4d6';
    x.beginPath(); x.ellipse(0, 0, 12, 22, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ff9ab8';
    x.beginPath(); x.ellipse(0, 6, 6, 12, 0, 0, Math.PI * 2); x.fill();
  } else {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(kind === 'snow' ? 0.5 : 0.2, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function animeDrift(planet, style) {
  const lush = style === 'chibi' ? planet.starter || planet.holy || planet.type === 'Jungle' || planet.type === 'Ocean' : planet.holy;
  const kind = planet.type === 'Ice' ? 'snow' : planet.type === 'Lava' ? 'ember' : lush ? 'petal' : 'mote';
  const n = kind === 'snow' ? 500 : 260, box = 70;
  const base = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) base[i] = Math.random() * box;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = { petal: '#ffffff', snow: '#ffffff', ember: '#ffa040', mote: '#fff2b0' }[kind];
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: driftTexture(kind), color, size: kind === 'petal' ? 0.45 : kind === 'snow' ? 0.35 : style === 'anime' ? 0.12 : 0.22,
    transparent: true, depthWrite: false, opacity: kind === 'mote' ? 0.7 : 0.95, blending: kind === 'ember' ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false;
  const wind = { petal: [1.6, -0.6, 0.7], snow: [0.4, -1.4, 0.2], ember: [0.3, 1.2, 0.2], mote: [0.3, 0.1, 0.2] }[kind];
  pts.userData.update = (t, cam) => {
    for (let i = 0; i < n; i++) {
      const j = i * 3, w = Math.sin(t * 0.8 + i) * 1.2;
      for (let k = 0; k < 3; k++) {
        const v = base[j + k] + wind[k] * t + (k === 0 ? w : k === 2 ? Math.cos(t * 0.7 + i) : 0);
        const c0 = k === 0 ? cam.x : k === 1 ? cam.y : cam.z;
        pos[j + k] = c0 + ((((v - c0) % box) + box * 1.5) % box) - box / 2;
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}

const HALF_V = (VERTS - 1) / 2;
const blockGeo = new THREE.BoxGeometry(SURFACE_GRID, SURFACE_GRID, SURFACE_GRID);
// Furniture and gadgets get their own shapes; everything else is a cube.
const G = SURFACE_GRID;
const part = (geo, color, x = 0, y = 0, z = 0, glow = false) => {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: glow ? color : '#000000', emissiveIntensity: glow ? 0.8 : 0 }));
  m.position.set(x, y, z);
  return m;
};
const SPECIAL_BLOCKS = {
  door: () => { const g = new THREE.Group(); g.add(part(new THREE.BoxGeometry(G, G, G * 0.18), '#6a4a2a')); g.add(part(new THREE.SphereGeometry(0.08, 8, 6), '#d8b048', G * 0.3, 0, G * 0.12)); return g; },
  bed: () => { const g = new THREE.Group(); g.add(part(new THREE.BoxGeometry(G * 0.9, G * 0.3, G * 0.95), '#7a5a3a', 0, -G * 0.35, 0)); g.add(part(new THREE.BoxGeometry(G * 0.85, G * 0.12, G * 0.9), '#b84a4a', 0, -G * 0.15, 0.02)); g.add(part(new THREE.BoxGeometry(G * 0.5, G * 0.1, G * 0.25), '#f0ead8', 0, -G * 0.07, -G * 0.3)); return g; },
  chest: () => { const g = new THREE.Group(); g.add(part(new THREE.BoxGeometry(G * 0.8, G * 0.5, G * 0.55), '#9a7038', 0, -G * 0.25, 0)); g.add(part(new THREE.BoxGeometry(G * 0.84, G * 0.08, G * 0.6), '#5a4a3a', 0, 0.02, 0)); g.add(part(new THREE.BoxGeometry(0.12, 0.16, 0.05), '#d8b048', 0, -G * 0.1, G * 0.29)); return g; },
  bench: () => { const g = new THREE.Group(); g.add(part(new THREE.BoxGeometry(G * 0.95, G * 0.12, G * 0.6), '#7a5a3a', 0, -G * 0.08, 0)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.1, G * 0.4, 0.1), '#5a4030', sx * G * 0.4, -G * 0.32, sz * G * 0.24)); g.add(part(new THREE.BoxGeometry(0.3, 0.2, 0.2), '#4a4a50', -G * 0.2, G * 0.05, 0)); return g; },
  turret: () => { const g = new THREE.Group(); g.add(part(new THREE.CylinderGeometry(G * 0.4, G * 0.48, G * 0.5, 10), '#4a5260', 0, -G * 0.25, 0)); g.add(part(new THREE.SphereGeometry(G * 0.28, 12, 10), '#5a6270', 0, G * 0.1, 0)); g.add(part(new THREE.CylinderGeometry(0.08, 0.1, G * 0.7, 8).rotateX(Math.PI / 2), '#2e3238', 0, G * 0.12, -G * 0.35)); g.add(part(new THREE.SphereGeometry(0.07, 6, 4), '#ff6a4a', 0, G * 0.32, 0, true)); return g; },
  banner: () => { const g = new THREE.Group(); g.add(part(new THREE.CylinderGeometry(0.06, 0.06, G * 2.4, 6), '#5a4030', 0, G * 0.7, 0)); g.add(part(new THREE.BoxGeometry(G * 0.6, G * 0.9, 0.04), '#e8c547', G * 0.32, G * 1.3, 0)); return g; },
};
const blockMats = {};
function blockMat(id) {
  if (!blockMats[id]) {
    const d = BLOCKS[id];
    blockMats[id] = new THREE.MeshStandardMaterial({
      color: d.color, roughness: 0.6, metalness: 0.2, transparent: !!d.transparent, opacity: d.transparent ? 0.5 : 1,
      emissive: d.glow ? d.color : '#000000', emissiveIntensity: d.glow ? 0.8 : 0,
    });
    if (d.stone) blockMats[id].userData.stone = 2.2;
    realBlock(blockMats[id], id);
  }
  return blockMats[id];
}

export class SurfaceView {
  constructor(state) {
    this.S = state;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2000);
    this.fx = new FX(this.scene);
    this.planetId = null;
    this.yaw = 0;
    this.pitch = -0.32;
    this.firstPerson = false;
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.others = new Map();
    this.creatures = new Map();
    this.parked = new Map();
  }

  // ---- building the scene -----------------------------------------------------------------

  enter(pid, data) {
    this.leave();
    const planet = findPlanet(pid, this.S.seed);
    this.planet = planet;
    this.planetId = pid;
    this.data = data;   // { digs, blocks, deposits, looted }
    this.looted = new Set(data.looted || []);
    const prof = profileOf(planet);
    const sc = this.scene;
    sc.background = new THREE.Color(prof.sky);
    sc.fog = new THREE.Fog(prof.fog, 120, 650);

    this.root = new THREE.Group();
    sc.add(this.root);
    const q = this.S.gfx?.q || {};
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    this.sunDir = new THREE.Vector3(200, 300, 120).normalize();
    sun.position.copy(this.sunDir).multiplyScalar(300);
    if (q.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      const c = sun.shadow.camera;
      c.left = c.bottom = -90; c.right = c.top = 90; c.near = 10; c.far = 700;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.6;
    }
    this.root.add(sun, sun.target);
    this.sun = sun;
    const anime = !!this.S.gfx?.anime;
    const soft = this.S.gfx?.style === 'anime';
    this.realSky = null;
    const real = realism();
    if (real) {
      // A physically based sky, which also lights the scene through image-based lighting.
      const climate = climateOf(planet);
      const earthLike = planet.starter || planet.holy || prof.tags.some((t) => ['temperate', 'forest', 'water'].includes(t));
      this.turbidity = climate === 'arid' || climate === 'scorching' ? 7 : climate === 'humid' ? 5 : 3.2;
      this.realSky = physicalSky({ skyColor: prof.sky, earthLike, turbidity: this.turbidity });
      this.sky = this.realSky;
      this.root.add(this.sky);
      sc.fog = new THREE.FogExp2('#b8c8d8', 0.0012);
      this.env = this.S.gfx ? new SkyEnvironment(this.S.gfx.renderer) : null;
      this.env?.setSky(this.realSky);
      sun.intensity = 9;
      if (q.shadows) {
        sun.shadow.radius = 5;
        sun.shadow.blurSamples = 12;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.35;
      }
    } else if (q.sky || anime) { this.sky = skyDome(prof, this.sunDir, anime, soft); this.root.add(this.sky); } else this.sky = null;
    if (anime) sc.fog = new THREE.Fog(new THREE.Color(prof.fog).lerp(new THREE.Color(soft ? '#dfeaf2' : '#e8f6ff'), 0.45), 160, 700);
    this.hemi = new THREE.HemisphereLight(prof.sky, prof.low, 1.1);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.25);
    this.moon = new THREE.DirectionalLight('#9ab8ff', 0);
    this.root.add(this.hemi, this.ambient, this.moon, this.moon.target);
    this.sunGlow = glowSprite('#fff8e0', 260, 0.9);
    this.sunGlow.visible = !real;
    this.root.add(this.sunGlow);
    if (real) { this.hemi.intensity = 0.15; this.ambient.intensity = 0; }
    this.fogColor = sc.fog.color.clone();
    this.fogFar = sc.fog.far;
    this.baseSky = sc.background.clone();
    this.sunPower = sun.intensity;
    this.flashT = 0;

    this.buildTerrain(prof);
    if (prof.water != null && real) {
      const geo = new THREE.PlaneGeometry(SURFACE_HALF * 2.4, SURFACE_HALF * 2.4, 1, 1).rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 90, uv.getY(i) * 90);
      const liquid = new THREE.Mesh(geo, waterMaterial(prof.liquid, planet.type === 'Lava'));
      liquid.position.y = prof.water;
      liquid.userData.noCast = true;
      this.liquid = liquid;
      this.root.add(liquid);
    } else if (prof.water != null) {
      const waterNormal = detailTextures().normal.clone();
      waterNormal.repeat.set(60, 60);
      waterNormal.needsUpdate = true;
      const liquid = new THREE.Mesh(new THREE.PlaneGeometry(SURFACE_HALF * 2.4, SURFACE_HALF * 2.4).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: prof.liquid, transparent: true, opacity: planet.type === 'Lava' ? 0.95 : 0.78, roughness: 0.08, metalness: 0.25,
          normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6),
          emissive: planet.type === 'Lava' ? prof.liquid : '#000000', emissiveIntensity: planet.type === 'Lava' ? 0.9 : 0 }));
      liquid.position.y = prof.water;
      liquid.receiveShadow = true;
      liquid.userData.noCast = true;
      this.liquid = liquid;
      this.root.add(liquid);
    }
    this.buildFlora(prof);
    this.grass = null;
    const grassy = prof.tags.some((t) => ['temperate', 'forest', 'holy', 'water'].includes(t)) || planet.starter;
    const dryGrass = !grassy && prof.tags.includes('sand') && !prof.tags.includes('salt');
    if (real && (q.flora || 0) >= 1 && (grassy || dryGrass)) {
      const n = dryGrass ? 0.25 : 1;
      this.grass = new GrassField({ count: Math.round((q.flora >= 2 ? 170000 : q.flora >= 1.5 ? 110000 : 60000) * n), radius: q.flora >= 2 ? 48 : q.flora >= 1.5 ? 40 : 32, half: SURFACE_HALF, verts: VERTS, cell: CELL, water: prof.water, dry: dryGrass });
      this.grass.syncTerrain(this.terrainGeo);
      this.root.add(this.grass.mesh);
    }
    this.drift = anime ? animeDrift(planet, this.S.gfx.style) : null;
    if (this.drift) this.root.add(this.drift);
    this.buildDeposits();
    if (planet.starter) { this.buildSettlement(); this.buildSpire(); }
    this.buildRelic();
    this.buildStructures();
    this.buildTowns();
    this.gravity = gravityOf(planet);
    this.blocks = new THREE.Group();
    this.root.add(this.blocks);
    for (const [cell, blk] of Object.entries(data.blocks)) this.addBlock(cell, blk);

    this.digMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.8, depthTest: false }));
    this.digMarker.renderOrder = 5;
    this.root.add(this.digMarker);
    const me = this.S.you;
    this.selfWeapon = this.weaponOf(me);
    this.selfMesh = buildPerson(me.color, me.armor?.armor || 0, this.selfWeapon);
    this.root.add(this.selfMesh);
    this.vel.set(0, 0, 0);
  }

  leave() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => {
        if (o.geometry && o.geometry !== blockGeo) o.geometry.dispose();
        if (o.material && !Object.values(blockMats).includes(o.material)) o.material.dispose?.();
      });
    }
    this.root = null;
    for (const m of [this.others, this.creatures, this.parked]) m.clear();
    this.fx.clear();
    this.env?.dispose(); this.env = null; this.realSky = null; this.grass = null;
    this.scene.environment = null;
    this.precip = null; this.precipKind = null; this.towns = []; this.footprints = []; this.wardMesh = null;
    this.dayLevel = this.lightLevel = this.fogLevel = null;
    this.planetId = null;
  }

  buildTerrain(prof) {
    const n = VERTS;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const idx = [];
    this.lowC = new THREE.Color(prof.low); this.midC = new THREE.Color(prof.mid); this.highC = new THREE.Color(prof.high);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = (j * n + i) * 3;
        pos[o] = (i - HALF_V) * CELL; pos[o + 2] = (j - HALF_V) * CELL;
        pos[o + 1] = vertexHeight(this.planet, i - HALF_V, j - HALF_V, this.data.digs);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrainGeo = g;
    for (let k = 0; k < n * n; k++) this.colorVertex(k);
    const uv = new Float32Array(n * n * 2);
    for (let k = 0; k < n * n; k++) { uv[k * 2] = pos[k * 3] / 9; uv[k * 2 + 1] = pos[k * 3 + 2] / 9; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const dt = detailTextures();
    let mat;
    if (realism()) {
      const climate = climateOf(this.planet);
      const rock = new THREE.Color(prof.mid).lerp(new THREE.Color('#77716a'), 0.6).multiplyScalar(0.85);
      const sand = new THREE.Color(prof.low).lerp(new THREE.Color('#cdb88e'), 0.7);
      const cold = climate === 'frozen' || climate === 'cold';
      mat = terrainMaterial({ rock: '#' + rock.getHexString(), sand: '#' + sand.getHexString(), water: prof.water, snowLine: cold ? (prof.water ?? 0) + prof.amp * 0.45 : 9999, dry: climate === 'arid' || climate === 'scorching' });
    } else mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: dt.color, normalMap: dt.normal, normalScale: new THREE.Vector2(0.8, 0.8) });
    this.terrain = new THREE.Mesh(g, mat);
    this.terrain.material.userData.paint = 1.15;
    this.terrain.receiveShadow = true;
    this.terrain.userData.noCast = true;
    this.root.add(this.terrain);
  }

  colorVertex(k) {
    const g = this.terrainGeo, pos = g.attributes.position, col = g.attributes.color, nrm = g.attributes.normal;
    const h = pos.getY(k);
    const prof = profileOf(this.planet);
    const lo = (prof.water ?? -10) + 1;
    const t = Math.max(0, Math.min(1, (h - lo) / (prof.amp * 0.9)));
    const c = t < 0.5 ? this.lowC.clone().lerp(this.midC, t * 2) : this.midC.clone().lerp(this.highC, (t - 0.5) * 2);
    const slope = nrm ? 1 - nrm.getY(k) : 0;
    c.multiplyScalar(1 - Math.min(0.45, slope * 1.2));
    const ix = (k % VERTS) - HALF_V, iz = Math.floor(k / VERTS) - HALF_V;
    if ((this.data.digs[`${ix},${iz}`] || 0) < -0.5) c.lerp(new THREE.Color('#3a2a1e'), 0.5);
    // Inside towns the ground is trodden earth (no grass grows on it; cities are paved over it).
    this.townRings ||= townsOf(this.planet).map((t) => [t.x, t.z, t.radius + 4]);
    const wx = pos.getX(k), wz = pos.getZ(k);
    for (const [tx, tz, tr] of this.townRings) {
      const dd = Math.hypot(wx - tx, wz - tz);
      if (dd < tr + 6) c.lerp(new THREE.Color('#7a6a54'), Math.min(1, (tr + 6 - dd) / 6) * 0.85);
    }
    col.setXYZ(k, c.r, c.g, c.b);
  }

  applyDig(key, d) {
    this.data.digs[key] = d;
    const [ix, iz] = key.split(',').map(Number);
    const i = ix + HALF_V, j = iz + HALF_V;
    if (i < 0 || j < 0 || i >= VERTS || j >= VERTS) return;
    const k = j * VERTS + i;
    this.terrainGeo.attributes.position.setY(k, vertexHeight(this.planet, ix, iz, this.data.digs));
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const kk = (j + dj) * VERTS + (i + di);
      if (kk >= 0 && kk < VERTS * VERTS) this.colorVertex(kk);
    }
    this.terrainGeo.attributes.color.needsUpdate = true;
    this.grass?.syncTerrain(this.terrainGeo);
  }

  buildFlora(prof) {
    const items = [];
    const tiles = Math.ceil(SURFACE_HALF / 40);
    for (let tx = -tiles; tx < tiles; tx++) for (let tz = -tiles; tz < tiles; tz++) items.push(...floraFor(this.planet, tx, tz));
    // Higher quality settings grow more plants (shifted copies); low thins them out.
    const density = this.S.gfx?.q.flora ?? 1;
    if (density < 1) items.splice(0, items.length, ...items.filter((_, i) => i % 2 === 0));
    const base = items.slice();
    for (let k = 1; k < density; k += 0.5) {
      for (const f of base) {
        const x = f.x + 13.7 * k + (f.v - 0.5) * 9, z = f.z - 17.3 * k + (f.r - 3) * 2;
        if (Math.max(Math.abs(x), Math.abs(z)) > SURFACE_HALF - 30 || Math.hypot(x, z) < (this.planet.starter ? 80 : 45)) continue;
        if (structuresOf(this.planet).some((st) => Math.hypot(st.x - x, st.z - z) < st.radius + 5)) continue;
        items.push({ ...f, x, z, s: f.s * (0.8 + f.v * 0.4), r: f.r + k });
      }
    }
    const place = (geo, mat, list, yOff, sy = 1) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      list.forEach((f, i) => {
        const y = heightAt(this.planet, f.x, f.z, this.data.digs);
        p.set(f.x, y + yOff * f.s, f.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.r);
        s.set(f.s, f.s * sy, f.s);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
      });
      this.root.add(im);
      return im;
    };
    const water = prof.water ?? -999;
    const dry = items.filter((f) => heightAt(this.planet, f.x, f.z, this.data.digs) > water + 0.5);
    const wet = items.filter((f) => heightAt(this.planet, f.x, f.z, this.data.digs) <= water + 0.5);
    const of = (kind, list = dry) => list.filter((f) => f.kind === kind);
    const real = realism();
    const M = (opts, detail = { normal: 'rough', scale: 1.2 }) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: !real, ...opts });
      return real ? realSurface(m, detail) : m;
    };
    const trunk = M({ color: '#5a4030', roughness: 1 });
    const anime = !!this.S.gfx?.anime;
    const leafColor = anime ? (this.planet.holy ? '#8ad06a' : this.planet.starter ? '#4cc46a' : '#3a9a4a') : this.planet.holy ? '#6aaa4a' : this.planet.starter ? '#3aaa6a' : '#2f7a3a';
    place(new THREE.CylinderGeometry(0.25, 0.4, 5, 6), trunk, of('tree'), 2.5);
    const puff = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 2).translate(x, y, z);
    const crown = () => mergeGeometries([puff(1.9, 0, 0, 0), puff(1.4, 1.3, -0.4, 0.4), puff(1.4, -1.2, -0.3, -0.5), puff(1.3, 0.2, 1.2, -0.2), puff(1.2, -0.3, -0.6, 1.3)]);
    if (real) {
      // Realistic trees: bark trunks and branches under crowns of leaf clusters; pines on cold
      // and wooded worlds.
      const climate = climateOf(this.planet);
      const pineShare = climate === 'frozen' || climate === 'cold' ? 1 : prof.tags.includes('forest') ? 0.55 : 0.3;
      const trees = of('tree');
      const tint = this.planet.holy ? '#eaffd8' : climate === 'humid' ? '#d8f0c8' : '#ffffff';
      for (const [list, kind, seed] of [[trees.filter((f) => f.v >= pineShare), 'broad', 3], [trees.filter((f) => f.v < pineShare), 'pine', 7]]) {
        if (!list.length) continue;
        const model = treeModels(kind, seed), mats = treeMaterials(model.leafKind, tint);
        place(model.trunk, mats.bark, list, -0.15);
        const leaves = place(model.leaves, mats.leaves, list, -0.15);
        leaves.customDepthMaterial = mats.depth;
      }
    } else if (this.S.gfx?.style === 'anime') {
      // Painted-background trees in muted greens: tall layered pines mixed with leafy crowns.
      const trees = of('tree'), pines = trees.filter((_, i) => i % 3 !== 0), leafy = trees.filter((_, i) => i % 3 === 0);
      const cold = this.planet.type === 'Ice';
      const pine = mergeGeometries([0, 1, 2, 3].map((i) => new THREE.ConeGeometry(2.3 - i * 0.45, 2.8, 9).translate(0, i * 1.7, 0)));
      place(new THREE.CylinderGeometry(0.2, 0.32, 5, 6), trunk, pines, 2.5);
      place(pine, new THREE.MeshStandardMaterial({ color: cold ? '#9ab0a8' : '#47684e', roughness: 0.9 }), pines, 3.9);
      place(crown(), new THREE.MeshStandardMaterial({ color: this.planet.holy ? '#8aa86a' : '#5f8650', roughness: 0.9 }), leafy, 5.8);
    } else if (anime) {
      // Chibi trees: soft, puffy clusters of foliage.
      place(crown(), new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 }), of('tree'), 5.8);
    } else {
      place(new THREE.IcosahedronGeometry(2.4, 0), M({ color: leafColor }), of('tree'), 5.8);
    }
    place(new THREE.CylinderGeometry(0.2, 0.3, 7, 6), trunk, of('palm'), 3.5);
    place(new THREE.ConeGeometry(2.6, 1.2, 7), M({ color: '#3a9a4a' }), of('palm'), 7.2);
    { const rockMat = M({ color: real ? new THREE.Color(prof.mid).lerp(new THREE.Color('#7a756e'), 0.55) : prof.mid, roughness: 1 }, { normal: 'rock', scale: 0.35, strength: 1.4, dirt: 0.3 }); rockMat.userData.stone = 1.2; place(real ? rockGeometry(5) : new THREE.DodecahedronGeometry(1.4, 0), rockMat, of('rock'), real ? 0.35 : 0.6, 0.7); }
    place(new THREE.ConeGeometry(0.8, 5, 5), M({ color: '#cfefff', roughness: 0.2, transparent: true, opacity: 0.85 }), of('spike'), 2.4);
    place(new THREE.CylinderGeometry(0.45, 0.5, 3.4, 8), M({ color: '#4a7a3a' }), of('cactus'), 1.7);
    place(new THREE.CylinderGeometry(0.35, 0.5, 4, 8), M({ color: '#d8c8e8' }), of('mushroom'), 2);
    place(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), M({ color: '#9a5ad8', emissive: '#6a2aa8', emissiveIntensity: 0.5 }), of('mushroom'), 3.9);
    place(new THREE.OctahedronGeometry(1, 0).scale(0.6, 2.4, 0.6), M({ color: '#c8b8ff', emissive: '#8a6aff', emissiveIntensity: 0.5, roughness: 0.2, transparent: true, opacity: 0.9 }), of('crystal'), 2.2);
    place(new THREE.TorusGeometry(2.4, 0.25, 6, 12, Math.PI).rotateY(Math.PI / 2), M({ color: '#e8dcc8' }), of('bone'), 0.2);
    place(new THREE.CylinderGeometry(0.08, 0.1, 3, 4), M({ color: '#6a8a3a' }), [...of('reed'), ...of('reed', wet)], 1.3);
    place(new THREE.CylinderGeometry(0.15, 0.35, 5, 5), M({ color: '#3a3430', roughness: 1 }), of('deadtree'), 2.4);
    place(new THREE.IcosahedronGeometry(1.1, 0).scale(1, 1.6, 1), M({ color: '#ff8a9a', emissive: '#a03a5a', emissiveIntensity: 0.3 }), [...of('coral'), ...of('coral', wet)], 0.6);
  }

  // Ruins, shrines, faction bases and wrecks from the content library.
  buildStructures() {
    this.structures = [];
    for (const st of structuresOf(this.planet)) {
      const def = STRUCTURES[st.type];
      const god = st.god ? GODS[st.god] : null;
      const race = st.race ? ALIEN_RACES[st.race] : null;
      const mesh = buildStructure(def, god?.color, race);
      mesh.position.set(st.x, structureBase(this.planet, st), st.z);
      mesh.rotation.y = st.rot;
      const top = Math.max(...def.parts.map((p) => p[2] + (p[0] === 'box' || p[0] === 'cyl' || p[0] === 'cone' ? (p[5] || 0) / 2 : p[4] || 0)));
      const title = god ? `${def.name}: ${god.name.split(',')[0]}` : race ? `${race.name} village` : def.kind === 'dungeon' ? `${def.name} · ${DUNGEON_THEMES[def.dungeon].name}` : def.name;
      const color = god ? god.color : race ? race.color : def.kind === 'dungeon' ? DUNGEON_THEMES[def.dungeon].light : def.kind === 'imperial' || def.kind === 'holy' ? '#ffe08a' : def.kind === 'rebel' ? '#ff9a7a' : '#d9c8ff';
      const lb = label(title, color, 0.85);
      lb.position.y = top + 4;
      mesh.add(lb);
      this.root.add(mesh);
      this.structures.push({ st, def, mesh });
    }
  }

  // A pilot in their current form: on foot, as a wolf, or in a mech.
  weaponOf(you) {
    const w = you?.inv?.items?.find((i) => i.id === you.inv.equipped?.weapon);
    return w?.type || null;
  }

  formMesh(color, armor, wolf, mech, weapon = null) {
    if (mech) return buildMech(color, mech);
    if (wolf) return buildWerewolf('#5a4a3a');
    return buildPerson(color, armor || 0, weapon);
  }

  // Spells, powers, transformations and claws, drawn from server messages.
  spellFx(m) {
    const fx = this.fx;
    // Every spell opens a magic circle under its caster.
    if (m.from) fx.circle(m.from[0], this.groundAt(m.from[0], m.from[2], m.from[1]), m.from[2], m.c, m.kind === 'frost' ? 2.6 : 1.6);
    if (m.from && m.to && (m.kind === 'firebolt' || m.kind === 'sunlance')) {
      fx.beam(m.from, m.to, m.c, m.kind === 'sunlance' ? 0.14 : 0.09);
      fx.explosion(m.to[0], m.to[1], m.to[2], m.kind === 'sunlance' ? 2.4 : 1.6, m.c);
    } else if (m.kind === 'blink') {
      fx.spark(m.from[0], m.from[1], m.from[2], m.c, 3);
      fx.spark(m.to[0], m.to[1], m.to[2], m.c, 3);
    } else if (m.points) {
      for (let i = 1; i < m.points.length; i++) {
        const a = m.points[i - 1], b = m.points[i];
        const mid = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * 1.5, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * 1.5, (a[2] + b[2]) / 2 + (Math.random() - 0.5) * 1.5];
        fx.tracer(a, mid, m.c); fx.tracer(mid, b, m.c);
        fx.spark(b[0], b[1], b[2], m.c, 1.5);
      }
    } else if (m.at) {
      const [x, y, z] = m.at;
      if (m.kind === 'frost') {
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; fx.spark(x + Math.cos(a) * m.radius * 0.7, y, z + Math.sin(a) * m.radius * 0.7, m.c, 2); }
        fx.explosion(x, y, z, m.radius * 0.5, m.c);
      } else if (m.kind === 'claw' || m.kind === 'mech') fx.spark(x, y, z, m.kind === 'mech' ? m.c : '#ffffff', m.kind === 'mech' ? 3 : 1.4);
      else fx.explosion(x, y, z, m.kind === 'transform' ? 2.5 : 1.4, m.c);
    }
  }

  buildTowns() {
    this.towns = townsOf(this.planet);
    this.footprints = townFootprints(this.planet);
    this.townMeshes = [];
    for (const t of this.towns) {
      const owner = this.S.realmOwners?.[t.id] || t.realm;
      const mesh = buildTown(this.planet, t, owner);
      const hall = t.buildings.find((b) => b.kind === 'keep' || b.kind === 'hall') || t.buildings[0];
      const lb = label(`${t.name} · ${t.size}`, realmColor(owner), 1.1);
      lb.position.set(hall.x, mesh.userData.base + hall.h + (t.capital ? 14 : 9), hall.z);
      mesh.add(lb);
      this.root.add(mesh);
      this.townMeshes.push(mesh);
    }
  }

  // The realistic sky: the sun lights the world through the atmosphere, clouds follow the
  // weather, the fog takes the horizon's color, and the scene is lit by the sky itself.
  updateRealSky(dt, t) {
    const sun = sunAt(this.planet, t), wxId = weatherAt(this.planet, t), wx = weatherInfo(wxId);
    this.weather = wx;
    this.sunState = sun;
    const k = Math.min(1, dt * 0.5);
    this.dayLevel = this.dayLevel == null || Math.abs(sun.daylight - this.dayLevel) > 0.25 ? sun.daylight : this.dayLevel + (sun.daylight - this.dayLevel) * k;
    this.lightLevel = this.lightLevel == null ? wx.light : this.lightLevel + (wx.light - this.lightLevel) * k;
    this.fogLevel = this.fogLevel == null ? wx.fog : this.fogLevel + (wx.fog - this.fogLevel) * k;
    const day = this.dayLevel, light = this.lightLevel;
    this.sunDir.set(...sun.dir);
    const u = this.realSky.material.uniforms;
    u.sunDir.value.copy(this.sunDir);
    u.time.value = t % 3600;
    const cover = { clear: 0.32, overcast: 0.86, rain: 0.93, storm: 0.98, snow: 0.88, blizzard: 0.99, fog: 0.6, sandstorm: 0.55, ashfall: 0.92 }[wxId] ?? 0.4;
    u.coverage.value += (cover - u.coverage.value) * k;
    u.cloudDark.value = 0.45 + (1 - light) * 1.2;
    u.night.value = 1 - day;
    const sc = skyColors(this.sunDir, u.betaRBase.value, this.turbidity, u.rayleigh.value);
    const sunCol = sc.sun.clone();
    const mx = Math.max(sunCol.r, sunCol.g, sunCol.b, 1e-3);
    sunCol.multiplyScalar(1 / mx);
    this.sun.color.copy(sunCol);
    this.sun.intensity = this.sunPower * day * Math.pow(light, 1.6) * (sun.dir[1] > 0 ? Math.min(1, sun.dir[1] * 6) : 0);
    this.moon.intensity = (1 - day) * 1.2;
    this.moon.position.copy(this.sunDir).multiplyScalar(-300).add(this.sun.target.position);
    this.moon.target.position.copy(this.sun.target.position);
    // Lightning.
    this.ambient.intensity = 0;
    if (wx.lightning && Math.random() < dt * 0.08) this.flashT = 0.3;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT > 0) this.ambient.intensity = this.flashT * 10;
    // Fog: the color of the horizon, greyed by weather, denser in storms and snow.
    const fog = sc.horizon.clone();
    const lum = fog.r * 0.3 + fog.g * 0.59 + fog.b * 0.11;
    fog.lerp(new THREE.Color(lum, lum, lum * 1.05), (1 - light) * 0.8);
    fog.lerp(new THREE.Color('#0b1220').multiplyScalar(0.4), Math.max(0, 0.65 - day) * 0.6);
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = 0.00055 / Math.max(0.18, this.fogLevel);
    this.scene.background = fog;
    // Light from the sky itself, refreshed as the sun moves.
    if (this.env) {
      const tex = this.env.update(this.sunDir, performance.now());
      if (tex) this.scene.environment = tex;
      this.scene.environmentIntensity = (0.35 + 0.65 * day) * (0.7 + 0.3 * light);
    }
    // The eye adjusts to the dark.
    if (this.S.gfx) this.S.gfx.exposureK = 1 + (1 - day) * 4 + (1 - light) * 0.6;
    this.setPrecip(wx.precip || null);
    if (this.precip) this.precip.userData.update(t, this.camera.position);
    if (this.grass) this.grass.update(t, this.camera.position, wxId === 'storm' || wxId === 'blizzard' || wxId === 'sandstorm' ? 2.2 : wxId === 'rain' ? 1.4 : 1);
  }

  // Rain, snow, blowing sand or falling ash around the camera, by the weather.
  setPrecip(kind) {
    if (this.precipKind === kind) return;
    if (this.precip) { this.root.remove(this.precip); this.precip.geometry.dispose(); this.precip.material.dispose(); }
    this.precip = null;
    this.precipKind = kind;
    if (!kind || !this.root) return;
    const n = kind === 'rain' ? 2600 : 1600, box = 60;
    const pos = new Float32Array(n * 3), base = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) base[i] = Math.random() * box;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const color = { rain: '#c8d8f0', snow: '#ffffff', sand: '#d8b878', ash: '#5a5450' }[kind];
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: kind === 'rain' ? 0.09 : kind === 'snow' ? 0.22 : 0.16, transparent: true, opacity: kind === 'rain' ? 0.6 : 0.85, depthWrite: false }));
    pts.frustumCulled = false;
    const vel = { rain: [1.5, -30, 0.8], snow: [0.8, -2.2, 0.4], sand: [14, -0.5, 5], ash: [0.6, -1.2, 0.3] }[kind];
    pts.userData.update = (t, cam) => {
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        const j = i * 3 + k, c0 = k === 0 ? cam.x : k === 1 ? cam.y : cam.z;
        const v = base[j] + vel[k] * t + (kind === 'snow' && k !== 1 ? Math.sin(t + i) * 0.8 : 0);
        pos[j] = c0 + ((((v - c0) % box) + box * 1.5) % box) - box / 2;
      }
      geo.attributes.position.needsUpdate = true;
    };
    this.precip = pts;
    this.root.add(pts);
  }

  // The sun crosses the sky; weather dims it, fogs the air and brings rain, snow or storms.
  updateSky(dt, t) {
    if (this.realSky) return this.updateRealSky(dt, t);
    const sun = sunAt(this.planet, t), wx = weatherInfo(weatherAt(this.planet, t));
    this.weather = wx;
    this.sunState = sun;
    const k = Math.min(1, dt * 0.5);
    this.dayLevel = this.dayLevel == null || Math.abs(sun.daylight - this.dayLevel) > 0.25 ? sun.daylight : this.dayLevel + (sun.daylight - this.dayLevel) * k;
    this.lightLevel = this.lightLevel == null ? wx.light : this.lightLevel + (wx.light - this.lightLevel) * k;
    this.fogLevel = this.fogLevel == null ? wx.fog : this.fogLevel + (wx.fog - this.fogLevel) * k;
    const day = this.dayLevel, light = this.lightLevel;
    this.sunDir.set(...sun.dir);
    if (this.sun.position.y < 0) this.sun.intensity = 0;
    this.sun.intensity = this.sunPower * day * light * (sun.dir[1] > 0 ? 1 : 0);
    this.moon.intensity = (1 - day) * 0.55;
    this.moon.position.copy(this.sunDir).multiplyScalar(-300).add(this.sun.target.position);
    this.moon.target.position.copy(this.sun.target.position);
    this.hemi.intensity = (0.3 + 0.8 * day) * (0.6 + 0.4 * light);
    this.ambient.intensity = 0.18 + 0.1 * day;
    // Lightning.
    if (wx.lightning && Math.random() < dt * 0.08) this.flashT = 0.35;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT > 0) this.ambient.intensity += this.flashT * 6;
    const nightFog = new THREE.Color('#0e1424');
    const fog = this.fogColor.clone().lerp(new THREE.Color(0.55, 0.57, 0.6), 1 - light).lerp(nightFog, 1 - day);
    this.scene.fog.color.copy(fog);
    this.scene.fog.far = this.fogFar * this.fogLevel;
    this.scene.fog.near = Math.min(this.scene.fog.near, this.scene.fog.far * 0.4);
    this.scene.background = this.baseSky.clone().lerp(nightFog, 1 - day);
    if (this.sky) {
      const u = this.sky.material.uniforms;
      u.sunDir.value.copy(this.sunDir);
      u.day.value = day;
      u.gloom.value = 1 - light;
    }
    this.sunGlow.position.copy(this.camera.position).addScaledVector(this.sunDir, 1100);
    this.sunGlow.material.opacity = 0.9 * day * light * (sun.dir[1] > -0.05 ? 1 : 0);
    this.setPrecip(wx.precip || null);
    if (this.precip) this.precip.userData.update(t, this.camera.position);
  }

  buildDeposits() {
    this.depositMeshes = new Map();
    const geo = new THREE.OctahedronGeometry(0.9, 0);
    for (const d of deposits(this.planet)) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: ORES[d.ore].color, emissive: ORES[d.ore].color, emissiveIntensity: 0.6, roughness: 0.3 });
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(geo, mat);
        c.position.set(Math.cos(i * 1.3) * 1.4, 0.6 + (i % 3) * 0.4, Math.sin(i * 1.3) * 1.4);
        c.scale.set(0.8, 1.6 + (i % 2), 0.8);
        c.rotation.z = (i - 2) * 0.2;
        g.add(c);
      }
      g.add(glowSprite(ORES[d.ore].color, 7, 0.5));
      g.position.set(d.x, heightAt(this.planet, d.x, d.z, this.data.digs), d.z);
      this.root.add(g);
      this.depositMeshes.set(d.id, g);
      g.visible = (this.data.deposits[d.id] ?? d.amount) > 0;
    }
  }

  applyDeposit(id, amt) {
    this.data.deposits[id] = amt;
    const g = this.depositMeshes.get(id);
    if (g) g.visible = amt > 0;
  }

  buildSettlement() {
    const ground = (x, z) => heightAt(this.planet, x, z, this.data.digs);
    for (const b of SETTLEMENT.buildings) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0.2 }));
      m.position.set(b.x, ground(b.x, b.z) + b.h / 2, b.z);
      this.root.add(m);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1, 0.6, b.d + 1), new THREE.MeshStandardMaterial({ color: '#4a5a72', metalness: 0.5 }));
      roof.position.set(b.x, ground(b.x, b.z) + b.h + 0.3, b.z);
      this.root.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, 0.8, b.d + 0.1), new THREE.MeshStandardMaterial({ color: '#ffe8a0', emissive: '#ffd060', emissiveIntensity: 0.7 }));
      win.position.set(b.x, ground(b.x, b.z) + b.h * 0.6, b.z);
      this.root.add(win);
      const lb = label(b.name, '#e8f0ff', 0.8);
      lb.position.set(b.x, ground(b.x, b.z) + b.h + 3, b.z);
      this.root.add(lb);
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(SETTLEMENT.pad.r, SETTLEMENT.pad.r, 0.4, 32), new THREE.MeshStandardMaterial({ color: '#3a4252', metalness: 0.6, roughness: 0.4 }));
    pad.position.set(SETTLEMENT.pad.x, ground(SETTLEMENT.pad.x, SETTLEMENT.pad.z) + 0.2, SETTLEMENT.pad.z);
    this.root.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SETTLEMENT.pad.r - 0.5, 0.15, 6, 48), new THREE.MeshBasicMaterial({ color: '#78ffaa' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pad.position).y += 0.25;
    this.root.add(ring);
    for (const npc of [SETTLEMENT.vendor, SETTLEMENT.warden]) {
      const p = buildPerson(npc === SETTLEMENT.vendor ? '#c8a050' : '#5a8ac8', 40);
      p.position.set(npc.x, ground(npc.x, npc.z), npc.z);
      p.lookAt(0, p.position.y, 34);
      const lb = label(npc.name, '#ffe08a', 0.85);
      lb.position.y = 2.4;
      p.add(lb);
      this.root.add(p);
    }
    const tower = SETTLEMENT.buildings.find((b) => b.name === 'Comms Tower');
    this.beaconLight = glowSprite('#ff6a6a', 6, 1);
    this.beaconLight.position.set(tower.x, ground(tower.x, tower.z) + tower.h + 2, tower.z);
    this.root.add(this.beaconLight);
  }

  // The Spire: a pale stone tower rising out of sight, banded with a glowing ring at every floor,
  // a great gate at its foot and a crystal crown at the top.
  buildSpire() {
    const sp = spireOf(this.planet);
    if (!sp) return;
    this.spire = sp;
    const g = new THREE.Group(), y0 = heightAt(this.planet, sp.x, sp.z, this.data.digs);
    g.position.set(sp.x, y0, sp.z);
    const stone = new THREE.MeshStandardMaterial({ color: '#b8bcc8', roughness: 0.75, metalness: 0.05, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#4a5060', roughness: 0.9, flatShading: true });
    const glow = new THREE.MeshStandardMaterial({ color: '#8fe6ff', emissive: '#4fd0ff', emissiveIntensity: 2.2, toneMapped: false });
    const add = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    // Plinth and steps.
    add(new THREE.CylinderGeometry(SPIRE_RADIUS + 2, SPIRE_RADIUS + 4, 3, 12), dark, 0.5);
    add(new THREE.CylinderGeometry(SPIRE_RADIUS, SPIRE_RADIUS + 1.5, 3, 12), stone, 3);
    // The tower: tapering octagonal sections, each a floor, with a ring of light between them.
    let y = 4.5, r = SPIRE_RADIUS - 3;
    for (let i = 0; i < 14; i++) {
      const h = 11 - i * 0.25, r2 = r * 0.94;
      add(new THREE.CylinderGeometry(r2, r, h, 8), stone, y + h / 2);
      add(new THREE.TorusGeometry(r2 + 0.15, 0.28, 6, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8), glow, y + h);
      // Buttresses on the lower floors.
      if (i < 4) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8, b = add(new THREE.BoxGeometry(1.4, h, 2.4), dark, y + h / 2);
        b.position.x = Math.cos(a) * (r * 0.97); b.position.z = Math.sin(a) * (r * 0.97); b.rotation.y = -a;
      }
      y += h; r = r2;
    }
    // Crown: a floating crystal and a pillar of light into the sky.
    const crystal = add(new THREE.OctahedronGeometry(4, 0), glow, y + 9);
    crystal.scale.y = 1.8;
    this.spireCrystal = crystal;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.4, 400, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#8fe6ff', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = y + 210;
    g.add(beam);
    g.add(glowSprite('#8fe6ff', 30, 0.8).translateY(y + 9));
    // The gate, facing Haven Landing.
    const face = Math.atan2(-sp.x, -sp.z);
    const gate = new THREE.Group();
    gate.rotation.y = face;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.7, 8, 16, Math.PI), stone);
    arch.position.set(0, 9.5, SPIRE_RADIUS - 2.4);
    gate.add(arch);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 1.4), stone); p.position.set(sx * 3.6, 7.5, SPIRE_RADIUS - 2.4); gate.add(p); }
    const portal = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#4fd0ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    portal.position.set(0, 9.5, SPIRE_RADIUS - 2.5);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 5), portal.material);
    door.position.set(0, 7, SPIRE_RADIUS - 2.5);
    gate.add(portal, door);
    g.add(gate);
    const lb = label('The Spire', '#8fe6ff', 1.6);
    lb.position.y = 16;
    lb.position.x = Math.sin(face) * (SPIRE_RADIUS + 2); lb.position.z = Math.cos(face) * (SPIRE_RADIUS + 2);
    g.add(lb);
    this.root.add(g);
  }

  buildRelic() {
    this.relic = null;
    const site = this.S.story?.relics?.find((r) => r.planet === this.planetId);
    if (!site) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#1a1030', emissive: site.found ? '#4a3a6a' : '#b86bff', emissiveIntensity: site.found ? 0.3 : 0.9, metalness: 0.8, roughness: 0.2 });
    const ob = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), mat);
    ob.position.y = 4.5;
    g.add(ob);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.4 + i * 0.8, 0.12, 6, 32), mat);
      r.position.y = 3 + i * 2.5;
      g.add(r);
      rings.push(r);
    }
    g.add(glowSprite('#b86bff', site.found ? 10 : 30, 0.7));
    const lb = label(site.found ? 'Precursor Relic (awake)' : 'Precursor Relic', '#d9a8ff');
    lb.position.y = 11;
    g.add(lb);
    g.position.set(site.x, heightAt(this.planet, site.x, site.z, this.data.digs), site.z);
    g.userData = { site, rings };
    this.root.add(g);
    this.relic = g;
  }

  addBlock(cell, blk) {
    const [gx, gy, gz] = cell.split(',').map(Number);
    const old = this.blocks.children.find((c) => c.userData.cell === cell);
    if (old) this.blocks.remove(old);
    const m = SPECIAL_BLOCKS[blk.b] ? SPECIAL_BLOCKS[blk.b]() : new THREE.Mesh(blockGeo, blockMat(blk.b));
    m.position.set((gx + 0.5) * SURFACE_GRID, (gy + 0.5) * SURFACE_GRID, (gz + 0.5) * SURFACE_GRID);
    m.userData = { cell, block: blk.b, owner: blk.o };
    m.traverse((o) => { o.userData.cell = cell; });
    this.blocks.add(m);
  }

  applyBlock(cell, data) {
    if (data) { this.data.blocks[cell] = data; this.addBlock(cell, data); }
    else {
      delete this.data.blocks[cell];
      const m = this.blocks.children.find((c) => c.userData.cell === cell);
      if (m) this.blocks.remove(m);
    }
  }

  // ---- walking ------------------------------------------------------------------------------

  hasBlock(gx, gy, gz) { const b = this.data.blocks[`${gx},${gy},${gz}`]; return !!b && !BLOCKS[b.b]?.passable; }

  // Ground under a point: terrain, liquid, or the top of a player-built block.
  groundAt0(f) { return standHeight(this.planet, f.x, f.z, this.data.digs); }

  groundAt(x, z, feet) {
    let g = standHeight(this.planet, x, z, this.data.digs);
    const gx = Math.floor(x / SURFACE_GRID), gz = Math.floor(z / SURFACE_GRID);
    const top = Math.floor((feet + 0.7) / SURFACE_GRID);
    for (let gy = top; gy >= top - 30; gy--) {
      if (this.hasBlock(gx, gy, gz)) { g = Math.max(g, (gy + 1) * SURFACE_GRID); break; }
    }
    return g;
  }

  blockedAt(x, z, feet) {
    if (this.spire && Math.hypot(this.spire.x - x, this.spire.z - z) < SPIRE_RADIUS - 2.5) return true;
    for (const t of this.towns || []) {
      if (Math.abs(t.x - x) > t.radius + 8 || Math.abs(t.z - z) > t.radius + 8) continue;
      for (const f of this.footprints) if (insideFootprint(f, x, z, 0.35) && feet < this.groundAt0(f) + 6) return true;
      break;
    }
    const gx = Math.floor(x / SURFACE_GRID), gz = Math.floor(z / SURFACE_GRID);
    for (let gy = Math.floor((feet + 0.7) / SURFACE_GRID); gy <= Math.floor((feet + 1.7) / SURFACE_GRID); gy++) if (this.hasBlock(gx, gy, gz)) return true;
    return false;
  }

  walk(dt, input, look) {
    const me = this.S.me;
    this.yaw -= look.x * 0.0025;
    this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - look.y * 0.0025));
    const you = this.S.you || {};
    const speed = (input.run ? RUN_SPEED : PLAYER_SPEED) * (you.speedMult || 1);
    const f = input.fwd || 0, s = input.strafe || 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * f + cos * s), mz = (-cos * f - sin * s);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const nx = me.x + mx * speed * dt, nz = me.z + mz * speed * dt;
    const lim = SURFACE_HALF - 2;
    if (!this.blockedAt(nx, me.z, me.y) && Math.abs(nx) < lim) me.x = nx;
    if (!this.blockedAt(me.x, nz, me.y) && Math.abs(nz) < lim) me.z = nz;
    const ground = this.groundAt(me.x, me.z, me.y);
    if (input.jump && this.onGround) { this.vel.y = (you.inMech ? 15 : you.wolf ? 13 : 10.5) * Math.sqrt(this.gravity); this.onGround = false; }
    // Flight: hold jump to climb, let go to glide down slowly.
    if (you.flying) {
      if (input.jump) this.vel.y = Math.min(this.vel.y + 40 * dt, 12);
      else this.vel.y = Math.max(this.vel.y - 12 * dt, -4);
    } else this.vel.y -= 28 * this.gravity * dt;
    me.y += this.vel.y * dt;
    if (me.y <= ground) { me.y = ground; this.vel.y = 0; this.onGround = true; }
    else if (me.y - ground > 0.15) this.onGround = false;
    // Steep climbs: you can step up gentle slopes but not cliffs.
    me.yaw = this.yaw;
    this.moving = ml > 0.1;
  }

  // ---- per-frame ----------------------------------------------------------------------------

  update(dt, t) {
    const S = this.S, me = S.me;
    if (!this.root) return;
    // Keep the sun's shadow box centered on the pilot.
    this.sun.target.position.set(me.x, me.y, me.z);
    this.sun.position.set(me.x, me.y, me.z).addScaledVector(this.sunDir, 300);
    if (this.sky) { this.sky.position.copy(this.camera.position); this.sky.material.uniforms.time.value = t % 3600; }
    this.updateSky(dt, t);
    if (this.liquid?.material.normalMap) this.liquid.material.normalMap.offset.set(t * 0.01, t * 0.007);
    if ((this.shadowAt = (this.shadowAt || 0) - dt) <= 0 && this.S.gfx?.q.shadows) { this.shadowAt = 0.5; this.shadowize(); }
    // Drawing a different weapon (a sword or a gun) changes how the pilot is drawn.
    const wpn = this.weaponOf(S.you);
    if (wpn !== this.selfWeapon && this.selfMesh.userData.animate) {
      this.selfWeapon = wpn;
      this.root.remove(this.selfMesh);
      this.selfMesh = buildPerson(S.you.color, S.you.armor?.armor || 0, wpn);
      this.root.add(this.selfMesh);
    }
    this.selfMesh.position.set(me.x, me.y, me.z);
    this.selfMesh.rotation.y = this.yaw;
    this.selfMesh.visible = !this.firstPerson && !S.dead;
    const legs = this.selfMesh.userData.mech ? this.selfMesh.userData.legs : null;
    if (legs) legs.forEach((l, i) => { l.rotation.x = this.moving ? Math.sin(t * 5 + i * Math.PI) * 0.35 : 0; });
    if (S.you?.ward && !this.wardMesh) {
      this.wardMesh = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.18, depthWrite: false }));
      this.root.add(this.wardMesh);
    }
    if (this.wardMesh) {
      this.wardMesh.visible = !!S.you?.ward;
      this.wardMesh.position.set(me.x, me.y + 1, me.z);
    }
    if (this.drift) this.drift.userData.update(t, this.camera.position);
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.selfMesh.userData.animate?.(t, Math.min(1, moving / 1.2), moving);
    for (const [i, tail] of (this.selfMesh.userData.tails || []).entries()) {
      tail.rotation.x = -0.5 - Math.min(0.9, moving * 0.12) + Math.sin(t * 6 + i * 1.7) * (0.08 + moving * 0.02);
    }
    if (this.beaconLight) this.beaconLight.material.opacity = 0.5 + 0.5 * Math.sin(t * 3);
    if (this.spireCrystal) this.spireCrystal.rotation.y = t * 0.6;
    if (this.relic) for (const [i, r] of this.relic.userData.rings.entries()) r.rotation.set(t * (0.5 + i * 0.3), t * 0.4, 0);
    for (const g of this.depositMeshes.values()) g.rotation.y = t * 0.3;

    const target = this.digTarget();
    this.digMarker.visible = !!target && this.S.mode !== 'build';
    if (target) this.digMarker.position.set(target.x, target.y + 0.15, target.z);
    this.updateOthers(t);
    this.updateCreatures(t);
    this.updateParked();
    this.updateCamera();
    this.fx.update(dt);
  }

  updateOthers(t) {
    const seen = new Set();
    for (const o of this.S.others.values()) {
      if (o.mode !== 'surface') continue;
      seen.add(o.id);
      let v = this.others.get(o.id);
      const armorKey = `${Math.round((o.armor || 0) / 20)}|${o.wolf ? 'w' : ''}|${o.mech || 0}|${o.weapon || ''}|${o.title || ''}|${o.rank ?? ''}`;
      if (!v || v.armorKey !== armorKey) {
        if (v) this.root.remove(v.group);
        const group = this.formMesh(o.color, o.armor, o.wolf, o.mech, o.weapon);
        const lb = label((o.rank != null ? `[${RANKS[o.rank].id}] ` : '') + o.name + (this.S.isPartyMember(o.key) ? ' ◆' : ''), o.color, 0.8);
        lb.position.y = o.mech ? 5.4 : o.wolf ? 3 : 2.5;
        group.add(lb);
        if (o.title) {
          // Knights, lords and rulers wear their title under their name.
          const tl = label(o.title, '#ffd890', 0.55);
          tl.position.y = lb.position.y + 0.42;
          group.add(tl);
        }
        const bar = healthBar(0.04);
        bar.position.y = 2.2;
        group.add(bar);
        v = { group, bar, armorKey };
        this.others.set(o.id, v);
        this.root.add(group);
      }
      const speed = Math.hypot(o.x - (v.px ?? o.x), o.z - (v.pz ?? o.z)) * 60;
      v.px = o.x; v.pz = o.z;
      v.walk = (v.walk || 0) + (Math.min(1, speed / 1.2) - (v.walk || 0)) * 0.15;
      v.speed = (v.speed || 0) + (speed - (v.speed || 0)) * 0.15;
      v.group.userData.animate?.(t, v.walk, v.speed);
      v.group.position.set(o.x, o.y, o.z);
      v.group.rotation.y = o.yaw;
      v.group.visible = !o.dead;
      setHealth(v.bar, o.hp / (o.maxHp || 100));
    }
    for (const [id, v] of this.others) if (!seen.has(id)) { this.root.remove(v.group); this.others.delete(id); }
  }

  updateCreatures(t) {
    const seen = new Set();
    for (const c of this.S.creatures.values()) {
      seen.add(c.id);
      let v = this.creatures.get(c.id);
      if (v && c.sp === 'native' && !!c.wolf !== v.wolf) { this.root.remove(v.group); this.creatures.delete(c.id); v = null; }
      if (!v && c.sp === 'native') {
        if (!c.n) continue;
        const group = c.wolf ? buildWerewolf() : buildNative(c.n);
        const bar = healthBar(0.03);
        bar.position.y = c.wolf ? 2.9 : 2.25;
        group.add(bar);
        const ppl = c.n.people;
        const lb = label(c.n.name, c.n.raider ? '#ff8a6a' : ppl === 'elf' ? '#a8f0d8' : ppl === 'dwarf' ? '#f0c890' : ppl === 'vampire' ? '#ff9aa8' : ppl === 'werewolf' ? '#e8d8a0' : '#f0ead8', 0.75);
        lb.position.y = c.wolf ? 3.2 : 2.5;
        group.add(lb);
        v = { group, bar, phase: Math.random() * 6, native: true, wolf: !!c.wolf, label: lb, name: c.n.name };
        this.creatures.set(c.id, v);
        this.root.add(group);
      }
      if (v?.native) {
        v.group.position.set(c.x, c.y, c.z);
        v.group.rotation.y = c.yaw + Math.PI;
        setHealth(v.bar, c.hp / c.maxHp);
        v.bar.visible = c.hp < c.maxHp;
        const d = Math.hypot(c.x - this.S.me.x, c.z - this.S.me.z);
        v.label.visible = d < 22 || c.hostile;
        const moving = Math.hypot(c.x - (v.px ?? c.x), c.z - (v.pz ?? c.z)) > 0.01;
        v.px = c.x; v.pz = c.z;
        const arms = v.group.userData.arms;
        v.walk = (v.walk || 0) + ((moving ? 1 : 0) - (v.walk || 0)) * 0.15;
        v.speed = (v.speed || 0) + ((moving ? c.speed || 3.2 : 0) - (v.speed || 0)) * 0.15;
        if (v.group.userData.animate) v.group.userData.animate(t + v.phase, v.walk, v.speed);
        else {
          if (arms) arms[0].rotation.x = moving ? Math.sin(t * 7 + v.phase) * 0.4 : 0;
          v.group.position.y += moving ? Math.abs(Math.sin(t * 7 + v.phase)) * 0.04 : 0;
        }
        continue;
      }
      if (!v) {
        const def = CREATURES[c.sp] || CREATURES.rockCrawler;
        const group = buildCreature(def.color, c.size, c.id.length * 31 + c.id.charCodeAt(1), def.shape, def);
        const tall = def.shape === 'strider' ? 4.6 : def.shape === 'golem' ? 3 : def.shape === 'flyer' || def.shape === 'tentacled' ? 2.6 : 2;
        const bar = healthBar(0.035);
        bar.position.y = c.size * tall + 0.6;
        group.add(bar);
        if (c.title) {
          // A wanted outlaw from a guild contract: named, in red.
          const lb = label(`☠ ${c.title}`, '#ff5a4a', 0.95);
          lb.position.y = c.size * tall + 1.3;
          group.add(lb);
        } else if (def.faction || def.behavior === 'guardian' || def.race) {
          const lb = label(def.name, def.faction === 'empire' ? '#ffe08a' : def.faction === 'rebellion' ? '#ff9a7a' : def.race ? ALIEN_RACES[def.race].color : '#d9a8ff', 0.7);
          lb.position.y = c.size * tall + 1.2;
          group.add(lb);
        }
        v = { group, bar, phase: Math.random() * 6 };
        this.creatures.set(c.id, v);
        this.root.add(group);
      }
      v.group.position.set(c.x, c.y, c.z);
      v.group.rotation.y = c.yaw + Math.PI;
      setHealth(v.bar, c.hp / c.maxHp);
      v.bar.visible = c.hp < c.maxHp;
      const ud = v.group.userData;
      if (ud.flap) ud.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 10 + v.phase) * 0.6 * (i ? 1 : -1); });
      else if (ud.wiggle) ud.legs.forEach((l, i) => { l.position.x = Math.sin(t * 5 + v.phase + i * 0.9) * 0.3 * c.size; });
      else if (ud.pulse) ud.legs.forEach((l) => { l.scale.y = c.size * 0.8 * (1 + Math.sin(t * 4 + v.phase) * 0.12); });
      else if (ud.sway) ud.legs.forEach((l, i) => { l.rotation.y = Math.sin(t * 2 + v.phase + i) * 0.5; });
      else ud.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 8 + v.phase + i * Math.PI) * 0.5; });
    }
    for (const [id, v] of this.creatures) if (!seen.has(id)) { this.root.remove(v.group); this.creatures.delete(id); }
  }

  updateParked() {
    const seen = new Set();
    for (const p of this.S.parked) {
      seen.add(p.key);
      let v = this.parked.get(p.key);
      const ship = this.S.ships.get(p.key);
      if (!ship) continue;
      if (!v || v.rev !== p.rev) {
        if (v) this.root.remove(v.group);
        const group = buildShip(ship, p.key === this.S.you.key ? this.S.you.color : '#c8d0e0');
        group.scale.setScalar(0.55);
        const lb = label(p.key === this.S.you.key ? 'Your ship' : `${p.name}'s ship`, '#9fd0ff', 0.85);
        lb.position.y = 16;
        group.add(lb);
        v = { group, rev: p.rev };
        this.parked.set(p.key, v);
        this.root.add(group);
      }
      v.group.position.set(p.x, heightAt(this.planet, p.x, p.z, this.data.digs) + 3.2, p.z);
    }
    for (const [k, v] of this.parked) if (!seen.has(k)) { this.root.remove(v.group); this.parked.delete(k); }
  }

  updateCamera() {
    const me = this.S.me;
    const eye = new THREE.Vector3(me.x, me.y + (this.S.you?.inMech ? 3.4 : 1.65), me.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) {
      this.camera.position.copy(eye);
    } else {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const far = this.S.you?.inMech ? 10 : this.S.you?.wolf ? 6 : 5;
      const cam = eye.clone().addScaledVector(dir, -far).addScaledVector(right, 0.9).add(new THREE.Vector3(0, this.S.you?.inMech ? 2.6 : 0.6, 0));
      const g = standHeight(this.planet, cam.x, cam.z, this.data.digs) + 0.4;
      if (cam.y < g) cam.y = g;
      this.camera.position.copy(cam);
    }
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  // Everything solid casts and receives shadows (checked every half second for new things).
  shadowize() {
    this.root.traverse((o) => {
      if (!o.isMesh || o.userData.sh) return;
      o.userData.sh = true;
      if (o.material?.transparent || o.material?.isShaderMaterial) return;
      o.receiveShadow = true;
      if (!o.userData.noCast) o.castShadow = true;
    });
  }

  // Where the crosshair points: first block or terrain hit along the camera ray.
  aim(maxDist = 250) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    const bh = ray.intersectObjects(this.blocks.children, false)[0];
    let tHit = bh ? bh.distance : maxDist;
    let point = null;
    for (let t = 0.5; t < tHit; t += 0.5) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < standHeight(this.planet, x, z, this.data.digs)) { point = new THREE.Vector3(x, y, z); tHit = t; break; }
    }
    if (!point && bh) return { point: bh.point, dir, block: bh };
    return { point: point || origin.clone().addScaledVector(dir, maxDist), dir, terrain: !!point };
  }

  // The patch of ground right mouse would dig, if it's within reach.
  digTarget() {
    const a = this.aim(24);
    if (!a.terrain) return null;
    const me = this.S.me;
    return Math.hypot(a.point.x - me.x, a.point.z - me.z) < 9.5 ? a.point : null;
  }

  shotDir() {
    const me = this.S.me;
    const { point } = this.aim(300);
    return new THREE.Vector3(point.x - me.x, point.y - (me.y + 1.5), point.z - me.z).normalize();
  }

  buildCell() {
    const a = this.aim(14);
    let p;
    if (a.block) p = a.point.clone().add(a.block.face.normal.clone().multiplyScalar(SURFACE_GRID * 0.5));
    else p = a.point.clone().add(new THREE.Vector3(0, SURFACE_GRID * 0.4, 0));
    return [Math.floor(p.x / SURFACE_GRID), Math.floor(p.y / SURFACE_GRID), Math.floor(p.z / SURFACE_GRID)];
  }

  // What the pilot could interact with from where they stand.
  interaction() {
    const me = this.S.me, near = (x, z, r) => Math.hypot(me.x - x, me.z - z) <= r;
    const parked = this.S.you.parked;
    if (this.planet.starter && near(SETTLEMENT.warden.x, SETTLEMENT.warden.z, 7)) return { what: 'warden', text: `E: talk to ${SETTLEMENT.warden.name}` };
    if (this.planet.starter && near(SETTLEMENT.vendor.x, SETTLEMENT.vendor.z, 7)) return { what: 'vendor', text: `E: trade with ${SETTLEMENT.vendor.name}` };
    if (this.spire && near(this.spire.x, this.spire.z, SPIRE_RADIUS + 8)) return { what: 'spire', text: 'E: enter the Spire' };
    if (this.relic && near(this.relic.position.x, this.relic.position.z, 7)) return { what: 'relic', text: this.relic.userData.site.found ? 'The relic is awake.' : 'E: awaken the Precursor Relic' };
    let bestN = null, bd = 4.5;
    for (const c of this.S.creatures.values()) {
      if (c.sp !== 'native' || c.hostile) continue;
      const d = Math.hypot(c.x - me.x, c.z - me.z);
      if (d < bd) { bd = d; bestN = c; }
    }
    if (bestN) return { what: 'npc', id: bestN.id, text: `E: talk to ${this.creatures.get(bestN.id)?.name || bestN.n?.name || 'them'}` };
    for (const t of this.towns || []) {
      if (!near(t.x, t.z, t.radius + 10)) continue;
      const hall = t.buildings.find((b) => b.kind === 'guild');
      if (hall && near(hall.x, hall.z, Math.max(hall.w, hall.d) / 2 + 6)) return { what: 'guild', text: 'E: Mercenary Guild contract board' };
    }
    for (const m of this.blocks?.children || []) {
      const t = m.userData.block;
      if (t !== 'chest' && t !== 'bench') continue;
      if (!near(m.position.x, m.position.z, 3.2)) continue;
      if (t === 'chest') return m.userData.owner === this.S.you.name ? { what: 'chest', id: m.userData.cell, text: 'E: open your chest' } : { text: `${m.userData.owner}'s chest` };
      return { what: 'bench', text: 'E: craft at the workbench (C)' };
    }
    if (parked && parked.planet === this.planetId && near(parked.x, parked.z, 14)) return { what: 'ship', text: 'E: board ship and take off · Y: shipyard' };
    for (const { st, def } of this.structures || []) {
      if (!near(st.x, st.z, st.radius + 6)) continue;
      if (def.kind === 'shrine') return { what: 'structure', id: st.id, text: `E: pray to ${GODS[st.god].name}` };
      if (def.kind === 'dungeon') return { what: 'structure', id: st.id, text: `E: descend into the ${DUNGEON_THEMES[def.dungeon].name}` };
      if (def.kind === 'village') {
        const race = ALIEN_RACES[st.race];
        return { what: 'structure', id: st.id, text: race.trader && race.disposition !== 'hostile' ? `E: trade with the ${race.trader}` : `The ${race.name} watch you. They don't trade.` };
      }
      if (st.type === 'cathedral') return { what: 'structure', id: st.id, text: 'E: enter the Cathedral of the Radiant Throne' };
      if (!def.cache) return { what: 'structure', id: st.id, text: `E: examine the ${def.name}` };
      if (this.looted.has(st.id)) return { what: 'structure', id: st.id, text: `${def.name} (already searched)` };
      return { what: 'structure', id: st.id, text: `E: search the ${def.name}` };
    }
    return null;
  }
}
