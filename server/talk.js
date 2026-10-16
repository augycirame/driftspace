// Talking to the people of planet towns: greetings that know what's going on in the realm,
// trade in local goods paid in local coin, money changing, smiths, healers and rumors.
// Free conversation (when an AI key is configured) and quests plug in here too.

import { townsOf, sunAt, weatherAt, weatherInfo } from '../shared/towns.js';
import { PEOPLES, GOODS, ROLES } from '../shared/content/peoples.js';

export const GOODS_CAP = 60;
const TALK_RANGE = 7;
const TRADERS = ['merchant', 'innkeeper', 'farmer', 'hunter', 'steward'];
const CHANGERS = ['merchant', 'steward', 'ruler', 'innkeeper'];
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Talk {
  constructor(world) {
    this.w = world;
  }

  get politics() { return this.w.politics; }

  // ---- opening a conversation -----------------------------------------------------------------

  open(conn, inst, c) {
    const pid = inst.planet.id;
    const town = townsOf(inst.planet).find((t) => t.id === c.town);
    if (!town) return;
    if (c.raider) return conn.send({ t: 'toast', msg: `${c.name} has nothing to say to you.` });
    if (c.aggro === conn.player.key) return conn.send({ t: 'toast', msg: `${c.name} is in no mood to talk.` });
    conn.talk = { pid, cid: c.id, town: town.id, realm: c.realm, history: conn.talk?.cid === c.id ? conn.talk.history : [] };
    this.w.discover(conn, [`people:${c.people}`]);
    conn.send({ t: 'talk', id: c.id, npc: this.card(pid, c, town), line: this.greeting(conn, inst, c, town), options: this.options(conn, c), ai: !!this.w.ai?.enabled });
  }

  card(pid, c, town) {
    const def = this.politics.realmDef(pid, c.realm);
    return { name: c.name, role: ROLES[c.role]?.name.replace('%ruler%', 'Ruler') || c.role, people: PEOPLES[c.people].noun, town: town.name, realm: def?.name || '' };
  }

  // Validate that the pilot is still talking to this person.
  current(conn, id) {
    const t = conn.talk, p = conn.player;
    if (!t || t.cid !== id || p.mode !== 'surface' || p.planet !== t.pid) return null;
    const inst = this.w.surfaces.instance(t.pid);
    const c = inst.creatures.get(id);
    if (!c || Math.hypot(c.x - p.px, c.z - p.pz) > TALK_RANGE + 2) return null;
    const town = townsOf(inst.planet).find((x) => x.id === t.town);
    return { inst, c, town, pid: t.pid };
  }

  options(conn, c) {
    const o = [];
    if (TRADERS.includes(c.role)) o.push(['trade', 'Show me your goods.']);
    if (c.role === 'smith' || c.role === 'captain') o.push(['arms', 'Let me see your arms and armor.']);
    if (CHANGERS.includes(c.role)) o.push(['exchange', 'I need to change money.']);
    if (c.role === 'healer' || c.role === 'priest') o.push(['heal', 'Can you tend my wounds?']);
    o.push(['news', 'What news?']);
    if (this.w.quests) o.push(['work', 'Is there any work?']);
    o.push(['bye', 'Farewell.']);
    return o;
  }

  greeting(conn, inst, c, town) {
    const pid = inst.planet.id, p = conn.player;
    const st = this.politics.standing(p, c.realm);
    const realm = this.politics.state(pid).realms[c.realm];
    const def = this.politics.realmDef(pid, c.realm);
    const sun = sunAt(inst.planet, Date.now() / 1000);
    const wx = weatherAt(inst.planet, Date.now() / 1000);
    const coin = def?.coin?.[1] || 'coin';
    if (st <= -60) return pickOne(['You have blood on your hands and the nerve to speak to me?', 'Guards! … No? Then get out of my sight.', 'Leave. Now, before I call the guard.']);
    if (st <= -30) return pickOne(['We know your face here. Say what you want and go.', 'Hmph. Make it quick.']);
    const lines = [];
    if (c.role === 'ruler') lines.push(`You stand before ${c.name} of the ${def?.name}. Speak.`);
    if (realm?.war) lines.push(`These are hard days. The ${this.politics.realmDef(pid, realm.war.with)?.name} could be at our walls any hour.`);
    if (realm?.event?.kind === 'famine') lines.push('Bread costs more than silver this season. The children are hungry.');
    if (realm?.event?.kind === 'plague') lines.push("Keep your distance, traveler. The sickness is in the town.");
    if (realm?.event?.kind === 'festival') lines.push("It's the festival! Drink with us, stranger!");
    if (realm?.event?.kind === 'raiders') lines.push('Raiders in the hills. Keep your weapon close.');
    if (sun.night && c.people === 'vampire') lines.push('Ah, a guest by night. How very… convenient.');
    if (sun.night && c.people === 'werewolf') lines.push("The moon's up. You'd do well to be indoors, outsider.");
    if (weatherInfo(wx).precip === 'rain') lines.push('Filthy weather. Come in out of the rain, at least.');
    if (weatherInfo(wx).precip === 'snow') lines.push('Cold enough to crack stone out there.');
    const byRole = {
      merchant: [`Looking to buy? I deal in honest ${coin}.`, 'Finest goods in the realm, priced to sell.'],
      smith: ['Blades, mail, honest steel. Nothing else.', "Mind the forge. Now, what do you need?"],
      guard: ['Keep your weapon low inside the walls.', 'Move along, unless you have business here.'],
      captain: ['The watch keeps this town alive. What do you want?'],
      innkeeper: ['A bed, a drink, or a rumor? I have all three.', "Sit, sit. Ale's fresh."],
      healer: ['Are you hurt? Let me see.'], priest: ['The gods see you, traveler.'],
      farmer: ["Good soil, this. Can't complain."], hunter: ["Tracks everywhere this season. Something's on the move."],
      bard: ['Shall I sing you the news? A coin buys a verse.'], steward: ['The affairs of the realm keep me busy. Be brief.'],
      mage: ['The weave is restless today. You feel it too?'],
    };
    if (byRole[c.role]) lines.push(pickOne(byRole[c.role]));
    if (st >= 50) lines.unshift(pickOne(['Friend! Good to see you again.', 'Ah, our hero returns!']));
    return lines.slice(0, 2).join(' ') || 'Well met.';
  }

  // ---- choices ------------------------------------------------------------------------------------

  choose(conn, { id, opt }) {
    const cur = this.current(conn, id);
    if (!cur) return conn.send({ t: 'talk_end' });
    const { c, town, pid, inst } = cur;
    const p = conn.player;
    const say = (line, extra = {}) => conn.send({ t: 'talk_line', id, line, ...extra });
    switch (opt) {
      case 'trade': if (TRADERS.includes(c.role)) return this.market(conn, pid, town); break;
      case 'arms':
        if (c.role === 'smith' || c.role === 'captain') {
          const bonus = c.people === 'dwarf' ? 2 : c.people === 'elf' ? 1 : 0;
          return this.w.openShop(conn, `smith:${town.id}`, inst.planet.richness + 1 + bonus, `${c.name} · ${town.name}`, { planet: pid, x: town.x, z: town.z, radius: town.radius + 20 });
        }
        break;
      case 'exchange': if (CHANGERS.includes(c.role)) return this.market(conn, pid, town, true); break;
      case 'heal': {
        if (c.role !== 'healer' && c.role !== 'priest') break;
        if (p.hp >= p.maxHp) return say('You look hale enough to me.');
        const cost = Math.max(2, Math.round((p.maxHp - p.hp) / 8 / this.politics.coinRate(pid, c.realm) * 4));
        if (!this.pay(conn, pid, c.realm, cost)) return say(`That'll be ${cost} ${this.coinName(pid, c.realm, cost)}, and you haven't got it.`);
        p.hp = p.maxHp;
        conn.send({ t: 'you', hp: p.hp });
        return say('There. Try not to get stabbed again so soon.');
      }
      case 'news': return say(this.rumor(conn, pid, c));
      case 'work': if (this.w.quests) return this.w.quests.offer(conn, cur); break;
      case 'bye': conn.talk = null; return conn.send({ t: 'talk_end' });
    }
    return say("I can't help you with that.");
  }

  rumor(conn, pid, c) {
    const s = this.politics.state(pid);
    const recent = s.log.slice(-6).reverse();
    if (recent.length && Math.random() < 0.7) return `They say… ${pickOne(recent).text}`;
    const def = this.politics.realmDef(pid, c.realm), r = s.realms[c.realm];
    const ruler = this.politics.ruler(pid, c.realm);
    const rels = Object.entries(r?.relations || {}).sort((a, b) => a[1] - b[1]);
    const worst = rels[0] && this.politics.realmDef(pid, rels[0][0]);
    const lines = [
      ruler ? `${ruler.title} ${ruler.name} rules us${r.stability > 60 ? ', and rules well' : r.stability < 30 ? ", though not for long if the grumbling's anything to go by" : ''}.` : null,
      worst && rels[0][1] < -20 ? `Nobody here trusts the ${worst.name}. Mark my words, it'll come to blood.` : null,
      `The ${def?.name} ${r?.treasury > 800 ? 'is rich these days' : r?.treasury < 150 ? 'is near broke' : 'gets by'}.`,
    ].filter(Boolean);
    return pickOne(lines);
  }

  // ---- money --------------------------------------------------------------------------------------

  coinName(pid, realmId, n = 2) {
    const def = this.politics.realmDef(pid, realmId);
    return def ? def.coin[n === 1 ? 0 : 1] : 'coins';
  }

  // Pay in local coin, falling back to credits at the exchange rate plus a 10% surcharge.
  pay(conn, pid, realmId, amount) {
    const p = conn.player;
    p.coins ||= {};
    const have = p.coins[realmId] || 0;
    if (have >= amount) { p.coins[realmId] = have - amount; this.w.dirty = true; return true; }
    const credits = Math.ceil((amount - have) * this.politics.coinRate(pid, realmId) * 1.1);
    if (p.credits < credits) return false;
    p.coins[realmId] = 0;
    p.credits -= credits;
    this.w.dirty = true;
    return true;
  }

  market(conn, pid, town, exchangeOnly = false) {
    const p = conn.player;
    const realmId = this.politics.ownerOf(pid, town);
    const def = this.politics.realmDef(pid, realmId);
    const goods = exchangeOnly ? [] : this.politics.marketGoods(town).map((g) => {
      const price = this.politics.price(pid, town, g);
      return { id: g, name: GOODS[g].name, buy: price, sell: Math.max(1, Math.floor(price * 0.8)), have: p.goods?.[g] || 0 };
    });
    conn.market = { pid, town: town.id, realm: realmId };
    conn.send({
      t: 'market', town: town.name, realm: def?.name, coin: def?.coin, rate: this.politics.coinRate(pid, realmId),
      wallet: p.coins?.[realmId] || 0, credits: p.credits, goods, carried: Object.values(p.goods || {}).reduce((a, b) => a + b, 0), cap: GOODS_CAP,
    });
  }

  marketValid(conn) {
    const m = conn.market, p = conn.player;
    if (!m || p.mode !== 'surface' || p.planet !== m.pid) return null;
    const planet = this.w.surfaces.instance(m.pid).planet;
    const town = townsOf(planet).find((t) => t.id === m.town);
    if (!town || Math.hypot(town.x - p.px, town.z - p.pz) > town.radius + 20) return null;
    return { town, pid: m.pid, realm: m.realm };
  }

  buy(conn, { good, qty }) {
    const v = this.marketValid(conn);
    qty = Math.max(1, Math.min(20, qty | 0));
    if (!v || !GOODS[good] || !this.politics.marketGoods(v.town).includes(good)) return;
    const p = conn.player;
    p.goods ||= {};
    const carried = Object.values(p.goods).reduce((a, b) => a + b, 0);
    if (carried + qty > GOODS_CAP) return conn.send({ t: 'toast', msg: `You can carry ${GOODS_CAP} goods at most.` });
    const cost = this.politics.price(v.pid, v.town, good) * qty;
    if (!this.pay(conn, v.pid, v.realm, cost)) return conn.send({ t: 'toast', msg: `Not enough ${this.coinName(v.pid, v.realm)} (or credits to cover it).` });
    p.goods[good] = (p.goods[good] || 0) + qty;
    this.politics.traded(v.pid, v.town, good, qty);
    this.w.skills?.gain(conn, 'trade', qty);
    this.w.sendSelf(conn);
    this.market(conn, v.pid, v.town);
  }

  sell(conn, { good, qty }) {
    const v = this.marketValid(conn);
    const p = conn.player;
    qty = Math.max(1, Math.min(p.goods?.[good] || 0, qty | 0));
    if (!v || !GOODS[good] || !(p.goods?.[good] >= qty)) return;
    const price = Math.max(1, Math.floor(this.politics.price(v.pid, v.town, good) * 0.8 * (1 + (p.skillBonus?.trade || 0))));
    p.goods[good] -= qty;
    if (!p.goods[good]) delete p.goods[good];
    p.coins ||= {};
    p.coins[v.realm] = (p.coins[v.realm] || 0) + price * qty;
    this.politics.traded(v.pid, v.town, good, -qty);
    // Bringing goods a town needs wins friends.
    if (!PEOPLES[v.town.people].goods.includes(good)) this.politics.changeStanding(conn, v.pid, v.realm, Math.min(3, qty * 0.2));
    this.w.skills?.gain(conn, 'trade', qty * 2);
    this.w.sendSelf(conn);
    this.market(conn, v.pid, v.town);
  }

  // Credits to local coin and back, with a 5% fee each way.
  exchange(conn, { dir, amount }) {
    const v = this.marketValid(conn);
    const p = conn.player;
    amount = Math.max(1, Math.min(100000, amount | 0));
    if (!v) return;
    const rate = this.politics.coinRate(v.pid, v.realm);
    p.coins ||= {};
    if (dir === 'buy') {
      const cost = Math.ceil(amount * rate * 1.05);
      if (p.credits < cost) return conn.send({ t: 'toast', msg: `That costs ${cost} cr.` });
      p.credits -= cost;
      p.coins[v.realm] = (p.coins[v.realm] || 0) + amount;
    } else {
      amount = Math.min(amount, p.coins[v.realm] || 0);
      if (!amount) return;
      p.coins[v.realm] -= amount;
      p.credits += Math.floor(amount * rate * 0.95);
    }
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.market(conn, v.pid, v.town, true);
  }
}
