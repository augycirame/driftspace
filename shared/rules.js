// Game rules shared by the server (which enforces them) and the client (which predicts and
// displays them). Tuning lives here so both sides always agree.

export const ORES = {
  iron:      { name: 'Iron',      color: '#9aa3ad', price: 2 },
  ice:       { name: 'Ice',       color: '#bfe8ff', price: 3 },
  copper:    { name: 'Copper',    color: '#e08a4f', price: 5 },
  gold:      { name: 'Gold',      color: '#f2cf4a', price: 15 },
  voidstone: { name: 'Voidstone', color: '#b86bff', price: 60 },
};
export const ORE_IDS = Object.keys(ORES);

export const GRID = 32; // build grid cell size in world units

export const BLOCKS = {
  hull:   { name: 'Hull plate',   color: '#5d6b7a', cost: { iron: 4 } },
  glass:  { name: 'Glass',        color: '#8fd3ff', cost: { ice: 3 } },
  solar:  { name: 'Solar panel',  color: '#2b4f9e', cost: { copper: 3, ice: 1 } },
  light:  { name: 'Light',        color: '#fff2a8', cost: { iron: 1, copper: 2 } },
  gold:   { name: 'Gilded plate', color: '#e8c547', cost: { gold: 2 } },
  beacon: { name: 'Beacon',       color: '#ff5fa2', cost: { iron: 10, gold: 3 }, beacon: true },
};
export const BLOCK_IDS = Object.keys(BLOCKS);

export const UPGRADES = {
  engine: { name: 'Engine',     max: 8, desc: 'Thrust and top speed' },
  laser:  { name: 'Mining laser', max: 8, desc: 'Mining speed and reach' },
  cargo:  { name: 'Cargo hold', max: 8, desc: 'Cargo capacity' },
  jump:   { name: 'Jump drive', max: 8, desc: 'Hyperspace jump range' },
};
export const upgradeCost = (level) => Math.round(120 * Math.pow(2.1, level));

export const BUILD_RANGE = 600;
export const DOCK_RANGE = 320;
export const JUMP_COOLDOWN_MS = 8000;
export const ASTEROID_REGROW_MS = 30 * 60 * 1000;

export function shipStats(upg = {}) {
  const e = upg.engine || 0, l = upg.laser || 0, c = upg.cargo || 0, j = upg.jump || 0;
  return {
    accel: 520 * (1 + 0.22 * e),
    maxSpeed: 650 * (1 + 0.18 * e),
    turnRate: 3.4,
    mineRate: 9 * (1 + 0.45 * l),      // ore units per second
    mineRange: 320 + 45 * l,
    cargo: 60 + 50 * c,
    jumpRange: 2 + j * 2,               // in sectors (Chebyshev distance)
  };
}

export const cargoTotal = (cargo) => ORE_IDS.reduce((s, k) => s + (cargo[k] || 0), 0);

export function canAfford(cargo, cost) {
  return Object.entries(cost).every(([k, v]) => (cargo[k] || 0) >= v);
}

// Ship physics, run identically by the client (prediction) and the server (validation).
export function stepShip(s, input, stats, dt) {
  if (input.left) s.a -= stats.turnRate * dt;
  if (input.right) s.a += stats.turnRate * dt;
  if (input.thrust) {
    s.vx += Math.cos(s.a) * stats.accel * dt;
    s.vy += Math.sin(s.a) * stats.accel * dt;
  }
  if (input.brake) {
    const k = Math.max(0, 1 - 2.5 * dt);
    s.vx *= k;
    s.vy *= k;
  }
  const drag = Math.max(0, 1 - 0.35 * dt);
  s.vx *= drag;
  s.vy *= drag;
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > stats.maxSpeed) {
    s.vx *= stats.maxSpeed / sp;
    s.vy *= stats.maxSpeed / sp;
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}
