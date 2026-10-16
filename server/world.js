// Authoritative world state. The universe is generated on demand from the seed; this owns the
// player-made changes on top of it, the online pilots, and the rules. Bigger systems live in
// their own modules: accounts, parties, combat, planet surfaces and the story director.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  generateSector, findAsteroid, findPlanet, sectorOf, sectorKey, effectiveOre, SECTOR_SIZE, FAR_REACH, STARTER_PLANET_ID,
} from '../shared/universe.js';
import { hashString } from '../shared/rng.js';
import {
  ORES, ORE_IDS, BLOCKS, UPGRADES, SHIP_PARTS, STARTER_SHIP, WORLD_GRID, BUILD_RANGE, DOCK_RANGE, JUMP_COOLDOWN_MS,
  ASTEROID_REGROW_MS, INVENTORY_SIZE, shipStats, validateShip, cargoTotal, canAfford, upgradeCost, qNormalize, blockAllowed,
} from '../shared/rules.js';
import { makeItem, makeRelic, itemName, itemValue, shopStock, buffsOf, RELIC_SLOTS } from '../shared/items.js';
import { FACTIONS, HOLY_CAPITAL, HOSTILE_REP, factionTitle } from '../shared/content/factions.js';
import { RELICS } from '../shared/content/relics.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { TUTORIAL } from '../shared/tutorial.js';
import { goalTarget } from '../shared/story.js';
import { Accounts } from './accounts.js';
import { Parties } from './party.js';
import { Combat } from './combat.js';
import { Surfaces } from './surface.js';
import { StoryDirector } from './story.js';
import { Dungeons } from './dungeon.js';
import { Politics } from './politics.js';
import { Talk } from './talk.js';
import { Quests } from './quests.js';
import { AI } from './ai.js';
import { Powers } from './powers.js';
import { Bases } from './bases.js';
import { Director } from './director.js';
import { skillBonus, SPELLS, POWERS } from '../shared/powers.js';
import { townsOf } from '../shared/towns.js';

const TICK_MS = 100;
const SAVE_MS = 15000;
const SAVE_VERSION = 2;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export class World {
  constructor({ seed, dataFile, log = () => {} }) {
    this.seed = seed;
    this.dataFile = dataFile;
    this.log = log;
    this.connSet = new Set();
    this.dirty = false;
    this.data = { version: SAVE_VERSION, seed, asteroids: {}, blocks: {}, beacons: {}, players: {}, surfaces: {}, accounts: {}, sessions: {} };
    this.load();
    this.accounts = new Accounts(this.data);
    this.parties = new Parties(this);
    this.story = new StoryDirector(this);
    this.combat = new Combat(this);
    this.politics = new Politics(this);
    this.surfaces = new Surfaces(this);
    this.talk = new Talk(this);
    this.quests = new Quests(this);
    this.powers = new Powers(this);
    this.bases = new Bases(this);
    this.director = new Director(this);
    this.skills = this.powers;
    this.ai = new AI(log);
    if (this.ai.enabled) log('AI townsfolk enabled');
    this.dungeons = new Dungeons(this);
  }

  // ---- persistence ------------------------------------------------------------------------

  load() {
    if (!this.dataFile || !fs.existsSync(this.dataFile)) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (d.seed !== this.seed) { this.log(`Save file has seed ${d.seed}; starting fresh for seed ${this.seed}`); return; }
      if (d.version !== SAVE_VERSION) { this.log(`Save file is from an older version; starting a fresh world`); return; }
      Object.assign(this.data, d);
      this.log(`Loaded world: ${Object.keys(d.accounts || {}).length} accounts`);
    } catch (e) {
      this.log('Could not read save file:', e.message);
    }
  }

  save() {
    if (!this.dataFile || !this.dirty) return;
    for (const c of this.connSet) if (c.player) this.storePlayer(c.player);
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
      try { this.tick(Math.min(0.25, (now - last) / 1000), now); } catch (e) { this.log('tick error', e); }
      this.director.tickTime(Date.now() - now);
      last = now;
    }, TICK_MS);
    this.saveTimer = setInterval(() => this.save(), SAVE_MS);
    this.partyTimer = setInterval(() => this.parties.tick(), 1000);
  }

  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    clearInterval(this.partyTimer);
    this.dirty = true;
    this.save();
  }

  time() { return Date.now() / 1000; }

  // ---- connections ------------------------------------------------------------------------

  connect(send, kick) {
    const conn = { id: crypto.randomUUID().slice(0, 8), send, kick, player: null, subs: new Set(), lastChat: 0, buildBudget: 20, seenShips: new Map(), authBusy: false, authFails: 0 };
    this.connSet.add(conn);
    return conn;
  }

  disconnect(conn) {
    if (!this.connSet.delete(conn)) return;
    if (conn.player) {
      this.dungeons.dropped(conn);
      this.storePlayer(conn.player);
      this.parties.dropped(conn.player.key);
      this.broadcast({ t: 'chat', from: null, text: `${conn.player.name} went dark.` });
    }
  }

  conns() { return [...this.connSet].filter((c) => c.player); }
  players() { return this.conns().map((c) => c.player); }
  connById(id) { for (const c of this.connSet) if (c.id === id && c.player) return c; return null; }
  connByName(name) {
    const k = String(name).toLowerCase();
    for (const c of this.connSet) if (c.player && c.player.key === k) return c;
    return null;
  }

  broadcast(msg, filter) {
    for (const c of this.connSet) if (c.player && (!filter || filter(c))) c.send(msg);
  }

  toSector(key, msg) {
    this.broadcast(msg, (c) => c.player.mode === 'space' && c.subs.has(key));
  }

  toNear(x, z, msg) {
    this.toSector(sectorKey(...sectorOf(x, z)), msg);
  }

  // ---- auth -------------------------------------------------------------------------------

  async auth(conn, msg) {
    if (conn.authBusy) return;
    if (conn.authFails > 8) return conn.send({ t: 'error', auth: true, msg: 'Too many attempts. Reload and try again later.' });
    conn.authBusy = true;
    try {
      let session;
      if (msg.t === 'register') session = await this.accounts.register(msg.name, msg.password);
      else if (msg.t === 'login') session = await this.accounts.login(msg.name, msg.password);
      else {
        session = this.accounts.resume(msg.token);
        if (!session) throw new Error('Your session expired. Please sign in again.');
      }
      if (!this.connSet.has(conn)) return;
      this.dirty = true;
      conn.send({ t: 'auth', token: session.token, name: session.name });
      this.join(conn, session.key, session.name);
    } catch (e) {
      conn.authFails++;
      conn.send({ t: 'error', auth: true, resume: msg.t === 'resume', msg: e.message });
    } finally {
      conn.authBusy = false;
    }
  }

  newRecord(name) {
    const pistol = makeItem('weapon', 'pistol', 1);
    return {
      name, credits: 100, cargo: {}, ship: STARTER_SHIP.map((b) => [...b]), upg: {},
      inv: { items: [pistol], equipped: { weapon: pistol.id } },
      mode: 'surface', planet: STARTER_PLANET_ID, parked: null, tutorial: 0, tutCount: 0, home: '0,0:st', joined: Date.now(),
      rep: { empire: 0, rebellion: 0 }, favor: {}, blessing: null, looted: {}, codex: {},
      standing: {}, coins: {}, goods: {}, quests: [], questsDone: 0,
      skills: {}, spells: [], power: null, curse: null,
    };
  }

  join(conn, key, name) {
    for (const other of this.connSet) {
      if (other !== conn && other.player?.key === key) {
        other.send({ t: 'error', msg: 'You signed in somewhere else.' });
        this.disconnect(other);
        other.kick();
      }
    }
    const rec = (this.data.players[key] ||= this.newRecord(name));
    const p = conn.player = {
      key, name: rec.name, color: `hsl(${hashString(key) % 360}, 80%, 62%)`,
      credits: rec.credits, cargo: { ...rec.cargo }, ship: rec.ship.map((b) => [...b]), shipRev: 1, upg: { ...rec.upg },
      inv: { items: rec.inv.items.map((i) => ({ ...i })), equipped: { ...rec.inv.equipped } },
      tutorial: rec.tutorial || 0, tutCount: rec.tutCount || 0, home: rec.home || '0,0:st', kills: rec.kills || 0,
      rep: { empire: 0, rebellion: 0, ...rec.rep }, favor: { ...rec.favor }, blessing: rec.blessing || null,
      looted: { ...rec.looted }, codex: { ...rec.codex }, lastPray: rec.lastPray || 0,
      standing: { ...rec.standing }, coins: { ...rec.coins }, goods: { ...rec.goods },
      quests: (rec.quests || []).map((q) => JSON.parse(JSON.stringify(q))), questsDone: rec.questsDone || 0, charm: { ...rec.charm },
      bed: rec.bed || null, skills: { ...rec.skills }, spells: [...(rec.spells || [])], power: rec.power || null, curse: rec.curse || null, energy: rec.energy ?? 100, mana: rec.mana,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, q: [0, 0, 0, 1], px: 0, py: 0, pz: 0, yaw: 0,
      mining: null, mineFrac: 0, lastPos: Date.now(), lastJump: 0, lastFire: 0, lastWarp: 0,
    };
    this.restat(p);
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    this.surfaces.refreshVitals(p);
    if (rec.mode === 'space') {
      Object.assign(p, { mode: 'space', x: rec.x, y: rec.y, z: rec.z, q: rec.q || [0, 0, 0, 1] });
    } else {
      const pid = rec.parked?.planet || rec.planet || STARTER_PLANET_ID;
      this.surfaces.place(conn, pid, rec.parked ? [rec.parked.x, rec.parked.z] : null);
    }
    conn.send({
      t: 'welcome', id: conn.id, seed: this.seed, time: Date.now(),
      you: this.selfView(p), beacons: Object.values(this.data.beacons), story: this.story.view(),
    });
    if (p.mode === 'surface') conn.send(this.surfaces.state(p.planet, p));
    this.quests.sync(conn);
    const party = this.parties.of(key);
    if (party) this.parties.push(party);
    this.broadcast({ t: 'chat', from: null, text: `${p.name} entered the void.` });
  }

  storePlayer(p) {
    const rec = this.data.players[p.key];
    Object.assign(rec, {
      credits: p.credits, cargo: p.cargo, ship: p.ship, upg: p.upg, inv: p.inv, tutorial: p.tutorial, tutCount: p.tutCount,
      home: p.home, kills: p.kills, mode: p.dead && p.mode === 'space' ? 'space' : p.mode,
      rep: p.rep, favor: p.favor, blessing: p.blessing, looted: p.looted, codex: p.codex, lastPray: p.lastPray,
      standing: p.standing, coins: p.coins, goods: p.goods, quests: p.quests, questsDone: p.questsDone, charm: p.charm,
      bed: p.bed, skills: p.skills, spells: p.spells, power: p.power, curse: p.curse, energy: p.energy, mana: p.mana,
      x: p.x, y: p.y, z: p.z, q: p.q, planet: p.planet, parked: p.parked,
    });
    this.dirty = true;
  }

  // Recompute everything derived from gear, relics, blessings and the story.
  restat(p) {
    p.buffs = buffsOf(p.inv, p.blessing);
    p.stats = shipStats(p.ship, p.upg, this.story ? this.story.effects() : {}, p.buffs);
    p.stats.maxSpeed *= 1 + skillBonus(p.skills, 'piloting');
    if (this.surfaces && p.inv) this.surfaces.refreshVitals(p);
    if (p.hull > p.stats.hp) p.hull = p.stats.hp;
    if (p.shield > p.stats.shield) p.shield = p.stats.shield;
  }

  // ---- factions, gods and the codex ----------------------------------------------------------

  changeRep(conn, delta, why) {
    const p = conn.player;
    const before = {};
    for (const [f, d] of Object.entries(delta)) {
      before[f] = factionTitle(f, p.rep[f]);
      p.rep[f] = Math.max(-100, Math.min(100, p.rep[f] + d));
    }
    for (const f of Object.keys(delta)) {
      const now = factionTitle(f, p.rep[f]);
      if (now !== before[f]) conn.send({ t: 'toast', msg: `${FACTIONS[f].name}: you are now "${now}".` });
    }
    if (why) conn.send({ t: 'chat', from: null, text: why });
    this.dirty = true;
    this.sendSelf(conn);
  }

  hostileTo(faction, p) {
    return !!faction && p.rep[faction] < HOSTILE_REP;
  }

  // Mark codex entries ("terrain:duneSea", "creature:sandWyrm"…) as discovered.
  discover(conn, keys) {
    const p = conn.player, fresh = keys.filter((k) => !p.codex[k]);
    if (!fresh.length) return;
    for (const k of fresh) p.codex[k] = Date.now();
    conn.send({ t: 'codex', keys: fresh });
    this.dirty = true;
  }

  warScore(side, n = 1) {
    this.data.war ||= { empire: 0, rebellion: 0 };
    this.data.war[side] += n;
    this.dirty = true;
  }

  bless(conn, blessing, minutes) {
    const p = conn.player;
    p.blessing = { ...blessing, until: Date.now() + minutes * 60000 };
    this.restat(p);
    this.sendSelf(conn);
  }

  selfView(p) {
    return {
      name: p.name, key: p.key, color: p.color, credits: p.credits, cargo: p.cargo, ship: p.ship, shipRev: p.shipRev, upg: p.upg,
      inv: p.inv, stats: p.stats, hull: p.hull, shield: p.shield, hp: p.hp, maxHp: p.maxHp, armor: p.armor,
      mode: p.mode, planet: p.planet, parked: p.parked, x: p.x, y: p.y, z: p.z, q: p.q, px: p.px, py: p.py, pz: p.pz,
      tutorial: p.tutorial, tutCount: p.tutCount, home: p.home, kills: p.kills,
      rep: p.rep, favor: p.favor, blessing: p.blessing, buffs: p.buffs, codex: Object.keys(p.codex), war: this.data.war || { empire: 0, rebellion: 0 },
      standing: p.standing, coins: p.coins, goods: p.goods,
      ...this.powers.view(p),
    };
  }

  sendSelf(conn) {
    conn.send({ t: 'you', ...this.selfView(conn.player) });
  }

  // ---- messages ---------------------------------------------------------------------------

  handle(conn, msg) {
    if (!conn.player) {
      if (msg.t === 'register' || msg.t === 'login' || msg.t === 'resume') this.auth(conn, msg);
      return;
    }
    const fn = this['on_' + msg.t];
    if (fn) fn.call(this, conn, msg);
  }

  on_logout(conn, { token }) {
    if (typeof token === 'string') this.accounts.logout(token);
    this.dirty = true;
  }

  // Space movement is simulated by the client for responsiveness; the server checks it.
  on_state(conn, m) {
    const p = conn.player;
    if (p.mode !== 'space' || p.dead || ![m.x, m.y, m.z, m.vx, m.vy, m.vz].every(num) || !Array.isArray(m.q) || !m.q.every(num)) return;
    const now = Date.now();
    const dt = Math.max(0.05, (now - p.lastPos) / 1000);
    const allowed = p.stats.maxSpeed * dt * 1.35 + 80;
    if (Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) > allowed) {
      conn.send({ t: 'teleport', mode: 'space', x: p.x, y: p.y, z: p.z });
      p.lastPos = now;
      return;
    }
    const sp = Math.hypot(m.vx, m.vy, m.vz), k = sp > p.stats.maxSpeed ? p.stats.maxSpeed / sp : 1;
    Object.assign(p, { x: m.x, y: m.y, z: m.z, vx: m.vx * k, vy: m.vy * k, vz: m.vz * k, q: qNormalize(m.q), thrust: !!m.thrust, lastPos: now });
  }

  on_walk(conn, m) { conn.player.mode === 'dungeon' ? this.dungeons.walk(conn, m) : this.surfaces.walk(conn, m); }
  on_shoot(conn, m) { conn.player.mode === 'dungeon' ? this.dungeons.shoot(conn, m) : this.surfaces.shoot(conn, m); }
  on_dig(conn, m) { this.surfaces.dig(conn, m); }
  on_sbuild(conn, m) { this.surfaces.build(conn, m); }
  on_sunbuild(conn, m) { this.surfaces.unbuild(conn, m); }
  on_interact(conn, m) { conn.player.mode === 'dungeon' ? this.dungeons.interact(conn, m) : this.surfaces.interact(conn, m); }
  on_land(conn, { planet }) { if (typeof planet === 'string') this.surfaces.land(conn, planet); }
  on_fire(conn) { this.combat.fire(conn); }
  on_talk_opt(conn, m) { if (typeof m.id === 'string') this.talk.choose(conn, m); }
  on_talk_say(conn, m) { if (typeof m.id === 'string') this.talk.say(conn, m).catch((e) => this.log('talk error', e)); }
  on_quest_abandon(conn, m) { if (typeof m.id === 'string') this.quests.abandon(conn, m); }
  on_cast(conn, m) { if (typeof m.spell === 'string') this.powers.cast(conn, m); }
  on_power(conn) { this.powers.usePower(conn); }
  on_transform(conn) { this.powers.transform(conn); }
  on_claw(conn) { this.powers.claw(conn); }
  on_mech(conn) { this.powers.toggleMech(conn); }
  on_chest(conn, m) { this.bases.chest(conn, m); }
  on_craft(conn, m) { if (typeof m.recipe === 'string') this.bases.craft(conn, m); }
  on_market_buy(conn, m) { if (typeof m.good === 'string') this.talk.buy(conn, m); }
  on_market_sell(conn, m) { if (typeof m.good === 'string') this.talk.sell(conn, m); }
  on_exchange(conn, m) { if (m.dir === 'buy' || m.dir === 'sell') this.talk.exchange(conn, m); }
  on_politics(conn) {
    const p = conn.player;
    if (p.mode !== 'surface') return conn.send({ t: 'toast', msg: 'Land on a world to see its realms.' });
    conn.send({ t: 'politics', view: this.politics.view(p.planet, p) });
  }

  on_sub(conn, { keys }) {
    if (!Array.isArray(keys) || conn.player.mode !== 'space') return;
    const [psx, psz] = sectorOf(conn.player.x, conn.player.z);
    const want = new Set();
    for (const k of keys.slice(0, 16)) {
      const m = /^(-?\d+),(-?\d+)$/.exec(String(k));
      if (m && Math.abs(+m[1] - psx) <= 1 && Math.abs(+m[2] - psz) <= 1) want.add(sectorKey(+m[1], +m[2]));
    }
    for (const k of want) if (!conn.subs.has(k)) conn.send(this.sectorState(k));
    conn.subs = want;
  }

  sectorState(key) {
    const [sx, sz] = key.split(',').map(Number);
    const asteroids = {};
    for (const a of generateSector(sx, sz, this.seed).asteroids) {
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
    conn.player.mining = typeof id === 'string' && conn.player.mode === 'space' ? id : null;
  }

  on_build(conn, { gx, gy, gz, block }) {
    const p = conn.player;
    const def = BLOCKS[block];
    if (p.mode !== 'space' || !def || !blockAllowed(block, 'space') || ![gx, gy, gz].every(Number.isInteger)) return;
    if (conn.buildBudget <= 0) return;
    conn.buildBudget--;
    const cx = (gx + 0.5) * WORLD_GRID, cy = (gy + 0.5) * WORLD_GRID, cz = (gz + 0.5) * WORLD_GRID;
    if (Math.hypot(cx - p.x, cy - p.y, cz - p.z) > BUILD_RANGE) return conn.send({ t: 'toast', msg: 'Too far away to build there.' });
    const [sx, sz] = sectorOf(cx, cz);
    const key = sectorKey(sx, sz), cell = `${gx},${gy},${gz}`;
    const blocks = (this.data.blocks[key] ||= {});
    if (blocks[cell]) return;
    const s = generateSector(sx, sz, this.seed);
    if ((s.star && Math.hypot(cx - s.star.x, cy - s.star.y, cz - s.star.z) < s.star.r + 150) ||
        (s.station && Math.hypot(cx - s.station.x, cy - s.station.y, cz - s.station.z) < 260)) {
      return conn.send({ t: 'toast', msg: 'Something is in the way.' });
    }
    if (!canAfford(p.cargo, def.cost)) return conn.send({ t: 'toast', msg: `Not enough ore for ${def.name}.` });
    for (const [k, v] of Object.entries(def.cost)) p.cargo[k] -= v;
    blocks[cell] = { b: block, o: p.name };
    if (def.beacon) {
      const beacon = { id: `${key}:${cell}`, sx, sz, x: cx, y: cy, z: cz, owner: p.name, at: Date.now() };
      this.data.beacons[beacon.id] = beacon;
      this.broadcast({ t: 'beacon', beacon });
    }
    this.dirty = true;
    this.sendSelf(conn);
    this.toSector(key, { t: 'block', key, cell, data: blocks[cell] });
  }

  on_unbuild(conn, { gx, gy, gz }) {
    const p = conn.player;
    if (p.mode !== 'space' || ![gx, gy, gz].every(Number.isInteger)) return;
    const cx = (gx + 0.5) * WORLD_GRID, cy = (gy + 0.5) * WORLD_GRID, cz = (gz + 0.5) * WORLD_GRID;
    if (Math.hypot(cx - p.x, cy - p.y, cz - p.z) > BUILD_RANGE) return;
    const [sx, sz] = sectorOf(cx, cz);
    const key = sectorKey(sx, sz), cell = `${gx},${gy},${gz}`;
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

  // ---- stations -----------------------------------------------------------------------------

  // The station you're docked at; faction stations turn away pilots they consider enemies.
  dockedStation(p, allowHostile = false) {
    if (p.mode !== 'space' || p.dead) return null;
    const [sx, sz] = sectorOf(p.x, p.z);
    const st = generateSector(sx, sz, this.seed).station;
    if (!st || Math.hypot(st.x - p.x, st.y - p.y, st.z - p.z) > DOCK_RANGE) {
      // Player-built stations: any docking port.
      const dock = this.bases?.nearbyDock(p);
      return dock ? { id: dock.id, name: `${dock.owner}'s station`, richness: 1, faction: null, player: true, owner: dock.owner, x: dock.x, y: dock.y, z: dock.z } : null;
    }
    if (!allowHostile && this.hostileTo(st.faction, p)) return null;
    return st;
  }

  needDock(conn) {
    const st = this.dockedStation(conn.player);
    if (!st) {
      const near = this.dockedStation(conn.player, true);
      conn.send({ t: 'toast', msg: near ? `Docking denied: ${FACTIONS[near.faction].name} considers you an enemy.` : 'Dock at a station first.' });
    }
    return st;
  }

  // Faction stations sell better gear to pilots they trust.
  shopRichness(st, p) {
    return st.richness + (st.faction && p.rep[st.faction] >= 30 ? 2 : 0) + (st.capital ? 2 : 0);
  }

  on_benediction(conn) {
    const p = conn.player, st = this.needDock(conn);
    const b = HOLY_CAPITAL.blessing;
    if (!st || !st.capital) return;
    if (p.rep.empire < b.minRep) return conn.send({ t: 'toast', msg: `The priests will only bless a Citizen of the Empire (reputation ${b.minRep}+).` });
    if (p.credits < b.tithe) return conn.send({ t: 'toast', msg: `The tithe is ${b.tithe} credits.` });
    p.credits -= b.tithe;
    this.bless(conn, { god: 'throne', name: b.name, bonus: b.bonus }, b.minutes);
    this.changeRep(conn, { empire: 2 }, `You kneel before the Radiant Throne and receive the ${b.name}.`);
  }

  on_dock(conn) {
    const p = conn.player;
    const st = this.needDock(conn);
    if (!st) return;
    p.home = st.id;
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    const eff = this.story.effects();
    const gate = eff.gateBuilt && (st.id === '0,0:st' || st.id === `${FAR_REACH[0]},${FAR_REACH[1]}:st`);
    this.sendSelf(conn);
    conn.send({ t: 'docked', station: { id: st.id, name: st.name, richness: st.richness, faction: st.faction, capital: st.capital }, gate, wants: ORE_IDS.filter((o) => this.story.wants(o) > 0) });
    if (st.capital) this.discover(conn, ['place:capital']);
    this.tutorial(conn, 'dock');
  }

  on_sell(conn) {
    const p = conn.player;
    if (!this.needDock(conn)) return;
    let earned = 0;
    // Building materials stay aboard; player stations pay 80%.
    const rate = this.dockedStation(p)?.player ? 0.8 : 1;
    for (const k of ORE_IDS) { if (ORES[k].keep) continue; earned += Math.floor((p.cargo[k] || 0) * ORES[k].price * rate); delete p.cargo[k]; }
    p.credits += earned;
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: earned ? `Sold cargo for ${earned} credits.` : 'Your hold is empty.' });
  }

  on_contribute(conn) {
    if (!this.needDock(conn)) return;
    this.story.contribute(conn);
    this.dirty = true;
  }

  on_upgrade(conn, { kind }) {
    const p = conn.player;
    const def = UPGRADES[kind];
    if (!def || !this.needDock(conn)) return;
    const lvl = p.upg[kind] || 0;
    if (lvl >= def.max) return conn.send({ t: 'toast', msg: `${def.name} is maxed out.` });
    const cost = upgradeCost(lvl);
    if (p.credits < cost) return conn.send({ t: 'toast', msg: `Need ${cost} credits.` });
    p.credits -= cost;
    p.upg[kind] = lvl + 1;
    this.restat(p);
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: `${def.name} upgraded to level ${lvl + 1}.` });
  }

  // Ship editing: at a station's shipyard, or on the ground next to your parked ship.
  on_ship_save(conn, { blocks }) {
    const p = conn.player;
    const atYard = this.dockedStation(p) || (p.mode === 'surface' && p.parked && Math.hypot(p.px - p.parked.x, p.pz - p.parked.z) < 25);
    if (!atYard) return conn.send({ t: 'toast', msg: 'Edit your ship at a station or standing next to it.' });
    const err = validateShip(blocks);
    if (err) return conn.send({ t: 'toast', msg: err });
    const count = (list) => list.reduce((m, b) => { m[b[3]] = (m[b[3]] || 0) + 1; return m; }, {});
    const before = count(p.ship), after = count(blocks);
    const need = {};
    for (const t of Object.keys(SHIP_PARTS)) {
      const d = (after[t] || 0) - (before[t] || 0);
      for (const [ore, v] of Object.entries(SHIP_PARTS[t].cost)) need[ore] = (need[ore] || 0) + d * v;
    }
    const cargo = { ...p.cargo };
    for (const [ore, v] of Object.entries(need)) cargo[ore] = (cargo[ore] || 0) - v;
    const short = Object.entries(cargo).filter(([, v]) => v < 0).map(([k, v]) => `${-v} ${ORES[k].name}`);
    if (short.length) return conn.send({ t: 'toast', msg: `Need ${short.join(', ')} more.` });
    for (const k of Object.keys(cargo)) if (cargo[k] === 0) delete cargo[k];
    p.cargo = cargo;
    p.ship = blocks.map((b) => [b[0], b[1], b[2], b[3]]);
    p.shipRev++;
    this.restat(p);
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: 'Ship rebuilt.' });
  }

  openShop(conn, id, richness, name, surface = null) {
    const day = Math.floor(Date.now() / 86400000);
    conn.shop = { id, richness, day, surface };
    conn.send({ t: 'shop', id, name, stock: shopStock(id, richness, day) });
  }

  on_shop(conn) {
    const st = this.needDock(conn);
    if (st) this.openShop(conn, st.id, this.shopRichness(st, conn.player), st.name);
  }

  shopValid(conn) {
    const p = conn.player;
    if (!conn.shop) return false;
    if (conn.shop.id === 'haven-landing') return p.mode === 'surface' && p.planet === STARTER_PLANET_ID;
    const sf = conn.shop.surface;
    if (sf) return p.mode === 'surface' && p.planet === sf.planet && Math.hypot(p.px - sf.x, p.pz - sf.z) < (sf.radius || 40);
    return this.dockedStation(p)?.id === conn.shop.id;
  }

  on_buy(conn, { slot }) {
    const p = conn.player;
    if (!this.shopValid(conn)) return;
    const item = shopStock(conn.shop.id, conn.shop.richness, conn.shop.day)[slot];
    if (!item) return;
    if (p.credits < item.price) return conn.send({ t: 'toast', msg: `Need ${item.price} credits.` });
    if (p.inv.items.length >= INVENTORY_SIZE) return conn.send({ t: 'toast', msg: 'Your inventory is full.' });
    p.credits -= item.price;
    const it = makeItem(item.kind, item.type, item.tier);
    p.inv.items.push(it);
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: `Bought ${itemName(it)}.` });
  }

  on_sell_item(conn, { id }) {
    const p = conn.player;
    if (!this.shopValid(conn)) return conn.send({ t: 'toast', msg: 'Sell gear at a shop.' });
    const i = p.inv.items.findIndex((it) => it.id === id);
    if (i < 0) return;
    const [it] = p.inv.items.splice(i, 1);
    for (const [slot, eid] of Object.entries(p.inv.equipped)) if (eid === id) delete p.inv.equipped[slot];
    const value = Math.round(itemValue(it) * 0.5);
    p.credits += value;
    this.surfaces.refreshVitals(p);
    this.dirty = true;
    this.sendSelf(conn);
    conn.send({ t: 'toast', msg: `Sold ${itemName(it)} for ${value} cr.` });
  }

  on_equip(conn, { id }) {
    const p = conn.player;
    const it = p.inv.items.find((i) => i.id === id);
    if (!it) return;
    if (it.kind === 'relic') {
      if (RELIC_SLOTS.some((s) => p.inv.equipped[s] === it.id)) return;
      const slot = RELIC_SLOTS.find((s) => !p.inv.equipped[s]) || RELIC_SLOTS[0];
      p.inv.equipped[slot] = it.id;
    } else p.inv.equipped[it.kind === 'weapon' ? 'weapon' : it.type] = it.id;
    this.restat(p);
    this.sendSelf(conn);
  }

  on_unequip(conn, { slot }) {
    const p = conn.player;
    if (typeof slot !== 'string') return;
    delete p.inv.equipped[slot];
    this.restat(p);
    this.sendSelf(conn);
  }

  on_drop(conn, { id }) {
    const p = conn.player;
    const i = p.inv.items.findIndex((it) => it.id === id);
    if (i < 0) return;
    p.inv.items.splice(i, 1);
    for (const [slot, eid] of Object.entries(p.inv.equipped)) if (eid === id) delete p.inv.equipped[slot];
    this.restat(p);
    this.sendSelf(conn);
  }

  giveItem(conn, item) {
    const p = conn.player;
    if (p.inv.items.length >= INVENTORY_SIZE) {
      const v = Math.round(itemValue(item) * 0.5);
      p.credits += v;
      conn.send({ t: 'toast', msg: `Inventory full: salvaged ${itemName(item)} for ${v} cr.` });
    } else {
      p.inv.items.push(item);
      conn.send({ t: 'loot', item, name: itemName(item) });
      if (item.kind === 'relic') this.discover(conn, [`relic:${item.type}`]);
    }
    this.dirty = true;
    this.sendSelf(conn);
  }

  // ---- travel -------------------------------------------------------------------------------

  arrivalPoint(sx, sz) {
    const s = generateSector(sx, sz, this.seed);
    if (s.station) return [s.station.x + 300, s.station.y + 60, s.station.z];
    if (s.star) return [s.star.x + s.star.r + 800, 0, s.star.z];
    return [(sx + 0.5) * SECTOR_SIZE, s.oy, (sz + 0.5) * SECTOR_SIZE];
  }

  teleport(conn, x, y, z) {
    const p = conn.player;
    Object.assign(p, { x, y, z, vx: 0, vy: 0, vz: 0, mining: null, lastPos: Date.now() });
    conn.send({ t: 'teleport', mode: 'space', x, y, z });
  }

  on_jump(conn, { sx, sz }) {
    const p = conn.player;
    if (p.mode !== 'space' || p.dead || !Number.isInteger(sx) || !Number.isInteger(sz)) return;
    const now = Date.now();
    if (now - p.lastJump < JUMP_COOLDOWN_MS) return conn.send({ t: 'toast', msg: 'Jump drive is still charging.' });
    const [csx, csz] = sectorOf(p.x, p.z);
    const dist = Math.max(Math.abs(sx - csx), Math.abs(sz - csz));
    if (dist === 0) return;
    if (dist > p.stats.jumpRange) return conn.send({ t: 'toast', msg: 'Out of jump range. Upgrade your jump drive.' });
    p.lastJump = now;
    this.teleport(conn, ...this.arrivalPoint(sx, sz));
    conn.send({ t: 'jumped', at: now });
  }

  // Party warp: jump straight to a party member anywhere in space.
  on_warp(conn, { name }) {
    const p = conn.player;
    const t = this.connByName(name);
    if (p.mode !== 'space' || p.dead || !t || !this.parties.sameParty(p.key, t.player.key)) return;
    if (t.player.mode !== 'space') return conn.send({ t: 'toast', msg: `${t.player.name} is on a planet.` });
    const now = Date.now();
    if (now - p.lastWarp < 60000) return conn.send({ t: 'toast', msg: `Party warp recharging (${Math.ceil((60000 - (now - p.lastWarp)) / 1000)}s).` });
    p.lastWarp = now;
    p.lastJump = now;
    this.teleport(conn, t.player.x + 200, t.player.y + 40, t.player.z + 200);
    conn.send({ t: 'jumped', at: now });
  }

  on_wormhole(conn) {
    const p = conn.player;
    if (p.mode !== 'space') return;
    const [sx, sz] = sectorOf(p.x, p.z);
    const wh = generateSector(sx, sz, this.seed).wormhole;
    if (!wh || Math.hypot(wh.x - p.x, wh.y - p.y, wh.z - p.z) > wh.r + 60) return;
    this.teleport(conn, ...this.arrivalPoint(wh.tx, wh.tz));
    conn.send({ t: 'toast', msg: `The wormhole spits you out ${Math.round(Math.hypot(wh.tx - sx, wh.tz - sz))} sectors away.` });
  }

  on_gate(conn) {
    const st = this.needDock(conn);
    if (!st || !this.story.effects().gateBuilt) return;
    if (st.id === '0,0:st') {
      this.teleport(conn, ...this.arrivalPoint(...FAR_REACH));
      conn.send({ t: 'toast', msg: 'The Ancient Gate carries you to the Far Reach.' });
    } else if (st.id === `${FAR_REACH[0]},${FAR_REACH[1]}:st`) {
      this.teleport(conn, ...this.arrivalPoint(0, 0));
      conn.send({ t: 'toast', msg: 'The Gate carries you home to Haven.' });
    }
  }

  respawnInSpace(conn) {
    const p = conn.player;
    const m = /^(-?\d+),(-?\d+):st$/.exec(p.home || '');
    const st = m ? generateSector(+m[1], +m[2], this.seed).station : null;
    const s = st || generateSector(0, 0, this.seed).station;
    p.mode = 'space';
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    p.q = [0, 0, 0, 1];
    this.teleport(conn, s.x + 260, s.y + 40, s.z);
    this.sendSelf(conn);
  }

  // ---- social -------------------------------------------------------------------------------

  on_chat(conn, { text, channel }) {
    if (typeof text !== 'string') return;
    text = text.trim().slice(0, 200);
    const now = Date.now();
    if (!text || now - conn.lastChat < 700) return;
    conn.lastChat = now;
    if (text.startsWith('/') && this.isAdmin(conn.player)) return this.adminCommand(conn, text);
    if (channel === 'party') return this.parties.chat(conn, text);
    this.broadcast({ t: 'chat', from: conn.player.name, color: conn.player.color, text });
  }

  // Admins are listed by name in the ADMIN environment variable (comma-separated).
  isAdmin(p) {
    const list = (process.env.ADMIN || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    return list.includes(p.key);
  }

  adminCommand(conn, text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const p = conn.player;
    const reply = (msg) => conn.send({ t: 'chat', from: null, text: msg });
    switch (cmd) {
      case 'spawn': {
        const kind = args[0] || 'pirate';
        if (p.mode !== 'space' || !['pirate', 'hollow', 'imperial', 'rebel'].includes(kind)) return reply('Usage (in space): /spawn pirate|hollow|imperial|rebel [count]');
        for (let i = 0; i < Math.min(10, Number(args[1]) || 1); i++) this.combat.spawnNpc(kind, p.x + (Math.random() - 0.5) * 600, p.y, p.z - 700 + (Math.random() - 0.5) * 300, 1.5);
        return reply(`Spawned ${kind}.`);
      }
      case 'tp': {
        const sx = parseInt(args[0], 10), sz = parseInt(args[1], 10);
        if (p.mode !== 'space' || !Number.isInteger(sx) || !Number.isInteger(sz)) return reply('Usage (in space): /tp <sectorX> <sectorZ>');
        return this.teleport(conn, ...this.arrivalPoint(sx, sz));
      }
      case 'give': {
        const ore = args[0], n = Math.min(100000, Number(args[1]) || 100);
        if (!ORES[ore]) return reply(`Usage: /give <${ORE_IDS.join('|')}> [amount]`);
        p.cargo[ore] = (p.cargo[ore] || 0) + n;
        this.sendSelf(conn);
        return reply(`Gave ${n} ${ore}.`);
      }
      case 'credits':
        p.credits += Math.min(1e7, Number(args[0]) || 1000);
        this.sendSelf(conn);
        return reply('Credits added.');
      case 'story': {
        const goal = this.story.activeGoals().find((g) => (this.story.s.progress[g.id] || 0) < goalTarget(g, this.story.s.era, this.story.s.scale));
        if (!goal) return reply('No active goal.');
        this.story.add(goal.id, Number(args[0]) || 1e6, p.name);
        return reply(`Advanced "${goal.label}".`);
      }
      case 'land': {
        const [sx, sz] = sectorOf(p.x, p.z);
        const pl = generateSector(sx, sz, this.seed).planets.find((x) => x.landable);
        if (p.mode !== 'space' || !pl) return reply('No landable planet in this sector.');
        this.surfaces.place(conn, pl.id);
        conn.send({ t: 'teleport', mode: 'surface', planet: pl.id, x: p.px, y: p.py, z: p.pz });
        this.sendSelf(conn);
        return reply(`Landed on ${pl.name}.`);
      }
      case 'rep': {
        const f = args[0], n = Number(args[1]);
        if (!FACTIONS[f] || !Number.isFinite(n)) return reply('Usage: /rep empire|rebellion <amount>');
        return this.changeRep(conn, { [f]: n });
      }
      case 'relic': {
        const id = args[0];
        if (!RELICS[id]) return reply(`Usage: /relic <${Object.keys(RELICS).join('|')}>`);
        return this.giveItem(conn, makeRelic(id));
      }
      case 'goto': {
        if (p.mode !== 'surface') return reply('Usage (on a planet): /goto <structure type or id>');
        const st = this.surfaces.instance(p.planet).structures.find((x) => x.id === args[0] || x.type === args[0] || (args[0] === 'dungeon' && STRUCTURES[x.type].kind === 'dungeon') || (args[0] === 'village' && x.race));
        if (!st) return reply(`Here: ${this.surfaces.instance(p.planet).structures.map((x) => x.type).join(', ') || 'nothing'}`);
        p.px = st.x + st.radius + 3; p.pz = st.z; p.py = this.surfaces.ground(p.planet, p.px, p.pz);
        conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
        return reply(`Moved to the ${STRUCTURES[st.type].name}.`);
      }
      case 'town': {
        if (p.mode !== 'surface') return reply('Usage (on a planet): /town [index]');
        const towns = townsOf(this.surfaces.instance(p.planet).planet);
        const t = towns[Number(args[0]) || 0];
        if (!t) return reply(`Towns here: ${towns.map((x, i) => `${i}: ${x.name}`).join(', ') || 'none'}`);
        p.px = t.x; p.pz = t.z + t.radius * 0.2; p.py = this.surfaces.ground(p.planet, p.px, p.pz);
        conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
        return reply(`Moved to ${t.name}.`);
      }
      case 'war': case 'event': {
        if (p.mode !== 'surface') return reply('On a planet: /war  or  /event famine|plague|festival|raiders');
        const s = this.politics.state(p.planet), ids = Object.keys(s.realms);
        if (cmd === 'war') {
          if (ids.length < 2) return reply('Only one realm here.');
          const [a, b] = ids;
          s.realms[a].war = { with: b, score: 0, since: Date.now() };
          s.realms[b].war = { with: a, score: 0, since: Date.now() };
          this.politics.chronicle(p.planet, `War! The ${this.politics.realmDef(p.planet, a).name} has declared war on the ${this.politics.realmDef(p.planet, b).name}.`);
          return reply('War declared.');
        }
        const kind = args[0] || 'raiders';
        this.politics.startEvent(p.planet, ids[0], kind, 15, `(${kind} begins in the ${this.politics.realmDef(p.planet, ids[0]).name})`);
        return reply('Event started.');
      }
      case 'director': {
        if (args[0]) return reply(this.director.event(args[0]) ? `Event ${args[0]} started.` : 'Usage: /director [raid|festival|famine|plague|omen|bounty|bonanza]');
        for (const line of this.director.status()) reply(line);
        return;
      }
      case 'pos': {
        const x = Number(args[0]), z = Number(args[1]);
        if (p.mode !== 'surface' || !Number.isFinite(x) || !Number.isFinite(z)) return reply('Usage (on a planet): /pos <x> <z>');
        p.px = x; p.pz = z; p.py = this.surfaces.ground(p.planet, x, z);
        return conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
      }
      case 'mech': return this.giveItem(conn, makeItem('mech', 'mech', Number(args[0]) || 2));
      case 'spells': p.spells = Object.keys(SPELLS); p.mana = 999; this.sendSelf(conn); return reply('You know every spell.');
      case 'power': {
        if (!POWERS[args[0]]) return reply(`Usage: /power ${Object.keys(POWERS).join('|')}`);
        p.power = args[0]; p.energy = 100; this.sendSelf(conn); return reply(`Power: ${POWERS[args[0]].name}.`);
      }
      case 'curse': p.curse = ['vampire', 'werewolf'].includes(args[0]) ? args[0] : null; p.wolf = false; this.sendSelf(conn); return reply(`Curse: ${p.curse || 'none'}.`);
      case 'heal':
        p.hull = p.stats.hp; p.shield = p.stats.shield; p.hp = p.maxHp;
        this.sendSelf(conn);
        return reply('Healed.');
      default:
        return reply('Admin commands: /spawn, /tp, /land, /give, /credits, /story, /rep, /relic, /goto, /town, /war, /event, /mech, /spells, /power, /curse, /pos, /director, /heal');
    }
  }

  on_party_invite(conn, { name }) { if (typeof name === 'string') this.parties.invite(conn, name); }
  on_party_accept(conn) { this.parties.accept(conn); }
  on_party_decline(conn) { this.parties.decline(conn); }
  on_party_leave(conn) { this.parties.leave(conn); }
  on_party_kick(conn, { name }) { this.parties.kick(conn, name); }

  tutorial(conn, event, n = 1) {
    const p = conn.player;
    const step = TUTORIAL[p.tutorial];
    if (!step || step.event !== event) return;
    if (step.count) {
      p.tutCount += n;
      if (p.tutCount < step.count) { conn.send({ t: 'you', tutCount: p.tutCount }); return; }
    }
    p.tutorial++;
    p.tutCount = 0;
    p.credits += 60;
    if (p.tutorial >= TUTORIAL.length) {
      p.credits += 300;
      this.giveItem(conn, makeItem('weapon', 'rifle', 1));
      conn.send({ t: 'toast', msg: 'Training complete: +300 cr and a rifle. The galaxy is yours.' });
    }
    this.dirty = true;
    this.sendSelf(conn);
  }

  onStoryChanged() {
    for (const c of this.conns()) {
      this.restat(c.player);
      this.sendSelf(c);
    }
  }

  // ---- simulation ---------------------------------------------------------------------------

  tick(dt, now) {
    for (const c of this.conns()) {
      const p = c.player;
      if (p.blessing && p.blessing.until < now) {
        c.send({ t: 'toast', msg: `${p.blessing.name} has faded.` });
        p.blessing = null;
        this.restat(p);
        this.sendSelf(c);
      }
    }
    this.mineTick(dt, now);
    this.combat.tick(dt, now);
    this.surfaces.tick(dt, now);
    this.dungeons.tick(dt, now);
    this.story.tick(now);
    this.politics.tick(now);
    this.quests.tick(now);
    this.powers.tick(dt, now);
    this.bases.tick(dt, now);
    this.gravityTick(dt, now);
    this.director.tick(now);
    this.snapshots(now);
  }

  // Black holes: the accretion disk burns, and whatever crosses the horizon comes out somewhere else.
  gravityTick(dt, now) {
    for (const c of this.conns()) {
      const p = c.player;
      if (p.mode !== 'space' || p.dead) continue;
      const [sx, sz] = sectorOf(p.x, p.z);
      const star = generateSector(sx, sz, this.seed).star;
      if (!star || star.type !== 'Black hole') continue;
      const d = Math.hypot(star.x - p.x, star.y - p.y, star.z - p.z);
      if (d < star.r * 1.2) {
        const a = Math.random() * Math.PI * 2, far = 15 + Math.floor(Math.random() * 25);
        const tx = sx + Math.round(Math.cos(a) * far), tz = sz + Math.round(Math.sin(a) * far);
        p.hull = Math.max(1, p.stats.hp * 0.25);
        p.shield = 0;
        this.teleport(c, ...this.arrivalPoint(tx, tz));
        c.send({ t: 'transmission', title: 'THROUGH THE EVENT HORIZON', lines: ['Time stretches. Your ship screams. Then: stars, different stars.', `You were thrown ${far} sectors across the galaxy. Your hull barely held.`] });
        this.sendSelf(c);
      } else if (d < star.r * 3.2) {
        p.shield = 0;
        p.hull -= 35 * dt;
        p.lastHit = now;
        if (Math.random() < 0.15) c.send({ t: 'you', hull: p.hull, shield: 0 });
        if (p.hull <= 0) this.combat.destroyPlayerShip(c, 'a black hole');
      }
    }
  }

  mineTick(dt, now) {
    const changed = new Map();
    const eff = this.story.effects();
    for (const c of this.conns()) {
      c.buildBudget = Math.min(20, c.buildBudget + 1);
      const p = c.player;
      if (!p.mining || p.mode !== 'space' || p.dead) continue;
      const a = findAsteroid(p.mining, this.seed);
      if (!a || Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) > p.stats.mineRange + a.r) { p.mining = null; continue; }
      const left = this.asteroidAmount(a);
      const space = p.stats.cargo - cargoTotal(p.cargo);
      if (left <= 0 || space <= 0) {
        if (space <= 0 && now - (c.lastFullToast || 0) > 3000) { c.lastFullToast = now; c.send({ t: 'toast', msg: 'Cargo hold full. Sell at a station.' }); }
        p.mining = null;
        continue;
      }
      const take = Math.min(p.stats.mineRate * dt * (this.director.bonanza() ? 2 : 1), left);
      p.mineFrac += take;
      const whole = Math.min(Math.floor(p.mineFrac), space);
      if (whole > 0) {
        p.mineFrac -= whole;
        const ore = effectiveOre(a, eff);
        p.cargo[ore] = (p.cargo[ore] || 0) + whole;
        this.sendSelf(c);
        this.tutorial(c, 'mine', whole);
      }
      this.data.asteroids[a.id] = { amt: Math.max(0, left - take), t: now };
      if (Math.ceil(left) !== Math.ceil(left - take)) changed.set(a.id, a);
      this.dirty = true;
    }
    for (const [id, a] of changed) this.toNear(a.x, a.z, { t: 'ast', id, amt: Math.ceil(this.data.asteroids[id].amt) });
  }

  snapshots(now) {
    const all = this.conns();
    const online = all.length;
    for (const c of all) {
      const me = c.player;
      const ships = {};
      const needShip = (p) => {
        if (c.seenShips.get(p.key) !== p.shipRev) { ships[p.key] = p.ship; c.seenShips.set(p.key, p.shipRev); }
      };
      if (me.mode === 'space') {
        const players = [];
        for (const o of all) {
          const p = o.player;
          if (o === c || p.mode !== 'space' || p.dead || !c.subs.has(sectorKey(...sectorOf(p.x, p.z)))) continue;
          needShip(p);
          players.push({ id: o.id, key: p.key, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, q: p.q, thrust: p.thrust, mining: p.mining, hull: p.hull, maxHull: p.stats.hp, rev: p.shipRev });
        }
        c.send({ t: 'snap', time: now, mode: 'space', players, npcs: this.combat.npcsIn(c.subs, me), ships, online, mining: me.mining });
      } else if (me.mode === 'dungeon') {
        c.send({ t: 'snap', time: now, mode: 'dungeon', ...this.dungeons.snapshot(c), parked: [], ships, online });
      } else {
        const s = this.surfaces.snapshot(c);
        for (const pk of s.parked) { const oc = this.connByName(pk.key); if (oc) needShip(oc.player); }
        c.send({ t: 'snap', time: now, mode: 'surface', ...s, ships, online });
      }
    }
  }
}

