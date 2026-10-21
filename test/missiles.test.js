import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { shipStats, shipClass, STARTER_SHIP, SHIP_CLASSES } from '../shared/rules.js';

process.env.AI_DISABLED = '1';

test('ship classes and homing missiles', () => {
  assert.equal(SHIP_CLASSES[shipClass(STARTER_SHIP)].name, 'Interceptor');
  const big = Array.from({ length: 60 }, (_, i) => [i % 5 - 2, Math.floor(i / 25) - 1, Math.floor(i / 5) % 5 - 2, i ? 'hull' : 'cockpit']);
  assert.equal(SHIP_CLASSES[shipClass(big)].name, 'Cruiser');

  const world = new World({ seed: 7 });
  const inbox = [];
  const conn = world.connect((m) => inbox.push(m), () => {});
  world.join(conn, 'gunner', 'Gunner');
  const p = conn.player;
  // Two missile racks in place of the wings.
  p.ship = p.ship.map(([x, y, z, t]) => [x, y, z, t === 'wing' ? 'missile' : t]);
  world.restat(p);
  assert.equal(p.stats.missiles, 2);
  p.mode = 'space'; p.dead = false; p.x = 50000; p.y = 0; p.z = 50000; p.q = [0, 0, 0, 1]; p.vx = p.vy = p.vz = 0;
  // A pirate ahead (forward is -z).
  const n = world.combat.spawnNpc('pirate', 50000, 0, 50000 - 900, 1);
  n.speed = 0;
  const hp = n.hp;
  world.on_missile(conn, { target: n.id });
  assert.equal(world.combat.missiles.length, 2);
  // Reloading: a second salvo right away does nothing.
  world.on_missile(conn, { target: n.id });
  assert.equal(world.combat.missiles.length, 2);
  for (let i = 0; i < 60 && world.combat.missiles.length; i++) world.combat.missileTick(0.05);
  assert.equal(world.combat.missiles.length, 0);
  assert.ok(!world.combat.npcs.has(n.id) || n.hp < hp, 'the missiles hit');
  // Out of range: refused.
  p.lastMissile = 0;
  const far = world.combat.spawnNpc('pirate', 50000, 0, 50000 - 9000, 1);
  world.on_missile(conn, { target: far.id });
  assert.equal(world.combat.missiles.length, 0);
});
