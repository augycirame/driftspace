import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { spireOf } from '../shared/planet.js';
import { floorBoss } from '../shared/tower.js';

process.env.AI_DISABLED = '1';
const SEED = 99;

test('the Spire: floors, raid bosses with phases, last attack and the front line', () => {
  const world = new World({ seed: SEED });
  const join = (name) => {
    const inbox = [];
    const conn = world.connect((m) => inbox.push(m), () => {});
    world.join(conn, name.toLowerCase(), name);
    return { conn, inbox, p: conn.player };
  };
  const a = join('Kirito'), b = join('Asuna');
  world.parties.invite(a.conn, 'Asuna');
  world.parties.accept(b.conn);
  const haven = findPlanet(STARTER_PLANET_ID, SEED), sp = spireOf(haven);
  for (const { p } of [a, b]) { p.mode = 'surface'; p.planet = haven.id; p.px = sp.x + 20; p.pz = sp.z; p.py = world.surfaces.ground(haven.id, p.px, p.pz); }
  world.surfaces.instance(haven.id);
  // The floor list, from the front line down.
  world.surfaces.interact(a.conn, { what: 'spire' });
  const list = a.inbox.find((m) => m.t === 'tower');
  assert.equal(list.frontier, 1);
  assert.equal(list.floors[0].boss, floorBoss(1).name);
  // Floor 2 isn't open yet.
  world.on_tower_enter(a.conn, { floor: 2 });
  assert.equal(a.p.mode, 'surface');
  world.on_tower_enter(a.conn, { floor: 1 });
  world.on_tower_enter(b.conn, { floor: 1 });
  assert.equal(a.p.mode, 'dungeon');
  const inst = world.dungeons.inst(a.conn);
  assert.equal(inst.floor, 1);
  const party = world.parties.of(a.p.key);
  assert.ok(party, 'Kirito and Asuna are in a party');
  if (party) assert.equal(world.dungeons.inst(b.conn), inst, 'the party shares the floor');
  const boss = [...inst.enemies.values()].find((e) => e.floorBoss);
  assert.equal(boss.name, floorBoss(1).name);
  // The boss wakes up and scales to the party.
  const hp0 = boss.maxHp;
  a.p.px = boss.x + 2; a.p.pz = boss.z; b.p.px = boss.x - 2; b.p.pz = boss.z;
  world.dungeons.enemyTick(inst, world.dungeons.members(inst), 0.05, Date.now());
  assert.ok(boss.aggro);
  if (party) assert.ok(boss.maxHp > hp0);
  // Half health: it enrages and calls guards.
  const before = inst.enemies.size;
  boss.hp = boss.maxHp * 0.4;
  world.dungeons.enemyTick(inst, world.dungeons.members(inst), 0.05, Date.now());
  assert.equal(boss.phase, 1);
  assert.ok(inst.enemies.size > before);
  // The killing blow: the last attack bonus and the next floor opens.
  const items = a.p.inv.items.length;
  world.dungeons.hurtEnemy(inst, boss, boss.hp + 1, a.conn);
  assert.ok(inst.bossDead);
  assert.ok(a.p.inv.items.length > items);
  assert.ok(['unique', 'legendary'].includes(a.p.inv.items.at(-1).grade));
  assert.ok(a.inbox.some((m) => m.t === 'transmission' && m.title === 'LAST ATTACK BONUS'));
  assert.equal(world.data.tower.frontier, 2);
  assert.ok(world.data.tower.clears[1]);
  assert.equal(a.p.spire, 1);
});
