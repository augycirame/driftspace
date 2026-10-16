// Skills, magic, superpowers, curses and mechs: everything a pilot can become on foot.

import {
  SKILLS, skillLevel, skillBonus, SPELLS, maxMana, POWERS, POWER_IDS, FAVOR_FOR_POWER, MAX_ENERGY,
  CURSES, CURE_PRICE, WOLF, mechStats, MECH,
} from '../shared/powers.js';
import { sunAt } from '../shared/towns.js';
import { SURFACE_HALF } from '../shared/planet.js';
import { GODS } from '../shared/content/factions.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export class Powers {
  constructor(world) {
    this.w = world;
  }

  // ---- skills ----------------------------------------------------------------------------------

  gain(conn, skill, n = 1) {
    const p = conn.player;
    if (!SKILLS[skill] || !(n > 0)) return;
    p.skills ||= {};
    const before = skillLevel(p.skills[skill]);
    p.skills[skill] = (p.skills[skill] || 0) + n;
    const after = skillLevel(p.skills[skill]);
    if (after > before) {
      conn.send({ t: 'toast', msg: `${SKILLS[skill].name} rose to ${after}: better ${SKILLS[skill].bonus}.`, cls: 'loot' });
      if (skill === 'magic') p.maxMana = maxMana(p.skills);
      this.w.restat(p);
      this.w.sendSelf(conn);
    }
    this.w.dirty = true;
  }

  // ---- derived numbers used by combat and movement ------------------------------------------------

  night(p) {
    if (p.mode !== 'surface') return p.mode === 'dungeon';
    const inst = this.w.surfaces.instances.get(p.planet);
    return inst ? sunAt(inst.planet, Date.now() / 1000).night : false;
  }

  damageMult(p) {
    let m = 1 + skillBonus(p.skills, 'combat') + (p.buffs?.damage || 0);
    if (p.curse === 'vampire' && this.night(p)) m += 0.3;
    if (p.powerOn && p.power === 'titan') m += 0.6;
    return m;
  }

  speedMult(p) {
    let m = 1;
    if (p.powerOn && p.power === 'speed') m = Math.max(m, 2.5);
    if (p.wolf) m = Math.max(m, WOLF.speed);
    if (p.inMech) m = Math.max(m, MECH.speed);
    if (p.curse === 'vampire' && this.night(p)) m = Math.max(m, 1.2);
    return m;
  }

  flying(p) { return p.powerOn && p.power === 'flight'; }
  veiled(p) { return (p.veilUntil || 0) > Date.now(); }

  // Damage coming at the pilot, after aegis, wards, wolf hide and mech armor.
  absorb(conn, dmg) {
    const p = conn.player, now = Date.now();
    if ((p.aegisUntil || 0) > now) return 0;
    if (p.ward && p.ward.until > now) {
      const soak = Math.min(p.ward.hp, dmg);
      p.ward.hp -= soak;
      dmg -= soak;
      if (p.ward.hp <= 0) p.ward = null;
      conn.send({ t: 'you', ward: p.ward });
    }
    if (p.wolf) dmg /= WOLF.hp;
    if (p.inMech) {
      const mech = this.mechItem(p);
      if (mech) {
        const st = mechStats(mech.tier);
        mech.hp = Math.max(0, (mech.hp ?? st.hp) - dmg * (1 - st.armor));
        conn.send({ t: 'you', mechHp: mech.hp });
        if (mech.hp <= 0) {
          p.inMech = false;
          conn.send({ t: 'toast', msg: 'Your mech is wrecked! It repairs slowly while you are out of it.' });
          this.w.surfaces.toPlanet(p.planet, { t: 'boom', x: p.px, y: p.py + 2, z: p.pz, size: 5 });
          this.w.sendSelf(conn);
        }
        return 0;
      }
    }
    return dmg;
  }

  // A hit landed: vampires drink from it.
  dealt(conn, dmg) {
    const p = conn.player;
    if (p.curse === 'vampire' && dmg > 0 && !p.inMech) p.hp = Math.min(p.maxHp, p.hp + dmg * 0.15);
  }

  // ---- magic ---------------------------------------------------------------------------------------

  cast(conn, { spell, dir }) {
    const p = conn.player, def = SPELLS[spell], now = Date.now();
    if (!def || p.mode !== 'surface' || p.dead) return;
    if (!(p.spells || []).includes(spell)) return conn.send({ t: 'toast', msg: `You don't know ${def.name}. A mage could teach you.` });
    if (p.wolf || p.inMech) return conn.send({ t: 'toast', msg: p.wolf ? 'Wolves cannot cast spells.' : 'You cannot cast spells from inside a mech.' });
    p.spellCd ||= {};
    if ((p.spellCd[spell] || 0) > now) return;
    if ((p.mana ?? 0) < def.mana) return conn.send({ t: 'toast', msg: 'Not enough mana.' });
    if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(num)) dir = [Math.sin(p.yaw) * -1, 0, Math.cos(p.yaw) * -1];
    const l = Math.hypot(...dir) || 1;
    const d = dir.map((v) => v / l);
    p.mana -= def.mana;
    p.spellCd[spell] = now + def.cooldown * 1000;
    const power = 1 + skillBonus(p.skills, 'magic');
    const S = this.w.surfaces, inst = S.instance(p.planet);
    const o = [p.px, p.py + 1.5, p.pz];
    const fx = (m) => S.toPlanet(p.planet, { t: 'spell', by: conn.id, kind: spell, c: def.color, ...m });
    switch (spell) {
      case 'firebolt': case 'sunlance': {
        const hit = S.trace(inst, conn, o, d, def.range);
        fx({ from: o, to: hit.point });
        if (hit.creature) {
          const holy = def.holy && (hit.creature.people === 'vampire' || /undead|wraith|skeleton|lich|ghoul/i.test(hit.creature.species));
          S.hurtCreature(inst, hit.creature, def.damage * power * (holy ? 2 : 1), conn);
        } else if (hit.conn) S.hurtPlayer(hit.conn, def.damage * power * 0.6, p.name);
        break;
      }
      case 'lightning': {
        let hit = S.trace(inst, conn, o, d, def.range);
        const points = [o, hit.point];
        const struck = new Set();
        let at = hit.creature;
        for (let i = 0; i < def.chains && at; i++) {
          struck.add(at.id);
          S.hurtCreature(inst, at, def.damage * power, conn);
          let next = null, nd = 14;
          for (const c of inst.creatures.values()) {
            if (struck.has(c.id) || (c.behavior === 'native' && !c.raider && c.aggro !== p.key)) continue;
            const dd = Math.hypot(c.x - at.x, c.z - at.z);
            if (dd < nd) { nd = dd; next = c; }
          }
          if (next) points.push([next.x, next.y + 1, next.z]);
          at = next;
        }
        fx({ points });
        break;
      }
      case 'frost': {
        fx({ at: [p.px, p.py + 0.5, p.pz], radius: def.radius });
        for (const c of [...inst.creatures.values()]) {
          if (Math.hypot(c.x - p.px, c.z - p.pz) > def.radius) continue;
          if (c.behavior === 'native' && !c.raider && c.aggro !== p.key) continue;   // spare bystanders
          c.slowUntil = now + 4000;
          S.hurtCreature(inst, c, def.damage * power, conn);
        }
        break;
      }
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + def.heal * power);
        fx({ at: [p.px, p.py + 1, p.pz] });
        conn.send({ t: 'you', hp: p.hp });
        break;
      case 'blink': {
        const from = [p.px, p.py + 1, p.pz];
        const lim = SURFACE_HALF - 5;
        const hl = Math.hypot(d[0], d[2]) || 1;
        p.px = Math.max(-lim, Math.min(lim, p.px + (d[0] / hl) * def.distance));
        p.pz = Math.max(-lim, Math.min(lim, p.pz + (d[2] / hl) * def.distance));
        p.py = S.ground(p.planet, p.px, p.pz);
        p.lastPos = now;
        fx({ from, to: [p.px, p.py + 1, p.pz] });
        conn.send({ t: 'teleport', mode: 'surface', planet: p.planet, x: p.px, y: p.py, z: p.pz });
        break;
      }
      case 'ward':
        p.ward = { hp: def.shield * power, max: def.shield * power, until: now + def.seconds * 1000 };
        fx({ at: [p.px, p.py + 1, p.pz] });
        break;
    }
    this.gain(conn, 'magic', 3);
    conn.send({ t: 'you', mana: p.mana, ward: p.ward || null });
  }

  // Mages, priests and healers teach spells for local coin.
  teachOptions(c, p) {
    return Object.entries(SPELLS).filter(([id, s]) => s.teachers.includes(c.role) && !(p.spells || []).includes(id));
  }

  learn(conn, cur, spell) {
    const p = conn.player, def = SPELLS[spell];
    const { c, pid } = cur;
    if (!def || !def.teachers.includes(c.role) || (p.spells || []).includes(spell)) return;
    const price = this.priceIn(pid, c.realm, def.price);
    if (!this.w.talk.pay(conn, pid, c.realm, price)) return conn.send({ t: 'talk_line', id: c.id, line: `That knowledge costs ${price} ${this.w.talk.coinName(pid, c.realm, price)}.` });
    p.spells = [...(p.spells || []), spell];
    conn.send({ t: 'talk_line', id: c.id, line: `Watch closely. Like this… There. ${def.name} is yours. (Key ${p.spells.length <= 4 ? p.spells.length : '-'} to cast; U for your spellbook.)`, options: this.w.talk.options(conn, c) });
    this.w.sendSelf(conn);
    this.w.dirty = true;
  }

  priceIn(pid, realmId, credits) {
    return Math.max(1, Math.round(credits / this.w.politics.coinRate(pid, realmId)));
  }

  cure(conn, cur) {
    const p = conn.player, { c, pid } = cur;
    if (!p.curse || c.role !== 'priest') return;
    const price = this.priceIn(pid, c.realm, CURE_PRICE);
    if (!this.w.talk.pay(conn, pid, c.realm, price)) return conn.send({ t: 'talk_line', id: c.id, line: `The rite needs offerings worth ${price} ${this.w.talk.coinName(pid, c.realm, price)}.` });
    const was = CURSES[p.curse].name;
    p.curse = null;
    p.wolf = false;
    conn.send({ t: 'talk_line', id: c.id, line: `Kneel. … It is done. The ${was.toLowerCase()} has left you.`, options: this.w.talk.options(conn, c) });
    this.w.restat(p);
    this.w.sendSelf(conn);
  }

  // ---- curses ---------------------------------------------------------------------------------------

  bitten(conn, c) {
    const p = conn.player;
    if (p.curse || p.inMech || !conn.player) return;
    const kind = c.people === 'vampire' ? 'vampire' : c.people === 'werewolf' && this.night(p) ? 'werewolf' : null;
    if (!kind || Math.random() > CURSES[kind].bite) return;
    p.curse = kind;
    conn.send({ t: 'transmission', title: CURSES[kind].name.toUpperCase(), lines: [kind === 'vampire' ? 'The bite burns, then goes cold. Your heart slows. The light hurts your eyes.' : 'The wound itches. When the moon rises you feel something pacing inside you.', CURSES[kind].text] });
    this.w.sendSelf(conn);
    this.w.dirty = true;
  }

  transform(conn) {
    const p = conn.player;
    if (p.curse !== 'werewolf') return conn.send({ t: 'toast', msg: 'You are no werewolf.' });
    if (p.mode !== 'surface' || p.inMech) return;
    if (!p.wolf && !this.night(p)) return conn.send({ t: 'toast', msg: 'The wolf only comes out at night.' });
    p.wolf = !p.wolf;
    this.w.surfaces.toPlanet(p.planet, { t: 'spell', by: conn.id, kind: 'transform', at: [p.px, p.py + 1, p.pz], c: '#e8c86a' });
    this.w.sendSelf(conn);
  }

  claw(conn) {
    const p = conn.player, now = Date.now();
    if (!p.wolf || p.mode !== 'surface' || now - (p.lastClaw || 0) < 450) return;
    p.lastClaw = now;
    const S = this.w.surfaces, inst = S.instance(p.planet);
    const fx = Math.sin(p.yaw) * -1, fz = Math.cos(p.yaw) * -1;
    for (const c of [...inst.creatures.values()]) {
      const dx = c.x - p.px, dz = c.z - p.pz, d = Math.hypot(dx, dz);
      if (d > WOLF.reach + c.size * 0.6 || (dx * fx + dz * fz) / (d || 1) < 0.35) continue;
      const dmg = WOLF.claw * this.damageMult(p);
      S.hurtCreature(inst, c, dmg, conn);
      this.dealt(conn, dmg);
    }
    S.toPlanet(p.planet, { t: 'spell', by: conn.id, kind: 'claw', at: [p.px + fx * 2, p.py + 1.2, p.pz + fz * 2], c: '#ffffff' });
  }

  // ---- superpowers ----------------------------------------------------------------------------------

  // Gods grant their power to the devout.
  favored(conn, god) {
    const p = conn.player;
    const id = POWER_IDS.find((k) => POWERS[k].god === god);
    if (!id || p.power === id || (p.favor[god] || 0) < FAVOR_FOR_POWER) return;
    p.power = id;
    p.powerOn = false;
    p.energy = MAX_ENERGY;
    conn.send({ t: 'transmission', title: POWERS[id].name.toUpperCase(), lines: [`${GODS[god].name.split(',')[0]} touches you. Power floods your limbs.`, `${POWERS[id].text} (F to use.)`] });
    this.w.sendSelf(conn);
  }

  usePower(conn) {
    const p = conn.player, def = POWERS[p.power], now = Date.now();
    if (!def || p.dead || p.mode === 'space') return;
    if (def.drain) {
      if (!p.powerOn && (p.energy || 0) < 15) return conn.send({ t: 'toast', msg: 'Not enough energy.' });
      p.powerOn = !p.powerOn;
    } else {
      if ((p.powerCd || 0) > now) return conn.send({ t: 'toast', msg: `${def.name} returns in ${Math.ceil((p.powerCd - now) / 1000)}s.` });
      if ((p.energy || 0) < def.cost) return conn.send({ t: 'toast', msg: 'Not enough energy.' });
      p.energy -= def.cost;
      p.powerCd = now + def.cooldown * 1000;
      if (p.power === 'aegis') { p.aegisUntil = now + def.seconds * 1000; p.hp = p.maxHp; }
      if (p.power === 'veil') {
        p.veilUntil = now + def.seconds * 1000;
        const inst = this.w.surfaces.instances.get(p.planet);
        if (inst) for (const c of inst.creatures.values()) if (c.aggro === p.key) c.aggro = null;
      }
    }
    if (p.mode === 'surface') this.w.surfaces.toPlanet(p.planet, { t: 'spell', by: conn.id, kind: `power:${p.power}`, at: [p.px, p.py + 1, p.pz], c: GODS[def.god].color, on: !!p.powerOn });
    this.w.sendSelf(conn);
  }

  // ---- mechs -----------------------------------------------------------------------------------------

  mechItem(p) { return p.inv.items.find((i) => i.id === p.inv.equipped.mech && i.kind === 'mech') || null; }

  toggleMech(conn) {
    const p = conn.player;
    if (p.mode !== 'surface' || p.dead) return conn.send({ t: 'toast', msg: 'Mechs deploy on planet surfaces.' });
    if (p.inMech) { p.inMech = false; this.w.sendSelf(conn); return; }
    const mech = this.mechItem(p);
    if (!mech) return conn.send({ t: 'toast', msg: 'Equip a mech frame first (Tab). Stations and the Haven trade hall sell them.' });
    if (p.wolf) return conn.send({ t: 'toast', msg: 'A wolf cannot pilot a mech.' });
    const st = mechStats(mech.tier);
    mech.hp ??= st.hp;
    if (mech.hp < st.hp * 0.3) return conn.send({ t: 'toast', msg: `The mech is still being repaired (${Math.round(100 * mech.hp / st.hp)}%).` });
    p.inMech = true;
    this.w.surfaces.toPlanet(p.planet, { t: 'spell', by: conn.id, kind: 'mech', at: [p.px, p.py + 2, p.pz], c: '#9fd0ff' });
    this.w.sendSelf(conn);
  }

  // ---- upkeep ------------------------------------------------------------------------------------------

  tick(dt, now) {
    for (const conn of this.w.conns()) {
      const p = conn.player;
      let changed = false;
      p.maxMana = maxMana(p.skills);
      if ((p.spells || []).length && (p.mana ?? 0) < p.maxMana) { p.mana = Math.min(p.maxMana, (p.mana ?? p.maxMana) + (2.5 + skillLevel(p.skills?.magic) * 0.2) * dt); changed = true; }
      if (p.power) {
        const def = POWERS[p.power];
        if (p.powerOn) {
          p.energy = (p.energy ?? MAX_ENERGY) - def.drain * dt;
          if (p.energy <= 0 || p.mode === 'space') { p.energy = Math.max(0, p.energy); p.powerOn = false; this.w.sendSelf(conn); }
        } else if ((p.energy ?? MAX_ENERGY) < MAX_ENERGY) p.energy = Math.min(MAX_ENERGY, (p.energy ?? MAX_ENERGY) + 6 * dt);
        changed = true;
      }
      if (p.ward && p.ward.until < now) { p.ward = null; conn.send({ t: 'you', ward: null }); }
      // Mechs repair themselves while parked.
      const mech = this.mechItem(p);
      if (mech && !p.inMech && mech.hp != null && mech.hp < mechStats(mech.tier).hp) { mech.hp = Math.min(mechStats(mech.tier).hp, mech.hp + MECH.repairPerSec * dt); changed = true; }
      if (p.inMech && p.mode !== 'surface') p.inMech = false;
      // The curses.
      if (p.mode === 'surface' && !p.dead) {
        const inst = this.w.surfaces.instances.get(p.planet);
        const sun = inst ? sunAt(inst.planet, now / 1000) : null;
        if (p.curse === 'vampire' && sun && sun.daylight > 0.45 && !p.inMech) {
          const sheltered = inst.towns?.some((t) => Math.hypot(t.x - p.px, t.z - p.pz) < t.radius + 4);
          if (!sheltered) {
            p.hp -= 1.6 * dt;
            p.lastHurt = now;
            if (p.hp <= 0) this.w.surfaces.hurtPlayer(conn, 1, 'the sun');
            changed = true;
          }
        }
        if (p.wolf && sun && !sun.night) { p.wolf = false; conn.send({ t: 'toast', msg: 'Dawn breaks. The wolf retreats.' }); this.w.sendSelf(conn); }
      } else if (p.wolf) p.wolf = false;
      if (changed && now - (p.lastPowerSync || 0) > 400) {
        p.lastPowerSync = now;
        conn.send({ t: 'you', mana: p.mana, maxMana: p.maxMana, energy: p.energy, hp: p.hp, mechHp: mech?.hp });
      }
    }
  }

  view(p) {
    const mech = this.mechItem(p);
    return {
      skills: p.skills || {}, spells: p.spells || [], mana: p.mana ?? maxMana(p.skills), maxMana: maxMana(p.skills),
      power: p.power || null, powerOn: !!p.powerOn, energy: p.energy ?? MAX_ENERGY, curse: p.curse || null, wolf: !!p.wolf,
      inMech: !!p.inMech, mechHp: mech ? mech.hp ?? mechStats(mech.tier).hp : null, mechMax: mech ? mechStats(mech.tier).hp : null, mechTier: mech?.tier || 0,
      ward: p.ward || null, speedMult: this.speedMult(p), flying: this.flying(p),
    };
  }
}
