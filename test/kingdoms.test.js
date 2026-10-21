import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { realmsOf } from '../shared/towns.js';
import { KNIGHT, LORD, MONARCH } from '../server/kingdoms.js';

process.env.AI_DISABLED = '1';
const SEED = 99;

test('player kingdoms: knight, lord with a fief and taxes, then the throne', () => {
  const world = new World({ seed: SEED });
  const inbox = [];
  const conn = world.connect((m) => inbox.push(m), () => {});
  world.join(conn, 'grid', 'Grid');
  const p = conn.player;
  const haven = findPlanet(STARTER_PLANET_ID, SEED);
  // A realm with a town besides its capital.
  const realm = realmsOf(haven)[0];
  const pol = world.politics, K = world.kingdoms;
  const c = { id: 'ruler', role: 'ruler', realm: realm.id, npc: 'x' };
  const cur = { c, pid: haven.id };
  const lines = () => inbox.filter((m) => m.t === 'talk_line').map((m) => m.line);
  // A stranger can't swear fealty.
  K.action(conn, cur, 'k:fealty');
  assert.equal(p.fealty, null);
  p.standing = { [realm.id]: 35 };
  assert.deepEqual(K.talkOptions(conn, c, haven.id).map(([o]) => o), ['k:fealty']);
  K.action(conn, cur, 'k:fealty');
  assert.equal(p.fealty.rank, KNIGHT);
  assert.match(K.titleOf(p), /^Knight of/);
  // A fief costs standing and credits.
  K.action(conn, cur, 'k:fief');
  assert.equal(p.fealty.rank, KNIGHT);
  p.standing[realm.id] = 70; p.credits = 5000;
  K.action(conn, cur, 'k:fief');
  assert.equal(p.fealty.rank, LORD);
  assert.equal(p.credits, 2000);
  assert.match(K.titleOf(p), /^Lord of /);
  // Taxes come in while the lord plays.
  p.fealty.lastTax = Date.now() - 3600000;
  K.lastTax = 0;
  K.tick(Date.now());
  assert.ok(p.credits > 2000, 'the fief paid its taxes');
  // The throne: a beloved hero takes it when the realm is shaky, or when they're a legend.
  p.standing[realm.id] = 90;
  pol.state(haven.id).realms[realm.id].stability = 80;
  K.action(conn, cur, 'k:throne');
  assert.equal(p.fealty.rank, LORD);
  p.spire = 3;
  K.action(conn, cur, 'k:throne');
  assert.equal(p.fealty.rank, MONARCH);
  assert.equal(pol.ruler(haven.id, realm.id).name, 'Grid');
  assert.ok(K.titleOf(p).includes(realm.name));
  // The monarch draws on the treasury and can declare war.
  const coins = p.coins?.[realm.id] || 0;
  K.action(conn, cur, 'k:collect');
  assert.ok(p.coins[realm.id] > coins);
  const foe = Object.keys(pol.state(haven.id).realms).find((id) => id !== realm.id);
  if (foe && !pol.state(haven.id).realms[realm.id].war && !pol.state(haven.id).realms[foe].war) {
    K.action(conn, cur, `k:war:${foe}`);
    assert.ok(pol.atWar(haven.id, realm.id, foe));
    pol.state(haven.id).realms[realm.id].treasury = 1000;
    K.action(conn, cur, 'k:peace');
    assert.ok(!pol.atWar(haven.id, realm.id, foe));
  }
  assert.ok(lines().length > 5);
});
