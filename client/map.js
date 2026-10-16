// Galaxy map: one cell per sector, drawn from the same generator everyone shares.
// Shows stars, stations, wormholes, beacons, party members, story targets and jump range.

import { generateSector, sectorKey, isSafe, SECTOR_SIZE, FAR_REACH } from '/shared/universe.js';

const cache = new Map();
function summary(sx, sz, seed) {
  const k = sectorKey(sx, sz);
  let m = cache.get(k);
  if (!m) {
    const s = generateSector(sx, sz, seed);
    m = {
      star: s.star && { color: s.star.type === 'Black hole' ? '#a070ff' : s.star.color, r: s.star.r, type: s.star.type },
      station: !!s.station, stationName: s.station?.name, wormhole: s.wormhole, name: s.name, region: s.region,
      planets: s.planets.filter((p) => p.landable).length,
    };
    if (cache.size > 30000) cache.clear();
    cache.set(k, m);
  }
  return m;
}

export class GalaxyMap {
  constructor(state, send) {
    this.S = state;
    this.send = send;
    this.cell = 32;
    this.canvas = document.getElementById('map');
    this.ctx = this.canvas.getContext('2d');
    this.mouse = { x: 0, y: 0 };
    this.hover = null;
    this.canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    this.canvas.addEventListener('wheel', (e) => { this.cell = Math.max(14, Math.min(90, this.cell * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: true });
    this.canvas.addEventListener('mousedown', () => {
      if (this.hover && this.S.you.mode === 'space') this.send({ t: 'jump', sx: this.hover[0], sz: this.hover[1] });
      this.toggle(false);
    });
  }

  get open() { return !this.canvas.hidden; }

  toggle(on = !this.open) {
    this.canvas.hidden = !on;
    if (on) document.exitPointerLock?.();
  }

  draw() {
    if (!this.open) return;
    const S = this.S, c = this.cell;
    const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (this.canvas.width !== W * dpr) { this.canvas.width = W * dpr; this.canvas.height = H * dpr; }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Where am I in galaxy terms?
    let wx, wz;
    if (S.you.mode === 'space') { wx = S.me.x; wz = S.me.z; }
    else {
      const m = /^(-?\d+),(-?\d+):/.exec(S.you.planet);
      wx = (+m[1] + 0.5) * SECTOR_SIZE; wz = (+m[2] + 0.5) * SECTOR_SIZE;
    }
    const fx = wx / SECTOR_SIZE, fz = wz / SECTOR_SIZE;
    const msx = Math.floor(fx), msz = Math.floor(fz);
    const nx = Math.ceil(W / c / 2) + 1, nz = Math.ceil(H / c / 2) + 1;
    const range = S.you.mode === 'space' ? S.you.stats.jumpRange : 0;
    const toXY = (sx, sz) => [W / 2 + (sx - fx) * c, H / 2 + (sz - fz) * c];

    g.fillStyle = 'rgba(3,5,12,0.95)';
    g.fillRect(0, 0, W, H);
    for (let sx = msx - nx; sx <= msx + nx; sx++) {
      for (let sz = msz - nz; sz <= msz + nz; sz++) {
        const m = summary(sx, sz, S.seed);
        const [x, y] = toXY(sx, sz);
        g.fillStyle = `hsla(${m.region.hue},60%,${12 + m.region.nebula * 18}%,${0.25 + m.region.density * 0.4})`;
        g.fillRect(x, y, c - 1, c - 1);
        if (isSafe(sx, sz)) { g.fillStyle = 'rgba(120,255,170,0.06)'; g.fillRect(x, y, c - 1, c - 1); }
        if (m.star) {
          g.fillStyle = m.star.color;
          g.beginPath(); g.arc(x + c / 2, y + c / 2, Math.max(1.5, (m.star.r / 420) * c * 0.28), 0, Math.PI * 2); g.fill();
        }
        if (m.station) { g.strokeStyle = '#7fb4ff'; g.lineWidth = 1.5; g.strokeRect(x + 3, y + 3, c - 7, c - 7); }
        if (m.wormhole) { g.strokeStyle = '#d9a8ff'; g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.38, 0, Math.PI * 2); g.stroke(); }
      }
    }
    if (range) {
      const [rx, ry] = toXY(msx - range, msz - range);
      g.strokeStyle = 'rgba(120,255,170,0.55)';
      g.setLineDash([5, 5]);
      g.strokeRect(rx, ry, (range * 2 + 1) * c, (range * 2 + 1) * c);
      g.setLineDash([]);
    }
    const marker = (sx, sz, color, text, shape = 'diamond') => {
      const [x, y] = toXY(sx, sz);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
      g.fillStyle = color;
      g.save(); g.translate(x, y);
      if (shape === 'diamond') { g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); } else { g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); }
      g.restore();
      if (text && c > 20) { g.font = '11px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(text, x, y - 9); }
    };
    for (const b of S.beacons.values()) marker(b.x / SECTOR_SIZE, b.z / SECTOR_SIZE, '#ff5fa2', b.owner);
    const st = S.story;
    if (st?.mothership) marker(st.mothership.sx + 0.5, st.mothership.sz + 0.5, '#d06aff', 'HIVE MOTHERSHIP', 'dot');
    if (st?.relics) for (const r of st.relics) marker(r.sx + 0.5, r.sz + 0.5, r.found ? '#6a5a8a' : '#c27bff', r.found ? '' : 'Relic: ' + r.name, 'dot');
    if (st?.effects?.gateBuilt) marker(FAR_REACH[0] + 0.5, FAR_REACH[1] + 0.5, '#d9a8ff', 'Far Reach', 'dot');
    if (S.party) for (const m of S.party.members) {
      if (!m.online || m.key === S.you.key) continue;
      if (m.mode === 'space') marker(m.x / SECTOR_SIZE, m.z / SECTOR_SIZE, m.color, m.name, 'dot');
      else marker(m.sx + 0.5, m.sz + 0.5, m.color, m.name, 'dot');
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(W / 2, H / 2, 4, 0, Math.PI * 2); g.fill();

    const hx = Math.floor((this.mouse.x - W / 2) / c + fx), hz = Math.floor((this.mouse.y - H / 2) / c + fz);
    const hm = summary(hx, hz, S.seed);
    const inRange = range && Math.max(Math.abs(hx - msx), Math.abs(hz - msz)) <= range && (hx !== msx || hz !== msz);
    this.hover = inRange ? [hx, hz] : null;
    const [bx, by] = toXY(hx, hz);
    g.strokeStyle = inRange ? '#78ffaa' : '#ff7a7a';
    g.strokeRect(bx, by, c - 1, c - 1);
    const lines = [
      `${hm.name} (${hx}, ${hz})`, hm.region.name, hm.star ? hm.star.type : 'Deep space',
      hm.planets ? `${hm.planets} landable planet${hm.planets > 1 ? 's' : ''}` : '', hm.station ? hm.stationName : '',
      hm.wormhole ? `Wormhole → ${hm.wormhole.tx}, ${hm.wormhole.tz}` : '', isSafe(hx, hz) ? 'Safe zone' : 'Lawless',
      `Ore richness ×${hm.region.richness.toFixed(1)}`,
      S.you.mode !== 'space' ? 'Take off to jump' : inRange ? 'Click to jump' : 'Out of jump range',
    ].filter(Boolean);
    const px = W - 316, py = H - 22 - lines.length * 16;
    g.fillStyle = 'rgba(8,12,22,0.92)';
    g.fillRect(px, py, 300, lines.length * 16 + 10);
    g.textAlign = 'left';
    g.font = '12px ui-monospace, Menlo, monospace';
    lines.forEach((l, i) => { g.fillStyle = i === 0 ? '#9fd0ff' : '#b8c4d8'; g.fillText(l, px + 8, py + 18 + i * 16); });
    g.textAlign = 'center';
    g.fillStyle = '#9fd0ff';
    g.fillText('GALAXY MAP · wheel to zoom · M to close', W / 2, 28);
  }
}
