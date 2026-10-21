// Driftspace client entry point: login, networking, input, and the frame loop that drives
// the space and planet-surface scenes.

import * as THREE from 'three';
import { generateSector, sectorOf, sectorKey, planetPos } from '/shared/universe.js';
import { ORES, STARTER_SHIP, JUMP_COOLDOWN_MS, BLOCK_IDS, shipStats, cargoTotal, blockAllowed } from '/shared/rules.js';
import { weaponStats } from '/shared/items.js';
import { deposits } from '/shared/planet.js';
import { SpaceView } from './space.js';
import { SurfaceView } from './surface.js';
import { DungeonView } from './dungeon.js';
import { Graphics } from './graphics.js';
import { Shipyard } from './shipyard.js';
import { GalaxyMap } from './map.js';
import { UI } from './ui.js';
import { buildPerson, setAnimeMode } from './meshes.js';
import { loadPeople } from './people.js';

const $ = (id) => document.getElementById(id);

const S = {
  ws: null, seed: 1337, timeOffset: 0, connected: false, dead: false,
  you: null, me: null,
  others: new Map(), npcs: new Map(), creatures: new Map(), parked: [], ships: new Map(),
  deltas: new Map(), beacons: new Map(), story: null, effects: {}, party: null, online: 0,
  block: 'hull', mode: 'fly', lastJump: 0, flash: 0,
  isPartyMember: (key) => !!S.party?.members.some((m) => m.key === key),
};
window.__ds = S; // handy for debugging in the browser console

const send = (msg) => { if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg)); };
const serverTime = () => (Date.now() + S.timeOffset) / 1000;

// ---- rendering setup ----------------------------------------------------------------------------

const canvas = $('game');
const gfx = new Graphics(canvas);
S.gfx = gfx;
setAnimeMode(gfx.anime && gfx.style);
// Realistic people come from a model: start fetching it right away.
if (gfx.style !== 'chibi') loadPeople().catch(() => {});
const space = new SpaceView(S);
const surface = new SurfaceView(S);
const dungeon = new DungeonView(S);
const ui = new UI(S, send);
const yard = new Shipyard(S, send);
const map = new GalaxyMap(S, send);
window.__views = { space, surface, dungeon };
// Changing quality rebuilds what depends on it (planet textures, shadows, plants).
gfx.onChange(() => {
  setAnimeMode(gfx.anime && gfx.style);
  if (gfx.style !== 'chibi') loadPeople().catch(() => {});
  space.clearEntities();
  space.selfRev = -1;
  space.rebuildSectors();
  if (dungeon.key) dungeon.enter({ ...dungeon.msg, opened: [...dungeon.opened], bossDead: dungeon.bossDead });
  if (surface.planetId) surface.enter(surface.planetId, { ...surface.data, looted: [...surface.looted] });
});
ui.onShipyard = () => { document.exitPointerLock?.(); yard.show(); };

function resize() {
  gfx.resize();
  for (const cam of [space.camera, surface.camera, dungeon.camera]) { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
  if (yard.open) yard.resize();
}
addEventListener('resize', resize);
resize();

// ---- connection ---------------------------------------------------------------------------------

function connect(authMsg) {
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => send(authMsg);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (S.connected) { ui.toast('Connection lost. Reconnecting…'); setTimeout(() => { const t = localStorage.getItem('ds_session'); if (t) connect({ t: 'resume', token: t }); }, 2000); }
    S.connected = false;
  };
}

function showLogin(err = '') {
  $('login').hidden = false;
  $('hud').hidden = true;
  $('login-error').textContent = err;
  $('signin').disabled = $('register').disabled = false;
}

function auth(kind) {
  const name = $('name').value.trim(), password = $('password').value;
  if (name.length < 3) return showLogin('Names need at least 3 characters.');
  if (password.length < 6) return showLogin('Passwords need at least 6 characters.');
  $('signin').disabled = $('register').disabled = true;
  $('login-error').textContent = '';
  connect({ t: kind, name, password });
}
$('signin').onclick = () => auth('login');
$('register').onclick = () => auth('register');
for (const id of ['name', 'password']) $(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') auth('login'); });
$('name').value = localStorage.getItem('ds_name') || '';
const saved = localStorage.getItem('ds_session');
if (saved) connect({ t: 'resume', token: saved }); else $('name').focus();

// ---- messages -----------------------------------------------------------------------------------

const fxNow = () => (S.you?.mode === 'space' ? space.fx : S.you?.mode === 'dungeon' ? dungeon.fx : surface.fx);

function setSpaceMe(x, y, z, q) {
  S.me = { x, y, z, vx: 0, vy: 0, vz: 0, q: q || S.me?.q || [0, 0, 0, 1] };
  space.snapCamera();
}

function onMessage(m) {
  switch (m.t) {
    case 'error':
      if (m.auth) { if (m.resume) localStorage.removeItem('ds_session'); showLogin(m.resume ? '' : m.msg); }
      else ui.toast(m.msg);
      break;
    case 'auth':
      localStorage.setItem('ds_session', m.token);
      localStorage.setItem('ds_name', m.name);
      break;
    case 'welcome': {
      S.connected = true;
      S.myId = m.id;
      S.seed = m.seed;
      S.timeOffset = m.time - Date.now();
      S.you = m.you;
      S.story = m.story;
      S.effects = m.story.effects;
      S.beacons = new Map(m.beacons.map((b) => [b.id, b]));
      S.dead = false;
      space.rebuildSectors();
      if (S.you.mode === 'space') setSpaceMe(S.you.x, S.you.y, S.you.z, S.you.q);
      $('login').hidden = true;
      $('hud').hidden = false;
      ui.refresh();
      if (!localStorage.getItem('ds_seen_help')) { ui.help(); localStorage.setItem('ds_seen_help', '1'); }
      const txKey = `ds_tx_${S.story.era}_${S.story.arc}`;
      if (!localStorage.getItem(txKey)) {
        localStorage.setItem(txKey, '1');
        ui.transmission((S.story.era ? `ERA ${S.story.era + 1} · ` : '') + S.story.title.toUpperCase(), S.story.intro);
      }
      break;
    }
    case 'you': {
      if (!S.you) break;
      const prevRev = S.you.shipRev;
      Object.assign(S.you, m);
      if (m.shipRev && m.shipRev !== prevRev && yard.open) { yard.close(); ui.toast('Ship saved.'); }
      if (yard.open) yard.renderPanel();
      if (surface.selfMesh && surface.root) {
        const armorKey = `${Math.round((S.you.armor?.armor || 0) / 20)}|${S.you.wolf ? 'w' : ''}|${S.you.inMech ? S.you.mechTier : 0}`;
        if (armorKey !== surface.selfArmorKey) {
          surface.selfArmorKey = armorKey;
          surface.root.remove(surface.selfMesh);
          surface.selfMesh = surface.formMesh(S.you.color, S.you.armor?.armor || 0, S.you.wolf, S.you.inMech ? S.you.mechTier : 0);
          surface.root.add(surface.selfMesh);
        }
      }
      ui.refresh();
      break;
    }
    case 'snap': {
      if (!S.connected) break;
      S.online = m.online;
      for (const [k, blocks] of Object.entries(m.ships || {})) S.ships.set(k, blocks);
      const seen = new Set();
      for (const p of m.players) {
        seen.add(p.id);
        const o = S.others.get(p.id);
        p.mode = m.mode;
        if (o && o.mode === m.mode) { Object.assign(o, p, { tx: p.x, ty: p.y, tz: p.z, x: o.x, y: o.y, z: o.z, at: performance.now() }); }
        else S.others.set(p.id, { ...p, tx: p.x, ty: p.y, tz: p.z, at: performance.now() });
      }
      for (const id of S.others.keys()) if (!seen.has(id)) S.others.delete(id);
      if (m.mode === 'space') {
        const ns = new Set();
        for (const n of m.npcs) {
          ns.add(n.id);
          const o = S.npcs.get(n.id);
          if (o) Object.assign(o, n, { tx: n.x, ty: n.y, tz: n.z, x: o.x, y: o.y, z: o.z, at: performance.now() });
          else S.npcs.set(n.id, { ...n, tx: n.x, ty: n.y, tz: n.z, at: performance.now() });
        }
        for (const id of S.npcs.keys()) if (!ns.has(id)) S.npcs.delete(id);
        S.creatures.clear();
        S.parked = [];
      } else {
        S.npcs.clear();
        const cs = new Set();
        for (const c of m.creatures) {
          cs.add(c.id);
          const o = S.creatures.get(c.id);
          if (o) Object.assign(o, c); else S.creatures.set(c.id, { ...c });
        }
        for (const id of S.creatures.keys()) if (!cs.has(id)) S.creatures.delete(id);
        S.parked = m.parked;
      }
      if (m.mode === 'space' && !m.mining && S.sentMine) S.sentMine = null;
      break;
    }
    case 'sector': S.deltas.set(m.key, { asteroids: m.asteroids, blocks: m.blocks, version: Math.random() }); break;
    case 'ast': {
      const d = S.deltas.get(m.id.split(':')[0]);
      if (d) d.asteroids[m.id] = m.amt;
      break;
    }
    case 'block': {
      const d = S.deltas.get(m.key);
      if (!d) break;
      if (m.data) d.blocks[m.cell] = m.data; else delete d.blocks[m.cell];
      d.version = Math.random();
      break;
    }
    case 'beacon': if (m.removed) S.beacons.delete(m.removed); else S.beacons.set(m.beacon.id, m.beacon); break;
    case 'surface':
      if (!S.connected) break;
      surface.enter(m.planet, { digs: m.digs, blocks: m.blocks, deposits: m.deposits, looted: m.looted });
      surface.selfArmorKey = null;
      if (S.you.mode === 'surface') S.me = { x: S.you.px, y: S.you.py, z: S.you.pz, yaw: 0 };
      break;
    case 'dig': if (surface.planetId === m.planet) surface.applyDig(m.k, m.d); break;
    case 'deposit': surface.applyDeposit(m.id, m.amt); break;
    case 'looted': if (surface.planetId === m.planet) surface.looted.add(m.id); break;
    case 'codex':
      S.you.codex = [...new Set([...(S.you.codex || []), ...m.keys])];
      ui.discovered(m.keys);
      break;
    case 'sblock': if (surface.planetId === m.planet) surface.applyBlock(m.cell, m.data); break;
    case 'dungeon': dungeon.enter(m); break;
    case 'chest': dungeon.markOpened(m.id); break;
    case 'boss': dungeon.bossDead = true; break;
    case 'teleport':
      S.dead = false;
      if (m.mode === 'space') {
        const wasSurface = S.you.mode === 'surface';
        S.you.mode = 'space';
        S.you.planet = null;
        setSpaceMe(m.x, m.y, m.z, m.q);
        if (wasSurface) { surface.leave(); S.flash = 1; }
        S.mineTarget = null;
        S.deltas.clear();
        S.others.clear();
        S.npcs.clear();
        space.clearEntities();
        lastSub = 0;
      } else if (m.mode === 'dungeon') {
        if (S.you.mode === 'surface') surface.leave();
        S.you.mode = 'dungeon';
        S.me = { x: m.x, y: m.y, z: m.z, yaw: dungeon.yaw };
        S.others.clear();
        S.creatures.clear();
        if (S.mode === 'build') toggleBuild();
      } else {
        if (S.you.mode === 'dungeon') { dungeon.leave(); S.creatures.clear(); }
        S.you.mode = 'surface';
        S.you.planet = m.planet;
        S.me = { x: m.x, y: m.y, z: m.z, yaw: surface.yaw };
        S.others.clear();
        space.clearEntities();
      }
      break;
    case 'jumped': S.lastJump = performance.now(); S.flash = 1; break;
    case 'bolts': for (const b of m.list) space.fx.bolt(b); break;
    case 'hit': {
      const fx = fxNow(), space_ = S.you.mode === 'space';
      const you = m.id === S.myId;
      if (space_) fx.spark(m.x, m.y, m.z, m.shield ? '#4bd8ff' : '#ffe0a0', 16);
      else fx.burst(m.x, m.y, m.z, m.shield ? '#4bd8ff' : you ? '#ff6a5a' : '#ffd890', 0.5);
      if (m.dmg > 0) fx.damage(m.x, m.y, m.z, m.dmg, { you, scale: space_ ? 14 : 1 });
      break;
    }
    case 'boom': fxNow().explosion(m.x, m.y, m.z, m.size, m.organic ? '#9aff6a' : '#ffb060'); break;
    case 'shot': for (const to of m.to) { if (S.you.mode === 'space') fxNow().tracer(m.from, to, m.c); else fxNow().beam(m.from, to, m.c); } break;
    case 'died': S.dead = true; ui.death(m.by, m.respawnIn); break;
    case 'docked': ui.station(m); break;
    case 'shop': ui.shop(m); break;
    case 'loot': ui.toast(`Loot: ${m.name}`, 'loot'); break;
    case 'dialogue': ui.dialogue(m.who); break;
    case 'talk': ui.talk(m); break;
    case 'spell': if (S.you?.mode === 'surface' && surface.root) surface.spellFx(m); break;
    case 'talk_line': ui.talkLine(m); break;
    case 'talk_end': if (ui.current?.kind === 'talk') ui.close(); break;
    case 'market': ui.market(m); break;
    case 'chest': if (surface.data?.blocks[m.cell]) surface.data.blocks[m.cell].inv = m.inv; if (ui.current?.kind === 'chest') ui.chest(m.cell, m.inv); break;
    case 'quests': S.quests = m.list; ui.refresh(); break;
    case 'politics': ui.politics(m.view); break;
    case 'story': {
      const hadGate = S.effects?.gateBuilt;
      S.story = m.story;
      S.effects = m.story.effects;
      if (hadGate !== S.effects.gateBuilt) space.rebuildSectors();
      ui.refresh();
      break;
    }
    case 'transmission':
      ui.transmission(m.title, m.lines);
      if (S.story) localStorage.setItem(`ds_tx_${S.story.era}_${S.story.arc}`, '1');
      break;
    case 'party': S.party = m.party; if (ui.current?.kind === 'party') ui.rerender(); break;
    case 'party_invite': ui.invite(m.from); break;
    case 'chat': ui.chat(m.from, m.text, m.color, m.channel); break;
    case 'toast': ui.toast(m.msg); break;
  }
}

// ---- input --------------------------------------------------------------------------------------

const keys = new Set();
const mouse = { left: false, right: false };
const look = { x: 0, y: 0 };
const typing = () => document.activeElement?.tagName === 'INPUT';
const overlayOpen = () => ui.isOpen() || map.open || yard.open || ui.transmissionOpen() || !$('login').hidden;
const locked = () => document.pointerLockElement === canvas;

canvas.addEventListener('click', () => { if (S.connected && !overlayOpen() && !locked()) canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => { if (locked()) { look.x += e.movementX; look.y += e.movementY; } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (!locked()) return;
  if (e.button === 0) { mouse.left = true; if (S.mode === 'build') buildClick(false); }
  if (e.button === 2) { mouse.right = true; if (S.mode === 'build') buildClick(true); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
canvas.addEventListener('wheel', (e) => { if (S.mode === 'build' && S.you?.mode === 'space') space.buildDist = Math.max(20, Math.min(300, space.buildDist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: true });

function buildClick(remove) {
  if (S.you.mode === 'space') {
    if (remove) { const c = space.blockUnderCrosshair(); if (c) send({ t: 'unbuild', gx: c[0], gy: c[1], gz: c[2] }); }
    else { const [gx, gy, gz] = space.buildCell(); send({ t: 'build', gx, gy, gz, block: S.block }); }
  } else if (surface.planetId) {
    if (remove) {
      const a = surface.aim(14);
      if (a.block) { const [gx, gy, gz] = a.block.object.userData.cell.split(',').map(Number); send({ t: 'sunbuild', gx, gy, gz }); }
    } else { const [gx, gy, gz] = surface.buildCell(); send({ t: 'sbuild', gx, gy, gz, block: S.block }); }
  }
}

function toggleBuild() {
  S.mode = S.mode === 'build' ? 'fly' : 'build';
  $('palette').hidden = S.mode !== 'build';
  ui.renderPalette();
}

addEventListener('keydown', (e) => {
  if (!S.connected) return;
  const ci = $('chat-input');
  if (ui.transmissionOpen() && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) { ui.nextTransmission(); e.preventDefault(); return; }
  if (e.key === 'Enter') {
    if (ci.hidden) { ci.hidden = false; document.exitPointerLock?.(); ci.focus(); }
    else {
      const v = ci.value.trim();
      if (v.startsWith('/p ')) send({ t: 'chat', channel: 'party', text: v.slice(3) });
      else if (v) send({ t: 'chat', text: v });
      ci.value = ''; ci.hidden = true; ci.blur();
    }
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    ci.hidden = true; ci.blur();
    ui.close(); map.toggle(false); if (yard.open) yard.close();
    if (S.mode === 'build') toggleBuild();
    return;
  }
  if (typing()) return;
  const k = e.key.toLowerCase();
  if (k === 'tab') { e.preventDefault(); ui.current?.kind === 'inventory' ? ui.close() : ui.inventory(); return; }
  if (k === 'j') { ui.current?.kind === 'journal' ? ui.close() : ui.journal(); return; }
  if (k === 'p') { ui.current?.kind === 'party' ? ui.close() : ui.party(); return; }
  if (k === 'h') { ui.current?.kind === 'help' ? ui.close() : ui.help(); return; }
  if (k === 'k') { ui.current?.kind === 'codex' ? ui.close() : ui.codex(); return; }
  if (k === 'o') { ui.current?.kind === 'options' ? ui.close() : ui.options(); return; }
  if (k === 'm') { map.toggle(); return; }
  if (k === 'u') { ui.current?.kind === 'skills' ? ui.close() : ui.skills(); return; }
  if (k === 'r' && S.you.mode === 'surface') { ui.current?.kind === 'politics' ? ui.close() : send({ t: 'politics' }); return; }
  if (overlayOpen()) return;
  keys.add(k);
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (k === 'b' && S.you.mode !== 'dungeon') toggleBuild();
  if (S.mode === 'build') {
    // The palette only offers blocks that work here (planet or space): 1-9, 0, and [ ] to cycle.
    const list = BLOCK_IDS.filter((id) => blockAllowed(id, S.you.mode === 'space' ? 'space' : 'surface'));
    const i = k === '0' ? 9 : k >= '1' && k <= '9' ? +k - 1 : -1;
    if (i >= 0 && list[i]) { S.block = list[i]; ui.renderPalette(); }
    if (k === '[' || k === ']') { const j = list.indexOf(S.block); S.block = list[(j + (k === ']' ? 1 : list.length - 1)) % list.length]; ui.renderPalette(); }
  }
  if (S.you.mode === 'space') {
    if (k === 'e' && space.nearbyStation()) send({ t: 'dock' });
    if (k === 'l') {
      const p = space.nearbyPlanet(serverTime());
      if (p) send({ t: 'land', planet: p.id }); else ui.toast('No planet close enough to land on.');
    }
  } else if (S.you.mode === 'dungeon') {
    if (k === 'e') { const it = dungeon.interaction(); if (it) send({ t: 'interact', what: it.what, id: it.id }); }
    if (k === 'v') dungeon.firstPerson = !dungeon.firstPerson;
  } else {
    if (k === 'e') {
      const it = surface.interaction();
      if (it?.what === 'chest') ui.chest(it.id, surface.data.blocks[it.id]?.inv || {});
      else if (it?.what === 'bench') ui.craft();
      else if (it?.what) send({ t: 'interact', what: it.what, id: it.id });
    }
    if (k === 'c' && S.mode !== 'build') ui.current?.kind === 'craft' ? ui.close() : ui.craft();
    if (k === 'y') { const it = surface.interaction(); if (it?.what === 'ship') ui.onShipyard(); else ui.toast('Walk up to your ship to use the shipyard.'); }
    if (k === 'v') surface.firstPerson = !surface.firstPerson;
    if (S.mode !== 'build' && k >= '1' && k <= '4') {
      const spell = (S.you.spells || [])[+k - 1];
      if (spell) { const d = surface.shotDir(); send({ t: 'cast', spell, dir: [d.x, d.y, d.z] }); }
      else ui.toast('No spell in that slot. Mages and priests in towns teach magic (U for your spellbook).');
    }
    if (k === 'f') { if (S.you.power) send({ t: 'power' }); else ui.toast('You have no superpower. Pray at shrines: a god grants one to the devout.'); }
    if (k === 't') send({ t: 'transform' });
    if (k === 'g') send({ t: 'mech' });
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });
document.addEventListener('pointerlockchange', () => { $('crosshair').hidden = !locked(); if (!locked()) { mouse.left = mouse.right = false; } });

const held = (...ks) => ks.some((k) => keys.has(k));

// ---- frame loop ---------------------------------------------------------------------------------

let last = performance.now(), lastSend = 0, lastSub = 0, lastFire = 0, lastShot = 0, lastDig = 0, lastWorm = 0;
const radarCtx = $('radar').getContext('2d');

function spaceFrame(dt, now) {
  const you = S.you, me = S.me, st = you.stats;
  const active = !S.dead && !overlayOpen() && locked();
  const input = active ? {
    fwd: (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0),
    strafe: (held('d', 'arrowright') ? 1 : 0) - (held('a', 'arrowleft') ? 1 : 0),
    lift: (held(' ') ? 1 : 0) - (held('c') ? 1 : 0),
    rollLeft: held('q'), rollRight: held('e') && !space.nearbyStation(), brake: held('x'),
  } : {};
  if (!S.dead) space.fly(dt, input, active ? look : { x: 0, y: 0 });

  // Mining: hold right mouse while aiming at an asteroid.
  const full = cargoTotal(you.cargo) >= st.cargo;
  S.mineTarget = active && mouse.right && S.mode !== 'build' && !full ? space.pickAsteroid(st.mineRange) : null;
  if (active && mouse.right && full && now - (S.fullToast || 0) > 3000) { S.fullToast = now; ui.toast('Cargo hold full. Dock at a station (E) to sell.'); }
  const want = S.mineTarget ? S.mineTarget.id : null;
  if (want !== S.sentMine) { send({ t: 'mine', id: want }); S.sentMine = want; }

  if (active && mouse.left && S.mode !== 'build' && now - lastFire > st.gunInterval * 1000) { lastFire = now; send({ t: 'fire' }); }

  if (space.nearbyWormhole() && now - lastWorm > 2000) { lastWorm = now; send({ t: 'wormhole' }); }

  if (now - lastSend > 50) {
    lastSend = now;
    send({ t: 'state', x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, q: me.q, thrust: (input.fwd || 0) > 0 });
  }
  if (now - lastSub > 400) {
    lastSub = now;
    const [sx, sz] = sectorOf(me.x, me.z);
    const ks = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) ks.push(sectorKey(sx + dx, sz + dz));
    send({ t: 'sub', keys: ks });
    for (const key of S.deltas.keys()) if (!ks.includes(key)) S.deltas.delete(key);
  }

  // Smooth other ships and NPCs toward their extrapolated positions.
  for (const list of [S.others, S.npcs]) {
    for (const o of list.values()) {
      const age = (now - o.at) / 1000;
      const px = o.tx + (o.vx || 0) * age, py = o.ty + (o.vy || 0) * age, pz = o.tz + (o.vz || 0) * age;
      const k = Math.min(1, dt * 8);
      if (o.x == null) { o.x = px; o.y = py; o.z = pz; }
      o.x += (px - o.x) * k; o.y += (py - o.y) * k; o.z += (pz - o.z) * k;
    }
  }

  const t = serverTime();
  gfx.speed = Math.hypot(me.vx, me.vy, me.vz) / st.maxSpeed;
  space.update(dt, t, { thrusting: (input.fwd || 0) > 0, mineTarget: S.mineTarget, mode: S.mode, block: S.block });
  gfx.render(space.scene, space.camera, 'space');

  let prompt = '';
  const stn = space.nearbyStation(), planet = space.nearbyPlanet(t);
  if (stn) prompt = `E: dock at ${stn.name}`;
  else if (planet) prompt = planet.landable ? `L: land on ${planet.name}` : `${planet.name} is a gas giant`;
  else if (S.mineTarget) prompt = `Mining ${ORES[S.mineTarget.ore]?.name || 'ore'}…`;
  if (!locked() && !overlayOpen()) prompt = 'Click to take the controls';
  const hint = S.mode === 'build'
    ? 'BUILD · left: place · right: remove · wheel: distance · 1-6: block · B: exit'
    : 'LMB fire · RMB mine · E dock · L land · M map · B build · H help';

  drawMarks();

  // Radar: what's around, rotated so your heading is up.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...me.q));
  const heading = Math.atan2(fwd.x, -fwd.z);
  const cos = Math.cos(-heading), sin = Math.sin(-heading), R = 5000;
  const dot = (x, z, c, s) => { const dx = (x - me.x) / R, dz = (z - me.z) / R; return { x: dx * cos - dz * sin, y: dx * sin + dz * cos, c, s }; };
  const dots = [];
  for (const rec of space.sectors.values()) {
    for (const m of rec.asteroids.values()) if (m.visible) dots.push(dot(m.userData.a.x, m.userData.a.z, '#8a8a8a', 2));
    if (rec.s.station) dots.push(dot(rec.s.station.x, rec.s.station.z, '#7fb4ff', 6));
    for (const { mesh } of rec.planets) dots.push(dot(mesh.position.x, mesh.position.z, '#9fd0a0', 5));
    if (rec.s.star) dots.push(dot(rec.s.star.x, rec.s.star.z, '#ffe08a', 7));
  }
  for (const n of S.npcs.values()) dots.push(dot(n.x, n.z, { pirate: '#ff5a4a', hollow: '#9aff6a', mothership: '#d06aff', imperial: '#ffe08a', rebel: '#ff8a5a' }[n.kind], n.kind === 'mothership' ? 9 : 4));
  for (const o of S.others.values()) dots.push(dot(o.x, o.z, o.color, 4));
  ui.radar(radarCtx, dots);

  ui.hud(now, { prompt, hint, jumpLeft: Math.max(0, JUMP_COOLDOWN_MS - (now - S.lastJump)) });
}

function surfaceFrame(dt, now) {
  if (!surface.planetId || !S.me || S.me.yaw === undefined) return;
  const you = S.you, me = S.me;
  const active = !S.dead && !overlayOpen() && locked();
  const input = active ? {
    fwd: (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0),
    strafe: (held('d', 'arrowright') ? 1 : 0) - (held('a', 'arrowleft') ? 1 : 0),
    jump: held(' '), run: held('shift'),
  } : {};
  if (!S.dead) surface.walk(dt, input, active ? look : { x: 0, y: 0 });

  if (active && S.mode !== 'build') {
    const w = you.inv.items.find((i) => i.id === you.inv.equipped.weapon);
    const rate = you.inMech ? 1.1 : you.wolf ? 2.2 : w ? weaponStats(w).rate : 0;
    if (mouse.left && rate && now - lastShot > 1000 / rate) {
      lastShot = now;
      const d = surface.shotDir();
      send({ t: 'shoot', dir: [d.x, d.y, d.z] });
    } else if (mouse.left && !rate && now - lastShot > 2000) { lastShot = now; ui.toast('No weapon equipped. Press Tab to open your gear.'); }
    if (mouse.right && !you.inMech && !you.wolf && now - lastDig > 220) {
      lastDig = now;
      const p = surface.digTarget();
      if (p) {
        send({ t: 'dig', x: p.x, z: p.z, raise: held('shift') });
        surface.fx.spark(p.x, p.y + 0.3, p.z, '#c8a070', 1.5);
      }
    }
  }

  if (now - lastSend > 100) {
    lastSend = now;
    send({ t: 'walk', x: me.x, y: me.y, z: me.z, yaw: surface.yaw });
  }

  surface.update(dt, serverTime());
  gfx.render(surface.scene, surface.camera, 'surface');

  const it = surface.interaction();
  let prompt = it ? it.text : '';
  if (!locked() && !overlayOpen()) prompt = 'Click to take the controls';
  const hint = S.mode === 'build'
    ? 'BUILD · left: place · right: remove · 1-6: block · B: exit'
    : you.inMech ? 'MECH · LMB cannon · Space jump jets · G exit' : you.wolf ? 'WOLF · LMB claws · T change back' : `LMB shoot · RMB dig · E interact${(you.spells || []).length ? ' · 1-4 spells' : ''}${you.power ? ' · F power' : ''} · B build · U skills · H help`;

  const cos = Math.cos(surface.yaw), sin = Math.sin(surface.yaw), R = 140;
  const dot = (x, z, c, s) => { const dx = (x - me.x) / R, dz = (z - me.z) / R; return { x: dx * cos - dz * sin, y: dx * sin + dz * cos, c, s }; };
  const dots = [];
  for (const d of deposits(surface.planet)) if ((surface.data.deposits[d.id] ?? d.amount) > 0) dots.push(dot(d.x, d.z, ORES[d.ore].color, 4));
  for (const c of S.creatures.values()) dots.push(dot(c.x, c.z, c.hostile ? '#ff5a4a' : '#e8e0a0', 4));
  // Quest targets on this world, pinned to the radar's edge when out of range.
  for (const q of S.quests || []) {
    if (q.pid !== surface.planetId || !q.mark) continue;
    const d = dot(q.mark[0], q.mark[1], '#ffd84a', 7);
    const l = Math.hypot(d.x, d.y);
    if (l > 0.95) { d.x *= 0.95 / l; d.y *= 0.95 / l; }
    dots.push(d);
  }
  for (const { st, def } of surface.structures || []) dots.push(dot(st.x, st.z, def.kind === 'shrine' ? '#c27bff' : def.kind === 'imperial' || def.kind === 'holy' ? '#ffe08a' : def.kind === 'rebel' ? '#ff8a5a' : '#b8a8d8', 6));
  for (const o of S.others.values()) dots.push(dot(o.x, o.z, o.color, 4));
  if (you.parked) dots.push(dot(you.parked.x, you.parked.z, '#7fb4ff', 7));
  if (surface.relic) dots.push(dot(surface.relic.position.x, surface.relic.position.z, '#c27bff', 7));
  ui.radar(radarCtx, dots);
  ui.hud(now, { prompt, hint });
}

function dungeonFrame(dt, now) {
  if (!dungeon.key || !S.me || S.me.yaw === undefined) return;
  const you = S.you, me = S.me;
  const active = !S.dead && !overlayOpen() && locked();
  const input = active ? {
    fwd: (held('w', 'arrowup') ? 1 : 0) - (held('s', 'arrowdown') ? 1 : 0),
    strafe: (held('d', 'arrowright') ? 1 : 0) - (held('a', 'arrowleft') ? 1 : 0),
    jump: held(' '), run: held('shift'),
  } : {};
  if (!S.dead) dungeon.walk(dt, input, active ? look : { x: 0, y: 0 });
  if (active) {
    const w = you.inv.items.find((i) => i.id === you.inv.equipped.weapon);
    const rate = you.inMech ? 1.1 : you.wolf ? 2.2 : w ? weaponStats(w).rate : 0;
    if (mouse.left && rate && now - lastShot > 1000 / rate) {
      lastShot = now;
      const d = dungeon.shotDir();
      send({ t: 'shoot', dir: [d.x, d.y, d.z] });
    } else if (mouse.left && !w && now - lastShot > 2000) { lastShot = now; ui.toast('No weapon equipped. Press Tab to open your gear.'); }
  }
  if (now - lastSend > 100) {
    lastSend = now;
    send({ t: 'walk', x: me.x, y: me.y, z: me.z, yaw: dungeon.yaw });
  }
  dungeon.update(dt, serverTime());
  gfx.render(dungeon.scene, dungeon.camera, 'dungeon');

  const it = dungeon.interaction();
  let prompt = it ? it.text : '';
  if (!locked() && !overlayOpen()) prompt = 'Click to take the controls';
  const cos = Math.cos(dungeon.yaw), sin = Math.sin(dungeon.yaw), R = 60;
  const dot = (x, z, c, s) => { const dx = (x - me.x) / R, dz = (z - me.z) / R; return { x: dx * cos - dz * sin, y: dx * sin + dz * cos, c, s }; };
  const dots = [];
  for (const c of S.creatures.values()) dots.push(dot(c.x, c.z, c.boss ? '#ff3a3a' : '#ff8a5a', c.boss ? 8 : 4));
  for (const c of dungeon.layout.chests) if (!dungeon.opened.has(c.id)) dots.push(dot(c.x, c.z, c.boss ? '#c27bff' : '#ffe08a', 5));
  dots.push(dot(dungeon.layout.start[0], dungeon.layout.start[1], '#78ffaa', 7));
  for (const o of S.others.values()) dots.push(dot(o.x, o.z, o.color, 4));
  ui.radar(radarCtx, dots);
  ui.hud(now, { prompt, hint: 'LMB shoot · E interact · V view · Shift run · H help', dungeon: { name: dungeon.msg.name, depth: dungeon.msg.depth, left: S.creatures.size, boss: dungeon.bossDead } });
}

// Target brackets for hostiles and party members, with arrows at the screen edge when off-screen.
const marks = $('marks'), marksCtx = marks.getContext('2d');
function drawMarks() {
  const W = innerWidth, H = innerHeight;
  if (marks.width !== W || marks.height !== H) { marks.width = W; marks.height = H; }
  const g = marksCtx;
  g.clearRect(0, 0, W, H);
  if (S.you?.mode !== 'space' || overlayOpen()) return;
  const cam = space.camera, me = S.me, v = new THREE.Vector3();
  const targets = [];
  for (const n of S.npcs.values()) {
    const d = Math.hypot(n.x - me.x, n.y - me.y, n.z - me.z);
    if (d > (n.kind === 'mothership' ? 9000 : 3500)) continue;
    const c = { pirate: '#ff5a4a', hollow: '#9aff6a', mothership: '#d06aff', imperial: '#ffe08a', rebel: '#ff8a5a' }[n.kind];
    if (!n.hostile && (n.kind === 'imperial' || n.kind === 'rebel')) { if (d < 1500) targets.push({ x: n.x, y: n.y, z: n.z, d, c: c + '88', name: n.kind === 'imperial' ? 'Imperial' : 'Rebel' }); continue; }
    targets.push({ x: n.x, y: n.y, z: n.z, d, c, big: n.kind === 'mothership' });
  }
  for (const o of S.others.values()) {
    if (!S.isPartyMember(o.key)) continue;
    targets.push({ x: o.x, y: o.y, z: o.z, d: Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z), c: o.color, name: o.name });
  }
  for (const t of targets) {
    v.set(t.x, t.y, t.z).applyMatrix4(cam.matrixWorldInverse);
    const behind = v.z > 0;
    v.applyMatrix4(cam.projectionMatrix);
    let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    if (behind) { sx = W - sx; sy = H - sy; }
    const on = !behind && sx > 0 && sx < W && sy > 0 && sy < H;
    g.strokeStyle = g.fillStyle = t.c;
    g.lineWidth = 2;
    g.font = '11px ui-monospace, monospace';
    g.textAlign = 'center';
    if (on) {
      const r = t.big ? 26 : 12;
      g.beginPath();
      for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        g.moveTo(sx + ax * r, sy + ay * r * 0.4); g.lineTo(sx + ax * r, sy + ay * r); g.lineTo(sx + ax * r * 0.4, sy + ay * r);
      }
      g.stroke();
      g.fillText(`${t.name ? t.name + ' · ' : ''}${Math.round(t.d)}`, sx, sy + r + 12);
    } else {
      const cx = W / 2, cy = H / 2, ang = Math.atan2(sy - cy, sx - cx);
      const ex = cx + Math.cos(ang) * (Math.min(W, H) / 2 - 40), ey = cy + Math.sin(ang) * (Math.min(W, H) / 2 - 40);
      g.save(); g.translate(ex, ey); g.rotate(ang);
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.restore();
    }
  }
}

// Before signing in: a slow drift past Haven.
function idleFrame(dt, now) {
  if (!S.you) {
    S.you = { ship: STARTER_SHIP, shipRev: 0, color: '#9fd0ff', stats: shipStats(STARTER_SHIP), mode: 'space', cargo: {}, upg: {} };
    const home = generateSector(0, 0, S.seed);
    const [px, , pz] = planetPos(home.planets[0], home.star, serverTime());
    S.me = { x: px + 420, y: 60, z: pz + 300, vx: 0, vy: 0, vz: 0, q: [0, 0, 0, 1] };
    S.idle = true;
  }
  const t = now / 1000;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, t * 0.05, 0));
  S.me.q = [q.x, q.y, q.z, q.w];
  space.update(dt, serverTime(), { thrusting: true, mode: 'fly' });
  gfx.render(space.scene, space.camera, 'space');
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (S.connected && S.you && !S.idle) {
      if (S.you.mode === 'space' && S.me?.q) spaceFrame(dt, now);
      else if (S.you.mode === 'surface') { surfaceFrame(dt, now); marksCtx.clearRect(0, 0, marks.width, marks.height); }
      else if (S.you.mode === 'dungeon') { dungeonFrame(dt, now); marksCtx.clearRect(0, 0, marks.width, marks.height); }
    } else if (!S.connected) {
      idleFrame(dt, now);
    }
    if (S.connected && S.idle) { S.idle = false; }
    map.draw();
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 1.5);
    canvas.style.filter = S.flash > 0 ? `brightness(${1 + S.flash * 3})` : '';
  } catch (err) {
    console.error(err);
  }
  look.x = 0; look.y = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
