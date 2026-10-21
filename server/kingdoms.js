// Player kingdoms. A pilot can rise through a realm's ranks by talking to its ruler: swear fealty
// and become a knight, petition for a fief and become the lord of a town (and collect its taxes),
// and at last claim the throne itself. A pilot on the throne rules the realm: they draw on its
// treasury, declare war and make peace, and the ruler's old seat is kept by a regent.

import { townsOf } from '../shared/towns.js';
import { GOVERNMENTS } from '../shared/content/peoples.js';
import { rankOf } from '../shared/guild.js';

export const KNIGHT = 1, LORD = 2, MONARCH = 3;
const FIEF_PRICE = 3000;
const TAX_PER_HOUR = { hamlet: 60, village: 100, town: 180, city: 320 };
const TAX_EVERY_MS = 60000;
const COLLECT_EVERY_MS = 3600000;

export class Kingdoms {
  constructor(world) {
    this.w = world;
    this.lastTax = 0;
  }

  get politics() { return this.w.politics; }

  // Where this pilot stands in this realm.
  rankIn(p, pid, realm) {
    const f = p.fealty;
    return f && f.pid === pid && f.realm === realm ? f.rank : 0;
  }

  // A realm's ruler is a pilot: their key, or null.
  monarchOf(pid, realm) { return this.politics.state(pid)?.realms[realm]?.ruler?.player || null; }

  // What shows under a pilot's name: Sir Ace, Lord of Oswick, Queen of the Kingdom of Lirarthil.
  titleOf(p) {
    const f = p.fealty;
    if (!f) return null;
    const def = this.politics.realmDef(f.pid, f.realm);
    if (!def) return null;
    if (f.rank === MONARCH) return `${GOVERNMENTS[def.government].ruler[f.female ? 1 : 0]} of the ${def.name}`;
    if (f.rank === LORD) {
      const town = townsOf(this.politics.planet(f.pid)).find((t) => t.id === f.fief);
      return `${f.female ? 'Lady' : 'Lord'} of ${town?.name || 'a lost fief'}`;
    }
    return `Knight of the ${def.name}`;
  }

  // ---- talking to the ruler ------------------------------------------------------------------------

  talkOptions(conn, c, pid) {
    if (c.role !== 'ruler') return [];
    const p = conn.player, rank = this.rankIn(p, pid, c.realm), monarch = this.monarchOf(pid, c.realm);
    if (monarch === p.key) {
      return [['k:treasury', 'Regent, how stands the treasury?'], ['k:collect', 'Send my share of the taxes to my purse.'], ['k:war', 'We march to war.'], ['k:peace', 'Sue for peace.'], ['k:style', 'Change how I am addressed.']];
    }
    if (monarch) return [];
    if (!rank) return p.fealty ? [] : [['k:fealty', 'I would swear fealty to you.']];
    if (rank === KNIGHT) return [['k:fief', `I ask for a fief of my own. (${FIEF_PRICE} cr)`]];
    if (rank === LORD) return [['k:throne', 'The realm needs a stronger hand. Yield the throne.']];
    return [];
  }

  action(conn, cur, opt) {
    const { c, pid } = cur, p = conn.player;
    const s = this.politics.state(pid), realm = s.realms[c.realm], def = this.politics.realmDef(pid, c.realm);
    if (!realm || !def) return;
    const standing = this.politics.standing(p, c.realm);
    const say = (line) => conn.send({ t: 'talk_line', id: c.id, line, options: this.w.talk.options(conn, c) });
    const rank = this.rankIn(p, pid, c.realm);
    const isMonarch = this.monarchOf(pid, c.realm) === p.key;
    switch (opt) {
      case 'k:fealty': {
        if (p.fealty) return say('You are already sworn to another. A knight serves one crown.');
        if (standing < 30) return say('Fealty? From a stranger? Prove yourself to this realm first.');
        p.fealty = { pid, realm: c.realm, rank: KNIGHT, since: Date.now() };
        this.politics.changeStanding(conn, pid, c.realm, 5);
        this.politics.chronicle(pid, `${p.name} has sworn fealty to the ${def.name} and been knighted.`);
        this.changed(conn);
        return say(`Kneel, then. Rise, ${p.name}, Knight of the ${def.name}. Serve us well.`);
      }
      case 'k:fief': {
        if (rank !== KNIGHT) return;
        if (standing < 60) return say('Land is given to those the realm honors. Not yet, knight.');
        const fiefs = (s.fiefs ||= {});
        // Any town of the realm without a lord; the capital itself only when there's nothing else.
        const ours = townsOf(this.politics.planet(pid)).filter((t) => this.politics.ownerOf(pid, t) === c.realm && !fiefs[t.id]);
        const town = ours.find((t) => t.id !== def.capital) || ours[0];
        if (!town) return say('There is no land left to give. Every town of ours already has a lord.');
        if (p.credits < FIEF_PRICE) return say(`A fief has its price: ${FIEF_PRICE} credits to the crown. Come back with it.`);
        p.credits -= FIEF_PRICE;
        fiefs[town.id] = p.key;
        Object.assign(p.fealty, { rank: LORD, fief: town.id, lastTax: Date.now() });
        this.politics.chronicle(pid, `${p.name} has been made lord of ${town.name} by the ${def.name}.`);
        this.changed(conn);
        return say(`So be it. ${town.name} is yours to hold, and its taxes are yours to keep. Govern it well, Lord ${p.name}.`);
      }
      case 'k:throne': {
        if (rank !== LORD) return;
        // The crown goes to the hero the people love, if the realm is shaky or the hero is a legend.
        const renown = (p.spire || 0) >= 3 || rankOf(p.guild?.merit) >= 4;
        if (standing < 85) return say('The people do not love you enough to follow you. Not yet.');
        if (realm.stability >= 40 && !renown) return say('The realm is at peace under my rule. Why would they want you? Become a legend first: climb the Spire, or earn a B-rank guild card.');
        const old = this.politics.ruler(pid, c.realm);
        realm.ruler = { name: p.name, title: GOVERNMENTS[def.government].ruler[0], female: false, player: p.key, since: Date.now() };
        realm.stability = Math.min(100, realm.stability + 10);
        p.fealty.rank = MONARCH;
        this.politics.chronicle(pid, `${old ? `${old.title} ${old.name}` : 'The old ruler'} has yielded the throne. ${p.name} now rules the ${def.name}!`);
        this.w.broadcast({ t: 'chat', from: null, text: `👑 ${p.name} has been crowned ruler of the ${def.name}.` });
        conn.send({ t: 'transmission', title: 'CROWNED', lines: [`The court kneels. You rule the ${def.name}.`, 'Talk to your regent in the capital to draw on the treasury, declare war or make peace.'] });
        this.changed(conn);
        return say('…Very well. The crown is yours. I will serve as your regent, Majesty.');
      }
      case 'k:treasury': {
        if (!isMonarch) return;
        const at = realm.war ? ` We are at war with the ${this.politics.realmDef(pid, realm.war.with)?.name} (score ${realm.war.score}).` : ' We are at peace.';
        return say(`The treasury holds ${Math.round(realm.treasury)} ${def.coin[1]}. Stability is ${Math.round(realm.stability)} of 100.${at}`);
      }
      case 'k:collect': {
        if (!isMonarch) return;
        const now = Date.now();
        if (now - (p.fealty.lastCollect || 0) < COLLECT_EVERY_MS) return say('You have taken your share this hour, Majesty. Squeeze the people harder and they will riot.');
        const take = Math.floor(realm.treasury * 0.3);
        if (take < 1) return say('The coffers are empty, Majesty.');
        realm.treasury -= take;
        realm.stability = Math.max(0, realm.stability - 2);
        p.coins ||= {};
        p.coins[c.realm] = (p.coins[c.realm] || 0) + take;
        p.fealty.lastCollect = now;
        this.changed(conn);
        return say(`${take} ${def.coin[1]} have been sent to your purse. Spend them wisely.`);
      }
      case 'k:war': {
        if (!isMonarch) return;
        if (realm.war) return say('We are already at war, Majesty.');
        const foes = Object.entries(realm.relations).filter(([id]) => this.politics.realmDef(pid, id)).sort((a, b) => a[1] - b[1]);
        if (!foes.length) return say('There is no one to fight, Majesty.');
        return conn.send({ t: 'talk_line', id: c.id, line: 'Against whom, Majesty?', options: [...foes.slice(0, 4).map(([id, rel]) => [`k:war:${id}`, `The ${this.politics.realmDef(pid, id).name} (relations ${Math.round(rel)})`]), ['bye', 'Not today.']] });
      }
      case 'k:peace': {
        if (!isMonarch) return;
        if (!realm.war) return say('We are at peace, Majesty.');
        const cost = Math.max(0, 300 - realm.war.score * 40);
        if (realm.treasury < cost) return say(`They will want ${cost} ${def.coin[1]} in reparations, and the treasury cannot pay it.`);
        realm.treasury -= cost;
        // A white peace: no town changes hands, but nobody forgets.
        const other = realm.war.with;
        realm.war = s.realms[other].war = null;
        realm.relations[other] = s.realms[other].relations[c.realm] = -20;
        this.politics.chronicle(pid, `${realm.ruler.title} ${p.name} has made peace between the ${def.name} and the ${this.politics.realmDef(pid, other)?.name}.`);
        this.w.dirty = true;
        return say(cost ? `Peace is bought, at ${cost} ${def.coin[1]}. The soldiers come home.` : 'They accept our terms. The war is over.');
      }
      case 'k:style': {
        if (!isMonarch) return;
        p.fealty.female = !p.fealty.female;
        realm.ruler.female = p.fealty.female;
        realm.ruler.title = GOVERNMENTS[def.government].ruler[p.fealty.female ? 1 : 0];
        this.changed(conn);
        return say(`As you wish, ${realm.ruler.title} ${p.name}.`);
      }
    }
    if (opt.startsWith('k:war:') && isMonarch && !realm.war) {
      const foe = opt.slice(6), fd = this.politics.realmDef(pid, foe);
      if (!fd || !s.realms[foe] || s.realms[foe].war) return say('They are already at war with another, Majesty. Let them bleed.');
      realm.war = { with: foe, score: 0, since: Date.now() };
      s.realms[foe].war = { with: c.realm, score: 0, since: Date.now() };
      realm.relations[foe] = s.realms[foe].relations[c.realm] = -80;
      this.politics.chronicle(pid, `${realm.ruler.title} ${p.name} of the ${def.name} has declared war on the ${fd.name}!`);
      this.w.dirty = true;
      return say(`The banners are raised. We march on the ${fd.name}.`);
    }
  }

  changed(conn) {
    this.w.dirty = true;
    this.w.sendSelf(conn);
  }

  // ---- taxes ---------------------------------------------------------------------------------------

  // Lords and rulers collect their towns' taxes while they play.
  tick(now) {
    if (now - this.lastTax < TAX_EVERY_MS) return;
    this.lastTax = now;
    for (const conn of this.w.conns()) {
      const p = conn.player, f = p.fealty;
      if (!f || f.rank < LORD) continue;
      const s = this.politics.state(f.pid), realm = s?.realms[f.realm];
      if (!realm) continue;
      // A lord whose town has fallen to another realm, or a deposed ruler, loses their seat.
      const towns = townsOf(this.politics.planet(f.pid));
      if (f.rank === MONARCH && realm.ruler?.player !== p.key) { this.lose(conn, 'You have lost your throne.'); continue; }
      const fief = towns.find((t) => t.id === f.fief);
      if (f.rank === LORD && (!fief || this.politics.ownerOf(f.pid, fief) !== f.realm)) { this.lose(conn, `${fief?.name || 'Your fief'} has fallen to another realm.`); continue; }
      const held = f.rank === MONARCH ? towns.filter((t) => t.id === this.politics.realmDef(f.pid, f.realm).capital) : [fief];
      const hours = Math.min(2, (now - (f.lastTax || now)) / 3600000);
      f.lastTax = now;
      const rate = 0.5 + realm.stability / 100;
      const pay = Math.round(held.reduce((sum, t) => sum + TAX_PER_HOUR[t.size], 0) * rate * hours * (f.rank === MONARCH ? 2 : 1));
      if (pay > 0) { p.credits += pay; f.taxed = (f.taxed || 0) + pay; this.w.sendSelf(conn); }
    }
  }

  lose(conn, why) {
    const p = conn.player, f = p.fealty, s = this.politics.state(f.pid);
    if (f.fief && s?.fiefs) delete s.fiefs[f.fief];
    p.fealty = { ...f, rank: KNIGHT, fief: null };
    conn.send({ t: 'toast', msg: why });
    this.changed(conn);
  }
}
