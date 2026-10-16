// 3D models built procedurally: block ships, NPC ships, people, creatures, stations, labels.

import * as THREE from 'three';
import { addInkHull as inkHull } from './toon.js';
import { realism, realSurface } from './realism.js';
import { SHIP_PARTS, SHIP_BLOCK } from '/shared/rules.js';
import { mulberry32 } from '/shared/rng.js';
import { PEOPLES } from '/shared/content/peoples.js';

const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

// Realistic style: no ink outlines; instead every material gets surface detail by what it is
// made of (tagged as userData.kind), and unlit face details become glossy, lit ones.
const addInkHull = (g) => (realism() ? realify(g) : inkHull(g));
const REAL_KINDS = {
  cloth: { normal: 'fabric', scale: 7, strength: 0.75, dirt: 0.14, roughness: 0.9 },
  leather: { normal: 'leather', scale: 6, strength: 0.8, dirt: 0.2, roughness: 0.62 },
  skin: { normal: 'fine', scale: 9, strength: 0.18, dirt: 0.05, roughness: 0.52 },
  hair: { normal: 'fabric', scale: 18, strength: 0.9, dirt: 0.06, roughness: 0.45 },
  metal: { normal: 'scratched', scale: 4, strength: 0.6, dirt: 0.12 },
  wood: { normal: 'wood', scale: 5, strength: 0.9, dirt: 0.2 },
  hide: { normal: 'leather', scale: 2.2, strength: 1, dirt: 0.25, roughness: 0.75 },
  armor: { normal: 'scratched', scale: 2, strength: 0.7, dirt: 0.15 },
};
export function realify(g, fallback = 'cloth') {
  const done = new Map();
  g.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    let m = o.material;
    if (done.has(m)) { o.material = done.get(m); return; }
    const src = m;
    if (m.isMeshBasicMaterial && m.userData.face) {
      m = new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.18 });
    } else if (m.isMeshStandardMaterial) {
      const k = REAL_KINDS[m.userData.kind || fallback] || REAL_KINDS.cloth;
      m.flatShading = false;
      if (k.roughness != null && !m.userData.kind?.startsWith?.('metal')) m.roughness = k.roughness;
      realSurface(m, { ...k, local: true });
    }
    done.set(src, m);
    o.material = m;
    o.castShadow = true;
  });
  return g;
}

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
  if (realism() && !shipMat.userData.realSurface) {
    shipMat.metalness = 0.72; shipMat.roughness = 0.36;
    realSurface(shipMat, { normal: 'metal', scale: 1.4, strength: 0.7, dirt: 0.25, local: true });
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

export function buildNpc(kind, race = null) {
  const group = new THREE.Group();
  if (kind === 'alien' && race) {
    const s = buildShip(race.ship, race.color);
    group.add(s);
    group.add(glowSprite(race.accent, 40, 0.35));
    group.userData.flames = s.userData.flames;
  } else if (kind === 'imperial' || kind === 'rebel') {
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
// Anime style changes how people and creatures are drawn (set by the graphics settings).
let animeMode = false;
export const setAnimeMode = (on) => { animeMode = on; };

// An anime eye: white, a big colored iris, a dark pupil and a highlight. Faces -z.
function animeEye(size, iris = '#3a6ae8') {
  const e = new THREE.Group();
  const B = (c) => new THREE.MeshBasicMaterial({ color: c });
  const white = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.8, 1.15, 0.3), B('#d8d8de'));
  const irisColor = new THREE.Color(iris).multiplyScalar(0.75);
  const ir = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10).scale(1, 1.25, 0.3), B(irisColor));
  ir.position.set(0, -0.12, -0.2);
  const deep = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8).scale(1, 0.6, 0.2), B(irisColor.clone().multiplyScalar(0.55)));
  deep.position.set(0, 0.12, -0.33);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8).scale(1, 1.2, 0.3), B('#10101a'));
  pupil.position.set(0, -0.08, -0.36);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1, 0.3), B('#ffffff'));
  shine.position.set(0.24, 0.22, -0.48);
  const shine2 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4).scale(1, 1, 0.3), B('#ffffff'));
  shine2.position.set(-0.2, -0.38, -0.46);
  // Lashes: a thick dark line over the top of the eye.
  const lash = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.13, 4, 14, Math.PI * 0.9).scale(1, 1.25, 0.6), B('#1a1020'));
  lash.rotation.z = Math.PI * 0.05;
  lash.position.z = -0.12;
  e.add(white, ir, deep, pupil, shine, shine2, lash);
  e.scale.setScalar(size);
  return e;
}

// Natural hair and eye colors, picked per pilot from their name color.
const HAIR = ['#d9c28e', '#c8b088', '#8a6038', '#4a3426', '#1f1a1c', '#9a4a2a', '#cfc9bf', '#b89a6a'];
const IRIS = ['#8aa0b0', '#6a8ab8', '#7a9a6a', '#7a5a3a', '#9aa4a8', '#5a6a8a'];
function pick(list, key, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return list[(h >>> 0) % list.length];
}

// A grounded anime figure, drawn like a seinen character sheet: real proportions, a steady
// narrow gaze, hair slicked back with braids at the temples, a rough tunic with a rope belt,
// dark trousers and tall boots. The same body dresses every people and role:
//   opts: tunic, skin, hair, eyes, armor, female, ears (elf), beard, height, width (dwarf),
//         robe, cloak, role gear (crown, helmet, spear, staff, hammer, bow, hat, apron, lute).
export function buildHuman(opts) {
  const o = { armor: 0, female: false, ears: false, beard: false, height: 1, width: 1, gun: true, ...opts };
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(o.width, o.height, o.width);
  g.add(body);
  const M = (c, x = {}, kind = 'cloth') => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...x }); m.userData.paint = 0; m.userData.kind = kind; return m; };
  const B = (c) => { const m = new THREE.MeshBasicMaterial({ color: c }); m.userData.face = true; return m; };
  const tunicColor = new THREE.Color(o.tunic);
  const tunic = M(tunicColor), trim = M(tunicColor.clone().multiplyScalar(0.62)), pants = M(o.pants || '#3a3236'), boot = M(o.boots || '#4a4944', {}, 'leather');
  const rope = M(o.belt || '#cbbd98', {}, o.belt ? 'leather' : 'cloth'), skin = M(o.skin, {}, 'skin'), hair = M(o.hair, {}, 'hair'), hairDark = M(new THREE.Color(o.hair).multiplyScalar(0.72), {}, 'hair');
  const armor = o.armor;
  const plate = M(armor > 60 ? '#b8a060' : armor > 20 ? '#9aa0a6' : '#6a5440', { roughness: armor > 20 ? 0.45 : 0.9, metalness: armor > 20 ? 0.35 : 0 }, armor > 20 ? 'metal' : 'leather');
  const metal = M('#9aa0a8', { roughness: 0.4, metalness: 0.5 }, 'metal'), gold = M('#e0b848', { roughness: 0.35, metalness: 0.6 }, 'metal'), woodM = M('#6a4a2a', {}, 'wood');
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };
  const W = o.female ? 0.9 : 1;
  // Legs: loose trousers tucked into tall boots (hidden under a robe).
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.085, 0.075, 0.6, 10), pants, sx * 0.1, 0.66, 0);
    add(new THREE.CylinderGeometry(0.068, 0.072, 0.36, 10), boot, sx * 0.1, 0.2, 0);
    add(new THREE.BoxGeometry(0.11, 0.06, 0.2), boot, sx * 0.1, 0.03, -0.04);
  }
  // Tunic (or a long robe) from the shoulders down, with a notched collar and a rope belt.
  const robe = o.robe;
  add(new THREE.CylinderGeometry(0.17 * W, robe ? 0.3 : 0.2, robe ? 1.3 : 0.66, 14).scale(1.1, 1, 0.72), tunic, 0, robe ? 0.77 : 1.09, 0);
  add(new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.18 * W, 0.45, 0.75), tunic, 0, 1.41, 0);
  add(new THREE.TorusGeometry(0.06, 0.012, 4, 14).scale(1, 1.3, 1).rotateX(Math.PI / 2), trim, 0, 1.47, -0.02);
  add(new THREE.BoxGeometry(0.018, 0.12, 0.01), trim, 0, 1.39, -0.135);
  add(new THREE.TorusGeometry(0.2, 0.018, 5, 18).scale(1.08, 0.72, 1).rotateX(Math.PI / 2), rope, 0, 0.92, 0);
  if (!robe) add(new THREE.CylinderGeometry(0.205, 0.215, 0.03, 14).scale(1.1, 1, 0.74), trim, 0, 0.77, 0);
  if (o.apron) add(new THREE.BoxGeometry(0.3, 0.6, 0.02), M(o.apron), 0, 0.85, -0.16);
  if (o.cloak) add(new THREE.CylinderGeometry(0.22, 0.34, 1.2, 14, 1, true, Math.PI * 0.62, Math.PI * 1.76).scale(1.1, 1, 0.8), M(o.cloak, { side: THREE.DoubleSide }), 0, 0.85, 0.02);
  if (o.fur) add(new THREE.TorusGeometry(0.2, 0.07, 6, 14).scale(1.15, 1, 0.85).rotateX(Math.PI / 2), M(o.fur), 0, 1.42, 0);
  // Arms: short sleeves, bare forearms with rope-wrapped wrists. The right arm holds a weapon.
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.235 * W, 1.4, 0);
    body.add(arm);
    if (sx > 0 && o.gun) arm.rotation.x = 1.1; else arm.rotation.z = -sx * 0.08;
    add(new THREE.CylinderGeometry(0.058, 0.055, robe ? 0.36 : 0.16, 10), tunic, 0, robe ? -0.18 : -0.08, 0, 0, 0, 0, arm);
    add(new THREE.CylinderGeometry(0.045, 0.04, 0.3, 10), skin, 0, -0.27, 0, 0, 0, 0, arm);
    add(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 10), rope, 0, -0.38, 0, 0, 0, 0, arm);
    add(new THREE.SphereGeometry(0.045, 10, 8).scale(0.85, 1.1, 0.7), skin, 0, -0.46, 0, 0, 0, 0, arm);
    if (armor > 0) add(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.7, 1), plate, 0, 0, 0, 0, 0, sx * -0.3, arm);
    arms.push(arm);
  }
  g.userData.arms = arms;
  if (armor > 20) add(new THREE.CylinderGeometry(0.18 * W, 0.19, 0.3, 14).scale(1.12, 1, 0.76), plate, 0, 1.26, 0);
  // Neck and head.
  add(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin, 0, 1.52, 0);
  const hy = 1.66;
  add(new THREE.SphereGeometry(0.12, 18, 14).scale(0.88 * (o.female ? 0.96 : 1), 1.08, 0.98), skin, 0, hy, 0);
  add(new THREE.ConeGeometry(0.075, 0.1, 10).scale(1.1, 1, 0.9).rotateX(Math.PI), skin, 0, hy - 0.085, -0.025);
  add(new THREE.ConeGeometry(0.014, 0.04, 4).rotateX(-Math.PI / 2 - 0.35), skin, 0, hy - 0.012, -0.118);
  for (const sx of [-1, 1]) {
    if (o.ears) add(new THREE.ConeGeometry(0.022, 0.11, 6).rotateZ(-sx * 1.1).rotateY(sx * 0.3), skin, sx * 0.13, hy + 0.03, 0.01);
    else add(new THREE.SphereGeometry(0.022, 8, 6).scale(0.5, 1, 0.8), skin, sx * 0.105, hy - 0.005, 0.005);
  }
  // Face: narrow eyes under a heavy upper lid, level brows, a straight mouth.
  const face = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.042, hy + 0.012, -0.104);
    eye.rotation.set(0, -sx * 0.3, sx * -0.08);
    body.add(eye);
    face.push(add(new THREE.SphereGeometry(1, 12, 8).scale(0.024, o.female ? 0.011 : 0.0095, 0.006), B('#e6e2dc'), 0, 0, 0, 0, 0, 0, eye));
    face.push(add(new THREE.CircleGeometry(0.0085, 14).rotateY(Math.PI), B(new THREE.Color(o.eyes).multiplyScalar(0.8)), sx * 0.002, -0.001, -0.0062, 0, 0, 0, eye));
    face.push(add(new THREE.CircleGeometry(0.0038, 10).rotateY(Math.PI), B('#141218'), sx * 0.002, -0.001, -0.0066, 0, 0, 0, eye));
    face.push(add(new THREE.BoxGeometry(0.052, o.female ? 0.007 : 0.0055, 0.006), B('#2a1e1a'), 0, 0.0085, -0.004, 0, 0, sx * 0.06, eye));
    face.push(add(new THREE.BoxGeometry(0.05, 0.007, 0.008), hairDark, sx * 0.045, hy + 0.04, -0.106, 0, -sx * 0.3, sx * 0.14));
  }
  face.push(add(new THREE.BoxGeometry(0.03, 0.0035, 0.004), B(o.female ? '#b85a60' : '#8a5a50'), 0, hy - 0.058, -0.103));
  for (const f of face) f.userData.noHull = true;
  // Hair: slicked back over the top, falling behind to the shoulders (longer for women), braids.
  add(new THREE.SphereGeometry(0.128, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.92, 1.08, 1.04), hair, 0, hy + 0.012, 0.008, 0.22, 0, 0);
  add(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI, 0, Math.PI * 0.8).scale(0.97, o.female ? 1.7 : 1.25, 1.05), hair, 0, hy - (o.female ? 0.08 : 0.03), 0.004);
  add(new THREE.CylinderGeometry(0.03, 0.05, o.female ? 0.34 : 0.2, 8).scale(1, 1, 0.6), hair, 0, hy - (o.female ? 0.2 : 0.13), 0.085, 0.12, 0, 0);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      add(new THREE.SphereGeometry(0.017 - i * 0.0008, 8, 6).scale(1, 1.3, 1), i % 2 ? hairDark : hair, sx * (0.1 + i * 0.002), hy + 0.05 - i * 0.034, -0.035 + i * 0.008);
    }
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), M('#2a2622'), sx * 0.112, hy - 0.16, 0.012);
  }
  if (o.beard) {
    add(new THREE.ConeGeometry(0.085, o.beard === 'long' ? 0.3 : 0.16, 10).scale(1, 1, 0.7).rotateX(Math.PI), hair, 0, hy - (o.beard === 'long' ? 0.2 : 0.13), -0.06);
    add(new THREE.TorusGeometry(0.03, 0.01, 4, 10, Math.PI).rotateZ(Math.PI), hair, 0, hy - 0.045, -0.105);
  }
  // Role gear.
  const right = arms[1];
  if (o.crown) {
    add(new THREE.CylinderGeometry(0.115, 0.11, 0.04, 14, 1, true), gold, 0, hy + 0.1, 0.005);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(new THREE.ConeGeometry(0.015, 0.05, 4), gold, Math.cos(a) * 0.11, hy + 0.14, Math.sin(a) * 0.11); }
  }
  if (o.helmet) {
    add(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.05), metal, 0, hy + 0.02, 0.005);
    add(new THREE.BoxGeometry(0.02, 0.09, 0.02), metal, 0, hy - 0.02, -0.13);
    if (o.plume) add(new THREE.CylinderGeometry(0.02, 0.04, 0.22, 6).rotateX(0.6), M(o.plume), 0, hy + 0.18, 0.06);
  }
  if (o.hat === 'straw') add(new THREE.CylinderGeometry(0.06, 0.22, 0.08, 14), M('#d8c070'), 0, hy + 0.14, 0);
  if (o.hat === 'wizard') add(new THREE.ConeGeometry(0.14, 0.42, 12).rotateZ(0.12), M(o.tunic), 0, hy + 0.3, 0.02);
  if (o.spear) { add(new THREE.CylinderGeometry(0.014, 0.014, 2, 6), woodM, 0, -0.3, 0, 0, 0, 0, right); add(new THREE.ConeGeometry(0.03, 0.14, 6).rotateX(Math.PI), metal, 0, -1.36, 0, 0, 0, 0, right); }
  if (o.shield) add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16).rotateZ(Math.PI / 2), M(o.shield), -0.06, -0.25, 0, 0, 0, 0, arms[0]);
  if (o.staff) { add(new THREE.CylinderGeometry(0.016, 0.02, 1.7, 6), woodM, 0, -0.3, 0, 0, 0, 0, right); add(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: o.staff }), 0, 0.56, 0, 0, 0, 0, right); }
  if (o.hammer) { add(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 6), woodM, 0, -0.55, 0, 0, 0, 0, right); add(new THREE.BoxGeometry(0.1, 0.07, 0.07), metal, 0, -0.75, 0, 0, 0, 0, right); }
  if (o.bow) add(new THREE.TorusGeometry(0.4, 0.012, 4, 16, Math.PI).rotateZ(Math.PI / 2), woodM, 0, 1.15, 0.2, 0, 0, 0.3);
  if (o.lute) add(new THREE.SphereGeometry(0.1, 10, 8).scale(1, 1.3, 0.5), woodM, 0.12, 1.05, -0.16);
  if (o.gun) {
    const gun = add(new THREE.BoxGeometry(0.06, 0.09, 0.4), M('#3a3a3e', { roughness: 0.5, metalness: 0.3 }, 'metal'), 0, -0.62, 0, 0, 0, 0, right);
    gun.geometry.rotateX(Math.PI / 2);
    g.userData.gun = gun;
  }
  return addInkHull(g);
}

// The pilot: earthy tunic in the pilot's color and natural hair, chosen from their color.
function buildAnimePerson(color, armor) {
  const tunic = new THREE.Color(color);
  const hsl = {}; tunic.getHSL(hsl);
  tunic.setHSL(hsl.h, Math.min(hsl.s, 0.45), 0.4);
  return buildHuman({ tunic, skin: '#f1d1ba', hair: pick(HAIR, color), eyes: pick(IRIS, color, 7), armor });
}

// A native of a planet town, dressed for their people and role.
export function buildNative(n) {
  const P = PEOPLES[n.people] || PEOPLES.human;
  let seed = n.look >>> 0;
  const r = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return seed / 4294967296; };
  const any = (list) => list[Math.floor(r() * list.length)];
  const role = n.role;
  const o = {
    tunic: any(P.clothes), skin: any(P.skin), hair: any(P.hair), eyes: any(P.eyes), female: !!n.female,
    ears: !!P.ears, height: P.height * (0.95 + r() * 0.1), width: n.people === 'dwarf' ? 1.28 : 1,
    beard: !n.female && r() < P.beard ? (n.people === 'dwarf' ? 'long' : 'short') : false, gun: false,
  };
  if (n.people === 'vampire') o.cloak = '#1a0e14';
  if (n.people === 'werewolf') o.fur = '#8a7a60';
  if (role === 'ruler') { o.crown = true; o.cloak = n.people === 'vampire' ? '#3a0a14' : '#7a1a2a'; o.robe = n.people !== 'dwarf'; }
  if (role === 'guard' || role === 'captain') { o.helmet = true; o.spear = true; o.shield = n.raider ? '#5a2a2a' : any(P.clothes); o.armor = 30; o.plume = role === 'captain' ? '#c83a3a' : null; }
  if (n.raider && n.people === 'human' && !n.realm) o.tunic = '#4a3a2a';
  if (role === 'mage') { o.robe = true; o.hat = 'wizard'; o.staff = n.people === 'elf' ? '#9affea' : '#c8a0ff'; }
  if (role === 'priest' || role === 'healer') { o.robe = true; o.tunic = role === 'healer' ? '#e8e4d8' : o.tunic; }
  if (role === 'smith') { o.apron = '#4a3426'; o.hammer = true; }
  if (role === 'merchant') o.apron = '#c8b078';
  if (role === 'farmer') o.hat = 'straw';
  if (role === 'hunter') o.bow = true;
  if (role === 'bard') o.lute = true;
  return buildHuman(o);
}

// A walking mech: reverse-jointed legs, an armored torso with a glowing cockpit, arms and a
// shoulder cannon, painted in the pilot's color. About four and a half meters tall.
export function buildMech(color = '#7aa0c8', tier = 1) {
  const g = new THREE.Group();
  const M = (c, o = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35, ...o }); m.userData.paint = 0; return m; };
  const paint = M(new THREE.Color(color).lerp(new THREE.Color('#8a9098'), 0.35)), steel = M('#5a6068'), dark = M('#2e3238');
  const glow = new THREE.MeshBasicMaterial({ color: tier >= 4 ? '#ffb347' : '#8ae8ff' });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.75, 2.3, 0);
    g.add(leg);
    add(new THREE.BoxGeometry(0.55, 1.3, 0.7), paint, 0, -0.55, -0.15, 0.35, 0, 0, leg);
    add(new THREE.SphereGeometry(0.32, 10, 8), steel, 0, -1.15, -0.35, 0, 0, 0, leg);
    add(new THREE.BoxGeometry(0.4, 1.2, 0.45), steel, 0, -1.65, 0.05, -0.4, 0, 0, leg);
    add(new THREE.BoxGeometry(0.7, 0.25, 1.1), dark, 0, -2.2, -0.1, 0, 0, 0, leg);
    legs.push(leg);
  }
  add(new THREE.BoxGeometry(1.9, 1.3, 1.5), paint, 0, 3.0, 0);
  add(new THREE.BoxGeometry(1.5, 0.5, 1.2), steel, 0, 2.2, 0);
  add(new THREE.BoxGeometry(1.0, 0.55, 0.15), glow, 0, 3.25, -0.78);
  add(new THREE.BoxGeometry(2.3, 0.3, 1.2), steel, 0, 3.7, 0.05);
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(0.42, 10, 8), steel, sx * 1.25, 3.4, 0);
    add(new THREE.BoxGeometry(0.42, 1.2, 0.5), paint, sx * 1.35, 2.7, -0.15, 0.25);
    add(new THREE.BoxGeometry(0.36, 0.5, 0.9), dark, sx * 1.35, 2.05, -0.55);
  }
  // Shoulder cannon.
  add(new THREE.BoxGeometry(0.55, 0.5, 1.0), steel, 0.75, 4.15, 0.1);
  add(new THREE.CylinderGeometry(0.13, 0.16, 1.7, 10).rotateX(Math.PI / 2), dark, 0.75, 4.2, -0.9);
  add(new THREE.BoxGeometry(0.3, 0.12, 0.3), glow, -0.6, 3.95, 0.2);
  g.userData.legs = legs;
  g.userData.mech = true;
  return realism() ? realify(g, 'armor') : addInkHull(g);
}

// A werewolf in its night form: a hunched, shaggy wolf-man.
export function buildWerewolf(fur = '#6a5a4a') {
  const g = new THREE.Group();
  const M = (c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }); m.userData.paint = 0; return m; };
  const furM = M(fur), dark = M(new THREE.Color(fur).multiplyScalar(0.6)), claw = M('#e8e0d0');
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  add(new THREE.SphereGeometry(0.42, 14, 10).scale(1, 1.3, 0.85), furM, 0, 1.45, 0.05, 0.35);
  add(new THREE.SphereGeometry(0.3, 12, 8).scale(1.1, 0.9, 1), furM, 0, 1.0, 0.1);
  add(new THREE.SphereGeometry(0.2, 12, 10), furM, 0, 2.0, -0.25);
  add(new THREE.BoxGeometry(0.14, 0.12, 0.26), dark, 0, 1.95, -0.48);
  for (const sx of [-1, 1]) {
    add(new THREE.ConeGeometry(0.06, 0.18, 4), furM, sx * 0.1, 2.2, -0.2);
    add(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffc83a' }), sx * 0.07, 2.04, -0.42);
    add(new THREE.CylinderGeometry(0.09, 0.07, 0.9, 8), furM, sx * 0.45, 1.35, -0.1, 0.4, 0, sx * 0.2);
    for (let i = -1; i <= 1; i++) add(new THREE.ConeGeometry(0.02, 0.12, 4).rotateX(Math.PI), claw, sx * 0.5 + i * 0.03, 0.85, -0.32);
    add(new THREE.CylinderGeometry(0.12, 0.08, 0.55, 8), furM, sx * 0.2, 0.62, 0.05, -0.4);
    add(new THREE.CylinderGeometry(0.07, 0.05, 0.5, 8), dark, sx * 0.2, 0.22, 0.12, 0.4);
  }
  add(new THREE.ConeGeometry(0.08, 0.6, 6).rotateX(-1.1), furM, 0, 0.95, 0.45);
  g.scale.setScalar(1.15);
  return realism() ? realify(g, 'hide') : addInkHull(g);
}

// A chibi pilot: chibi proportions, a big expressive face, layered spiky hair in the pilot's
// color with a shine band, a flight jacket with a collar and a scarf trailing behind.
function buildChibiPerson(color, armor) {
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
  const hairColor = new THREE.Color(color);
  const jacket = M('#2b3456'), pants = M('#1e2236'), trim = M(color), white = M('#f4f2ee'), skin = M('#ffe3cf');
  const hairMat = M(hairColor), hairDark = M(hairColor.clone().multiplyScalar(0.7));
  const plate = M(armor > 60 ? '#e8c547' : armor > 20 ? '#c8d4e8' : '#6a7488', { roughness: 0.35, metalness: 0.3 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  // Legs and boots.
  for (const sx of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.1, 0.36, 4, 8), pants, sx * 0.13, 0.33, 0);
    add(new THREE.CapsuleGeometry(0.11, 0.12, 4, 8).rotateX(Math.PI / 2), white, sx * 0.13, 0.09, -0.05);
  }
  // Jacket body, belt, open collar.
  add(new THREE.CylinderGeometry(0.24, 0.3, 0.62, 12), jacket, 0, 0.86, 0);
  add(new THREE.CylinderGeometry(0.305, 0.305, 0.08, 12), trim, 0, 0.6, 0);
  add(new THREE.BoxGeometry(0.06, 0.5, 0.02), white, 0, 0.88, -0.27);
  add(new THREE.TorusGeometry(0.2, 0.06, 6, 14).rotateX(Math.PI / 2), white, 0, 1.15, 0);
  // Scarf: wrapped at the neck, two tails flying back.
  add(new THREE.TorusGeometry(0.17, 0.075, 8, 16).rotateX(Math.PI / 2), trim, 0, 1.2, 0);
  const tails = [];
  for (const sx of [-1, 1]) {
    const tail = add(new THREE.BoxGeometry(0.13, 0.04, 0.6).translate(0, 0, 0.3), trim, sx * 0.07, 1.17, 0.12, -0.5, sx * 0.25, 0);
    tails.push(tail);
  }
  // Arms; the right one reaches forward to hold the gun.
  add(new THREE.CapsuleGeometry(0.08, 0.38, 4, 8), jacket, -0.33, 0.88, 0, 0, 0, 0.18);
  add(new THREE.SphereGeometry(0.08, 8, 6), skin, -0.38, 0.62, 0);
  add(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), jacket, 0.31, 0.98, -0.19, 1.08, 0, 0);
  if (armor > 0) for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.8, 1), plate, sx * 0.31, 1.1, 0);
  // Head: large, slightly wide, with the face on -z.
  const hy = 1.62;
  add(new THREE.SphereGeometry(0.46, 22, 16).scale(1.05, 1, 1), skin, 0, hy, 0);
  for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.07, 8, 6).scale(0.6, 1, 0.6), skin, sx * 0.47, hy - 0.02, 0);
  for (const sx of [-1, 1]) {
    const eye = animeEye(0.14, color);
    eye.position.set(sx * 0.17, hy - 0.06, -0.41);
    eye.rotation.y = -sx * 0.28;
    g.add(eye);
    const brow = add(new THREE.BoxGeometry(0.14, 0.025, 0.02), hairDark, sx * 0.17, hy + 0.12, -0.42, 0, -sx * 0.28, sx * -0.12);
    brow.userData.noHull = true;
    const blush = add(new THREE.CircleGeometry(0.06, 12).scale(1.4, 0.7, 1), new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.55 }), sx * 0.25, hy - 0.2, -0.385, 0, Math.PI + sx * 0.5, 0);
  }
  const mouth = add(new THREE.TorusGeometry(0.035, 0.009, 4, 10, Math.PI), new THREE.MeshBasicMaterial({ color: '#5a2a30' }), 0, hy - 0.24, -0.44, 0, 0, Math.PI);
  mouth.userData.noHull = true;
  // Hair: a cap over the top and back, bangs over the forehead, side locks, back spikes, an ahoge.
  add(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.06, 1, 1.04), hairMat, 0, hy + 0.04, 0.03, 0.35, 0, 0);
  add(new THREE.SphereGeometry(0.49, 18, 10, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.4), hairMat, 0, hy, 0.04);
  const spike = (len, r = 0.11) => new THREE.ConeGeometry(r, len, 8).scale(1, 1, 0.6).translate(0, -len / 2, 0);
  for (const [x, rz, len] of [[-0.3, 0.35, 0.3], [-0.16, 0.15, 0.34], [0, -0.05, 0.3], [0.15, -0.2, 0.35], [0.3, -0.35, 0.28]]) {
    add(spike(len, 0.1), hairMat, x, hy + 0.36, -0.36, 0.3, 0, rz);
  }
  for (const sx of [-1, 1]) add(spike(0.55, 0.1), hairMat, sx * 0.42, hy + 0.1, -0.16, -0.1, 0, sx * 0.12);
  for (const [x, y, rx, rz, len] of [[0, 0.3, -0.9, 0, 0.5], [-0.25, 0.22, -0.8, 0.45, 0.45], [0.25, 0.22, -0.8, -0.45, 0.45], [-0.18, -0.05, -0.45, 0.25, 0.45], [0.18, -0.05, -0.45, -0.25, 0.45], [0, -0.02, -0.3, 0, 0.42]]) {
    add(spike(len, 0.13), hairMat, x, hy + y, 0.36, rx, 0, rz);
  }
  add(new THREE.TorusGeometry(0.12, 0.025, 5, 10, Math.PI * 1.2), hairMat, 0.05, hy + 0.58, -0.05, 0, Math.PI / 4, 0.3);
  // The anime "angel ring": a shine band across the hair.
  const ring = add(new THREE.TorusGeometry(0.495, 0.024, 4, 28, Math.PI).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: hairColor.clone().lerp(new THREE.Color('#ffffff'), 0.65) }), 0, hy + 0.22, 0.03);
  ring.userData.noHull = true;
  const gun = add(new THREE.BoxGeometry(0.1, 0.13, 0.55), M('#3a4058', { roughness: 0.4 }), 0.31, 0.86, -0.5);
  g.userData.gun = gun;
  g.userData.tails = tails;
  return addInkHull(g);
}

// The realistic pilot: a worn flight suit in the pilot's color, harness, boots and a sidearm.
const SKIN = ['#e8c4a8', '#d8a888', '#c08a68', '#9a6a4a', '#6a4a36', '#f0d0b8'];
function buildRealPerson(color, armor) {
  const suit = new THREE.Color(color);
  const hsl = {}; suit.getHSL(hsl);
  suit.setHSL(hsl.h, Math.min(hsl.s, 0.35), 0.32);
  return buildHuman({
    tunic: suit, pants: suit.clone().multiplyScalar(0.7), boots: '#2a2622', belt: '#3a3028',
    skin: pick(SKIN, color, 3), hair: pick(HAIR, color), eyes: pick(IRIS, color, 7), armor,
  });
}

export function buildPerson(color, armor = 0) {
  if (animeMode === 'chibi') return buildChibiPerson(color, armor);
  if (animeMode) return buildAnimePerson(color, armor);
  if (realism()) return buildRealPerson(color, armor);
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
export function buildCreature(color, size, seed = 1, shape = 'quad', def = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: shape === 'golem' ? '#d0a0ff' : '#ffe060' });
  const legs = [];
  const eyes = (y, z, spread = 0.25) => {
    for (const s of [-1, 1]) {
      if (animeMode === 'chibi') {
        const eye = animeEye(0.11 * size + 0.05, def.boss ? '#e83a3a' : shape === 'golem' ? '#b86bff' : '#e8a03a');
        eye.position.set(s * spread * size * 1.1, y, z - 0.02);
        g.add(eye);
        continue;
      }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09 * size + 0.04, 6, 6), eyeMat);
      eye.position.set(s * spread * size, y, z);
      g.add(eye);
    }
  };
  if (shape === 'crab') {
    const body = new THREE.Mesh(lumpy(0.7, 1, seed, 0.2), mat);
    body.scale.set(size * 1.5, size * 0.55, size * 1.1);
    body.position.y = size * 0.7;
    g.add(body);
    eyes(size * 1.05, -0.75 * size, 0.3);
    for (const s of [-1, 1]) {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.5 * size, 0.35 * size, 0.8 * size), mat);
      claw.position.set(s * 0.9 * size, size * 0.8, -1.1 * size);
      g.add(claw);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9 * size, 0.12 * size, 0.12 * size), mat);
        leg.position.set(s * 1.2 * size, size * 0.4, (i - 1) * 0.5 * size);
        leg.rotation.z = s * -0.5;
        g.add(leg);
        legs.push(leg);
      }
    }
  } else if (shape === 'tentacled') {
    const body = new THREE.Mesh(lumpy(0.8, 1, seed, 0.3), new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true, emissive: color, emissiveIntensity: 0.15 }));
    body.scale.set(size, size * 1.1, size);
    body.position.y = size * 1.6;
    g.add(body);
    eyes(size * 1.8, -0.75 * size, 0.25);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * size, 0.18 * size, 1.6 * size, 5), mat);
      t.position.set(Math.cos(a) * 0.55 * size, size * 0.75, Math.sin(a) * 0.55 * size);
      t.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      g.add(t);
      legs.push(t);
    }
    g.userData.sway = true;
  } else if (shape === 'strider') {
    const body = new THREE.Mesh(lumpy(0.5, 1, seed, 0.2), mat);
    body.scale.set(size * 0.9, size * 0.6, size * 1.3);
    body.position.y = size * 3.2;
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * size, 0.12 * size, 1.2 * size, 5), mat);
    neck.position.set(0, size * 3.7, -0.7 * size);
    neck.rotation.x = 0.6;
    g.add(neck);
    eyes(size * 4.2, -1.05 * size, 0.12);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * size, 0.09 * size, 3.3 * size, 5), mat);
      leg.position.set(lx * 0.45 * size, size * 1.6, lz * 0.5 * size);
      g.add(leg);
      legs.push(leg);
    }
  } else if (shape === 'alien') {
    const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: def.accent || '#ffffff', roughness: 0.4, emissive: def.accent || '#000000', emissiveIntensity: 0.25 });
    const tall = def.head === 'tall' ? 1.25 : 1;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8 * tall, 4, 8), skin);
    torso.scale.setScalar(size);
    torso.position.y = size * 1.15 * tall;
    g.add(torso);
    const hy = size * (1.95 * tall);
    let head;
    if (def.head === 'insect') head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6).scale(1, 0.8, 1.4), skin);
    else if (def.head === 'orb') head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
    else if (def.head === 'stone') head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), skin);
    else if (def.head === 'tentacle') head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8).scale(1, 1.3, 1), skin);
    else head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8).scale(1, def.head === 'tall' ? 1.6 : 1, 1), skin);
    head.scale.multiplyScalar(size);
    head.position.y = hy;
    g.add(head);
    if (def.head === 'crest') {
      const crest = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 4), trim);
      crest.scale.setScalar(size);
      crest.position.set(0, hy + 0.35 * size, 0.1 * size);
      crest.rotation.x = -0.6;
      g.add(crest);
    }
    if (def.head === 'insect') for (const s of [-1, 1]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 3), trim);
      ant.scale.setScalar(size);
      ant.position.set(s * 0.12 * size, hy + 0.35 * size, -0.2 * size);
      ant.rotation.z = s * 0.4;
      g.add(ant);
    }
    if (def.head === 'tentacle') for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.6, 4), skin);
      t.scale.setScalar(size);
      t.position.set((i - 1.5) * 0.12 * size, hy - 0.45 * size, -0.2 * size);
      g.add(t);
    }
    if (def.head !== 'orb') eyes(hy + 0.02 * size, -0.24 * size, 0.1);
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.15, 0.4), trim);
    sash.scale.setScalar(size);
    sash.position.y = size * 1.25 * tall;
    g.add(sash);
    for (let k = 0; k < (def.arms || 2) / 2; k++) for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), skin);
      arm.scale.setScalar(size);
      arm.position.set(s * 0.42 * size, size * (1.35 - k * 0.3) * tall, 0);
      arm.rotation.z = s * (0.15 + k * 0.4);
      g.add(arm);
    }
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8 * tall, 0.16), skin);
      leg.scale.setScalar(size);
      leg.position.set(s * 0.16 * size, 0.4 * size * tall, 0);
      g.add(leg);
      legs.push(leg);
    }
  } else if (shape === 'serpent') {
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
  return animeMode ? addInkHull(g) : realism() ? realify(g, 'hide') : g;
}

// A structure from the content library's part list. '@god' colors take the shrine's god color.
export function buildStructure(def, godColor, raceColors = null) {
  const g = new THREE.Group();
  const mats = new Map();
  const matFor = (color, glow) => {
    const c = color === '@god' ? godColor || '#b86bff' : color === '@race' ? raceColors?.color || '#8a9aa8' : color === '@accent' ? raceColors?.accent || '#ffffff' : color;
    const key = c + (glow ? '!' : '');
    if (!mats.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.1, flatShading: true, emissive: glow ? c : '#000000', emissiveIntensity: glow ? 0.9 : 0 });
      // Muted, unlit parts are masonry: the anime style draws stonework on them.
      const hsl = {}; new THREE.Color(c).getHSL(hsl);
      if (!glow && hsl.s < 0.3 && hsl.l > 0.15) m.userData.stone = 1.25;
      if (!glow && realism()) { m.flatShading = false; realSurface(m, m.userData.stone ? { normal: 'rock', scale: 0.3, strength: 1.2, dirt: 0.3 } : { normal: 'scratched', scale: 0.6, strength: 0.7, dirt: 0.25 }); }
      mats.set(key, m);
    }
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
      const sp = glowSprite(color === '@god' ? godColor || '#b86bff' : color === '@accent' ? raceColors?.accent || '#ffffff' : color === '@race' ? raceColors?.color || '#8a9aa8' : color, Math.max(a, b || 0, c || 0) * 3, 0.5);
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
  realSurface(metal, { normal: 'metal', scale: 0.06, strength: 0.8, dirt: 0.25, local: true });
  realSurface(dark, { normal: 'metal', scale: 0.05, strength: 0.9, dirt: 0.3, local: true });
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
  realSurface(white, { normal: 'plaster', scale: 0.04, strength: 0.7, dirt: 0.2, local: true });
  realSurface(gold, { normal: 'scratched', scale: 0.05, strength: 0.5, dirt: 0.1, local: true });
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
