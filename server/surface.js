// Planet surfaces: pilots on foot walk, dig, build, fight creatures (and each other away from
// Haven), find relics, and take off again. One instance per planet that has someone on it.

import { findPlanet, planetPos, generateSector } from '../shared/universe.js';
import {
  CELL, SURFACE_HALF, MAX_DIG, SETTLEMENT, SETTLEMENT_RADIUS,
  standHeight, heightAt, deposits, digOre, landingSpot, vkey, terrainOf, faunaOf, structuresOf, creatureStats, profileOf,
} from '../shared/planet.js';
import { BLOCKS, SURFACE_GRID, canAfford, cargoTotal } from '../shared/rules.js';
import { weaponStats, strike, armorRating, randomItem, randomRelic, makeRelic, godBlessing, PLAYER_HP, RUN_SPEED } from '../shared/items.js';
import { CREATURES } from '../shared/content/creatures.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { GODS, PRAYER } from '../shared/content/factions.js';
import { RELICS } from '../shared/content/relics.js';
import { ALIEN_RACES, alienFolk, alienWarrior } from '../shared/content/aliens.js';
import { townsOf, weatherAt, weatherInfo } from '../shared/towns.js';
import { blockAllowed } from '../shared/rules.js';
import { floraFor } from '../shared/planet.js';
import { skillBonus } from '../shared/powers.js';
import { rankOf } from '../shared/guild.js';
import { Natives } from './natives.js';
import { mechStats } from '../shared/powers.js';

const GUARD_RESPAWN_MS = 5 * 60 * 1000;
// Reputation change for killing a faction's soldier.
const SOLDIER_KILL_REP = { empire: { empire: -8, rebellion: 5 }, rebellion: { rebellion: -8, empire: 5 } };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
let nextId = 1;

export class Surfaces {
  constructor(world) {
    this.w = world;
    this.instances = new Map();   // planetId -> { planet, creatures: Map }
    this.natives = new Natives(this);
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
      this.natives.setup(inst);
      this.w.politics.state(pid);
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
      ...inst.structures.filter((st) => st.race).map((st) => `race:${st.race}`),
      ...townsOf(planet).map((t) => `people:${t.people}`),
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
    if (Math.hypot(m.x - p.px, m.z - p.pz) > RUN_SPEED * this.w.powers.speedMult(p) * dt * 1.5 + 3 || Math.max(Math.abs(m.x), Math.abs(m.z)) > SURFACE_HALF) {
      conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
      p.lastPos = now;
      return;
    }
    const g = this.ground(p.planet, m.x, m.z);
    p.px = m.x; p.pz = m.z; p.py = Math.max(g - 0.5, Math.min(m.y, g + (this.w.powers.flying(p) ? 160 : 40)));
    p.yaw = m.yaw;
    p.lastPos = now;
  }

  // What a ray from o along d hits first within range: terrain, a creature or (off Haven) a pilot.
  trace(inst, conn, o, d, range) {
    const p = conn.player, digs = this.saved(inst.planet.id).digs;
    let maxT = range;
    for (let t = 2; t < range; t += 2) {
      if (o[1] + d[1] * t < heightAt(inst.planet, o[0] + d[0] * t, o[2] + d[2] * t, digs)) { maxT = t; break; }
    }
    let best = null, bestT = maxT;
    const test = (cx, cy, cz, r, target) => {
      const vx = cx - o[0], vy = cy - o[1], vz = cz - o[2];
      const t = vx * d[0] + vy * d[1] + vz * d[2];
      if (t < 0 || t > bestT) return;
      if (Math.hypot(vx - d[0] * t, vy - d[1] * t, vz - d[2] * t) < r) { bestT = t; best = target; }
    };
    for (const c of inst.creatures.values()) test(c.x, c.y + c.size * 0.8, c.z, c.size + 0.4, { creature: c });
    if (!inst.planet.starter) {
      for (const oc of this.w.conns()) {
        const q = oc.player;
        if (oc === conn || q.mode !== 'surface' || q.planet !== p.planet || q.dead || this.w.parties.sameParty(p.key, q.key)) continue;
        test(q.px, q.py + 1, q.pz, q.inMech ? 2.4 : 0.9, { conn: oc });
      }
    }
    return { ...(best || {}), point: [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT] };
  }

  shoot(conn, { dir }) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead || !Array.isArray(dir) || dir.length !== 3 || !dir.every(num)) return;
    if (p.wolf) return this.w.powers.claw(conn);
    const pw = this.w.powers;
    const now = Date.now();
    const inst = this.instance(p.planet);
    const l = Math.hypot(...dir) || 1;
    const d0 = [dir[0] / l, dir[1] / l, dir[2] / l];
    // A mech fires its shoulder cannon: one heavy shell that bursts on impact.
    if (p.inMech) {
      const mech = pw.mechItem(p);
      if (!mech) { p.inMech = false; return; }
      const ms = mechStats(mech.tier);
      if (now - (p.lastShot || 0) < 1000 / ms.rate * 0.85) return;
      p.lastShot = now;
      const o = [p.px, p.py + 4.2, p.pz];
      const hit = this.trace(inst, conn, o, d0, ms.range);
      this.toPlanet(p.planet, { t: 'shot', by: conn.id, from: o, to: [hit.point], c: '#ffb060', w: 'cannon' });
      this.toPlanet(p.planet, { t: 'boom', x: hit.point[0], y: hit.point[1], z: hit.point[2], size: ms.splash });
      const dmg = ms.damage * pw.damageMult(p);
      for (const c of [...inst.creatures.values()]) {
        const dd = Math.hypot(c.x - hit.point[0], c.y + 1 - hit.point[1], c.z - hit.point[2]);
        if (dd < ms.splash + c.size) this.hurtCreature(inst, c, dmg * (1 - dd / (ms.splash + c.size) * 0.5), conn);
      }
      if (hit.conn) this.hurtPlayer(hit.conn, dmg * 0.6, p.name);
      return;
    }
    const weapon = p.inv.items.find((i) => i.id === p.inv.equipped.weapon);
    if (!weapon) return conn.send({ t: 'toast', msg: 'No weapon equipped (Tab to open your gear).' });
    const ws = weaponStats(weapon);
    ws.damage *= pw.damageMult(p);
    if (now - (p.lastShot || 0) < 1000 / ws.rate * 0.85) return;
    p.lastShot = now;
    if (ws.melee) return this.swing(conn, inst, d0, ws, now);
    const o = [p.px, p.py + 1.5, p.pz];
    const tracers = [];
    for (let i = 0; i < ws.pellets; i++) {
      const d = [d0[0] + (Math.random() - 0.5) * ws.spread * 2, d0[1] + (Math.random() - 0.5) * ws.spread * 2, d0[2] + (Math.random() - 0.5) * ws.spread * 2];
      const dl = Math.hypot(...d);
      d[0] /= dl; d[1] /= dl; d[2] /= dl;
      const hit = this.trace(inst, conn, o, d, ws.range);
      tracers.push(hit.point);
      if (hit.creature || hit.conn) this.blow(conn, inst, hit, ws, ws.damage);
    }
    this.toPlanet(p.planet, { t: 'shot', by: conn.id, from: o, to: tracers, c: ws.color, w: weapon.type });
  }

  // Everyone (creatures, and players off safe worlds) a sword reaches: within reach, inside the
  // arc in front (cosArc -1 is all round), at about the same height.
  inReach(inst, conn, at, fwd, reach, cosArc) {
    const p = conn.player, out = [];
    for (const c of inst.creatures.values()) {
      const dx = c.x - at[0], dz = c.z - at[2], dist = Math.hypot(dx, dz);
      if (dist > reach + c.size * 0.6 || Math.abs(c.y + c.size * 0.5 - at[1]) > 2.5 + c.size) continue;
      if (dist > 0.4 && (dx * fwd[0] + dz * fwd[1]) / dist < cosArc) continue;
      out.push({ creature: c });
    }
    if (!inst.planet.starter) {
      for (const oc of this.w.conns()) {
        const q = oc.player;
        if (oc === conn || q.mode !== 'surface' || q.planet !== p.planet || q.dead || this.w.parties.sameParty(p.key, q.key)) continue;
        const dx = q.px - at[0], dz = q.pz - at[2], dist = Math.hypot(dx, dz);
        if (dist > reach + 0.6 || Math.abs(q.py + 1 - at[1]) > 2.5) continue;
        if (dist > 0.4 && (dx * fwd[0] + dz * fwd[1]) / dist < cosArc) continue;
        out.push({ conn: oc });
      }
    }
    return out;
  }

  // A sword swing. Swings in quick succession build a combo; the third is a sword skill: a
  // glowing spin that strikes all around for double damage and more.
  swing(conn, inst, d0, ws, now) {
    const p = conn.player;
    p.combo = now - (p.lastSwing || 0) < 1100 ? (p.combo || 0) + 1 : 1;
    p.lastSwing = now;
    const skill = p.combo >= 3;
    if (skill) p.combo = 0;
    const hl = Math.hypot(d0[0], d0[2]) || 1, fwd = [d0[0] / hl, d0[2] / hl];
    const at = [p.px, p.py + 1, p.pz];
    const dmg = ws.damage * (skill ? 2.2 : 1);
    for (const t of this.inReach(inst, conn, at, fwd, ws.range * (skill ? 1.5 : 1), skill ? -1 : Math.cos(ws.arc / 2))) this.blow(conn, inst, t, ws, dmg);
    this.toPlanet(p.planet, { t: 'slash', by: conn.id, x: p.px, y: p.py + 1.1, z: p.pz, dir: fwd, combo: skill ? 3 : p.combo, c: ws.color, reach: ws.range * (skill ? 1.5 : 1) });
  }

  // Vorpal Strike: with a sword in hand, lunge forward, running through everything in the way.
  swordSkill(conn, { dir }) {
    const p = conn.player, now = Date.now();
    if (p.mode !== 'surface' || p.dead || !Array.isArray(dir) || dir.length !== 3 || !dir.every(num)) return;
    const weapon = p.inv.items.find((i) => i.id === p.inv.equipped.weapon);
    const ws = weapon && weaponStats(weapon);
    if (!ws?.melee) return conn.send({ t: 'toast', msg: 'Sword skills need a sword (an energy blade or greatsword).' });
    if (now - (p.skillAt || 0) < 5000) return conn.send({ t: 'toast', msg: 'Sword skill recharging…' });
    p.skillAt = now;
    const inst = this.instance(p.planet);
    const hl = Math.hypot(dir[0], dir[2]) || 1, fwd = [dir[0] / hl, dir[2] / hl];
    const from = [p.px, p.py + 1, p.pz], dist = 8, lim = SURFACE_HALF - 5;
    const dmg = ws.damage * 3 * this.w.powers.damageMult(p);
    for (let s = 1; s <= 4; s++) {
      const at = [p.px + fwd[0] * dist * s / 4, p.py + 1, p.pz + fwd[1] * dist * s / 4];
      for (const t of this.inReach(inst, conn, at, fwd, 1.8, -1)) {
        const id = t.creature ? t.creature.id : t.conn.id;
        if ((p.vorpalHit ||= new Set()).has(id)) continue;
        p.vorpalHit.add(id);
        this.blow(conn, inst, t, ws, dmg);
      }
    }
    p.vorpalHit = null;
    p.px = Math.max(-lim, Math.min(lim, p.px + fwd[0] * dist));
    p.pz = Math.max(-lim, Math.min(lim, p.pz + fwd[1] * dist));
    p.py = this.ground(p.planet, p.px, p.pz);
    p.lastPos = now;
    this.toPlanet(p.planet, { t: 'slash', by: conn.id, x: from[0], y: from[1], z: from[2], to: [p.px, p.py + 1, p.pz], dir: fwd, combo: 'vorpal', c: ws.color, reach: dist });
    conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
  }

  // A weapon blow on a creature or player: may crit, and life drain heals the attacker.
  blow(conn, inst, t, ws, base) {
    const p = conn.player, { dmg, crit } = strike(ws, base);
    if (t.creature) this.hurtCreature(inst, t.creature, dmg, conn, crit);
    else this.hurtPlayer(t.conn, dmg, p.name, crit);
    this.w.powers.dealt(conn, dmg);
    if (ws.drain && !p.dead) p.hp = Math.min(p.maxHp, p.hp + dmg * ws.drain);
  }

  hurtCreature(inst, c, dmg, conn, crit = false) {
    c.hp -= dmg;
    c.aggro = conn.player.key;
    // Hurting one of a town's people brings its armed folk running.
    if (c.behavior === 'native' && !c.raider) {
      for (const o of inst.creatures.values()) if (o.town === c.town && !o.raider && o.armed && Math.hypot(o.x - c.x, o.z - c.z) < 70) o.aggro = conn.player.key;
    }
    // Attacking one soldier makes the whole squad turn on you.
    if (c.faction) for (const o of inst.creatures.values()) if (o.faction === c.faction && Math.hypot(o.x - c.x, o.z - c.z) < 60) o.aggro = conn.player.key;
    this.toPlanet(inst.planet.id, { t: 'hit', id: c.id, x: c.x, y: c.y + c.size, z: c.z, dmg: Math.round(dmg), crit });
    if (c.hp > 0) return;
    inst.creatures.delete(c.id);
    this.toPlanet(inst.planet.id, { t: 'boom', x: c.x, y: c.y + c.size * 0.5, z: c.z, size: c.size * 2, organic: !c.faction && c.shape !== 'golem' });
    this.w.quests.onKill(conn, inst.planet.id, c);
    this.w.guild.onKill(conn, inst.planet.id, c);
    this.w.director?.record('kills');
    this.w.powers.gain(conn, 'combat', Math.max(2, Math.round(c.maxHp / 25)));
    if (c.behavior === 'native') {
      if (c.npc) inst.natives.delete(c.npc);
      this.w.politics.npcKilled(conn, inst.planet.id, c);
      if (!c.raider) return;
      conn.player.credits += Math.round(30 * inst.planet.richness);
      if (Math.random() < 0.3) this.w.giveItem(conn, randomItem(inst.planet.richness));
      this.w.sendSelf(conn);
      return;
    }
    this.w.discover(conn, [`creature:${c.species}`]);
    if (!c.faction && c.shape !== 'golem' && Math.random() < 0.6) { conn.player.cargo.hide = (conn.player.cargo.hide || 0) + 1 + Math.floor(c.size); }
    if (c.faction) {
      this.w.changeRep(conn, SOLDIER_KILL_REP[c.faction]);
      this.w.warScore(c.faction === 'empire' ? 'rebellion' : 'empire');
    }
    const luck = 1 + (conn.player.buffs?.luck || 0);
    if (c.guard && Math.random() < 0.15 * luck) this.w.giveItem(conn, randomRelic());
    const reward = Math.round((inst.planet.starter ? 3 : c.guard || c.faction ? 25 : 8) * inst.planet.richness * (this.w.director?.loot || 1));
    const crew = this.w.parties.nearbyMembers(conn.player);
    for (const p of crew) {
      p.credits += Math.max(1, Math.round(reward / crew.length));
      const pc = this.w.connByName(p.key);
      if (pc) this.w.sendSelf(pc);
    }
    if (Math.random() < (inst.planet.starter ? 0.08 : 0.25) * luck) this.w.giveItem(conn, randomItem(inst.planet.richness));
  }

  hurtPlayer(conn, dmg, byName, crit = false) {
    const p = conn.player;
    if (p.dead) return;
    dmg = this.w.powers.absorb(conn, dmg);
    if (dmg <= 0 && p.hp > 0) return;
    const taken = dmg * (1 - (p.armor?.reduction || 0));
    p.hp -= taken;
    p.lastHurt = Date.now();
    this.toPlanet(p.planet, { t: 'hit', id: conn.id, x: p.px, y: p.py + 1.2, z: p.pz, dmg: Math.round(taken), crit });
    conn.send({ t: 'you', hp: p.hp });
    if (p.hp > 0) return;
    p.dead = true;
    this.w.director?.record('deaths');
    this.w.broadcast({ t: 'chat', from: null, text: `${p.name} was taken down by ${byName}.` });
    conn.send({ t: 'died', by: byName, respawnIn: 3 });
    setTimeout(() => {
      if (!this.w.conns().includes(conn) || p.mode !== 'surface') return;
      p.dead = false;
      p.hp = p.maxHp;
      const park = p.parked, bed = this.w.bases.bedSpot(p, p.planet);
      if (bed) [p.px, p.pz] = bed; else { p.px = park.x + 9; p.pz = park.z + 3; }
      p.py = this.ground(p.planet, p.px, p.pz);
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
    const claim = this.w.bases.claimedBy(p.planet, x, z, p);
    if (claim) return conn.send({ t: 'toast', msg: `This land is claimed by ${claim}.` });
    // Chopping: digging at a tree yields wood and leaves the tree standing.
    if (!raise && this.nearTree(inst.planet, x, z)) {
      if (cargoTotal(p.cargo) >= p.stats.cargo) return conn.send({ t: 'toast', msg: 'Cargo hold full.' });
      const n = p.powerOn && p.power === 'titan' ? 3 : 1;
      p.cargo.wood = (p.cargo.wood || 0) + n;
      this.w.powers.gain(conn, 'mining', 1);
      this.w.dirty = true;
      return this.w.sendSelf(conn);
    }
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
      // Stone comes up with everything; deep digs on the right worlds turn up rare materials.
      const tags = profileOf(inst.planet).tags, deep = cur < -6;
      if (Math.random() < 0.35) p.cargo.stone = (p.cargo.stone || 0) + 1;
      if (tags.some((t) => ['crystal', 'holy'].includes(t)) && Math.random() < 0.06) p.cargo.crystal = (p.cargo.crystal || 0) + 1;
      if (tags.some((t) => ['ash', 'bone', 'scorched'].includes(t)) && Math.random() < 0.08) p.cargo.silver = (p.cargo.silver || 0) + 1;
      if (deep && tags.some((t) => ['rock', 'crystal', 'fire'].includes(t)) && Math.random() < 0.05) p.cargo.mithril = (p.cargo.mithril || 0) + 1;
      if (p.powerOn && p.power === 'titan') n *= 3;
      if (this.w.director?.bonanza()) n *= 2;
      if (Math.random() < skillBonus(p.skills, 'mining')) n += 1;
      p.cargo[ore] = (p.cargo[ore] || 0) + n;
      p.dug = (p.dug || 0) + n;
      this.w.powers.gain(conn, 'mining', 1);
      this.w.tutorial(conn, 'dig', n);
    }
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.toPlanet(p.planet, { t: 'dig', planet: p.planet, k, d: s.digs[k] });
  }

  nearTree(planet, x, z) {
    const tx = Math.floor(x / 40), tz = Math.floor(z / 40);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const f of floraFor(planet, tx + dx, tz + dz)) {
        if ((f.kind === 'tree' || f.kind === 'palm' || f.kind === 'deadtree') && Math.hypot(f.x - x, f.z - z) < 2.6 * f.s) return true;
      }
    }
    return false;
  }

  build(conn, { gx, gy, gz, block }) {
    const p = conn.player;
    const def = BLOCKS[block];
    if (p.mode !== 'surface' || !def || !blockAllowed(block, 'surface') || ![gx, gy, gz].every(Number.isInteger)) return;
    const cx = (gx + 0.5) * SURFACE_GRID, cy = (gy + 0.5) * SURFACE_GRID, cz = (gz + 0.5) * SURFACE_GRID;
    if (Math.hypot(cx - p.px, cy - p.py, cz - p.pz) > 14) return conn.send({ t: 'toast', msg: 'Too far away to build there.' });
    const inst = this.instance(p.planet);
    if (inst.planet.starter && Math.hypot(cx, cz) < SETTLEMENT_RADIUS) return conn.send({ t: 'toast', msg: 'No building inside Haven Landing.' });
    const s = this.saved(p.planet), cell = `${gx},${gy},${gz}`;
    if (s.blocks[cell] || Object.keys(s.blocks).length > 20000) return;
    const claim = this.w.bases.claimedBy(p.planet, cx, cz, p);
    if (claim) return conn.send({ t: 'toast', msg: `This land is claimed by ${claim}.` });
    if (inst.towns?.some((t) => Math.hypot(t.x - cx, t.z - cz) < t.radius + 6)) return conn.send({ t: 'toast', msg: 'The townsfolk won\'t let you build inside their town.' });
    if (!canAfford(p.cargo, def.cost)) return conn.send({ t: 'toast', msg: `Not enough materials for ${def.name}.` });
    for (const [k, v] of Object.entries(def.cost)) p.cargo[k] -= v;
    s.blocks[cell] = { b: block, o: p.name };
    this.w.bases.placedOnSurface(conn, p.planet, cell, s.blocks[cell]);
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
    this.w.bases.removedFromSurface(conn, p.planet, cell, blk);
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
    if (what === 'guild') return this.w.guild.open(conn);
    if (what === 'spire') return this.w.tower.open(conn);
    if (what === 'npc') {
      const c = inst.creatures.get(id);
      if (!c || c.behavior !== 'native' || !near(c.x, c.z, 6)) return;
      return this.w.talk.open(conn, inst, c);
    }
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
    if (def.kind === 'village') return this.visitVillage(conn, inst, st);
    if (def.kind === 'dungeon') return this.w.dungeons.enter(conn, inst.planet, st);
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
    this.w.quests.onEvent(conn, 'search', { pid: inst.planet.id, st: st.id });
    this.w.dirty = true;
    this.w.sendSelf(conn);
  }

  // Friendly and neutral aliens trade; hostile ones attack anyone who walks in.
  visitVillage(conn, inst, st) {
    const race = ALIEN_RACES[st.race];
    this.w.discover(conn, [`race:${st.race}`]);
    if (race.disposition === 'hostile' || !race.trader) {
      for (const c of inst.creatures.values()) if (c.guard === st.id) c.aggro = conn.player.key;
      return conn.send({ t: 'toast', msg: `The ${race.name} will not trade with you.` });
    }
    this.w.openShop(conn, `alien:${st.race}`, inst.planet.richness + 2, `${race.trader} · ${race.name} village`, { planet: inst.planet.id, x: st.x, z: st.z });
  }

  pray(conn, st) {
    const p = conn.player, god = GODS[st.god], now = Date.now();
    const wait = PRAYER.cooldownMinutes * 60000 - (now - (p.lastPray || 0));
    if (wait > 0) return conn.send({ t: 'toast', msg: `The gods are not listening yet (${Math.ceil(wait / 60000)} min).` });
    p.lastPray = now;
    p.favor[st.god] = (p.favor[st.god] || 0) + 1;
    this.w.discover(conn, [`god:${st.god}`]);
    this.w.bless(conn, godBlessing(st.god), PRAYER.minutes);
    this.w.powers.favored(conn, st.god);
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
      // Blizzards, sandstorms and ashfall wear you down away from shelter.
      const inst0 = this.instances.get(p.planet);
      if (inst0 && !p.dead) {
        const wx = weatherInfo(weatherAt(inst0.planet, now / 1000));
        const sheltered = inst0.towns?.some((t) => Math.hypot(t.x - p.px, t.z - p.pz) < t.radius + 6) || (p.armor?.armor || 0) >= 25 || p.buffs?.exposure;
        if (wx.exposure && !sheltered) {
          p.hp -= wx.exposure * dt;
          p.lastHurt = now;
          if (Math.random() < 0.1) c.send({ t: 'you', hp: p.hp });
          if (p.hp <= 0) this.hurtPlayer(c, 1, wx.name.toLowerCase());
        }
      }
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
    const dif = this.w.director?.difficulty || 1;
    const c = {
      id, species, x, z, y: this.ground(inst.planet.id, x, z), yaw: 0, hp: def.hp * dif, maxHp: def.hp * dif, dmg: def.dmg * dif,
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
    this.natives.spawn(inst, conns, now);

    // Ruin guardians and faction soldiers turn out when someone comes near their structure.
    for (const st of inst.structures) {
      const def = STRUCTURES[st.type];
      // Alien villages turn out their villagers and warriors.
      const groups = st.race ? [[alienFolk(st.race), def.residents], [alienWarrior(st.race), def.warriors]] : [def.guardians || def.soldiers].filter(Boolean);
      if (!groups.length) continue;
      if (now - (inst.guardsAt[st.id] || 0) < GUARD_RESPAWN_MS) continue;
      if (!conns.some((c) => Math.hypot(c.player.px - st.x, c.player.pz - st.z) < st.radius + 70)) continue;
      inst.guardsAt[st.id] = now;
      for (const [species, count] of groups) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + Math.random();
          const x = st.x + Math.cos(a) * (st.radius + 4), z = st.z + Math.sin(a) * (st.radius + 4);
          this.newCreature(inst, species, x, z, { guard: st.id, home: [st.x, st.z], leash: st.radius + 45 });
        }
      }
    }

    const wild = [...inst.creatures.values()].filter((c) => !c.guard && !c.raider).length;
    const cap = Math.round(Math.min(18, conns.length * (planet.starter ? 3 : 5)) * (this.w.director?.spawns || 1));
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
    if (this.w.powers.veiled(p)) return 0;
    if (c.behavior === 'native') return this.natives.aggroRange(this.instance(p.planet), c, p);
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
      const native = c.behavior === 'native';
      const wolf = native && this.natives.wolf(inst, c);
      if ((c.slowUntil || 0) > now) speed *= 0.4;
      if (wolf) speed *= 1.6;
      // Armed natives with no pilot to fight take on raiders and their realm's enemies.
      const foe = native && !target ? this.natives.findFoe(inst, c) : null;
      if (target || foe) {
        tx = target ? target.player.px : foe.x; tz = target ? target.player.pz : foe.z;
        const dist = target ? best : Math.hypot(foe.x - c.x, foe.z - c.z);
        // Soldiers and armed natives shoot from range; everything else has to get close.
        const ranged = c.behavior === 'soldier' || (native && c.armed && !wolf && c.people !== 'vampire');
        const reach = ranged ? (c.behavior === 'soldier' ? 28 : 24) : 1.6 + c.size;
        if (dist < reach) {
          speed = ranged && dist > 12 ? speed * 0.4 : 0;
          if (now - c.lastAttack > (ranged ? 900 : 1100)) {
            c.lastAttack = now;
            const name = native ? c.name : CREATURES[c.species].name;
            const dmg = c.dmg * (wolf ? 1.6 : 1);
            if (ranged) {
              const to = target ? [target.player.px, target.player.py + 1.2, target.player.pz] : [foe.x, foe.y + 1.2, foe.z];
              this.toPlanet(inst.planet.id, { t: 'shot', by: c.id, from: [c.x, c.y + 1.5, c.z], to: [to], c: c.faction === 'empire' ? '#ffe08a' : native ? '#ffd08a' : '#ff6a4a' });
              if (Math.random() < 0.7) target ? this.hurtPlayer(target, dmg, name) : this.natives.hurtByNative(inst, foe, dmg, c);
            } else if (target) {
              this.hurtPlayer(target, dmg, name);
              // A vampire's bite feeds it.
              if (c.people === 'vampire') c.hp = Math.min(c.maxHp, c.hp + dmg * 0.5);
              if (native) this.w.powers?.bitten(target, c);
            } else this.natives.hurtByNative(inst, foe, dmg, c);
          }
        }
      } else if (c.guard && c.home && Math.hypot(c.x - c.home[0], c.z - c.home[1]) > 8) {
        [tx, tz] = c.home;
      } else {
        const base = c.home || [c.x, c.z];
        if (!c.wander || Math.hypot(c.wander[0] - c.x, c.wander[1] - c.z) < 3) {
          // Townsfolk potter about near their work; guards patrol wider.
          const r = c.behavior === 'native' ? (c.role === 'guard' ? 40 : c.role === 'merchant' || c.role === 'smith' || c.role === 'ruler' ? 6 : 18) : c.guard ? 30 : 50;
          c.wander = [base[0] + (Math.random() - 0.5) * r, base[1] + (Math.random() - 0.5) * r];
          if (c.behavior === 'native' && Math.random() < 0.5) c.idleUntil = now + 2000 + Math.random() * 6000;
        }
        if (c.idleUntil > now) speed = 0;
        [tx, tz] = c.wander;
        speed *= c.behavior === 'native' ? 0.4 : 0.35;
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
      players.push({ id: oc.id, name: p.name, key: p.key, color: p.color, x: p.px, y: p.py, z: p.pz, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, dead: !!p.dead, weapon: w?.type || null, armor: p.armor?.armor || 0, wolf: !!p.wolf, mech: p.inMech ? this.w.powers.mechItem(p)?.tier || 1 : 0, rank: p.guild ? rankOf(p.guild.merit) : null });
    }
    conn.seenNatives ||= new Set();
    const creatures = inst ? [...inst.creatures.values()].map((c) => {
      const o = { id: c.id, sp: c.species, x: c.x, y: c.y, z: c.z, yaw: c.yaw, hp: c.hp, maxHp: c.maxHp, size: c.size, hostile: this.aggroRange(c, me) > 0 };
      if (c.title) o.title = c.title;
      if (c.behavior === 'native') {
        if (!conn.seenNatives.has(c.id)) { conn.seenNatives.add(c.id); o.n = this.natives.describe(c); }
        if (this.natives.wolf(inst, c)) o.wolf = 1;
      }
      return o;
    }) : [];
    if (conn.seenNatives.size > 3000) conn.seenNatives.clear();
    return { players, creatures, parked };
  }
}
