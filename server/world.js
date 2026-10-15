// Authoritative world state. The universe itself is generated on demand from the seed; this
// class owns only the player-made deltas on top of it, the online players, and the rules.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateSector, findAsteroid, sectorOf, sectorKey, SECTOR_SIZE } from '../shared/universe.js';
import { hashString } from '../shared/rng.js';
import {
  ORES, ORE_IDS, BLOCKS, UPGRADES, GRID, BUILD_RANGE, DOCK_RANGE, JUMP_COOLDOWN_MS, ASTEROID_REGROW_MS,
  shipStats, cargoTotal, canAfford, upgradeCost,
} from '../shared/rules.js';

const TICK_MS = 100;
const SAVE_MS = 15000;
const NAME_RE = /^[A-Za-z0-9_\- ]{2,16}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export class World {
  constructor({ seed, dataFile, log = () => {} }) {
    this.seed = seed;
    this.dataFile = dataFile;
    this.log = log;
    this.conns = new Set();
    this.dirty = false;
    this.data = { seed, asteroids: {}, blocks: {}, beacons: {}, players: {} };
    this.load();
  }

  // ---- persistence ------------------------------------------------------------------------

  load() {
    if (!this.dataFile || !fs.existsSync(this.dataFile)) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (d.seed !== this.seed) { this.log(`Save file has seed ${d.seed}; starting fresh for seed ${this.seed}`); return; }
      Object.assign(this.data, d);
      this.log(`Loaded world: ${Object.keys(d.players).length} pilots, ${Object.keys(d.blocks).length} built sectors`);
    } catch (e) {
      this.log('Could not read save file:', e.message);
    }
  }

  save() {
    if (!this.dataFile || !this.dirty) return;
    for (const c of this.conns) if (c.player) this.storePlayer(c);
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tmp = this.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.dataFile);
    this.dirty = false;
  }

  start() {
    let last = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      this.tick(Math.min(0.25, (now - last) / 1000), now);
      last = now;
    }, TICK_MS);
    this.saveTimer = setInterval(() => this.save(), SAVE_MS);
  }

  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    this.dirty = true;
    this.save();
  }

  // ---- connections ------------------------------------------------------------------------

  connect(send, kick) {
    const conn = { id: crypto.randomUUID().slice(0, 8), send, kick, player: null, subs: new Set(), lastChat: 0, buildBudget: 20 };
    this.conns.add(conn);
    return conn;
  }

  disconnect(conn) {
    if (!this.conns.delete(conn)) return;
    if (conn.player) {
      this.storePlayer(conn);
      this.broadcast({ t: 'chat', from: null, text: `${conn.player.name} went dark.` });
    }
  }

  storePlayer(conn) {
    const p = conn.player;
    const rec = this.data.players[p.name.toLowerCase()];
    Object.assign(rec, { x: p.x, y: p.y, cargo: p.cargo, credits: p.credits, upg: p.upg });
    this.dirty = true;
  }

  broadcast(msg, filter) {
    for (const c of this.conns) if (c.player && (!filter || filter(c))) c.send(msg);
  }

  toSector(key, msg) {
    this.broadcast(msg, (c) => c.subs.has(key));
  }

  // ---- messages ---------------------------------------------------------------------------

  handle(conn, msg) {
    if (!conn.player) {
      if (msg.t === 'hello') this.onHello(conn, msg);
      return;
    }
    const fn = this['on_' + msg.t];
    if (fn) fn.call(this, conn, msg);
  }

  onHello(conn, { name, token }) {
    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) return conn.send({ t: 'error', msg: 'Pick a name of 2-16 letters, numbers, spaces, _ or -.' });
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return conn.send({ t: 'error', msg: 'Bad session token.' });
    name = name.trim();
    const key = name.toLowerCase();
    let rec = this.data.players[key];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (rec && rec.tokenHash !== tokenHash) return conn.send({ t: 'error', msg: 'That name belongs to another pilot.' });
    if (!rec) {
      const a = Math.random() * Math.PI * 2;
      const home = generateSector(0, 0, this.seed).station;
      rec = this.data.players[key] = {
        name, tokenHash, x: home.x + Math.cos(a) * 400, y: home.y + Math.sin(a) * 400,
        cargo: {}, credits: 0, upg: {}, joined: Date.now(),
      };
      this.dirty = true;
    }
    for (const other of this.conns) {
      if (other !== conn && other.player && other.player.name.toLowerCase() === key) {
        other.send({ t: 'error', msg: 'You signed in somewhere else.' });
        this.disconnect(other);
        other.kick();
      }
    }
    conn.player = {
      name: rec.name, x: rec.x, y: rec.y, vx: 0, vy: 0, a: 0, thrust: false,
      cargo: { ...rec.cargo }, credits: rec.credits, upg: { ...rec.upg },
      color: `hsl(${hashString(key) % 360} 80% 62%)`,
      mining: null, mineFrac: 0, lastPos: Date.now(), lastJump: 0,
    };
    conn.send({
      t: 'welcome', id: conn.id, seed: this.seed, time: Date.now(),
      you: this.selfView(conn.player), beacons: Object.values(this.data.beacons),
    });
    this.broadcast({ t: 'chat', from: null, text: `${rec.name} entered the void.` });
  }

  selfView(p) {
    return { name: p.name, x: p.x, y: p.y, cargo: p.cargo, credits: p.credits, upg: p.upg, color: p.color };
  }

  sendSelf(conn) {
    const p = conn.player;
    conn.send({ t: 'you', cargo: p.cargo, credits: p.credits, upg: p.upg });
  }

  teleport(conn, x, y) {
    const p = conn.player;
    Object.assign(p, { x, y, vx: 0, vy: 0, mining: null, lastPos: Date.now() });
    conn.send({ t: 'teleport', x, y });
  }

  // Movement is simulated by the client for responsiveness; the server checks it is plausible.
  on_state(conn, m) {
    if (![m.x, m.y, m.vx, m.vy, m.a].every(num)) return;
    const p = conn.player;
    const now = Date.now();
    const stats = shipStats(p.upg);
    const dt = Math.max(0.05, (now - p.lastPos) / 1000);
    const allowed = stats.maxSpeed * dt * 1.35 + 80;
    if (Math.hypot(m.x - p.x, m.y - p.y) > allowed) {
      this.teleport(conn, p.x, p.y);
      return;
    }
    const sp = Math.hypot(m.vx, m.vy), k = sp > stats.maxSpeed ? stats.maxSpeed / sp : 1;
    Object.assign(p, { x: m.x, y: m.y, vx: m.vx * k, vy: m.vy * k, a: m.a, thrust: !!m.thrust, lastPos: now });
  }

  on_sub(conn, { keys }) {
    if (!Array.isArray(keys)) return;
    const [psx, psy] = sectorOf(conn.player.x, conn.player.y);
    const want = new Set();
    for (const k of keys.slice(0, 16)) {
      const m = /^(-?\d+),(-?\d+)$/.exec(String(k));
      if (m && Math.abs(+m[1] - psx) <= 1 && Math.abs(+m[2] - psy) <= 1) want.add(sectorKey(+m[1], +m[2]));
    }
    for (const k of want) {
      if (!conn.subs.has(k)) conn.send(this.sectorState(k));
    }
    conn.subs = want;
  }

  sectorState(key) {
    const [sx, sy] = key.split(',').map(Number);
    const asteroids = {};
    for (const a of generateSector(sx, sy, this.seed).asteroids) {
      const amt = this.asteroidAmount(a);
      if (amt !== a.amount) asteroids[a.id] = Math.ceil(amt);
    }
    return { t: 'sector', key, asteroids, blocks: this.data.blocks[key] || {} };
  }

  asteroidAmount(a) {
    const rec = this.data.asteroids[a.id];
    if (!rec) return a.amount;
    if (Date.now() - rec.t > ASTEROID_REGROW_MS) { delete this.data.asteroids[a.id]; return a.amount; }
    return rec.amt;
  }

  on_mine(conn, { id }) {
    conn.player.mining = typeof id === 'string' ? id : null;
  }

  on_build(conn, { gx, gy, block }) {
    const p = conn.player;
    const def = BLOCKS[block];
    if (!def || !Number.isInteger(gx) || !Number.isInteger(gy)) return;
    if (conn.buildBudget <= 0) return;
    conn.buildBudget--;
    const cx = (gx + 0.5) * GRID, cy = (gy + 0.5) * GRID;
    if (Math.hypot(cx - p.x, cy - p.y) > BUILD_RANGE) return conn.send({ t: 'toast', msg: 'Too far away to build there.' });
    const [sx, sy] = sectorOf(cx, cy);
    const key = sectorKey(sx, sy), cell = `${gx},${gy}`;
    const blocks = (this.data.blocks[key] ||= {});
    if (blocks[cell]) return;
    if (this.blockedByNature(sx, sy, cx, cy)) return conn.send({ t: 'toast', msg: 'Something is in the way.' });
    if (!canAfford(p.cargo, def.cost)) return conn.send({ t: 'toast', msg: `Not enough ore for ${def.name}.` });
    for (const [k, v] of Object.entries(def.cost)) p.cargo[k] -= v;
    blocks[cell] = { b: block, o: p.name };
    if (def.beacon) {
      const beacon = { id: `${key}:${cell}`, sx, sy, x: cx, y: cy, owner: p.name, at: Date.now() };
      this.data.beacons[beacon.id] = beacon;
      this.broadcast({ t: 'beacon', beacon });
    }
    this.dirty = true;
    this.sendSelf(conn);
    this.toSector(key, { t: 'block', key, cell, data: blocks[cell] });
  }

  blockedByNature(sx, sy, x, y) {
    const s = generateSector(sx, sy, this.seed);
    if (s.star && Math.hypot(x - s.star.x, y - s.star.y) < s.star.r + 120) return true;
    if (s.station && Math.hypot(x - s.station.x, y - s.station.y) < 220) return true;
    return false;
  }

  on_unbuild(conn, { gx, gy }) {
    const p = conn.player;
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) return;
    const cx = (gx + 0.5) * GRID, cy = (gy + 0.5) * GRID;
    if (Math.hypot(cx - p.x, cy - p.y) > BUILD_RANGE) return;
    const [sx, sy] = sectorOf(cx, cy);
    const key = sectorKey(sx, sy), cell = `${gx},${gy}`;
    const blk = this.data.blocks[key]?.[cell];
    if (!blk) return;
    if (blk.o !== p.name) return conn.send({ t: 'toast', msg: `That belongs to ${blk.o}.` });
    delete this.data.blocks[key][cell];
    if (!Object.keys(this.data.blocks[key]).length) delete this.data.blocks[key];
    for (const [k, v] of Object.entries(BLOCKS[blk.b].cost)) p.cargo[k] = (p.cargo[k] || 0) + v;
    if (BLOCKS[blk.b].beacon) {
      delete this.data.beacons[`${key}:${cell}`];
      this.broadcast({ t: 'beacon', removed: `${key}:${cell}` });
    }
    this.dirty = true;
    this.sendSelf(conn);
    this.toSector(key, { t: 'block', key, cell, data: null });
  }

  dockedStation(p) {
    const [sx, sy] = sectorOf(p.x, p.y);
    const st = generateSector(sx, sy, this.seed).station;
    return st && Math.hypot(st.x - p.x, st.y - p.y) <= DOCK_RANGE ? st : null;
  }

  on_sell(conn) {
    const p = conn.player;
    if (!this.dockedStation(p)) return conn.send({ t: 'toast', msg: 'Dock at a station to trade.' });
    let earned = 0;
    for (const k of ORE_IDS) { earned += (p.cargo[k] || 0) * ORES[k].price; p.cargo[k] = 0; }
    p.credits += earned;
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: earned ? `Sold cargo for ${earned} credits.` : 'Your hold is empty.' });
  }

  on_upgrade(conn, { kind }) {
    const p = conn.player;
    const def = UPGRADES[kind];
    if (!def) return;
    if (!this.dockedStation(p)) return conn.send({ t: 'toast', msg: 'Dock at a station to upgrade.' });
    const lvl = p.upg[kind] || 0;
    if (lvl >= def.max) return conn.send({ t: 'toast', msg: `${def.name} is maxed out.` });
    const cost = upgradeCost(lvl);
    if (p.credits < cost) return conn.send({ t: 'toast', msg: `Need ${cost} credits.` });
    p.credits -= cost;
    p.upg[kind] = lvl + 1;
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: `${def.name} upgraded to level ${lvl + 1}.` });
  }

  on_jump(conn, { sx, sy }) {
    const p = conn.player;
    if (!Number.isInteger(sx) || !Number.isInteger(sy)) return;
    const now = Date.now();
    if (now - p.lastJump < JUMP_COOLDOWN_MS) return conn.send({ t: 'toast', msg: 'Jump drive is still charging.' });
    const [csx, csy] = sectorOf(p.x, p.y);
    const dist = Math.max(Math.abs(sx - csx), Math.abs(sy - csy));
    if (dist === 0) return;
    if (dist > shipStats(p.upg).jumpRange) return conn.send({ t: 'toast', msg: 'Out of jump range. Upgrade your jump drive.' });
    p.lastJump = now;
    this.teleport(conn, ...this.arrivalPoint(sx, sy));
    conn.send({ t: 'jumped', at: now });
  }

  on_wormhole(conn) {
    const p = conn.player;
    const [sx, sy] = sectorOf(p.x, p.y);
    const wh = generateSector(sx, sy, this.seed).wormhole;
    if (!wh || Math.hypot(wh.x - p.x, wh.y - p.y) > wh.r + 40) return;
    this.teleport(conn, ...this.arrivalPoint(wh.tx, wh.ty));
    conn.send({ t: 'toast', msg: `The wormhole spits you out ${Math.round(Math.hypot(wh.tx - sx, wh.ty - sy))} sectors away.` });
  }

  arrivalPoint(sx, sy) {
    const s = generateSector(sx, sy, this.seed);
    let x = (sx + 0.5) * SECTOR_SIZE, y = (sy + 0.5) * SECTOR_SIZE;
    if (s.star) { x = s.star.x + s.star.r + 700; y = s.star.y; }
    return [x, y];
  }

  on_chat(conn, { text }) {
    if (typeof text !== 'string') return;
    text = text.trim().slice(0, 200);
    const now = Date.now();
    if (!text || now - conn.lastChat < 700) return;
    conn.lastChat = now;
    this.broadcast({ t: 'chat', from: conn.player.name, color: conn.player.color, text });
  }

  // ---- simulation -------------------------------------------------------------------------

  tick(dt, now) {
    const changed = new Map();
    for (const c of this.conns) {
      if (!c.player) continue;
      c.buildBudget = Math.min(20, c.buildBudget + 1);
      const p = c.player;
      if (!p.mining) continue;
      const a = findAsteroid(p.mining, this.seed);
      const stats = shipStats(p.upg);
      if (!a || Math.hypot(a.x - p.x, a.y - p.y) > stats.mineRange + a.r) { p.mining = null; continue; }
      const left = this.asteroidAmount(a);
      const space = stats.cargo - cargoTotal(p.cargo);
      if (left <= 0 || space <= 0) {
        if (space <= 0 && now - (c.lastFullToast || 0) > 3000) {
          c.lastFullToast = now;
          c.send({ t: 'toast', msg: 'Cargo hold full. Sell at a station.' });
        }
        p.mining = null;
        continue;
      }
      const take = Math.min(stats.mineRate * dt, left);
      p.mineFrac += take;
      const whole = Math.min(Math.floor(p.mineFrac), space);
      if (whole > 0) {
        p.mineFrac -= whole;
        p.cargo[a.ore] = (p.cargo[a.ore] || 0) + whole;
        this.sendSelf(c);
      }
      this.data.asteroids[a.id] = { amt: Math.max(0, left - take), t: now };
      if (Math.ceil(left) !== Math.ceil(left - take)) changed.set(a.id, a);
      this.dirty = true;
    }
    for (const [id, a] of changed) {
      const [sx, sy] = sectorOf(a.x, a.y);
      this.toSector(sectorKey(sx, sy), { t: 'ast', id, amt: Math.ceil(this.data.asteroids[id].amt) });
    }

    // Snapshots: each pilot sees the others in the sectors they are subscribed to.
    const all = [...this.conns].filter((c) => c.player);
    for (const c of all) {
      const players = [];
      for (const o of all) {
        const p = o.player;
        const [sx, sy] = sectorOf(p.x, p.y);
        if (o === c || !c.subs.has(sectorKey(sx, sy))) continue;
        players.push({ id: o.id, name: p.name, color: p.color, x: p.x, y: p.y, vx: p.vx, vy: p.vy, a: p.a, thrust: p.thrust, mining: p.mining });
      }
      c.send({ t: 'snap', time: now, players, online: all.length, mining: c.player.mining });
    }
  }
}
