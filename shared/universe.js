// The procedural universe. Space is 3D, but sectors tile the galactic plane (x, z): a sector is
// a SECTOR_SIZE square column of space. Its entire contents are a pure function of
// (seed, sx, sz). Nothing here is stored; the server persists only what players change.

import { rngFor, range, pick, weightedPick, fbm, hash2, mulberry32 } from './rng.js';
import { FACTIONS, HOLY_CAPITAL } from './content/factions.js';

export const SECTOR_SIZE = 5000;
export const SAFE_RADIUS = 2;            // sectors around Haven where PvP is off
export const FAR_REACH = [1000, 0];      // where the Ancient Gate leads

export const sectorOf = (x, z) => [Math.floor(x / SECTOR_SIZE), Math.floor(z / SECTOR_SIZE)];
export const sectorKey = (sx, sz) => `${sx},${sz}`;
export const isSafe = (sx, sz) => Math.max(Math.abs(sx), Math.abs(sz)) <= SAFE_RADIUS;

const STAR_TYPES = [
  // [type, weight, color, radius range]
  ['Red dwarf',    40, '#ff7a55', [110, 180]],
  ['Yellow star',  25, '#ffe08a', [170, 260]],
  ['Orange star',  18, '#ffb15c', [150, 230]],
  ['White dwarf',   7, '#e8f1ff', [70, 110]],
  ['Blue giant',    6, '#8ab8ff', [300, 420]],
  ['Neutron star',  3, '#c9a8ff', [45, 70]],
  ['Black hole',    1, '#000000', [120, 200]],
];

export const PLANET_TYPES = {
  Rocky:  { weight: 30, colors: ['#8c7b6b', '#a58f7a', '#6f6258'], land: true },
  Ice:    { weight: 15, colors: ['#cfe9f5', '#a9d3ea', '#e6f6ff'], land: true },
  Gas:    { weight: 20, colors: ['#d9a066', '#c7845a', '#9fb4d9', '#d8c49a'], land: false },
  Lava:   { weight: 8,  colors: ['#c2411b', '#e0601f', '#7a2410'], land: true },
  Ocean:  { weight: 10, colors: ['#2f6fb5', '#2a8f9e', '#1e4f8a'], land: true },
  Jungle: { weight: 7,  colors: ['#3f8f4a', '#5a9e3a', '#2f6b3a'], land: true },
  Desert: { weight: 10, colors: ['#d8b27a', '#c99a5b', '#e3c38f'], land: true },
};

const SYL_A = ['ka', 've', 'lo', 'zar', 'en', 'tri', 'mo', 'xi', 'qua', 'ru', 'sel', 'dra', 'no', 'ith', 'or', 'phe', 'ul', 'yr', 'ta', 'gan'];
const SYL_B = ['dor', 'nis', 'lux', 'mar', 'tos', 'ven', 'rix', 'lon', 'sha', 'thra', 'gul', 'mir', 'pex', 'cor', 'dyn', 'ral'];
const SUFFIX = ['', '', '', ' Prime', ' Major', ' Minor', ' Reach', ' Deep', ' Drift', ' Expanse'];

export function makeName(rng, suffixes = true) {
  const n = 1 + Math.floor(rng() * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(rng, SYL_A);
  s += pick(rng, SYL_B);
  s = s[0].toUpperCase() + s.slice(1);
  return suffixes ? s + pick(rng, SUFFIX) : s;
}

// Galaxy-scale properties that vary smoothly across many sectors.
export function regionInfo(sx, sz, seed) {
  const density = fbm(sx * 0.05, sz * 0.05, seed + 11);
  const hue = Math.floor(fbm(sx * 0.02, sz * 0.02, seed + 23) * 720) % 360;
  const nebula = fbm(sx * 0.12, sz * 0.12, seed + 37);
  const dist = Math.hypot(sx, sz);
  const richness = 1 + Math.log2(1 + dist / 6);
  const rx = Math.floor(sx / 12), rz = Math.floor(sz / 12);
  const name = makeName(rngFor(rx, rz, seed, 99), false) + ' ' + pick(rngFor(rx, rz, seed, 98), ['Cluster', 'Nebula', 'Expanse', 'Reach', 'Void', 'Belt', 'Cloud', 'Rift']);
  return { density, hue, nebula, richness, dist, name };
}

// Where the Empire's holy capital is: a fixed sector some way out from Haven.
const capitalCache = new Map();
export function holyCapitalSector(seed) {
  let c = capitalCache.get(seed);
  if (!c) {
    const r = mulberry32(hash2(seed, 31337, 7));
    const a = r() * Math.PI * 2;
    c = [Math.round(Math.cos(a) * 22), Math.round(Math.sin(a) * 22)];
    capitalCache.set(seed, c);
  }
  return c;
}

// Who controls a sector: Haven's free colonies, the Empire (with its holy capital), the
// rebel frontier around the Empire's edge, or the lawless wilds.
export function territoryOf(sx, sz, seed) {
  if (isSafe(sx, sz)) return 'haven';
  const [cx, cz] = holyCapitalSector(seed);
  if (sx === cx && sz === cz) return 'capital';
  const d = Math.hypot(sx - cx, sz - cz);
  const reach = 13 + 5 * fbm(sx * 0.15, sz * 0.15, seed + 51, 3);
  if (d <= reach) return 'empire';
  if (d <= reach + 6 && fbm(sx * 0.3, sz * 0.3, seed + 61, 2) > 0.42) return 'rebellion';
  if (fbm(sx * 0.07, sz * 0.07, seed + 71, 3) > 0.7) return 'rebellion';
  return 'wilds';
}

export const factionOfTerritory = (t) => (t === 'empire' || t === 'capital' ? 'empire' : t === 'rebellion' ? 'rebellion' : null);

const cache = new Map();
const CACHE_MAX = 2000;

export function generateSector(sx, sz, seed) {
  const key = `${seed}:${sx},${sz}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = rngFor(sx, sz, seed, 1);
  const region = regionInfo(sx, sz, seed);
  const ox = sx * SECTOR_SIZE, oz = sz * SECTOR_SIZE;
  const cx = ox + SECTOR_SIZE / 2 + range(rng, -600, 600);
  const cz = oz + SECTOR_SIZE / 2 + range(rng, -600, 600);
  const home = sx === 0 && sz === 0;
  const territory = territoryOf(sx, sz, seed);
  const capital = territory === 'capital';

  const sector = {
    sx, sz, key: sectorKey(sx, sz), region, home, safe: isSafe(sx, sz), territory, capital,
    faction: factionOfTerritory(territory),
    name: home ? 'Haven' : capital ? 'Aurelian Throne' : makeName(rng),
    star: null, planets: [], asteroids: [], station: null, wormhole: null, nebulae: [],
  };

  if (home || capital || rng() < 0.12 + 0.55 * region.density) {
    const [type, , color, [r0, r1]] = home || capital ? STAR_TYPES[1] : weightedPick(rng, STAR_TYPES.map((t) => [t, t[1]]));
    sector.star = { x: cx, y: 0, z: cz, type, color, r: range(rng, r0, r1) };
    const nPlanets = type === 'Black hole' ? 0 : home || capital ? 4 : Math.floor(rng() * 7);
    let orbit = sector.star.r + range(rng, 450, 700);
    for (let i = 0; i < nPlanets && orbit < SECTOR_SIZE * 0.48; i++) {
      let ptype = weightedPick(rng, Object.entries(PLANET_TYPES).map(([k, v]) => [k, v.weight]));
      if ((home || capital) && i === 0) ptype = 'Jungle';
      const colors = PLANET_TYPES[ptype].colors;
      const r = ptype === 'Gas' ? range(rng, 120, 200) : range(rng, 55, 110);
      const pid = `${sx},${sz}:p${i}`;
      sector.planets.push({
        id: pid, index: i, sx, sz,
        name: home && i === 0 ? 'Haven' : capital && i === 0 ? HOLY_CAPITAL.planet : sector.name.split(' ')[0] + ' ' + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i],
        type: ptype, color: pick(rng, colors), r,
        orbit, period: range(rng, 900, 3000) * Math.sqrt(orbit / 1000), phase: rng() * Math.PI * 2,
        ring: ptype === 'Gas' && rng() < 0.4,
        landable: PLANET_TYPES[ptype].land,
        starter: home && i === 0,
        holy: capital && i === 0,
        territory,
        seed: hash2(sx * 31 + i, sz, seed),
        richness: region.richness,
      });
      orbit += r * 2 + range(rng, 260, 560);
    }
  }

  const nAst = Math.floor((home ? 30 : 6) + rng() * 34 * (0.4 + region.density));
  const belt = sector.star && rng() < 0.6;
  const beltR = belt ? (sector.planets.length ? sector.planets[sector.planets.length - 1].orbit + 450 : sector.star.r + 900) : 0;
  const fieldX = ox + range(rng, 900, SECTOR_SIZE - 900), fieldZ = oz + range(rng, 900, SECTOR_SIZE - 900);
  const rich = region.richness;
  const oreWeights = [['iron', 50], ['ice', 26], ['copper', 16], ['gold', 5 * rich], ['voidstone', 0.6 * rich * rich]];
  for (let i = 0; i < nAst; i++) {
    let x, y, z;
    if (belt && beltR < SECTOR_SIZE * 0.55) {
      const a = rng() * Math.PI * 2, d = beltR + range(rng, -200, 200);
      x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; y = range(rng, -120, 120);
    } else {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 1100;
      x = fieldX + Math.cos(a) * d; z = fieldZ + Math.sin(a) * d; y = range(rng, -500, 500);
    }
    const r = range(rng, 14, 58);
    sector.asteroids.push({
      id: `${sx},${sz}:a${i}`,
      x, y, z, r,
      ore: weightedPick(rng, oreWeights),
      amount: Math.round(r * 2.2),
      shape: Math.floor(rng() * 1e9),
      spin: range(rng, -0.4, 0.4),
    });
  }

  const terminus = sx === FAR_REACH[0] && sz === FAR_REACH[1];
  const lawful = sector.faction === 'empire';
  if (home || terminus || capital || rng() < 0.02 + 0.05 * region.density + (lawful ? 0.06 : 0) + (territory === 'rebellion' ? 0.03 : 0)) {
    const a = rng() * Math.PI * 2, d = sector.star ? sector.star.r + range(rng, 900, 1500) : 0;
    sector.station = {
      id: `${sx},${sz}:st`,
      x: (sector.star ? cx : ox + SECTOR_SIZE / 2) + Math.cos(a) * d,
      y: home ? 0 : range(rng, -200, 200),
      z: (sector.star ? cz : oz + SECTOR_SIZE / 2) + Math.sin(a) * d,
      name: home ? 'Haven Station' : terminus ? 'Gate Terminus' : capital ? HOLY_CAPITAL.station
        : makeName(rng, false) + ' ' + pick(rng, sector.faction ? FACTIONS[sector.faction].station : ['Station', 'Outpost', 'Exchange', 'Dock']),
      richness: region.richness,
      faction: home || terminus ? null : sector.faction,
      capital,
    };
  }

  if (!home && rng() < 0.008) {
    const tx = sx + Math.round(range(rng, -300, 300)), tz = sz + Math.round(range(rng, -300, 300));
    sector.wormhole = {
      x: ox + range(rng, 800, SECTOR_SIZE - 800), y: range(rng, -300, 300), z: oz + range(rng, 800, SECTOR_SIZE - 800),
      r: 110, tx, tz,
    };
  }

  const nNeb = Math.floor(region.nebula * 5);
  for (let i = 0; i < nNeb; i++) {
    sector.nebulae.push({
      x: ox + rng() * SECTOR_SIZE, y: range(rng, -1500, 1500), z: oz + rng() * SECTOR_SIZE,
      r: range(rng, 900, 2400), hue: (region.hue + range(rng, -40, 40) + 360) % 360, a: range(rng, 0.05, 0.14),
    });
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, sector);
  return sector;
}

export function planetPos(p, star, tSeconds) {
  const ang = p.phase + (tSeconds / p.period) * Math.PI * 2;
  return [star.x + Math.cos(ang) * p.orbit, 0, star.z + Math.sin(ang) * p.orbit];
}

function parseId(id, tag) {
  const m = new RegExp(`^(-?\\d+),(-?\\d+):${tag}(\\d+)$`).exec(id);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

export function findAsteroid(id, seed) {
  const p = parseId(id, 'a');
  return p ? generateSector(p[0], p[1], seed).asteroids[p[2]] || null : null;
}

export function findPlanet(id, seed) {
  const p = parseId(id, 'p');
  return p ? generateSector(p[0], p[1], seed).planets[p[2]] || null : null;
}

export const STARTER_PLANET_ID = '0,0:p0';

// Story effects can change what an asteroid holds. Deterministic per asteroid.
export function effectiveOre(a, effects) {
  if (effects && effects.gateBuilt && a.ore === 'voidstone') {
    const m = /^(-?\d+),(-?\d+)/.exec(a.id);
    if (m && Math.hypot(+m[1], +m[2]) > 400 && (a.shape % 3) !== 0) return 'aetherium';
  }
  return a.ore;
}
