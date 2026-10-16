// Native life on planet surfaces: climate, weather and the day/night cycle, and the towns,
// realms and people of each world. All of it is generated from the planet's seed (and, for
// weather and daylight, the clock), so the server and every client agree without talking.
// What happens to these realms over time (wars, deaths, coups) is simulated on the server
// (server/politics.js) on top of this starting picture.

import { mulberry32, hash2, hashString, range, pick } from './rng.js';
import { PEOPLES, PEOPLE_IDS, GOVERNMENTS, TOWN_SIZES, CLIMATES, WEATHER } from './content/peoples.js';
import { profileOf, structuresOf, SURFACE_HALF, clearRadius } from './planet.js';

const remember = (cache, key, value) => {
  if (cache.size > 2000) cache.clear();
  cache.set(key, value);
  return value;
};
const weighted = (rng, entries) => {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1][0];
};

// ---- climate, weather, daylight -------------------------------------------------------------

export function climateOf(planet) {
  if (planet.starter || planet.holy) return 'temperate';
  const tags = profileOf(planet).tags;
  const has = (...t) => t.some((x) => tags.includes(x));
  if (has('ice')) return tags.includes('crystal') ? 'cold' : 'frozen';
  if (has('fire', 'ash')) return 'scorching';
  if (has('sand', 'salt', 'scorched')) return 'arid';
  if (has('fungal', 'toxic')) return 'humid';
  if (has('rock') && !has('temperate')) return 'cold';
  return planet.type === 'Jungle' ? 'humid' : 'temperate';
}

const WEATHER_SLOT = 480;   // seconds each weather lasts
export function weatherAt(planet, t) {
  if (planet.starter && Math.floor(t / WEATHER_SLOT) % 3 !== 0) return 'clear';
  const slot = Math.floor(t / WEATHER_SLOT);
  const rng = mulberry32(hash2(planet.seed | 0, slot, 4242));
  return weighted(rng, CLIMATES[climateOf(planet)].weather);
}
export const weatherInfo = (id) => WEATHER[id] || WEATHER.clear;

// Each world turns at its own pace. Returns the sun's direction and how much daylight there is.
export function dayLength(planet) {
  if (planet.starter || planet.holy) return 2400;
  return 900 + ((planet.seed >>> 3) % 1500);
}
export function sunAt(planet, t) {
  const len = dayLength(planet);
  const phase = ((planet.seed >>> 7) % 1000) / 1000;
  const a = (t / len + phase) * Math.PI * 2;
  const el = Math.sin(a);
  const dir = [Math.cos(a) * 0.85, el, 0.35 + Math.cos(a) * 0.15];
  const l = Math.hypot(...dir);
  const daylight = Math.max(0, Math.min(1, (el + 0.12) / 0.3));
  return { dir: dir.map((v) => v / l), elevation: el, daylight, night: daylight < 0.3, hour: ((a / (Math.PI * 2)) % 1 + 1.25) % 1 * 24 };
}

// ---- names ------------------------------------------------------------------------------------

export function personName(people, rng) {
  const s = PEOPLES[people].syll;
  return pick(rng, s.first) + pick(rng, s.mid) + pick(rng, s.last);
}
function placeName(people, rng) {
  const s = PEOPLES[people].syll;
  const base = pick(rng, s.first) + pick(rng, s.mid);
  const n = base + pick(rng, s.place);
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

export const COINS = { human: ['crown', 'crowns'], elf: ['silver leaf', 'silver leaves'], dwarf: ['mark', 'marks'], vampire: ['sovereign', 'sovereigns'], werewolf: ['fang', 'fangs'] };

// ---- towns and realms -------------------------------------------------------------------------

// Which peoples could live on this world, by how well its terrain suits them.
function peoplesFor(planet) {
  const tags = profileOf(planet).tags;
  return PEOPLE_IDS.map((id) => [id, tags.reduce((s, t) => s + (PEOPLES[id].habitats[t] || 0), 0)]).filter(([, w]) => w > 0);
}

const townCache = new Map();
// The towns of a planet: each has a name, a people, a realm, buildings and residents.
export function townsOf(planet) {
  let list = townCache.get(planet.id);
  if (list) return list;
  list = [];
  if (!planet.landable) return remember(townCache, planet.id, list);
  const rng = mulberry32(hash2(planet.seed | 0, 505, 17));
  const peoples = peoplesFor(planet);
  if (!peoples.length) return remember(townCache, planet.id, list);
  const best = Math.max(...peoples.map(([, w]) => w));
  let count = planet.starter ? 2 : Math.max(1, Math.round(1 + rng() * 3 + best / 4));
  count = Math.min(count, 6);

  // Realms first: one to three peoples-and-governments on the world.
  const realmCount = planet.starter ? 2 : Math.min(count, 1 + (rng() < 0.6 ? 1 : 0) + (count >= 5 && rng() < 0.4 ? 1 : 0));
  const realms = [];
  for (let i = 0; i < realmCount; i++) {
    const people = planet.starter ? ['human', 'elf'][i] : weighted(rng, peoples);
    realms.push({ id: `${planet.id}/r${i}`, people, government: pick(rng, PEOPLES[people].governments), towns: [] });
  }

  // Place towns where there's room: away from the landing site, structures and each other.
  const structs = structuresOf(planet);
  const taken = structs.map((s) => ({ x: s.x, z: s.z, r: s.radius }));
  for (let i = 0; i < count; i++) {
    const realm = realms[i % realms.length];
    const sizeId = i < realms.length ? 'town' : rng() < 0.45 ? 'village' : 'hamlet';
    const size = TOWN_SIZES[sizeId];
    for (let tries = 0; tries < 30; tries++) {
      const x = range(rng, -SURFACE_HALF + 90, SURFACE_HALF - 90), z = range(rng, -SURFACE_HALF + 90, SURFACE_HALF - 90);
      if (Math.hypot(x, z) < clearRadius(planet) + size.radius + 30) continue;
      if (taken.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + size.radius + 30)) continue;
      const town = { id: `${planet.id}/t${list.length}`, idx: list.length, realm: realm.id, people: realm.people, size: sizeId, x, z, radius: size.radius, rot: rng() * Math.PI * 2 };
      town.name = placeName(realm.people, rng);
      taken.push({ x, z, r: size.radius });
      realm.towns.push(town.id);
      list.push(town);
      break;
    }
  }
  // Each realm's first town is its capital; big realms make it a city.
  for (const realm of realms) {
    const towns = list.filter((t) => t.realm === realm.id);
    if (!towns.length) continue;
    const cap = towns[0];
    cap.capital = true;
    cap.size = towns.length >= 2 || planet.starter ? 'city' : 'town';
    cap.radius = TOWN_SIZES[cap.size].radius;
    realm.capital = cap.id;
    const gov = GOVERNMENTS[realm.government];
    realm.name = realm.government === 'clan' ? `${gov.realm} ${cap.name}` : `${gov.realm} ${cap.name}`;
    realm.coin = COINS[realm.people];
    realm.coinRate = 0.6 + (hashString(realm.id) % 140) / 100;   // credits per coin, before politics
  }
  for (const t of list) layoutTown(planet, t);
  for (const t of list) t.npcs = residentsOf(planet, t, realms.find((r) => r.id === t.realm));
  remember(realmCache, planet.id, realms.filter((r) => r.towns.length));
  return remember(townCache, planet.id, list);
}

const realmCache = new Map();
export function realmsOf(planet) {
  townsOf(planet);
  return realmCache.get(planet.id) || [];
}

// Buildings: a hall facing the plaza, houses around it, workshops, and walls for big towns.
function layoutTown(planet, town) {
  const rng = mulberry32(hashString(town.id) ^ (planet.seed | 0));
  const size = TOWN_SIZES[town.size];
  const style = PEOPLES[town.people].style;
  const b = [];
  const at = (dist, ang) => [town.x + Math.cos(town.rot + ang) * dist, town.z + Math.sin(town.rot + ang) * dist];
  const face = (x, z) => Math.atan2(town.x - x, town.z - z);
  // The great hall (or keep, spire, manor) at the head of the plaza.
  const [hx, hz] = at(size.radius * 0.35, 0);
  b.push({ kind: town.capital ? 'keep' : 'hall', style, x: hx, z: hz, w: town.capital ? 14 : 11, d: town.capital ? 12 : 9, h: town.capital ? 13 : 8, rot: face(hx, hz) });
  // A well or totem in the plaza.
  b.push({ kind: style === 'clan' ? 'totem' : 'well', style, x: town.x, z: town.z, w: 2.4, d: 2.4, h: style === 'clan' ? 5 : 2, rot: 0 });
  const special = ['market', 'smithy', 'tavern', 'temple'].slice(0, town.size === 'hamlet' ? 0 : town.size === 'village' ? 2 : 4);
  const n = Math.floor(range(rng, size.houses[0], size.houses[1] + 1));
  for (let i = 0; i < n + special.length; i++) {
    const ang = Math.PI * 0.35 + (i / (n + special.length)) * Math.PI * 1.3 + range(rng, -0.08, 0.08);
    const dist = size.radius * range(rng, 0.55, 0.82);
    const [x, z] = at(dist, ang);
    const kind = special[i] || 'house';
    const w = kind === 'house' ? range(rng, 6, 8.5) : 8.5, d = kind === 'house' ? range(rng, 5, 7) : 7.5;
    b.push({ kind, style, x, z, w, d, h: kind === 'temple' ? 9 : range(rng, 4.5, 6), rot: face(x, z) });
  }
  // Fields and pens around hamlets and villages.
  if (town.size === 'hamlet' || town.size === 'village') {
    for (let i = 0; i < 2; i++) {
      const [x, z] = at(size.radius + 10, Math.PI + (i - 0.5) * 0.9);
      b.push({ kind: 'field', style, x, z, w: 16, d: 11, h: 0.4, rot: face(x, z), flat: true });
    }
  }
  town.buildings = b;
  // Walls with two gates for towns and cities.
  town.walls = [];
  if (town.size === 'town' || town.size === 'city') {
    const R = size.radius + 4, segs = 22;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, mid = (a0 + a1) / 2;
      // Gates: the main one opposite the hall, small ones on either side.
      const off = (target) => Math.abs(Math.atan2(Math.sin(mid - target), Math.cos(mid - target)));
      if (off(Math.PI) < 0.2 || off(Math.PI / 2) < 0.12 || off(-Math.PI / 2) < 0.12) continue;
      const [x0, z0] = at(R, a0), [x1, z1] = at(R, a1);
      town.walls.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, len: Math.hypot(x1 - x0, z1 - z0) + 0.4, rot: Math.atan2(x1 - x0, z1 - z0), h: town.size === 'city' ? 6 : 4.5, stone: style === 'dwarven' || style === 'gothic' || town.size === 'city' });
    }
  }
}

// The named residents of a town, each with a role, a look and a home spot.
function residentsOf(planet, town, realm) {
  const rng = mulberry32(hashString(town.id + ':folk') ^ (planet.seed | 0));
  const size = TOWN_SIZES[town.size];
  const roles = [...size.roles];
  for (let i = 0; i < size.extra; i++) roles.push(pick(rng, ['farmer', 'hunter', 'bard', 'merchant', 'healer']));
  if (town.capital && !roles.includes('ruler')) roles.unshift('ruler');
  if (!town.capital) { const r = roles.indexOf('ruler'); if (r >= 0) roles.splice(r, 1); }
  const gov = GOVERNMENTS[realm.government];
  return roles.map((role, i) => {
    const female = rng() < 0.5;
    const name = personName(town.people, rng);
    const bld = town.buildings[i % town.buildings.length];
    const ang = rng() * Math.PI * 2, d = range(rng, 3, 10);
    const title = role === 'ruler' ? gov.ruler[female ? 1 : 0] : null;
    return {
      id: `${town.id}.${i}`, name, role, title, female, people: town.people, town: town.id, realm: realm.id,
      look: Math.floor(rng() * 1e9), home: [town.x + Math.cos(ang) * d * (role === 'guard' ? 2.6 : 1), town.z + Math.sin(ang) * d * (role === 'guard' ? 2.6 : 1)],
      near: role === 'smith' || role === 'merchant' || role === 'innkeeper' || role === 'priest' ? [bld.x, bld.z] : null,
    };
  });
}

export function npcTitle(npc) {
  return npc.title ? `${npc.title} ${npc.name}` : npc.name;
}

// Find a town by id ("planetId/tN"), given the planet.
export function townById(planet, id) {
  return townsOf(planet).find((t) => t.id === id) || null;
}

// Simple footprints of town buildings (rotated rectangles), for collision and keeping flora out.
export function townFootprints(planet) {
  const out = [];
  for (const t of townsOf(planet)) {
    for (const b of t.buildings) if (!b.flat) out.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot });
    for (const w of t.walls) out.push({ x: w.x, z: w.z, hw: 0.6, hd: w.len / 2, rot: w.rot });
  }
  return out;
}

export function insideFootprint(f, x, z, pad = 0) {
  const dx = x - f.x, dz = z - f.z;
  const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) < f.hw + pad && Math.abs(lz) < f.hd + pad;
}
