// Realistic spacecraft built from a ship's block layout. Each block becomes a piece of a real
// hull: panelled, riveted modules with chipped paint and grime, a sculpted nose with a glass
// canopy, bell-shaped engine nozzles that glow with thrust, swept wings with navigation lights,
// cannons with heat sinks and muzzle brakes, cargo containers and armor plating. Everything is
// merged per material, so a ship is a handful of draw calls.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP_PARTS, SHIP_BLOCK } from '/shared/rules.js';
import { mulberry32 } from '/shared/rng.js';
import { cc0Normal } from './realism.js';

// ---- panel textures: grooves, rivets, hatches and vents, painted and worn ---------------------------

let panelTex = null;
function panelTextures() {
  if (panelTex) return panelTex;
  const N = 512, H = new Float32Array(N * N).fill(0.5), groove = new Float32Array(N * N), chip = new Float32Array(N * N), tone = new Float32Array(N * N);
  const r = mulberry32(4242);
  const fill = (x0, y0, x1, y1, fn) => { for (let y = Math.max(0, y0); y < Math.min(N, y1); y++) for (let x = Math.max(0, x0); x < Math.min(N, x1); x++) fn(y * N + x, x, y); };
  const line = (x0, y0, x1, y1, w) => fill(x0 - w, y0 - w, x1 + w, y1 + w, (i) => { H[i] = 0.1; groove[i] = 1; });
  const rivet = (cx, cy) => fill(cx - 3, cy - 3, cx + 4, cy + 4, (i, x, y) => { const d = Math.hypot(x - cx, y - cy); if (d < 2.6) H[i] = Math.max(H[i], 0.5 + (2.6 - d) * 0.12); });
  const panel = (x0, y0, x1, y1, depth) => {
    const w = x1 - x0, h = y1 - y0;
    if (depth < 4 && (w > 90 || h > 90) && (depth < 2 || r() < 0.75)) {
      if (w > h ? r() < 0.8 : r() < 0.2) { const s = Math.round(x0 + w * (0.3 + r() * 0.4)); panel(x0, y0, s, y1, depth + 1); panel(s, y0, x1, y1, depth + 1); }
      else { const s = Math.round(y0 + h * (0.3 + r() * 0.4)); panel(x0, y0, x1, s, depth + 1); panel(x0, s, x1, y1, depth + 1); }
      return;
    }
    const lift = (r() - 0.5) * 0.06, t = (r() - 0.5) * 0.08;
    fill(x0, y0, x1, y1, (i) => { H[i] += lift; tone[i] = t; });
    line(x0, y0, x1, y0, 1); line(x0, y1, x1, y1, 1); line(x0, y0, x0, y1, 1); line(x1, y0, x1, y1, 1);
    // Rivets along some edges.
    if (r() < 0.55) {
      for (let x = x0 + 8; x < x1 - 4; x += 14) { rivet(x, y0 + 7); rivet(x, y1 - 7); }
      if (r() < 0.5) for (let y = y0 + 21; y < y1 - 18; y += 14) { rivet(x0 + 7, y); rivet(x1 - 7, y); }
    }
    const kind = r();
    if (kind < 0.18 && w > 50 && h > 40) {
      // A vent grille.
      const vx0 = x0 + w * 0.2, vx1 = x1 - w * 0.2;
      for (let y = y0 + h * 0.25; y < y1 - h * 0.25; y += 7) fill(Math.round(vx0), Math.round(y), Math.round(vx1), Math.round(y) + 3, (i) => { H[i] = 0.18; groove[i] = 0.8; });
    } else if (kind < 0.36 && w > 60 && h > 60) {
      // A hatch: an inset outline with a small handle.
      const m = Math.min(w, h) * 0.18;
      const a = Math.round(x0 + m), b = Math.round(y0 + m), c = Math.round(x1 - m), d = Math.round(y1 - m);
      line(a, b, c, b, 0); line(a, d, c, d, 0); line(a, b, a, d, 0); line(c, b, c, d, 0);
      fill(Math.round((a + c) / 2) - 8, d - 12, Math.round((a + c) / 2) + 8, d - 8, (i) => { H[i] = 0.62; });
    } else if (kind < 0.46) {
      // A raised access plate.
      fill(Math.round(x0 + w * 0.25), Math.round(y0 + h * 0.3), Math.round(x1 - w * 0.25), Math.round(y1 - h * 0.3), (i) => { H[i] += 0.06; });
    }
  };
  panel(0, 0, N - 1, N - 1, 0);
  // Chipped paint: little flakes, mostly near seams.
  for (let k = 0; k < 900; k++) {
    let x = Math.floor(r() * N), y = Math.floor(r() * N);
    for (let s = 0; s < 6 && !groove[y * N + x]; s++) { x = (x + Math.floor((r() - 0.5) * 18) + N) % N; y = (y + Math.floor((r() - 0.5) * 18) + N) % N; }
    const rad = 1 + r() * 3.2;
    fill(Math.floor(x - rad), Math.floor(y - rad), Math.ceil(x + rad), Math.ceil(y + rad), (i, px, py) => { if (Math.hypot(px - x, py - y) < rad * (0.6 + r() * 0.5)) chip[i] = 1; });
  }
  // Soft value noise for grime.
  const noise = (x, y, s) => {
    const ix = Math.floor(x / s), iy = Math.floor(y / s), fx = x / s - ix, fy = y / s - iy;
    const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v;
  };
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const nc = mk(), ac = mk(), rc = mk();
  const nd = nc.getContext('2d').createImageData(N, N), ad = ac.getContext('2d').createImageData(N, N), rd = rc.getContext('2d').createImageData(N, N);
  const at = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, o = i * 4;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2, dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const l = Math.hypot(dx, dy, 1);
      nd.data[o] = (-dx / l * 0.5 + 0.5) * 255; nd.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; nd.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd.data[o + 3] = 255;
      // Grime collects in seams and streaks downward from them.
      let streak = 0;
      for (let k = 1; k < 40; k += 4) streak = Math.max(streak, groove[Math.max(0, y - k) * N + x] * (1 - k / 40));
      const grime = noise(x, y, 64) * 0.5 + noise(x, y, 17) * 0.3 + noise(x, y * 0.25, 9) * 0.2;
      let a = 0.9 + tone[i] - groove[i] * 0.42 - streak * 0.12 * noise(x, y, 5) - grime * 0.14;
      if (chip[i]) a = 1.25;   // bare metal shows through: lighter
      a = Math.max(0, Math.min(1, a));
      ad.data[o] = ad.data[o + 1] = ad.data[o + 2] = a * 255; ad.data[o + 3] = 255;
      const rough = chip[i] ? 0.32 : Math.min(1, 0.42 + tone[i] * 1.2 + grime * 0.25 + groove[i] * 0.3 + streak * 0.1);
      rd.data[o] = 255; rd.data[o + 1] = rough * 255; rd.data[o + 2] = chip[i] ? 255 : 30; rd.data[o + 3] = 255;
    }
  }
  nc.getContext('2d').putImageData(nd, 0, 0);
  ac.getContext('2d').putImageData(ad, 0, 0);
  rc.getContext('2d').putImageData(rd, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  panelTex = { normal: tex(nc), albedo: tex(ac, true), rm: tex(rc) };
  return panelTex;
}

// ---- materials ----------------------------------------------------------------------------------------

let mats = null;
function materials() {
  if (mats) return mats;
  const t = panelTextures();
  mats = {
    // Painted panels: tinted per part by vertex color; chips show bare metal (metalness map).
    paint: new THREE.MeshPhysicalMaterial({
      vertexColors: true, map: t.albedo, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1),
      roughness: 1, roughnessMap: t.rm, metalness: 1, metalnessMap: t.rm, clearcoat: 0.3, clearcoatRoughness: 0.4,
    }),
    // Bare and dark machined metal for engines, guns and greebles.
    metal: new THREE.MeshPhysicalMaterial({ color: '#8a8e94', roughness: 0.32, metalness: 1, normalMap: cc0Normal('scratched'), normalScale: new THREE.Vector2(0.35, 0.35) }),
    dark: new THREE.MeshPhysicalMaterial({ color: '#2a2d32', roughness: 0.5, metalness: 0.85, normalMap: t.normal, normalScale: new THREE.Vector2(0.6, 0.6) }),
    // Heat-blued nozzle metal.
    heat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 1, iridescence: 0.3, iridescenceIOR: 1.6 }),
    // Tinted cockpit glass: dark, glossy, reflecting the sky.
    glass: new THREE.MeshPhysicalMaterial({ color: '#0b1820', roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.6 }),
    red: new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 6 }),
    green: new THREE.MeshStandardMaterial({ color: '#2aff6a', emissive: '#2aff6a', emissiveIntensity: 6 }),
    white: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f0ff', emissiveIntensity: 5 }),
    shield: new THREE.MeshStandardMaterial({ color: '#4bd8ff', emissive: '#4bd8ff', emissiveIntensity: 3 }),
  };
  return mats;
}

// ---- geometry helpers ---------------------------------------------------------------------------------

// A loft along -z (front) from rounded-rectangle sections [z, halfWidth, halfHeight, roundness 0..1, yOffset].
function loftZ(sections, segs = 24) {
  const pos = [], uv = [], idx = [];
  const back = sections[1][0] > sections[0][0];   // sections running toward +z wind the other way
  const ring = segs;
  for (let s = 0; s < sections.length; s++) {
    const [z, w, h, round = 0.5, yo = 0] = sections[s];
    const n = 2 + (1 - round) * 6;   // superellipse: 2 is an ellipse, higher is boxier
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w, y = Math.sign(si) * Math.pow(Math.abs(si), 2 / n) * h + yo;
      pos.push(x, y, z);
      uv.push(k / ring, s / (sections.length - 1));
    }
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let k = 0; k < ring; k++) {
      const a = s * ring + k, b = s * ring + ((k + 1) % ring), c = a + ring, d = b + ring;
      if (back) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // Cap the front end with a center point.
  const last = sections[sections.length - 1];
  const tip = pos.length / 3;
  pos.push(0, last[4] || 0, last[0] + (back ? 0.02 : -0.02));
  uv.push(0.5, 1);
  const base = (sections.length - 1) * ring;
  for (let k = 0; k < ring; k++) { if (back) idx.push(base + k, base + ((k + 1) % ring), tip); else idx.push(base + k, tip, base + ((k + 1) % ring)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A bell nozzle opening toward +z.
function nozzle(throat, exit, len) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(throat + (exit - throat) * Math.pow(t, 0.6), t * len)); }
  for (let i = 10; i >= 0; i--) { const t = i / 10; pts.push(new THREE.Vector2((throat + (exit - throat) * Math.pow(t, 0.6)) * 0.9, t * len)); }
  return new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2);
}

// ---- the builder ----------------------------------------------------------------------------------------

export function buildRealShip(blocks, tint = '#9fd0ff') {
  const S = SHIP_BLOCK, M = materials();
  const group = new THREE.Group();
  const occ = new Map(blocks.map(([x, y, z, t]) => [`${x},${y},${z}`, t]));
  const at = (x, y, z) => occ.get(`${x},${y},${z}`);
  const body = (t) => t && t !== 'wing';
  const tintC = new THREE.Color(tint);
  const parts = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  // Add a piece: geometry, material key, position, rotation, scale and (for paint) a color.
  const add = (key, geo, x, y, z, rx = 0, ry = 0, rz = 0, color = null, sx = 1, sy = 1, sz = 1) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz));
    g.applyMatrix4(m4);
    if (m4.determinant() < 0) {
      // Mirrored pieces (port wings) would turn inside out: restore the triangle winding.
      for (const name of ['position', 'normal', 'uv']) {
        const a = g.attributes[name], n = a.itemSize, arr = a.array;
        for (let t = 0; t < a.count; t += 3) for (let c = 0; c < n; c++) { const i1 = (t + 1) * n + c, i2 = (t + 2) * n + c; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
      }
    }
    if (key === 'paint' || key === 'heat') {
      const c = new THREE.Color(color || '#888888'), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        if (typeof color === 'function') { const cc = color(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)); col.set([cc.r, cc.g, cc.b], i * 3); }
        else col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(g);
  };
  const paintOf = (t) => {
    const base = new THREE.Color(SHIP_PARTS[t]?.color || '#6b7787');
    if (t === 'hull' || t === 'wing' || t === 'cockpit') return base.lerp(tintC, 0.45).multiplyScalar(1.1);
    if (t === 'armor') return base.lerp(tintC, 0.15).multiplyScalar(0.9);
    return base;
  };
  const glow = new THREE.MeshStandardMaterial({ color: '#ffd0a0', emissive: '#ff8a3a', emissiveIntensity: 1.2 });
  const box = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * r * 2);

  for (const [bx, by, bz, t] of blocks) {
    if (!SHIP_PARTS[t]) continue;
    const x = bx * S, y = by * S, z = bz * S;
    const rng = mulberry32((bx * 73856093) ^ (by * 19349663) ^ (bz * 83492791) ^ 0x5f3759df);
    const paint = paintOf(t);
    const open = { px: !at(bx + 1, by, bz), nx: !at(bx - 1, by, bz), py: !at(bx, by + 1, bz), ny: !at(bx, by - 1, bz), pz: !at(bx, by, bz + 1), nz: !at(bx, by, bz - 1) };
    // Greebles on open faces: pipes, boxes and sensor blisters, different for every block.
    const greeble = (count) => {
      for (const [face, dx, dy] of [['py', 0, 1], ['ny', 0, -1], ['px', 1, 0], ['nx', -1, 0]]) {
        if (!open[face]) continue;
        for (let k = 0; k < count; k++) {
          const a = (rng() - 0.5) * S * 0.7, b = (rng() - 0.5) * S * 0.7, s = S * (0.06 + rng() * 0.16), hgt = S * (0.03 + rng() * 0.06);
          const off = S * 0.5 + hgt * 0.5 - 0.02;
          const kind = rng();
          const gx = dx ? x + dx * off : x + a, gy = dy ? y + dy * off : y + (dx ? a : 0), gz = z + b;
          if (kind < 0.55) add('dark', box(dx ? hgt : s, dy ? hgt : s * 0.7, s * (1 + rng() * 2), 0.15), gx, gy, gz);
          else if (kind < 0.8) add('metal', new THREE.CylinderGeometry(S * 0.025, S * 0.025, S * (0.4 + rng() * 0.5), 10), gx, gy, gz, Math.PI / 2, 0, 0);
          else add('dark', new THREE.SphereGeometry(s * 0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), gx, gy, gz, dx ? 0 : dy < 0 ? Math.PI : 0, 0, dx ? -dx * Math.PI / 2 : 0);
        }
      }
    };

    if (t === 'cockpit') {
      if (open.nz) {
        // A sculpted nose tapering forward, with a bubble canopy on top.
        const nose = loftZ([
          [S * 0.5, S * 0.5, S * 0.5, 0.25], [0, S * 0.47, S * 0.45, 0.35], [-S * 0.5, S * 0.4, S * 0.36, 0.45, -S * 0.03],
          [-S * 0.95, S * 0.28, S * 0.24, 0.65, -S * 0.08], [-S * 1.3, S * 0.13, S * 0.12, 0.85, -S * 0.12], [-S * 1.45, S * 0.03, S * 0.03, 1, -S * 0.13],
        ], 28);
        add('paint', nose, x, y, z, 0, 0, 0, paint);
        add('glass', new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), x, y + S * 0.33, z - S * 0.15, 0, 0, 0, null, S * 0.3, S * 0.26, S * 0.62);
        // Canopy frame: a center spine and two hoops.
        add('dark', new THREE.TorusGeometry(1, 0.035, 6, 24, Math.PI), x, y + S * 0.33, z - S * 0.15, 0, Math.PI / 2, 0, null, S * 0.62, S * 0.27, S * 0.3);
        for (const fz of [-0.42, 0.12]) add('dark', new THREE.TorusGeometry(1, 0.05, 6, 20, Math.PI), x, y + S * 0.33, z - S * 0.15 + fz * S, 0, 0, 0, null, S * 0.29, S * 0.25 * Math.sqrt(1 - (fz / 0.62) ** 2), 1);
        // Pitot tube and sensor blister.
        add('metal', new THREE.CylinderGeometry(S * 0.012, S * 0.02, S * 0.4, 8), x, y - S * 0.13, z - S * 1.6, Math.PI / 2, 0, 0);
        add('dark', new THREE.SphereGeometry(S * 0.07, 14, 10), x, y - S * 0.3, z - S * 0.6);
      } else {
        add('paint', box(S * 1.0, S * 1.0, S * 1.0, 0.1), x, y, z, 0, 0, 0, paint);
        add('glass', new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), x, y + S * 0.48, z, 0, 0, 0, null, S * 0.3, S * 0.22, S * 0.42);
      }
    } else if (t === 'hull' || t === 'shield') {
      add('paint', box(S * 1.0, S * 1.0, S * 1.0, 0.1), x, y, z, 0, 0, 0, paint);
      greeble(t === 'shield' ? 1 : 3);
      if (t === 'shield') {
        const up = open.py ? 1 : -1;
        add('dark', new THREE.CylinderGeometry(S * 0.3, S * 0.36, S * 0.12, 24), x, y + up * S * 0.55, z, up < 0 ? Math.PI : 0);
        add('shield', new THREE.TorusGeometry(S * 0.24, S * 0.03, 8, 32), x, y + up * S * 0.62, z, Math.PI / 2);
        add('metal', new THREE.CylinderGeometry(S * 0.05, S * 0.08, S * 0.3, 12), x, y + up * S * 0.7, z, up < 0 ? Math.PI : 0);
      }
    } else if (t === 'armor') {
      add('dark', box(S * 0.96, S * 0.96, S * 0.96, 0.08), x, y, z);
      // Overlapping angled slabs of plate on the open sides.
      for (const [face, ax, ay] of [['py', 0, 1], ['ny', 0, -1], ['px', 1, 0], ['nx', -1, 0]]) {
        if (!open[face]) continue;
        for (let k = 0; k < 2; k++) {
          const zz = z + (k - 0.5) * S * 0.48;
          if (ay) add('paint', box(S * 1.04, S * 0.12, S * 0.56, 0.2), x, y + ay * S * 0.5, zz, ay * 0.06, 0, 0, paint);
          else add('paint', box(S * 0.12, S * 1.04, S * 0.56, 0.2), x + ax * S * 0.5, y, zz, 0, ax * 0.06, 0, paint);
        }
      }
    } else if (t === 'cargo') {
      add('paint', box(S * 0.94, S * 0.9, S * 0.98, 0.06), x, y, z, 0, 0, 0, paint);
      for (let k = 0; k < 4; k++) add('paint', box(S * 1.0, S * 0.96, S * 0.07, 0.3), x, y, z + (k / 3 - 0.5) * S * 0.86, 0, 0, 0, paint.clone().multiplyScalar(0.55));
      for (const sx of [-1, 1]) if (open[sx > 0 ? 'px' : 'nx']) add('metal', box(S * 0.04, S * 0.5, S * 0.3, 0.3), x + sx * S * 0.49, y, z);
    } else if (t === 'thruster') {
      add('paint', loftZ([[-S * 0.5, S * 0.48, S * 0.48, 0.3], [-S * 0.1, S * 0.47, S * 0.47, 0.4], [S * 0.3, S * 0.42, S * 0.42, 0.55]], 24), x, y, z, 0, 0, 0, paintOf('hull').multiplyScalar(0.75));
      // Bell nozzle with heat tint: straw at the throat, blue toward the lip.
      const heat = (px, py, pz) => new THREE.Color('#8e8578').lerp(new THREE.Color('#4e5878'), Math.min(1, Math.max(0, (pz - z - S * 0.2) / (S * 0.6))));
      add('heat', nozzle(S * 0.2, S * 0.4, S * 0.62), x, y, z + S * 0.22, 0, 0, 0, heat);
      add('dark', new THREE.CylinderGeometry(S * 0.3, S * 0.36, S * 0.16, 24), x, y, z + S * 0.3, Math.PI / 2, 0, 0);
      // The glowing combustion chamber.
      add('glow', new THREE.CircleGeometry(S * 0.2, 24), x, y, z + S * 0.4, 0, 0, 0);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; add('metal', new THREE.CylinderGeometry(S * 0.018, S * 0.018, S * 0.5, 6), x + Math.cos(a) * S * 0.44, y + Math.sin(a) * S * 0.44, z, Math.PI / 2, 0, 0); }
    } else if (t === 'missile') {
      // A launcher pod: a block with a 2x2 grid of tubes, warheads peeking out of the front.
      add('paint', box(S * 0.9, S * 0.8, S * 0.95, 0.1), x, y, z, 0, 0, 0, paint);
      add('dark', box(S * 0.8, S * 0.7, S * 0.06, 0.2), x, y, z - S * 0.49);
      for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = x + mx * S * 0.2, ty = y + my * S * 0.17;
        add('metal', new THREE.CylinderGeometry(S * 0.14, S * 0.14, S * 0.12, 16), tx, ty, z - S * 0.5, Math.PI / 2, 0, 0);
        add('red', new THREE.ConeGeometry(S * 0.09, S * 0.2, 14), tx, ty, z - S * 0.62, -Math.PI / 2, 0, 0);
      }
      greeble(1);
    } else if (t === 'gun') {
      add('dark', box(S * 0.62, S * 0.5, S * 0.8, 0.12), x, y, z);
      add('paint', box(S * 0.64, S * 0.1, S * 0.5, 0.3), x, y + S * 0.26, z, 0, 0, 0, paint);
      const len = S * 1.25, bz0 = z - S * 0.4;
      add('metal', new THREE.CylinderGeometry(S * 0.06, S * 0.07, len, 16), x, y, bz0 - len / 2, Math.PI / 2, 0, 0);
      add('dark', new THREE.CylinderGeometry(S * 0.13, S * 0.14, S * 0.5, 16), x, y, bz0 - S * 0.25, Math.PI / 2, 0, 0);
      for (let k = 0; k < 5; k++) add('dark', new THREE.CylinderGeometry(S * 0.1, S * 0.1, S * 0.03, 16), x, y, bz0 - S * 0.6 - k * S * 0.08, Math.PI / 2, 0, 0);
      add('dark', new THREE.CylinderGeometry(S * 0.09, S * 0.09, S * 0.16, 12), x, y, bz0 - len + S * 0.06, Math.PI / 2, 0, 0);
      add('red', new THREE.CircleGeometry(S * 0.04, 12), x, y, bz0 - len - 0.03, Math.PI, 0, 0);
    } else if (t === 'wing') {
      const side = bx < 0 ? -1 : 1;
      // How far out along the wing this block is, and how long the wing is.
      let i = 0; while (at(bx - side * (i + 1), by, bz) === 'wing') i++;
      let L = i + 1; while (at(bx + side * (L - i), by, bz) === 'wing') L++;
      const chord = (k) => S * (1.05 - 0.5 * k / L), sweep = (k) => S * 0.45 * k;
      const c0 = chord(i), c1 = chord(i + 1), s0 = sweep(i), s1 = sweep(i + 1);
      // The planform in (span, chord), extruded to the wing's thickness, thinner toward the tip.
      const shape = new THREE.Shape();
      shape.moveTo(0, -c0 / 2 + s0 - sweep(i)); shape.lineTo(S, -c1 / 2 + s1 - sweep(i)); shape.lineTo(S, c1 / 2 + s1 - sweep(i)); shape.lineTo(0, c0 / 2 + s0 - sweep(i)); shape.closePath();
      const thick = S * 0.1 * (1 - 0.4 * i / L);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: thick * 0.4, bevelSegments: 3 });
      geo.translate(0, 0, -thick / 2);
      { const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / S, uv.getY(k) / S); }
      geo.rotateX(Math.PI / 2);
      const root = x - side * S * 0.5;
      add('paint', geo, root, y, z + sweep(i) * 0, 0, 0, 0, paint, side, 1, 1);
      if (!at(bx + side, by, bz)) {
        // Wingtip: a fin with a navigation light (red to port, green to starboard) and a strobe.
        const tipX = root + side * S, tipZ = z + s1;
        add('paint', box(S * 0.08, S * 0.5, c1 * 0.8, 0.3), tipX, y + S * 0.12, tipZ + c1 * 0.05, 0, 0, 0, paint);
        add(side < 0 ? 'red' : 'green', new THREE.SphereGeometry(S * 0.045, 12, 8), tipX + side * S * 0.05, y, tipZ - c1 * 0.45);
        add('white', new THREE.SphereGeometry(S * 0.03, 10, 6), tipX + side * S * 0.05, y, tipZ + c1 * 0.45);
      }
    }
  }

  const keys = { paint: M.paint, metal: M.metal, dark: M.dark, heat: M.heat, glass: M.glass, red: M.red, green: M.green, white: M.white, shield: M.shield, glow };
  for (const [key, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), keys[key]);
    mesh.castShadow = mesh.receiveShadow = !['red', 'green', 'white', 'glow', 'shield'].includes(key);
    group.add(mesh);
  }
  group.userData.nozzles = [glow];
  return group;
}
