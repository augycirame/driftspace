// DOM interface: HUD, panels (station, shop, gear, party, journal, dialogue, help),
// story transmissions, toasts and chat.

import { generateSector, sectorOf, findPlanet, isSafe, territoryOf } from '/shared/universe.js';
import { ORES, ORE_IDS, BLOCKS, BLOCK_IDS, UPGRADES, upgradeCost, cargoTotal, canAfford, blockAllowed } from '/shared/rules.js';
import { RECIPES, RECIPE_IDS, recipeCost } from '/shared/crafting.js';
import { RANKS, MAX_CONTRACTS } from '/shared/guild.js';
import { TIERS, ARMOR_SLOTS, ARMOR_SLOT_IDS, WEAPON_IDS, GRADES, AFFIXES, MAX_PLUS, ENHANCE_CHANCE, enhanceCost, itemName, itemColor, weaponStats, itemValue, relicColor, describeBonus, RELIC_SLOTS } from '/shared/items.js';
import { TERRAINS, CREATURES, STRUCTURES, RELICS, RELIC_RARITY, FACTIONS, GODS, HOLY_CAPITAL, TERRITORY, factionTitle, ALIEN_RACES, DUNGEON_THEMES } from '/shared/content/index.js';
import { TUTORIAL, WARDEN_LINES } from '/shared/tutorial.js';
import { terrainOf as terrainOfPlanet, gravityOf } from '/shared/planet.js';
import { PEOPLES, CLIMATES } from '/shared/content/peoples.js';
import { SKILLS, SKILL_IDS, skillLevel, skillBonus, xpForLevel, SPELLS, POWERS, CURSES, mechStats, MAX_ENERGY } from '/shared/powers.js';
import { climateOf, sunAt, weatherAt, weatherInfo, townsOf } from '/shared/towns.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A guild contract as a line on the board.
function contractHtml(c) {
  const r = RANKS[c.rank];
  return `<span class="rankchip" style="--rc:${r.color}">${r.id}</span> <b>${esc(c.title)}</b><br><span class="small">${esc(c.text)}</span>` +
    `<br><span class="small dim">${c.credits} cr · ${c.merit} merit${c.planet ? ` · ${esc(c.planet)}` : ''}</span>`;
}

// An item's grade, bonus stats and maker, as small lines under its name.
function gradeLines(it) {
  if (!it.grade || (it.grade === 'common' && !it.maker)) return '';
  const g = GRADES[it.grade];
  const lines = [`<span style="color:${g.color}">${g.name}</span>`];
  for (const a of it.affixes || []) lines.push(`<span style="color:#9fd8ff">${AFFIXES[a.id].fmt(a.v)}</span>`);
  if (it.maker) lines.push(`<span class="dim">Forged by ${esc(it.maker)}</span>`);
  return `<br><span class="small">${lines.join(' · ')}</span>`;
}

export class UI {
  constructor(state, send) {
    this.S = state;
    this.send = send;
    this.current = null;
    this.txQueue = [];
    this.hudAt = 0;
    $('panel-close').onclick = () => this.close();
    $('transmission').onclick = () => this.nextTransmission();
  }

  // ---- messages ---------------------------------------------------------------------------

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.textContent = msg;
    if (cls) el.className = cls;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  chat(from, text, color, channel) {
    const el = document.createElement('div');
    if (channel === 'party') el.className = 'party';
    if (from) {
      const n = document.createElement('b');
      n.textContent = (channel === 'party' ? '[party] ' : '') + from + ': ';
      n.style.color = color || '#9fd0ff';
      el.append(n, document.createTextNode(text));
    } else {
      el.className += ' sys';
      el.textContent = text;
    }
    const log = $('chat-log');
    log.appendChild(el);
    while (log.children.length > 40) log.firstChild.remove();
  }

  transmission(title, lines) {
    this.txQueue.push({ title, lines });
    if ($('transmission').hidden) this.nextTransmission();
  }

  nextTransmission() {
    const tx = this.txQueue.shift();
    if (!tx) { $('transmission').hidden = true; return; }
    document.exitPointerLock?.();
    $('transmission').hidden = false;
    $('transmission').querySelector('.tx-title').textContent = tx.title;
    $('transmission').querySelector('.tx-body').innerHTML = tx.lines.map((l) => `<p>${esc(l)}</p>`).join('');
  }

  transmissionOpen() { return !$('transmission').hidden; }

  death(by, secs) {
    $('death').hidden = false;
    $('death-title').textContent = this.S.you.mode === 'space' ? 'Ship destroyed' : 'You went down';
    $('death-body').textContent = `By ${by}. Respawning in ${secs} seconds…`;
    setTimeout(() => { $('death').hidden = true; }, secs * 1000);
  }

  invite(from) {
    const el = $('invite');
    el.hidden = false;
    el.innerHTML = `<p><b>${esc(from)}</b> invited you to their party.</p><div class="row2"><button id="inv-yes">Join</button><button id="inv-no" class="alt">Decline</button></div>`;
    document.exitPointerLock?.();
    $('inv-yes').onclick = () => { this.send({ t: 'party_accept' }); el.hidden = true; };
    $('inv-no').onclick = () => { this.send({ t: 'party_decline' }); el.hidden = true; };
    setTimeout(() => { el.hidden = true; }, 60000);
  }

  // ---- panels -----------------------------------------------------------------------------

  isOpen() { return !$('panel').hidden; }

  open(kind, title, render) {
    document.exitPointerLock?.();
    this.current = { kind, title, render };
    $('panel').hidden = false;
    $('panel-title').textContent = title;
    this.rerender();
  }

  rerender() {
    if (!this.current) return;
    const body = $('panel-body');
    body.innerHTML = '';
    body.className = '';
    this.current.render(body);
  }

  close() {
    $('panel').hidden = true;
    this.current = null;
  }

  refresh() {
    // Conversations keep their place (and whatever you're typing) when stats update.
    if (this.current && this.isOpen() && this.current.kind !== 'talk') this.rerender();
    this.renderPalette();
  }

  button(text, fn, cls = '') {
    const b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = fn;
    return b;
  }

  row(html, btn) {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<span>${html}</span>`;
    if (btn) r.appendChild(btn);
    return r;
  }

  station(docked) {
    this.docked = docked;
    this.open('station', docked.station.name, (body) => {
      const S = this.S, you = S.you;
      const value = ORE_IDS.reduce((s, k) => s + (you.cargo[k] || 0) * ORES[k].price, 0);
      const sb = this.button('Sell all', () => this.send({ t: 'sell' }));
      sb.disabled = !value;
      body.appendChild(this.row(`Sell cargo<br><span class="small dim">${cargoTotal(you.cargo)} units, worth ${value} cr</span>`, sb));
      const wants = docked.wants || [];
      const cb = this.button('Contribute', () => this.send({ t: 'contribute' }));
      cb.disabled = !wants.some((o) => you.cargo[o] > 0);
      body.appendChild(this.row(`Contribute to <b>${esc(S.story?.title || 'the story')}</b><br><span class="small dim">${wants.length ? 'Wanted: ' + wants.map((o) => ORES[o].name).join(', ') + '. Pays 25% over market.' : 'Nothing wanted right now.'}</span>`, cb));
      body.appendChild(this.row('Gear shop<br><span class="small dim">Weapons and armor</span>', this.button('Browse', () => this.send({ t: 'shop' }))));
      body.appendChild(this.row('Shipyard<br><span class="small dim">Rebuild your ship block by block</span>', this.button('Open', () => { this.close(); this.onShipyard?.(); })));
      body.appendChild(this.row('Fabricator<br><span class="small dim">Craft gear and mechs from materials</span>', this.button('Craft', () => this.craft())));
      body.appendChild(this.row('Mercenary Guild<br><span class="small dim">Contracts, bounties and your guild rank</span>', this.button('Board', () => this.send({ t: 'guild' }))));
      if (docked.station.player) body.appendChild(Object.assign(document.createElement('p'), { className: 'small dim', textContent: `A station built by ${docked.station.owner}. Repairs are free; ore sells at 80%.` }));
      if (docked.station.capital) {
        const b = HOLY_CAPITAL.blessing;
        const bb = this.button(`Tithe ${b.tithe} cr`, () => this.send({ t: 'benediction' }));
        bb.disabled = you.credits < b.tithe || you.rep.empire < b.minRep;
        body.appendChild(this.row(`<b style="color:#ffe08a">${b.name}</b><br><span class="small dim">${describeBonus(b.bonus)} for ${b.minutes} min. Citizens of the Empire only.</span>`, bb));
      }
      if (docked.gate) {
        const home = docked.station.id === '0,0:st';
        body.appendChild(this.row(`<b style="color:#d9a8ff">The Ancient Gate</b><br><span class="small dim">${home ? 'Travel to the Far Reach' : 'Return to Haven'}</span>`, this.button('Go', () => { this.close(); this.send({ t: 'gate' }); })));
      }
      const h = document.createElement('h3');
      h.textContent = `Upgrades · ${you.credits} cr`;
      body.appendChild(h);
      for (const [id, def] of Object.entries(UPGRADES)) {
        const lvl = you.upg[id] || 0, cost = upgradeCost(lvl);
        const b = this.button(lvl >= def.max ? 'Max' : `${cost} cr`, () => this.send({ t: 'upgrade', kind: id }));
        b.disabled = lvl >= def.max || you.credits < cost;
        body.appendChild(this.row(`${def.name} <span class="pips">${'■'.repeat(lvl)}${'□'.repeat(def.max - lvl)}</span><br><span class="small dim">${def.desc}</span>`, b));
      }
      body.appendChild(this.button('Undock', () => this.close(), 'alt'));
    });
  }

  shop(msg) {
    this.open('shop', msg.name, (body) => {
      const you = this.S.you;
      const p = document.createElement('p');
      p.innerHTML = `Credits: <b>${you.credits}</b> · Stock changes daily.`;
      body.appendChild(p);
      for (const s of msg.stock) {
        const nm = itemName(s), color = itemColor(s);
        const detail = s.kind === 'weapon' ? (() => { const w = weaponStats(s); return `${Math.round(w.damage * w.pellets)} dmg × ${+w.rate.toFixed(1)}/s · range ${Math.round(w.range)}`; })()
          : s.kind === 'mech' ? `${mechStats(s.tier).hp} hp · cannon ${Math.round(mechStats(s.tier).damage)} dmg · G to pilot` : `+${Math.round(ARMOR_SLOTS[s.type].armor * s.tier * TIERS[s.tier].mult)} armor`;
        const b = this.button(`${s.price} cr`, () => this.send({ t: 'buy', slot: s.slot }));
        b.disabled = you.credits < s.price;
        body.appendChild(this.row(`<b style="color:${color}">${esc(nm)}</b><br><span class="small dim">${detail}</span>${gradeLines(s)}`, b));
      }
      const h = document.createElement('h3');
      h.textContent = 'Sell your gear';
      body.appendChild(h);
      for (const it of you.inv.items) {
        body.appendChild(this.row(`<span style="color:${itemColor(it)}">${esc(itemName(it))}</span>`, this.button(`Sell ${Math.round(itemValue(it) * 0.5)} cr`, () => this.send({ t: 'sell_item', id: it.id }), 'alt')));
      }
    });
  }

  inventory() {
    this.open('inventory', 'Pilot gear', (body) => {
      const you = this.S.you;
      const eq = you.inv.equipped;
      const find = (id) => you.inv.items.find((i) => i.id === id);
      const w = find(eq.weapon);
      const ws = w ? weaponStats(w) : null;
      const top = document.createElement('div');
      top.innerHTML =
        `<table><tr><td>Weapon</td><td>${w ? `<span style="color:${itemColor(w)}">${esc(itemName(w))}</span> · ${Math.round(ws.damage * ws.pellets * ws.rate)} dps` : '<span class="dim">none</span>'}</td></tr>` +
        ARMOR_SLOT_IDS.map((s) => { const a = find(eq[s]); return `<tr><td>${ARMOR_SLOTS[s].name}</td><td>${a ? `<span style="color:${itemColor(a)}">${esc(itemName(a))}</span>` : '<span class="dim">none</span>'}</td></tr>`; }).join('') +
        RELIC_SLOTS.map((s, i) => { const r = find(eq[s]); return `<tr><td>Relic ${i + 1}</td><td>${r ? `<span style="color:${relicColor(r)}">${esc(itemName(r))}</span> <span class="dim small">${describeBonus(RELICS[r.type].bonus)}</span>` : '<span class="dim">none</span>'}</td></tr>`; }).join('') +
        `<tr><td>Armor</td><td>${you.armor?.armor || 0} (${Math.round((you.armor?.reduction || 0) * 100)}% damage reduction)</td></tr>` +
        `<tr><td>Health</td><td>${Math.round(you.hp)} / ${you.maxHp}</td></tr></table>`;
      body.appendChild(top);
      const h = document.createElement('h3');
      h.textContent = `Inventory (${you.inv.items.length}/24)`;
      body.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'items';
      for (const it of you.inv.items) {
        const on = Object.values(eq).includes(it.id);
        const el = document.createElement('div');
        el.className = 'item' + (on ? ' eq' : '');
        const det = it.kind === 'relic' ? describeBonus(RELICS[it.type].bonus)
          : it.kind === 'weapon' ? (() => { const s = weaponStats(it); return `${Math.round(s.damage * s.pellets)} dmg · ${+s.rate.toFixed(1)}/s`; })() : it.kind === 'mech' ? `${mechStats(it.tier).hp} hp mech (G)` : `${ARMOR_SLOTS[it.type].name} armor`;
        el.innerHTML = `<b style="color:${itemColor(it)}">${esc(itemName(it))}</b><span class="dim">${det}</span>${gradeLines(it)}`;
        if (it.grade && it.grade !== 'common') el.style.borderColor = itemColor(it);
        const slot = it.kind === 'weapon' ? 'weapon' : it.kind === 'relic' ? RELIC_SLOTS.find((r) => eq[r] === it.id) : it.type;
        el.appendChild(this.button(on ? 'Unequip' : 'Equip', () => this.send(on ? { t: 'unequip', slot } : { t: 'equip', id: it.id }), on ? 'alt' : ''));
        el.appendChild(this.button('Discard', () => { if (confirm(`Discard ${itemName(it)}?`)) this.send({ t: 'drop', id: it.id }); }, 'alt'));
        grid.appendChild(el);
      }
      body.appendChild(grid);
      const st = this.S.you.stats;
      const h2 = document.createElement('h3');
      h2.textContent = 'Ship';
      body.appendChild(h2);
      const t = document.createElement('div');
      t.innerHTML = `<table><tr><td>Blocks</td><td>${you.ship.length}</td></tr><tr><td>Hull / shield</td><td>${st.hp} / ${st.shield}</td></tr><tr><td>Top speed</td><td>${Math.round(st.maxSpeed)}</td></tr><tr><td>Guns</td><td>${st.guns} × ${Math.round(st.gunDamage)} dmg</td></tr><tr><td>Cargo</td><td>${st.cargo}</td></tr><tr><td>Jump range</td><td>${st.jumpRange} sectors</td></tr><tr><td>Kills</td><td>${you.kills || 0}</td></tr></table>`;
      body.appendChild(t);
    });
  }

  party() {
    this.open('party', 'Party', (body) => {
      const S = this.S, party = S.party;
      if (party) {
        for (const m of party.members) {
          const where = !m.online ? 'offline' : m.mode === 'space' ? `space · sector ${m.sx}, ${m.sz}` : `on ${findPlanet(m.planet, S.seed)?.name || 'a planet'}`;
          const btns = document.createElement('span');
          if (m.online && m.key !== S.you.key && m.mode === 'space' && S.you.mode === 'space') btns.appendChild(this.button('Warp to', () => { this.send({ t: 'warp', name: m.name }); this.close(); }, 'small'));
          if (party.leader === S.you.key && m.key !== S.you.key) btns.appendChild(this.button('Kick', () => this.send({ t: 'party_kick', name: m.name }), 'small alt'));
          body.appendChild(this.row(`<b style="color:${m.color || '#9fd0ff'}">${esc(m.name)}</b>${m.key === party.leader ? ' ★' : ''}<br><span class="small dim">${where}</span>`, btns));
        }
      } else {
        const p = document.createElement('p');
        p.className = 'dim';
        p.textContent = 'Fly together: up to 4 pilots. No friendly fire, shared bounties, party chat (/p), and party warp.';
        body.appendChild(p);
      }
      if (!party || (party.leader === S.you.key && party.members.length < 4)) {
        const inp = document.createElement('input');
        inp.placeholder = 'Pilot name to invite';
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { this.send({ t: 'party_invite', name: inp.value.trim() }); inp.value = ''; } });
        body.appendChild(inp);
        body.appendChild(this.button('Invite', () => { this.send({ t: 'party_invite', name: inp.value.trim() }); inp.value = ''; }));
      }
      if (party) body.appendChild(this.button('Leave party', () => this.send({ t: 'party_leave' }), 'alt'));
    });
  }

  // The Mercenary Guild's contract board, with your guild card on top.
  guild(m) {
    this.guildView = m;
    const render = (body) => {
      const g = this.guildView, r = RANKS[g.rank], next = RANKS[g.rank + 1];
      const card = document.createElement('div');
      card.className = 'guildcard';
      const pct = next ? Math.round(100 * (g.merit - r.merit) / (next.merit - r.merit)) : 100;
      card.innerHTML = `<div class="rankbadge" style="--rc:${r.color}">${r.id}</div><div class="guildinfo"><b>${esc(this.S.you.name)}</b> <span class="dim small">· ${r.title} · ${g.done} contracts</span>` +
        `<div class="small">${g.merit} merit${next ? ` · ${next.merit - g.merit} to ${next.id}-rank` : ' · the highest rank'}</div><div class="bar"><span style="width:${pct}%;background:${r.color}"></span></div></div>`;
      body.appendChild(card);
      const h1 = document.createElement('h3');
      h1.textContent = `Your contracts (${g.active.length}/${MAX_CONTRACTS})`;
      body.appendChild(h1);
      if (!g.active.length) body.appendChild(Object.assign(document.createElement('p'), { className: 'small dim', textContent: 'None. Take one from the board below.' }));
      for (const c of g.active) {
        const wrap = document.createElement('span');
        const tb = this.button(c.ready || c.kind === 'deliver' ? 'Turn in' : `${c.have}/${c.need}`, () => this.send({ t: 'guild_turnin', id: c.id }), c.ready ? '' : 'alt');
        tb.disabled = !c.ready && c.kind !== 'deliver';
        wrap.appendChild(tb);
        wrap.appendChild(this.button('Drop', () => { if (confirm(`Drop ${c.title}? The guild will dock some merit.`)) this.send({ t: 'quest_abandon', id: c.id }); }, 'alt'));
        body.appendChild(this.row(contractHtml(c) + (c.ready ? ' <span class="good small">✓ done</span>' : ''), wrap));
      }
      const h2 = document.createElement('h3');
      h2.textContent = 'Contract board';
      body.appendChild(h2);
      body.appendChild(Object.assign(document.createElement('p'), { className: 'small dim', textContent: 'New contracts are posted every hour. You can take work up to one rank above your own.' }));
      for (const c of g.board) {
        const b = this.button(c.taken ? 'Taken' : c.locked ? `Needs ${RANKS[c.rank - 1].id}` : 'Accept', () => this.send({ t: 'guild_accept', key: c.key }), c.taken || c.locked ? 'alt' : '');
        b.disabled = c.taken || c.locked || g.active.length >= MAX_CONTRACTS;
        const row = this.row(contractHtml(c), b);
        if (c.locked) row.style.opacity = 0.55;
        body.appendChild(row);
      }
    };
    if (this.current?.kind === 'guild' && this.isOpen()) { this.current.render = render; this.rerender(); } else this.open('guild', m.name, render);
  }

  journal() {
    this.open('journal', 'Journal', (body) => {
      // Quests from the people of the worlds.
      const qs = this.S.quests || [];
      if (qs.length) {
        const h = document.createElement('h3');
        h.textContent = 'Quests';
        body.appendChild(h);
        for (const q of qs) {
          const el = document.createElement('div');
          el.className = 'goal';
          el.innerHTML = `<b style="color:${q.guild ? '#8fe6ff' : '#f0d8a0'}">${esc(q.title)}</b> <span class="small dim">· ${q.guild ? `Mercenary Guild${q.planet ? ', ' + esc(q.planet) : ''}` : `${esc(q.giver || '')} of ${esc(q.town || '')}, ${esc(q.planet || '')}`}</span>` +
            (q.note ? `<div class="small" style="color:#ffe08a">${esc(q.note)}</div>` : '') +
            q.steps.map((s, i) => `<div class="small${i > q.step ? ' dim' : ''}">${s.done ? '<span class="good">✓</span>' : i === q.step ? '▸' : '○'} ${esc(s.text)}${s.need && i === q.step && s.have != null && s.type !== 'bring' ? ` (${s.have}/${s.need})` : ''}</div>`).join('');
          el.appendChild(this.button('Abandon', () => this.send({ t: 'quest_abandon', id: q.id }), 'alt small'));
          body.appendChild(el);
        }
      }
      const st = this.S.story;
      if (!st) return;
      const head = document.createElement('div');
      head.innerHTML = `<p class="small dim">Era ${st.era + 1} · Chapter ${st.arc + 1} of ${st.chapters.length}</p><h3 style="color:#ffb347">${esc(st.title)}</h3>` + st.intro.map((l) => `<p class="small">${esc(l)}</p>`).join('');
      body.appendChild(head);
      for (const g of st.goals) {
        const el = document.createElement('div');
        el.className = 'goal' + (g.active ? '' : ' locked');
        el.innerHTML = `${esc(g.label)}: <b>${g.progress} / ${g.target}</b>${g.active ? '' : ' <span class="dim">(locked)</span>'}<div class="bar"><span style="width:${(100 * g.progress) / g.target}%"></span></div>`;
        body.appendChild(el);
      }
      if (st.mothership) body.appendChild(this.row(`<b style="color:#d06aff">Hive Mothership</b> in sector ${st.mothership.sx}, ${st.mothership.sz}<br><span class="small dim">${Math.round(st.mothership.hp)} / ${st.mothership.maxHp} hp</span>`));
      if (st.relics) {
        const h = document.createElement('h3');
        h.textContent = 'Precursor relics';
        body.appendChild(h);
        for (const r of st.relics) body.appendChild(this.row(`${r.found ? '<span class="good">✓</span>' : '○'} ${esc(r.name)} <span class="dim">· sector ${r.sx}, ${r.sz}</span>`));
      }
      const eff = st.effects;
      const changes = [];
      if (eff.invasion) changes.push('The Hollow are invading every sector.');
      if (eff.gateBuilt) changes.push('The Ancient Gate at Haven Station leads to the Far Reach. Aetherium can be found far from home.');
      if (eff.jumpBonus) changes.push(`Precursor resonance: +${eff.jumpBonus} jump range for everyone.`);
      if (changes.length) {
        const h = document.createElement('h3');
        h.textContent = 'How the galaxy has changed';
        body.appendChild(h);
        for (const c of changes) { const p = document.createElement('p'); p.className = 'small'; p.textContent = c; body.appendChild(p); }
      }
      const you = this.S.you;
      const hf = document.createElement('h3');
      hf.textContent = 'Factions';
      body.appendChild(hf);
      for (const [id, f] of Object.entries(FACTIONS)) {
        const r = you.rep?.[id] || 0;
        const el = document.createElement('div');
        el.className = 'goal';
        el.innerHTML = `<b style="color:${f.color}">${esc(f.name)}</b>: ${esc(factionTitle(id, r))} <span class="dim">(${r})</span><div class="bar"><span style="width:${(r + 100) / 2}%;background:${f.color}"></span></div>`;
        body.appendChild(el);
      }
      const war = you.war || { empire: 0, rebellion: 0 };
      const total = war.empire + war.rebellion || 1;
      const w = document.createElement('div');
      w.className = 'goal';
      w.innerHTML = `The war: Empire ${war.empire} · Unbound ${war.rebellion} victories<div class="bar"><span style="width:${(100 * war.empire) / total}%;background:#f2cf4a"></span></div>`;
      body.appendChild(w);
      if (you.blessing && you.blessing.until > Date.now()) body.appendChild(this.row(`<b style="color:#ffe08a">${esc(you.blessing.name)}</b> · ${describeBonus(you.blessing.bonus)} · ${Math.ceil((you.blessing.until - Date.now()) / 60000)} min left`));
      const h2 = document.createElement('h3');
      h2.textContent = 'Log';
      body.appendChild(h2);
      for (const l of [...st.log].reverse()) { const p = document.createElement('p'); p.className = 'small dim'; p.textContent = l.text; body.appendChild(p); }
    });
  }

  // ---- codex: the content library, filled in as you discover things -------------------------

  discovered(keys) {
    for (const k of keys) {
      const [kind, id] = k.split(':');
      const name = { terrain: TERRAINS, creature: CREATURES, structure: STRUCTURES, relic: RELICS, god: GODS, race: ALIEN_RACES, dungeon: DUNGEON_THEMES, people: PEOPLES }[kind]?.[id]?.name;
      if (name) this.toast(`Codex: ${name}`, 'loot');
    }
    if (this.current?.kind === 'codex') this.rerender();
  }

  codex(tab = this.codexTab || 'creatures') {
    this.codexTab = tab;
    this.open('codex', 'Codex', (body) => {
      const known = new Set(this.S.you.codex || []);
      const tabs = { creatures: ['Creatures', CREATURES, 'creature'], aliens: ['Aliens', ALIEN_RACES, 'race'], peoples: ['Peoples', PEOPLES, 'people'], terrains: ['Terrains', TERRAINS, 'terrain'], structures: ['Structures', STRUCTURES, 'structure'], dungeons: ['Dungeons', DUNGEON_THEMES, 'dungeon'], relics: ['Relics', RELICS, 'relic'], gods: ['Gods', GODS, 'god'], factions: ['Powers', null] };
      const bar = document.createElement('div');
      bar.className = 'tabs';
      for (const [id, [label, table, prefix]] of Object.entries(tabs)) {
        const n = table ? Object.keys(table).filter((k) => known.has(`${prefix}:${k}`)).length : null;
        const b = this.button(n == null ? label : `${label} ${n}/${Object.keys(table).length}`, () => this.codex(id));
        if (id === tab) b.className = 'sel';
        bar.appendChild(b);
      }
      body.appendChild(bar);
      const [, table, prefix] = tabs[tab];
      if (!table) {
        for (const f of Object.values(FACTIONS)) body.appendChild(this.row(`<b style="color:${f.color}">${esc(f.name)}</b><br><span class="small">${esc(f.desc)}</span>`));
        body.appendChild(this.row(`<b style="color:#ffe08a">${HOLY_CAPITAL.planet}, the Holy Capital</b><br><span class="small">${esc(HOLY_CAPITAL.desc)}</span>`));
        body.appendChild(this.row(`<b style="color:#c27bff">The Precursors</b><br><span class="small">They raised temples to five gods, sealed their vaults, and vanished. Their ruins are on a thousand worlds, and their guardians still keep watch.</span>`));
        return;
      }
      for (const [id, e] of Object.entries(table)) {
        if (prefix === 'creature' && id === 'glowmoth' && !known.has('creature:glowmoth')) continue;
        if (prefix === 'creature' && e.race) continue;   // listed under Aliens
        if (!known.has(`${prefix}:${id}`)) {
          const hint = prefix === 'creature' ? (e.boss ? 'A dungeon boss' : e.tags.includes('dungeon') ? 'Found underground' : `Lives in: ${e.tags.join(', ')}`)
            : prefix === 'people' ? 'A native people of the worlds' : prefix === 'race' ? 'An alien species of the wilds' : prefix === 'dungeon' ? 'Find its entrance on a planet' : prefix === 'terrain' ? 'An undiscovered kind of world' : prefix === 'relic' ? `${RELIC_RARITY[e.rarity]} relic` : prefix === 'god' ? 'Pray at one of their shrines' : 'Not yet found';
          body.appendChild(this.row(`<span class="dim">??? · ${hint}</span>`));
          continue;
        }
        let html = `<b style="color:${e.color || (prefix === 'relic' ? relicColor({ type: id }) : '#9fd0ff')}">${esc(e.name)}</b>`;
        if (prefix === 'creature') html += ` <span class="dim small">${e.behavior} · ${e.hp} hp · ${e.dmg} dmg</span><br><span class="small">${esc(e.desc)}</span>`;
        if (prefix === 'terrain') html += `<br><span class="small">${esc(e.desc)}</span><br><span class="dim small">Ore: ${e.ore.map(([o]) => o).join(', ')}</span>`;
        if (prefix === 'structure') html += ` <span class="dim small">${e.kind}</span><br><span class="small">${esc(e.lore)}</span>`;
        if (prefix === 'relic') html += ` <span class="dim small">${RELIC_RARITY[e.rarity]}</span><br><span class="small">${describeBonus(e.bonus)}</span><br><span class="dim small">${esc(e.lore)}</span>`;
        if (prefix === 'people') html += ` <span class="dim small">${esc(e.plural)}</span><br><span class="small">${esc(e.lore)}</span><br><span class="dim small">${esc(e.temperament)} · build in the ${e.style} style · trade ${e.goods.join(', ')}</span>`;
        if (prefix === 'race') html += ` <span class="dim small">${e.disposition}</span><br><span class="small">${esc(e.desc)}</span><br><span class="dim small">Settles: ${e.tags.join(', ')}${e.trader ? ' · trades' : ''}</span>`;
        if (prefix === 'dungeon') html += `<br><span class="small">${esc(e.lore)}</span><br><span class="dim small">Boss: ${esc(CREATURES[e.boss].name)} · lives in ${e.tags.join(', ')} worlds</span>`;
        if (prefix === 'god') html += ` <span class="dim small">${esc(e.domain)}</span><br><span class="small">${esc(e.lore)}</span><br><span class="dim small">Blessing: ${describeBonus(e.blessing)} · Favor ${this.S.you.favor?.[id] || 0}/5</span>`;
        body.appendChild(this.row(html));
      }
    });
  }

  // Graphics quality (key O).
  options() {
    this.open('options', 'Options', (body) => {
      const gfx = this.S.gfx;
      const hs = document.createElement('h3');
      hs.textContent = 'Art style';
      body.appendChild(hs);
      const styles = {
        anime: ['Anime', 'Grounded, painted anime: natural colors, fine sepia linework, hand-drawn stone and soft painted skies.'],
        chibi: ['Chibi', 'Bright and cute: bold ink, punchy colors, big-eyed chibi pilots and drifting petals.'],
        realistic: ['Realistic', 'Physically based light, real skies, detailed people and ships.'],
      };
      for (const [id, [name, text]] of Object.entries(styles)) {
        const b = this.button(id === gfx.style ? `${name} ✓` : name, () => { gfx.setStyle(id); this.rerender(); }, id === gfx.style ? '' : 'alt');
        body.appendChild(this.row(`<b>${name}</b><br><span class="small dim">${text}</span>`, b));
      }
      const h = document.createElement('h3');
      h.textContent = 'Graphics quality';
      body.appendChild(h);
      const desc = {
        low: 'Lower resolution, no glow or shadows, fewer plants. For older computers and phones.',
        medium: 'Glow, shadows and real skies at normal resolution.',
        high: 'Sharper rendering, detailed shadows, lens flares and lusher planets.',
        ultra: 'Everything at maximum. Needs a strong graphics card.',
      };
      for (const [id, q] of Object.entries(gfx.constructor.QUALITY || {})) {
        const b = this.button(id === gfx.level ? `${q.name} ✓` : q.name, () => { gfx.set(id); this.rerender(); }, id === gfx.level ? '' : 'alt');
        body.appendChild(this.row(`<b>${q.name}</b><br><span class="small dim">${desc[id]}</span>`, b));
      }
      const p = document.createElement('p');
      p.className = 'small dim';
      p.textContent = 'Your choice is remembered in this browser.';
      body.appendChild(p);
    });
  }

  // ---- talking to people ---------------------------------------------------------------------

  talk(m) {
    this.talkState = { id: m.id, npc: m.npc, lines: [{ who: m.npc.name, text: m.line }], options: m.options, ai: m.ai };
    this.open('talk', m.npc.name, (body) => this.renderTalk(body));
  }

  talkLine(m) {
    const t = this.talkState;
    if (!t || t.id !== m.id) return;
    if (m.you) t.lines.push({ who: 'You', text: m.you });
    if (m.line) t.lines.push({ who: t.npc.name, text: m.line });
    if (m.options) t.options = m.options;
    if (m.note) t.lines.push({ who: '', text: m.note });
    t.waiting = false;
    if (this.current?.kind === 'talk') this.renderTalk($('panel-body'), true);
  }

  renderTalk(body, keepInput = false) {
    const t = this.talkState;
    const typed = keepInput ? body.querySelector('input')?.value || '' : '';
    body.innerHTML = '';
    body.className = 'dialogue talk';
    const card = document.createElement('p');
    card.className = 'small dim';
    card.textContent = `${t.npc.role} · ${t.npc.people} of ${t.npc.town}${t.npc.realm ? ' · ' + t.npc.realm : ''}`;
    body.appendChild(card);
    const log = document.createElement('div');
    log.className = 'talklog';
    for (const l of t.lines.slice(-14)) {
      const p = document.createElement('p');
      p.innerHTML = l.who ? `<b${l.who === 'You' ? ' class="you"' : ''}>${esc(l.who)}:</b> ${esc(l.text)}` : `<i class="dim">${esc(l.text)}</i>`;
      log.appendChild(p);
    }
    if (t.waiting) { const p = document.createElement('p'); p.className = 'dim'; p.textContent = `${t.npc.name} is thinking…`; log.appendChild(p); }
    body.appendChild(log);
    if (t.ai) {
      const row = document.createElement('div');
      row.className = 'talkrow';
      const input = document.createElement('input');
      input.placeholder = `Say something to ${t.npc.name}…`;
      input.maxLength = 240;
      input.value = typed;
      const sayIt = () => {
        const text = input.value.trim();
        if (!text || t.waiting) return;
        t.waiting = true;
        t.lines.push({ who: 'You', text });
        input.value = '';
        this.send({ t: 'talk_say', id: t.id, text });
        this.renderTalk(body);
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sayIt(); if (e.key === 'Escape') this.close(); });
      row.appendChild(input);
      row.appendChild(this.button('Say', sayIt));
      body.appendChild(row);
      setTimeout(() => input.focus(), 0);
    }
    const opts = document.createElement('div');
    opts.className = 'talkopts';
    for (const [id, text] of t.options) {
      opts.appendChild(this.button(text, () => {
        if (id === 'bye') { this.send({ t: 'talk_opt', id: t.id, opt: id }); return this.close(); }
        t.lines.push({ who: 'You', text });
        this.send({ t: 'talk_opt', id: t.id, opt: id });
        this.renderTalk(body);
      }, 'alt'));
    }
    body.appendChild(opts);
    log.scrollTop = log.scrollHeight;
  }

  market(m) {
    this.marketState = m;
    const coin = m.coin || ['coin', 'coins'];
    this.open('market', `${m.town}${m.goods.length ? ' market' : ' moneychanger'}`, (body) => {
      const st = this.marketState, you = this.S.you;
      const p = document.createElement('p');
      p.innerHTML = `${esc(st.realm || '')}<br>Purse: <b>${st.wallet} ${esc(coin[1])}</b> · ${you.credits} cr · 1 ${esc(coin[0])} ≈ ${st.rate} cr` +
        (st.goods.length ? `<br><span class="small dim">Carrying ${st.carried}/${st.cap} goods. Short on ${esc(coin[1])}? Credits cover the difference at a 10% markup.</span>` : '');
      body.appendChild(p);
      for (const g of st.goods) {
        const wrap = document.createElement('span');
        wrap.appendChild(this.button(`Buy ${g.buy}`, () => this.send({ t: 'market_buy', good: g.id, qty: 1 })));
        wrap.appendChild(this.button('×5', () => this.send({ t: 'market_buy', good: g.id, qty: 5 }), 'alt'));
        const sell = this.button(`Sell ${g.sell}`, () => this.send({ t: 'market_sell', good: g.id, qty: 1 }), 'alt');
        sell.disabled = !g.have;
        wrap.appendChild(sell);
        body.appendChild(this.row(`<b>${esc(g.name)}</b><br><span class="small dim">${g.have ? `you have ${g.have}` : '&nbsp;'}</span>`, wrap));
      }
      const h = document.createElement('h3');
      h.textContent = 'Money changing (5% fee)';
      body.appendChild(h);
      for (const n of [10, 50, 200]) {
        const wrap = document.createElement('span');
        wrap.appendChild(this.button(`Buy ${n} ${coin[1]}`, () => this.send({ t: 'exchange', dir: 'buy', amount: n })));
        const sb = this.button(`Sell ${n}`, () => this.send({ t: 'exchange', dir: 'sell', amount: n }), 'alt');
        sb.disabled = st.wallet < 1;
        wrap.appendChild(sb);
        body.appendChild(this.row(`<span>${n} ${esc(coin[1])} ≈ ${Math.ceil(n * st.rate * 1.05)} cr</span>`, wrap));
      }
    });
  }

  // The realms of this world: rulers, wars, alliances, troubles and where you stand.
  politics(v) {
    if (!v) return;
    this.open('politics', 'Realms of this world', (body) => {
      const name = (id) => v.realms.find((r) => r.id === id)?.name || '?';
      const word = (x) => (x <= -60 ? 'enemy' : x <= -30 ? 'unwelcome' : x < 20 ? 'stranger' : x < 50 ? 'friend' : x < 80 ? 'honored' : 'hero');
      if (!v.realms.length) body.innerHTML = '<p class="dim">Nobody lives here.</p>';
      for (const r of v.realms) {
        const div = document.createElement('div');
        div.className = 'realm';
        const rel = Object.entries(r.relations).map(([id, x]) => `${esc(name(id))}: <span style="color:${x < -30 ? '#ff8a7a' : x > 40 ? '#8affb0' : '#e8e0c0'}">${x > 0 ? '+' : ''}${x}</span>`).join(' · ');
        div.innerHTML = `<h3>${esc(r.name)}</h3>
          <div class="small">${esc(PEOPLES[r.people].name)} (${esc(PEOPLES[r.people].plural)}) · ${esc(r.government)}${r.ruler ? ` · ruled by <b>${esc(r.ruler)}</b>` : ''}</div>
          <div class="small">Towns: ${r.towns.map((t) => `${esc(t.name)} <span class="dim">(${t.size}${t.capital ? ', capital' : ''})</span>`).join(', ') || 'none'}</div>
          <div class="small">Stability ${r.stability}/100 · Treasury ${r.treasury} ${esc(r.coin[1])} · 1 ${esc(r.coin[0])} ≈ ${r.rate} cr</div>
          ${r.war ? `<div style="color:#ff8a7a">At war with the ${esc(name(r.war.with))} (score ${r.war.score})</div>` : ''}
          ${r.allies.length ? `<div style="color:#8affb0">Allied with ${r.allies.map((a) => esc(name(a))).join(', ')}</div>` : ''}
          ${r.event ? `<div style="color:#ffe08a">${{ famine: 'Famine', plague: 'Plague', festival: 'Festival', raiders: 'Raiders abroad' }[r.event] || r.event}</div>` : ''}
          ${rel ? `<div class="small dim">Relations: ${rel}</div>` : ''}
          <div class="small">You are <b>${word(r.standing)}</b> here (${r.standing > 0 ? '+' : ''}${r.standing}).</div>`;
        body.appendChild(div);
      }
      if (v.log.length) {
        const h = document.createElement('h3');
        h.textContent = 'Chronicle';
        body.appendChild(h);
        for (const e of [...v.log].reverse()) {
          const p = document.createElement('p');
          p.className = 'small';
          p.innerHTML = `<span class="dim">${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> ${esc(e.text)}`;
          body.appendChild(p);
        }
      }
    });
  }

  // A storage chest: move materials between it and your cargo hold.
  chest(cell, inv) {
    this.chestState = { cell, inv };
    this.open('chest', 'Storage chest', (body) => {
      const st = this.chestState, you = this.S.you;
      body.appendChild(this.row(`Your hold: ${cargoTotal(you.cargo)}/${you.stats.cargo}`, this.button('Store everything', () => this.send({ t: 'chest', cell: st.cell, dir: 'put', item: 'all' }))));
      const ids = [...new Set([...Object.keys(st.inv), ...Object.keys(you.cargo)])].filter((k) => ORES[k]);
      for (const k of ids) {
        const wrap = document.createElement('span');
        const put = this.button('Store', () => this.send({ t: 'chest', cell: st.cell, dir: 'put', item: k }), 'alt');
        put.disabled = !you.cargo[k];
        const take = this.button('Take', () => this.send({ t: 'chest', cell: st.cell, dir: 'take', item: k }));
        take.disabled = !st.inv[k];
        wrap.append(put, take);
        body.appendChild(this.row(`<span style="color:${ORES[k].color}">${ORES[k].name}</span> <span class="small dim">chest ${st.inv[k] || 0} · hold ${you.cargo[k] || 0}</span>`, wrap));
      }
      if (!ids.length) body.appendChild(Object.assign(document.createElement('p'), { className: 'dim', textContent: 'Empty.' }));
    });
  }

  // Crafting from materials (key C on a planet, or Fabricator at a station).
  craft() {
    this.craftTier ||= 1;
    this.open('craft', 'Crafting', (body) => {
      const you = this.S.you;
      const maxTier = Math.min(5, 2 + Math.floor(skillLevel(you.skills?.crafting) / 4));
      const p = document.createElement('p');
      p.className = 'small dim';
      p.textContent = `Craft at your own workbench, in a town with a smith, or aboard a station. Your crafting skill allows tier ${maxTier}. Materials come from digging (stone, silver, mithril, mana crystal), chopping trees (wood) and hunting (hide).`;
      body.appendChild(p);
      const tiers = document.createElement('div');
      tiers.className = 'talkopts';
      for (let t = 1; t <= 5; t++) {
        const b = this.button(`Tier ${t}${t === this.craftTier ? ' ✓' : ''}`, () => { this.craftTier = t; this.rerender(); }, t === this.craftTier ? '' : 'alt');
        b.disabled = t > maxTier;
        tiers.appendChild(b);
      }
      body.appendChild(tiers);
      const tier = this.craftTier;
      for (const id of RECIPE_IDS) {
        const r = RECIPES[id], cost = recipeCost(id, tier);
        const ok = canAfford(you.cargo, cost);
        const costTxt = Object.entries(cost).map(([k, v]) => `<span style="color:${(you.cargo[k] || 0) >= v ? '#9fe0a0' : '#ff9a8a'}">${v} ${ORES[k]?.name || k}</span>`).join(', ');
        const wrap = document.createElement('span');
        const types = r.makes === 'weapon' ? WEAPON_IDS : r.makes === 'armor' ? ['helmet', 'chest', 'legs'] : [null];
        for (const type of types) {
          const b = this.button(type ? type[0].toUpperCase() + type.slice(1) : 'Craft', () => this.send({ t: 'craft', recipe: id, tier, type }), ok ? '' : 'alt');
          b.disabled = !ok;
          wrap.appendChild(b);
        }
        body.appendChild(this.row(`<b>${esc(r.name)}</b> <span class="small dim">tier ${tier}</span><br><span class="small">${costTxt}</span>`, wrap));
      }
      // Enhancement: +1 at a time, riskier the higher it goes.
      const gear = you.inv.items.filter((i) => i.kind === 'weapon' || i.kind === 'armor');
      if (!gear.length) return;
      const h = document.createElement('h3');
      h.textContent = 'Enhance gear';
      body.appendChild(h);
      const note = document.createElement('p');
      note.className = 'small dim';
      note.textContent = `Each level adds about 7% damage or 6% armor, up to +${MAX_PLUS}. Past +5 a failed attempt costs a level.`;
      body.appendChild(note);
      for (const it of gear) {
        const plus = it.plus || 0;
        if (plus >= MAX_PLUS) { body.appendChild(this.row(`<b style="color:${itemColor(it)}">${esc(itemName(it))}</b>`, document.createTextNode('Max'))); continue; }
        const c = enhanceCost(it);
        const ok = you.credits >= c.credits && canAfford(you.cargo, c.ores);
        const costTxt = [`<span style="color:${you.credits >= c.credits ? '#9fe0a0' : '#ff9a8a'}">${c.credits} cr</span>`,
          ...Object.entries(c.ores).map(([k, v]) => `<span style="color:${(you.cargo[k] || 0) >= v ? '#9fe0a0' : '#ff9a8a'}">${v} ${ORES[k]?.name || k}</span>`)].join(', ');
        const chance = Math.round(Math.min(1, ENHANCE_CHANCE[plus] + skillBonus(you.skills, 'crafting') * 0.3) * 100);
        const b = this.button(`+${plus + 1} · ${chance}%`, () => this.send({ t: 'enhance', id: it.id }), ok ? '' : 'alt');
        b.disabled = !ok;
        body.appendChild(this.row(`<b style="color:${itemColor(it)}">${esc(itemName(it))}</b><br><span class="small">${costTxt}</span>`, b));
      }
    });
  }

  // Skills, spellbook, superpower and curse (key U).
  skills() {
    this.open('skills', 'Skills & powers', (body) => {
      const you = this.S.you;
      const h = document.createElement('h3');
      h.textContent = 'Skills';
      body.appendChild(h);
      for (const id of SKILL_IDS) {
        const xp = you.skills?.[id] || 0, lvl = skillLevel(xp);
        const next = xpForLevel(lvl + 1), cur = xpForLevel(lvl);
        const el = document.createElement('div');
        el.className = 'goal';
        el.innerHTML = `<b>${SKILLS[id].name}</b> ${lvl} <span class="small dim">· grows by ${SKILLS[id].what} · +${Math.round(lvl * SKILLS[id].per * 100)}% ${SKILLS[id].bonus}</span><div class="bar"><span style="width:${lvl >= 20 ? 100 : (100 * (xp - cur)) / (next - cur)}%"></span></div>`;
        body.appendChild(el);
      }
      const h2 = document.createElement('h3');
      h2.textContent = `Spellbook · mana ${Math.round(you.mana || 0)}/${you.maxMana || 60}`;
      body.appendChild(h2);
      if (!(you.spells || []).length) body.appendChild(Object.assign(document.createElement('p'), { className: 'small dim', textContent: 'You know no spells. Mages, priests and healers in towns can teach you (talk to them).' }));
      (you.spells || []).forEach((id, i) => {
        const sp = SPELLS[id];
        body.appendChild(this.row(`<b style="color:${sp.color}">${i < 4 ? `[${i + 1}] ` : ''}${esc(sp.name)}</b> <span class="small dim">${sp.mana} mana · ${esc(sp.text)}</span>`));
      });
      const h3 = document.createElement('h3');
      h3.textContent = 'Superpower';
      body.appendChild(h3);
      const pw = you.power && POWERS[you.power];
      body.appendChild(Object.assign(document.createElement('p'), { className: 'small', innerHTML: pw ? `<b>${esc(pw.name)}</b> (F) · energy ${Math.round(you.energy || 0)}/${MAX_ENERGY}<br>${esc(pw.text)}` : 'None. Pray at a shrine of the old gods: whoever prays to one god three times receives that god’s power (flight, strength, invulnerability, speed or invisibility).' }));
      if (you.curse) {
        const h4 = document.createElement('h3');
        h4.textContent = 'Curse';
        body.appendChild(h4);
        body.appendChild(Object.assign(document.createElement('p'), { className: 'small', innerHTML: `<b style="color:#ff8a9a">${esc(CURSES[you.curse].name)}</b><br>${esc(CURSES[you.curse].text)}` }));
      }
      if (you.mechMax) {
        const h5 = document.createElement('h3');
        h5.textContent = 'Mech';
        body.appendChild(h5);
        body.appendChild(Object.assign(document.createElement('p'), { className: 'small', textContent: `Frame integrity ${Math.round(you.mechHp)}/${you.mechMax}. G to climb in or out on a planet. It repairs itself while you're out of it.` }));
      }
    });
  }

  dialogue(who) {
    this.open('dialogue', who, (body) => {
      body.className = 'dialogue';
      body.innerHTML = WARDEN_LINES.map((l) => `<p>${esc(l)}</p>`).join('');
      body.appendChild(this.button('Thanks, Warden', () => this.close()));
    });
  }

  help() {
    this.open('help', 'Flight manual', (body) => {
      body.innerHTML = `
        <h3>In space</h3><table>
        <tr><td>Mouse</td><td>Steer (click the game to capture the mouse)</td></tr>
        <tr><td>W / S</td><td>Thrust forward / back</td></tr><tr><td>A / D</td><td>Strafe</td></tr>
        <tr><td>Space / C</td><td>Rise / sink</td></tr><tr><td>Q / E</td><td>Roll (E docks when near a station)</td></tr>
        <tr><td>X</td><td>Brake</td></tr><tr><td>Left mouse</td><td>Fire blasters</td></tr>
        <tr><td>Right mouse (hold)</td><td>Mine the asteroid you're aiming at</td></tr>
        <tr><td>E</td><td>Dock at a station</td></tr><tr><td>L</td><td>Land on a nearby planet</td></tr>
        <tr><td>M</td><td>Galaxy map (click a sector in range to jump)</td></tr>
        <tr><td>B</td><td>Build structures (left place, right remove, 1-6 block)</td></tr></table>
        <h3>On foot</h3><table>
        <tr><td>WASD / Shift</td><td>Walk / run</td></tr><tr><td>Space</td><td>Jump</td></tr>
        <tr><td>Left mouse</td><td>Shoot, or swing a sword (every third swing in a row is a sword skill)</td></tr><tr><td>Q</td><td>Vorpal Strike (with a sword)</td></tr><tr><td>E at a guild hall</td><td>Mercenary Guild contract board</td></tr><tr><td>Right mouse</td><td>Dig (Shift+right raises ground)</td></tr>
        <tr><td>E</td><td>Interact / board your ship</td></tr><tr><td>Y</td><td>Shipyard (next to your ship)</td></tr>
        <tr><td>B</td><td>Build blocks</td></tr><tr><td>V</td><td>First / third person</td></tr></table>
        <h3>Anywhere</h3><table>
        <tr><td>Tab</td><td>Gear and inventory</td></tr><tr><td>J</td><td>Story journal</td></tr><tr><td>P</td><td>Party</td></tr><tr><td>R</td><td>Realms of this world (on a planet)</td></tr><tr><td>U</td><td>Skills, spellbook and powers</td></tr><tr><td>C</td><td>Crafting (on a planet)</td></tr><tr><td>1-4</td><td>Cast spells (on foot)</td></tr><tr><td>F / T / G</td><td>Superpower · werewolf form · mech</td></tr><tr><td>E</td><td>Talk to people in towns</td></tr>
        <tr><td>K</td><td>Codex: creatures, terrains, structures, relics, gods</td></tr>
        <tr><td>O</td><td>Options (art style, graphics quality)</td></tr>
        <tr><td>Enter</td><td>Chat (/p for party)</td></tr><tr><td>H</td><td>This manual</td></tr></table>
        <p class="small">Haven's sectors are safe. Beyond them, pirates hunt and other pilots can fire on you. Ore and loot get better the farther you go.</p>`;
    });
  }

  // ---- HUD --------------------------------------------------------------------------------

  renderPalette() {
    const pal = $('palette');
    pal.innerHTML = '';
    const here = this.S.you?.mode === 'space' ? 'space' : 'surface';
    const list = BLOCK_IDS.filter((id) => blockAllowed(id, here));
    if (!list.includes(this.S.block)) this.S.block = list[0];
    list.forEach((id, i) => {
      const def = BLOCKS[id];
      const el = document.createElement('div');
      el.className = id === this.S.block ? 'sel' : '';
      el.style.opacity = canAfford(this.S.you.cargo, def.cost) ? 1 : 0.45;
      const cost = Object.entries(def.cost).map(([k, v]) => `${v} ${ORES[k].name}`).join(', ');
      el.innerHTML = `<i style="background:${def.color}"></i>${i < 10 ? `${(i + 1) % 10}. ` : ''}${def.name}<div class="dim">${cost}</div>`;
      el.onclick = () => { this.S.block = id; this.renderPalette(); };
      pal.appendChild(el);
    });
  }

  hud(now, ctx) {
    if (now - this.hudAt < 120) return;
    this.hudAt = now;
    const S = this.S, you = S.you, me = S.me;
    let where, sub;
    if (you.mode === 'space') {
      const [sx, sz] = sectorOf(me.x, me.z);
      const sec = generateSector(sx, sz, S.seed);
      where = `<div class="big">${esc(sec.name)}</div><div class="dim">${esc(sec.region.name)}</div><div>Sector ${sx}, ${sz} · ${sec.star ? sec.star.type : 'deep space'}</div>`;
      const terr = TERRITORY[territoryOf(sx, sz, S.seed)];
      const hole = sec.star?.type === 'Black hole' ? Math.hypot(sec.star.x - me.x, sec.star.z - me.z) / sec.star.r : 99;
      sub = (hole < 12 ? `<div style="color:#ff7a6a">${hole < 3.2 ? 'INSIDE THE ACCRETION DISK' : 'Black hole gravity well'}</div>` : '') + `<div><span style="color:${terr.color}">${terr.name}</span>${isSafe(sx, sz) ? ' <span class="good">(safe)</span>' : ''} · Speed ${Math.round(Math.hypot(me.vx, me.vy, me.vz))}</div>` +
        `<div class="dim">Jump ${ctx.jumpLeft ? 'charging ' + Math.ceil(ctx.jumpLeft / 1000) + 's' : 'ready'} · range ${you.stats.jumpRange}</div>`;
    } else if (you.mode === 'dungeon' && ctx.dungeon) {
      const dg = ctx.dungeon;
      where = `<div class="big">${esc(dg.name)}</div><div class="dim">Depth ${dg.depth} · underground</div>`;
      sub = `<div>${dg.boss ? '<span class="good">The boss is dead</span>' : `<span style="color:#ff8a7a">${dg.left} monsters remain</span>`}</div>`;
    } else {
      const p = findPlanet(you.planet, S.seed);
      where = `<div class="big">${esc(p.name)}</div><div class="dim">${TERRAINS[terrainOfPlanet(p)].name}${p.starter ? ' · starter planet' : p.holy ? ' · Holy Capital' : ''}</div>`;
      const terr = TERRITORY[p.territory] || TERRITORY.wilds;
      sub = `<div>${p.starter ? '<span class="good">Haven Landing (safe)</span>' : `<span style="color:${terr.color}">${terr.name}</span>`}</div>`;
      const t = Date.now() / 1000 + (S.timeOffset || 0) / 1000, sun = sunAt(p, t), wx = weatherInfo(weatherAt(p, t));
      const hh = Math.floor(sun.hour), mm = Math.floor((sun.hour % 1) * 60);
      const town = townsOf(p).find((x) => Math.hypot(x.x - me.x, x.z - me.z) < x.radius + 15);
      sub += `<div class="dim">${CLIMATES[climateOf(p)].name} · ${gravityOf(p)}g · ${wx.name}${wx.exposure ? ' <span style="color:#ff9a7a">(exposure)</span>' : ''} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${sun.night ? ' night' : ''}</div>`;
      if (town) sub += `<div style="color:#f0d8a0">${esc(town.name)} <span class="dim">(R: realms)</span></div>`;
    }
    const bless = you.blessing && you.blessing.until > Date.now() ? `<div style="color:#ffe08a">${esc(you.blessing.name)} · ${Math.ceil((you.blessing.until - Date.now()) / 60000)}m</div>` : '';
    $('status').innerHTML = where + sub + bless + `<div>${you.credits} cr · ${S.online} pilot${S.online === 1 ? '' : 's'} online</div>`;

    // Objective: tutorial step first, then the story.
    let obj = '';
    const q = (S.quests || [])[0];
    if (q && q.steps[q.step]) {
      const s = q.steps[q.step];
      obj += `<b style="color:#f0d8a0">${esc(q.title)}</b><br>${esc(s.text)}${s.need && s.have != null ? ` (${s.have}/${s.need})` : ''}${q.note ? `<br><span style="color:#ffe08a" class="small">${esc(q.note)}</span>` : ''}<br><br>`;
    }
    const step = TUTORIAL[you.tutorial];
    if (step) obj += `<b>Training ${you.tutorial + 1}/${TUTORIAL.length}</b><br>${esc(step.text)}${step.count ? ` (${you.tutCount || 0}/${step.count})` : ''}<br><br>`;
    if (S.story) {
      obj += `<b>${esc(S.story.title)}</b> <span class="dim">(J)</span>`;
      for (const g of S.story.goals.filter((x) => x.active).slice(0, 3)) obj += `<div>${esc(g.label)} ${g.progress}/${g.target}</div><div class="bar"><span style="width:${(100 * g.progress) / g.target}%"></span></div>`;
      if (S.story.mothership) obj += `<div style="color:#d06aff">Mothership: sector ${S.story.mothership.sx}, ${S.story.mothership.sz}</div>`;
    }
    $('objective').innerHTML = obj;

    const st = you.stats, total = cargoTotal(you.cargo);
    const segs = ORE_IDS.filter((k) => you.cargo[k]).map((k) => `<span style="width:${(100 * you.cargo[k]) / st.cargo}%;background:${ORES[k].color}"></span>`).join('');
    const list = ORE_IDS.filter((k) => you.cargo[k]).map((k) => `<span style="color:${ORES[k].color}">${you.cargo[k]} ${ORES[k].name}</span>`).join(' ');
    $('cargo').innerHTML = `<span>Cargo ${total}/${st.cargo}</span><div class="cbar">${segs}</div><span class="small">${list}</span>`;

    const vbar = (lbl, v, max, color) => `<span class="small">${lbl}</span><div class="vbar"><span style="width:${Math.max(0, (100 * v) / Math.max(1, max))}%;background:${color}"></span></div>`;
    if (you.mode === 'space') $('vitals').innerHTML = vbar('Hull', you.hull, st.hp, '#ff8a5a') + (st.shield ? vbar('Shield', you.shield, st.shield, '#4bd8ff') : '');
    else {
      let v = you.inMech ? vbar('Mech', you.mechHp, you.mechMax, '#ffb060') : vbar('Health', you.hp, you.maxHp, you.wolf ? '#e8c86a' : '#78ffaa');
      if (you.ward) v += vbar('Ward', you.ward.hp, you.ward.max, '#ffe08a');
      if ((you.spells || []).length) v += vbar('Mana', you.mana, you.maxMana, '#7a9aff');
      if (you.power) v += vbar(you.powerOn ? 'Energy ●' : 'Energy', you.energy, MAX_ENERGY, '#e0a0ff');
      v += `<span class="small">Armor ${you.armor?.armor || 0}${you.curse ? ` · <span style="color:#ff8a9a">${you.wolf ? 'Wolf form' : CURSES[you.curse].name}</span>` : ''}</span>`;
      $('vitals').innerHTML = v;
    }

    const ph = $('party-hud');
    ph.hidden = !S.party;
    if (S.party) {
      ph.innerHTML = '<div class="dim">Party (P)</div>' + S.party.members.map((m) => `<div class="m"><span style="color:${m.color || '#9fd0ff'}">${esc(m.name)}</span>${m.online ? '' : ' <span class="dim">offline</span>'}<div class="hb"><span style="width:${Math.max(0, Math.min(1, m.health ?? 0)) * 100}%"></span></div></div>`).join('');
    }

    $('prompt').textContent = ctx.prompt || '';
    $('hint').innerHTML = ctx.hint || '';
  }

  radar(ctx2d, dots) {
    const R = 86, cx = 90, cy = 90;
    ctx2d.clearRect(0, 0, 180, 180);
    ctx2d.fillStyle = 'rgba(8,12,22,0.72)';
    ctx2d.strokeStyle = '#1f2a44';
    ctx2d.beginPath(); ctx2d.arc(cx, cy, R, 0, Math.PI * 2); ctx2d.fill(); ctx2d.stroke();
    ctx2d.strokeStyle = 'rgba(120,160,220,0.15)';
    ctx2d.beginPath(); ctx2d.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx2d.stroke();
    for (const d of dots) {
      if (d.x * d.x + d.y * d.y > 1) continue;
      ctx2d.fillStyle = d.c;
      const s = d.s || 3;
      ctx2d.fillRect(cx + d.x * R - s / 2, cy + d.y * R - s / 2, s, s);
    }
    ctx2d.fillStyle = '#fff';
    ctx2d.beginPath(); ctx2d.moveTo(cx, cy - 6); ctx2d.lineTo(cx - 4, cy + 4); ctx2d.lineTo(cx + 4, cy + 4); ctx2d.fill();
  }
}

