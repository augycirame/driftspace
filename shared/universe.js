// The procedural universe. A sector is a SECTOR_SIZE square of space; its entire contents are
// a pure function of (seed, sx, sy). Nothing here is ever stored: the server only persists
// what players change (mined asteroids, built structures), as deltas on top of this.

import { rngFor, range, pick, weightedPick, fbm } from './rng.js';

export const SECTOR_SIZE = 5000;

export const sectorOf = (x, y) => [Math.floor(x / SECTOR_SIZE), Math.floor(y / SECTOR_SIZE)];
export const sectorKey = (sx, sy) => `${sx},${sy}`;

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

const PLANET_TYPES = [
  ['Rocky',  30, ['#8c7b6b', '#a58f7a', '#6f6258']],
  ['Ice',    15, ['#cfe9f5', '#a9d3ea', '#e6f6ff']],
  ['Gas',    20, ['#d9a066', '#c7845a', '#9fb4d9', '#d8c49a']],
  ['Lava',    8, ['#c2411b', '#e0601f', '#7a2410']],
  ['Ocean',  10, ['#2f6fb5', '#2a8f9e', '#1e4f8a']],
  ['Jungle',  7, ['#3f8f4a', '#5a9e3a', '#2f6b3a']],
  ['Desert', 10, ['#d8b27a', '#c99a5b', '#e3c38f']],
];

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
export function regionInfo(sx, sy, seed) {
  const density = fbm(sx * 0.05, sy * 0.05, seed + 11);         // star density, voids vs clusters
  const hue = Math.floor(fbm(sx * 0.02, sy * 0.02, seed + 23) * 720) % 360;
  const nebula = fbm(sx * 0.12, sy * 0.12, seed + 37);
  const dist = Math.hypot(sx, sy);
  const richness = 1 + Math.log2(1 + dist / 6);                 // better ores further out
  const rx = Math.floor(sx / 12), ry = Math.floor(sy / 12);
  const name = makeName(rngFor(rx, ry, seed, 99), false) + ' ' + pick(rngFor(rx, ry, seed, 98), ['Cluster', 'Nebula', 'Expanse', 'Reach', 'Void', 'Belt', 'Cloud', 'Rift']);
  return { density, hue, nebula, richness, dist, name };
}

const cache = new Map();
const CACHE_MAX = 2000;

export function generateSector(sx, sy, seed) {
  const key = `${seed}:${sx},${sy}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = rngFor(sx, sy, seed, 1);
  const region = regionInfo(sx, sy, seed);
  const ox = sx * SECTOR_SIZE, oy = sy * SECTOR_SIZE;
  const cx = ox + SECTOR_SIZE / 2 + range(rng, -600, 600);
  const cy = oy + SECTOR_SIZE / 2 + range(rng, -600, 600);
  const home = sx === 0 && sy === 0;

  const sector = {
    sx, sy, key: sectorKey(sx, sy), region,
    name: makeName(rng),
    star: null, planets: [], asteroids: [], station: null, wormhole: null, nebulae: [],
  };

  // Star system
  if (home || rng() < 0.12 + 0.55 * region.density) {
    const [type, , color, [r0, r1]] = weightedPick(rng, STAR_TYPES.map((t) => [t, t[1]]));
    sector.star = { x: cx, y: cy, type, color, r: range(rng, r0, r1) };
    const nPlanets = type === 'Black hole' ? 0 : Math.floor(rng() * 7);
    let orbit = sector.star.r + range(rng, 350, 600);
    for (let i = 0; i < nPlanets && orbit < SECTOR_SIZE * 0.48; i++) {
      const [ptype, , colors] = weightedPick(rng, PLANET_TYPES.map((t) => [t, t[1]]));
      const r = ptype === 'Gas' ? range(rng, 80, 150) : range(rng, 28, 75);
      sector.planets.push({
        id: `${sx},${sy}:p${i}`,
        name: sector.name.split(' ')[0] + ' ' + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i],
        type: ptype, color: pick(rng, colors), r,
        orbit, period: range(rng, 240, 1200) * Math.sqrt(orbit / 1000), phase: rng() * Math.PI * 2,
        ring: ptype === 'Gas' && rng() < 0.4,
      });
      orbit += r * 2 + range(rng, 220, 520);
    }
  }

  // Asteroids: a belt around the star, or a loose field in open space.
  const nAst = Math.floor((home ? 26 : 6) + rng() * 34 * (0.4 + region.density));
  const belt = sector.star && rng() < 0.6;
  const beltR = belt ? (sector.planets.length ? sector.planets[sector.planets.length - 1].orbit + 400 : sector.star.r + 900) : 0;
  const fieldX = ox + range(rng, 900, SECTOR_SIZE - 900), fieldY = oy + range(rng, 900, SECTOR_SIZE - 900);
  const rich = region.richness;
  const oreWeights = [['iron', 50], ['ice', 26], ['copper', 16], ['gold', 5 * rich], ['voidstone', 0.6 * rich * rich]];
  for (let i = 0; i < nAst; i++) {
    let x, y;
    if (belt && beltR < SECTOR_SIZE * 0.55) {
      const a = rng() * Math.PI * 2, d = beltR + range(rng, -180, 180);
      x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d;
    } else {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 1100;
      x = fieldX + Math.cos(a) * d; y = fieldY + Math.sin(a) * d;
    }
    const r = range(rng, 14, 58);
    sector.asteroids.push({
      id: `${sx},${sy}:a${i}`,
      x, y, r,
      ore: weightedPick(rng, oreWeights),
      amount: Math.round(r * 2.2),
      shape: Math.floor(rng() * 1e9),
      spin: range(rng, -0.4, 0.4),
    });
  }

  // Stations: trade and upgrade hubs. Always one at home.
  if (home || rng() < 0.02 + 0.05 * region.density) {
    const a = rng() * Math.PI * 2, d = sector.star ? sector.star.r + range(rng, 700, 1500) : 0;
    sector.station = {
      id: `${sx},${sy}:st`,
      x: (sector.star ? cx : ox + SECTOR_SIZE / 2) + Math.cos(a) * d,
      y: (sector.star ? cy : oy + SECTOR_SIZE / 2) + Math.sin(a) * d,
      name: home ? 'Haven Station' : makeName(rng, false) + ' ' + pick(rng, ['Station', 'Outpost', 'Exchange', 'Dock', 'Citadel']),
    };
  }

  // Wormholes: one-way links to far-off sectors. The fast road into the unknown.
  if (!home && rng() < 0.008) {
    const tx = sx + Math.round(range(rng, -300, 300)), ty = sy + Math.round(range(rng, -300, 300));
    sector.wormhole = {
      x: ox + range(rng, 800, SECTOR_SIZE - 800), y: oy + range(rng, 800, SECTOR_SIZE - 800),
      r: 110, tx, ty,
    };
  }

  // Background nebula clouds (purely visual).
  const nNeb = Math.floor(region.nebula * 5);
  for (let i = 0; i < nNeb; i++) {
    sector.nebulae.push({
      x: ox + rng() * SECTOR_SIZE, y: oy + rng() * SECTOR_SIZE,
      r: range(rng, 900, 2400), hue: (region.hue + range(rng, -40, 40) + 360) % 360, a: range(rng, 0.05, 0.14),
    });
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, sector);
  return sector;
}

export function planetPos(p, star, tSeconds) {
  const ang = p.phase + (tSeconds / p.period) * Math.PI * 2;
  return [star.x + Math.cos(ang) * p.orbit, star.y + Math.sin(ang) * p.orbit];
}

export function findAsteroid(id, seed) {
  const m = /^(-?\d+),(-?\d+):a(\d+)$/.exec(id);
  if (!m) return null;
  return generateSector(+m[1], +m[2], seed).asteroids[+m[3]] || null;
}
