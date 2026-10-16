// Dungeon layouts: a grid of rooms joined by corridors, generated from a seed so the server
// and every client in the party build the same dungeon. Monsters, chests and the boss are
// placed here too; the server decides what happens to them.

import { mulberry32 } from './rng.js';
import { DUNGEON_THEMES } from './content/dungeons.js';

export const DCELL = 5;          // world units per grid cell
export const WALL_H = 7;         // wall height
export const GRID = 46;          // grid is GRID × GRID cells

export function generateDungeon(themeId, seed, depth = 1) {
  const theme = DUNGEON_THEMES[themeId];
  const rng = mulberry32(seed >>> 0);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const W = GRID, H = GRID;
  const cells = new Uint8Array(W * H);
  const carve = (x, y) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) cells[y * W + x] = 1; };

  // Rooms, kept apart from each other.
  const rooms = [];
  const want = 7 + Math.min(4, depth);
  for (let tries = 0; tries < 400 && rooms.length < want; tries++) {
    const w = ri(4, 8), h = ri(4, 8), x = ri(1, W - w - 2), y = ri(1, H - h - 2);
    if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h });
  }
  for (const r of rooms) for (let i = r.x; i < r.x + r.w; i++) for (let j = r.y; j < r.y + r.h; j++) carve(i, j);

  // Corridors (two cells wide) join each room to the next, plus a couple of loops.
  const center = (r) => [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];
  const corridor = (a, b) => {
    let [x, y] = center(a);
    const [tx, ty] = center(b);
    const horizontalFirst = rng() < 0.5;
    const stepX = () => { while (x !== tx) { carve(x, y); carve(x, y + 1); x += Math.sign(tx - x); } };
    const stepY = () => { while (y !== ty) { carve(x, y); carve(x + 1, y); y += Math.sign(ty - y); } };
    if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    carve(x, y);
  };
  rooms.sort((a, b) => center(a)[0] + center(a)[1] * 0.5 - (center(b)[0] + center(b)[1] * 0.5));
  for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
  for (let k = 0; k < 2 && rooms.length > 3; k++) corridor(rooms[ri(0, rooms.length - 1)], rooms[ri(0, rooms.length - 1)]);

  // The boss waits in the room farthest (by walking distance) from the entrance.
  const dist = new Int32Array(W * H).fill(-1);
  const [sx, sy] = center(rooms[0]);
  const queue = [sy * W + sx];
  dist[queue[0]] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi], cx = c % W, cy = (c - cx) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (cy + dy) * W + cx + dx;
      if (cells[n] && dist[n] < 0) { dist[n] = dist[c] + 1; queue.push(n); }
    }
  }
  let bossRoom = 1;
  rooms.forEach((r, i) => { const [x, y] = center(r); if (i && dist[y * W + x] > dist[(center(rooms[bossRoom])[1]) * W + center(rooms[bossRoom])[0]]) bossRoom = i; });

  const world = (cx, cy) => [(cx + 0.5) * DCELL, (cy + 0.5) * DCELL];
  const spot = (r) => world(r.x + rng() * (r.w - 1), r.y + rng() * (r.h - 1));
  const enemies = [], chests = [];
  rooms.forEach((r, i) => {
    if (i === 0) return;
    if (i === bossRoom) {
      const [x, z] = world(...center(r));
      enemies.push({ id: `e${enemies.length}`, species: theme.boss, x, z, boss: true, room: i });
      for (let k = 0; k < 2; k++) enemies.push({ id: `e${enemies.length}`, species: theme.enemies[ri(0, theme.enemies.length - 1)], ...xz(spot(r)), room: i });
      const [cx, cz] = world(r.x + r.w - 1, r.y);
      chests.push({ id: `c${chests.length}`, x: cx, z: cz, boss: true, room: i });
      return;
    }
    const n = 1 + ri(0, 2) + (depth > 2 ? 1 : 0);
    for (let k = 0; k < n; k++) enemies.push({ id: `e${enemies.length}`, species: theme.enemies[ri(0, theme.enemies.length - 1)], ...xz(spot(r)), room: i });
    if (rng() < 0.45) chests.push({ id: `c${chests.length}`, ...xz(world(r.x, r.y + r.h - 1)), room: i });
  });
  const [ex, ez] = world(...center(rooms[0]));
  return { theme: themeId, W, H, cells, rooms, bossRoom, enemies, chests, start: [ex, ez] };
}

const xz = ([x, z]) => ({ x, z });

export function isFloor(d, x, z) {
  const i = Math.floor(x / DCELL), j = Math.floor(z / DCELL);
  return i >= 0 && j >= 0 && i < d.W && j < d.H && d.cells[j * d.W + i] === 1;
}

// Can a body of this radius stand here without overlapping a wall?
export function canStand(d, x, z, r = 0.45) {
  return isFloor(d, x - r, z - r) && isFloor(d, x + r, z - r) && isFloor(d, x - r, z + r) && isFloor(d, x + r, z + r);
}

// Clear line between two points (walls block it).
export function lineOfSight(d, ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 1);
  for (let k = 1; k < steps; k++) if (!isFloor(d, ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps)) return false;
  return true;
}

// A dungeon's seed and difficulty come from the planet and the entrance it's behind.
export function dungeonSeed(planet, structureId) {
  let h = planet.seed | 0;
  for (const ch of structureId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
export const dungeonDepth = (planet) => Math.max(1, Math.round(planet.richness));
