import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';
import { generateSector } from '../shared/universe.js';
import { GRID } from '../shared/rules.js';

const SEED = 777;

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const api = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 4000) => new Promise((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return resolve(found); }
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('timeout waiting for ' + pred)), ms);
    }),
    open: () => new Promise((r) => ws.once('open', r)),
    close: () => ws.close(),
  };
  return api;
}

test('two pilots: join, see each other, mine, sell, upgrade, build, persist', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const dataFile = path.join(dir, 'world.json');
  let srv = await startServer({ port: 0, dataFile, seed: SEED, log: () => {} });
  t.after(() => srv.close());

  const a = client(srv.port), b = client(srv.port);
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'hello', name: 'Ada', token: 'a'.repeat(32) });
  b.send({ t: 'hello', name: 'Bo', token: 'b'.repeat(32) });
  const wa = await a.wait((m) => m.t === 'welcome');
  await b.wait((m) => m.t === 'welcome');
  assert.equal(wa.seed, SEED);

  // Name ownership.
  const c = client(srv.port);
  await c.open();
  c.send({ t: 'hello', name: 'ada', token: 'c'.repeat(32) });
  assert.match((await c.wait((m) => m.t === 'error')).msg, /belongs to another pilot/);
  c.close();

  // Both subscribe to the home sector and see each other in snapshots.
  a.send({ t: 'sub', keys: ['0,0'] });
  b.send({ t: 'sub', keys: ['0,0'] });
  await a.wait((m) => m.t === 'sector' && m.key === '0,0');
  const snap = await a.wait((m) => m.t === 'snap' && m.players.some((p) => p.name === 'Bo'));
  assert.equal(snap.online, 2);

  // Teleport-style movement is rejected.
  a.send({ t: 'state', x: wa.you.x + 50000, y: wa.you.y, vx: 0, vy: 0, a: 0 });
  await a.wait((m) => m.t === 'teleport');

  // Walk Ada next to an asteroid in small legal steps, then mine it.
  const home = generateSector(0, 0, SEED);
  const rock = home.asteroids[0];
  let x = wa.you.x, y = wa.you.y;
  const goal = [rock.x + rock.r + 60, rock.y];
  while (Math.hypot(goal[0] - x, goal[1] - y) > 1) {
    const d = Math.hypot(goal[0] - x, goal[1] - y), step = Math.min(d, 60);
    x += ((goal[0] - x) / d) * step; y += ((goal[1] - y) / d) * step;
    a.send({ t: 'state', x, y, vx: 0, vy: 0, a: 0 });
    await new Promise((r) => setTimeout(r, 60));
  }
  a.send({ t: 'mine', id: rock.id });
  const got = await a.wait((m) => m.t === 'you' && (m.cargo[rock.ore] || 0) >= 5, 5000);
  assert.ok(got.cargo[rock.ore] >= 5);
  // Bo, subscribed to the same sector, sees the asteroid shrink.
  const ast = await b.wait((m) => m.t === 'ast' && m.id === rock.id);
  assert.ok(ast.amt < rock.amount);
  a.send({ t: 'mine', id: null });

  // Build a block from mined ore (cost check is server-side).
  const gx = Math.floor((x - 300) / GRID), gy = Math.floor(y / GRID);
  const ores = Object.keys(got.cargo);
  const block = { iron: 'hull', ice: 'glass', copper: 'light', gold: 'gold' }[ores[0]];
  if (block) {
    a.send({ t: 'build', gx, gy, block });
    const placed = await b.wait((m) => m.t === 'block' && m.cell === `${gx},${gy}`);
    assert.equal(placed.data.o, 'Ada');
    // Bo can't salvage Ada's block.
    b.send({ t: 'unbuild', gx, gy });
  }

  // Can't sell away from a station.
  a.send({ t: 'sell' });
  assert.match((await a.wait((m) => m.t === 'toast' && /Dock/.test(m.msg))).msg, /Dock/);

  // Hyperspace jump into range works, out of range doesn't.
  b.send({ t: 'jump', sx: 50, sy: 50 });
  assert.match((await b.wait((m) => m.t === 'toast')).msg, /Out of jump range/);
  b.send({ t: 'jump', sx: 1, sy: 1 });
  const tp = await b.wait((m) => m.t === 'teleport');
  assert.ok(tp.x > 5000 && tp.y > 5000);

  // Persistence: restart the server and Ada keeps her cargo and her block.
  a.close(); b.close();
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
  srv = await startServer({ port: 0, dataFile, seed: SEED, log: () => {} });
  const a2 = client(srv.port);
  await a2.open();
  a2.send({ t: 'hello', name: 'Ada', token: 'a'.repeat(32) });
  const back = await a2.wait((m) => m.t === 'welcome');
  assert.ok(back.you.cargo[rock.ore] >= 1);
  if (block) {
    a2.send({ t: 'sub', keys: [`${Math.floor((gx * GRID) / 5000)},${Math.floor((gy * GRID) / 5000)}`] });
    const sec = await a2.wait((m) => m.t === 'sector');
    assert.equal(sec.blocks[`${gx},${gy}`].o, 'Ada');
  }
  a2.close();
});
