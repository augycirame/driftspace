// Planetary politics. Every world's realms start from the generated picture (shared/towns.js)
// and then live on: stability rises and falls, neighbors ally or go to war, rulers die and are
// succeeded or overthrown, famines and plagues and festivals come and go, and conquered towns
// change hands. Players push all of it around through trade, quests and violence.
//
// Only worlds someone has visited are simulated. Their state is saved with the world.

import { findPlanet } from '../shared/universe.js';
import { townsOf, realmsOf, personName, npcTitle } from '../shared/towns.js';
import { PEOPLES, GOVERNMENTS, GOODS, GOOD_IDS } from '../shared/content/peoples.js';
import { mulberry32, hashString } from '../shared/rng.js';

const SIM_EVERY_MS = 15000;
const MAX_CATCHUP_MIN = 90;
const LOG_SIZE = 60;
const COMMONER_RESPAWN_MS = 20 * 60 * 1000;
const FOOD = ['grain', 'meat', 'ale'];
const ARMS = ['tools', 'iron', 'bows', 'mithril'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Politics {
  constructor(world) {
    this.w = world;
    world.data.politics ||= {};
    this.lastSim = 0;
  }

  // ---- state ------------------------------------------------------------------------------

  planet(pid) { return findPlanet(pid, this.w.seed); }

  state(pid) {
    let s = this.w.data.politics[pid];
    if (s) return s;
    const planet = this.planet(pid);
    if (!planet) return null;
    const realms = realmsOf(planet);
    const rng = mulberry32(hashString(pid + ':politics'));
    s = { realms: {}, owners: {}, dead: {}, names: {}, market: {}, log: [], last: Date.now() };
    for (const r of realms) {
      s.realms[r.id] = { stability: 45 + Math.round(rng() * 35), treasury: 200 + Math.round(rng() * 600), relations: {}, war: null, ruler: null, event: null, allies: [] };
    }
    for (const a of realms) for (const b of realms) {
      if (a.id >= b.id) continue;
      const v = Math.round((rng() - 0.45) * 90 + (a.people === b.people ? 25 : -10));
      s.realms[a.id].relations[b.id] = s.realms[b.id].relations[a.id] = clamp(v, -80, 80);
    }
    this.w.data.politics[pid] = s;
    this.w.dirty = true;
    return s;
  }

  realmDef(pid, realmId) { return realmsOf(this.planet(pid)).find((r) => r.id === realmId) || null; }
  ownerOf(pid, town) { return this.state(pid)?.owners[town.id] || town.realm; }

  // The current ruler: the generated one, or whoever has taken their place.
  ruler(pid, realmId) {
    const s = this.state(pid), def = this.realmDef(pid, realmId);
    if (!def) return null;
    if (s.realms[realmId]?.ruler) return s.realms[realmId].ruler;
    const cap = townsOf(this.planet(pid)).find((t) => t.id === def.capital);
    const npc = cap?.npcs.find((n) => n.role === 'ruler');
    return npc ? { name: npc.name, title: npc.title, female: npc.female, npc: npc.id } : null;
  }

  nameOf(pid, npc) {
    const s = this.state(pid);
    const name = s?.names[npc.id] || npc.name;
    if (npc.role === 'ruler') {
      const r = this.ruler(pid, npc.realm);
      if (r && r.npc !== npc.id) return `${r.title} ${r.name}`;
    }
    return npc.title ? `${npc.title} ${name}` : name;
  }

  isDead(pid, npc) {
    const s = this.state(pid);
    const t = s?.dead[npc.id];
    if (!t) return false;
    if (npc.role === 'ruler') return false;   // a successor always takes the seat
    if (Date.now() - t > COMMONER_RESPAWN_MS) {
      // Someone new moves in and takes over the work.
      delete s.dead[npc.id];
      s.names[npc.id] = personName(npc.people, mulberry32(hashString(npc.id) ^ t));
      return false;
    }
    return true;
  }

  // ---- reading the room ----------------------------------------------------------------------

  standing(p, realmId) { return p.standing?.[realmId] || 0; }

  changeStanding(conn, pid, realmId, delta, why) {
    const p = conn.player;
    p.standing ||= {};
    const before = p.standing[realmId] || 0;
    p.standing[realmId] = clamp(before + delta, -100, 100);
    const def = this.realmDef(pid, realmId);
    const word = (v) => (v <= -60 ? 'an enemy' : v <= -30 ? 'unwelcome' : v < 20 ? 'a stranger' : v < 50 ? 'a friend' : v < 80 ? 'honored' : 'a hero');
    if (def && word(before) !== word(p.standing[realmId])) conn.send({ t: 'toast', msg: `${def.name}: you are now ${word(p.standing[realmId])}.` });
    if (why) conn.send({ t: 'chat', from: null, text: why });
    this.w.dirty = true;
  }

  atWar(pid, a, b) {
    const s = this.state(pid);
    return !!s && s.realms[a]?.war?.with === b;
  }

  // Credits per local coin: shaky, warring realms have weak money.
  coinRate(pid, realmId) {
    const def = this.realmDef(pid, realmId), r = this.state(pid)?.realms[realmId];
    if (!def || !r) return 1;
    return Math.round(def.coinRate * (0.55 + r.stability / 100 * 0.7) * (r.war ? 0.85 : 1) * 100) / 100;
  }

  // A good's price in a town, in that realm's coin.
  price(pid, town, good) {
    const s = this.state(pid), realm = s.realms[this.ownerOf(pid, town)];
    const g = GOODS[good];
    if (!g) return null;
    const local = PEOPLES[town.people].goods.includes(good);
    let mult = (local ? 0.75 : 1.3) * (s.market[town.id]?.[good] || 1);
    if (realm?.event?.kind === 'famine' && FOOD.includes(good)) mult *= 2;
    if (realm?.event?.kind === 'festival' && (good === 'ale' || good === 'moonwine' || good === 'bloodwine')) mult *= 1.4;
    if (realm?.event?.kind === 'plague' && good === 'herbs') mult *= 2.2;
    if (realm?.war && ARMS.includes(good)) mult *= 1.45;
    const rate = this.coinRate(pid, this.ownerOf(pid, town));
    return Math.max(1, Math.round((g.price * mult) / rate));
  }

  // Goods a town trades in: its own people's, plus a few from elsewhere.
  marketGoods(town) {
    const own = PEOPLES[town.people].goods;
    const rng = mulberry32(hashString(town.id + ':goods'));
    const others = GOOD_IDS.filter((g) => !own.includes(g)).sort(() => rng() - 0.5).slice(0, 3);
    return [...own, ...others].filter((g) => GOODS[g]);
  }

  traded(pid, town, good, qty) {
    const s = this.state(pid);
    const m = (s.market[town.id] ||= {});
    m[good] = clamp((m[good] || 1) * (1 + qty * 0.012), 0.5, 2.5);
    s.realms[this.ownerOf(pid, town)].treasury += Math.abs(qty);
    this.w.dirty = true;
  }

  // ---- the chronicle ----------------------------------------------------------------------------

  chronicle(pid, text) {
    const s = this.state(pid);
    s.log.push({ t: Date.now(), text });
    if (s.log.length > LOG_SIZE) s.log.splice(0, s.log.length - LOG_SIZE);
    const planet = this.planet(pid);
    for (const c of this.w.conns()) if (c.player.mode === 'surface' && c.player.planet === pid) c.send({ t: 'chat', from: null, text: `[${planet.name}] ${text}`, channel: 'world' });
    this.w.dirty = true;
  }

  // ---- events from players ----------------------------------------------------------------------

  npcKilled(conn, pid, c) {
    const s = this.state(pid);
    const realmId = c.realm, def = this.realmDef(pid, realmId);
    if (c.raider) {
      // Killing an invader helps the town they attacked.
      this.changeStanding(conn, pid, c.defender, 6);
      if (def) this.changeStanding(conn, pid, realmId, -8);
      const war = s.realms[c.defender]?.war;
      if (war && def) war.score += 1;
      return;
    }
    if (!def) return;
    s.dead[c.npc] = Date.now();
    const harsh = c.role === 'ruler' ? -70 : c.role === 'guard' || c.role === 'captain' ? -15 : -30;
    this.changeStanding(conn, pid, realmId, harsh, c.role === 'guard' ? null : `The ${def.name} will not forget the death of ${c.name}.`);
    // Their enemies may quietly approve.
    for (const [other, rel] of Object.entries(s.realms[realmId].relations)) if (rel < -30) this.changeStanding(conn, pid, other, c.role === 'ruler' ? 15 : 3);
    if (c.role === 'ruler') this.succession(pid, realmId, `${c.name} has been slain by ${conn.player.name}`);
    else s.realms[realmId].stability = clamp(s.realms[realmId].stability - 3, 0, 100);
  }

  succession(pid, realmId, cause) {
    const s = this.state(pid), def = this.realmDef(pid, realmId);
    const r = s.realms[realmId];
    const rng = mulberry32(hashString(realmId) ^ Date.now());
    const female = rng() < 0.5;
    const gov = GOVERNMENTS[def.government];
    const name = personName(def.people, rng);
    const how = { heir: 'The heir', vote: 'After a tense vote,', strongest: 'After a bloody contest,' }[gov.succession];
    r.ruler = { name, title: gov.ruler[female ? 1 : 0], female, since: Date.now() };
    r.stability = clamp(r.stability - 15, 0, 100);
    this.chronicle(pid, `${cause}. ${how} ${r.ruler.title} ${name} now rules the ${def.name}.`);
  }

  // ---- simulation -------------------------------------------------------------------------------

  tick(now) {
    if (now - this.lastSim < SIM_EVERY_MS) return;
    this.lastSim = now;
    for (const pid of Object.keys(this.w.data.politics)) {
      const s = this.w.data.politics[pid];
      const minutes = Math.min(MAX_CATCHUP_MIN, (now - s.last) / 60000);
      if (minutes < 0.25) continue;
      s.last = now;
      this.simulate(pid, s, minutes);
    }
  }

  simulate(pid, s, minutes) {
    const ids = Object.keys(s.realms);
    const chance = (perMin) => Math.random() < 1 - Math.pow(1 - perMin, minutes);
    const def = (id) => this.realmDef(pid, id);
    for (const id of ids) {
      const r = s.realms[id], d = def(id);
      if (!d) continue;
      // Drift toward a natural level of contentment; troubles weigh on it.
      r.stability += ((55 - r.stability) * 0.02 + (Math.random() - 0.5) * 1.5 - (r.war ? 0.6 : 0) - (r.event?.kind === 'famine' || r.event?.kind === 'plague' ? 1 : 0) + (r.event?.kind === 'festival' ? 0.6 : 0)) * minutes;
      r.stability = clamp(r.stability, 0, 100);
      r.treasury = Math.max(0, r.treasury + (2 + r.stability / 25 - (r.war ? 4 : 0)) * minutes);
      if (r.event && Date.now() > r.event.until) {
        this.chronicle(pid, { famine: `The famine in the ${d.name} has eased.`, plague: `The plague in the ${d.name} has burned itself out.`, festival: `The festival in the ${d.name} winds down.`, raiders: `The raiders have left the ${d.name}.` }[r.event.kind] || `Things settle in the ${d.name}.`);
        r.event = null;
      }
      // Rulers age, sicken and are sometimes pushed.
      if (chance(0.0007)) this.succession(pid, id, `${this.ruler(pid, id)?.title || 'The ruler'} ${this.ruler(pid, id)?.name || ''} has died`.replace('  ', ' '));
      else if (r.stability < 15 && chance(0.04)) {
        this.succession(pid, id, `Rebels have overthrown ${this.ruler(pid, id)?.title} ${this.ruler(pid, id)?.name} of the ${d.name}`);
        r.stability = 40;
      }
      if (!r.event) {
        if (chance(0.004)) this.startEvent(pid, id, 'famine', 20, `A failed harvest brings famine to the ${d.name}. Food prices soar.`);
        else if (chance(0.002)) this.startEvent(pid, id, 'plague', 18, `Plague spreads through the ${d.name}. Healers and herbs are in desperate demand.`);
        else if (chance(0.006)) this.startEvent(pid, id, 'festival', 12, `The ${d.name} celebrates a great festival. Drink flows and spirits are high.`);
        else if (chance(0.008)) this.startEvent(pid, id, 'raiders', 15, `Raiders have been sighted near the towns of the ${d.name}.`);
      }
    }
    // Between realms: relations drift, wars begin and end, alliances form.
    for (const a of ids) for (const b of ids) {
      if (a >= b) continue;
      const ra = s.realms[a], rb = s.realms[b];
      let rel = ra.relations[b] ?? 0;
      rel = clamp(rel + (Math.random() - 0.52) * 2.2 * minutes, -100, 100);
      ra.relations[b] = rb.relations[a] = rel;
      const da = def(a), db = def(b);
      if (!da || !db) continue;
      if (!ra.war && !rb.war && rel < -45 && chance(0.02)) {
        ra.war = { with: b, score: 0, since: Date.now() };
        rb.war = { with: a, score: 0, since: Date.now() };
        ra.allies = ra.allies.filter((x) => x !== b); rb.allies = rb.allies.filter((x) => x !== a);
        this.chronicle(pid, `War! The ${da.name} has declared war on the ${db.name}.`);
      } else if (ra.war?.with === b) {
        const score = ra.war.score - rb.war.score;
        const weary = (Date.now() - ra.war.since) / 3600000;
        if (Math.abs(score) >= 8) this.endWar(pid, score > 0 ? a : b, score > 0 ? b : a);
        else if (chance(0.006 + weary * 0.01)) {
          ra.war = rb.war = null;
          ra.relations[b] = rb.relations[a] = clamp(rel + 35, -100, 100);
          this.chronicle(pid, `Exhausted, the ${da.name} and the ${db.name} have signed a truce.`);
        } else if (chance(0.05)) {
          // Skirmishes happen whether or not anyone is watching.
          (Math.random() < 0.5 + (ra.stability - rb.stability) / 200 ? ra : rb).war.score += 1;
        }
      } else if (rel > 60 && !ra.allies.includes(b) && chance(0.02)) {
        ra.allies.push(b); rb.allies.push(a);
        this.chronicle(pid, `The ${da.name} and the ${db.name} have sworn an alliance.`);
      }
    }
    // Markets drift back toward normal.
    for (const m of Object.values(s.market)) for (const g of Object.keys(m)) {
      m[g] += (1 - m[g]) * Math.min(1, 0.02 * minutes);
      if (Math.abs(m[g] - 1) < 0.01) delete m[g];
    }
    this.w.dirty = true;
  }

  startEvent(pid, realmId, kind, minutes, text) {
    const r = this.state(pid).realms[realmId];
    r.event = { kind, until: Date.now() + minutes * 60000 };
    this.chronicle(pid, text);
  }

  // The winner takes a town if the loser has one to spare; otherwise tribute.
  endWar(pid, winner, loser) {
    const s = this.state(pid), planet = this.planet(pid);
    const dw = this.realmDef(pid, winner), dl = this.realmDef(pid, loser);
    const towns = townsOf(planet).filter((t) => this.ownerOf(pid, t) === loser);
    const prize = towns.find((t) => !t.capital && t.realm === loser) || (towns.length > 1 ? towns.find((t) => !t.capital) : null);
    s.realms[winner].war = s.realms[loser].war = null;
    s.realms[winner].stability = clamp(s.realms[winner].stability + 12, 0, 100);
    s.realms[loser].stability = clamp(s.realms[loser].stability - 12, 0, 100);
    s.realms[winner].relations[loser] = s.realms[loser].relations[winner] = -20;
    if (prize) {
      s.owners[prize.id] = winner;
      this.chronicle(pid, `The ${dw.name} has won the war. ${prize.name} now flies the banners of the ${dw.name}.`);
    } else {
      const tribute = Math.round(s.realms[loser].treasury * 0.5);
      s.realms[loser].treasury -= tribute;
      s.realms[winner].treasury += tribute;
      this.chronicle(pid, `The ${dw.name} has won the war. The ${dl.name} pays a tribute of ${tribute} ${dl.coin[1]}.`);
    }
  }

  // Score a war from a fight between natives.
  skirmish(pid, winnerRealm) {
    const r = this.state(pid)?.realms[winnerRealm];
    if (r?.war) r.war.score += 1;
  }

  // ---- for the client -----------------------------------------------------------------------------

  view(pid, p) {
    const s = this.state(pid), planet = this.planet(pid);
    if (!s || !planet) return null;
    const towns = townsOf(planet);
    return {
      planet: pid,
      realms: realmsOf(planet).map((d) => {
        const r = s.realms[d.id];
        const ruler = this.ruler(pid, d.id);
        return {
          id: d.id, name: d.name, people: d.people, government: GOVERNMENTS[d.government].name, ruler: ruler ? `${ruler.title} ${ruler.name}` : null,
          stability: Math.round(r.stability), treasury: Math.round(r.treasury), war: r.war ? { with: r.war.with, score: r.war.score } : null,
          allies: r.allies, relations: Object.fromEntries(Object.entries(r.relations).map(([k, v]) => [k, Math.round(v)])), event: r.event?.kind || null,
          coin: d.coin, rate: this.coinRate(pid, d.id), standing: Math.round(this.standing(p, d.id)),
          towns: towns.filter((t) => this.ownerOf(pid, t) === d.id).map((t) => ({ id: t.id, name: t.name, size: t.size, capital: t.capital && t.realm === d.id, people: t.people })),
        };
      }),
      log: s.log.slice(-25),
    };
  }
}

export { npcTitle };
