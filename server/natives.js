// The people of planet towns as living actors: they turn out when pilots come near, go about
// their business, defend their homes, fight their realm's wars, and (for vampires and
// werewolves) hunt at night. They share the surface's creature list and simulation.

import { townsOf, sunAt, personName } from '../shared/towns.js';
import { PEOPLES } from '../shared/content/peoples.js';
import { mulberry32, hashString } from '../shared/rng.js';

const ROLE_STATS = {
  ruler: { hp: 170, dmg: 14, armed: true }, captain: { hp: 150, dmg: 12, armed: true }, guard: { hp: 110, dmg: 9, armed: true },
  hunter: { hp: 85, dmg: 8, armed: true }, default: { hp: 60, dmg: 5, armed: false },
};
const NEAR = 170;           // pilots this close to a town bring it to life
const RAID_EVERY_MS = 4 * 60 * 1000;
let nextId = 1;

export class Natives {
  constructor(surfaces) {
    this.s = surfaces;
    this.w = surfaces.w;
  }

  get politics() { return this.w.politics; }

  setup(inst) {
    inst.towns = townsOf(inst.planet);
    inst.natives = new Map();   // npc id -> creature id
    inst.raidAt = {};
  }

  night(inst) { return sunAt(inst.planet, Date.now() / 1000).night; }

  make(inst, town, npc, extra = {}) {
    const st = ROLE_STATS[npc.role] || ROLE_STATS.default;
    const people = npc.people;
    let hp = st.hp * (people === 'dwarf' ? 1.3 : people === 'vampire' ? 1.2 : 1) * (0.7 + 0.3 * inst.planet.richness);
    const id = 'n' + nextId++;
    const [hx, hz] = npc.near || npc.home;
    const c = {
      id, species: 'native', npc: npc.id, people, role: npc.role, female: npc.female, look: npc.look, town: town.id,
      realm: this.politics.ownerOf(inst.planet.id, town), name: this.politics.nameOf(inst.planet.id, npc),
      x: hx + (Math.random() - 0.5) * 3, z: hz + (Math.random() - 0.5) * 3, y: 0, yaw: Math.random() * 6,
      hp, maxHp: hp, dmg: st.dmg * (people === 'elf' ? 1.15 : 1) * (0.7 + 0.3 * inst.planet.richness), speed: npc.role === 'guard' || npc.role === 'captain' ? 4.4 : 3.2,
      size: (PEOPLES[people].height || 1), behavior: 'native', faction: null, shape: 'person', armed: st.armed,
      lastAttack: 0, wander: null, aggro: null, guard: town.id, home: [hx, hz], leash: town.radius + 30, ...extra,
    };
    c.y = this.s.ground(inst.planet.id, c.x, c.z);
    inst.creatures.set(id, c);
    return c;
  }

  // Bring towns near pilots to life; let empty towns go quiet.
  spawn(inst, conns, now) {
    const pid = inst.planet.id;
    for (const town of inst.towns) {
      const near = conns.some((c) => Math.hypot(c.player.px - town.x, c.player.pz - town.z) < town.radius + NEAR);
      if (!near) {
        for (const [npcId, cid] of inst.natives) if (npcId.startsWith(town.id + '.')) { inst.creatures.delete(cid); inst.natives.delete(npcId); }
        for (const c of inst.creatures.values()) if (c.raider && c.target === town.id) inst.creatures.delete(c.id);
        continue;
      }
      for (const npc of town.npcs) {
        const cid = inst.natives.get(npc.id);
        if (cid && inst.creatures.has(cid)) continue;
        if (this.politics.isDead(pid, npc)) continue;
        inst.natives.set(npc.id, this.make(inst, town, npc).id);
      }
      this.raid(inst, town, now);
    }
  }

  // Towns at war, or plagued by raiders, get attacked while pilots are around to see it.
  raid(inst, town, now) {
    const pid = inst.planet.id;
    const owner = this.politics.ownerOf(pid, town);
    const realm = this.politics.state(pid)?.realms[owner];
    if (!realm || (!realm.war && realm.event?.kind !== 'raiders')) return;
    if (now - (inst.raidAt[town.id] || now - RAID_EVERY_MS * 0.6) < RAID_EVERY_MS) return;
    inst.raidAt[town.id] = now;
    const enemy = realm.war ? realm.war.with : null;
    const enemyDef = enemy ? this.politics.realmDef(pid, enemy) : null;
    const people = enemyDef ? enemyDef.people : 'human';
    const rng = mulberry32(hashString(town.id) ^ now);
    const n = 3 + Math.floor(rng() * 3);
    const a0 = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i - n / 2) * 0.12, d = town.radius + 45;
      const npc = { id: `raid:${now}:${i}`, role: 'guard', people, female: rng() < 0.4, look: Math.floor(rng() * 1e9), name: personName(people, rng), home: [town.x + Math.cos(a) * d, town.z + Math.sin(a) * d] };
      const c = this.make(inst, town, npc, { raider: true, bandit: !enemy, defender: owner, target: town.id, realm: enemy, leash: town.radius + 90, home: [town.x, town.z] });
      c.name = enemy ? `${enemyDef.name.split(' ').pop()} raider` : 'Bandit';
      c.x = npc.home[0]; c.z = npc.home[1];
    }
    const d = this.politics.realmDef(pid, owner);
    this.s.toPlanet(pid, { t: 'toast', msg: enemy ? `${enemyDef.name} raiders are attacking ${town.name}!` : `Bandits are raiding ${town.name}!` });
    if (d) this.s.toPlanet(pid, { t: 'chat', from: null, text: `[${inst.planet.name}] ${town.name} of the ${d.name} is under attack.` });
  }

  // How far away a native will come for this pilot.
  aggroRange(inst, c, p) {
    if (c.aggro === p.key) return 50;
    const st = this.politics.standing(p, c.realm);
    if (c.bandit) return 40;
    if (c.raider) return this.politics.standing(p, c.defender) >= 25 || st <= -30 ? 40 : 0;
    if ((c.role === 'guard' || c.role === 'captain') && st <= -30) return 40;
    if (this.night(inst)) {
      if (c.people === 'vampire' && st < 20) return 28;
      if (c.people === 'werewolf' && st < 10 && c.role !== 'ruler') return 34;
    }
    return 0;
  }

  // Werewolves change at night: bigger, faster and much more dangerous.
  wolf(inst, c) { return c.people === 'werewolf' && this.night(inst) && c.role !== 'ruler' && c.role !== 'merchant'; }

  enemies(inst, a, b) {
    if (a.behavior !== 'native' || b.behavior !== 'native') return false;
    if (a.raider && b.raider) return false;
    if (a.raider) return b.realm === a.defender && !b.raider;
    if (b.raider) return a.realm === b.defender;
    return a.realm !== b.realm && this.politics.atWar(inst.planet.id, a.realm, b.realm);
  }

  // Armed natives with no pilot to deal with look for enemies of their own.
  findFoe(inst, c) {
    if (!c.armed) return null;
    let best = null, bd = 45;
    for (const o of inst.creatures.values()) {
      if (o === c || !this.enemies(inst, c, o)) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // A native was hurt by another native.
  hurtByNative(inst, c, dmg, by) {
    c.hp -= dmg;
    this.s.toPlanet(inst.planet.id, { t: 'hit', id: c.id, x: c.x, y: c.y + 1.6, z: c.z, dmg: Math.round(dmg) });
    if (c.hp > 0) return;
    inst.creatures.delete(c.id);
    this.s.toPlanet(inst.planet.id, { t: 'boom', x: c.x, y: c.y + 1, z: c.z, size: 2, organic: true });
    const pid = inst.planet.id;
    if (c.raider) { if (by.realm) this.politics.skirmish(pid, by.realm); }
    else {
      this.politics.state(pid).dead[c.npc] = Date.now();
      if (by.raider && by.realm) this.politics.skirmish(pid, by.realm);
    }
  }

  // Descriptor sent once per connection so the client can draw this person.
  describe(c) {
    return { name: c.name, people: c.people, role: c.role, female: c.female, look: c.look, town: c.town, raider: !!c.raider };
  }
}
