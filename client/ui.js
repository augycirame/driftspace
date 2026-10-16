// DOM interface: HUD, panels (station, shop, gear, party, journal, dialogue, help),
// story transmissions, toasts and chat.

import { generateSector, sectorOf, findPlanet, isSafe, territoryOf } from '/shared/universe.js';
import { ORES, ORE_IDS, BLOCKS, BLOCK_IDS, UPGRADES, upgradeCost, cargoTotal, canAfford } from '/shared/rules.js';
import { TIERS, ARMOR_SLOTS, ARMOR_SLOT_IDS, itemName, weaponStats, itemValue, relicColor, describeBonus, RELIC_SLOTS } from '/shared/items.js';
import { TERRAINS, CREATURES, STRUCTURES, RELICS, RELIC_RARITY, FACTIONS, GODS, HOLY_CAPITAL, TERRITORY, factionTitle, ALIEN_RACES, DUNGEON_THEMES } from '/shared/content/index.js';
import { TUTORIAL, WARDEN_LINES } from '/shared/tutorial.js';
import { terrainOf as terrainOfPlanet } from '/shared/planet.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    if (this.current && this.isOpen()) this.rerender();
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
        const nm = itemName(s), color = TIERS[s.tier].color;
        const detail = s.kind === 'weapon' ? (() => { const w = weaponStats(s); return `${Math.round(w.damage * w.pellets)} dmg × ${w.rate}/s · range ${Math.round(w.range)}`; })()
          : `+${Math.round(ARMOR_SLOTS[s.type].armor * s.tier * TIERS[s.tier].mult)} armor`;
        const b = this.button(`${s.price} cr`, () => this.send({ t: 'buy', slot: s.slot }));
        b.disabled = you.credits < s.price;
        body.appendChild(this.row(`<b style="color:${color}">${esc(nm)}</b><br><span class="small dim">${detail}</span>`, b));
      }
      const h = document.createElement('h3');
      h.textContent = 'Sell your gear';
      body.appendChild(h);
      for (const it of you.inv.items) {
        body.appendChild(this.row(`<span style="color:${TIERS[it.tier].color}">${esc(itemName(it))}</span>`, this.button(`Sell ${Math.round(itemValue(it) * 0.5)} cr`, () => this.send({ t: 'sell_item', id: it.id }), 'alt')));
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
        `<table><tr><td>Weapon</td><td>${w ? `<span style="color:${TIERS[w.tier].color}">${esc(itemName(w))}</span> · ${Math.round(ws.damage * ws.pellets * ws.rate)} dps` : '<span class="dim">none</span>'}</td></tr>` +
        ARMOR_SLOT_IDS.map((s) => { const a = find(eq[s]); return `<tr><td>${ARMOR_SLOTS[s].name}</td><td>${a ? `<span style="color:${TIERS[a.tier].color}">${esc(itemName(a))}</span>` : '<span class="dim">none</span>'}</td></tr>`; }).join('') +
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
          : it.kind === 'weapon' ? (() => { const s = weaponStats(it); return `${Math.round(s.damage * s.pellets)} dmg · ${s.rate}/s`; })() : `${ARMOR_SLOTS[it.type].name} armor`;
        el.innerHTML = `<b style="color:${TIERS[it.tier].color}">${esc(itemName(it))}</b><span class="dim">${det}</span>`;
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

  journal() {
    this.open('journal', 'Journal', (body) => {
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
      const name = { terrain: TERRAINS, creature: CREATURES, structure: STRUCTURES, relic: RELICS, god: GODS, race: ALIEN_RACES, dungeon: DUNGEON_THEMES }[kind]?.[id]?.name;
      if (name) this.toast(`Codex: ${name}`, 'loot');
    }
    if (this.current?.kind === 'codex') this.rerender();
  }

  codex(tab = this.codexTab || 'creatures') {
    this.codexTab = tab;
    this.open('codex', 'Codex', (body) => {
      const known = new Set(this.S.you.codex || []);
      const tabs = { creatures: ['Creatures', CREATURES, 'creature'], aliens: ['Aliens', ALIEN_RACES, 'race'], terrains: ['Terrains', TERRAINS, 'terrain'], structures: ['Structures', STRUCTURES, 'structure'], dungeons: ['Dungeons', DUNGEON_THEMES, 'dungeon'], relics: ['Relics', RELICS, 'relic'], gods: ['Gods', GODS, 'god'], factions: ['Powers', null] };
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
            : prefix === 'race' ? 'An alien species of the wilds' : prefix === 'dungeon' ? 'Find its entrance on a planet' : prefix === 'terrain' ? 'An undiscovered kind of world' : prefix === 'relic' ? `${RELIC_RARITY[e.rarity]} relic` : prefix === 'god' ? 'Pray at one of their shrines' : 'Not yet found';
          body.appendChild(this.row(`<span class="dim">??? · ${hint}</span>`));
          continue;
        }
        let html = `<b style="color:${e.color || (prefix === 'relic' ? relicColor({ type: id }) : '#9fd0ff')}">${esc(e.name)}</b>`;
        if (prefix === 'creature') html += ` <span class="dim small">${e.behavior} · ${e.hp} hp · ${e.dmg} dmg</span><br><span class="small">${esc(e.desc)}</span>`;
        if (prefix === 'terrain') html += `<br><span class="small">${esc(e.desc)}</span><br><span class="dim small">Ore: ${e.ore.map(([o]) => o).join(', ')}</span>`;
        if (prefix === 'structure') html += ` <span class="dim small">${e.kind}</span><br><span class="small">${esc(e.lore)}</span>`;
        if (prefix === 'relic') html += ` <span class="dim small">${RELIC_RARITY[e.rarity]}</span><br><span class="small">${describeBonus(e.bonus)}</span><br><span class="dim small">${esc(e.lore)}</span>`;
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
        realistic: ['Realistic', 'Smooth lighting and natural colors.'],
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
        <tr><td>Left mouse</td><td>Shoot</td></tr><tr><td>Right mouse</td><td>Dig (Shift+right raises ground)</td></tr>
        <tr><td>E</td><td>Interact / board your ship</td></tr><tr><td>Y</td><td>Shipyard (next to your ship)</td></tr>
        <tr><td>B</td><td>Build blocks</td></tr><tr><td>V</td><td>First / third person</td></tr></table>
        <h3>Anywhere</h3><table>
        <tr><td>Tab</td><td>Gear and inventory</td></tr><tr><td>J</td><td>Story journal</td></tr><tr><td>P</td><td>Party</td></tr>
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
    BLOCK_IDS.forEach((id, i) => {
      const def = BLOCKS[id];
      const el = document.createElement('div');
      el.className = id === this.S.block ? 'sel' : '';
      el.style.opacity = canAfford(this.S.you.cargo, def.cost) ? 1 : 0.45;
      const cost = Object.entries(def.cost).map(([k, v]) => `${v} ${ORES[k].name}`).join(', ');
      el.innerHTML = `<i style="background:${def.color}"></i>${i + 1}. ${def.name}<div class="dim">${cost}</div>`;
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
      sub = `<div><span style="color:${terr.color}">${terr.name}</span>${isSafe(sx, sz) ? ' <span class="good">(safe)</span>' : ''} · Speed ${Math.round(Math.hypot(me.vx, me.vy, me.vz))}</div>` +
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
    }
    const bless = you.blessing && you.blessing.until > Date.now() ? `<div style="color:#ffe08a">${esc(you.blessing.name)} · ${Math.ceil((you.blessing.until - Date.now()) / 60000)}m</div>` : '';
    $('status').innerHTML = where + sub + bless + `<div>${you.credits} cr · ${S.online} pilot${S.online === 1 ? '' : 's'} online</div>`;

    // Objective: tutorial step first, then the story.
    let obj = '';
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
    else $('vitals').innerHTML = vbar('Health', you.hp, you.maxHp, '#78ffaa') + `<span class="small">Armor ${you.armor?.armor || 0}</span>`;

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

