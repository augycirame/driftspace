// The director: an AI that runs the game from the inside. Every minute it measures how the
// galaxy is playing (deaths, kills, income, server load, how much is happening) and nudges
// the dials that keep it fun and fast: difficulty, rewards and spawn levels. When things get
// quiet it stages world events. If a Claude API key is configured, a "game master" model
// reviews the numbers every so often and makes the bigger calls, but only within fixed
// bounds: it can turn the dials a little and pick from a menu of events, nothing more.

import { GODS, GOD_IDS } from '../shared/content/factions.js';
import { findPlanet } from '../shared/universe.js';
import { realmsOf } from '../shared/towns.js';

const MINUTE = 60000;
const WINDOW = 30;                  // minutes of history kept
const LIMITS = { difficulty: [0.6, 1.6], loot: [0.6, 1.5], spawns: [0.35, 1.2] };
const TARGET = { deathsPerHour: [0.6, 3], incomePerHour: [1200, 9000], tickMs: [18, 45] };
const QUIET_MS = 18 * MINUTE;
const GM_EVERY_MS = 15 * MINUTE;
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

export class Director {
  constructor(world) {
    this.w = world;
    world.data.director ||= { difficulty: 1, loot: 1, spawns: 1, log: [], lastEvent: Date.now(), lastGm: 0 };
    this.s = world.data.director;
    this.buckets = [];               // one per minute
    this.cur = this.bucket();
    this.lastMinute = Date.now();
    this.lastCredits = new Map();
    this.tickTimes = [];
    this.thinking = false;
  }

  bucket() { return { t: Date.now(), deaths: 0, kills: 0, income: 0, playerMinutes: 0, quests: 0, events: 0 }; }

  // Dials the rest of the game reads.
  get difficulty() { return this.s.difficulty; }
  get loot() { return this.s.loot; }
  get spawns() { return this.s.spawns; }

  record(kind, n = 1) { if (kind in this.cur) this.cur[kind] += n; }
  tickTime(ms) { this.tickTimes.push(ms); if (this.tickTimes.length > 600) this.tickTimes.shift(); }

  note(text) {
    this.s.log.push({ t: Date.now(), text });
    if (this.s.log.length > 40) this.s.log.shift();
    this.w.log(`[director] ${text}`);
    this.w.dirty = true;
  }

  // ---- measuring ----------------------------------------------------------------------------

  sampleIncome() {
    for (const c of this.w.conns()) {
      const p = c.player, before = this.lastCredits.get(p.key);
      if (before != null && p.credits > before) this.cur.income += p.credits - before;
      this.lastCredits.set(p.key, p.credits);
    }
    this.cur.playerMinutes += this.w.conns().length;
  }

  metrics() {
    const b = this.buckets.slice(-WINDOW);
    const sum = (k) => b.reduce((a, x) => a + x[k], 0);
    const hours = Math.max(1 / 60, sum('playerMinutes') / 60);
    const ticks = [...this.tickTimes].sort((a, c) => a - c);
    const creatures = [...this.w.surfaces.instances.values()].reduce((a, i) => a + i.creatures.size, 0);
    return {
      minutes: b.length, players: this.w.conns().length, playerHours: Math.round(hours * 100) / 100,
      deathsPerHour: Math.round((sum('deaths') / hours) * 10) / 10, killsPerHour: Math.round(sum('kills') / hours),
      incomePerHour: Math.round(sum('income') / hours), questsPerHour: Math.round((sum('quests') / hours) * 10) / 10,
      tickMs: ticks.length ? Math.round(ticks[Math.floor(ticks.length * 0.9)]) : 0, creatures, npcShips: this.w.combat.npcs.size,
      minutesSinceEvent: Math.round((Date.now() - this.s.lastEvent) / MINUTE),
    };
  }

  // ---- the rule-based hand on the dials ------------------------------------------------------

  adjust(m) {
    const s = this.s;
    const before = { difficulty: s.difficulty, loot: s.loot, spawns: s.spawns };
    // Server load first: if ticks run long, thin out the world; if there's headroom, fill it back.
    if (m.tickMs > TARGET.tickMs[1]) s.spawns = clamp(s.spawns - 0.1, LIMITS.spawns);
    else if (m.tickMs < TARGET.tickMs[0] && s.spawns < 1) s.spawns = clamp(s.spawns + 0.05, LIMITS.spawns);
    // Only judge difficulty and economy on enough play.
    if (m.playerHours >= 0.5) {
      if (m.deathsPerHour > TARGET.deathsPerHour[1]) s.difficulty = clamp(s.difficulty - 0.05, LIMITS.difficulty);
      else if (m.deathsPerHour < TARGET.deathsPerHour[0] && m.killsPerHour > 40) s.difficulty = clamp(s.difficulty + 0.04, LIMITS.difficulty);
      if (m.incomePerHour > TARGET.incomePerHour[1]) s.loot = clamp(s.loot - 0.05, LIMITS.loot);
      else if (m.incomePerHour < TARGET.incomePerHour[0]) s.loot = clamp(s.loot + 0.04, LIMITS.loot);
    }
    const moved = Object.keys(before).filter((k) => Math.abs(before[k] - s[k]) > 1e-6);
    if (moved.length) this.note(`Adjusted ${moved.map((k) => `${k} ${before[k].toFixed(2)}→${s[k].toFixed(2)}`).join(', ')} (deaths/h ${m.deathsPerHour}, income/h ${m.incomePerHour}, tick p90 ${m.tickMs} ms)`);
  }

  // ---- world events ------------------------------------------------------------------------------

  // Where the players are: the busiest planet, if any.
  busiestPlanet() {
    const count = new Map();
    for (const c of this.w.conns()) if (c.player.mode === 'surface') count.set(c.player.planet, (count.get(c.player.planet) || 0) + 1);
    let best = null, n = 0;
    for (const [pid, k] of count) if (k > n) { n = k; best = pid; }
    return best;
  }

  event(kind, { planet, text } = {}) {
    const pid = planet || this.busiestPlanet();
    const announce = (msg) => this.w.broadcast({ t: 'chat', from: null, text: `[The Galaxy] ${msg}` });
    switch (kind) {
      case 'raid': case 'festival': case 'famine': case 'plague': {
        if (!pid) return false;
        const realms = realmsOf(findPlanet(pid, this.w.seed));
        if (!realms.length) return false;
        const r = realms[Math.floor(Math.random() * realms.length)];
        this.w.politics.startEvent(pid, r.id, kind === 'raid' ? 'raiders' : kind, 15,
          text || { raid: `Raiders descend on the towns of the ${r.name}!`, festival: `The ${r.name} declares a great festival.`, famine: `Blight strikes the fields of the ${r.name}.`, plague: `A sickness spreads through the ${r.name}.` }[kind]);
        break;
      }
      case 'omen': {
        if (!pid) return false;
        const god = GOD_IDS[Math.floor(Math.random() * GOD_IDS.length)];
        for (const c of this.w.conns()) if (c.player.mode === 'surface' && c.player.planet === pid) this.w.bless(c, { god, name: `Omen of ${GODS[god].name.split(',')[0]}`, bonus: GODS[god].blessing }, 10);
        announce(text || `${GODS[god].name} turns an eye on ${findPlanet(pid, this.w.seed).name}. Everyone there is blessed.`);
        break;
      }
      case 'bounty': {
        const pilots = this.w.conns().filter((c) => c.player.mode === 'space' && !c.player.dead);
        if (!pilots.length) return false;
        const p = pilots[Math.floor(Math.random() * pilots.length)].player;
        for (let i = 0; i < 3; i++) this.w.combat.spawnNpc('pirate', p.x + 1500 + i * 120, p.y, p.z + 900, 1.3 * this.s.difficulty);
        announce(text || 'A pirate convoy has been sighted. There is a bounty on every ship.');
        break;
      }
      case 'bonanza': {
        this.s.bonanzaUntil = Date.now() + 15 * MINUTE;
        announce(text || 'A solar storm has charged the asteroid fields: mining yields double for fifteen minutes!');
        break;
      }
      default: return false;
    }
    this.s.lastEvent = Date.now();
    this.cur.events++;
    this.note(`Event: ${kind}${pid ? ` on ${findPlanet(pid, this.w.seed)?.name}` : ''}`);
    return true;
  }

  maybeEvent(m) {
    if (!m.players || Date.now() - this.s.lastEvent < QUIET_MS) return;
    const options = ['omen', 'bounty', 'bonanza'];
    if (this.busiestPlanet()) options.push('raid', 'festival', 'raid');
    for (let i = 0; i < 4; i++) if (this.event(options[Math.floor(Math.random() * options.length)])) return;
  }

  // ---- the game master (Claude) -------------------------------------------------------------------

  async gameMaster(m) {
    const ai = this.w.ai;
    if (this.thinking || !ai?.available() || !m.players || Date.now() - this.s.lastGm < GM_EVERY_MS) return;
    this.thinking = true;
    this.s.lastGm = Date.now();
    try {
      const planets = [...new Set(this.w.conns().filter((c) => c.player.mode === 'surface').map((c) => c.player.planet))];
      const chronicle = planets.flatMap((pid) => (this.w.politics.state(pid)?.log || []).slice(-3).map((e) => e.text));
      const report = {
        metrics: m, dials: { difficulty: this.s.difficulty, loot: this.s.loot, spawns: this.s.spawns }, limits: LIMITS, targets: TARGET,
        planetsWithPlayers: planets.map((pid) => ({ id: pid, name: findPlanet(pid, this.w.seed)?.name })),
        recentHistory: chronicle.slice(-8), recentDirectorNotes: this.s.log.slice(-6).map((e) => e.text),
      };
      const out = await ai.json({ system: GM_SYSTEM, schema: GM_SCHEMA, effort: 'medium', maxTokens: 4000, messages: [{ role: 'user', content: `<report>${JSON.stringify(report)}</report>` }] });
      if (!out) return;
      // Bounded: each dial moves at most 0.15 per decision and stays within limits.
      for (const k of ['difficulty', 'loot']) {
        const want = out[k];
        if (typeof want !== 'number' || !Number.isFinite(want)) continue;
        const next = clamp(Math.max(this.s[k] - 0.15, Math.min(this.s[k] + 0.15, want)), LIMITS[k]);
        if (Math.abs(next - this.s[k]) > 0.005) { this.note(`Game master set ${k} ${this.s[k].toFixed(2)}→${next.toFixed(2)}`); this.s[k] = next; }
      }
      if (out.event && out.event !== 'none') {
        const planet = planets.includes(out.planet) ? out.planet : null;
        this.event(out.event, { planet, text: typeof out.announcement === 'string' && out.announcement.trim() ? out.announcement.trim().slice(0, 240) : undefined });
      }
      if (typeof out.reasoning === 'string') this.note(`Game master: ${out.reasoning.slice(0, 300)}`);
    } finally {
      this.thinking = false;
    }
  }

  // ---- the clock ------------------------------------------------------------------------------------

  tick(now) {
    if (now - this.lastMinute < MINUTE) return;
    this.lastMinute = now;
    this.sampleIncome();
    this.buckets.push(this.cur);
    if (this.buckets.length > WINDOW) this.buckets.shift();
    this.cur = this.bucket();
    const m = this.metrics();
    this.adjust(m);
    this.maybeEvent(m);
    this.gameMaster(m).catch((e) => this.w.log('game master error', e.message));
  }

  bonanza() { return (this.s.bonanzaUntil || 0) > Date.now(); }

  status() {
    const m = this.metrics();
    return [`Difficulty ${this.s.difficulty.toFixed(2)} · loot ${this.s.loot.toFixed(2)} · spawns ${this.s.spawns.toFixed(2)}${this.bonanza() ? ' · BONANZA' : ''}`,
      `Last ${m.minutes} min: ${m.players} online, deaths/h ${m.deathsPerHour}, kills/h ${m.killsPerHour}, income/h ${m.incomePerHour}, tick p90 ${m.tickMs} ms, ${m.creatures} creatures, ${m.npcShips} ships`,
      `Game master: ${this.w.ai?.enabled ? 'on' : 'off (no API key)'}`,
      ...this.s.log.slice(-4).map((e) => `· ${e.text}`)];
  }
}

const GM_SYSTEM = `You are the game master of Driftspace, a multiplayer sandbox: an endless galaxy of space flight, mining, building, planets with native towns and realms, quests, magic and mechs. Your job is to keep the game fun, fair and running smoothly for whoever is playing right now.

Each report gives live metrics (deaths and kills per player-hour, credit income per player-hour, server tick time, creature and ship counts, minutes since the last world event), the current dials, their hard limits, target ranges, which planets have players, and recent history.

You may:
- set "difficulty" (enemy strength) and "loot" (reward multiplier) to new values; the game moves each by at most 0.15 toward your choice and keeps them inside their limits. Leave a dial unchanged by returning its current value.
- choose one "event": "none", "raid" (raiders attack a town), "festival", "famine", "plague", "omen" (a god blesses everyone on a planet for ten minutes), "bounty" (a pirate convoy appears near pilots in space), or "bonanza" (double mining yields for fifteen minutes). Name the target "planet" by id when the event needs one.
- write a one-sentence in-world "announcement" for the event, in the voice of the galaxy's news, with no mention of game mechanics or dials.

Guidance: players dying a lot means lower difficulty; players steamrolling everything means raise it. Income far above target means rewards are inflating; far below means the grind is too harsh. If the server is slow (high tick time), avoid events that add enemies. Prefer an event when nothing has happened for a while, and pick events that fit the recent history. Be conservative: small changes, explained in one or two sentences of "reasoning".`;

const GM_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    difficulty: { type: 'number' },
    loot: { type: 'number' },
    event: { type: 'string', enum: ['none', 'raid', 'festival', 'famine', 'plague', 'omen', 'bounty', 'bonanza'] },
    planet: { type: 'string' },
    announcement: { type: 'string' },
  },
  required: ['reasoning', 'difficulty', 'loot', 'event', 'planet', 'announcement'],
  additionalProperties: false,
};
