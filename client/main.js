// Driftspace client: renders the procedural universe, predicts the local ship, and talks to
// the server for everything shared (other pilots, mining, building, trading, jumping).

import { generateSector, sectorOf, sectorKey, planetPos, SECTOR_SIZE } from '/shared/universe.js';
import { hash2, mulberry32 } from '/shared/rng.js';
import {
  ORES, ORE_IDS, BLOCKS, BLOCK_IDS, UPGRADES, GRID, BUILD_RANGE, DOCK_RANGE, JUMP_COOLDOWN_MS,
  shipStats, stepShip, cargoTotal, canAfford, upgradeCost,
} from '/shared/rules.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

const S = {
  ws: null, seed: 0, timeOffset: 0, connected: false,
  me: null, upg: {}, cargo: {}, credits: 0,
  others: new Map(), online: 0,
  deltas: new Map(),            // sectorKey -> { asteroids: {id: amt}, blocks: {cell: {b, o}} }
  beacons: new Map(),
  keys: new Set(), mouse: { x: 0, y: 0 },
  zoom: 0.6, cam: { x: 0, y: 0 },
  mode: 'fly', block: 'hull', mapOpen: false, mapCell: 34, mapHover: null,
  mineTarget: null, sentMine: null, fullToast: 0, lastJump: 0, lastWormhole: 0, flash: 0,
  particles: [],
};

// ---- connection ---------------------------------------------------------------------------

function token() {
  let t = localStorage.getItem('ds_token');
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('ds_token', t);
  }
  return t;
}

function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function connect(name) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => send({ t: 'hello', name, token: token() });
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (S.connected) toast('Connection lost. Reload to reconnect.');
    S.connected = false;
  };
}

function onMessage(m) {
  switch (m.t) {
    case 'error':
      $('login-error').textContent = m.msg;
      $('login').hidden = false;
      $('play').disabled = false;
      break;
    case 'welcome':
      S.connected = true;
      S.seed = m.seed;
      S.timeOffset = m.time - Date.now();
      S.me = { x: m.you.x, y: m.you.y, vx: 0, vy: 0, a: -Math.PI / 2, name: m.you.name, color: m.you.color };
      applySelf(m.you);
      S.cam.x = S.me.x; S.cam.y = S.me.y;
      for (const b of m.beacons) S.beacons.set(b.id, b);
      $('login').hidden = true;
      $('hud').hidden = false;
      localStorage.setItem('ds_name', m.you.name);
      if (!localStorage.getItem('ds_seen_help')) { $('help').hidden = false; localStorage.setItem('ds_seen_help', '1'); }
      break;
    case 'you': applySelf(m); break;
    case 'snap': {
      S.online = m.online;
      const seen = new Set();
      for (const p of m.players) {
        seen.add(p.id);
        const o = S.others.get(p.id);
        if (o) Object.assign(o, { tx: p.x, ty: p.y, vx: p.vx, vy: p.vy, a: p.a, thrust: p.thrust, mining: p.mining, at: performance.now() });
        else S.others.set(p.id, { ...p, tx: p.x, ty: p.y, at: performance.now() });
      }
      for (const id of S.others.keys()) if (!seen.has(id)) S.others.delete(id);
      if (!m.mining && S.sentMine) S.sentMine = null;
      break;
    }
    case 'sector': S.deltas.set(m.key, { asteroids: m.asteroids, blocks: m.blocks }); break;
    case 'ast': {
      const [sx, sy] = m.id.split(':')[0].split(',').map(Number);
      const d = S.deltas.get(sectorKey(sx, sy));
      if (d) d.asteroids[m.id] = m.amt;
      break;
    }
    case 'block': {
      const d = S.deltas.get(m.key);
      if (!d) break;
      if (m.data) d.blocks[m.cell] = m.data; else delete d.blocks[m.cell];
      break;
    }
    case 'beacon':
      if (m.removed) S.beacons.delete(m.removed); else S.beacons.set(m.beacon.id, m.beacon);
      break;
    case 'teleport':
      Object.assign(S.me, { x: m.x, y: m.y, vx: 0, vy: 0 });
      S.cam.x = m.x; S.cam.y = m.y;
      S.flash = 1;
      S.mineTarget = null;
      break;
    case 'jumped': S.lastJump = performance.now(); break;
    case 'chat': chat(m.from, m.text, m.color); break;
    case 'toast': toast(m.msg); break;
  }
}

function applySelf(m) {
  S.cargo = m.cargo; S.credits = m.credits; S.upg = m.upg;
  renderPalette();
  if (!$('station').hidden) renderStation();
}

// ---- UI helpers ---------------------------------------------------------------------------

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function chat(from, text, color) {
  const el = document.createElement('div');
  if (from) {
    const n = document.createElement('b');
    n.textContent = from + ': ';
    n.style.color = color || '#9fd0ff';
    el.append(n, document.createTextNode(text));
  } else {
    el.className = 'sys';
    el.textContent = text;
  }
  const log = $('chat-log');
  log.appendChild(el);
  while (log.children.length > 40) log.firstChild.remove();
}

function renderPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  BLOCK_IDS.forEach((id, i) => {
    const def = BLOCKS[id];
    const el = document.createElement('div');
    el.className = id === S.block ? 'sel' : '';
    el.style.opacity = canAfford(S.cargo, def.cost) ? 1 : 0.45;
    const cost = Object.entries(def.cost).map(([k, v]) => `${v} ${ORES[k].name}`).join(', ');
    el.innerHTML = `<i style="background:${def.color}"></i>${i + 1}. ${def.name}<div class="cost">${cost}</div>`;
    el.onclick = () => { S.block = id; renderPalette(); };
    pal.appendChild(el);
  });
}

function currentStation() {
  if (!S.me) return null;
  const [sx, sy] = sectorOf(S.me.x, S.me.y);
  const st = generateSector(sx, sy, S.seed).station;
  return st && Math.hypot(st.x - S.me.x, st.y - S.me.y) <= DOCK_RANGE ? st : null;
}

function renderStation() {
  const st = currentStation();
  if (!st) { $('station').hidden = true; return; }
  $('station-name').textContent = st.name;
  const body = $('station-body');
  body.innerHTML = '';
  const value = ORE_IDS.reduce((s, k) => s + (S.cargo[k] || 0) * ORES[k].price, 0);
  const sell = document.createElement('div');
  sell.className = 'row';
  sell.innerHTML = `<span>Sell all cargo<br><span class="small dim">${cargoTotal(S.cargo)} units, worth ${value} cr</span></span>`;
  const sb = document.createElement('button');
  sb.textContent = 'Sell';
  sb.disabled = value === 0;
  sb.onclick = () => send({ t: 'sell' });
  sell.appendChild(sb);
  body.appendChild(sell);
  const cr = document.createElement('p');
  cr.innerHTML = `Credits: <b>${S.credits}</b>`;
  body.appendChild(cr);
  for (const [id, def] of Object.entries(UPGRADES)) {
    const lvl = S.upg[id] || 0;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${def.name} <span class="pips">${'■'.repeat(lvl)}${'□'.repeat(def.max - lvl)}</span><br><span class="small dim">${def.desc}</span></span>`;
    const b = document.createElement('button');
    const cost = upgradeCost(lvl);
    b.textContent = lvl >= def.max ? 'Max' : `${cost} cr`;
    b.disabled = lvl >= def.max || S.credits < cost;
    b.onclick = () => send({ t: 'upgrade', kind: id });
    row.appendChild(b);
    body.appendChild(row);
  }
}

let hudAt = 0;
function updateHud(now) {
  if (now - hudAt < 120) return;
  hudAt = now;
  const me = S.me;
  const [sx, sy] = sectorOf(me.x, me.y);
  const sec = generateSector(sx, sy, S.seed);
  const stats = shipStats(S.upg);
  const jumpLeft = Math.max(0, JUMP_COOLDOWN_MS - (now - S.lastJump));
  $('status').innerHTML =
    `<div class="big">${sec.name}</div>` +
    `<div class="dim">${sec.region.name}</div>` +
    `<div>Sector ${sx}, ${sy}${sec.star ? ' · ' + sec.star.type : ' · deep space'}</div>` +
    `<div>Speed ${Math.round(Math.hypot(me.vx, me.vy))} · ${S.credits} cr</div>` +
    `<div class="dim">Jump ${jumpLeft ? 'charging ' + Math.ceil(jumpLeft / 1000) + 's' : 'ready'} · range ${stats.jumpRange}</div>` +
    `<div class="dim">${S.online} pilot${S.online === 1 ? '' : 's'} online</div>`;
  const total = cargoTotal(S.cargo);
  const segs = ORE_IDS.filter((k) => S.cargo[k]).map((k) => `<span style="width:${(100 * S.cargo[k]) / stats.cargo}%;background:${ORES[k].color}"></span>`).join('');
  const list = ORE_IDS.filter((k) => S.cargo[k]).map((k) => `<span style="color:${ORES[k].color}">${S.cargo[k]} ${ORES[k].name}</span>`).join(' ');
  $('cargo').innerHTML = `<span>Cargo ${total}/${stats.cargo}</span><div class="bar">${segs}</div><span class="small">${list}</span>`;
  let hint = 'H: help · Space: mine · B: build · M: map · Enter: chat';
  if (currentStation()) hint = `<b>E</b> to dock at ${currentStation().name}`;
  if (S.mode === 'build') hint = 'BUILD · click to place · right-click to salvage · 1-6 choose · B to exit';
  $('hint').innerHTML = hint;
}

// ---- input --------------------------------------------------------------------------------

const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';

addEventListener('keydown', (e) => {
  if (!S.connected) return;
  const ci = $('chat-input');
  if (e.key === 'Enter') {
    if (ci.hidden) { ci.hidden = false; ci.focus(); }
    else { if (ci.value.trim()) send({ t: 'chat', text: ci.value }); ci.value = ''; ci.hidden = true; ci.blur(); }
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    ci.hidden = true; ci.blur();
    $('station').hidden = true; $('help').hidden = true; S.mapOpen = false;
    if (S.mode === 'build') toggleBuild();
    return;
  }
  if (typing()) return;
  const k = e.key.toLowerCase();
  S.keys.add(k);
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (k === 'h') $('help').hidden = !$('help').hidden;
  if (k === 'm') S.mapOpen = !S.mapOpen;
  if (k === 'b') toggleBuild();
  if (k === 'e') {
    if (!$('station').hidden) $('station').hidden = true;
    else if (currentStation()) { $('station').hidden = false; renderStation(); }
  }
  if (S.mode === 'build' && k >= '1' && k <= String(BLOCK_IDS.length)) { S.block = BLOCK_IDS[+k - 1]; renderPalette(); }
});
addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => S.keys.clear());

function toggleBuild() {
  S.mode = S.mode === 'build' ? 'fly' : 'build';
  $('palette').hidden = S.mode !== 'build';
  renderPalette();
}

canvas.addEventListener('mousemove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (S.mapOpen) S.mapCell = Math.max(22, Math.min(90, S.mapCell * (e.deltaY > 0 ? 0.9 : 1.1)));
  else S.zoom = Math.max(0.12, Math.min(1.6, S.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
}, { passive: true });
canvas.addEventListener('mousedown', (e) => {
  if (!S.connected) return;
  if (S.mapOpen) {
    if (S.mapHover) send({ t: 'jump', sx: S.mapHover[0], sy: S.mapHover[1] });
    S.mapOpen = false;
    return;
  }
  if (S.mode !== 'build') return;
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const gx = Math.floor(wx / GRID), gy = Math.floor(wy / GRID);
  if (e.button === 2) send({ t: 'unbuild', gx, gy });
  else send({ t: 'build', gx, gy, block: S.block });
});

$('play').onclick = () => {
  const name = $('name').value.trim();
  if (name.length < 2) { $('login-error').textContent = 'Name must be at least 2 characters.'; return; }
  $('play').disabled = true;
  $('login-error').textContent = '';
  connect(name);
};
$('name').value = localStorage.getItem('ds_name') || '';
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('play').click(); e.stopPropagation(); });
$('name').focus();

// ---- simulation ---------------------------------------------------------------------------

let lastSend = 0, lastSub = 0;

function update(dt, now) {
  const me = S.me;
  const k = S.keys;
  const flying = S.mapOpen || !$('station').hidden ? {} : {
    thrust: k.has('w') || k.has('arrowup'),
    left: k.has('a') || k.has('arrowleft'),
    right: k.has('d') || k.has('arrowright'),
    brake: k.has('s') || k.has('arrowdown'),
  };
  const stats = shipStats(S.upg);
  stepShip(me, flying, stats, dt);
  me.thrust = !!flying.thrust;
  if (me.thrust && Math.random() < 0.8) {
    S.particles.push({ x: me.x - Math.cos(me.a) * 18, y: me.y - Math.sin(me.a) * 18,
      vx: me.vx * 0.3 - Math.cos(me.a + (Math.random() - 0.5) * 0.5) * 160, vy: me.vy * 0.3 - Math.sin(me.a + (Math.random() - 0.5) * 0.5) * 160,
      life: 0.5, max: 0.5, color: '255,170,80' });
  }

  // Mining: hold space to lock on to the nearest asteroid in range.
  S.mineTarget = null;
  const full = cargoTotal(S.cargo) >= stats.cargo;
  if (k.has(' ') && full && now - S.fullToast > 3000) { S.fullToast = now; toast('Cargo hold full. Sell at a station (E to dock).'); }
  if (k.has(' ') && S.mode === 'fly' && !full) {
    let best = null, bestD = Infinity;
    for (const a of nearbyAsteroids()) {
      const d = Math.hypot(a.x - me.x, a.y - me.y) - a.r;
      if (d < stats.mineRange && d < bestD && astAmount(a) > 0) { best = a; bestD = d; }
    }
    S.mineTarget = best;
  }
  const want = S.mineTarget ? S.mineTarget.id : null;
  if (want !== S.sentMine) { send({ t: 'mine', id: want }); S.sentMine = want; }
  if (S.mineTarget && Math.random() < 0.6) {
    const a = S.mineTarget, ang = Math.random() * Math.PI * 2;
    S.particles.push({ x: a.x + Math.cos(ang) * a.r * 0.6, y: a.y + Math.sin(ang) * a.r * 0.6,
      vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, life: 0.6, max: 0.6, color: hexToRgb(ORES[a.ore].color) });
  }

  // Wormholes.
  const [sx, sy] = sectorOf(me.x, me.y);
  const wh = generateSector(sx, sy, S.seed).wormhole;
  if (wh && Math.hypot(wh.x - me.x, wh.y - me.y) < wh.r && now - S.lastWormhole > 2000) {
    S.lastWormhole = now;
    send({ t: 'wormhole' });
  }

  if (now - lastSend > 50) {
    lastSend = now;
    send({ t: 'state', x: me.x, y: me.y, vx: me.vx, vy: me.vy, a: me.a, thrust: me.thrust });
  }
  if (now - lastSub > 400) {
    lastSub = now;
    const keys = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.push(sectorKey(sx + dx, sy + dy));
    send({ t: 'sub', keys });
    for (const key of S.deltas.keys()) if (!keys.includes(key)) S.deltas.delete(key);
  }

  for (const o of S.others.values()) {
    const age = (now - o.at) / 1000;
    const px = o.tx + o.vx * age, py = o.ty + o.vy * age;
    const kk = Math.min(1, dt * 10);
    o.x += (px - o.x) * kk;
    o.y += (py - o.y) * kk;
  }

  for (const p of S.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  S.particles = S.particles.filter((p) => p.life > 0).slice(-600);

  S.cam.x += (me.x - S.cam.x) * Math.min(1, dt * 8);
  S.cam.y += (me.y - S.cam.y) * Math.min(1, dt * 8);
  S.flash = Math.max(0, S.flash - dt * 1.5);
}

function* nearbySectors() {
  const [sx, sy] = sectorOf(S.me.x, S.me.y);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) yield generateSector(sx + dx, sy + dy, S.seed);
}

function* nearbyAsteroids() {
  for (const s of nearbySectors()) yield* s.asteroids;
}

function astAmount(a) {
  const d = S.deltas.get(a.id.split(':')[0]);
  return d && a.id in d.asteroids ? d.asteroids[a.id] : a.amount;
}

// ---- rendering ----------------------------------------------------------------------------

const toScreen = (x, y) => [(x - S.cam.x) * S.zoom + W / 2, (y - S.cam.y) * S.zoom + H / 2];
const screenToWorld = (x, y) => [(x - W / 2) / S.zoom + S.cam.x, (y - H / 2) / S.zoom + S.cam.y];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
}

function resize() {
  DPR = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize);
resize();

function drawBackground(t) {
  const [sx, sy] = sectorOf(S.cam.x, S.cam.y);
  const region = generateSector(sx, sy, S.seed).region;
  ctx.fillStyle = `hsl(${region.hue} 45% 3.5%)`;
  ctx.fillRect(0, 0, W, H);

  // Parallax star layers, generated per tile from a hash so they're infinite and stable.
  const layers = [[0.04, 0.6, 520, 26], [0.12, 1, 420, 18], [0.3, 1.5, 360, 10]];
  for (const [f, size, tile, count] of layers) {
    const ox = S.cam.x * f - W / 2, oy = S.cam.y * f - H / 2;
    const tx0 = Math.floor(ox / tile), ty0 = Math.floor(oy / tile);
    for (let tx = tx0; tx <= tx0 + Math.ceil(W / tile) + 1; tx++) {
      for (let ty = ty0; ty <= ty0 + Math.ceil(H / tile) + 1; ty++) {
        const r = mulberry32(hash2(tx, ty, (f * 1000) | 0));
        for (let i = 0; i < count; i++) {
          const x = tx * tile + r() * tile - ox, y = ty * tile + r() * tile - oy;
          const b = 0.35 + r() * 0.65;
          const tw = 0.75 + 0.25 * Math.sin(t * (1 + r() * 2) + i);
          ctx.fillStyle = `rgba(${r() < 0.15 ? '255,210,180' : r() < 0.3 ? '180,210,255' : '235,240,255'},${b * tw})`;
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  }

  // Nebulae (world space, very soft).
  for (const s of nearbySectors()) {
    for (const n of s.nebulae) {
      const [x, y] = toScreen(n.x, n.y);
      const r = n.r * S.zoom;
      if (x + r < 0 || x - r > W || y + r < 0 || y - r > H) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${n.hue},70%,55%,${n.a})`);
      g.addColorStop(1, `hsla(${n.hue},70%,40%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

function drawSystem(s, t) {
  const z = S.zoom;
  if (s.star) {
    const st = s.star;
    const [x, y] = toScreen(st.x, st.y);
    const R = st.r * z;
    if (st.type === 'Black hole') {
      const g = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 3);
      g.addColorStop(0, 'rgba(255,170,90,0.55)');
      g.addColorStop(0.3, 'rgba(160,90,255,0.15)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R * 4);
      g.addColorStop(0, st.color);
      g.addColorStop(0.25, st.color + '66');
      g.addColorStop(1, st.color + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(x, y, R * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const p of s.planets) {
      ctx.strokeStyle = 'rgba(140,170,220,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, p.orbit * z, 0, Math.PI * 2); ctx.stroke();
      const [wx, wy] = planetPos(p, st, t);
      const [px, py] = toScreen(wx, wy);
      const pr = p.r * z;
      if (px + pr * 2 < 0 || px - pr * 2 > W || py + pr * 2 < 0 || py - pr * 2 > H) continue;
      // Lit from the star.
      const la = Math.atan2(y - py, x - px);
      const g = ctx.createRadialGradient(px + Math.cos(la) * pr * 0.5, py + Math.sin(la) * pr * 0.5, pr * 0.1, px, py, pr);
      g.addColorStop(0, p.color);
      g.addColorStop(1, '#05060c');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      if (p.ring) {
        ctx.strokeStyle = 'rgba(220,200,160,0.45)';
        ctx.lineWidth = Math.max(1, pr * 0.12);
        ctx.beginPath(); ctx.ellipse(px, py, pr * 1.8, pr * 0.5, 0.4, 0, Math.PI * 2); ctx.stroke();
      }
      if (z > 0.25) label(p.name, px, py + pr + 14, 'rgba(180,200,230,0.6)');
    }
  }

  if (s.station) {
    const stn = s.station;
    const [x, y] = toScreen(stn.x, stn.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.15);
    ctx.strokeStyle = '#7fb4ff';
    ctx.lineWidth = Math.max(1.5, 10 * z);
    ctx.beginPath(); ctx.arc(0, 0, 110 * z, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#2b3d63';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-4 * z, 0, 8 * z, 110 * z); }
    ctx.fillStyle = '#c6dcff';
    ctx.beginPath(); ctx.arc(0, 0, 32 * z, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const near = Math.hypot(stn.x - S.me.x, stn.y - S.me.y) <= DOCK_RANGE;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = near ? 'rgba(120,255,170,0.5)' : 'rgba(120,180,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, DOCK_RANGE * z, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    label(stn.name, x, y - 130 * z - 8, '#9fd0ff');
  }

  if (s.wormhole) {
    const wh = s.wormhole;
    const [x, y] = toScreen(wh.x, wh.y);
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `hsla(${(280 + i * 15 + t * 40) % 360},90%,65%,${0.6 - i * 0.08})`;
      ctx.lineWidth = Math.max(1, 6 * z);
      ctx.beginPath();
      ctx.arc(x, y, wh.r * z * (1 - i * 0.14), t * (1.5 + i * 0.4), t * (1.5 + i * 0.4) + Math.PI * 1.4);
      ctx.stroke();
    }
    label(`Wormhole → ${wh.tx}, ${wh.ty}`, x, y + wh.r * z + 16, '#d9a8ff');
  }
}

const shapeCache = new Map();
function asteroidShape(a) {
  let pts = shapeCache.get(a.id);
  if (!pts) {
    const r = mulberry32(a.shape);
    const n = 8 + Math.floor(r() * 6);
    pts = [];
    for (let i = 0; i < n; i++) pts.push([(i / n) * Math.PI * 2, 0.72 + r() * 0.4]);
    if (shapeCache.size > 3000) shapeCache.clear();
    shapeCache.set(a.id, pts);
  }
  return pts;
}

function drawAsteroids(s, t) {
  for (const a of s.asteroids) {
    const amt = astAmount(a);
    if (amt <= 0) continue;
    const [x, y] = toScreen(a.x, a.y);
    const r = a.r * S.zoom * (0.35 + 0.65 * Math.sqrt(amt / a.amount));
    if (x + r < 0 || x - r > W || y + r < 0 || y - r > H) continue;
    const rot = a.spin * t;
    ctx.beginPath();
    for (const [ang, k] of asteroidShape(a)) {
      const px = x + Math.cos(ang + rot) * r * k, py = y + Math.sin(ang + rot) * r * k;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#2a2d36';
    ctx.fill();
    ctx.strokeStyle = ORES[a.ore].color;
    ctx.lineWidth = Math.max(1, 2.5 * S.zoom);
    ctx.stroke();
  }
}

function drawBlocks(t) {
  const z = S.zoom, sz = GRID * z;
  for (const d of S.deltas.values()) {
    for (const [cell, blk] of Object.entries(d.blocks)) {
      const [gx, gy] = cell.split(',').map(Number);
      const [x, y] = toScreen(gx * GRID, gy * GRID);
      if (x + sz < 0 || x > W || y + sz < 0 || y > H) continue;
      const def = BLOCKS[blk.b];
      if (!def) continue;
      if (blk.b === 'light' || blk.b === 'beacon') {
        const pulse = blk.b === 'beacon' ? 0.5 + 0.5 * Math.sin(t * 3) : 0.7;
        const g = ctx.createRadialGradient(x + sz / 2, y + sz / 2, 0, x + sz / 2, y + sz / 2, sz * 4);
        g.addColorStop(0, def.color + Math.round(pulse * 90).toString(16).padStart(2, '0'));
        g.addColorStop(1, def.color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(x - sz * 3.5, y - sz * 3.5, sz * 8, sz * 8);
      }
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, sz + 0.5, sz + 0.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
      if (blk.b === 'beacon' && z > 0.3) label(`${blk.o}'s beacon`, x + sz / 2, y - 8, '#ff9fc8');
    }
  }
}

function drawShip(x, y, a, color, thrust, name, scale = 1) {
  const z = S.zoom * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  if (thrust) {
    ctx.fillStyle = `rgba(255,${150 + Math.random() * 80},60,0.9)`;
    ctx.beginPath(); ctx.moveTo(-14 * z, -6 * z); ctx.lineTo(-(26 + Math.random() * 14) * z, 0); ctx.lineTo(-14 * z, 6 * z); ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = '#e8f0ff';
  ctx.lineWidth = Math.max(1, 1.5 * z);
  ctx.beginPath();
  ctx.moveTo(24 * z, 0); ctx.lineTo(-14 * z, -14 * z); ctx.lineTo(-8 * z, 0); ctx.lineTo(-14 * z, 14 * z);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  if (name) label(name, x, y - 30 * Math.max(z, 0.5), color);
}

function label(text, x, y, color) {
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawBeam(fromX, fromY, a, color) {
  const [x0, y0] = toScreen(fromX, fromY);
  const [x1, y1] = toScreen(a.x, a.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 + Math.random() * 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawRadar() {
  const R = 78, cx = W - R - 16, cy = R + 16, range = 5000;
  ctx.fillStyle = 'rgba(8,12,22,0.72)';
  ctx.strokeStyle = '#1f2a44';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const dot = (x, y, color, size) => {
    const dx = (x - S.me.x) / range * R, dy = (y - S.me.y) / range * R;
    if (dx * dx + dy * dy > R * R) return;
    ctx.fillStyle = color;
    ctx.fillRect(cx + dx - size / 2, cy + dy - size / 2, size, size);
  };
  for (const s of nearbySectors()) {
    for (const a of s.asteroids) if (astAmount(a) > 0) dot(a.x, a.y, ORES[a.ore].color + '99', 2);
    if (s.star) dot(s.star.x, s.star.y, s.star.type === 'Black hole' ? '#a070ff' : s.star.color, 6);
    if (s.station) dot(s.station.x, s.station.y, '#7fb4ff', 5);
    if (s.wormhole) dot(s.wormhole.x, s.wormhole.y, '#d9a8ff', 5);
  }
  for (const o of S.others.values()) dot(o.x, o.y, o.color, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);
}

// Galaxy map: one cell per sector, built from the same generator everyone shares.
const mapCache = new Map();
function mapSummary(sx, sy) {
  const k = sectorKey(sx, sy);
  let m = mapCache.get(k);
  if (!m) {
    const s = generateSector(sx, sy, S.seed);
    m = { star: s.star && { color: s.star.type === 'Black hole' ? '#a070ff' : s.star.color, r: s.star.r, type: s.star.type },
      station: !!s.station, wormhole: s.wormhole, name: s.name, region: s.region, ore: s.asteroids.length };
    if (mapCache.size > 30000) mapCache.clear();
    mapCache.set(k, m);
  }
  return m;
}

function drawMap() {
  const c = S.mapCell;
  const [msx, msy] = sectorOf(S.me.x, S.me.y);
  const fx = (S.me.x / SECTOR_SIZE) - msx, fy = (S.me.y / SECTOR_SIZE) - msy;
  const nx = Math.ceil(W / c / 2) + 1, ny = Math.ceil(H / c / 2) + 1;
  const range = shipStats(S.upg).jumpRange;
  ctx.fillStyle = 'rgba(3,5,12,0.94)';
  ctx.fillRect(0, 0, W, H);
  const cellXY = (sx, sy) => [W / 2 + (sx - msx - fx) * c, H / 2 + (sy - msy - fy) * c];
  const hx = Math.floor((S.mouse.x - W / 2) / c + msx + fx), hy = Math.floor((S.mouse.y - H / 2) / c + msy + fy);
  S.mapHover = null;
  for (let sx = msx - nx; sx <= msx + nx; sx++) {
    for (let sy = msy - ny; sy <= msy + ny; sy++) {
      const m = mapSummary(sx, sy);
      const [x, y] = cellXY(sx, sy);
      ctx.fillStyle = `hsla(${m.region.hue},60%,${12 + m.region.nebula * 18}%,${0.25 + m.region.density * 0.4})`;
      ctx.fillRect(x, y, c - 1, c - 1);
      if (m.star) {
        ctx.fillStyle = m.star.color;
        ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, Math.max(1.5, (m.star.r / 420) * c * 0.28), 0, Math.PI * 2); ctx.fill();
      }
      if (m.station) { ctx.strokeStyle = '#7fb4ff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 3, y + 3, c - 7, c - 7); }
      if (m.wormhole) { ctx.strokeStyle = '#d9a8ff'; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.38, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  // Jump range.
  const [rx, ry] = cellXY(msx - range, msy - range);
  ctx.strokeStyle = 'rgba(120,255,170,0.5)';
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(rx, ry, (range * 2 + 1) * c, (range * 2 + 1) * c);
  ctx.setLineDash([]);
  // Beacons placed by pilots.
  for (const b of S.beacons.values()) {
    const [x, y] = cellXY(b.x / SECTOR_SIZE, b.y / SECTOR_SIZE);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    ctx.fillStyle = '#ff5fa2';
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.restore();
    if (c > 26) label(b.owner, x, y - 8, '#ff9fc8');
  }
  for (const o of S.others.values()) {
    const [x, y] = cellXY(o.x / SECTOR_SIZE, o.y / SECTOR_SIZE);
    ctx.fillStyle = o.color; ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  const [mx, my] = cellXY(S.me.x / SECTOR_SIZE, S.me.y / SECTOR_SIZE);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();

  // Hover info.
  const hm = mapSummary(hx, hy);
  const inRange = Math.max(Math.abs(hx - msx), Math.abs(hy - msy)) <= range && (hx !== msx || hy !== msy);
  if (inRange) S.mapHover = [hx, hy];
  const [hxx, hyy] = cellXY(hx, hy);
  ctx.strokeStyle = inRange ? '#78ffaa' : '#ff7a7a';
  ctx.strokeRect(hxx, hyy, c - 1, c - 1);
  const lines = [
    `${hm.name} (${hx}, ${hy})`, hm.region.name,
    hm.star ? hm.star.type : 'Deep space', hm.station ? 'Station' : '', hm.wormhole ? `Wormhole → ${hm.wormhole.tx}, ${hm.wormhole.ty}` : '',
    `Ore richness ×${hm.region.richness.toFixed(1)}`,
    inRange ? 'Click to jump' : 'Out of jump range',
  ].filter(Boolean);
  const bx = W - 316, by = H - 22 - lines.length * 16;
  ctx.fillStyle = 'rgba(8,12,22,0.9)';
  ctx.fillRect(bx, by, 300, lines.length * 16 + 10);
  ctx.textAlign = 'left';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#9fd0ff' : '#b8c4d8'; ctx.fillText(l, bx + 8, by + 18 + i * 16); });
  label('GALAXY MAP · wheel to zoom · M to close', W / 2, 28, '#9fd0ff');
}

function render() {
  const t = (Date.now() + S.timeOffset) / 1000;
  drawBackground(t);
  const secs = [...nearbySectors()];
  for (const s of secs) drawSystem(s, t);
  for (const s of secs) drawAsteroids(s, t);
  drawBlocks(t);

  for (const p of S.particles) {
    const [x, y] = toScreen(p.x, p.y);
    ctx.fillStyle = `rgba(${p.color},${p.life / p.max})`;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  for (const o of S.others.values()) {
    if (o.mining) {
      const a = [...nearbyAsteroids()].find((x) => x.id === o.mining);
      if (a) drawBeam(o.x, o.y, a, o.color);
    }
    const [x, y] = toScreen(o.x, o.y);
    drawShip(x, y, o.a, o.color, o.thrust, o.name);
  }
  if (S.mineTarget) drawBeam(S.me.x, S.me.y, S.mineTarget, '#8fe3ff');
  const [mx, my] = toScreen(S.me.x, S.me.y);
  drawShip(mx, my, S.me.a, S.me.color, S.me.thrust, null);

  if (S.mode === 'build') {
    const [wx, wy] = screenToWorld(S.mouse.x, S.mouse.y);
    const gx = Math.floor(wx / GRID), gy = Math.floor(wy / GRID);
    const [x, y] = toScreen(gx * GRID, gy * GRID);
    const ok = Math.hypot((gx + 0.5) * GRID - S.me.x, (gy + 0.5) * GRID - S.me.y) <= BUILD_RANGE;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = BLOCKS[S.block].color;
    ctx.fillRect(x, y, GRID * S.zoom, GRID * S.zoom);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#78ffaa' : '#ff7a7a';
    ctx.strokeRect(x, y, GRID * S.zoom, GRID * S.zoom);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(120,255,170,0.25)';
    ctx.beginPath(); ctx.arc(mx, my, BUILD_RANGE * S.zoom, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRadar();
  document.body.classList.toggle('map-open', S.mapOpen);
  if (S.mapOpen) drawMap();
  if (S.flash > 0) {
    ctx.fillStyle = `rgba(220,235,255,${S.flash})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Idle background before login: a slow drift through the real universe.
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.connected && S.me) {
    update(dt, now);
    render();
    updateHud(now);
  } else {
    S.seed ||= 1337;
    S.me ||= { x: 2500, y: 2500, vx: 0, vy: 0, a: 0 };
    S.cam.x += 40 * dt; S.cam.y += 15 * dt;
    S.me.x = S.cam.x; S.me.y = S.cam.y;
    drawBackground(now / 1000);
    const secs = [...nearbySectors()];
    for (const s of secs) drawSystem(s, now / 1000);
    for (const s of secs) drawAsteroids(s, now / 1000);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
