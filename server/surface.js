// Planet surfaces: pilots on foot walk, dig, build, fight creatures (and each other away from
// Haven), find relics, and take off again. One instance per planet that has someone on it.

import { findPlanet, planetPos, generateSector } from '../shared/universe.js';
import {
  CELL, SURFACE_HALF, MAX_DIG, SETTLEMENT, SETTLEMENT_RADIUS,
  standHeight, heightAt, deposits, digOre, landingSpot, vkey, terrainOf, faunaOf, structuresOf, creatureStats,
} from '../shared/planet.js';
import { BLOCKS, SURFACE_GRID, canAfford, cargoTotal } from '../shared/rules.js';
import { weaponStats, armorRating, randomItem, randomRelic, makeRelic, godBlessing, PLAYER_HP, RUN_SPEED } from '../shared/items.js';
import { CREATURES } from '../shared/content/creatures.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { GODS, PRAYER } from '../shared/content/factions.js';
import { RELICS } from '../shared/content/relics.js';

const GUARD_RESPAWN_MS = 5 * 60 * 1000;
// Reputation change for killing a faction's soldier.
const SOLDIER_KILL_REP = { empire: { empire: -8, rebellion: 5 }, rebellion: { rebellion: -8, empire: 5 } };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
let nextId = 1;

export class Surfaces {
  constructor(world) {
    this.w = world;
    this.instances = new Map();   // planetId -> { planet, creatures: Map }
    world.data.surfaces ||= {};
  }

  saved(pid) {
    return (this.w.data.surfaces[pid] ||= { digs: {}, blocks: {}, deposits: {} });
  }

  instance(pid) {
    let inst = this.instances.get(pid);
    if (!inst) {
      const planet = findPlanet(pid, this.w.seed);
      if (!planet) return null;
      inst = { planet, creatures: new Map(), lastSpawn: 0, guardsAt: {}, structures: structuresOf(planet) };
      this.instances.set(pid, inst);
    }
    return inst;
  }

  ground(pid, x, z) {
    return standHeight(this.instance(pid).planet, x, z, this.saved(pid).digs);
  }

  state(pid, p) {
    const s = this.saved(pid);
    const looted = p ? Object.keys(p.looted).filter((k) => k.startsWith(pid + '#')).map((k) => k.split('#')[1]) : [];
    return { t: 'surface', planet: pid, digs: s.digs, blocks: s.blocks, deposits: s.deposits, looted };
  }

  // ---- arriving and leaving -------------------------------------------------------------------

  // Put a pilot on the surface next to where their ship is parked.
  place(conn, pid, parkAt) {
    const p = conn.player;
    const inst = this.instance(pid);
    const [lx, lz] = parkAt || this.parkSpot(inst.planet, p.key);
    p.mode = 'surface';
    p.planet = pid;
    p.parked = { planet: pid, x: lx, z: lz };
    p.px = lx + 9; p.pz = lz + 3;
    p.py = this.ground(pid, p.px, p.pz);
    p.yaw = 0;
    p.lastPos = Date.now();
    p.mining = null;
    this.refreshVitals(p);
    conn.subs = new Set();
    conn.send(this.state(pid, p));
    // Landing fills in the codex: this world's terrain, wildlife and structures.
    const planet = inst.planet;
    this.w.discover(conn, [
      `terrain:${terrainOf(planet)}`, ...faunaOf(planet).map((c) => `creature:${c}`),
      ...inst.structures.map((st) => `structure:${st.type}`), ...(planet.holy ? ['place:capital'] : []),
    ]);
  }

  parkSpot(planet, key) {
    const [x, z] = landingSpot(planet);
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return [x + ((Math.abs(h) % 5) - 2) * 14, z + ((Math.abs(h >> 3) % 3) - 1) * 12];
  }

  land(conn, pid) {
    const p = conn.player;
    const planet = findPlanet(pid, this.w.seed);
    if (!planet || p.mode !== 'space' || p.dead) return;
    if (!planet.landable) return conn.send({ t: 'toast', msg: `${planet.name} is a gas giant. Nowhere to land.` });
    const star = generateSector(planet.sx, planet.sz, this.w.seed).star;
    const [x, y, z] = planetPos(planet, star, this.w.time());
    if (Math.hypot(p.x - x, p.y - y, p.z - z) > planet.r + 450) return conn.send({ t: 'toast', msg: 'Get closer to the planet to land.' });
    this.place(conn, pid);
    conn.send({ t: 'teleport', mode: 'surface', planet: pid, x: p.px, y: p.py, z: p.pz });
    this.w.sendSelf(conn);
    conn.send({ t: 'toast', msg: `Landed on ${planet.name}.` });
  }

  takeoff(conn) {
    const p = conn.player;
    const planet = this.instance(p.planet).planet;
    const star = generateSector(planet.sx, planet.sz, this.w.seed).star;
    const [x, y, z] = planetPos(planet, star, this.w.time());
    p.mode = 'space';
    p.planet = null;
    p.parked = null;
    Object.assign(p, { x, y: y + planet.r + 160, z, vx: 0, vy: 0, vz: 0, q: [0, 0, 0, 1], lastPos: Date.now() });
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    conn.send({ t: 'teleport', mode: 'space', x: p.x, y: p.y, z: p.z, q: p.q });
    this.w.sendSelf(conn);
    this.w.tutorial(conn, 'takeoff');
  }

  refreshVitals(p) {
    const ar = armorRating(p.inv.equipped, p.inv.items, p.buffs || {});
    p.armor = ar;
    p.maxHp = PLAYER_HP + ar.shield;
    if (p.hp == null || p.hp > p.maxHp) p.hp = p.maxHp;
  }

  // ---- messages ---------------------------------------------------------------------------

  walk(conn, m) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead || ![m.x, m.y, m.z, m.yaw].every(num)) return;
    const now = Date.now();
    const dt = Math.max(0.05, (now - p.lastPos) / 1000);
    if (Math.hypot(m.x - p.px, m.z - p.pz) > RUN_SPEED * dt * 1.5 + 3 || Math.max(Math.abs(m.x), Math.abs(m.z)) > SURFACE_HALF) {
      conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
      p.lastPos = now;
      return;
    }
    const g = this.ground(p.planet, m.x, m.z);
    p.px = m.x; p.pz = m.z; p.py = Math.max(g - 0.5, Math.min(m.y, g + 40));
    p.yaw = m.yaw;
    p.lastPos = now;
  }

  shoot(conn, { dir }) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead || !Array.isArray(dir) || dir.length !== 3 || !dir.every(num)) return;
    const weapon = p.inv.items.find((i) => i.id === p.inv.equipped.weapon);
    if (!weapon) return conn.send({ t: 'toast', msg: 'No weapon equipped (Tab to open your gear).' });
    const ws = weaponStats(weapon);
    ws.damage *= 1 + (p.buffs?.damage || 0);
    const now = Date.now();
    if (now - (p.lastShot || 0) < 1000 / ws.rate * 0.85) return;
    p.lastShot = now;
    const l = Math.hypot(...dir) || 1;
    const d0 = [dir[0] / l, dir[1] / l, dir[2] / l];
    const o = [p.px, p.py + 1.5, p.pz];
    const inst = this.instance(p.planet);
    const digs = this.saved(p.planet).digs;
    const tracers = [];
    for (let i = 0; i < ws.pellets; i++) {
      const d = [d0[0] + (Math.random() - 0.5) * ws.spread * 2, d0[1] + (Math.random() - 0.5) * ws.spread * 2, d0[2] + (Math.random() - 0.5) * ws.spread * 2];
      const dl = Math.hypot(...d);
      d[0] /= dl; d[1] /= dl; d[2] /= dl;
      // Terrain blocks shots.
      let maxT = ws.range;
      for (let t = 2; t < ws.range; t += 2) {
        if (o[1] + d[1] * t < heightAt(inst.planet, o[0] + d[0] * t, o[2] + d[2] * t, digs)) { maxT = t; break; }
      }
      let best = null, bestT = maxT;
      const test = (cx, cy, cz, r, target) => {
        const vx = cx - o[0], vy = cy - o[1], vz = cz - o[2];
        const t = vx * d[0] + vy * d[1] + vz * d[2];
        if (t < 0 || t > bestT) return;
        const dist = Math.hypot(vx - d[0] * t, vy - d[1] * t, vz - d[2] * t);
        if (dist < r) { bestT = t; best = target; }
      };
      for (const c of inst.creatures.values()) test(c.x, c.y + c.size * 0.8, c.z, c.size + 0.4, { creature: c });
      if (!inst.planet.starter) {
        for (const oc of this.w.conns()) {
          const q = oc.player;
          if (oc === conn || q.mode !== 'surface' || q.planet !== p.planet || q.dead || this.w.parties.sameParty(p.key, q.key)) continue;
          test(q.px, q.py + 1, q.pz, 0.9, { conn: oc });
        }
      }
      tracers.push([o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT]);
      if (best?.creature) this.hurtCreature(inst, best.creature, ws.damage, conn);
      else if (best?.conn) this.hurtPlayer(best.conn, ws.damage, p.name);
    }
    this.toPlanet(p.planet, { t: 'shot', by: conn.id, from: o, to: tracers, c: ws.color, w: weapon.type });
  }

  hurtCreature(inst, c, dmg, conn) {
    c.hp -= dmg;
    c.aggro = conn.player.key;
    // Attacking one soldier makes the whole squad turn on you.
    if (c.faction) for (const o of inst.creatures.values()) if (o.faction === c.faction && Math.hypot(o.x - c.x, o.z - c.z) < 60) o.aggro = conn.player.key;
    this.toPlanet(inst.planet.id, { t: 'hit', id: c.id, x: c.x, y: c.y + c.size, z: c.z, dmg: Math.round(dmg) });
    if (c.hp > 0) return;
    inst.creatures.delete(c.id);
    this.toPlanet(inst.planet.id, { t: 'boom', x: c.x, y: c.y + c.size * 0.5, z: c.z, size: c.size * 2, organic: !c.faction && c.shape !== 'golem' });
    this.w.discover(conn, [`creature:${c.species}`]);
    if (c.faction) {
      this.w.changeRep(conn, SOLDIER_KILL_REP[c.faction]);
      this.w.warScore(c.faction === 'empire' ? 'rebellion' : 'empire');
    }
    const luck = 1 + (conn.player.buffs?.luck || 0);
    if (c.guard && Math.random() < 0.15 * luck) this.w.giveItem(conn, randomRelic());
    const reward = Math.round((inst.planet.starter ? 3 : c.guard || c.faction ? 25 : 8) * inst.planet.richness);
    const crew = this.w.parties.nearbyMembers(conn.player);
    for (const p of crew) {
      p.credits += Math.max(1, Math.round(reward / crew.length));
      const pc = this.w.connByName(p.key);
      if (pc) this.w.sendSelf(pc);
    }
    if (Math.random() < (inst.planet.starter ? 0.08 : 0.25) * luck) this.w.giveItem(conn, randomItem(inst.planet.richness));
  }

  hurtPlayer(conn, dmg, byName) {
    const p = conn.player;
    if (p.dead) return;
    const taken = dmg * (1 - (p.armor?.reduction || 0));
    p.hp -= taken;
    p.lastHurt = Date.now();
    this.toPlanet(p.planet, { t: 'hit', id: conn.id, x: p.px, y: p.py + 1.2, z: p.pz, dmg: Math.round(taken) });
    conn.send({ t: 'you', hp: p.hp });
    if (p.hp > 0) return;
    p.dead = true;
    this.w.broadcast({ t: 'chat', from: null, text: `${p.name} was taken down by ${byName}.` });
    conn.send({ t: 'died', by: byName, respawnIn: 3 });
    setTimeout(() => {
      if (!this.w.conns().includes(conn) || p.mode !== 'surface') return;
      p.dead = false;
      p.hp = p.maxHp;
      const park = p.parked;
      p.px = park.x + 9; p.pz = park.z + 3; p.py = this.ground(p.planet, p.px, p.pz);
      conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
      this.w.sendSelf(conn);
    }, 3000);
  }

  dig(conn, { x, z, raise }) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead || !num(x) || !num(z)) return;
    const now = Date.now();
    if (now - (p.lastDig || 0) < 200) return;
    p.lastDig = now;
    if (Math.hypot(x - p.px, z - p.pz) > 10 || Math.max(Math.abs(x), Math.abs(z)) > SURFACE_HALF - 40) return;
    const inst = this.instance(p.planet);
    if (inst.planet.starter && Math.hypot(x, z) < SETTLEMENT_RADIUS) return conn.send({ t: 'toast', msg: 'No digging inside Haven Landing.' });
    const ix = Math.round(x / CELL), iz = Math.round(z / CELL), k = vkey(ix, iz);
    const s = this.saved(p.planet);
    const cur = s.digs[k] || 0;
    if (raise) {
      if (cur >= 12) return;
      if ((p.cargo.iron || 0) < 1) return conn.send({ t: 'toast', msg: 'Raising ground uses 1 iron.' });
      p.cargo.iron--;
      s.digs[k] = cur + 1.2;
    } else {
      if (cur <= -MAX_DIG) return;
      const stats = p.stats;
      if (cargoTotal(p.cargo) >= stats.cargo) return conn.send({ t: 'toast', msg: 'Cargo hold full.' });
      s.digs[k] = cur - 1.2;
      let ore = digOre(inst.planet, x, z), n = 1;
      const dep = deposits(inst.planet).find((d) => Math.hypot(d.x - x, d.z - z) < 9 && (s.deposits[d.id] ?? d.amount) > 0);
      if (dep) {
        ore = dep.ore; n = 2;
        s.deposits[dep.id] = (s.deposits[dep.id] ?? dep.amount) - n;
        this.toPlanet(p.planet, { t: 'deposit', id: dep.id, amt: s.deposits[dep.id] });
      }
      p.cargo[ore] = (p.cargo[ore] || 0) + n;
      p.dug = (p.dug || 0) + n;
      this.w.tutorial(conn, 'dig', n);
    }
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.toPlanet(p.planet, { t: 'dig', planet: p.planet, k, d: s.digs[k] });
  }

  build(conn, { gx, gy, gz, block }) {
    const p = conn.player;
    const def = BLOCKS[block];
    if (p.mode !== 'surface' || !def || ![gx, gy, gz].every(Number.isInteger)) return;
    const cx = (gx + 0.5) * SURFACE_GRID, cy = (gy + 0.5) * SURFACE_GRID, cz = (gz + 0.5) * SURFACE_GRID;
    if (Math.hypot(cx - p.px, cy - p.py, cz - p.pz) > 14) return conn.send({ t: 'toast', msg: 'Too far away to build there.' });
    const inst = this.instance(p.planet);
    if (inst.planet.starter && Math.hypot(cx, cz) < SETTLEMENT_RADIUS) return conn.send({ t: 'toast', msg: 'No building inside Haven Landing.' });
    const s = this.saved(p.planet), cell = `${gx},${gy},${gz}`;
    if (s.blocks[cell] || Object.keys(s.blocks).length > 20000) return;
    if (!canAfford(p.cargo, def.cost)) return conn.send({ t: 'toast', msg: `Not enough ore for ${def.name}.` });
    for (const [k, v] of Object.entries(def.cost)) p.cargo[k] -= v;
    s.blocks[cell] = { b: block, o: p.name };
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.toPlanet(p.planet, { t: 'sblock', planet: p.planet, cell, data: s.blocks[cell] });
  }

  unbuild(conn, { gx, gy, gz }) {
    const p = conn.player;
    if (p.mode !== 'surface' || ![gx, gy, gz].every(Number.isInteger)) return;
    const s = this.saved(p.planet), cell = `${gx},${gy},${gz}`;
    const blk = s.blocks[cell];
    if (!blk) return;
    if (blk.o !== p.name) return conn.send({ t: 'toast', msg: `That belongs to ${blk.o}.` });
    const cx = (gx + 0.5) * SURFACE_GRID, cz = (gz + 0.5) * SURFACE_GRID;
    if (Math.hypot(cx - p.px, cz - p.pz) > 14) return;
    delete s.blocks[cell];
    for (const [k, v] of Object.entries(BLOCKS[blk.b].cost)) p.cargo[k] = (p.cargo[k] || 0) + v;
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.toPlanet(p.planet, { t: 'sblock', planet: p.planet, cell, data: null });
  }

  interact(conn, { what, id }) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead) return;
    const inst = this.instance(p.planet);
    const near = (x, z, r) => Math.hypot(p.px - x, p.pz - z) <= r;
    if (what === 'ship' && p.parked && near(p.parked.x, p.parked.z, 15)) return this.takeoff(conn);
    if (inst.planet.starter && what === 'vendor' && near(SETTLEMENT.vendor.x, SETTLEMENT.vendor.z, 8)) {
      this.w.tutorial(conn, 'vendor');
      return this.w.openShop(conn, 'haven-landing', 1, 'Haven Landing Trade Hall');
    }
    if (inst.planet.starter && what === 'warden' && near(SETTLEMENT.warden.x, SETTLEMENT.warden.z, 8)) {
      conn.send({ t: 'dialogue', who: SETTLEMENT.warden.name });
      return this.w.tutorial(conn, 'warden');
    }
    if (what === 'structure') return this.useStructure(conn, inst, id);
    if (what === 'relic') {
      const site = this.w.story.relics().find((r) => r.planet === p.planet);
      if (!site || !near(site.x, site.z, 8)) return;
      if (!this.w.story.relicFound(conn, site)) return conn.send({ t: 'toast', msg: 'The relic hums, but it is already awake.' });
      p.credits += 500;
      this.w.giveItem(conn, randomItem(inst.planet.richness + 2));
      this.w.sendSelf(conn);
    }
  }

  // Loot a cache, pray at a shrine, or kneel in the Cathedral.
  useStructure(conn, inst, id) {
    const p = conn.player;
    const st = inst.structures.find((x) => x.id === id);
    if (!st || Math.hypot(p.px - st.x, p.pz - st.z) > st.radius + 8) return;
    const def = STRUCTURES[st.type];
    this.w.discover(conn, [`structure:${st.type}`]);
    if (def.kind === 'shrine') return this.pray(conn, st);
    if (st.type === 'cathedral') {
      return conn.send({ t: 'toast', msg: 'The Cathedral doors are open to the faithful. Dock at the Sanctum above to receive the Benediction.' });
    }
    if (!def.cache) return conn.send({ t: 'chat', from: null, text: `${def.name}: ${def.lore}` });
    const key = `${inst.planet.id}#${st.id}`;
    if (p.looted[key]) return conn.send({ t: 'toast', msg: 'You have already searched this.' });
    p.looted[key] = Date.now();
    const rich = inst.planet.richness, luck = 1 + (p.buffs?.luck || 0);
    const [lo, hi] = def.cache.credits;
    const credits = Math.round((lo + Math.random() * (hi - lo)) * (0.7 + 0.3 * rich));
    p.credits += credits;
    conn.send({ t: 'chat', from: null, text: `${def.name}: ${def.lore}` });
    conn.send({ t: 'toast', msg: `Searched the ${def.name}: +${credits} cr` });
    if (Math.random() < def.cache.item * luck) this.w.giveItem(conn, randomItem(rich + 1));
    if (Math.random() < (def.cache.relic || 0) * luck) {
      const pool = def.cache.relics?.filter((r) => RELICS[r]);
      this.w.giveItem(conn, pool?.length && Math.random() < 0.6 ? makeRelic(pool[Math.floor(Math.random() * pool.length)]) : randomRelic());
    }
    if (def.kind === 'imperial') this.w.changeRep(conn, { empire: -5 }, 'The Empire will hear you robbed its garrison.');
    if (def.kind === 'rebel') this.w.changeRep(conn, { rebellion: -5 }, 'The Unbound will remember who raided their cache.');
    conn.send({ t: 'looted', planet: inst.planet.id, id: st.id });
    this.w.dirty = true;
    this.w.sendSelf(conn);
  }

  pray(conn, st) {
    const p = conn.player, god = GODS[st.god], now = Date.now();
    const wait = PRAYER.cooldownMinutes * 60000 - (now - (p.lastPray || 0));
    if (wait > 0) return conn.send({ t: 'toast', msg: `The gods are not listening yet (${Math.ceil(wait / 60000)} min).` });
    p.lastPray = now;
    p.favor[st.god] = (p.favor[st.god] || 0) + 1;
    this.w.discover(conn, [`god:${st.god}`]);
    this.w.bless(conn, godBlessing(st.god), PRAYER.minutes);
    conn.send({ t: 'chat', from: null, text: `You pray to ${god.name}. ${god.lore}` });
    // The Empire calls the old gods heresy; the rebels have taken them back.
    this.w.changeRep(conn, { empire: -3, rebellion: 2 });
    if (p.favor[st.god] === PRAYER.favorForRelic) {
      conn.send({ t: 'transmission', title: god.name.toUpperCase(), lines: [`${god.name.split(',')[0]} answers. Something heavy and old is pressed into your hands.`] });
      this.w.giveItem(conn, makeRelic(god.relic));
    }
  }

  // ---- simulation -------------------------------------------------------------------------

  tick(dt, now) {
    const byPlanet = new Map();
    for (const c of this.w.conns()) {
      const p = c.player;
      if (p.mode !== 'surface') continue;
      if (!byPlanet.has(p.planet)) byPlanet.set(p.planet, []);
      byPlanet.get(p.planet).push(c);
      // Health regenerates out of combat.
      const regen = p.buffs?.regen || 0;
      if (!p.dead && p.hp < p.maxHp && (now - (p.lastHurt || 0) > 6000 || regen)) {
        p.hp = Math.min(p.maxHp, p.hp + (now - (p.lastHurt || 0) > 6000 ? 4 : 0) * dt + regen * dt);
        if (Math.random() < 0.1) c.send({ t: 'you', hp: p.hp });
      }
    }
    for (const [pid, inst] of this.instances) {
      const conns = byPlanet.get(pid);
      if (!conns) { this.instances.delete(pid); continue; }
      this.spawnCreatures(inst, conns, now);
      this.creatureTick(inst, conns, dt, now);
    }
  }

  newCreature(inst, species, x, z, extra = {}) {
    const def = creatureStats(inst.planet, species);
    const id = 'c' + nextId++;
    const c = {
      id, species, x, z, y: this.ground(inst.planet.id, x, z), yaw: 0, hp: def.hp, maxHp: def.hp, dmg: def.dmg,
      speed: def.speed, size: def.size, behavior: def.behavior, faction: def.faction || null, shape: def.shape,
      lastAttack: 0, wander: null, aggro: null, ...extra,
    };
    inst.creatures.set(id, c);
    return c;
  }

  spawnCreatures(inst, conns, now) {
    if (now - inst.lastSpawn < 1500) return;
    inst.lastSpawn = now;
    const planet = inst.planet;

    // Ruin guardians and faction soldiers turn out when someone comes near their structure.
    for (const st of inst.structures) {
      const def = STRUCTURES[st.type];
      const guard = def.guardians || def.soldiers;
      if (!guard) continue;
      if (now - (inst.guardsAt[st.id] || 0) < GUARD_RESPAWN_MS) continue;
      if (!conns.some((c) => Math.hypot(c.player.px - st.x, c.player.pz - st.z) < st.radius + 70)) continue;
      inst.guardsAt[st.id] = now;
      const [species, count] = guard;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random();
        const x = st.x + Math.cos(a) * (st.radius + 4), z = st.z + Math.sin(a) * (st.radius + 4);
        this.newCreature(inst, species, x, z, { guard: st.id, home: [st.x, st.z], leash: st.radius + 45 });
      }
    }

    const wild = [...inst.creatures.values()].filter((c) => !c.guard).length;
    const cap = Math.min(18, conns.length * (planet.starter ? 3 : 5));
    if (wild >= cap || Math.random() > 0.5) return;
    const anchor = conns[Math.floor(Math.random() * conns.length)].player;
    const a = Math.random() * Math.PI * 2, d = 55 + Math.random() * 70;
    const x = anchor.px + Math.cos(a) * d, z = anchor.pz + Math.sin(a) * d;
    if (Math.max(Math.abs(x), Math.abs(z)) > SURFACE_HALF - 45) return;
    if (Math.hypot(x, z) < (planet.starter ? 120 : 45)) return;
    const fauna = faunaOf(planet);
    let total = 0;
    for (const f of fauna) total += CREATURES[f].rarity;
    let r = Math.random() * total, species = fauna[0];
    for (const f of fauna) { r -= CREATURES[f].rarity; if (r <= 0) { species = f; break; } }
    const pack = CREATURES[species].behavior === 'swarm' ? 3 + Math.floor(Math.random() * 2) : 1;
    for (let i = 0; i < pack; i++) this.newCreature(inst, species, x + (Math.random() - 0.5) * 8, z + (Math.random() - 0.5) * 8);
  }

  // Whether a creature wants to fight this pilot, and from how far away.
  aggroRange(c, p) {
    if (c.aggro === p.key) return 60;
    switch (c.behavior) {
      case 'aggressive': case 'swarm': return 45;
      case 'territorial': return 18;
      case 'guardian': return 40;
      case 'soldier': return this.w.hostileTo(c.faction, p) ? 55 : 0;
      default: return 0;   // passive
    }
  }

  creatureTick(inst, conns, dt, now) {
    for (const c of inst.creatures.values()) {
      let target = null, best = Infinity;
      for (const oc of conns) {
        const p = oc.player;
        if (p.dead) continue;
        const d = Math.hypot(p.px - c.x, p.pz - c.z);
        const range = this.aggroRange(c, p);
        if (d < range && d < best) { best = d; target = oc; }
      }
      // Wander off if nobody is around at all; guards stay home.
      if (!c.guard && !conns.some((oc) => Math.hypot(oc.player.px - c.x, oc.player.pz - c.z) < 220)) { inst.creatures.delete(c.id); continue; }
      if (c.guard && c.home && Math.hypot(c.x - c.home[0], c.z - c.home[1]) > c.leash) { target = null; c.aggro = null; }
      let tx, tz, speed = c.speed;
      if (target) {
        tx = target.player.px; tz = target.player.pz;
        // Soldiers shoot from range; everything else has to get close.
        const reach = c.behavior === 'soldier' ? 28 : 1.6 + c.size;
        if (best < reach) {
          speed = c.behavior === 'soldier' && best > 12 ? speed * 0.4 : 0;
          if (now - c.lastAttack > (c.behavior === 'soldier' ? 900 : 1100)) {
            c.lastAttack = now;
            if (c.behavior === 'soldier') {
              this.toPlanet(inst.planet.id, { t: 'shot', by: c.id, from: [c.x, c.y + 1.5, c.z], to: [[target.player.px, target.player.py + 1.2, target.player.pz]], c: c.faction === 'empire' ? '#ffe08a' : '#ff6a4a' });
              if (Math.random() < 0.7) this.hurtPlayer(target, c.dmg, CREATURES[c.species].name);
            } else this.hurtPlayer(target, c.dmg, CREATURES[c.species].name);
          }
        }
      } else if (c.guard && c.home && Math.hypot(c.x - c.home[0], c.z - c.home[1]) > 8) {
        [tx, tz] = c.home;
      } else {
        const base = c.home || [c.x, c.z];
        if (!c.wander || Math.hypot(c.wander[0] - c.x, c.wander[1] - c.z) < 3) c.wander = [base[0] + (Math.random() - 0.5) * (c.guard ? 30 : 50), base[1] + (Math.random() - 0.5) * (c.guard ? 30 : 50)];
        [tx, tz] = c.wander;
        speed *= 0.35;
      }
      const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
      if (d > 0.1 && speed > 0) {
        const step = Math.min(d, speed * dt);
        const nx = c.x + (dx / d) * step, nz = c.z + (dz / d) * step;
        if (Math.max(Math.abs(nx), Math.abs(nz)) < SURFACE_HALF - 40) { c.x = nx; c.z = nz; }
        c.yaw = Math.atan2(dx, dz);
      } else if (target) c.yaw = Math.atan2(target.player.px - c.x, target.player.pz - c.z);
      c.y = this.ground(inst.planet.id, c.x, c.z);
    }
  }

  toPlanet(pid, msg) {
    for (const c of this.w.conns()) if (c.player.mode === 'surface' && c.player.planet === pid) c.send(msg);
  }

  snapshot(conn) {
    const me = conn.player;
    const inst = this.instances.get(me.planet);
    const players = [], parked = [];
    for (const oc of this.w.conns()) {
      const p = oc.player;
      if (p.parked?.planet === me.planet) parked.push({ name: p.name, key: p.key, x: p.parked.x, z: p.parked.z, rev: p.shipRev });
      if (oc === conn || p.mode !== 'surface' || p.planet !== me.planet) continue;
      const w = p.inv.items.find((i) => i.id === p.inv.equipped.weapon);
      players.push({ id: oc.id, name: p.name, key: p.key, color: p.color, x: p.px, y: p.py, z: p.pz, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, dead: !!p.dead, weapon: w?.type || null, armor: p.armor?.armor || 0 });
    }
    const creatures = inst ? [...inst.creatures.values()].map((c) => ({ id: c.id, sp: c.species, x: c.x, y: c.y, z: c.z, yaw: c.yaw, hp: c.hp, maxHp: c.maxHp, size: c.size, hostile: this.aggroRange(c, me) > 0 })) : [];
    return { players, creatures, parked };
  }
}
