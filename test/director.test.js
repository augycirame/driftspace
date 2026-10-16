import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { STARTER_PLANET_ID, findPlanet } from '../shared/universe.js';

process.env.AI_DISABLED = '1';
const SEED = 515;

function join(world, name) {
  const inbox = [];
  const conn = world.connect((m) => inbox.push(m), () => {});
  world.join(conn, name.toLowerCase(), name);
  return { conn, inbox };
}

test('the director turns the dials toward a healthy game', () => {
  const world = new World({ seed: SEED });
  const d = world.director;
  // Lots of deaths and runaway income over plenty of play.
  d.adjust({ playerHours: 2, deathsPerHour: 9, killsPerHour: 10, incomePerHour: 50000, tickMs: 30 });
  assert.ok(d.difficulty < 1 && d.loot < 1);
  // A struggling server sheds spawns; a quiet one gets them back.
  d.adjust({ playerHours: 0, tickMs: 120 });
  assert.ok(d.spawns < 1);
  const low = d.spawns;
  d.adjust({ playerHours: 0, tickMs: 5 });
  assert.ok(d.spawns > low);
  // Dials never leave their limits.
  for (let i = 0; i < 100; i++) d.adjust({ playerHours: 2, deathsPerHour: 0, killsPerHour: 500, incomePerHour: 0, tickMs: 30 });
  assert.ok(d.difficulty <= 1.6 && d.loot <= 1.5);
  assert.ok(d.s.log.length > 0);
});

test('world events: raids, omens, bonanzas', () => {
  const world = new World({ seed: SEED });
  const { conn } = join(world, 'Watcher');
  const d = world.director;
  assert.ok(d.event('raid'));
  const s = world.politics.state(STARTER_PLANET_ID);
  assert.ok(Object.values(s.realms).some((r) => r.event?.kind === 'raiders'));
  assert.ok(d.event('omen'));
  assert.ok(conn.player.blessing?.name.startsWith('Omen of'));
  assert.ok(d.event('bonanza'));
  assert.ok(d.bonanza());
  const m = d.metrics();
  assert.equal(m.players, 1);
});

test('the game master (Claude) decides within bounds', async () => {
  const world = new World({ seed: SEED });
  join(world, 'Player');
  const calls = [];
  world.ai.enabled = true;
  world.ai.client = { beta: { messages: { create: async (body) => {
    calls.push(body);
    return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ reasoning: 'Players are cruising; push back a little and liven things up.', difficulty: 3, loot: 0.1, event: 'omen', planet: STARTER_PLANET_ID, announcement: 'Strange lights dance over Haven tonight.' }) }] };
  } } } };
  world.director.s.lastGm = 0;
  await world.director.gameMaster(world.director.metrics());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.ok(Math.abs(world.director.difficulty - 1.15) < 1e-9, 'moved at most 0.15');
  assert.ok(Math.abs(world.director.loot - 0.85) < 1e-9);
  assert.ok(world.director.s.log.some((e) => e.text.includes('Game master')));
});
