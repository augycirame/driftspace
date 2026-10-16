import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { generateSector, findPlanet, planetPos, sectorOf, STARTER_PLANET_ID } from '../shared/universe.js';
import { SETTLEMENT } from '../shared/planet.js';
import { STARTER_SHIP } from '../shared/rules.js';

const SEED = 777;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const w = waiters.find((x) => x.pred(m));
    if (w) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); } else inbox.push(m);
    if (inbox.length > 500) inbox.splice(0, inbox.length - 500);
  });
  return {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait(pred, ms = 5000) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for ' + pred)); }, ms);
        waiters.push(w);
      });
    },
    open: () => new Promise((r) => ws.once('open', r)),
    close: () => ws.close(),
  };
}

async function account(port, name, password = 'hunter22', mode = 'register') {
  const c = client(port);
  await c.open();
  c.send({ t: mode, name, password });
  const auth = await c.wait((m) => m.t === 'auth' || m.t === 'error');
  if (auth.t === 'error') return { c, error: auth.msg };
  const welcome = await c.wait((m) => m.t === 'welcome');
  return { c, auth, welcome };
}

// Walk a pilot on foot toward a point in small legal steps.
async function walkTo(c, from, to, world, conn) {
  let [x, z] = from;
  while (Math.hypot(to[0] - x, to[1] - z) > 0.5) {
    const d = Math.hypot(to[0] - x, to[1] - z), step = Math.min(d, 1.4);
    x += ((to[0] - x) / d) * step; z += ((to[1] - z) / d) * step;
    c.send({ t: 'walk', x, y: world.surfaces.ground(conn.player.planet, x, z), z, yaw: 0 });
    await sleep(110);
  }
  return [x, z];
}

// Move a ship in space in small legal steps.
async function flyTo(c, from, to) {
  let [x, y, z] = from;
  while (Math.hypot(to[0] - x, to[1] - y, to[2] - z) > 1) {
    const d = Math.hypot(to[0] - x, to[1] - y, to[2] - z), step = Math.min(d, 40);
    x += ((to[0] - x) / d) * step; y += ((to[1] - y) / d) * step; z += ((to[2] - z) / d) * step;
    c.send({ t: 'state', x, y, z, vx: 0, vy: 0, vz: 0, q: [0, 0, 0, 1] });
    await sleep(60);
  }
  return [x, y, z];
}

test('accounts, starter planet, tutorial, takeoff, mining, docking, story, ships, shops, parties, combat, persistence', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const dataFile = path.join(dir, 'world.json');
  let srv = await startServer({ port: 0, dataFile, seed: SEED, log: () => {} });
  t.after(() => srv.close());
  const world = srv.world;

  // --- accounts
  const a = await account(srv.port, 'Ada');
  assert.equal(a.welcome.you.mode, 'surface');
  assert.equal(a.welcome.you.planet, STARTER_PLANET_ID);
  assert.equal(a.welcome.you.inv.items[0].type, 'pistol');
  assert.ok(a.auth.token.length >= 32);
  const dup = await account(srv.port, 'ada');
  assert.match(dup.error, /taken/);
  dup.c.close();
  const bad = await account(srv.port, 'Ada', 'wrongpass', 'login');
  assert.match(bad.error, /Wrong name or password/);
  bad.c.close();
  assert.ok(!JSON.stringify(world.data).includes('hunter22'), 'password never stored');

  const conn = () => world.connByName('ada');

  // --- tutorial on Haven: talk to the Warden
  let pos = [a.welcome.you.px, a.welcome.you.pz];
  pos = await walkTo(a.c, pos, [SETTLEMENT.warden.x + 3, SETTLEMENT.warden.z], world, conn());
  a.c.send({ t: 'interact', what: 'warden' });
  await a.c.wait((m) => m.t === 'dialogue');
  await a.c.wait((m) => m.t === 'you' && m.tutorial === 1);

  // --- walking too fast is rejected
  a.c.send({ t: 'walk', x: pos[0] + 200, y: 5, z: pos[1], yaw: 0 });
  await a.c.wait((m) => m.t === 'teleport' && m.mode === 'surface');

  // --- digging outside the settlement gives ore
  pos = await walkTo(a.c, pos, [0, 90], world, conn());
  for (let i = 0; i < 6; i++) { a.c.send({ t: 'dig', x: pos[0] + 2, z: pos[1] + 2 }); await sleep(230); }
  const dug = await a.c.wait((m) => m.t === 'you' && m.tutorial === 2);
  assert.ok(Object.values(dug.cargo).reduce((s, v) => s + v, 0) >= 5);
  const digMsg = await a.c.wait((m) => m.t === 'dig');
  assert.ok(digMsg.d < 0);

  // --- visit the quartermaster
  pos = await walkTo(a.c, pos, [SETTLEMENT.vendor.x - 3, SETTLEMENT.vendor.z], world, conn());
  a.c.send({ t: 'interact', what: 'vendor' });
  const havenShop = await a.c.wait((m) => m.t === 'shop');
  assert.ok(havenShop.stock.length > 0);
  await a.c.wait((m) => m.t === 'you' && m.tutorial === 3);

  // --- take off from the pad
  const parked = conn().player.parked;
  pos = await walkTo(a.c, pos, [parked.x + 4, parked.z], world, conn());
  a.c.send({ t: 'interact', what: 'ship' });
  const up = await a.c.wait((m) => m.t === 'teleport' && m.mode === 'space');
  assert.equal(conn().player.mode, 'space');

  // --- mine an asteroid in space
  a.c.send({ t: 'sub', keys: ['0,0'] });
  await a.c.wait((m) => m.t === 'sector' && m.key === '0,0');
  const home = generateSector(0, 0, SEED);
  const rock = home.asteroids.reduce((b, r) => (Math.hypot(r.x - up.x, r.z - up.z) < Math.hypot(b.x - up.x, b.z - up.z) ? r : b));
  // The server allows a big hop right after teleport? No: fly legally.
  let ship = await flyTo(a.c, [up.x, up.y, up.z], [rock.x + rock.r + 80, rock.y, rock.z]);
  // Subscribe around where we are now, like the real client does.
  const [nsx, nsz] = sectorOf(ship[0], ship[2]);
  const around = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) around.push(`${nsx + dx},${nsz + dz}`);
  a.c.send({ t: 'sub', keys: around });
  await sleep(200);
  a.c.send({ t: 'mine', id: rock.id });
  await a.c.wait((m) => m.t === 'ast' && m.id === rock.id, 8000);
  await a.c.wait((m) => m.t === 'you' && m.tutorial === 5, 10000);
  a.c.send({ t: 'mine', id: null });

  // --- dock at Haven Station, contribute to the story, rebuild the ship
  const st = home.station;
  ship = await flyTo(a.c, ship, [st.x + 150, st.y, st.z]);
  a.c.send({ t: 'dock' });
  const docked = await a.c.wait((m) => m.t === 'docked');
  assert.equal(docked.station.name, 'Haven Station');
  conn().player.cargo.iron = 300;
  conn().player.cargo.copper = 50;
  conn().player.cargo.gold = 20;
  a.c.send({ t: 'contribute' });
  await a.c.wait((m) => m.t === 'toast' && /Contributed/.test(m.msg));
  assert.ok(world.data.story.progress['deliver:iron'] > 0);
  const story = await a.c.wait((m) => m.t === 'story');
  assert.equal(story.story.title, 'The Silent Signal');

  // Invalid ship (floating block) is refused; a valid bigger ship costs ore.
  a.c.send({ t: 'ship_save', blocks: [...STARTER_SHIP, [3, 3, 3, 'hull']] });
  await a.c.wait((m) => m.t === 'toast' && /connect/.test(m.msg));
  conn().player.cargo.iron = 50; conn().player.cargo.copper = 20;
  const bigger = [...STARTER_SHIP, [0, 1, 0, 'armor'], [0, 0, 2, 'thruster']];
  a.c.send({ t: 'ship_save', blocks: bigger });
  const rebuilt = await a.c.wait((m) => m.t === 'you' && m.ship?.length === bigger.length);
  assert.ok(rebuilt.stats.hp > 235);

  // --- shop: buy a rifle and equip it
  conn().player.credits = 5000;
  a.c.send({ t: 'shop' });
  const shop = await a.c.wait((m) => m.t === 'shop');
  const rifleSlot = shop.stock.find((s) => s.type === 'rifle').slot;
  a.c.send({ t: 'buy', slot: rifleSlot });
  const bought = await a.c.wait((m) => m.t === 'you' && m.inv?.items.length === 2);
  const rifle = bought.inv.items.find((i) => i.type === 'rifle');
  a.c.send({ t: 'equip', id: rifle.id });
  await a.c.wait((m) => m.t === 'you' && m.inv?.equipped.weapon === rifle.id);

  // --- parties
  const b = await account(srv.port, 'Bob');
  a.c.send({ t: 'party_invite', name: 'Bob' });
  await b.c.wait((m) => m.t === 'party_invite' && m.from === 'Ada');
  b.c.send({ t: 'party_accept' });
  const party = await a.c.wait((m) => m.t === 'party' && m.party && m.party.members.length === 2);
  assert.equal(party.party.leader, 'ada');
  b.c.send({ t: 'chat', channel: 'party', text: 'hi team' });
  await a.c.wait((m) => m.t === 'chat' && m.channel === 'party' && m.text === 'hi team');

  // --- combat: a pirate parked in front of Ada's guns gets destroyed for a bounty
  const before = conn().player.credits;
  const p = conn().player;
  const npc = world.combat.spawnNpc('pirate', p.x, p.y, p.z - 120, 1);
  npc.speed = 0; npc.dmg = 0;
  for (let i = 0; i < 40 && world.combat.npcs.has(npc.id); i++) { a.c.send({ t: 'fire' }); await sleep(300); }
  assert.ok(!world.combat.npcs.has(npc.id), 'pirate destroyed');
  assert.ok(conn().player.credits > before, 'bounty paid');

  // --- landing on another planet in the home system
  const planet = home.planets.find((pl) => pl.landable && !pl.starter);
  if (planet) {
    const [px, py, pz] = planetPos(planet, home.star, Date.now() / 1000);
    world.combat.npcs.clear();
    world.teleport(conn(), px, py + planet.r + 200, pz);
    await sleep(150);
    a.c.send({ t: 'land', planet: planet.id });
    const landed = await a.c.wait((m) => m.t === 'teleport' && m.mode === 'surface');
    assert.equal(landed.planet, planet.id);
    await a.c.wait((m) => m.t === 'surface' && m.planet === planet.id);
  }

  // --- persistence: restart, sign back in with the token, keep ship and gear
  const token = a.auth.token;
  a.c.close(); b.c.close();
  await sleep(150);
  await srv.close();
  srv = await startServer({ port: 0, dataFile, seed: SEED, log: () => {} });
  const r = client(srv.port);
  await r.open();
  r.send({ t: 'resume', token });
  const back = await r.wait((m) => m.t === 'welcome');
  assert.equal(back.you.ship.length, bigger.length);
  assert.ok(back.you.inv.items.some((i) => i.type === 'rifle'));
  assert.ok(srv.world.data.story.progress['deliver:iron'] > 0);
  r.close();
});

test('story arcs advance and change the galaxy', async (t) => {
  const srv = await startServer({ port: 0, dataFile: null, seed: SEED, log: () => {} });
  t.after(() => srv.close());
  const story = srv.world.story;
  story.add('deliver:voidstone', 1000);
  story.add('deliver:iron', 1000);
  assert.equal(story.arc.id, 'swarm');
  assert.equal(story.effects().invasion, true);
  story.add('kill:hollow', 1000);
  assert.equal(story.effects().mothership, true);
  story.add('kill:mothership', 1);
  assert.equal(story.arc.id, 'gate');
  for (const o of ['iron', 'copper', 'gold', 'voidstone']) story.add('deliver:' + o, 1e6);
  assert.equal(story.effects().gateBuilt, true);
  assert.equal(story.arc.id, 'echoes');
  assert.equal(story.relics().length, 5);
  story.add('relic', 5);
  assert.equal(story.s.era, 1);
  assert.equal(story.effects().jumpBonus, 2);
  assert.equal(story.arc.id, 'signal');
  assert.ok(story.view().goals[0].target > 40, 'later eras ask for more');
  void findPlanet;
});

test('factions, shrines, ruins and reputation', { timeout: 60000 }, async (t) => {
  const { holyCapitalSector } = await import('../shared/universe.js');
  const { structuresOf } = await import('../shared/planet.js');
  const { STRUCTURES } = await import('../shared/content/structures.js');
  const srv = await startServer({ port: 0, dataFile: null, seed: SEED, log: () => {} });
  t.after(() => srv.close());
  const world = srv.world;
  const a = await account(srv.port, 'Zed');
  const conn = world.connByName('zed');
  const p = conn.player;

  // A shrine and a lootable ruin on some planet near Haven.
  let shrine = null, cache = null;
  for (let x = -4; x <= 4 && !(shrine && cache); x++) for (let z = -4; z <= 4; z++) {
    for (const pl of generateSector(x, z, SEED).planets.filter((q) => q.landable && !q.starter)) {
      for (const st of structuresOf(pl)) {
        if (!shrine && STRUCTURES[st.type].kind === 'shrine') shrine = { pl, st };
        if (!cache && STRUCTURES[st.type].kind === 'ruin' && STRUCTURES[st.type].cache) cache = { pl, st };
      }
    }
  }
  assert.ok(shrine && cache, 'found a shrine and a ruin');

  // Pray at the shrine: a blessing, favor, and the Empire disapproves.
  world.surfaces.place(conn, shrine.pl.id);
  Object.assign(p, { px: shrine.st.x + shrine.st.radius + 2, pz: shrine.st.z });
  a.c.send({ t: 'interact', what: 'structure', id: shrine.st.id });
  const blessed = await a.c.wait((m) => m.t === 'you' && m.blessing);
  assert.ok(blessed.blessing.bonus);
  assert.ok(Object.values(blessed.buffs).some((v) => v > 0));
  assert.equal(p.favor[shrine.st.god], 1);
  assert.equal(p.rep.empire, -3);
  assert.ok(p.codex[`god:${shrine.st.god}`]);

  // Search a ruin: loot once, never twice.
  world.surfaces.place(conn, cache.pl.id);
  Object.assign(p, { px: cache.st.x + cache.st.radius + 2, pz: cache.st.z });
  const before = p.credits;
  a.c.send({ t: 'interact', what: 'structure', id: cache.st.id });
  await a.c.wait((m) => m.t === 'looted' && m.id === cache.st.id);
  assert.ok(p.credits > before);
  a.c.send({ t: 'interact', what: 'structure', id: cache.st.id });
  await a.c.wait((m) => m.t === 'toast' && /already searched/.test(m.msg));
  assert.ok(p.codex[`terrain:${(await import('../shared/planet.js')).terrainOf(cache.pl)}`], 'landing fills the codex');

  // Imperial space: a wanted pilot is refused docking.
  const [cx, cz] = holyCapitalSector(SEED);
  const sanctum = generateSector(cx, cz, SEED).station;
  p.mode = 'space';
  world.teleport(conn, sanctum.x + 100, sanctum.y, sanctum.z);
  p.rep.empire = -40;
  a.c.send({ t: 'dock' });
  await a.c.wait((m) => m.t === 'toast' && /Docking denied/.test(m.msg));
  // A citizen can dock and receive the Benediction.
  p.rep.empire = 40;
  p.credits = 1000;
  a.c.send({ t: 'dock' });
  const docked = await a.c.wait((m) => m.t === 'docked');
  assert.ok(docked.station.capital);
  a.c.send({ t: 'benediction' });
  const bene = await a.c.wait((m) => m.t === 'you' && m.blessing?.name === 'Radiant Benediction');
  assert.ok(bene.buffs.damage >= 0.2);

  // Destroying an Imperial patrol costs Imperial standing and wins rebel favor.
  p.rep.empire = 0;
  p.rep.rebellion = 0;
  world.combat.npcs.clear();
  const npc = world.combat.spawnNpc('imperial', p.x, p.y, p.z - 120, 1);
  npc.speed = 0; npc.dmg = 0;
  for (let i = 0; i < 60 && world.combat.npcs.has(npc.id); i++) { a.c.send({ t: 'fire' }); await sleep(300); }
  assert.ok(!world.combat.npcs.has(npc.id), 'imperial destroyed');
  assert.ok(p.rep.empire < 0 && p.rep.rebellion > 0);
  assert.ok(world.data.war.rebellion >= 1);
  a.c.close();
});
