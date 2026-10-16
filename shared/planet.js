// Planet surfaces. Each landable planet has a bounded surface generated from its seed, with
// player digging stored as per-vertex height deltas and structures as blocks, both persisted.

import { fbm, mulberry32, hash2, range } from './rng.js';

export const SURFACE_HALF = 400;   // surface spans [-400, 400] on x and z
export const CELL = 4;             // terrain vertex spacing
export const VERTS = (SURFACE_HALF * 2) / CELL + 1;
export const MAX_DIG = 24;
export const SETTLEMENT_RADIUS = 70;

export const SURFACE_PROFILES = {
  Rocky:  { amp: 42, rough: 9,  water: null, low: '#5e5249', mid: '#7d6c5f', high: '#a39383', sky: '#8a7f78', fog: '#9b8f86', liquid: null,      ore: [['iron', 6], ['copper', 3], ['gold', 1]], flora: 'rock',   creature: { name: 'Rock Crawler', color: '#7a6a58', hp: 50, dmg: 8, speed: 7, size: 1.3 } },
  Ice:    { amp: 28, rough: 6,  water: -6,   low: '#9fc4d8', mid: '#d6ecf7', high: '#ffffff', sky: '#bcd7ea', fog: '#d4e6f2', liquid: '#7fb8d8', ore: [['ice', 7], ['iron', 2], ['voidstone', 0.3]], flora: 'spike', creature: { name: 'Frost Stalker', color: '#cfe8ff', hp: 60, dmg: 10, speed: 9, size: 1.2 } },
  Lava:   { amp: 38, rough: 10, water: -8,   low: '#2a1a14', mid: '#3d2a22', high: '#5a4033', sky: '#5a2a1a', fog: '#6b3020', liquid: '#ff5a1a', ore: [['copper', 5], ['gold', 3], ['voidstone', 0.8]], flora: 'rock', creature: { name: 'Magma Hound', color: '#ff7a3a', hp: 80, dmg: 14, speed: 10, size: 1.4 } },
  Ocean:  { amp: 30, rough: 5,  water: 4,    low: '#c9b98a', mid: '#4f8f4a', high: '#7a8a6a', sky: '#8fc4f0', fog: '#a9d2f2', liquid: '#2a6fb0', ore: [['ice', 4], ['iron', 3], ['copper', 2]], flora: 'palm', creature: { name: 'Reef Lurker', color: '#3fb0a0', hp: 55, dmg: 9, speed: 8, size: 1.2 } },
  Jungle: { amp: 34, rough: 7,  water: -4,   low: '#3a5a2a', mid: '#3f7a3a', high: '#6a8a5a', sky: '#9fd0c0', fog: '#a8d8c0', liquid: '#2a7a6a', ore: [['iron', 5], ['copper', 3], ['gold', 1]], flora: 'tree', creature: { name: 'Vine Beast', color: '#5a9a3a', hp: 65, dmg: 11, speed: 8.5, size: 1.5 } },
  Desert: { amp: 22, rough: 4,  water: null, low: '#c99a5b', mid: '#d8b27a', high: '#e8cf9a', sky: '#f0d8a8', fog: '#f0dcb0', liquid: null,      ore: [['iron', 4], ['gold', 2], ['copper', 2]], flora: 'cactus', creature: { name: 'Dune Skitter', color: '#c08a4a', hp: 45, dmg: 9, speed: 11, size: 1.1 } },
};

export const STARTER_CREATURE = { name: 'Glowmoth', color: '#a0ffd0', hp: 25, dmg: 4, speed: 6, size: 0.9 };

export function profileOf(planet) {
  return SURFACE_PROFILES[planet.type] || SURFACE_PROFILES.Rocky;
}

export function creatureOf(planet) {
  if (planet.starter) return STARTER_CREATURE;
  const c = profileOf(planet).creature;
  const k = 0.6 + 0.4 * planet.richness;
  return { ...c, hp: Math.round(c.hp * k), dmg: Math.round(c.dmg * k * 10) / 10 };
}

const clearRadius = (planet) => (planet.starter ? SETTLEMENT_RADIUS : 36);

export function baseHeight(planet, x, z) {
  const p = profileOf(planet), s = planet.seed | 0;
  const n = fbm(x / 220 + 50, z / 220 + 50, s, 5);
  const ridge = 1 - Math.abs(fbm(x / 90, z / 90, s + 7, 3) * 2 - 1);
  let h = (n - 0.5) * p.amp * 2.4 + ridge * p.rough;
  const r = Math.hypot(x, z), cr = clearRadius(planet);
  const flat = Math.max((p.water ?? 0) + 3, 2);
  if (r < cr * 1.8) {
    const t = Math.max(0, Math.min(1, (r - cr) / (cr * 0.8)));
    const k = t * t * (3 - 2 * t);
    h = flat + (h - flat) * k;
  }
  // Rising walls at the edge of the playable area.
  const edge = Math.max(Math.abs(x), Math.abs(z)) - (SURFACE_HALF - 40);
  if (edge > 0) h += edge * edge * 0.08;
  return h;
}

export const vkey = (ix, iz) => `${ix},${iz}`;

export function vertexHeight(planet, ix, iz, digs) {
  return baseHeight(planet, ix * CELL, iz * CELL) + ((digs && digs[vkey(ix, iz)]) || 0);
}

// Bilinear height of the (possibly dug) terrain at any point; used for walking and placement.
export function heightAt(planet, x, z, digs) {
  const fx = x / CELL, fz = z / CELL;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = vertexHeight(planet, ix, iz, digs), b = vertexHeight(planet, ix + 1, iz, digs);
  const c = vertexHeight(planet, ix, iz + 1, digs), d = vertexHeight(planet, ix + 1, iz + 1, digs);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// Ground height for standing on: liquid is solid enough to wade on top of.
export function standHeight(planet, x, z, digs) {
  const h = heightAt(planet, x, z, digs);
  const w = profileOf(planet).water;
  return w != null ? Math.max(h, w - 1.2) : h;
}

// Ore deposits: glowing crystal clusters, richer than ordinary digging.
const depositCache = new Map();
export function deposits(planet) {
  let list = depositCache.get(planet.id);
  if (list) return list;
  const rng = mulberry32(hash2(planet.seed | 0, 77, 5));
  const p = profileOf(planet);
  const rare = [['gold', 3], ['voidstone', 0.4 + planet.richness * 0.3], ...p.ore];
  list = [];
  for (let i = 0; i < 40; i++) {
    const x = range(rng, -SURFACE_HALF + 50, SURFACE_HALF - 50), z = range(rng, -SURFACE_HALF + 50, SURFACE_HALF - 50);
    if (Math.hypot(x, z) < clearRadius(planet) + 10) continue;
    let total = 0;
    for (const [, w] of rare) total += w;
    let r = rng() * total, ore = rare[0][0];
    for (const [o, w] of rare) { r -= w; if (r <= 0) { ore = o; break; } }
    list.push({ id: `d${i}`, x, z, ore, amount: 30 });
  }
  depositCache.set(planet.id, list);
  return list;
}

export function digOre(planet, x, z) {
  const p = profileOf(planet);
  const rng = mulberry32(hash2(Math.floor(x), Math.floor(z), planet.seed | 0));
  let total = 0;
  for (const [, w] of p.ore) total += w;
  let r = rng() * total;
  for (const [o, w] of p.ore) { r -= w; if (r <= 0) return o; }
  return p.ore[0][0];
}

export function landingSpot(planet) {
  return planet.starter ? [0, 34] : [0, 0];
}

// Haven Landing: the settlement where every new pilot starts.
export const SETTLEMENT = {
  buildings: [
    { x: -26, z: -18, w: 14, d: 10, h: 8,  color: '#d8dde6', name: 'Barracks' },
    { x: 22,  z: -22, w: 12, d: 12, h: 10, color: '#c8d6e8', name: 'Trade Hall' },
    { x: -30, z: 16,  w: 10, d: 10, h: 6,  color: '#e0d6c8', name: 'Workshop' },
    { x: 0,   z: -40, w: 8,  d: 8,  h: 22, color: '#b8c8e0', name: 'Comms Tower' },
    { x: 30,  z: 14,  w: 9,  d: 14, h: 7,  color: '#d0d8d0', name: 'Hangar' },
  ],
  vendor: { x: 22, z: -12, name: 'Quartermaster Oren' },
  warden: { x: -12, z: 0, name: 'Warden Ilse' },
  pad: { x: 0, z: 34, r: 12 },
};

export function floraFor(planet, tx, tz) {
  const p = profileOf(planet);
  const rng = mulberry32(hash2(tx, tz, (planet.seed | 0) + 13));
  const n = { tree: 7, palm: 3, rock: 3, spike: 3, cactus: 2 }[p.flora] || 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = tx * 40 + rng() * 40, z = tz * 40 + rng() * 40;
    if (Math.hypot(x, z) < clearRadius(planet) + 6) continue;
    if (Math.max(Math.abs(x), Math.abs(z)) > SURFACE_HALF - 30) continue;
    out.push({ x, z, s: 0.7 + rng() * 0.8, r: rng() * Math.PI * 2, kind: p.flora, v: rng() });
  }
  return out;
}

export const skyColor = (planet) => profileOf(planet).sky;
