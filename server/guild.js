// The Mercenary Guild. Every city has a guild hall and every station a guild terminal, each with a
// board of contracts: hunts, wanted outlaws, dungeon clearances, ore deliveries and space bounties.
// Contracts pay credits and merit; merit raises your rank from F to S, and higher ranks open
// harder, better-paid work. Finished contracts are turned in at any guild board.

import { townsOf, personName } from '../shared/towns.js';
import { faunaOf, structuresOf } from '../shared/planet.js';
import { findPlanet, generateSector, sectorOf } from '../shared/universe.js';
import { CREATURES } from '../shared/content/creatures.js';
import { STRUCTURES } from '../shared/content/structures.js';
import { ORES } from '../shared/rules.js';
import { randomItem } from '../shared/items.js';
import { RANKS, MAX_CONTRACTS, CONTRACT_PAY, CONTRACT_MERIT, rankOf, rankName, canTake } from '../shared/guild.js';
import { mulberry32, hashString } from '../shared/rng.js';

const BOARD_SIZE = 7;
const CHECK_MS = 2000;
const pickR = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const EPITHETS = ['the Butcher', 'Redclaw', 'the Unbroken', 'Old Scar', 'the Widowmaker', 'Gravemaw', 'the Hollow-Eyed', 'Ironhide', 'the Devourer', 'Nightstalker', 'the Ravager', 'Bonecrusher'];
const SHIP_KINDS = [[['pirate'], 'pirate ships'], [['pirate', 'hollow'], 'pirate or Hollow ships'], [['hollow'], 'Hollow ships'], [['alien'], 'hostile alien ships']];
let nextContract = 1;

export class Guild {
  constructor(world) {
    this.w = world;
    this.lastCheck = 0;
  }

  // ---- where the boards are ----------------------------------------------------------------------

  // The guild board the pilot is standing at: a city's guild hall, or a docked station.
  boardAt(p) {
    if (p.mode === 'space') {
      const st = this.w.dockedStation(p);
      if (!st) return null;
      const [sx, sz] = sectorOf(st.x, st.z);
      return { id: `st:${st.id}`, name: `${st.name} guild terminal`, space: true, sx, sz, richness: st.richness || 1 };
    }
    if (p.mode !== 'surface') return null;
    const planet = this.w.surfaces.instance(p.planet).planet;
    for (const t of townsOf(planet)) {
      const hall = guildHall(t);
      if (hall && Math.hypot(hall.x - p.px, hall.z - p.pz) < Math.max(hall.w, hall.d) / 2 + 7) {
        return { id: `${planet.id}:${t.id}`, name: `${t.name} Guild Hall`, pid: planet.id, planet, town: t, richness: planet.richness };
      }
    }
    return null;
  }

  // ---- the board ---------------------------------------------------------------------------------------

  // A board's contracts change every hour and are the same for everyone, spread across the ranks.
  offers(board) {
    const hour = Math.floor(Date.now() / 3600000);
    const rng = mulberry32(hashString(`${board.id}:${hour}`));
    const out = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      // One F-rank job always, then a spread up the ranks.
      const rank = i === 0 ? 0 : Math.min(RANKS.length - 1, i - 1 + (rng() < 0.5 ? 1 : 0));
      const c = this.make(board, rank, rng, `${board.id}:${hour}:${i}`);
      if (c) out.push(c);
    }
    return out;
  }

  make(board, rank, rng, key) {
    const pay = Math.round(CONTRACT_PAY[rank] * (0.7 + 0.3 * board.richness));
    const base = { key, rank, credits: pay, merit: CONTRACT_MERIT[rank], from: board.name };
    const kinds = [];
    let planet = board.planet;
    // From a station, hunts and dungeons are on the sector's own worlds.
    if (board.space) {
      const worlds = generateSector(board.sx, board.sz, this.w.seed).planets.filter((pl) => pl.landable && !pl.starter);
      if (worlds.length) planet = findPlanet(pickR(rng, worlds).id, this.w.seed);
    }
    const safe = !planet || planet.starter;
    const fauna = planet ? faunaOf(planet) : [];
    if (fauna.length && (!safe || rank <= 1)) kinds.push('hunt');
    if (!safe && fauna.length && rank >= 1) kinds.push('wanted', 'wanted');
    const dungeons = planet && !safe ? structuresOf(planet).filter((s) => STRUCTURES[s.type].kind === 'dungeon') : [];
    if (dungeons.length && rank >= 2) kinds.push('dungeon');
    kinds.push('deliver');
    if (rank >= 1) kinds.push('bounty', 'bounty');
    const kind = pickR(rng, kinds);
    const where = planet ? ` on ${planet.name}` : '';
    if (kind === 'hunt') {
      const sp = pickR(rng, fauna), need = 4 + rank * 3;
      return { ...base, kind, pid: planet.id, species: sp, need, title: `Cull the ${CREATURES[sp].name}`, text: `Kill ${need} ${CREATURES[sp].name}${where}` };
    }
    if (kind === 'wanted') {
      const sp = pickR(rng, fauna), ang = rng() * Math.PI * 2, d = 160 + rng() * 260;
      const name = `${personName('human', rng).split(' ')[0]} ${pickR(rng, EPITHETS)}`;
      return { ...base, kind, pid: planet.id, species: sp, need: 1, x: Math.cos(ang) * d, z: Math.sin(ang) * d, target: name, credits: Math.round(pay * 1.3), merit: Math.round(base.merit * 1.3),
        title: `Wanted: ${name}`, text: `Hunt down ${name}, a monstrous ${CREATURES[sp].name}${where}` };
    }
    if (kind === 'dungeon') {
      const dg = pickR(rng, dungeons);
      return { ...base, kind, pid: planet.id, st: dg.id, x: dg.x, z: dg.z, need: 1, credits: Math.round(pay * 1.5), merit: Math.round(base.merit * 1.5),
        title: `Clear the ${STRUCTURES[dg.type].name}`, text: `Defeat the master of the ${STRUCTURES[dg.type].name}${where}` };
    }
    if (kind === 'bounty') {
      const [ships, label] = pickR(rng, SHIP_KINDS.slice(0, rank >= 3 ? 4 : 2)), need = 2 + rank * 2;
      return { ...base, kind, ships, need, title: `Bounty: ${label}`, text: `Destroy ${need} ${label} in space` };
    }
    const ores = ['iron', 'copper', 'silver', 'gold', 'crystal', 'mithril', 'voidstone'].filter((o) => ORES[o]);
    const ore = ores[Math.min(ores.length - 1, Math.floor(rank * 0.9 + rng() * 1.5))], need = Math.round((30 + rank * 25) / Math.max(1, ORES[ore].price / 6));
    return { ...base, kind: 'deliver', ore, need, title: `Supply run: ${ORES[ore].name}`, text: `Deliver ${need} ${ORES[ore].name} to any guild board` };
  }

  // ---- talking to the guild ---------------------------------------------------------------------------

  open(conn) {
    const p = conn.player, board = this.boardAt(p);
    if (!board) return conn.send({ t: 'toast', msg: 'Find a guild hall in a city, or dock at a station, to see the contract board.' });
    if (!p.guild) {
      p.guild = { merit: 0, done: 0, contracts: [] };
      conn.send({ t: 'transmission', title: 'MERCENARY GUILD', lines: ['Welcome to the Mercenary Guild. Your card says F-rank. Everyone starts there.', 'Take contracts from any guild board, finish them, and turn them in at any board for pay and merit. Merit raises your rank, and rank opens better work.'] });
    }
    conn.guildBoard = board;
    conn.guildOffers = this.offers(board);
    this.send(conn);
  }

  send(conn) {
    const p = conn.player, g = p.guild;
    if (!g || !conn.guildBoard) return;
    const rank = rankOf(g.merit);
    const taken = new Set(g.contracts.map((c) => c.key));
    conn.send({
      t: 'guild', name: conn.guildBoard.name, merit: g.merit, rank, done: g.done,
      board: conn.guildOffers.map((c) => ({ ...this.public(c), taken: taken.has(c.key), locked: !canTake(rank, c.rank) })),
      active: g.contracts.map((c) => this.public(c)),
    });
  }

  public(c) {
    const planet = c.pid ? findPlanet(c.pid, this.w.seed) : null;
    return { key: c.key, id: c.id, kind: c.kind, rank: c.rank, title: c.title, text: c.text, credits: c.credits, merit: c.merit, need: c.need, have: c.have || 0, ready: !!c.ready, planet: planet?.name || null, from: c.from };
  }

  accept(conn, { key }) {
    const p = conn.player, g = p.guild;
    const offer = conn.guildOffers?.find((c) => c.key === key);
    if (!g || !offer || !this.boardAt(p)) return;
    if (g.contracts.some((c) => c.key === key)) return;
    if (!canTake(rankOf(g.merit), offer.rank)) return conn.send({ t: 'toast', msg: `That contract needs ${rankName(offer.rank - 1)} or better.` });
    if (g.contracts.length >= MAX_CONTRACTS) return conn.send({ t: 'toast', msg: `You can hold ${MAX_CONTRACTS} contracts at a time. Finish or drop one first.` });
    g.contracts.push({ ...offer, id: `k${Date.now().toString(36)}${nextContract++}`, have: 0, at: Date.now() });
    conn.send({ t: 'toast', msg: `Contract accepted: ${offer.title}` });
    this.changed(conn);
  }

  abandon(conn, { id }) {
    const g = conn.player.guild;
    if (!g) return;
    const c = g.contracts.find((x) => x.id === id);
    if (!c) return;
    g.contracts = g.contracts.filter((x) => x !== c);
    // Walking out on a contract costs a little standing with the guild.
    g.merit = Math.max(0, g.merit - Math.round(c.merit * 0.25));
    conn.send({ t: 'toast', msg: `Contract dropped: ${c.title}` });
    this.changed(conn);
  }

  // Turn in a finished contract (or hand over a delivery) at any guild board.
  turnIn(conn, { id }) {
    const p = conn.player, g = p.guild;
    const c = g?.contracts.find((x) => x.id === id);
    if (!c || !this.boardAt(p)) return;
    if (c.kind === 'deliver' && !c.ready) {
      if ((p.cargo[c.ore] || 0) < c.need) return conn.send({ t: 'toast', msg: `You need ${c.need} ${ORES[c.ore].name} (you have ${p.cargo[c.ore] || 0}).` });
      p.cargo[c.ore] -= c.need;
      if (!p.cargo[c.ore]) delete p.cargo[c.ore];
      c.ready = true;
    }
    if (!c.ready) return conn.send({ t: 'toast', msg: 'That contract is not finished yet.' });
    g.contracts = g.contracts.filter((x) => x !== c);
    const before = rankOf(g.merit);
    p.credits += c.credits;
    g.merit += c.merit;
    g.done++;
    conn.send({ t: 'toast', msg: `Contract complete: ${c.title} (+${c.credits} cr, +${c.merit} merit)`, cls: 'loot' });
    if (c.rank >= 3) this.w.giveItem(conn, randomItem(1 + c.rank * 1.4));
    const after = rankOf(g.merit);
    if (after > before) {
      const r = RANKS[after];
      conn.send({ t: 'transmission', title: `PROMOTED: ${r.id}-RANK`, lines: [`The guild clerk stamps your card. You are now ${rankName(after)}: ${r.title}.`, after + 1 < RANKS.length ? `Contracts up to ${RANKS[Math.min(RANKS.length - 1, after + 1)].id}-rank are open to you.` : 'There is no higher rank. The guild tells stories about you now.'] });
      this.w.broadcast({ t: 'chat', from: null, text: `${p.name} has been promoted to ${rankName(after)} (${r.title}) in the Mercenary Guild.` });
    }
    this.w.director?.record('quests');
    this.changed(conn);
  }

  changed(conn) {
    this.w.dirty = true;
    this.w.sendSelf(conn);
    this.w.quests.sync(conn);
    if (conn.guildBoard && this.boardAt(conn.player)?.id === conn.guildBoard.id) this.send(conn);
  }

  // ---- progress ------------------------------------------------------------------------------------------

  progress(conn, c, n = 1) {
    c.have = Math.min(c.need, (c.have || 0) + n);
    if (c.have >= c.need && !c.ready) {
      c.ready = true;
      conn.send({ t: 'toast', msg: `${c.title}: done. Turn it in at any guild board.`, cls: 'loot' });
    }
    this.w.quests.sync(conn);
  }

  // A creature killed on a planet.
  onKill(conn, pid, cr) {
    for (const c of conn.player.guild?.contracts || []) {
      if (c.ready || c.pid !== pid) continue;
      if ((c.kind === 'hunt' && cr.species === c.species && !cr.contract) || (c.kind === 'wanted' && cr.contract === c.id)) this.progress(conn, c);
    }
  }

  // A ship destroyed in space.
  onShipKill(conn, kind) {
    for (const c of conn.player.guild?.contracts || []) if (!c.ready && c.kind === 'bounty' && c.ships.includes(kind)) this.progress(conn, c);
  }

  // A dungeon's master defeated.
  onDungeon(conn, pid, st) {
    for (const c of conn.player.guild?.contracts || []) if (!c.ready && c.kind === 'dungeon' && c.pid === pid && c.st === st) this.progress(conn, c);
  }

  // Wanted outlaws turn up when their hunter comes near.
  tick(now) {
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    for (const conn of this.w.conns()) {
      const p = conn.player;
      if (p.mode !== 'surface' || p.dead || !p.guild) continue;
      for (const c of p.guild.contracts) {
        if (c.kind !== 'wanted' || c.ready || c.pid !== p.planet || Math.hypot(p.px - c.x, p.pz - c.z) > 90) continue;
        const inst = this.w.surfaces.instance(p.planet);
        if ([...inst.creatures.values()].some((x) => x.contract === c.id)) continue;
        const k = 3 + c.rank * 1.2;
        const cr = this.w.surfaces.newCreature(inst, c.species, c.x, c.z, { behavior: 'aggressive', contract: c.id, title: c.target, aggro: p.key });
        cr.hp = cr.maxHp = cr.maxHp * k;
        cr.dmg = Math.max(cr.dmg, 6) * (1.3 + c.rank * 0.25);
        cr.size *= 1.5;
        conn.send({ t: 'toast', msg: `${c.target} is here!` });
      }
    }
  }

  // Contracts as the journal and HUD show them.
  view(p) {
    return (p.guild?.contracts || []).map((c) => {
      const planet = c.pid ? findPlanet(c.pid, this.w.seed) : null;
      const text = c.ready ? 'Turn in at any guild board' : c.text;
      return { id: c.id, title: `[${RANKS[c.rank].id}] ${c.title}`, pid: c.pid || null, planet: planet?.name || null, town: c.from, giver: 'Mercenary Guild', guild: true,
        steps: [{ text: c.text, done: !!c.ready, have: c.have, need: c.kind === 'deliver' ? null : c.need }, ...(c.ready ? [{ text, done: false }] : [])], step: c.ready ? 1 : 0, note: null, status: 'active',
        mark: c.x != null && !c.ready ? [c.x, c.z] : null };
    });
  }
}

// A town's guild hall, if it has one.
export const guildHall = (t) => t.buildings.find((b) => b.kind === 'guild');
