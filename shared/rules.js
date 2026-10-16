// Game rules shared by the server (which enforces them) and the client (which predicts and
// displays them). Tuning lives here so both sides always agree.

export const ORES = {
  iron:      { name: 'Iron',      color: '#9aa3ad', price: 2 },
  ice:       { name: 'Ice',       color: '#bfe8ff', price: 3 },
  copper:    { name: 'Copper',    color: '#e08a4f', price: 5 },
  gold:      { name: 'Gold',      color: '#f2cf4a', price: 15 },
  voidstone: { name: 'Voidstone', color: '#b86bff', price: 60 },
  aetherium: { name: 'Aetherium', color: '#5fffe0', price: 150 },
};
export const ORE_IDS = Object.keys(ORES);

// ---- static structures (built in space and on planet surfaces) ------------------------------

export const WORLD_GRID = 8;     // structure cell size in space
export const SURFACE_GRID = 2;   // structure cell size on planets

export const BLOCKS = {
  hull:   { name: 'Hull plate',   color: '#5d6b7a', cost: { iron: 4 } },
  glass:  { name: 'Glass',        color: '#8fd3ff', cost: { ice: 3 }, transparent: true },
  solar:  { name: 'Solar panel',  color: '#2b4f9e', cost: { copper: 3, ice: 1 } },
  light:  { name: 'Light',        color: '#fff2a8', cost: { iron: 1, copper: 2 }, glow: true },
  gold:   { name: 'Gilded plate', color: '#e8c547', cost: { gold: 2 } },
  beacon: { name: 'Beacon',       color: '#ff5fa2', cost: { iron: 10, gold: 3 }, beacon: true, glow: true },
};
export const BLOCK_IDS = Object.keys(BLOCKS);

// ---- ships are built from blocks; their stats come from what they're made of ------------------

export const SHIP_BLOCK = 4;     // world units per ship block
export const SHIP_MAX_BLOCKS = 64;
export const SHIP_BOUNDS = { x: 4, y: 3, z: 6 };

export const SHIP_PARTS = {
  cockpit:  { name: 'Cockpit',          color: '#9fd0ff', mass: 2, hp: 40, cost: {}, unique: true },
  hull:     { name: 'Hull',             color: '#6b7787', mass: 1, hp: 30, cost: { iron: 4 } },
  armor:    { name: 'Armor plate',      color: '#454c57', mass: 3, hp: 110, cost: { iron: 8, copper: 2 } },
  thruster: { name: 'Thruster',         color: '#e0864f', mass: 1, hp: 20, thrust: 300, cost: { iron: 3, copper: 3 } },
  cargo:    { name: 'Cargo pod',        color: '#8a7a55', mass: 1, hp: 25, cargo: 50, cost: { iron: 5 } },
  gun:      { name: 'Blaster',          color: '#d14b4b', mass: 1, hp: 20, gun: 1, cost: { iron: 4, gold: 2 } },
  shield:   { name: 'Shield generator', color: '#4bb8d1', mass: 2, hp: 20, shield: 70, cost: { copper: 4, gold: 2, ice: 2 } },
  wing:     { name: 'Wing',             color: '#7d8da3', mass: 0.5, hp: 15, turn: 0.08, cost: { iron: 2, ice: 1 } },
};
export const SHIP_PART_IDS = Object.keys(SHIP_PARTS);

export const STARTER_SHIP = [
  [0, 0, -2, 'cockpit'], [0, 0, -1, 'hull'], [0, 0, 0, 'cargo'], [0, 0, 1, 'hull'],
  [-1, 0, 1, 'thruster'], [1, 0, 1, 'thruster'], [-1, 0, -1, 'gun'], [1, 0, -1, 'gun'],
  [-1, 0, 0, 'wing'], [1, 0, 0, 'wing'],
];

export const UPGRADES = {
  laser: { name: 'Mining laser', max: 8, desc: 'Mining speed and reach' },
  jump:  { name: 'Jump drive',   max: 8, desc: 'Hyperspace jump range' },
  guns:  { name: 'Blaster core', max: 8, desc: 'Ship weapon damage' },
};
export const upgradeCost = (level) => Math.round(150 * Math.pow(2.1, level));

export function shipStats(blocks, upg = {}, effects = {}, buffs = {}) {
  let mass = 0, thrust = 0, hp = 0, shield = 0, cargo = 30, guns = 0, turn = 0, ext = 1;
  for (const [x, y, z, t] of blocks) {
    const p = SHIP_PARTS[t];
    if (!p) continue;
    mass += p.mass; hp += p.hp;
    thrust += p.thrust || 0; shield += p.shield || 0; cargo += p.cargo || 0; guns += p.gun || 0; turn += p.turn || 0;
    ext = Math.max(ext, Math.abs(x) + 1, Math.abs(y) + 1, Math.abs(z) + 1);
  }
  mass = Math.max(1, mass);
  const tw = thrust / mass;
  const l = upg.laser || 0, j = upg.jump || 0, g = upg.guns || 0;
  const spd = 1 + (buffs.speed || 0);
  return {
    mass, hp, shield, cargo, guns,
    accel: tw * 5.5 * spd,
    maxSpeed: (220 + 420 * Math.min(1.4, tw / 90)) * spd,
    turnRate: (1.9 + turn * 4) / (1 + mass / 45),
    shieldRegen: shield * 0.12,
    gunDamage: 10 * (1 + 0.25 * g) * (1 + (buffs.damage || 0)),
    gunInterval: 0.28,
    mineRate: 9 * (1 + 0.45 * l) * (1 + (buffs.mining || 0)),
    mineRange: 340 + 45 * l,
    jumpRange: 2 + j * 2 + (effects.jumpBonus || 0) + (buffs.jump || 0),
    radius: ext * SHIP_BLOCK + 4,
  };
}

const bkey = (x, y, z) => `${x},${y},${z}`;

// A ship is valid when it has one cockpit, fits the bounds, and every block touches the cockpit.
export function validateShip(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > SHIP_MAX_BLOCKS) return 'Too many blocks.';
  const seen = new Map();
  let cockpits = 0;
  for (const b of blocks) {
    if (!Array.isArray(b) || b.length !== 4) return 'Bad block.';
    const [x, y, z, t] = b;
    if (![x, y, z].every(Number.isInteger) || !SHIP_PARTS[t]) return 'Bad block.';
    if (Math.abs(x) > SHIP_BOUNDS.x || Math.abs(y) > SHIP_BOUNDS.y || Math.abs(z) > SHIP_BOUNDS.z) return 'Out of bounds.';
    if (seen.has(bkey(x, y, z))) return 'Overlapping blocks.';
    seen.set(bkey(x, y, z), b);
    if (t === 'cockpit') cockpits++;
  }
  if (cockpits !== 1) return 'A ship needs exactly one cockpit.';
  const start = blocks.find((b) => b[3] === 'cockpit');
  const stack = [start], reached = new Set([bkey(start[0], start[1], start[2])]);
  while (stack.length) {
    const [x, y, z] = stack.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const k = bkey(x + dx, y + dy, z + dz);
      if (seen.has(k) && !reached.has(k)) { reached.add(k); stack.push(seen.get(k)); }
    }
  }
  if (reached.size !== blocks.length) return 'Every block must connect to the cockpit.';
  return null;
}

// ---- misc rules -----------------------------------------------------------------------------

export const BUILD_RANGE = 400;
export const DOCK_RANGE = 360;
export const LAND_MARGIN = 350;
export const JUMP_COOLDOWN_MS = 8000;
export const ASTEROID_REGROW_MS = 30 * 60 * 1000;
export const MAX_PARTY = 4;
export const INVENTORY_SIZE = 24;

export const cargoTotal = (cargo) => ORE_IDS.reduce((s, k) => s + (cargo[k] || 0), 0);

export function canAfford(cargo, cost) {
  return Object.entries(cost).every(([k, v]) => (cargo[k] || 0) >= v);
}

// ---- 3D math (tiny, dependency-free so the server can share it) -------------------------------

export function qRotate(q, v) {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export const forwardOf = (q) => qRotate(q, [0, 0, -1]);

// Arcade 6-DOF flight. Client predicts with it; the server checks the result is plausible.
export function stepShip(s, input, stats, dt) {
  const f = input.fwd || 0, st = input.strafe || 0, li = input.lift || 0;
  const [ax, ay, az] = qRotate(s.q, [st * 0.6, li * 0.6, -f]);
  s.vx += ax * stats.accel * dt; s.vy += ay * stats.accel * dt; s.vz += az * stats.accel * dt;
  const drag = Math.max(0, 1 - (input.brake ? 2.5 : 0.45) * dt);
  s.vx *= drag; s.vy *= drag; s.vz *= drag;
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  if (sp > stats.maxSpeed) { const k = stats.maxSpeed / sp; s.vx *= k; s.vy *= k; s.vz *= k; }
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
}

// Distance from point p to the segment a→b, and how far along it is (0..1).
export function segmentDistance(a, b, p) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len2));
  return [Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1], a[2] + dz * t - p[2]), t];
}
