// Deterministic hashing, random numbers and noise.
// Everything procedural in the universe derives from these, so the server and every
// client generate exactly the same galaxy from the same seed without exchanging it.

export function hash2(x, y, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: tiny, fast, good enough for procedural content.
export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(x, y, seed, salt = 0) {
  return mulberry32(hash2(x, y, (seed ^ Math.imul(salt + 1, 0x9e3779b1)) | 0));
}

export const range = (rng, lo, hi) => lo + rng() * (hi - lo);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function weightedPick(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

// Smooth value noise in [0, 1], used for galaxy-scale structure (dense regions, voids, hue).
const smooth = (t) => t * t * (3 - 2 * t);
const lattice = (x, y, seed) => hash2(x, y, seed) / 4294967296;

export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = lattice(x0, y0, seed), b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed), d = lattice(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x, y, seed, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
