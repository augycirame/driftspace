import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { townsOf } from '../shared/towns.js';
import { RANKS, rankOf, canTake } from '../shared/guild.js';

process.env.AI_DISABLED = '1';
const SEED = 99;

test('the Mercenary Guild: board, contracts, turn-in and promotion', () => {
  const world = new World({ seed: SEED });
  const inbox = [];
  const conn = world.connect((m) => inbox.push(m), () => {});
  world.join(conn, 'merc', 'Merc');
  const p = conn.player;
  const haven = findPlanet(STARTER_PLANET_ID, SEED);
  world.surfaces.instance(haven.id);
  // Far from a guild hall there is no board.
  p.mode = 'surface'; p.planet = haven.id; p.px = 0; p.pz = 0;
  world.on_guild(conn);
  assert.ok(!inbox.some((m) => m.t === 'guild'));
  // Every city has a guild hall.
  const city = townsOf(haven).find((t) => t.size === 'city');
  const hall = city.buildings.find((b) => b.kind === 'guild');
  assert.ok(hall);
  p.px = hall.x; p.pz = hall.z + hall.d / 2 + 2;
  world.on_guild(conn);
  const view = inbox.filter((m) => m.t === 'guild').at(-1);
  assert.ok(view, 'the board opens');
  assert.equal(view.rank, 0);
  assert.ok(view.board.length >= 4);
  // High-rank work is locked to a novice.
  const locked = view.board.find((c) => c.rank >= 2);
  if (locked) {
    assert.ok(locked.locked);
    world.on_guild_accept(conn, { key: locked.key });
    assert.equal(p.guild.contracts.length, 0);
  }
  // Take an F/E contract, finish it, turn it in.
  const open = view.board.find((c) => !c.locked);
  world.on_guild_accept(conn, { key: open.key });
  assert.equal(p.guild.contracts.length, 1);
  const c = p.guild.contracts[0];
  if (c.kind === 'deliver') p.cargo[c.ore] = c.need;
  else c.have = c.need, c.ready = true;
  const credits = p.credits;
  world.on_guild_turnin(conn, { id: c.id });
  assert.equal(p.guild.contracts.length, 0);
  assert.equal(p.credits, credits + c.credits);
  assert.equal(p.guild.merit, c.merit);
  // Contracts show up in the journal.
  world.on_guild_accept(conn, { key: view.board.find((x) => !x.locked && x.key !== open.key)?.key || open.key });
  const q = inbox.filter((m) => m.t === 'quests').at(-1);
  assert.ok(q.list.some((x) => x.guild));
  // Space bounties count destroyed ships.
  p.guild.contracts = [{ id: 'k1', key: 'x', kind: 'bounty', ships: ['pirate'], need: 2, have: 0, rank: 1, credits: 100, merit: 500, title: 'Bounty', text: '' }];
  world.guild.onShipKill(conn, 'pirate');
  world.guild.onShipKill(conn, 'hollow');
  assert.equal(p.guild.contracts[0].have, 1);
  world.guild.onShipKill(conn, 'pirate');
  assert.ok(p.guild.contracts[0].ready);
  world.on_guild_turnin(conn, { id: 'k1' });
  assert.ok(rankOf(p.guild.merit) >= 2, 'promoted');
  assert.ok(inbox.some((m) => m.t === 'transmission' && /PROMOTED/.test(m.title)));
  assert.ok(canTake(1, 2) && !canTake(1, 3));
  assert.equal(RANKS.at(-1).id, 'S');
});
