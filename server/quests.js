// Questlines from the people of planet towns. Quests are made from what's actually going on:
// a famine needs grain, a plague needs herbs, bandits need killing, a war needs arms and
// soldiers and, eventually, someone to carry the terms of peace. Finishing one stage of a line
// leads to the next. When the world moves on (the famine ends, the giver dies, the war is
// won, the town changes hands) quests rewrite themselves. Their outcomes change the realms.

import { townsOf, personName } from '../shared/towns.js';
import { faunaOf, structuresOf, SURFACE_HALF } from '../shared/planet.js';
import { PEOPLES, GOODS } from '../shared/content/peoples.js';
import { ORES } from '../shared/rules.js';
import { CREATURES } from '../shared/content/creatures.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { randomItem } from '../shared/items.js';
import { mulberry32, hashString } from '../shared/rng.js';

const MAX_ACTIVE = 5;
const CHECK_MS = 4000;
let nextQuest = 1;

const pickR = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export class Quests {
  constructor(world) {
    this.w = world;
    this.lastCheck = 0;
  }

  get politics() { return this.w.politics; }

  // ---- making quests -------------------------------------------------------------------------

  // What this person might ask of a pilot, given the state of their realm. Offers are stable
  // for an hour so asking twice doesn't reroll them.
  offersFor(conn, cur) {
    const { c, town, pid, inst } = cur;
    const p = conn.player;
    const s = this.politics.state(pid), realmId = this.politics.ownerOf(pid, town);
    const realm = s.realms[realmId], def = this.politics.realmDef(pid, realmId);
    if (!realm || !def) return [];
    const rng = mulberry32(hashString(`${c.npc}:${Math.floor(Date.now() / 3600000)}`));
    const planet = inst.planet, towns = townsOf(planet);
    const giver = { npc: c.npc, name: c.name, role: c.role };
    const base = { pid, realm: realmId, town: town.id, townName: town.name, giver };
    const rich = planet.richness;
    const coin = (n) => Math.round(n * (0.7 + 0.3 * rich) / this.politics.coinRate(pid, realmId));
    const out = [];
    const ev = realm.event?.kind;

    if (ev === 'famine' && ['steward', 'ruler', 'farmer', 'innkeeper', 'priest'].includes(c.role)) {
      const good = PEOPLES[town.people].goods.includes('grain') ? 'meat' : 'grain';
      out.push({ ...base, line: 'famine', title: `Bread for ${town.name}`, requires: { event: 'famine' },
        intro: `The granaries are empty. Bring ${good === 'grain' ? 'grain' : 'smoked meat'} from wherever it can be bought, and ${town.name} will remember it.`,
        steps: [{ type: 'bring', src: 'goods', item: good, need: 8, to: town.id, text: `Bring 8 ${GOODS[good].name} to ${town.name}` }],
        reward: { coins: coin(220), standing: 14, stability: 8 }, chronicle: `${p.name} brought food to starving ${town.name}.` });
    }
    if (ev === 'plague' && ['healer', 'priest', 'steward', 'ruler'].includes(c.role)) {
      out.push({ ...base, line: 'plague', title: 'Herbs against the sickness', requires: { event: 'plague' },
        intro: 'The sickness spreads faster than we can brew remedies. We need herbs, as many as you can carry.',
        steps: [{ type: 'bring', src: 'goods', item: 'herbs', need: 6, to: town.id, text: `Bring 6 Herbs to ${town.name}` }],
        reward: { coins: coin(200), standing: 14, stability: 6, endEvent: true }, chronicle: `${p.name}'s herbs broke the plague in ${town.name}.` });
    }
    if ((ev === 'raiders' || rng() < 0.45) && ['captain', 'guard', 'steward', 'ruler', 'hunter', 'innkeeper'].includes(c.role)) {
      out.push(this.banditStage(base, planet, town, 0, coin, rng, p));
    }
    if (realm.war && ['captain', 'smith', 'ruler', 'steward'].includes(c.role)) {
      const enemy = this.politics.realmDef(pid, realm.war.with);
      if (enemy) out.push(this.warStage(base, planet, town, realm.war.with, enemy, 0, coin, rng));
    }
    if (!realm.war && ['ruler', 'steward'].includes(c.role)) {
      const rels = Object.entries(realm.relations).filter(([id]) => this.politics.realmDef(pid, id));
      const [other, rel] = rels.sort((a, b) => a[1] - b[1])[0] || [];
      if (other) {
        const od = this.politics.realmDef(pid, other);
        const capital = towns.find((t) => t.id === od.capital);
        if (capital) out.push({ ...base, line: `envoy:${other}`, title: `An envoy to the ${od.name}`,
          intro: rel < -20 ? `Relations with the ${od.name} are poisoned. Carry this letter to their ruler in ${capital.name}. It offers peace, if they're wise enough to take it.` : `Carry our greetings and a proposal of trade to the ruler of the ${od.name} in ${capital.name}.`,
          steps: [{ type: 'choice', to: capital.id, role: 'ruler', text: `Deliver the letter to the ruler of ${capital.name}`,
            options: [{ id: 'faithful', text: 'Deliver the letter as written.', effects: { relations: [realmId, other, 25] } },
              { id: 'insult', text: 'Rewrite it into an insult before handing it over.', effects: { relations: [realmId, other, -40], standing: { [other]: -20 } } }] },
          { type: 'report', to: town.id, text: `Return to ${town.name}` }],
          reward: { coins: coin(240), standing: 10 } });
      }
    }
    if (c.role === 'hunter' || (c.role === 'farmer' && rng() < 0.5)) {
      const fauna = faunaOf(planet).filter((f) => CREATURES[f]);
      if (fauna.length) {
        const sp = pickR(rng, fauna), n = 3 + Math.floor(rng() * 4);
        out.push({ ...base, line: `hunt:${sp}`, title: `Hunt the ${CREATURES[sp].name}`,
          intro: `${CREATURES[sp].name}s have been taking ${c.role === 'farmer' ? 'our animals' : 'the game from my traps'}. Thin them out.`,
          steps: [{ type: 'kill', species: sp, need: n, have: 0, text: `Kill ${n} ${CREATURES[sp].name}` }, { type: 'report', to: town.id, npc: c.npc, text: `Return to ${c.name} in ${town.name}` }],
          reward: { coins: coin(120 + n * 20), standing: 6, goods: { pelts: 3 } } });
      }
    }
    if (c.role === 'smith') {
      const ore = pickR(rng, ['iron', 'copper', 'gold'].filter((o) => ORES[o]));
      const n = ore === 'gold' ? 8 : 20;
      out.push({ ...base, line: `ore:${ore}`, title: 'Ore for the forge',
        intro: `My forge is cold for want of ${ORES[ore].name.toLowerCase()}. Dig me some and I'll make it worth your while.`,
        steps: [{ type: 'bring', src: 'cargo', item: ore, need: n, to: town.id, npc: c.npc, text: `Bring ${n} ${ORES[ore].name} to ${c.name}` }],
        reward: { coins: coin(80), standing: 6, item: rich + 1 } });
    }
    if (c.role === 'merchant') {
      const others = towns.filter((t) => t.id !== town.id);
      const src = others.length ? pickR(rng, others) : null;
      const good = src ? PEOPLES[src.people].goods.find((g) => !PEOPLES[town.people].goods.includes(g) && GOODS[g]) : null;
      if (src && good) out.push({ ...base, line: `trade:${good}`, title: `A trade run to ${src.name}`,
        intro: `They sell ${GOODS[good].name.toLowerCase()} in ${src.name}, and people here pay well for it. Buy five and bring them to me.`,
        steps: [{ type: 'bring', src: 'goods', item: good, need: 5, to: town.id, npc: c.npc, text: `Buy 5 ${GOODS[good].name} in ${src.name}, bring them to ${c.name}` }],
        reward: { coins: coin(60) + Math.round(GOODS[good].price * 5 * 1.6 / this.politics.coinRate(pid, realmId)), standing: 5 } });
    }
    if (['innkeeper', 'bard', 'farmer', 'steward', 'merchant'].includes(c.role)) {
      const far = towns.filter((t) => t.id !== town.id);
      if (far.length) {
        const to = pickR(rng, far);
        out.push({ ...base, line: `letter:${to.id}`, title: `A letter for ${to.name}`,
          intro: `Would you carry a letter to ${to.name}? ${pickR(rng, ['My sister lives there.', 'An old debt needs settling.', "It's a love letter. Don't read it."])}`,
          steps: [{ type: 'deliver', to: to.id, text: `Deliver the letter to anyone in ${to.name}` }],
          reward: { coins: coin(70), standing: 4 } });
      }
    }
    const structs = structuresOf(planet);
    if (['mage', 'priest', 'ruler', 'captain'].includes(c.role)) {
      const dg = structs.find((st) => STRUCTURES[st.type].kind === 'dungeon');
      if (dg) out.push({ ...base, line: `dungeon:${dg.id}`, title: `The darkness under ${STRUCTURES[dg.type].name}`,
        intro: `Something old stirs beneath the ${STRUCTURES[dg.type].name}. Go down, kill what rules it, and come back alive.`,
        steps: [{ type: 'dungeon', st: dg.id, x: dg.x, z: dg.z, text: `Defeat the master of the ${STRUCTURES[dg.type].name}` }, { type: 'report', to: town.id, text: `Return to ${town.name}` }],
        reward: { coins: coin(400), standing: 15, item: rich + 2 }, chronicle: `${p.name} cleansed the ${STRUCTURES[dg.type].name}.` });
      const ruin = structs.find((st) => STRUCTURES[st.type].cache && STRUCTURES[st.type].kind === 'ruin');
      if (ruin && !p.looted[`${pid}#${ruin.id}`]) out.push({ ...base, line: `ruin:${ruin.id}`, title: `Secrets of the ${STRUCTURES[ruin.type].name}`,
        intro: `The ${STRUCTURES[ruin.type].name} holds secrets of the old world. Search it and tell me what you find.`,
        steps: [{ type: 'search', st: ruin.id, x: ruin.x, z: ruin.z, text: `Search the ${STRUCTURES[ruin.type].name}` }, { type: 'report', to: town.id, npc: c.npc, text: `Tell ${c.name} what you found` }],
        reward: { coins: coin(160), standing: 6 } });
    }
    // Leave out what the pilot is already doing.
    const active = new Set((p.quests || []).filter((q) => q.status === 'active' || q.status === 'changed').map((q) => q.line + '@' + q.pid));
    return out.filter((q) => q && !active.has(q.line + '@' + q.pid)).slice(0, c.role === 'ruler' ? 2 : 1);
  }

  // The bandit questline: break a camp, then hunt down their chief, then report to the ruler.
  banditStage(base, planet, town, stage, coin, rng, p) {
    const ang = rng() * Math.PI * 2, dist = town.radius + 110 + stage * 50;
    let x = town.x + Math.cos(ang) * dist, z = town.z + Math.sin(ang) * dist;
    const lim = SURFACE_HALF - 60;
    x = Math.max(-lim, Math.min(lim, x)); z = Math.max(-lim, Math.min(lim, z));
    if (stage === 0) {
      return { ...base, line: 'bandits', stage: 0, title: 'The bandit problem',
        intro: `Bandits have made camp in the hills and they bleed our roads dry. Break that camp. I'll mark it for you.`,
        steps: [{ type: 'camp', x, z, need: 4, have: 0, text: 'Break the bandit camp' }, { type: 'report', to: town.id, text: `Report back in ${town.name}` }],
        reward: { coins: coin(180), standing: 10, endEvent: 'raiders' } };
    }
    return { ...base, line: 'bandits', stage: 1, title: 'The bandit chief',
      intro: `Those were only his dogs. The chief has a lair further out. End him and the roads will be safe for a generation.`,
      steps: [{ type: 'camp', x, z, need: 5, have: 0, chief: true, text: 'Kill the bandit chief and his guard' }, { type: 'report', to: town.id, role: 'ruler', text: `Report to the ruler in the capital (or anyone in ${town.name})` }],
      reward: { coins: coin(420), standing: 18, stability: 8, item: planet.richness + 2 }, chronicle: `${p.name} killed the bandit chief who plagued ${town.name}.` };
  }

  // The war questline: arm the front, break the enemy's raiders, then carry terms to their ruler.
  warStage(base, planet, town, enemyId, enemy, stage, coin, rng) {
    const towns = townsOf(planet);
    const capital = towns.find((t) => t.id === enemy.capital);
    const req = { war: enemyId };
    if (stage === 0) {
      return { ...base, line: `war:${enemyId}`, stage: 0, title: `Arms for the war with the ${enemy.name}`, requires: req,
        intro: `We are at war with the ${enemy.name} and our smiths have no iron. Bring ore and we'll hammer it into spears.`,
        steps: [{ type: 'bring', src: 'cargo', item: 'iron', need: 25, to: town.id, text: `Bring 25 Iron to ${town.name}` }],
        reward: { coins: coin(200), standing: 10, war: 1 } };
    }
    if (stage === 1) {
      const ang = rng() * Math.PI * 2, d = town.radius + 140;
      return { ...base, line: `war:${enemyId}`, stage: 1, title: `Break the ${enemy.name} war band`, requires: req,
        intro: `A war band of the ${enemy.name} is camped within sight of our walls. Scatter them.`,
        steps: [{ type: 'camp', x: town.x + Math.cos(ang) * d, z: town.z + Math.sin(ang) * d, need: 5, have: 0, enemy: enemyId, text: `Defeat the ${enemy.name} war band` }, { type: 'report', to: town.id, text: `Return to ${town.name}` }],
        reward: { coins: coin(320), standing: 14, war: 3 } };
    }
    if (!capital) return null;
    return { ...base, line: `war:${enemyId}`, stage: 2, title: `Terms for the ${enemy.name}`, requires: req,
      intro: `They are bloodied now. Carry our terms to their ruler in ${capital.name}. Peace, if they'll take it. Or a threat, if you think they deserve one.`,
      steps: [{ type: 'choice', to: capital.id, role: 'ruler', text: `Deliver the terms to the ruler of ${capital.name}`,
        options: [{ id: 'peace', text: 'Offer peace on fair terms.', effects: { peace: true } },
          { id: 'threat', text: 'Deliver a threat: surrender or burn.', effects: { war: 4, standing: { [enemyId]: -25 } } }] },
      { type: 'report', to: town.id, text: `Return to ${town.name}` }],
      reward: { coins: coin(500), standing: 20, item: planet.richness + 2 }, chronicle: null };
  }

  // Next stage of a questline, when there is one.
  followUp(conn, q) {
    const pid = q.pid, planet = this.w.surfaces.instance(pid).planet;
    const town = townsOf(planet).find((t) => t.id === q.town);
    if (!town) return null;
    const rng = mulberry32(hashString(q.id + 'next'));
    const coin = (n) => Math.round(n * (0.7 + 0.3 * planet.richness) / this.politics.coinRate(pid, q.realm));
    const base = { pid, realm: q.realm, town: q.town, townName: q.townName, giver: q.giver };
    if (q.line === 'bandits' && (q.stage || 0) === 0) return this.banditStage(base, planet, town, 1, coin, rng, conn.player);
    if (q.line.startsWith('war:') && (q.stage || 0) < 2) {
      const enemyId = q.line.slice(4), enemy = this.politics.realmDef(pid, enemyId);
      if (enemy && this.politics.atWar(pid, q.realm, enemyId)) return this.warStage(base, planet, town, enemyId, enemy, (q.stage || 0) + 1, coin, rng);
    }
    return null;
  }

  // ---- talking about quests ----------------------------------------------------------------------

  offer(conn, cur) {
    const offers = this.offersFor(conn, cur);
    conn.pendingOffers = new Map();
    if (!offers.length) return conn.send({ t: 'talk_line', id: cur.c.id, line: pickR(Math.random, ["Nothing I'd trust a stranger with. Not today.", 'No work, friend. Ask again another day.', 'Things are quiet. For now.']) });
    const opts = [];
    let line = '';
    offers.forEach((q, i) => {
      const id = `o${i}`;
      conn.pendingOffers.set(id, q);
      line += (i ? ' Or… ' : '') + q.intro;
      opts.push([`accept:${id}`, `Accept: ${q.title}`]);
    });
    opts.push(['decline', 'Not now.']);
    conn.send({ t: 'talk_line', id: cur.c.id, line, options: opts });
  }

  accept(conn, cur, offerId) {
    const q = conn.pendingOffers?.get(offerId);
    if (!q) return;
    const p = conn.player;
    p.quests ||= [];
    const live = p.quests.filter((x) => x.status === 'active' || x.status === 'changed');
    if (live.length >= MAX_ACTIVE) return conn.send({ t: 'talk_line', id: cur.c.id, line: "You've too much on your plate already. Finish something first. (Abandon quests in the journal, J.)" });
    this.start(conn, q);
    conn.pendingOffers.delete(offerId);
    conn.send({ t: 'talk_line', id: cur.c.id, line: pickR(Math.random, ['Good. Don\'t make me regret this.', 'Then go, and luck go with you.', 'I knew I could count on you.']), options: this.w.talk.options(conn, cur.c) });
  }

  start(conn, q) {
    const p = conn.player;
    const quest = { ...q, id: `q${Date.now().toString(36)}${nextQuest++}`, step: 0, status: 'active', at: Date.now() };
    quest.steps = q.steps.map((s) => ({ ...s, have: s.have || 0 }));
    p.quests = [...(p.quests || []).filter((x) => x.status === 'active' || x.status === 'changed'), quest];
    conn.send({ t: 'toast', msg: `New quest: ${quest.title}` });
    this.sync(conn);
  }

  // Extra things to say to this person, for quests that lead to them.
  talkOptions(conn, c) {
    const p = conn.player, out = [];
    for (const q of p.quests || []) {
      if (q.status !== 'active' && q.status !== 'changed') continue;
      const s = q.steps[q.step];
      if (!s || !this.isTarget(conn, s, c, q)) continue;
      if (s.type === 'choice') for (const o of s.options) out.push([`q:${q.id}:${o.id}`, o.text]);
      else if (s.type === 'bring') out.push([`q:${q.id}`, `I have the ${s.src === 'cargo' ? ORES[s.item]?.name : GOODS[s.item]?.name} you asked for. (${s.need})`]);
      else if (s.type === 'deliver') out.push([`q:${q.id}`, `I bring a letter from ${q.townName}.`]);
      else if (s.type === 'report') out.push([`q:${q.id}`, `About "${q.title}"…`]);
    }
    return out;
  }

  isTarget(conn, s, c, q) {
    if (!['bring', 'deliver', 'report', 'choice'].includes(s.type)) return false;
    if (s.role === 'ruler') {
      if (s.type === 'choice') return c.role === 'ruler' && c.town === s.to;
      // Reporting to a ruler: their own ruler anywhere, or anyone back in the quest's town.
      return (c.role === 'ruler' && c.realm === q.realm) || c.town === s.to;
    }
    if (s.to && s.to !== c.town) return false;
    if (s.npc && s.npc !== c.npc && !this.giverGone(conn, s)) return false;
    return true;
  }

  giverGone(conn, s) {
    const pid = conn.player.planet;
    return !!this.politics.state(pid)?.dead[s.npc];
  }

  talkAction(conn, cur, opt) {
    const [, qid, choice] = opt.split(':');
    const p = conn.player;
    const q = (p.quests || []).find((x) => x.id === qid);
    if (!q) return;
    const s = q.steps[q.step];
    if (!s || !this.isTarget(conn, s, cur.c, q)) return;
    const say = (line) => conn.send({ t: 'talk_line', id: cur.c.id, line, options: this.w.talk.options(conn, cur.c) });
    if (s.type === 'bring') {
      const store = s.src === 'cargo' ? p.cargo : (p.goods ||= {});
      if ((store[s.item] || 0) < s.need) return say(`That's not ${s.need}. Come back when you have them all.`);
      store[s.item] -= s.need;
      if (!store[s.item]) delete store[s.item];
      this.advance(conn, q, 'Bless you. That is exactly what we needed.', cur);
    } else if (s.type === 'deliver') {
      this.advance(conn, q, pickR(Math.random, ['A letter? For me? …Thank you, traveler.', 'Ah, news from home. Here, for your trouble.']), cur);
    } else if (s.type === 'choice') {
      const o = s.options.find((x) => x.id === choice);
      if (!o) return;
      this.applyEffects(conn, q, o.effects || {});
      q.choice = o.id;
      this.advance(conn, q, o.id === 'faithful' || o.id === 'peace' ? 'We will consider it. Tell your masters they will have our answer.' : 'How dare you. Get out, before I forget the custom of envoys.', cur);
    } else if (s.type === 'report') {
      this.advance(conn, q, q.status === 'changed' ? "Things have changed, but you kept your word. Here's what I can give you." : 'Well done. Here, you earned this.', cur);
    }
  }

  // ---- progress -------------------------------------------------------------------------------------

  advance(conn, q, line, cur) {
    const s = q.steps[q.step];
    s.done = true;
    q.step++;
    if (q.step >= q.steps.length) return this.complete(conn, q, line, cur);
    conn.send({ t: 'toast', msg: `${q.title}: ${q.steps[q.step].text}` });
    if (cur && line) conn.send({ t: 'talk_line', id: cur.c.id, line, options: this.w.talk.options(conn, cur.c) });
    this.sync(conn);
  }

  complete(conn, q, line, cur) {
    const p = conn.player, pid = q.pid;
    q.status = 'done';
    const r = q.reward || {}, partial = q.partial || 1;
    const lootK = this.w.director?.loot || 1;
    if (r.coins) { p.coins ||= {}; p.coins[q.realm] = (p.coins[q.realm] || 0) + Math.round(r.coins * partial * lootK); }
    this.w.director?.record('quests');
    if (r.credits) p.credits += Math.round(r.credits * partial);
    if (r.standing) this.politics.changeStanding(conn, pid, q.realm, Math.round(r.standing * partial));
    if (r.goods) { p.goods ||= {}; for (const [g, n] of Object.entries(r.goods)) p.goods[g] = (p.goods[g] || 0) + n; }
    if (partial >= 1) {
      this.applyEffects(conn, q, r);
      if (r.item) this.w.giveItem(conn, randomItem(r.item));
      if (q.chronicle) this.politics.chronicle(pid, q.chronicle);
    }
    this.w.skills?.gain(conn, 'speech', 30);
    const coinName = this.politics.realmDef(pid, q.realm)?.coin?.[1] || 'coins';
    conn.send({ t: 'toast', msg: `Quest complete: ${q.title}${r.coins ? ` (+${Math.round(r.coins * partial)} ${coinName})` : ''}` });
    if (cur && line) conn.send({ t: 'talk_line', id: cur.c.id, line, options: this.w.talk.options(conn, cur.c) });
    p.quests = p.quests.filter((x) => x.status === 'active' || x.status === 'changed');
    p.questsDone = (p.questsDone || 0) + 1;
    // The next chapter, if the story goes on.
    const next = partial >= 1 ? this.followUp(conn, q) : null;
    if (next) {
      this.start(conn, next);
      if (cur) conn.send({ t: 'talk_line', id: cur.c.id, line: next.intro, options: this.w.talk.options(conn, cur.c) });
    }
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.sync(conn);
  }

  applyEffects(conn, q, e) {
    const pid = q.pid, s = this.politics.state(pid);
    const realm = s.realms[q.realm];
    if (e.stability && realm) realm.stability = Math.min(100, realm.stability + e.stability);
    if (e.endEvent && realm?.event && (e.endEvent === true || e.endEvent === realm.event.kind)) realm.event.until = Date.now();
    if (e.war && realm?.war) realm.war.score += e.war;
    if (e.relations) {
      const [a, b, d] = e.relations;
      if (s.realms[a] && s.realms[b]) {
        const v = Math.max(-100, Math.min(100, (s.realms[a].relations[b] || 0) + d));
        s.realms[a].relations[b] = s.realms[b].relations[a] = v;
        const da = this.politics.realmDef(pid, a), db = this.politics.realmDef(pid, b);
        this.politics.chronicle(pid, d > 0 ? `An envoy carried by ${conn.player.name} has warmed relations between the ${da.name} and the ${db.name}.` : `An insulting letter delivered by ${conn.player.name} has enraged the ${db.name} against the ${da.name}.`);
      }
    }
    if (e.peace && realm?.war) {
      const other = realm.war.with;
      realm.war = null;
      if (s.realms[other]) s.realms[other].war = null;
      realm.relations[other] = s.realms[other].relations[q.realm] = 10;
      this.politics.chronicle(pid, `Thanks to terms carried by ${conn.player.name}, the ${this.politics.realmDef(pid, q.realm).name} and the ${this.politics.realmDef(pid, other).name} are at peace.`);
    }
    if (e.standing) for (const [rid, d] of Object.entries(e.standing)) this.politics.changeStanding(conn, pid, rid, d);
    this.w.dirty = true;
  }

  // A creature or person was killed by this pilot.
  onKill(conn, pid, c) {
    for (const q of conn.player.quests || []) {
      if (q.status !== 'active' || q.pid !== pid) continue;
      const s = q.steps[q.step];
      if (!s) continue;
      if ((s.type === 'kill' && c.species === s.species) || (s.type === 'camp' && c.quest === q.id)) {
        s.have = (s.have || 0) + 1;
        if (s.have >= s.need) this.advance(conn, q);
        else this.sync(conn);
      }
    }
  }

  // Something happened: a dungeon cleared, a ruin searched.
  onEvent(conn, kind, { pid, st }) {
    for (const q of conn.player.quests || []) {
      if (q.status !== 'active' || q.pid !== pid) continue;
      const s = q.steps[q.step];
      if (s && s.type === kind && s.st === st) this.advance(conn, q);
    }
  }

  // Talking to anyone in a town can complete a delivery, so check when a conversation opens.
  onTalk(conn, c) {
    for (const q of conn.player.quests || []) {
      const s = q.steps[q.step];
      if (q.status === 'active' && s?.type === 'deliver' && s.to === c.town) return true;
    }
    return false;
  }

  // ---- keeping quests honest as the world changes -----------------------------------------------------

  tick(now) {
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    for (const conn of this.w.conns()) {
      const p = conn.player;
      if (!p.quests?.length) continue;
      for (const q of p.quests) if (q.status === 'active') this.validate(conn, q);
      if (p.mode === 'surface') this.spawnCamps(conn);
    }
  }

  validate(conn, q) {
    const s = this.politics.state(q.pid);
    if (!s) return;
    const realm = s.realms[q.realm], def = this.politics.realmDef(q.pid, q.realm);
    const change = (note) => {
      q.status = 'changed';
      q.note = note;
      q.partial = 0.5;
      q.steps = [...q.steps.slice(0, q.step), { type: 'report', to: q.town, text: `Report to anyone in ${q.townName}` }];
      conn.send({ t: 'toast', msg: `${q.title}: ${note}` });
      this.sync(conn);
    };
    if (q.requires?.event && realm?.event?.kind !== q.requires.event) return change(`The ${q.requires.event} is over. ${q.townName} will still pay for the effort.`);
    if (q.requires?.war && !(realm?.war?.with === q.requires.war)) return change('The war is over. Report back for what pay there is.');
    // The town has changed hands: the new masters may or may not honor the bargain.
    const planet = this.w.surfaces.instance(q.pid)?.planet;
    const town = planet && townsOf(planet).find((t) => t.id === q.town);
    if (town && this.politics.ownerOf(q.pid, town) !== q.realm) {
      q.realm = this.politics.ownerOf(q.pid, town);
      q.note = `${q.townName} now belongs to the ${this.politics.realmDef(q.pid, q.realm)?.name}. They'll honor the contract.`;
      conn.send({ t: 'toast', msg: q.note });
      this.sync(conn);
    }
    if (q.giver?.npc && s.dead[q.giver.npc] && !q.giverDeadNoted) {
      q.giverDeadNoted = true;
      q.note = `${q.giver.name} is dead. Anyone in ${q.townName} will settle the debt.`;
      for (const st of q.steps) if (st.npc === q.giver.npc) st.npc = null;
      conn.send({ t: 'toast', msg: q.note });
      this.sync(conn);
    }
    if (!def) q.status = 'failed';
  }

  // Bandit camps and war bands appear when the pilot comes near the marked spot.
  spawnCamps(conn) {
    const p = conn.player;
    const inst = this.w.surfaces.instance(p.planet);
    inst.camps ||= new Set();
    for (const q of p.quests) {
      const s = q.steps[q.step];
      if (q.status !== 'active' || q.pid !== p.planet || s?.type !== 'camp' || inst.camps.has(q.id)) continue;
      if (Math.hypot(p.px - s.x, p.pz - s.z) > 90) continue;
      inst.camps.add(q.id);
      const town = townsOf(inst.planet).find((t) => t.id === q.town);
      if (!town) continue;
      const enemy = s.enemy ? this.politics.realmDef(q.pid, s.enemy) : null;
      const people = enemy ? enemy.people : 'human';
      const rng = mulberry32(hashString(q.id));
      const left = s.need - (s.have || 0);
      for (let i = 0; i < left; i++) {
        const a = (i / left) * Math.PI * 2, chief = s.chief && i === 0;
        const npc = { id: `camp:${q.id}:${i}`, role: chief ? 'captain' : 'guard', people, female: rng() < 0.35, look: Math.floor(rng() * 1e9), home: [s.x + Math.cos(a) * 6, s.z + Math.sin(a) * 6] };
        const c = this.w.surfaces.natives.make(inst, town, npc, { raider: true, bandit: !enemy, defender: q.realm, target: null, realm: enemy ? s.enemy : null, quest: q.id, leash: 70, home: [s.x, s.z] });
        c.name = chief ? `${personName(people, rng)} the Bandit Chief` : enemy ? `${enemy.name.split(' ').pop()} soldier` : 'Bandit';
        if (chief) { c.hp = c.maxHp = c.maxHp * 2.5; c.dmg *= 1.6; }
        c.x = npc.home[0]; c.z = npc.home[1];
        c.aggro = p.key;
      }
      conn.send({ t: 'toast', msg: enemy ? 'The war band spots you!' : 'Bandits! They spotted you!' });
    }
  }

  abandon(conn, { id }) {
    const p = conn.player;
    p.quests = (p.quests || []).filter((q) => q.id !== id);
    this.sync(conn);
  }

  // Quests as the client shows them (journal, HUD, markers).
  view(p) {
    return (p.quests || []).filter((q) => q.status === 'active' || q.status === 'changed').map((q) => {
      const planet = this.w.surfaces.instance(q.pid)?.planet;
      const s = q.steps[q.step];
      let mark = null;
      if (s && (s.x != null)) mark = [s.x, s.z];
      else if (s?.to && planet) { const t = townsOf(planet).find((x) => x.id === s.to); if (t) mark = [t.x, t.z]; }
      return { id: q.id, title: q.title, pid: q.pid, planet: planet?.name, town: q.townName, giver: q.giver?.name, steps: q.steps.map((x) => ({ text: x.text, done: !!x.done, have: x.have, need: x.need })), step: q.step, note: q.note || null, status: q.status, mark };
    });
  }

  sync(conn) {
    conn.send({ t: 'quests', list: this.view(conn.player) });
    this.w.dirty = true;
  }
}
