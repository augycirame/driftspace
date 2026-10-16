// Town architecture. Each people builds in its own style: timber halls with thatched roofs and
// round stone keeps (humans), white spires with teal roofs and lanterns (elves), squat stone
// halls with forge chimneys (dwarves), gothic manors with spires (vampires) and log longhouses
// with totems (werewolf clans). Parts are merged per material so a town is a handful of meshes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from '/shared/planet.js';
import { hashString } from '/shared/rng.js';
import { realism, realSurface } from './realism.js';

export const realmColor = (realmId) => `hsl(${hashString(realmId) % 360}, 55%, 42%)`;

const MATS = {
  stone: ['#9a968c', { stone: 1.1 }], darkstone: ['#5a5460', { stone: 1.2 }], whitestone: ['#ece6da', {}], dwarfstone: ['#857a70', { stone: 0.9 }],
  plaster: ['#e8dcc0', {}], timber: ['#5a4030', {}], wood: ['#7a5a3a', {}], logs: ['#6a4a30', {}], thatch: ['#d6b45e', {}],
  slate: ['#2e2a34', {}], teal: ['#3f8a86', {}], gold: ['#d8b048', { metal: true }], bronze: ['#a8783a', { metal: true }], iron: ['#4a4a50', { metal: true }],
  turf: ['#6e6a40', {}], fur: ['#8a7a60', {}], bone: ['#e8dcc4', {}], soil: ['#6a4a32', {}], crop: ['#7aa04a', {}], cloth: ['#c8a050', {}],
  glow: ['#ffd890', { glow: 0.7 }], redglow: ['#ff4a4a', { glow: 0.6 }], blueglow: ['#bfeaff', { glow: 0.9 }], ember: ['#ff8a3a', { glow: 1 }],
};

// What each material looks like up close in the realistic style: [normal map, scale, strength, weathering].
const REAL = {
  stone: ['cobble', 0.32, 1.2, 0.3], darkstone: ['cobble', 0.32, 1.2, 0.3], dwarfstone: ['rock', 0.25, 1.2, 0.3], whitestone: ['plaster', 0.4, 0.6, 0.18],
  plaster: ['plaster', 0.5, 0.8, 0.25], timber: ['wood', 0.6, 1, 0.25], wood: ['planks', 0.4, 1, 0.22], logs: ['bark', 0.5, 1.2, 0.25],
  thatch: ['bark', 1.4, 1.3, 0.35], slate: ['tiles', 0.45, 1, 0.2], teal: ['tiles', 0.45, 0.9, 0.2], gold: ['scratched', 1, 0.5, 0.1],
  bronze: ['scratched', 1, 0.6, 0.15], iron: ['scratched', 1, 0.7, 0.2], turf: ['ground', 0.4, 1, 0.3], fur: ['fabric', 2, 1, 0.2],
  bone: ['cracked', 0.8, 0.7, 0.2], soil: ['mud', 0.3, 1, 0.3], crop: ['ground', 0.6, 1, 0.3], cloth: ['fabric', 1.5, 0.8, 0.18],
};

function material(key, color) {
  const [c, o] = MATS[key] || [color, {}];
  const real = realism();
  const m = new THREE.MeshStandardMaterial({ color: color || c, roughness: o.metal ? 0.45 : 0.9, metalness: o.metal ? (real ? 0.85 : 0.4) : 0, flatShading: !!o.stone && !real, emissive: o.glow ? c : '#000000', emissiveIntensity: (o.glow || 0) * (real ? 2 : 1) });
  if (o.stone) m.userData.stone = o.stone;
  const r = real && !o.glow && (REAL[key] || ['fabric', 1, 0.8, 0.18]);
  if (r) realSurface(m, { normal: r[0], scale: r[1], strength: r[2], dirt: r[3] });
  return m;
}

// Collects transformed geometry per material, then merges it.
class Kit {
  constructor() { this.parts = new Map(); this.frame = new THREE.Matrix4(); }
  at(x, y, z, rot) { this.frame.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1)); return this; }
  put(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color = null) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.frame, m));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const key = color ? `${mat}|${color}` : mat;
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
  }
  build() {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const [mat, color] = key.split('|');
      const mesh = new THREE.Mesh(mergeGeometries(geos), material(mat, color));
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
// A gable roof: a triangular prism running front to back (along z).
function gable(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// ---- buildings by style -----------------------------------------------------------------------

function timberHouse(k, b, banner) {
  const { w, d, h } = b;
  k.put('stone', box(w + 0.4, 1.4, d + 0.4), 0, 0.2, 0);
  k.put('plaster', box(w, h, d), 0, h / 2 + 0.8, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.put('timber', box(0.35, h, 0.35), sx * w / 2, h / 2 + 0.8, sz * d / 2);
  for (const sz of [-1, 1]) k.put('timber', box(w + 0.1, 0.3, 0.3), 0, h * 0.55 + 0.8, sz * d / 2);
  for (const sx of [-1, 1]) k.put('timber', box(0.3, 0.3, d + 0.1), sx * w / 2, h * 0.55 + 0.8, 0);
  // Diagonal braces on the front, like a timber-framed hall.
  for (const sx of [-1, 1]) k.put('timber', box(0.22, h * 0.62, 0.22), sx * w * 0.3, h * 0.27 + 0.8, d / 2 + 0.05, 0, 0, sx * 0.55);
  k.put('thatch', gable(w + 1.6, h * 0.75 + 1.2, d + 1.4), 0, h + 0.8, 0);
  k.put('wood', box(1.4, 2.4, 0.2), 0, 2, d / 2 + 0.1);
  for (const sx of [-1, 1]) k.put('glow', box(1.1, 0.8, 0.12), sx * w * 0.3, h * 0.72 + 0.8, d / 2 + 0.05);
  if (b.kind === 'hall' || b.kind === 'tavern') for (const sx of [-1, 1]) {
    k.put('timber', cyl(0.08, 0.08, 5, 6), sx * (w / 2 + 1.2), 2.5, d / 2 + 1.2);
    k.put('cloth', box(1.2, 2.6, 0.06), sx * (w / 2 + 1.2), 3.4, d / 2 + 1.25, 0, 0, 0, banner);
  }
  if (b.w > 7) k.put('stone', box(0.9, 2.4, 0.9), w * 0.3, h + 1.6, -d * 0.2);
}

function roundKeep(k, b, banner) {
  const r = b.w * 0.42, h = b.h + 4;
  k.put('stone', cyl(r, r * 1.08, h, 20), 0, h / 2, 0);
  k.put('stone', cyl(r * 1.08, r * 1.08, 0.8, 20), 0, h * 0.62, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.put('stone', box(1.1, 1.2, 0.8), Math.cos(a) * r * 0.95, h + 0.6, Math.sin(a) * r * 0.95, 0, -a, 0);
  }
  k.put('wood', box(1.8, 3, 0.4), 0, 1.6, r * 0.98);
  k.put('stone', cyl(1.3, 1.3, 0.4, 12).rotateX(Math.PI / 2), 0, 3.1, r * 0.98);
  k.put('timber', cyl(0.08, 0.08, 6, 6), r * 0.5, h + 3, -r * 0.3);
  k.put('cloth', box(2.2, 1.2, 0.06), r * 0.5 + 1.1, h + 5.2, -r * 0.3, 0, 0, 0, banner);
  for (const sx of [-1, 1]) {
    k.put('timber', cyl(0.1, 0.1, 6, 6), sx * 3.2, 3, r + 2.5);
    k.put('cloth', box(1.3, 3, 0.06), sx * 3.2, 3.6, r + 2.56, 0, 0, 0, banner);
  }
}

function elvenHouse(k, b, banner) {
  const r = Math.min(b.w, b.d) * 0.45, h = b.h + 1;
  k.put('whitestone', cyl(r, r * 1.05, h, 16), 0, h / 2, 0);
  k.put('gold', cyl(r * 1.06, r * 1.06, 0.3, 16), 0, h, 0);
  k.put('teal', cyl(0, r * 1.25, h * 0.9, 16), 0, h + h * 0.45, 0);
  k.put('wood', box(1.2, 2.4, 0.3), 0, 1.2, r * 0.98);
  k.put('blueglow', box(0.8, 1.2, 0.1), r * 0.7, h * 0.65, r * 0.7, 0, Math.PI / 4, 0);
  k.put('blueglow', new THREE.SphereGeometry(0.3, 8, 6), r + 1, 2.6, r * 0.4);
  k.put('whitestone', cyl(0.08, 0.1, 2.4, 6), r + 1, 1.2, r * 0.4);
  if (b.kind === 'hall' || b.kind === 'keep') {
    k.put('whitestone', cyl(1.4, 1.8, h * 2.4, 12), r * 0.6, h * 1.2, -r * 0.4);
    k.put('teal', cyl(0, 2, 5, 12), r * 0.6, h * 2.4 + 2.5, -r * 0.4);
    k.put('cloth', box(0.9, 3, 0.05), r * 0.6, h * 1.7, -r * 0.4 + 1.85, 0, 0, 0, banner);
  }
}

function dwarfHall(k, b, banner) {
  const { w, d } = b, h = b.h * 0.8;
  k.put('dwarfstone', box(w + 1, h, d + 1), 0, h / 2, 0);
  k.put('dwarfstone', box(w + 2.2, 0.9, d + 2.2), 0, h + 0.45, 0);
  k.put('dwarfstone', box(w * 0.6, 0.8, d * 0.6), 0, h + 1.3, 0);
  k.put('bronze', box(2.2, 3, 0.3), 0, 1.5, d / 2 + 0.55);
  k.put('dwarfstone', box(3.2, 0.7, 0.8), 0, 3.3, d / 2 + 0.6);
  for (const sx of [-1, 1]) k.put('dwarfstone', box(0.9, 3.6, 0.9), sx * 1.9, 1.8, d / 2 + 0.7);
  k.put('dwarfstone', box(1.4, 3.5, 1.4), w * 0.3, h + 1.6, -d * 0.25);
  k.put('ember', box(1, 0.3, 1), w * 0.3, h + 3.4, -d * 0.25);
  k.put('glow', box(1, 0.6, 0.1), -w * 0.3, h * 0.6, d / 2 + 0.52);
  if (b.kind === 'hall' || b.kind === 'keep') for (const sx of [-1, 1]) {
    k.put('dwarfstone', cyl(0.6, 0.7, h + 1, 8), sx * (w / 2 + 0.6), (h + 1) / 2, d / 2 + 1.4);
    k.put('cloth', box(1.4, 3.2, 0.06), sx * (w / 2 - 1.2), h * 0.55, d / 2 + 0.55, 0, 0, 0, banner);
  }
}

function gothicManor(k, b, banner) {
  const { w, d, h } = b;
  k.put('darkstone', box(w, h + 1, d), 0, (h + 1) / 2, 0);
  k.put('slate', gable(w + 0.8, h * 1.1, d + 0.8), 0, h + 1, 0);
  for (const sx of [-1, 1]) {
    k.put('darkstone', cyl(0.9, 1, h * 1.6, 8), sx * w / 2, h * 0.8, d / 2);
    k.put('slate', cyl(0, 1.2, 3.4, 8), sx * w / 2, h * 1.6 + 1.7, d / 2);
    k.put('redglow', box(0.7, 1.6, 0.1), sx * w * 0.22, h * 0.6, d / 2 + 0.05);
  }
  k.put('iron', box(1.6, 2.8, 0.2), 0, 1.4, d / 2 + 0.1);
  if (b.kind === 'hall' || b.kind === 'keep') {
    k.put('darkstone', cyl(1.4, 1.6, h * 2.6, 8), 0, h * 1.3, -d * 0.3);
    k.put('slate', cyl(0, 1.9, 5, 8), 0, h * 2.6 + 2.5, -d * 0.3);
    k.put('cloth', box(1.2, 3.4, 0.06), 0, h * 1.4, -d * 0.3 + 1.5, 0, 0, 0, banner);
  }
}

function clanLonghouse(k, b, banner) {
  const { w, d, h } = b;
  k.put('logs', box(w, h * 0.55, d), 0, h * 0.275, 0);
  k.put('turf', gable(w + 1.8, h * 1.05, d + 1), 0, h * 0.55 - 0.3, 0);
  k.put('wood', box(1.4, 2.2, 0.2), 0, 1.1, d / 2 + 0.1);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) k.put('timber', box(0.3, 1.6, 0.3), sx * 0.6, h * 1.4, sz * (d / 2 + 0.4), 0, 0, sx * 0.5);
  k.put('bone', new THREE.SphereGeometry(0.35, 8, 6), 0, h * 0.55 + h * 1.05 - 0.1, d / 2 + 0.5);
  if (b.kind === 'hall' || b.kind === 'keep') for (const sx of [-1, 1]) {
    k.put('timber', cyl(0.12, 0.12, 5, 6), sx * (w / 2 + 1), 2.5, d / 2 + 1);
    k.put('fur', box(1.4, 2.2, 0.08), sx * (w / 2 + 1), 3.6, d / 2 + 1.06, 0, 0, 0, banner);
  }
}

const STYLES = { timber: timberHouse, elven: elvenHouse, dwarven: dwarfHall, gothic: gothicManor, clan: clanLonghouse };

function special(k, b, banner) {
  const style = b.style;
  if (b.kind === 'keep' && (style === 'timber' || style === 'clan')) return roundKeep(k, b, banner);
  if (b.kind === 'well') {
    k.put(style === 'gothic' ? 'darkstone' : 'stone', cyl(1.2, 1.3, 1, 12), 0, 0.5, 0);
    for (const sx of [-1, 1]) k.put('timber', box(0.2, 2.4, 0.2), sx * 1, 1.6, 0);
    k.put(style === 'elven' ? 'teal' : 'thatch', gable(2.8, 1, 2), 0, 2.8, 0);
    return;
  }
  if (b.kind === 'totem') {
    for (let i = 0; i < 4; i++) k.put(i % 2 ? 'wood' : 'timber', cyl(0.55 - i * 0.05, 0.6 - i * 0.05, 1.2, 8), 0, 0.6 + i * 1.2, 0);
    k.put('bone', new THREE.SphereGeometry(0.5, 8, 6), 0, 5.3, 0);
    for (const sx of [-1, 1]) k.put('bone', cyl(0.05, 0.15, 1, 6), sx * 0.6, 5.5, 0, 0, 0, sx * 0.9);
    return;
  }
  if (b.kind === 'field') {
    k.put('soil', box(b.w, 0.3, b.d), 0, 0.05, 0);
    for (let i = 0; i < 6; i++) k.put('crop', box(b.w * 0.92, 0.5, 0.5), 0, 0.35, -b.d / 2 + 1 + i * (b.d - 2) / 5);
    return;
  }
  if (b.kind === 'market') {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 3;
      k.put('wood', box(2.2, 1, 1.2), x, 0.5, 0);
      for (const sx of [-1, 1]) k.put('timber', box(0.12, 2.6, 0.12), x + sx * 1.05, 1.3, -0.5);
      k.put('cloth', box(2.6, 0.12, 1.8), x, 2.6, 0, 0.2, 0, 0, ['#c84a3a', '#3a7ac8', '#e8c040'][i]);
    }
    return;
  }
  if (b.kind === 'smithy') {
    k.put(style === 'elven' ? 'whitestone' : 'stone', box(b.w, 1, b.d), 0, 0.5, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.put('timber', box(0.3, 3.4, 0.3), sx * b.w * 0.45, 2.7, sz * b.d * 0.45);
    k.put(style === 'gothic' ? 'slate' : style === 'elven' ? 'teal' : 'thatch', gable(b.w + 1, 2, b.d + 1), 0, 4.4, 0);
    k.put('stone', box(1.8, 1.4, 1.8), -b.w * 0.25, 1.7, -b.d * 0.2);
    k.put('ember', box(1.2, 0.3, 1.2), -b.w * 0.25, 2.45, -b.d * 0.2);
    k.put('iron', box(1, 0.8, 0.5), b.w * 0.15, 1.4, 0.4);
    return;
  }
  if (b.kind === 'temple' && style !== 'gothic') {
    const mat = style === 'elven' ? 'whitestone' : style === 'dwarven' ? 'dwarfstone' : 'stone';
    k.put(mat, box(b.w, b.h, b.d), 0, b.h / 2, 0);
    k.put(style === 'elven' ? 'teal' : 'slate', gable(b.w + 1, 3.5, b.d + 1), 0, b.h, 0);
    k.put(mat, box(1.6, 4, 1.6), 0, b.h + 4, -b.d * 0.3);
    k.put('gold', cyl(0, 0.9, 2.4, 6), 0, b.h + 7.2, -b.d * 0.3);
    k.put('wood', box(1.8, 3, 0.2), 0, 1.5, b.d / 2 + 0.1);
    k.put('glow', box(0.8, 2, 0.1), 0, b.h * 0.7, b.d / 2 + 0.05);
    return;
  }
  STYLES[style](k, b, banner);
}

// A whole town as one group, with its walls and a name banner over the hall.
export function buildTown(planet, town, realmId) {
  const banner = realmColor(realmId);
  const k = new Kit();
  const base = heightAt(planet, town.x, town.z);
  for (const b of town.buildings) {
    k.at(b.x, base - 0.6, b.z, b.rot);
    special(k, b, banner);
  }
  for (const w of town.walls) {
    k.at(w.x, base - 0.6, w.z, w.rot);
    if (w.stone) {
      k.put('stone', box(1.3, w.h, w.len), 0, w.h / 2, 0);
      for (let i = 0; i < Math.floor(w.len / 2); i++) k.put('stone', box(1.5, 0.9, 0.9), 0, w.h + 0.45, -w.len / 2 + 1 + i * 2);
    } else {
      k.put('logs', box(0.9, w.h, w.len), 0, w.h / 2, 0);
      for (let i = 0; i < Math.floor(w.len / 1.2); i++) k.put('wood', cyl(0, 0.45, 1, 5), 0, w.h + 0.5, -w.len / 2 + 0.6 + i * 1.2);
    }
  }
  const group = k.build();
  group.userData.base = base;
  return group;
}
