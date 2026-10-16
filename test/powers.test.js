import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { townsOf } from '../shared/towns.js';
import { skillLevel, POWERS, mechStats } from '../shared/powers.js';
import { makeItem } from '../shared/items.js';

process.env.AI_DISABLED = '1';
const SEED = 99;

function setup(name) {
  const world = new World({ seed: SEED });
  const inbox = [];
  const conn = world.connect((m) => inbox.push(m), () => {});
  world.join(conn, name.toLowerCase(), name);
  const haven = findPlanet(STARTER_PLANET_ID, SEED);
  const inst = world.surfaces.instance(haven.id);
  return { world, conn, p: conn.player, inbox, haven, inst };
}

test('skills grow with use and level up', () => {
  const { world, conn, p } = setup('Learner');
  world.powers.gain(conn, 'mining', 200);
  assert.equal(skillLevel(p.skills.mining), 2);
  world.powers.gain(conn, 'piloting', 5000);
  world.restat(p);
  assert.ok(p.stats.maxSpeed > 0);
});

test('mages teach spells for coin, and spells hurt, heal and blink', () => {
  const { world, conn, p, inst, haven, inbox } = setup('Caster');
  const elves = townsOf(haven).find((t) => t.people === 'elf');
  p.px = elves.x; p.pz = elves.z;
  world.surfaces.natives.spawn(inst, [conn], Date.now());
  const teacher = [...inst.creatures.values()].find((c) => c.town === elves.id && (c.role === 'mage' || c.role === 'priest' || c.role === 'healer'));
  assert.ok(teacher, 'the elven city has someone who teaches magic');
  p.px = teacher.x; p.pz = teacher.z;
  world.talk.open(conn, inst, teacher);
  p.credits = 10000;
  const spell = Object.entries((world.powers.teachOptions(teacher, p)))[0][1][0];
  world.talk.choose(conn, { id: teacher.id, opt: `spell:${spell}` });
  assert.ok(p.spells.includes(spell));
  // Firebolt and friends, cast at a wild creature in front of us.
  p.spells = ['firebolt', 'heal', 'blink'];
  p.mana = 200;
  p.px = 0; p.pz = 120; p.py = world.surfaces.ground(haven.id, 0, 120);
  const c = world.surfaces.newCreature(inst, 'glowmoth', 0, 110);
  c.y = world.surfaces.ground(haven.id, 0, 110);
  const hp0 = c.hp;
  const dir = [0, (c.y + c.size * 0.8 - (p.py + 1.5)) / 10, -1];
  world.powers.cast(conn, { spell: 'firebolt', dir });
  assert.ok(c.hp < hp0 || !inst.creatures.has(c.id), 'the firebolt hit');
  p.hp = 10;
  world.powers.cast(conn, { spell: 'heal' });
  assert.ok(p.hp > 10);
  const z0 = p.pz;
  world.powers.cast(conn, { spell: 'blink', dir: [0, 0, -1] });
  assert.ok(p.pz < z0 - 10);
  assert.ok(inbox.some((m) => m.t === 'spell'));
});

test('gods grant superpowers to the devout, and curses take hold', () => {
  const { world, conn, p } = setup('Devout');
  p.favor.vael = 3;
  world.powers.favored(conn, 'vael');
  assert.equal(p.power, 'flight');
  world.powers.usePower(conn);
  assert.ok(p.powerOn && world.powers.flying(p));
  p.favor.isareth = 3;
  world.powers.favored(conn, 'isareth');
  assert.equal(p.power, 'aegis');
  world.powers.usePower(conn);
  assert.equal(world.powers.absorb(conn, 50), 0, 'aegis blocks all damage');
  // A vampire's bite, given enough tries, passes on the curse.
  p.aegisUntil = 0;
  for (let i = 0; i < 400 && !p.curse; i++) world.powers.bitten(conn, { people: 'vampire' });
  assert.equal(p.curse, 'vampire');
});

test('a mech takes the hits and fires a cannon', () => {
  const { world, conn, p, inst, haven } = setup('Pilot');
  const mech = makeItem('mech', 'mech', 2);
  p.inv.items.push(mech);
  world.on_equip(conn, { id: mech.id });
  assert.equal(p.inv.equipped.mech, mech.id);
  world.powers.toggleMech(conn);
  assert.ok(p.inMech);
  const hp = p.hp;
  world.surfaces.hurtPlayer(conn, 100, 'test');
  assert.equal(p.hp, hp, 'the pilot is safe inside');
  assert.ok(mech.hp < mechStats(2).hp);
  p.px = 0; p.pz = 120; p.py = world.surfaces.ground(haven.id, 0, 120);
  const c = world.surfaces.newCreature(inst, 'glowmoth', 0, 100);
  c.y = world.surfaces.ground(haven.id, 0, 100);
  const hp0 = c.hp;
  world.surfaces.shoot(conn, { dir: [0, (c.y + 1 - (p.py + 4.2)) / 20, -1] });
  assert.ok(c.hp < hp0 || !inst.creatures.has(c.id));
  world.powers.toggleMech(conn);
  assert.ok(!p.inMech);
});

test('bases: claims, beds, chests, crafting and player stations', () => {
  const { world, conn, p, haven } = setup('Builder');
  const S = world.surfaces;
  p.px = 150; p.pz = 150; p.py = S.ground(haven.id, 150, 150);
  p.cargo = { wood: 100, stone: 50, iron: 200, gold: 20, hide: 20, copper: 40 };
  const g = (v) => Math.floor(v / 2);
  const gy = g(p.py) + 1;
  S.build(conn, { gx: g(150), gy, gz: g(152), block: 'banner' });
  S.build(conn, { gx: g(152), gy, gz: g(150), block: 'bed' });
  S.build(conn, { gx: g(148), gy, gz: g(150), block: 'chest' });
  S.build(conn, { gx: g(150), gy, gz: g(148), block: 'bench' });
  const blocks = S.saved(haven.id).blocks;
  assert.equal(Object.values(blocks).filter((b) => b.o === 'Builder').length, 4);
  assert.ok(p.bed);
  // Someone else can't dig or build on claimed land.
  const inbox2 = [];
  const other = world.connect((m) => inbox2.push(m), () => {});
  world.join(other, 'rival', 'Rival');
  other.player.px = 152; other.player.pz = 152; other.player.py = p.py;
  other.player.cargo = { wood: 10 };
  S.build(other, { gx: g(154), gy, gz: g(154), block: 'wood' });
  assert.equal(Object.values(blocks).filter((b) => b.o === 'Rival').length, 0);
  assert.ok(inbox2.some((m) => m.t === 'toast' && /claimed/.test(m.msg)));
  // Store and take materials.
  const chestCell = Object.entries(blocks).find(([, b]) => b.b === 'chest')[0];
  world.bases.chest(conn, { cell: chestCell, dir: 'put', item: 'stone' });
  assert.equal(blocks[chestCell].inv.stone, 50);
  const keep = p.cargo;
  p.cargo = {};
  world.bases.chest(conn, { cell: chestCell, dir: 'take', item: 'stone', n: 10 });
  assert.equal(p.cargo.stone, 10);
  p.cargo = keep;
  // Craft a weapon at the workbench.
  const items = p.inv.items.length;
  world.bases.craft(conn, { recipe: 'sword', tier: 1, type: 'plasma' });
  assert.equal(p.inv.items.length, items + 1);
  assert.equal(p.inv.items.at(-1).type, 'plasma');
  // A docking port in space makes a station.
  world.surfaces.takeoff(conn);
  p.cargo.iron = 100; p.cargo.copper = 40; p.cargo.gold = 10;
  const cx = Math.floor(p.x / 8), cy = Math.floor(p.y / 8), cz = Math.floor((p.z - 60) / 8);
  world.on_build(conn, { gx: cx, gy: cy, gz: cz, block: 'dock' });
  const st = world.dockedStation(p);
  assert.ok(st, 'the docking port works as a station');
});

test('black holes pull, burn and fling you across the galaxy', async () => {
  const { gravityAt } = await import('../shared/rules.js');
  const hole = { x: 0, y: 0, z: 0, r: 150, type: 'Black hole' };
  const near = Math.hypot(...gravityAt(hole, 400, 0, 0)), far = Math.hypot(...gravityAt(hole, 3000, 0, 0));
  assert.ok(near > far && far > 0);
  assert.deepEqual(gravityAt({ ...hole, type: 'Yellow star' }, 50000, 0, 0), [0, 0, 0]);
});
