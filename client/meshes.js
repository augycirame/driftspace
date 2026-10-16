// 3D models built procedurally: block ships, NPC ships, people, creatures, stations, labels.

import * as THREE from 'three';
import { SHIP_PARTS, SHIP_BLOCK } from '/shared/rules.js';
import { mulberry32 } from '/shared/rng.js';

const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

// Merge unit boxes into one geometry with vertex colors. Each part: [x, y, z, sx, sy, sz, color].
export function mergeBoxes(parts) {
  const src = box.attributes.position.array, nrm = box.attributes.normal.array;
  const n = src.length / 3;
  const pos = new Float32Array(parts.length * n * 3), norm = new Float32Array(parts.length * n * 3), col = new Float32Array(parts.length * n * 3);
  const c = new THREE.Color();
  parts.forEach(([x, y, z, sx, sy, sz, color], i) => {
    c.set(color);
    for (let v = 0; v < n; v++) {
      const o = (i * n + v) * 3;
      // Slight shading by face so blocks read clearly.
      const shade = 0.85 + 0.15 * nrm[v * 3 + 1] + 0.05 * nrm[v * 3 + 2];
      pos[o] = src[v * 3] * sx + x; pos[o + 1] = src[v * 3 + 1] * sy + y; pos[o + 2] = src[v * 3 + 2] * sz + z;
      norm[o] = nrm[v * 3]; norm[o + 1] = nrm[v * 3 + 1]; norm[o + 2] = nrm[v * 3 + 2];
      col[o] = c.r * shade; col[o + 1] = c.g * shade; col[o + 2] = c.b * shade;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const shipMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.5 });
const glowTex = makeGlowTexture();

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

// A player's ship from its blocks. Tinted with the pilot's color; thrusters glow.
export function buildShip(blocks, tint = '#9fd0ff') {
  const group = new THREE.Group();
  const S = SHIP_BLOCK;
  const parts = [];
  const tintC = new THREE.Color(tint);
  for (const [x, y, z, t] of blocks) {
    const def = SHIP_PARTS[t];
    if (!def) continue;
    let color = new THREE.Color(def.color);
    if (t === 'hull' || t === 'wing') color = color.lerp(tintC, 0.35);
    if (t === 'wing') parts.push([x * S, y * S, z * S, S * 1.2, S * 0.25, S * 0.9, color]);
    else if (t === 'gun') { parts.push([x * S, y * S, z * S, S * 0.8, S * 0.8, S * 0.8, color]); parts.push([x * S, y * S, z * S - S * 0.8, S * 0.25, S * 0.25, S * 0.9, '#30343a']); }
    else if (t === 'thruster') { parts.push([x * S, y * S, z * S, S * 0.85, S * 0.85, S, color]); }
    else if (t === 'cockpit') { parts.push([x * S, y * S, z * S, S * 0.9, S * 0.8, S, '#3a4a60']); parts.push([x * S, y * S + S * 0.35, z * S - S * 0.1, S * 0.6, S * 0.3, S * 0.6, '#9fe8ff']); }
    else parts.push([x * S, y * S, z * S, S * 0.98, S * 0.98, S * 0.98, color]);
  }
  const mesh = new THREE.Mesh(mergeBoxes(parts), shipMat);
  group.add(mesh);
  const flames = [];
  for (const [x, y, z, t] of blocks) {
    if (t !== 'thruster') continue;
    const g = glowSprite('#ffa050', S * 2.2, 0.0);
    g.position.set(x * S, y * S, z * S + S * 0.7);
    group.add(g);
    flames.push(g);
  }
  for (const [x, y, z, t] of blocks) {
    if (t !== 'shield') continue;
    const g = glowSprite('#4bd8ff', S * 1.6, 0.5);
    g.position.set(x * S, y * S, z * S);
    group.add(g);
  }
  group.userData.flames = flames;
  return group;
}

export function setThrust(group, on, t) {
  for (const f of group.userData.flames || []) f.material.opacity = on ? 0.75 + Math.sin(t * 40 + f.position.x) * 0.2 : 0.12;
}

export const PIRATE_SHIP = [
  [0, 0, -2, 'cockpit'], [0, 0, -1, 'armor'], [0, 0, 0, 'hull'], [0, 0, 1, 'thruster'],
  [-1, 0, 0, 'gun'], [1, 0, 0, 'gun'], [-2, 0, 0, 'wing'], [2, 0, 0, 'wing'], [0, 1, 0, 'hull'],
];

const hollowMat = new THREE.MeshStandardMaterial({ color: '#2a4a1a', emissive: '#6aff3a', emissiveIntensity: 0.25, roughness: 0.6, flatShading: true });
const motherMat = new THREE.MeshStandardMaterial({ color: '#2a1a3a', emissive: '#b04aff', emissiveIntensity: 0.3, roughness: 0.7, flatShading: true });

function lumpy(radius, detail, seed, amount) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const r = mulberry32(seed);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(k)) cache.set(k, 1 + (r() - 0.5) * amount);
    const s = cache.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export const IMPERIAL_SHIP = [
  [0, 0, -3, 'cockpit'], [0, 0, -2, 'armor'], [0, 0, -1, 'hull'], [0, 0, 0, 'hull'], [0, 0, 1, 'thruster'],
  [-1, 0, -1, 'gun'], [1, 0, -1, 'gun'], [-1, 0, 0, 'wing'], [1, 0, 0, 'wing'], [-2, 0, 0, 'wing'], [2, 0, 0, 'wing'], [0, 1, -1, 'shield'],
];
export const REBEL_SHIP = [
  [0, 0, -2, 'cockpit'], [0, 0, -1, 'hull'], [0, 0, 0, 'cargo'], [0, 0, 1, 'thruster'], [-1, 0, 1, 'thruster'],
  [1, 0, -1, 'gun'], [-1, 0, 0, 'wing'], [1, 0, 0, 'hull'], [0, -1, 0, 'gun'],
];

export function buildNpc(kind) {
  const group = new THREE.Group();
  if (kind === 'imperial' || kind === 'rebel') {
    const s = buildShip(kind === 'imperial' ? IMPERIAL_SHIP : REBEL_SHIP, kind === 'imperial' ? '#f0e0a0' : '#d8603a');
    group.add(s);
    group.userData.flames = s.userData.flames;
  } else if (kind === 'pirate') {
    const s = buildShip(PIRATE_SHIP, '#ff4a3a');
    group.add(s);
    group.userData.flames = s.userData.flames;
  } else if (kind === 'hollow') {
    const body = new THREE.Mesh(lumpy(9, 1, 7, 0.5), hollowMat);
    body.scale.set(1, 0.7, 1.6);
    group.add(body);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(1.5, 12, 5), hollowMat);
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 8, Math.sin(a) * 5, 4);
      spike.rotation.x = Math.PI / 2;
      group.add(spike);
    }
    group.add(glowSprite('#9aff6a', 30, 0.5));
  } else if (kind === 'mothership') {
    const body = new THREE.Mesh(lumpy(140, 3, 11, 0.35), motherMat);
    body.scale.set(1.4, 0.8, 1.4);
    group.add(body);
    for (let i = 0; i < 14; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(14, 120, 6), motherMat);
      const a = (i / 14) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 170, (i % 2 ? 1 : -1) * 30, Math.sin(a) * 170);
      spike.lookAt(Math.cos(a) * 400, 0, Math.sin(a) * 400);
      spike.rotateX(Math.PI / 2);
      group.add(spike);
    }
    const core = glowSprite('#d06aff', 600, 0.6);
    group.add(core);
    group.userData.core = core;
  }
  return group;
}

// A pilot on foot: suit color from their name color, armor shows as plating.
export function buildPerson(color, armor = 0) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const plate = new THREE.MeshStandardMaterial({ color: armor > 60 ? '#c9a24a' : armor > 20 ? '#7a8aa0' : '#3a4250', roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.8, 4, 8), suit);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), plate);
  head.position.y = 1.72;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: '#9fe8ff', emissive: '#4ab8ff', emissiveIntensity: 0.8 }));
  visor.position.set(0, 1.74, -0.24);
  g.add(visor);
  if (armor > 0) {
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), plate);
    chest.position.y = 1.15;
    g.add(chest);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.7), new THREE.MeshStandardMaterial({ color: '#2a2e36', metalness: 0.7, roughness: 0.4 }));
  gun.position.set(0.35, 1.1, -0.35);
  g.add(gun);
  g.userData.gun = gun;
  return g;
}

// Creatures come in several body plans (from the content library's "shape").
export function buildCreature(color, size, seed = 1, shape = 'quad') {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: shape === 'golem' ? '#d0a0ff' : '#ffe060' });
  const legs = [];
  const eyes = (y, z, spread = 0.25) => {
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09 * size + 0.04, 6, 6), eyeMat);
      eye.position.set(s * spread * size, y, z);
      g.add(eye);
    }
  };
  if (shape === 'serpent') {
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(size * (0.55 - i * 0.06), 8, 6), mat);
      seg.position.set(0, size * 0.5, i * size * 0.7);
      g.add(seg);
      legs.push(seg);
    }
    eyes(size * 0.7, -size * 0.45, 0.2);
    g.userData.wiggle = true;
  } else if (shape === 'flyer') {
    const body = new THREE.Mesh(lumpy(0.5, 1, seed, 0.2), mat);
    body.scale.set(size * 0.8, size * 0.5, size * 1.2);
    body.position.y = size * 1.8;
    g.add(body);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(size * 1.6, 0.05, size * 0.8), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      wing.position.set(s * size * 0.9, size * 1.85, 0);
      g.add(wing);
      legs.push(wing);
    }
    eyes(size * 1.9, -size * 0.55, 0.15);
    const halo = glowSprite(color, size * 2.5, 0.35);
    halo.position.set(0, size * 1.8, 0);
    g.add(halo);
    g.userData.flap = true;
  } else if (shape === 'blob') {
    const body = new THREE.Mesh(lumpy(0.8, 2, seed, 0.25), new THREE.MeshStandardMaterial({ color, roughness: 0.3, transparent: true, opacity: 0.85, emissive: color, emissiveIntensity: 0.25 }));
    body.scale.set(size, size * 0.8, size);
    body.position.y = size * 0.7;
    g.add(body);
    legs.push(body);
    eyes(size * 0.9, -size * 0.65, 0.2);
    g.userData.pulse = true;
  } else if (shape === 'biped' || shape === 'golem') {
    const golem = shape === 'golem';
    const torso = new THREE.Mesh(golem ? lumpy(0.6, 0, seed, 0.3) : new THREE.CapsuleGeometry(0.35, 0.7, 4, 8), mat);
    torso.scale.setScalar(size * (golem ? 1.4 : 1));
    torso.position.y = size * (golem ? 1.6 : 1.15);
    g.add(torso);
    const head = new THREE.Mesh(golem ? new THREE.BoxGeometry(0.5, 0.5, 0.5) : new THREE.SphereGeometry(0.25, 10, 8), mat);
    head.scale.setScalar(size);
    head.position.y = size * (golem ? 2.6 : 1.85);
    g.add(head);
    eyes(head.position.y, -0.22 * size, 0.1);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22 * size * (golem ? 1.6 : 1), 0.8 * size, 0.22 * size * (golem ? 1.6 : 1)), mat);
      leg.position.set(s * 0.18 * size * (golem ? 1.8 : 1), 0.4 * size, 0);
      g.add(leg);
      legs.push(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16 * size * (golem ? 2 : 1), 0.7 * size, 0.16 * size * (golem ? 2 : 1)), mat);
      arm.position.set(s * 0.48 * size * (golem ? 1.6 : 1), size * (golem ? 1.6 : 1.15), 0);
      g.add(arm);
    }
    if (!golem) {
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: '#2a2e36', metalness: 0.7 }));
      gun.position.set(0.4 * size, size * 1.1, -0.35);
      g.add(gun);
    } else {
      const core = glowSprite('#b86bff', size * 3, 0.4);
      core.position.set(0, size * 1.8, 0);
      g.add(core);
    }
  } else {
    // quad and insect
    const insect = shape === 'insect';
    const body = new THREE.Mesh(lumpy(0.7, 1, seed, 0.3), mat);
    body.scale.set(size, size * (insect ? 0.5 : 0.75), size * 1.3);
    body.position.y = size * (insect ? 0.6 : 0.9);
    g.add(body);
    eyes(size * (insect ? 0.75 : 1.1), -0.85 * size);
    const spots = insect ? [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [lx, lz] of spots) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16 * size, (insect ? 0.5 : 0.7) * size, 0.16 * size), mat);
      leg.position.set(lx * (insect ? 0.6 : 0.45) * size, size * (insect ? 0.25 : 0.35), lz * 0.5 * size);
      if (insect) leg.rotation.z = lx * 0.6;
      g.add(leg);
      legs.push(leg);
    }
  }
  g.userData.legs = legs;
  return g;
}

// A structure from the content library's part list. '@god' colors take the shrine's god color.
export function buildStructure(def, godColor) {
  const g = new THREE.Group();
  const mats = new Map();
  const matFor = (color, glow) => {
    const c = color === '@god' ? godColor || '#b86bff' : color;
    const key = c + (glow ? '!' : '');
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.1, flatShading: true, emissive: glow ? c : '#000000', emissiveIntensity: glow ? 0.9 : 0 }));
    return mats.get(key);
  };
  for (const [shape, x, y, z, a, b, c, color, glow, tilt] of def.parts) {
    let geo;
    if (shape === 'box') geo = new THREE.BoxGeometry(a, b, c);
    else if (shape === 'cyl') geo = new THREE.CylinderGeometry(a, a, b, 16);
    else if (shape === 'cone') geo = new THREE.ConeGeometry(a, b, c || 8);
    else if (shape === 'sphere') geo = new THREE.SphereGeometry(a, 16, 12);
    else if (shape === 'ring') geo = new THREE.TorusGeometry(a, b, 8, 32);
    else continue;
    const m = new THREE.Mesh(geo, matFor(color, glow));
    m.position.set(x, y, z);
    if (tilt) m.rotation.z = tilt;
    g.add(m);
    if (glow) {
      const sp = glowSprite(color === '@god' ? godColor || '#b86bff' : color, Math.max(a, b || 0, c || 0) * 3, 0.5);
      sp.position.set(x, y, z);
      g.add(sp);
    }
  }
  return g;
}

export function buildStation(faction = null, capital = false) {
  if (capital) return buildSanctum();
  const g = new THREE.Group();
  const trim = faction === 'empire' ? '#e8c547' : faction === 'rebellion' ? '#b8502a' : '#8fa6c8';
  const metal = new THREE.MeshStandardMaterial({ color: trim, metalness: 0.7, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: faction === 'empire' ? '#e8e4da' : faction === 'rebellion' ? '#4a3a30' : '#2b3d63', metalness: 0.6, roughness: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 12, 12, 48), metal);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 90, 20), dark);
  g.add(hub);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 240), metal);
    spoke.rotation.y = (i / 4) * Math.PI;
    g.add(spoke);
  }
  const lights = new THREE.MeshBasicMaterial({ color: '#c6dcff' });
  for (let i = 0; i < 16; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(3, 6, 6), lights);
    const a = (i / 16) * Math.PI * 2;
    l.position.set(Math.cos(a) * 120, 14, Math.sin(a) * 120);
    g.add(l);
  }
  g.add(glowSprite(faction === 'empire' ? '#ffe08a' : faction === 'rebellion' ? '#ff6a4a' : '#7fb4ff', 260, 0.35));
  return g;
}

// The Sanctum of the Radiant Throne: a golden cathedral-station above the holy capital.
function buildSanctum() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f0ece0', metalness: 0.4, roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: '#e8c547', metalness: 0.9, roughness: 0.25, emissive: '#6a5010', emissiveIntensity: 0.4 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(90, 70, 220), white);
  g.add(nave);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  dome.position.y = 35;
  g.add(dome);
  for (const [x, z] of [[-60, -100], [60, -100], [-60, 100], [60, 100]]) {
    const spire = new THREE.Mesh(new THREE.ConeGeometry(14, 220, 8), white);
    spire.position.set(x, 60, z);
    g.add(spire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), gold);
    tip.position.set(x, 172, z);
    g.add(tip);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(200, 6, 8, 96), gold);
  halo.rotation.x = Math.PI / 2;
  g.add(halo);
  g.add(glowSprite('#ffe8a0', 700, 0.45));
  return g;
}

// Text labels that stay the same size on screen.
const labelCache = new Map();
export function label(text, color = '#cfe2ff', scale = 1) {
  const key = text + color;
  let tex = labelCache.get(key);
  if (!tex) {
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    g.font = 'bold 28px ui-monospace, Menlo, monospace';
    const w = Math.ceil(g.measureText(text).width) + 16;
    cv.width = w; cv.height = 40;
    g.font = 'bold 28px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(text, 10, 31);
    g.fillStyle = color;
    g.fillText(text, 8, 29);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { w, h: 40 };
    if (labelCache.size > 400) labelCache.clear();
    labelCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
  const k = 0.00075 * scale;
  s.scale.set(tex.userData.w * k, tex.userData.h * k, 1);
  s.renderOrder = 10;
  return s;
}

// A small health bar that floats over a target.
export function healthBar(width = 0.06) {
  const g = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#000000', opacity: 0.6, transparent: true, depthTest: false, sizeAttenuation: false }));
  bg.scale.set(width, 0.007, 1);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff5a4a', depthTest: false, sizeAttenuation: false }));
  fg.scale.set(width, 0.007, 1);
  bg.renderOrder = fg.renderOrder = 11;
  g.add(bg, fg);
  g.userData = { fg, width };
  return g;
}

export function setHealth(bar, frac) {
  const { fg, width } = bar.userData;
  fg.scale.x = Math.max(0.0001, width * Math.max(0, Math.min(1, frac)));
  fg.material.color.set(frac > 0.5 ? '#6aff8a' : frac > 0.25 ? '#ffd36a' : '#ff5a4a');
}
