// Space combat: blaster bolts, pirate and Hollow NPC ships, the Hive Mothership, damage,
// destruction, bounties and loot. All of it is decided here on the server.

import { generateSector, sectorOf, sectorKey, isSafe, territoryOf, SECTOR_SIZE } from '../shared/universe.js';
import { qRotate, forwardOf, segmentDistance, SHIP_BLOCK } from '../shared/rules.js';
import { randomItem, makeRelic } from '../shared/items.js';
import { eraScale } from '../shared/story.js';
import { ALIEN_RACES } from '../shared/content/aliens.js';

const BOLT_SPEED = 1500;
const BOLT_LIFE = 1.3;
const MAX_NPCS = 220;

export const NPC_KINDS = {
  pirate:     { name: 'Pirate',          hp: 80,  dmg: 4,  speed: 360, radius: 14, interval: 1.1, bounty: 40,  color: '#ff5a4a' },
  hollow:     { name: 'Hollow',          hp: 110, dmg: 5,  speed: 420, radius: 16, interval: 1.0, bounty: 60,  color: '#b0ff6a' },
  mothership: { name: 'Hive Mothership', hp: 6000, dmg: 16, speed: 0,  radius: 170, interval: 0.6, bounty: 6000, color: '#d06aff' },
  imperial:   { name: 'Imperial patrol', hp: 130, dmg: 5,  speed: 380, radius: 15, interval: 1.0, bounty: 70,  color: '#ffe08a', faction: 'empire', relic: 'imperialSeal' },
  alien:      { name: 'Alien ship',      hp: 120, dmg: 5,  speed: 410, radius: 15, interval: 1.0, bounty: 70,  color: '#6ad8c8' },
  rebel:      { name: 'Rebel raider',    hp: 100, dmg: 5,  speed: 430, radius: 14, interval: 0.9, bounty: 60,  color: '#ff6a4a', faction: 'rebellion', relic: 'martyrsBadge' },
};

// Who fights whom among the NPCs: the Empire and the rebels are at war, the Empire polices
// pirates, and the Hollow attack everyone.
const ENEMIES = {
  imperial: ['rebel', 'pirate', 'hollow'],
  rebel: ['imperial', 'hollow'],
  pirate: ['imperial'],
  hollow: ['imperial', 'rebel'],
  mothership: ['imperial', 'rebel'],
};
const enemies = (a, b) => ENEMIES[a]?.includes(b);

// Reputation for destroying each kind of ship.
const KILL_REP = {
  imperial: { empire: -10, rebellion: 6 },
  rebel: { rebellion: -10, empire: 6 },
  pirate: { empire: 2, rebellion: 1 },
  hollow: { empire: 3, rebellion: 3 },
};

let nextId = 1;

export class Combat {
  constructor(world) {
    this.w = world;
    this.npcs = new Map();
    this.bolts = [];
    this.pendingBolts = [];
    this.lastSpawn = 0;
  }

  // ---- players firing -----------------------------------------------------------------------

  fire(conn) {
    const p = conn.player;
    if (p.mode !== 'space' || p.dead) return;
    const now = Date.now();
    const st = p.stats;
    if (!st.guns || now - p.lastFire < st.gunInterval * 1000 * 0.9) return;
    p.lastFire = now;
    const f = forwardOf(p.q);
    let n = 0;
    for (const [x, y, z, t] of p.ship) {
      if (t !== 'gun' || n++ >= 8) continue;
      const [ox, oy, oz] = qRotate(p.q, [x * SHIP_BLOCK, y * SHIP_BLOCK, (z - 1) * SHIP_BLOCK]);
      this.spawnBolt({
        owner: 'p:' + conn.id, ownerKey: p.key, x: p.x + ox, y: p.y + oy, z: p.z + oz,
        vx: f[0] * BOLT_SPEED + p.vx, vy: f[1] * BOLT_SPEED + p.vy, vz: f[2] * BOLT_SPEED + p.vz,
        dmg: st.gunDamage, color: '#ffd36a',
      });
    }
  }

  spawnBolt(b) {
    b.id = nextId++;
    b.life = b.life || BOLT_LIFE;
    this.bolts.push(b);
    this.pendingBolts.push(b);
  }

  // ---- NPCs ---------------------------------------------------------------------------------

  spawnNpc(kind, x, y, z, richness, extra = {}) {
    if (this.npcs.size >= MAX_NPCS) return null;
    const def = NPC_KINDS[kind];
    const eff = this.w.story.effects();
    const k = kind === 'mothership' ? 1 : (0.7 + 0.3 * richness) * (kind === 'hollow' ? eraScale(eff.era) : 1);
    const hp = kind === 'mothership' ? this.w.story.mothership().hp : Math.round(def.hp * k);
    const npc = {
      id: 'n' + nextId++, kind, x, y, z, vx: 0, vy: 0, vz: 0, f: [0, 0, -1],
      hp, maxHp: kind === 'mothership' ? this.w.story.mothership().maxHp : hp,
      dmg: def.dmg * k, speed: def.speed * (0.9 + Math.random() * 0.2), radius: def.radius,
      richness, lastFire: 0, lastNear: Date.now(), home: [x, y, z], wander: null, damagers: new Set(),
      faction: def.faction || null, aggro: new Set(), ...extra,
    };
    this.npcs.set(npc.id, npc);
    return npc;
  }

  spawnTick(now) {
    if (now - this.lastSpawn < 2000) return;
    this.lastSpawn = now;
    const eff = this.w.story.effects();
    const space = this.w.players().filter((p) => p.mode === 'space' && !p.dead);

    for (const p of space) {
      const [sx, sz] = sectorOf(p.x, p.z);
      const safe = isSafe(sx, sz);
      const rich = generateSector(sx, sz, this.w.seed).region.richness;
      const near = { pirate: 0, hollow: 0, imperial: 0, rebel: 0, alien: 0 };
      for (const n of this.npcs.values()) {
        if (Math.hypot(n.x - p.x, n.z - p.z) > 6000) continue;
        if (n.kind in near) near[n.kind]++;
      }
      const territory = territoryOf(sx, sz, this.w.seed);
      const lawful = territory === 'empire' || territory === 'capital';
      if (!safe && !lawful && near.pirate < Math.min(5, 1 + Math.floor(rich / 2)) && Math.random() < (territory === 'wilds' ? 0.22 : 0.08)) {
        this.spawnGroup('pirate', p, 1 + Math.floor(Math.random() * 3), rich);
      }
      // Imperial patrols in imperial space (a strong guard at the holy capital); rebel raiders
      // on the frontier, where the Empire pushes in too and the two sides fight.
      if (lawful && near.imperial < (territory === 'capital' ? 6 : 3) && Math.random() < 0.3) {
        this.spawnGroup('imperial', p, 1 + Math.floor(Math.random() * 3), territory === 'capital' ? rich + 4 : rich);
      }
      // Alien ships patrol the systems their race has claimed.
      const race = generateSector(sx, sz, this.w.seed).alien;
      if (race && near.alien < 3 && Math.random() < 0.25) this.spawnGroup('alien', p, 1 + Math.floor(Math.random() * 3), rich, { race });
      if (territory === 'rebellion') {
        if (near.rebel < 3 && Math.random() < 0.3) this.spawnGroup('rebel', p, 1 + Math.floor(Math.random() * 3), rich);
        if (near.imperial < 2 && Math.random() < 0.15) this.spawnGroup('imperial', p, 1 + Math.floor(Math.random() * 2), rich);
      }
      if (eff.invasion && near.hollow < (safe ? 2 : 4) && Math.random() < 0.3) {
        this.spawnGroup('hollow', p, 1 + Math.floor(Math.random() * (safe ? 2 : 3)), rich);
      }
    }

    // The Hive Mothership sits at its sector while that part of the story is live.
    const mother = [...this.npcs.values()].find((n) => n.kind === 'mothership');
    if (eff.mothership && !mother) {
      const m = this.w.story.mothership();
      this.spawnNpc('mothership', (m.sx + 0.5) * SECTOR_SIZE, generateSector(m.sx, m.sz, this.w.seed).oy + 250, (m.sz + 0.5) * SECTOR_SIZE, 1);
    } else if (!eff.mothership && mother) {
      this.npcs.delete(mother.id);
    }

    // Despawn ships nobody is near.
    for (const n of this.npcs.values()) {
      if (n.kind === 'mothership') continue;
      if (space.some((p) => Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) < 9000)) n.lastNear = now;
      else if (now - n.lastNear > 20000) this.npcs.delete(n.id);
    }
  }

  spawnGroup(kind, p, count, rich, extra) {
    const a = Math.random() * Math.PI * 2;
    const cx = p.x + Math.cos(a) * 2600, cz = p.z + Math.sin(a) * 2600, cy = p.y + (Math.random() - 0.5) * 600;
    for (let i = 0; i < count; i++) {
      this.spawnNpc(kind, cx + (Math.random() - 0.5) * 300, cy + (Math.random() - 0.5) * 200, cz + (Math.random() - 0.5) * 300, rich, extra);
    }
  }

  npcTick(dt, now) {
    const space = this.w.players().filter((p) => p.mode === 'space' && !p.dead);
    for (const n of this.npcs.values()) {
      const def = NPC_KINDS[n.kind];
      if (n.kind === 'mothership') { this.mothershipTick(n, space, now); continue; }
      let target = null, best = 3500;
      for (const p of space) {
        if (!this.hostileToPlayer(n, p)) continue;
        const d = Math.hypot(p.x - n.x, p.y - n.y, p.z - n.z);
        if (d < best) { best = d; target = p; }
      }
      for (const o of this.npcs.values()) {
        if (!enemies(n.kind, o.kind)) continue;
        const d = Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z);
        if (d < best) { best = d; target = o; }
      }
      let dx, dy, dz;
      if (target) {
        const tx = target.x - n.x, ty = target.y - n.y, tz = target.z - n.z, d = best || 1;
        if (d > 550) { dx = tx / d; dy = ty / d; dz = tz / d; }
        else if (d < 220) { dx = -tx / d; dy = -ty / d; dz = -tz / d; }
        else {
          // Orbit: sideways around the target, a different way for each ship.
          const s = n.id.charCodeAt(n.id.length - 1) % 2 ? 1 : -1;
          dx = (-tz / d) * s; dy = (ty / d) * 0.2; dz = (tx / d) * s;
        }
        if (d < 1150 && now - n.lastFire > def.interval * 1000) {
          n.lastFire = now + Math.random() * 300;
          const lead = d / BOLT_SPEED;
          const ax = target.x + target.vx * lead - n.x, ay = target.y + target.vy * lead - n.y, az = target.z + target.vz * lead - n.z;
          const al = Math.hypot(ax, ay, az) || 1, sp = 0.07;
          const ux = ax / al + (Math.random() - 0.5) * sp, uy = ay / al + (Math.random() - 0.5) * sp, uz = az / al + (Math.random() - 0.5) * sp;
          this.spawnBolt({ owner: n.id, npc: true, side: n.kind, faction: n.faction, race: n.race, targetKey: target.key || null, x: n.x, y: n.y, z: n.z, vx: ux * BOLT_SPEED, vy: uy * BOLT_SPEED, vz: uz * BOLT_SPEED, dmg: n.dmg, color: def.color });
        }
      } else {
        if (!n.wander || Math.hypot(n.wander[0] - n.x, n.wander[2] - n.z) < 100) {
          n.wander = [n.home[0] + (Math.random() - 0.5) * 1500, n.home[1] + (Math.random() - 0.5) * 300, n.home[2] + (Math.random() - 0.5) * 1500];
        }
        const tx = n.wander[0] - n.x, ty = n.wander[1] - n.y, tz = n.wander[2] - n.z, d = Math.hypot(tx, ty, tz) || 1;
        dx = (tx / d) * 0.4; dy = (ty / d) * 0.4; dz = (tz / d) * 0.4;
      }
      const k = Math.min(1, dt * 2);
      n.vx += (dx * n.speed - n.vx) * k; n.vy += (dy * n.speed - n.vy) * k; n.vz += (dz * n.speed - n.vz) * k;
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
      const sp = Math.hypot(n.vx, n.vy, n.vz);
      if (sp > 1) n.f = [n.vx / sp, n.vy / sp, n.vz / sp];
    }
  }

  // Pirates and the Hollow attack every pilot; faction ships only attack their enemies and
  // anyone who shot at them.
  hostileToPlayer(n, p) {
    if (n.kind === 'alien') return ALIEN_RACES[n.race]?.disposition === 'hostile' || n.aggro.has(p.key);
    if (!n.faction) return true;
    return this.w.hostileTo(n.faction, p) || n.aggro.has(p.key);
  }

  mothershipTick(n, space, now) {
    n.f = [Math.cos(now / 20000), 0, Math.sin(now / 20000)];
    const near = space.filter((p) => Math.hypot(p.x - n.x, p.y - n.y, p.z - n.z) < 2600)
      .sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z)).slice(0, 4);
    if (near.length && now - n.lastFire > 600) {
      n.lastFire = now;
      for (const t of near) {
        const a = Math.random() * Math.PI * 2;
        const ox = n.x + Math.cos(a) * 120, oy = n.y + (Math.random() - 0.5) * 60, oz = n.z + Math.sin(a) * 120;
        const tx = t.x - ox, ty = t.y - oy, tz = t.z - oz, d = Math.hypot(tx, ty, tz) || 1;
        this.spawnBolt({ owner: n.id, npc: true, side: 'mothership', x: ox, y: oy, z: oz, vx: (tx / d) * BOLT_SPEED * 0.8, vy: (ty / d) * BOLT_SPEED * 0.8, vz: (tz / d) * BOLT_SPEED * 0.8, dmg: n.dmg, color: '#d06aff', life: 2 });
      }
    }
    if (near.length && (!n.lastBrood || now - n.lastBrood > 15000)) {
      n.lastBrood = now;
      let escorts = 0;
      for (const o of this.npcs.values()) if (o.kind === 'hollow' && Math.hypot(o.x - n.x, o.z - n.z) < 3000) escorts++;
      for (let i = escorts; i < 6; i++) this.spawnNpc('hollow', n.x + (Math.random() - 0.5) * 500, n.y, n.z + (Math.random() - 0.5) * 500, 2);
    }
  }

  // ---- bolts and damage ---------------------------------------------------------------------

  pvpAllowed(a, b) {
    if (a === b || a.mode !== 'space' || b.mode !== 'space') return false;
    const [ax, az] = sectorOf(a.x, a.z), [bx, bz] = sectorOf(b.x, b.z);
    if (isSafe(ax, az) || isSafe(bx, bz)) return false;
    return !this.w.parties.sameParty(a.key, b.key);
  }

  boltTick(dt) {
    const players = this.w.conns();
    const hits = [];
    for (const b of this.bolts) {
      const a = [b.x, b.y, b.z];
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.life -= dt;
      const e = [b.x, b.y, b.z];
      let hit = null, bestT = 2;
      if (b.npc) {
        for (const c of players) {
          const p = c.player;
          if (p.mode !== 'space' || p.dead) continue;
          if (b.faction && !(this.w.hostileTo(b.faction, p) || b.targetKey === p.key)) continue;
          if (b.race && !(ALIEN_RACES[b.race].disposition === 'hostile' || b.targetKey === p.key)) continue;
          const [d, t] = segmentDistance(a, e, [p.x, p.y, p.z]);
          if (d < p.stats.radius && t < bestT) { bestT = t; hit = { conn: c }; }
        }
        for (const n of this.npcs.values()) {
          if (n.id === b.owner || !enemies(b.side, n.kind)) continue;
          const [d, t] = segmentDistance(a, e, [n.x, n.y, n.z]);
          if (d < n.radius && t < bestT) { bestT = t; hit = { npc: n }; }
        }
      } else {
        const owner = this.w.connById(b.owner.slice(2))?.player;
        for (const n of this.npcs.values()) {
          const [d, t] = segmentDistance(a, e, [n.x, n.y, n.z]);
          if (d < n.radius && t < bestT) { bestT = t; hit = { npc: n }; }
        }
        if (owner) {
          for (const c of players) {
            const p = c.player;
            if (p.dead || !this.pvpAllowed(owner, p)) continue;
            const [d, t] = segmentDistance(a, e, [p.x, p.y, p.z]);
            if (d < p.stats.radius && t < bestT) { bestT = t; hit = { conn: c }; }
          }
        }
      }
      if (hit) {
        b.life = 0;
        const hx = a[0] + (e[0] - a[0]) * bestT, hy = a[1] + (e[1] - a[1]) * bestT, hz = a[2] + (e[2] - a[2]) * bestT;
        hits.push({ b, hit, x: hx, y: hy, z: hz });
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const h of hits) {
      if (h.hit.npc) this.damageNpc(h.hit.npc, h.b.dmg, h.b.owner, h);
      else this.damagePlayerShip(h.hit.conn, h.b.dmg, h.b, h);
    }
  }

  damageNpc(n, dmg, ownerId, at) {
    if (!this.npcs.has(n.id)) return;
    const conn = ownerId.startsWith('p:') ? this.w.connById(ownerId.slice(2)) : null;
    if (conn) {
      n.damagers.add(conn.player.key);
      // Shooting a faction ship brings its whole squad down on you.
      if (n.faction || n.race) for (const o of this.npcs.values()) if ((o.faction || o.race) === (n.faction || n.race) && Math.hypot(o.x - n.x, o.z - n.z) < 3000) o.aggro.add(conn.player.key);
    }
    if (n.kind === 'mothership') n.hp = this.w.story.damageMothership(dmg);
    else n.hp -= dmg;
    this.w.toNear(at.x, at.z, { t: 'hit', id: n.id, x: at.x, y: at.y, z: at.z, dmg: Math.round(dmg) });
    if (n.hp > 0) return;
    this.npcs.delete(n.id);
    const def = NPC_KINDS[n.kind];
    this.w.toNear(n.x, n.z, { t: 'boom', x: n.x, y: n.y, z: n.z, size: n.radius });
    if (n.faction) this.w.warScore(n.faction === 'empire' ? 'rebellion' : 'empire');
    if (!conn) return;
    const killer = conn.player;
    if (n.kind === 'mothership') {
      const share = Math.round(def.bounty / Math.max(1, n.damagers.size));
      for (const key of n.damagers) {
        const c = this.w.connByName(key);
        if (!c) continue;
        c.player.credits += share;
        this.w.sendSelf(c);
        c.send({ t: 'toast', msg: `Mothership bounty: +${share} cr` });
        this.w.giveItem(c, randomItem(6));
        if (Math.random() < 0.3) this.w.giveItem(c, makeRelic('hiveCore'));
      }
      this.w.story.add('kill:mothership', 1, killer.name);
      this.w.broadcast({ t: 'chat', from: null, text: `${killer.name} landed the killing blow on the Hive Mothership!` });
      return;
    }
    const bounty = Math.round(def.bounty * (0.7 + 0.3 * n.richness));
    const crew = this.w.parties.nearbyMembers(killer);
    const share = Math.round(bounty / crew.length);
    for (const p of crew) {
      p.credits += share;
      const c = this.w.connByName(p.key);
      if (c) { this.w.sendSelf(c); c.send({ t: 'toast', msg: `${n.race ? ALIEN_RACES[n.race].name + ' ship' : def.name} destroyed: +${share} cr${crew.length > 1 ? ' (party share)' : ''}` }); }
    }
    const luck = 1 + (killer.buffs?.luck || 0);
    if (Math.random() < 0.3 * luck) this.w.giveItem(conn, randomItem(n.richness));
    if (def.relic && Math.random() < 0.05 * luck) this.w.giveItem(conn, makeRelic(def.relic));
    if (KILL_REP[n.kind]) this.w.changeRep(conn, KILL_REP[n.kind]);
    if (n.race) this.w.discover(conn, [`race:${n.race}`]);
    killer.kills = (killer.kills || 0) + 1;
    if (n.kind === 'hollow') this.w.story.add('kill:hollow', 1, killer.name);
  }

  damagePlayerShip(conn, dmg, bolt, at) {
    const p = conn.player;
    p.lastHit = Date.now();
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    p.hull -= dmg - absorbed;
    this.w.toNear(at.x, at.z, { t: 'hit', id: conn.id, x: at.x, y: at.y, z: at.z, dmg: Math.round(dmg), shield: absorbed > 0 });
    conn.send({ t: 'you', hull: p.hull, shield: p.shield });
    if (p.hull > 0) return;
    let by = 'the void';
    if (bolt.npc) by = NPC_KINDS[this.npcs.get(bolt.owner)?.kind]?.name || 'a hostile ship';
    else {
      const k = this.w.connById(bolt.owner.slice(2));
      if (k) { by = k.player.name; k.player.kills = (k.player.kills || 0) + 1; }
    }
    this.destroyPlayerShip(conn, by);
  }

  destroyPlayerShip(conn, by) {
    const p = conn.player;
    this.w.toNear(p.x, p.z, { t: 'boom', x: p.x, y: p.y, z: p.z, size: p.stats.radius * 2 });
    this.w.broadcast({ t: 'chat', from: null, text: `${p.name}'s ship was destroyed by ${by}.` });
    p.cargo = {};
    p.mining = null;
    p.dead = true;
    conn.send({ t: 'died', by, respawnIn: 4 });
    setTimeout(() => {
      if (!this.w.conns().includes(conn)) return;
      p.dead = false;
      this.w.respawnInSpace(conn);
    }, 4000);
  }

  regenTick(dt, now) {
    for (const c of this.w.conns()) {
      const p = c.player;
      if (p.mode !== 'space' || p.dead) continue;
      if (now - (p.lastHit || 0) > 4000 && p.shield < p.stats.shield) {
        p.shield = Math.min(p.stats.shield, p.shield + p.stats.shieldRegen * dt);
        if (Math.random() < 0.2) c.send({ t: 'you', shield: p.shield });
      }
    }
  }

  tick(dt, now) {
    this.spawnTick(now);
    this.npcTick(dt, now);
    this.boltTick(dt);
    this.regenTick(dt, now);
    if (this.pendingBolts.length) {
      const bySector = new Map();
      for (const b of this.pendingBolts) {
        const k = sectorKey(...sectorOf(b.x, b.z));
        if (!bySector.has(k)) bySector.set(k, []);
        bySector.get(k).push({ id: b.id, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, c: b.color, l: b.life });
      }
      for (const [k, list] of bySector) this.w.toSector(k, { t: 'bolts', list });
      this.pendingBolts = [];
    }
  }

  npcsIn(subs, viewer) {
    const out = [];
    for (const n of this.npcs.values()) {
      if (!subs.has(sectorKey(...sectorOf(n.x, n.z)))) continue;
      out.push({ id: n.id, kind: n.kind, race: n.race, x: n.x, y: n.y, z: n.z, vx: n.vx, vy: n.vy, vz: n.vz, f: n.f, hp: Math.max(0, n.hp), maxHp: n.maxHp, hostile: viewer ? this.hostileToPlayer(n, viewer) : true });
    }
    return out;
  }
}

