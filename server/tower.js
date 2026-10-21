// The Spire on Haven: pick a floor up to the front line, climb it with your party, kill the floor
// boss. The first party to clear the front-line floor opens the next one for everyone, and the
// pilot who lands the killing blow takes the Last Attack bonus.

import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { spireOf, SPIRE_RADIUS } from '../shared/planet.js';
import { floorBoss, MAX_FLOOR } from '../shared/tower.js';
import { makeItem, randomItem, rollGrade, itemName, WEAPON_IDS, ARMOR_SLOT_IDS } from '../shared/items.js';

export class Tower {
  constructor(world) {
    this.w = world;
  }

  get s() { return (this.w.data.tower ||= { frontier: 1, clears: {} }); }

  nearSpire(p) {
    if (p.mode !== 'surface' || p.planet !== STARTER_PLANET_ID) return false;
    const sp = spireOf(findPlanet(p.planet, this.w.seed));
    return sp && Math.hypot(p.px - sp.x, p.pz - sp.z) < SPIRE_RADIUS + 10;
  }

  // The floor list: every floor up to the front line, with who cleared it first.
  open(conn) {
    if (!this.nearSpire(conn.player)) return;
    const s = this.s, floors = [];
    for (let f = 1; f <= Math.min(MAX_FLOOR, s.frontier); f++) floors.push({ floor: f, boss: floorBoss(f).name, cleared: s.clears[f] || null });
    conn.send({ t: 'tower', frontier: s.frontier, floors, best: conn.player.spire || 0 });
  }

  enter(conn, { floor }) {
    const p = conn.player;
    floor = Math.floor(floor);
    if (!this.nearSpire(p) || !(floor >= 1 && floor <= this.s.frontier)) return;
    const planet = findPlanet(p.planet, this.w.seed), sp = spireOf(planet);
    this.w.dungeons.enterFloor(conn, planet, sp, floor);
  }

  // A floor boss fell. Everyone in the party gets loot; the killer gets the Last Attack bonus.
  cleared(inst, killer, crew) {
    const s = this.s, floor = inst.floor, boss = floorBoss(floor);
    const first = !s.clears[floor];
    const lucky = floor % 5 === 0 ? 'legendary' : 'unique';
    const kinds = [...WEAPON_IDS.map((t) => ['weapon', t]), ...ARMOR_SLOT_IDS.map((t) => ['armor', t])];
    const [kind, type] = kinds[Math.floor(Math.random() * kinds.length)];
    const tier = Math.min(5, 1 + Math.floor(floor / 3));
    const bonus = makeItem(kind, type, tier, first ? lucky : rollGrade(Math.random, 0.6));
    this.w.giveItem(killer, bonus);
    killer.send({ t: 'transmission', title: 'LAST ATTACK BONUS', lines: [`Your blow felled ${boss.name}.`, `You receive ${itemName(bonus)}.`] });
    for (const c of crew) {
      c.player.spire = Math.max(c.player.spire || 0, floor);
      c.player.credits += Math.round(500 * floor * (first ? 2 : 1) / crew.length);
      if (c !== killer) this.w.giveItem(c, randomItem(2 + floor * 0.5));
      this.w.sendSelf(c);
    }
    const names = crew.map((c) => c.player.name).join(', ');
    if (first) {
      s.clears[floor] = { by: names, at: Date.now() };
      if (floor === s.frontier && s.frontier < MAX_FLOOR) s.frontier++;
      this.w.broadcast({ t: 'chat', from: null, text: `★ Floor ${floor} of the Spire has been cleared! ${names} defeated ${boss.name}.${floor < MAX_FLOOR ? ` Floor ${floor + 1} is open.` : ''}` });
      this.w.dirty = true;
    }
  }
}
