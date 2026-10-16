// Bases on planets and stations in space, built from blocks: claim banners protect your land,
// beds set where you wake up, chests store materials, turrets defend, docking ports turn a
// space structure into a station, and workbenches (or towns and stations) let you craft.

import { BLOCKS, ORES, TURRET, DOCK_PORT_RANGE, SURFACE_GRID, WORLD_GRID, canAfford } from '../shared/rules.js';
import { sectorOf, sectorKey } from '../shared/universe.js';
import { townsOf } from '../shared/towns.js';
import { RECIPES, recipeCost } from '../shared/crafting.js';
import { makeItem, randomRelic, WEAPON_IDS, ARMOR_SLOT_IDS, MAX_TIER } from '../shared/items.js';
import { skillLevel, skillBonus } from '../shared/powers.js';

const cellCenter = (cell, grid) => cell.split(',').map((v) => (Number(v) + 0.5) * grid);

export class Bases {
  constructor(world) {
    this.w = world;
    this.turretAt = new Map();   // cell key -> last shot time
  }

  // ---- claims ----------------------------------------------------------------------------------

  // Who (if anyone) has claimed this spot on a planet, other than this pilot and their party.
  claimedBy(pid, x, z, p) {
    const blocks = this.w.surfaces.saved(pid).blocks;
    for (const [cell, blk] of Object.entries(blocks)) {
      const r = BLOCKS[blk.b]?.claim;
      if (!r || blk.o === p.name) continue;
      const [cx, , cz] = cellCenter(cell, SURFACE_GRID);
      if (Math.hypot(cx - x, cz - z) > r) continue;
      const owner = this.w.connByName(blk.o);
      if (owner && this.w.parties.sameParty(owner.player.key, p.key)) continue;
      return blk.o;
    }
    return null;
  }

  // ---- placing special blocks -----------------------------------------------------------------

  placedOnSurface(conn, pid, cell, blk) {
    const def = BLOCKS[blk.b], p = conn.player;
    if (def.chest) blk.inv = {};
    if (def.bed) {
      p.bed = { planet: pid, cell };
      conn.send({ t: 'toast', msg: 'Bed placed: you will wake up here when you fall on this world.' });
    }
    if (def.claim) conn.send({ t: 'toast', msg: `This land is yours: nobody else can dig or build within ${def.claim} m.` });
  }

  removedFromSurface(conn, pid, cell, blk) {
    const p = conn.player;
    if (BLOCKS[blk.b].chest && blk.inv) for (const [k, v] of Object.entries(blk.inv)) p.cargo[k] = (p.cargo[k] || 0) + v;
    if (p.bed?.planet === pid && p.bed.cell === cell) p.bed = null;
  }

  // Where a fallen pilot wakes on this planet: their bed, if it still stands.
  bedSpot(p, pid) {
    if (!p.bed || p.bed.planet !== pid) return null;
    const blk = this.w.surfaces.saved(pid).blocks[p.bed.cell];
    if (!blk || blk.b !== 'bed' || blk.o !== p.name) return null;
    const [x, , z] = cellCenter(p.bed.cell, SURFACE_GRID);
    return [x + 1.5, z];
  }

  // ---- storage chests ---------------------------------------------------------------------------

  chest(conn, { cell, dir, item, n }) {
    const p = conn.player;
    if (p.mode !== 'surface' || typeof cell !== 'string') return;
    const s = this.w.surfaces.saved(p.planet), blk = s.blocks[cell];
    if (!blk || blk.b !== 'chest') return;
    if (blk.o !== p.name) return conn.send({ t: 'toast', msg: `That chest belongs to ${blk.o}.` });
    const [x, y, z] = cellCenter(cell, SURFACE_GRID);
    if (Math.hypot(x - p.px, z - p.pz) > 6) return;
    blk.inv ||= {};
    const moveAll = (from, to, k) => { const v = from[k] || 0; if (!v) return; to[k] = (to[k] || 0) + v; delete from[k]; };
    if (dir === 'put') { if (item === 'all') for (const k of Object.keys(p.cargo)) moveAll(p.cargo, blk.inv, k); else if (ORES[item]) moveAll(p.cargo, blk.inv, item); }
    else if (dir === 'take') {
      const room = p.stats.cargo - Object.values(p.cargo).reduce((a, b) => a + b, 0);
      if (ORES[item]) {
        const v = Math.min(blk.inv[item] || 0, Math.max(0, room), n || Infinity);
        if (v > 0) { blk.inv[item] -= v; p.cargo[item] = (p.cargo[item] || 0) + v; if (!blk.inv[item]) delete blk.inv[item]; }
        else if (room <= 0) conn.send({ t: 'toast', msg: 'Your cargo is full.' });
      }
    }
    this.w.dirty = true;
    this.w.sendSelf(conn);
    conn.send({ t: 'chest', cell, inv: blk.inv });
    this.w.surfaces.toPlanet(p.planet, { t: 'sblock', planet: p.planet, cell, data: blk });
  }

  // ---- turrets ------------------------------------------------------------------------------------

  // Surface turrets shoot hostile creatures, bandits and enemies of their owner.
  surfaceTurrets(inst, now) {
    const blocks = this.w.surfaces.saved(inst.planet.id).blocks;
    const T = TURRET.surface;
    for (const [cell, blk] of Object.entries(blocks)) {
      if (blk.b !== 'turret') continue;
      const key = inst.planet.id + '|' + cell;
      if (now - (this.turretAt.get(key) || 0) < T.every * 1000) continue;
      const [x, y, z] = cellCenter(cell, SURFACE_GRID);
      let best = null, bd = T.range;
      for (const c of inst.creatures.values()) {
        const hostile = c.raider || c.bandit || ['aggressive', 'swarm', 'guardian'].includes(c.behavior) || c.aggro?.toLowerCase?.() === blk.o.toLowerCase();
        if (!hostile) continue;
        const d = Math.hypot(c.x - x, c.y + 1 - y, c.z - z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) continue;
      this.turretAt.set(key, now);
      this.w.surfaces.toPlanet(inst.planet.id, { t: 'shot', by: 'turret', from: [x, y + 0.6, z], to: [[best.x, best.y + 1, best.z]], c: '#ffd08a' });
      const owner = this.w.connByName(blk.o);
      if (owner && owner.player.mode === 'surface' && owner.player.planet === inst.planet.id) this.w.surfaces.hurtCreature(inst, best, T.damage, owner);
      else {
        best.hp -= T.damage;
        this.w.surfaces.toPlanet(inst.planet.id, { t: 'hit', id: best.id, x: best.x, y: best.y + 1, z: best.z, dmg: T.damage });
        if (best.hp <= 0) inst.creatures.delete(best.id);
      }
    }
  }

  // Space turrets fire on pirates, Hollow and anything hunting their owner.
  spaceTurrets(now) {
    const combat = this.w.combat, T = TURRET.space;
    const watched = new Set();
    for (const c of this.w.conns()) if (c.player.mode === 'space') for (const k of c.subs) watched.add(k);
    for (const key of watched) {
      const blocks = this.w.data.blocks[key];
      if (!blocks) continue;
      for (const [cell, blk] of Object.entries(blocks)) {
        if (blk.b !== 'turret') continue;
        const tk = key + '|' + cell;
        if (now - (this.turretAt.get(tk) || 0) < T.every * 1000) continue;
        const [x, y, z] = cellCenter(cell, WORLD_GRID);
        let best = null, bd = T.range;
        for (const n of combat.npcs.values()) {
          if (!['pirate', 'hollow', 'mothership'].includes(n.kind) && !n.aggro?.has?.(blk.o.toLowerCase())) continue;
          const d = Math.hypot(n.x - x, n.y - y, n.z - z);
          if (d < bd) { bd = d; best = n; }
        }
        if (!best) continue;
        this.turretAt.set(tk, now);
        const owner = this.w.connByName(blk.o);
        this.w.toNear(x, z, { t: 'bolts', list: [{ x, y, z, vx: (best.x - x) / bd * 1400, vy: (best.y - y) / bd * 1400, vz: (best.z - z) / bd * 1400, c: '#ffd08a', l: bd / 1400 }] });
        combat.damageNpc(best, T.damage, owner ? 'p:' + owner.id : 'turret', { x: best.x, y: best.y, z: best.z });
      }
    }
  }

  // ---- player stations ------------------------------------------------------------------------------

  // A docking port near the pilot, in their own or a neighboring sector.
  nearbyDock(p) {
    if (p.mode !== 'space' || p.dead) return null;
    const [sx, sz] = sectorOf(p.x, p.z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const key = sectorKey(sx + dx, sz + dz), blocks = this.w.data.blocks[key];
      if (!blocks) continue;
      for (const [cell, blk] of Object.entries(blocks)) {
        if (blk.b !== 'dock') continue;
        const [x, y, z] = cellCenter(cell, WORLD_GRID);
        if (Math.hypot(x - p.x, y - p.y, z - p.z) < DOCK_PORT_RANGE) return { key, cell, owner: blk.o, x, y, z, id: `${key}:${cell}` };
      }
    }
    return null;
  }

  // Docking at a player station: repairs, sells at 80%, and lets you refit your ship.
  dockPlayer(conn, dock) {
    const p = conn.player;
    p.hull = p.stats.hp;
    p.shield = p.stats.shield;
    this.w.sendSelf(conn);
    conn.send({ t: 'docked', station: { id: dock.id, name: `${dock.owner}'s station`, richness: 1, player: true, owner: dock.owner }, gate: false, wants: [] });
  }

  // ---- crafting --------------------------------------------------------------------------------------

  // Where crafting is possible: a workbench nearby, a town with a smith, or a station.
  canCraft(p) {
    if (p.mode === 'space') return !!(this.w.dockedStation(p) || this.nearbyDock(p));
    if (p.mode !== 'surface') return false;
    const s = this.w.surfaces.saved(p.planet);
    for (const [cell, blk] of Object.entries(s.blocks)) {
      if (blk.b !== 'bench') continue;
      const [x, , z] = cellCenter(cell, SURFACE_GRID);
      if (Math.hypot(x - p.px, z - p.pz) < 8) return true;
    }
    const inst = this.w.surfaces.instance(p.planet);
    return townsOf(inst.planet).some((t) => Math.hypot(t.x - p.px, t.z - p.pz) < t.radius + 5 && t.buildings.some((b) => b.kind === 'smithy' || b.kind === 'keep'));
  }

  craft(conn, { recipe, tier, type }) {
    const p = conn.player, r = RECIPES[recipe];
    tier = Math.max(1, Math.min(MAX_TIER, tier | 0));
    if (!r) return;
    if (!this.canCraft(p)) return conn.send({ t: 'toast', msg: 'You need a workbench, a town with a smith, or a station to craft.' });
    const maxTier = Math.min(MAX_TIER, 2 + Math.floor(skillLevel(p.skills?.crafting) / 4));
    if (tier > maxTier) return conn.send({ t: 'toast', msg: `Your crafting skill allows up to tier ${maxTier}.` });
    const cost = recipeCost(recipe, tier);
    if (!canAfford(p.cargo, cost)) return conn.send({ t: 'toast', msg: `Missing materials: ${Object.entries(cost).filter(([k, v]) => (p.cargo[k] || 0) < v).map(([k, v]) => `${v - (p.cargo[k] || 0)} ${ORES[k]?.name || k}`).join(', ')}` });
    for (const [k, v] of Object.entries(cost)) { p.cargo[k] -= v; if (!p.cargo[k]) delete p.cargo[k]; }
    // Skilled crafters sometimes make something better than they planned.
    const up = Math.random() < skillBonus(p.skills, 'crafting') ? 1 : 0;
    const t = Math.min(MAX_TIER, tier + up);
    let item;
    if (r.makes === 'weapon') item = makeItem('weapon', WEAPON_IDS.includes(type) ? type : 'rifle', t);
    else if (r.makes === 'armor') item = makeItem('armor', ARMOR_SLOT_IDS.includes(type) ? type : 'chest', t);
    else if (r.makes === 'mech') item = makeItem('mech', 'mech', t);
    else item = randomRelic();
    this.w.giveItem(conn, item);
    this.w.powers.gain(conn, 'crafting', 10 * tier);
    if (up) conn.send({ t: 'toast', msg: 'Masterwork! It came out better than planned.', cls: 'loot' });
    this.w.dirty = true;
    this.w.sendSelf(conn);
  }

  tick(dt, now) {
    for (const inst of this.w.surfaces.instances.values()) this.surfaceTurrets(inst, now);
    this.spaceTurrets(now);
  }
}
