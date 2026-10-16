// Parties of up to four pilots: shared markers, party chat, no friendly fire, shared bounties.

import crypto from 'node:crypto';
import { MAX_PARTY } from '../shared/rules.js';
import { sectorOf } from '../shared/universe.js';

export class Parties {
  constructor(world) {
    this.w = world;
    this.parties = new Map();   // id -> { id, leader, members: Set<key> }
    this.invites = new Map();   // invitee key -> { from, partyId, at }
  }

  of(key) {
    for (const p of this.parties.values()) if (p.members.has(key)) return p;
    return null;
  }

  sameParty(a, b) {
    const p = this.of(a);
    return !!p && p.members.has(b);
  }

  invite(conn, name) {
    const me = conn.player;
    const target = this.w.connByName(name);
    if (!target) return conn.send({ t: 'toast', msg: `${name} isn't online.` });
    if (target === conn) return;
    let party = this.of(me.key);
    if (party && party.leader !== me.key) return conn.send({ t: 'toast', msg: 'Only the party leader can invite.' });
    if (party && party.members.size >= MAX_PARTY) return conn.send({ t: 'toast', msg: `Parties are limited to ${MAX_PARTY}.` });
    if (this.of(target.player.key)) return conn.send({ t: 'toast', msg: `${target.player.name} is already in a party.` });
    if (!party) {
      party = { id: crypto.randomUUID().slice(0, 8), leader: me.key, members: new Set([me.key]) };
      this.parties.set(party.id, party);
    }
    this.invites.set(target.player.key, { from: me.name, partyId: party.id, at: Date.now() });
    target.send({ t: 'party_invite', from: me.name });
    conn.send({ t: 'toast', msg: `Invited ${target.player.name}.` });
    this.push(party);
  }

  accept(conn) {
    const key = conn.player.key;
    const inv = this.invites.get(key);
    this.invites.delete(key);
    if (!inv || Date.now() - inv.at > 120000) return conn.send({ t: 'toast', msg: 'That invite expired.' });
    const party = this.parties.get(inv.partyId);
    if (!party || party.members.size >= MAX_PARTY) return conn.send({ t: 'toast', msg: 'That party is full or gone.' });
    if (this.of(key)) this.leave(conn);
    party.members.add(key);
    this.say(party, `${conn.player.name} joined the party.`);
    this.push(party);
  }

  decline(conn) {
    this.invites.delete(conn.player.key);
  }

  leave(conn) {
    const key = conn.player.key;
    const party = this.of(key);
    if (!party) return;
    party.members.delete(key);
    conn.send({ t: 'party', party: null });
    this.say(party, `${conn.player.name} left the party.`);
    this.cleanup(party);
  }

  kick(conn, name) {
    const party = this.of(conn.player.key);
    if (!party || party.leader !== conn.player.key) return;
    const key = String(name).toLowerCase();
    if (!party.members.has(key) || key === conn.player.key) return;
    party.members.delete(key);
    const c = this.w.connByName(key);
    if (c) { c.send({ t: 'party', party: null }); c.send({ t: 'toast', msg: 'You were removed from the party.' }); }
    this.say(party, `${name} was removed from the party.`);
    this.cleanup(party);
  }

  // Called when a player disconnects: they stay in the party for a short grace period.
  dropped(key) {
    const party = this.of(key);
    if (party) this.push(party);
  }

  cleanup(party) {
    const online = [...party.members].filter((k) => this.w.connByName(k));
    if (party.members.size <= 1 || online.length === 0) {
      for (const k of party.members) this.w.connByName(k)?.send({ t: 'party', party: null });
      this.parties.delete(party.id);
      return;
    }
    if (!party.members.has(party.leader)) party.leader = online[0] || [...party.members][0];
    this.push(party);
  }

  view(party) {
    return {
      id: party.id,
      leader: party.leader,
      members: [...party.members].map((k) => {
        const c = this.w.connByName(k);
        const p = c?.player;
        if (!p) return { key: k, name: this.w.data.players[k]?.name || k, online: false };
        const [sx, sz] = sectorOf(p.x, p.z);
        return {
          key: k, name: p.name, color: p.color, online: true, mode: p.mode,
          x: p.x, y: p.y, z: p.z, sx, sz, planet: p.planet,
          px: p.px, pz: p.pz,
          health: p.mode === 'space' ? p.hull / p.stats.hp : p.hp / p.maxHp,
        };
      }),
    };
  }

  push(party) {
    const v = this.view(party);
    for (const k of party.members) this.w.connByName(k)?.send({ t: 'party', party: v });
  }

  say(party, text) {
    for (const k of party.members) this.w.connByName(k)?.send({ t: 'chat', channel: 'party', from: null, text });
  }

  chat(conn, text) {
    const party = this.of(conn.player.key);
    if (!party) return conn.send({ t: 'toast', msg: "You're not in a party." });
    for (const k of party.members) this.w.connByName(k)?.send({ t: 'chat', channel: 'party', from: conn.player.name, color: conn.player.color, text });
  }

  tick() {
    for (const party of this.parties.values()) this.push(party);
    const now = Date.now();
    for (const [k, inv] of this.invites) if (now - inv.at > 120000) this.invites.delete(k);
  }

  // Party members near the given player (for sharing bounties).
  nearbyMembers(player, radius = 6000) {
    const party = this.of(player.key);
    if (!party) return [player];
    const out = [];
    for (const k of party.members) {
      const p = this.w.connByName(k)?.player;
      if (!p) continue;
      if (p === player) { out.push(p); continue; }
      if (p.mode !== player.mode) continue;
      if (p.mode === 'space' && Math.hypot(p.x - player.x, p.y - player.y, p.z - player.z) > radius) continue;
      if (p.mode === 'surface' && p.planet !== player.planet) continue;
      out.push(p);
    }
    return out;
  }
}
