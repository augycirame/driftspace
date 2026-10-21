// Planet surfaces. Each landable planet has a bounded surface generated from its seed, with
// player digging stored as per-vertex height deltas and structures as blocks, both persisted.

import { fbm, mulberry32, hash2, range } from './rng.js';
import { TERRAINS, TERRAIN_IDS } from './content/terrains.js';
import { CREATURES, CREATURE_IDS } from './content/creatures.js';
import { STRUCTURES, STRUCTURE_IDS } from './content/structures.js';
import { GODS, GOD_IDS } from './content/factions.js';
import { ALIEN_RACES } from './content/aliens.js';
import { townsOf } from './towns.js';

export const SURFACE_HALF = 400;   // surface spans [-400, 400] on x and z
export const CELL = 4;             // terrain vertex spacing
export const VERTS = (SURFACE_HALF * 2) / CELL + 1;
export const MAX_DIG = 24;
export const SETTLEMENT_RADIUS = 70;

// What a planet is like is drawn from the content library (shared/content): its terrain,
// its wildlife and its structures. All of it is a pure function of the planet's seed.

// Small bounded caches: generation is deterministic, so anything evicted is just rebuilt.
const remember = (cache, key, value) => {
  if (cache.size > 4000) cache.clear();
  cache.set(key, value);
  return value;
};

const pickWeighted = (rng, entries) => {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1][0];
};

const terrainCache = new Map();
export function terrainOf(planet) {
  let id = terrainCache.get(planet.id);
  if (id) return id;
  if (planet.starter) id = 'havenMeadows';
  else if (planet.holy) id = 'sacredGardens';
  else {
    const options = TERRAIN_IDS.filter((t) => TERRAINS[t].planetTypes[planet.type]).map((t) => [t, TERRAINS[t].planetTypes[planet.type]]);
    id = options.length ? pickWeighted(mulberry32(hash2(planet.seed | 0, 101, 3)), options) : 'highlands';
  }
  remember(terrainCache, planet.id, id);
  return id;
}

export function profileOf(planet) {
  return TERRAINS[terrainOf(planet)];
}

const tagsMatch = (tags, terrainTags) => tags.includes('any') || tags.some((t) => terrainTags.includes(t));

// The wildlife of a planet: up to three species whose habitat matches its terrain.
const faunaCache = new Map();
export function faunaOf(planet) {
  let list = faunaCache.get(planet.id);
  if (list) return list;
  if (planet.starter) list = ['glowmoth'];
  else {
    const tags = profileOf(planet).tags;
    const rng = mulberry32(hash2(planet.seed | 0, 202, 5));
    let pool = CREATURE_IDS.filter((c) => !['guardian', 'soldier'].includes(CREATURES[c].behavior) && CREATURES[c].tags.some((t) => tags.includes(t)));
    list = [];
    const n = Math.min(pool.length, 1 + Math.floor(rng() * 3));
    for (let i = 0; i < n; i++) {
      const c = pickWeighted(rng, pool.map((id) => [id, CREATURES[id].rarity]));
      list.push(c);
      pool = pool.filter((x) => x !== c);
    }
    if (!list.length) list = ['rockCrawler'];
  }
  remember(faunaCache, planet.id, list);
  return list;
}

// A species' stats on a given planet: tougher further from Haven.
export function creatureStats(planet, speciesId) {
  const c = CREATURES[speciesId] || CREATURES.rockCrawler;
  if (planet.starter) return { ...c, id: speciesId };
  const k = 0.6 + 0.4 * planet.richness;
  return { ...c, id: speciesId, hp: Math.round(c.hp * k), dmg: Math.round(c.dmg * k * 10) / 10 };
}

// Structures standing on a planet: ruins, shrines, faction bases, wrecks, and on the holy
// capital, the Cathedral. Each gets a position, a facing, and (for shrines) a god.
const structCache = new Map();
export function structuresOf(planet) {
  let list = structCache.get(planet.id);
  if (list) return list;
  list = [];
  if (planet.starter) return remember(structCache, planet.id, list);
  const rng = mulberry32(hash2(planet.seed | 0, 303, 9));
  const tags = profileOf(planet).tags;
  const place = (type, x, z) => {
    const st = STRUCTURES[type];
    const inst = { id: `s${list.length}`, type, x, z, rot: rng() * Math.PI * 2, radius: st.radius };
    if (st.kind === 'village') inst.race = race;
    if (st.kind === 'shrine') {
      const gods = GOD_IDS.filter((g) => GODS[g].tags.some((t) => tags.includes(t)));
      inst.god = (gods.length ? gods : GOD_IDS)[Math.floor(rng() * (gods.length || GOD_IDS.length))];
    }
    list.push(inst);
  };
  const free = (x, z, r) => Math.hypot(x, z) > clearRadius(planet) + r + 20 &&
    list.every((o) => Math.hypot(o.x - x, o.z - z) > o.radius + r + 24);
  if (planet.holy) {
    list.push({ id: 's0', type: 'cathedral', x: 0, z: -110, rot: 0, radius: STRUCTURES.cathedral.radius });
  }
  // Ruins, shrines and dungeons are special: only some worlds have them.
  const ancient = tags.includes('ancient');
  const hasRuins = rng() < (ancient ? 0.85 : 0.22);
  const hasShrine = rng() < (ancient ? 0.5 : 0.3);
  const hasDungeon = rng() < (ancient ? 0.6 : 0.28);
  // An alien race that claims this system settles worlds it likes (and some it doesn't).
  const race = planet.alien && (ALIEN_RACES[planet.alien].tags.some((t) => tags.includes(t)) || rng() < 0.35) ? planet.alien : null;
  const pool = STRUCTURE_IDS.filter((id) => {
    const st = STRUCTURES[id];
    if (!st.rarity || !tagsMatch(st.tags, tags)) return false;
    if (st.kind === 'ruin' && !hasRuins) return false;
    if (st.kind === 'shrine' && !hasShrine) return false;
    if (st.kind === 'dungeon' && !hasDungeon) return false;
    if (st.territory === 'capital') return planet.territory === 'capital';
    if (st.territory === 'empire') return planet.territory === 'empire' || planet.territory === 'capital';
    if (st.territory === 'rebellion') return planet.territory === 'rebellion';
    if (st.kind === 'shrine' && planet.holy) return false;   // no heresy on Aurelis
    return true;
  });
  const forced = planet.holy ? ['pilgrimCamp', 'pilgrimCamp', 'inquisitionSpire', 'imperialGarrison'] : race ? ['alienVillage'] : [];
  const n = forced.length + (planet.holy ? 2 : 1 + Math.floor(rng() * 3));
  for (let i = 0; i < n && pool.length; i++) {
    const type = forced[i] || pickWeighted(rng, pool.map((id) => [id, STRUCTURES[id].rarity]));
    const r = STRUCTURES[type].radius;
    for (let tries = 0; tries < 12; tries++) {
      const x = range(rng, -SURFACE_HALF + 80, SURFACE_HALF - 80), z = range(rng, -SURFACE_HALF + 80, SURFACE_HALF - 80);
      if (free(x, z, r)) { place(type, x, z); break; }
    }
  }
  return remember(structCache, planet.id, list);
}

export const clearRadius = (planet) => (planet.starter ? SETTLEMENT_RADIUS : 36);

// Ground is levelled under structures so buildings sit flat.
const padCache = new Map();
function pads(planet) {
  let list = padCache.get(planet.id);
  if (!list) {
    // Towns stand on level ground, never below their water line; structures level theirs last.
    const water = profileOf(planet).water;
    list = townsOf(planet).map((t) => ({ x: t.x, z: t.z, r: t.radius + 10, h: Math.max(rawHeight(planet, t.x, t.z), water != null ? water + 1.5 : -1e9) }));
    for (const st of structuresOf(planet)) list.push({ x: st.x, z: st.z, r: st.radius + 4, h: rawHeight(planet, st.x, st.z) });
    const sp = spireOf(planet);
    if (sp) list.push({ x: sp.x, z: sp.z, r: SPIRE_RADIUS + 8, h: rawHeight(planet, sp.x, sp.z) });
    remember(padCache, planet.id, list);
  }
  return list;
}

export function baseHeight(planet, x, z) {
  let h = rawHeight(planet, x, z);
  for (const p of pads(planet)) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r * 1.7) continue;
    const t = Math.max(0, Math.min(1, (d - p.r) / (p.r * 0.7)));
    h = p.h + (h - p.h) * t * t * (3 - 2 * t);
  }
  return h;
}

// The structure base height (the level ground it stands on).
export function structureBase(planet, st) {
  return pads(planet).find((p) => p.x === st.x && p.z === st.z)?.h ?? rawHeight(planet, st.x, st.z);
}

function rawHeight(planet, x, z) {
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
  remember(depositCache, planet.id, list);
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

// The Spire: a tower of floors on Haven, each with a floor boss. It stands on open ground away
// from Haven Landing and the towns.
export const SPIRE_RADIUS = 16;
const spireCache = new Map();
export function spireOf(planet) {
  if (!planet.starter) return null;
  let s = spireCache.get(planet.id);
  if (s) return s;
  const towns = townsOf(planet);
  s = { x: 0, z: -150 };
  for (let k = 0; k < 64; k++) {
    const a = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35, d = 140 + Math.floor(k / 18) * 60;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (towns.every((t) => Math.hypot(t.x - x, t.z - z) > t.radius + SPIRE_RADIUS + 30)) { s = { x, z }; break; }
  }
  return remember(spireCache, planet.id, s);
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

const FLORA_COUNT = { tree: 7, palm: 3, rock: 3, spike: 3, cactus: 2, mushroom: 5, crystal: 3, bone: 2, reed: 8, deadtree: 3, coral: 6 };

export function floraFor(planet, tx, tz) {
  const p = profileOf(planet);
  const rng = mulberry32(hash2(tx, tz, (planet.seed | 0) + 13));
  const main = p.flora[0][0];
  const n = Math.round((FLORA_COUNT[main] || 3) * (p.density ?? 1));
  const out = [];
  const structs = structuresOf(planet), towns = townsOf(planet), spire = spireOf(planet);
  for (let i = 0; i < n; i++) {
    const x = tx * 40 + rng() * 40, z = tz * 40 + rng() * 40;
    const kind = pickWeighted(rng, p.flora);
    const s = 0.7 + rng() * 0.8, r = rng() * Math.PI * 2, v = rng();
    if (Math.hypot(x, z) < clearRadius(planet) + 6) continue;
    if (Math.max(Math.abs(x), Math.abs(z)) > SURFACE_HALF - 30) continue;
    if (structs.some((st) => Math.hypot(st.x - x, st.z - z) < st.radius + 5)) continue;
    if (towns.some((t) => Math.hypot(t.x - x, t.z - z) < t.radius + 12)) continue;
    if (spire && Math.hypot(spire.x - x, spire.z - z) < SPIRE_RADIUS + 14) continue;
    out.push({ x, z, s, r, kind, v });
  }
  return out;
}

export const skyColor = (planet) => profileOf(planet).sky;

// Surface gravity, as a multiple of standard: small worlds let you leap, big ones hold you down.
export function gravityOf(planet) {
  if (planet.starter || planet.holy) return 1;
  return Math.round((0.55 + ((planet.seed >>> 5) % 95) / 100) * 100) / 100;
}
