// Runs the shared storyline: tracks community goals, advances arcs, and announces changes.

import { ARCS, goalTarget, goalDone, storyEffects, relicSites, mothershipSector, newStory, eraScale } from '../shared/story.js';
import { ORES } from '../shared/rules.js';

export class StoryDirector {
  constructor(world) {
    this.w = world;
    if (!world.data.story) world.data.story = newStory();
    this.s.scale = Number(process.env.STORY_SCALE) || this.s.scale || 1;
    this.dirty = true;
    this.lastPush = 0;
    this.relicCache = null;
  }

  get s() { return this.w.data.story; }
  get arc() { return ARCS[this.s.arc]; }
  effects() { return storyEffects(this.s); }

  relics() {
    if (!this.relicCache || this.relicCache.era !== this.s.era) this.relicCache = { era: this.s.era, sites: relicSites(this.s.era, this.w.seed) };
    return this.relicCache.sites;
  }

  mothership() {
    const [sx, sz] = mothershipSector(this.s.era, this.w.seed);
    const maxHp = Math.round(6000 * eraScale(this.s.era));
    if (this.s.mothershipHp == null) this.s.mothershipHp = maxHp;
    return { sx, sz, hp: this.s.mothershipHp, maxHp };
  }

  activeGoals() {
    return this.arc.goals.filter((g) => !g.after || goalDone(this.s, g.after));
  }

  // How much of an ore the current arc still wants.
  wants(ore) {
    const g = this.activeGoals().find((x) => x.id === `deliver:${ore}`);
    if (!g) return 0;
    return Math.max(0, goalTarget(g, this.s.era, this.s.scale) - (this.s.progress[g.id] || 0));
  }

  // Pilot hands ore over at a station: paid 25% above market, counted toward the goal.
  contribute(conn) {
    const p = conn.player;
    let total = 0, paid = 0;
    for (const ore of Object.keys(ORES)) {
      const n = Math.min(p.cargo[ore] || 0, this.wants(ore));
      if (n <= 0) continue;
      p.cargo[ore] -= n;
      total += n;
      paid += Math.round(n * ORES[ore].price * 1.25);
      this.add(`deliver:${ore}`, n, p.name);
    }
    if (!total) return conn.send({ t: 'toast', msg: 'The current story needs none of what you carry.' });
    p.credits += paid;
    p.stats_contrib = (p.stats_contrib || 0) + total;
    this.w.sendSelf(conn);
    conn.send({ t: 'toast', msg: `Contributed ${total} ore to "${this.arc.title}" (+${paid} cr).` });
  }

  add(goalId, n, by) {
    const g = this.activeGoals().find((x) => x.id === goalId);
    if (!g) return;
    const target = goalTarget(g, this.s.era, this.s.scale);
    const before = this.s.progress[goalId] || 0;
    if (before >= target) return;
    this.s.progress[goalId] = Math.min(target, before + n);
    this.dirty = true;
    this.w.dirty = true;
    if (this.s.progress[goalId] >= target) {
      this.log(`${g.label}: complete${by ? ` (final push by ${by})` : ''}.`);
      if (goalId === 'kill:hollow') {
        const m = this.mothership();
        this.transmit('HIVE MOTHERSHIP', [`HAVEN COMMAND: The swarm has a heart. The Hive Mothership just surfaced in sector ${m.sx}, ${m.sz}. Every pilot who can fight, go.`]);
      }
      this.checkArc();
    }
  }

  relicFound(conn, site) {
    if (this.arc.id !== 'echoes' || this.s.relicsFound.includes(site.planet)) return false;
    this.s.relicsFound.push(site.planet);
    this.log(`${conn.player.name} awakened the relic on ${site.name}.`);
    this.w.broadcast({ t: 'chat', from: null, text: `${conn.player.name} awakened a precursor relic on ${site.name}!` });
    this.add('relic', 1, conn.player.name);
    this.dirty = true;
    return true;
  }

  damageMothership(dmg) {
    const m = this.mothership();
    this.s.mothershipHp = Math.max(0, m.hp - dmg);
    this.dirty = true;
    return this.s.mothershipHp;
  }

  checkArc() {
    if (!this.arc.goals.every((g) => goalDone(this.s, g.id))) return;
    const arc = this.arc;
    this.transmit(arc.title.toUpperCase() + ': COMPLETE', [arc.outro]);
    if (arc.complete?.gateBuilt) this.s.flags.gateBuilt = true;
    if (arc.complete?.jumpBonus) this.s.flags.jumpBonus = (this.s.flags.jumpBonus || 0) + arc.complete.jumpBonus;
    this.s.progress = {};
    this.s.mothershipHp = null;
    this.s.relicsFound = [];
    this.s.arc++;
    if (this.s.arc >= ARCS.length) {
      this.s.arc = 0;
      this.s.era++;
      this.log(`Era ${this.s.era + 1} begins.`);
    }
    this.s.startedAt = Date.now();
    this.dirty = true;
    setTimeout(() => this.announce(), 6000);
    this.w.onStoryChanged();
  }

  announce() {
    const arc = this.arc;
    const prefix = this.s.era > 0 ? `ERA ${this.s.era + 1} · ` : '';
    this.transmit(prefix + arc.title.toUpperCase(), arc.intro);
    this.log(`Chapter begins: ${arc.title}.`);
  }

  transmit(title, lines) {
    this.w.broadcast({ t: 'transmission', title, lines });
  }

  log(text) {
    this.s.log.push({ at: Date.now(), text });
    if (this.s.log.length > 30) this.s.log.shift();
    this.dirty = true;
  }

  view() {
    const s = this.s, arc = this.arc;
    return {
      era: s.era, arc: s.arc, id: arc.id, title: arc.title, intro: arc.intro,
      goals: arc.goals.map((g) => ({
        id: g.id, label: g.label, progress: s.progress[g.id] || 0, target: goalTarget(g, s.era, s.scale),
        active: !g.after || goalDone(s, g.after),
      })),
      effects: this.effects(),
      relics: arc.relics ? this.relics().map((r) => ({ ...r, found: s.relicsFound.includes(r.planet) })) : null,
      mothership: this.effects().mothership ? this.mothership() : null,
      log: s.log.slice(-12),
      chapters: ARCS.map((a) => a.title),
    };
  }

  tick(now) {
    if (this.dirty && now - this.lastPush > 1000) {
      this.dirty = false;
      this.lastPush = now;
      this.w.broadcast({ t: 'story', story: this.view() });
    }
  }
}
