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
