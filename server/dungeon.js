// Dungeons: underground instances behind entrances on planet surfaces. A party shares one
// copy; a solo pilot gets their own. Monsters are placed by the generator and run by the
// server; each pilot can open each chest once; the boss chest opens when the boss is dead.

import { DUNGEON_THEMES } from '../shared/content/dungeons.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { CREATURES } from '../shared/content/creatures.js';
import { RELICS } from '../shared/content/relics.js';
import { generateDungeon, canStand, isFloor, lineOfSight, dungeonSeed, dungeonDepth } from '../shared/dungeon.js';
import { creatureStats } from '../shared/planet.js';
import { weaponStats, strike, randomItem, randomRelic, makeRelic, RUN_SPEED } from '../shared/items.js';

const EMPTY_RESET_MS = 2 * 60 * 1000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export class Dungeons {
  constructor(world) {
    this.w = world;
    this.instances = new Map();
  }

  instanceKey(planet, st, p) {
    const party = this.w.parties.of(p.key);
    return `${planet.id}#${st.id}#${party ? 'party:' + party.id : 'solo:' + p.key}`;
  }

  create(key, planet, st) {
    const def = STRUCTURES[st.type];
    const theme = DUNGEON_THEMES[def.dungeon];
    const seed = dungeonSeed(planet, st.id), depth = dungeonDepth(planet);
    const layout = generateDungeon(def.dungeon, seed, depth);
    const stId = st.id;
    const enemies = new Map();
    for (const e of layout.enemies) {
      const s = creatureStats(planet, e.species);
      const k = 1 + 0.25 * (depth - 1);
      const hp = Math.round(s.hp * k * (e.boss ? 1 : 1.2) * (this.w.director?.difficulty || 1));
      enemies.set(e.id, {
        id: e.id, species: e.species, x: e.x, z: e.z, home: [e.x, e.z], yaw: 0, hp, maxHp: hp,
        dmg: s.dmg * k, speed: s.speed * 0.9, size: s.size, boss: !!e.boss, aggro: false, lastAttack: 0, lastShot: 0,
      });
    }
    const inst = {
      key, planet, st, theme: def.dungeon, themeDef: theme, seed, depth, layout, enemies,
      opened: {}, bossDead: false, members: new Set(), emptySince: 0, stId,
    };
    this.instances.set(key, inst);
    return inst;
  }

  view(inst, p) {
    return {
      t: 'dungeon', key: inst.key, theme: inst.theme, name: inst.themeDef.name, seed: inst.seed, depth: inst.depth,
      opened: [...(inst.opened[p.key] || [])], bossDead: inst.bossDead,
    };
  }

  // Walk down the entrance: the whole party lands in the same dungeon.
  enter(conn, planet, st) {
    const p = conn.player;
    const key = this.instanceKey(planet, st, p);
    const inst = this.instances.get(key) || this.create(key, planet, st);
    inst.members.add(p.key);
    p.mode = 'dungeon';
    p.dungeon = key;
    p.dReturn = { planet: planet.id, x: st.x + st.radius + 4, z: st.z };
    [p.px, p.pz] = inst.layout.start;
    p.py = 0;
    p.lastPos = Date.now();
    conn.send(this.view(inst, p));
    conn.send({ t: 'teleport', mode: 'dungeon', x: p.px, y: 0, z: p.pz });
    this.w.discover(conn, [`structure:${st.type}`, `dungeon:${inst.theme}`]);
    conn.send({ t: 'chat', from: null, text: `${inst.themeDef.name} (depth ${inst.depth}): ${inst.themeDef.lore}` });
    this.w.sendSelf(conn);
  }

  leave(conn) {
    const p = conn.player;
    const inst = this.instances.get(p.dungeon);
    if (inst) inst.members.delete(p.key);
    const back = p.dReturn;
    p.dungeon = null;
    p.mode = 'surface';
    p.planet = back.planet;
    p.px = back.x; p.pz = back.z;
    p.py = this.w.surfaces.ground(back.planet, p.px, p.pz);
    p.lastPos = Date.now();
    conn.send(this.w.surfaces.state(back.planet, p));
    conn.send({ t: 'teleport', mode: 'surface', planet: back.planet, x: p.px, y: p.py, z: p.pz });
    this.w.sendSelf(conn);
  }

  dropped(conn) {
    const inst = this.instances.get(conn.player.dungeon);
    if (inst) inst.members.delete(conn.player.key);
  }

  inst(conn) {
    const p = conn.player;
    return p.mode === 'dungeon' ? this.instances.get(p.dungeon) : null;
  }

  walk(conn, m) {
    const inst = this.inst(conn), p = conn.player;
    if (!inst || p.dead || ![m.x, m.y, m.z, m.yaw].every(num)) return;
    const now = Date.now(), dt = Math.max(0.05, (now - p.lastPos) / 1000);
    if (Math.hypot(m.x - p.px, m.z - p.pz) > RUN_SPEED * dt * 1.5 + 3 || !isFloor(inst.layout, m.x, m.z)) {
      conn.send({ t: 'teleport', mode: 'dungeon', x: p.px, y: 0, z: p.pz });
      p.lastPos = now;
      return;
    }
    p.px = m.x; p.pz = m.z; p.py = Math.max(0, Math.min(m.y, 4)); p.yaw = m.yaw; p.lastPos = now;
  }

  shoot(conn, { dir }) {
    const inst = this.inst(conn), p = conn.player;
    if (!inst || p.dead || !Array.isArray(dir) || dir.length !== 3 || !dir.every(num)) return;
    const weapon = p.inv.items.find((i) => i.id === p.inv.equipped.weapon);
    if (!weapon) return conn.send({ t: 'toast', msg: 'No weapon equipped (Tab to open your gear).' });
    const ws = weaponStats(weapon);
    ws.damage *= 1 + (p.buffs?.damage || 0);
    const now = Date.now();
    if (now - (p.lastShot || 0) < (1000 / ws.rate) * 0.85) return;
    p.lastShot = now;
    const l = Math.hypot(...dir) || 1;
    if (ws.melee) {
      // Swords in the dungeon: an arc in front, every third swing a spin all round.
      p.combo = now - (p.lastSwing || 0) < 1100 ? (p.combo || 0) + 1 : 1;
      p.lastSwing = now;
      const skill = p.combo >= 3;
      if (skill) p.combo = 0;
      const hl = Math.hypot(dir[0], dir[2]) || 1, fwd = [dir[0] / hl, dir[2] / hl];
      const reach = ws.range * (skill ? 1.5 : 1), cosArc = skill ? -1 : Math.cos(ws.arc / 2);
      for (const e of [...inst.enemies.values()]) {
        const dx = e.x - p.px, dz = e.z - p.pz, dist = Math.hypot(dx, dz);
        if (dist > reach + e.size * 0.6 || (dist > 0.4 && (dx * fwd[0] + dz * fwd[1]) / dist < cosArc)) continue;
        this.blow(conn, inst, e, ws, ws.damage * (skill ? 2.2 : 1));
      }
      this.toInstance(inst, { t: 'slash', by: conn.id, x: p.px, y: p.py + 1.1, z: p.pz, dir: fwd, combo: skill ? 3 : p.combo, c: ws.color, reach });
      return;
    }
    const o = [p.px, p.py + 1.5, p.pz];
    const tracers = [];
    for (let i = 0; i < ws.pellets; i++) {
      const d = [dir[0] / l + (Math.random() - 0.5) * ws.spread * 2, dir[1] / l + (Math.random() - 0.5) * ws.spread * 2, dir[2] / l + (Math.random() - 0.5) * ws.spread * 2];
      const dl = Math.hypot(...d);
      d[0] /= dl; d[1] /= dl; d[2] /= dl;
      let maxT = ws.range;
      for (let t = 0.5; t < ws.range; t += 0.5) {
        const y = o[1] + d[1] * t;
        if (y < 0 || y > 7 || !isFloor(inst.layout, o[0] + d[0] * t, o[2] + d[2] * t)) { maxT = t; break; }
      }
      let best = null, bestT = maxT;
      for (const e of inst.enemies.values()) {
        const vx = e.x - o[0], vy = e.size * 0.9 - o[1], vz = e.z - o[2];
        const t = vx * d[0] + vy * d[1] + vz * d[2];
        if (t < 0 || t > bestT) continue;
        if (Math.hypot(vx - d[0] * t, vy - d[1] * t, vz - d[2] * t) < e.size + 0.5) { bestT = t; best = e; }
      }
      tracers.push([o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT]);
      if (best) this.blow(conn, inst, best, ws, ws.damage);
    }
    this.toInstance(inst, { t: 'shot', by: conn.id, from: o, to: tracers, c: ws.color, w: weapon.type });
  }

  blow(conn, inst, e, ws, base) {
    const p = conn.player, { dmg, crit } = strike(ws, base);
    this.hurtEnemy(inst, e, dmg, conn, crit);
    if (ws.drain && !p.dead && p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dmg * ws.drain);
  }

  hurtEnemy(inst, e, dmg, conn, crit = false) {
    e.hp -= dmg;
    e.aggro = true;
    // The whole room wakes up.
    for (const o of inst.enemies.values()) if (Math.hypot(o.x - e.x, o.z - e.z) < 18) o.aggro = true;
    this.toInstance(inst, { t: 'hit', id: e.id, x: e.x, y: e.size, z: e.z, dmg: Math.round(dmg), crit });
    if (e.hp > 0) return;
    inst.enemies.delete(e.id);
    this.toInstance(inst, { t: 'boom', x: e.x, y: e.size * 0.5, z: e.z, size: e.size * (e.boss ? 4 : 2), organic: true });
    this.w.discover(conn, [`creature:${e.species}`]);
    const p = conn.player, luck = 1 + (p.buffs?.luck || 0);
    const reward = Math.round((e.boss ? 400 : 18) * inst.depth * (this.w.director?.loot || 1));
    this.w.director?.record('kills');
    const crew = this.members(inst);
    for (const c of crew) {
      c.player.credits += Math.round(reward / crew.length);
      this.w.sendSelf(c);
    }
    if (!e.boss && Math.random() < 0.15 * luck) this.w.giveItem(conn, randomItem(inst.planet.richness + 1));
    if (e.boss) {
      inst.bossDead = true;
      for (const c of crew) { this.w.quests.onEvent(c, 'dungeon', { pid: inst.planet.id, st: inst.stId }); this.w.guild.onDungeon(c, inst.planet.id, inst.stId); }
      const name = CREATURES[e.species].name;
      this.toInstance(inst, { t: 'transmission', title: `${name.toUpperCase()} DEFEATED`, lines: [`${name} falls. The deepest chamber of the ${inst.themeDef.name} is open.`] });
      this.toInstance(inst, { t: 'boss', key: inst.key });
      this.w.broadcast({ t: 'chat', from: null, text: `${p.name}'s party defeated ${name} in the ${inst.themeDef.name}.` });
    }
  }

  hurtPlayer(conn, dmg, byName) {
    const p = conn.player;
    if (p.dead) return;
    const taken = dmg * (1 - (p.armor?.reduction || 0));
    p.hp -= taken;
    p.lastHurt = Date.now();
    const inst = this.inst(conn);
    if (inst) this.toInstance(inst, { t: 'hit', id: conn.id, x: p.px, y: 1.2, z: p.pz, dmg: Math.round(taken) });
    conn.send({ t: 'you', hp: p.hp });
    if (p.hp > 0) return;
    p.dead = true;
    conn.send({ t: 'died', by: byName, respawnIn: 3 });
    this.w.director?.record('deaths');
    setTimeout(() => {
      if (!this.w.conns().includes(conn) || p.mode !== 'dungeon') return;
      const i = this.inst(conn);
      p.dead = false;
      p.hp = p.maxHp;
      if (!i) return;
      [p.px, p.pz] = i.layout.start;
      conn.send({ t: 'teleport', mode: 'dungeon', x: p.px, y: 0, z: p.pz });
      this.w.sendSelf(conn);
    }, 3000);
  }

  interact(conn, { what, id }) {
    const inst = this.inst(conn), p = conn.player;
    if (!inst || p.dead) return;
    const near = (x, z, r) => Math.hypot(p.px - x, p.pz - z) <= r;
    if (what === 'exit') {
      if (near(...inst.layout.start, 6)) this.leave(conn);
      return;
    }
    if (what !== 'chest') return;
    const chest = inst.layout.chests.find((c) => c.id === id);
    if (!chest || !near(chest.x, chest.z, 4)) return;
    if (chest.boss && !inst.bossDead) return conn.send({ t: 'toast', msg: 'Sealed until the master of this place is dead.' });
    const opened = (inst.opened[p.key] ||= new Set());
    if (opened.has(id)) return conn.send({ t: 'toast', msg: 'You already emptied this chest.' });
    opened.add(id);
    const luck = 1 + (p.buffs?.luck || 0), rich = inst.planet.richness;
    const credits = Math.round((chest.boss ? 600 : 120) * inst.depth * (0.7 + Math.random() * 0.6));
    p.credits += credits;
    conn.send({ t: 'toast', msg: `Opened a chest: +${credits} cr` });
    if (Math.random() < (chest.boss ? 1 : 0.6) * luck) this.w.giveItem(conn, randomItem(rich + (chest.boss ? 3 : 1)));
    const relicChance = (chest.boss ? 0.75 : 0.1) * luck;
    if (Math.random() < relicChance) {
      const pool = inst.themeDef.relics.filter((r) => RELICS[r]);
      this.w.giveItem(conn, Math.random() < 0.7 ? makeRelic(pool[Math.floor(Math.random() * pool.length)]) : randomRelic());
    }
    conn.send({ t: 'chest', id });
    this.w.sendSelf(conn);
  }

  members(inst) {
    return [...inst.members].map((k) => this.w.connByName(k)).filter((c) => c && c.player.dungeon === inst.key);
  }

  toInstance(inst, msg) {
    for (const c of this.members(inst)) c.send(msg);
  }

  tick(dt, now) {
    for (const [key, inst] of this.instances) {
      const crew = this.members(inst);
      if (!crew.length) {
        inst.emptySince ||= now;
        if (now - inst.emptySince > EMPTY_RESET_MS) this.instances.delete(key);
        continue;
      }
      inst.emptySince = 0;
      for (const c of crew) {
        const p = c.player;
        const regen = p.buffs?.regen || 0;
        if (!p.dead && p.hp < p.maxHp && (now - (p.lastHurt || 0) > 8000 || regen)) {
          p.hp = Math.min(p.maxHp, p.hp + ((now - (p.lastHurt || 0) > 8000 ? 3 : 0) + regen) * dt);
          if (Math.random() < 0.1) c.send({ t: 'you', hp: p.hp });
        }
      }
      this.enemyTick(inst, crew, dt, now);
    }
  }

  enemyTick(inst, crew, dt, now) {
    const d = inst.layout;
    for (const e of inst.enemies.values()) {
      let target = null, best = Infinity;
      for (const c of crew) {
        const p = c.player;
        if (p.dead) continue;
        const dist = Math.hypot(p.px - e.x, p.pz - e.z);
        const sees = dist < (e.aggro ? 40 : 16) && lineOfSight(d, e.x, e.z, p.px, p.pz);
        if (sees && dist < best) { best = dist; target = c; }
      }
      if (!target) continue;
      e.aggro = true;
      const p = target.player;
      const reach = 1.4 + e.size;
      if (best > reach) {
        const dx = p.px - e.x, dz = p.pz - e.z, l = Math.hypot(dx, dz) || 1;
        const step = Math.min(best - reach, e.speed * dt);
        const nx = e.x + (dx / l) * step, nz = e.z + (dz / l) * step, r = Math.min(1.6, e.size * 0.6);
        if (canStand(d, nx, e.z, r)) e.x = nx;
        if (canStand(d, e.x, nz, r)) e.z = nz;
      } else if (now - e.lastAttack > 1100) {
        e.lastAttack = now;
        this.hurtPlayer(target, e.dmg, CREATURES[e.species].name);
      }
      e.yaw = Math.atan2(p.px - e.x, p.pz - e.z);
      // Bosses also strike from range.
      if (e.boss && best > reach && best < 30 && now - e.lastShot > 2200) {
        e.lastShot = now;
        this.toInstance(inst, { t: 'shot', by: e.id, from: [e.x, e.size * 1.5, e.z], to: [[p.px, 1.2, p.pz]], c: DUNGEON_THEMES[inst.theme].light });
        if (Math.random() < 0.75) this.hurtPlayer(target, e.dmg * 0.7, CREATURES[e.species].name);
      }
    }
  }

  snapshot(conn) {
    const inst = this.inst(conn);
    if (!inst) return { players: [], creatures: [] };
    const players = [];
    for (const c of this.members(inst)) {
      if (c === conn) continue;
      const p = c.player;
      players.push({ id: c.id, name: p.name, key: p.key, color: p.color, x: p.px, y: p.py, z: p.pz, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, dead: !!p.dead, armor: p.armor?.armor || 0 });
    }
    const creatures = [...inst.enemies.values()].map((e) => ({ id: e.id, sp: e.species, x: e.x, y: 0, z: e.z, yaw: e.yaw, hp: e.hp, maxHp: e.maxHp, size: e.size, boss: e.boss, hostile: true }));
    return { players, creatures };
  }
}
