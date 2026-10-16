// The 3D space scene: nearby sectors, stars and planets, asteroids, stations, other pilots,
// NPC ships, structures, and the chase camera for your own ship.

import * as THREE from 'three';
import { generateSector, sectorOf, sectorKey, planetPos, effectiveOre, FAR_REACH } from '/shared/universe.js';
import { ORES, BLOCKS, WORLD_GRID, DOCK_RANGE, LAND_MARGIN, stepShip, gravityAt, DOCK_PORT_RANGE } from '/shared/rules.js';
import { mulberry32, fbm } from '/shared/rng.js';
import { buildShip, buildNpc, buildStation, glowSprite, label, healthBar, setHealth, setThrust } from './meshes.js';
import { FX } from './fx.js';
import { ALIEN_RACES } from '/shared/content/aliens.js';
import { planetTextures, atmosphereMaterial, nebulaSky } from './planettex.js';
import { realism, realSurface } from './realism.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// Lens-flare sprites, drawn once.
function flareTexture(ring = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, ring ? 40 : 0, 64, 64, 64);
  grd.addColorStop(0, ring ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,1)');
  grd.addColorStop(ring ? 0.6 : 0.2, ring ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
let flareTex = null;

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const blockGeo = new THREE.BoxGeometry(WORLD_GRID, WORLD_GRID, WORLD_GRID);
const blockMats = {};
function blockMat(id) {
  if (!blockMats[id]) {
    const d = BLOCKS[id];
    blockMats[id] = new THREE.MeshStandardMaterial({
      color: d.color, metalness: 0.4, roughness: 0.5, transparent: !!d.transparent, opacity: d.transparent ? 0.45 : 1,
      emissive: d.glow ? d.color : '#000000', emissiveIntensity: d.glow ? 0.9 : 0,
    });
  }
  return blockMats[id];
}

function asteroidGeometry(a) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const r = mulberry32(a.shape);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(k)) cache.set(k, 0.7 + r() * 0.5);
    const s = cache.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.85, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export class SpaceView {
  constructor(state) {
    this.S = state;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 200000);
    this.scene.add(this.camera);
    this.fx = new FX(this.scene);
    this.sectors = new Map();     // key -> { group, asteroids: Map, blocks: Group, planets: [] }
    this.players = new Map();
    this.npcs = new Map();
    this.self = null;
    this.selfRev = -1;
    this.centerKey = null;

    this.sky = nebulaSky();
    this.scene.add(this.sky);
    this.ambient = new THREE.AmbientLight('#8090b0', 0.35);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight('#9fb8ff', '#1a1020', 0.35);
    this.scene.add(this.hemi);

    // Distant starfield that travels with the camera.
    const n = 4000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const r = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(90000);
      pos.set([v.x, v.y, v.z], i * 3);
      const c = new THREE.Color().setHSL(r() < 0.3 ? 0.6 : 0.08, 0.5, 0.6 + r() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starfield = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);

    // Anime twinkles: four-point star sparkles for the brightest stars.
    const sparkle = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(32, 0); g.quadraticCurveTo(35, 29, 64, 32); g.quadraticCurveTo(35, 35, 32, 64); g.quadraticCurveTo(29, 35, 0, 32); g.quadraticCurveTo(29, 29, 32, 0);
      g.fill();
      return new THREE.CanvasTexture(cv);
    })();
    const sp = [], spc = [];
    for (let i = 0; i < 260; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(88000);
      sp.push(v.x, v.y, v.z);
      const c = new THREE.Color().setHSL(r() < 0.5 ? 0.58 : r() < 0.5 ? 0.12 : 0.85, 0.7, 0.85);
      spc.push(c.r, c.g, c.b);
    }
    const sg2 = new THREE.BufferGeometry();
    sg2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg2.setAttribute('color', new THREE.Float32BufferAttribute(spc, 3));
    this.sparkles = new THREE.Points(sg2, new THREE.PointsMaterial({ size: 14, sizeAttenuation: false, map: sparkle, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparkles.frustumCulled = false;
    this.scene.add(this.sparkles);

    // Stars of neighbouring systems, visible as bright points.
    this.farStars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.farStars.frustumCulled = false;
    this.scene.add(this.farStars);

    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    this.beam.visible = false;
    this.scene.add(this.beam);

    this.ghost = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({ color: '#78ffaa', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.buildDist = 80;
    this.camPos = new THREE.Vector3();
    this.camInit = false;
  }

  // ---- sectors --------------------------------------------------------------------------------

  ensureSectors() {
    const me = this.S.me;
    const [sx, sz] = sectorOf(me.x, me.z);
    const ck = sectorKey(sx, sz);
    if (ck === this.centerKey) return;
    this.centerKey = ck;
    const want = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) want.add(sectorKey(sx + dx, sz + dz));
    for (const [k, s] of this.sectors) if (!want.has(k)) { this.disposeSector(s); this.sectors.delete(k); }
    for (const k of want) if (!this.sectors.has(k)) this.sectors.set(k, this.buildSector(...k.split(',').map(Number)));

    const region = generateSector(sx, sz, this.S.seed).region;
    this.baseBg = new THREE.Color().setHSL(region.hue / 360, 0.45, 0.025);
    const u = this.sky.material.uniforms;
    u.colA.value.setHSL(region.hue / 360, 0.65, 0.16 + region.nebula * 0.12);
    u.colB.value.setHSL(((region.hue + 70) % 360) / 360, 0.6, 0.12 + region.density * 0.1);
    u.seed.value = (Math.floor(sx / 12) * 7.31 + Math.floor(sz / 12) * 3.17) % 50;
    this.updateFarStars(sx, sz);
    this.updateEnvironment();
  }

  // Realistic: ships and stations reflect the galaxy around them.
  updateEnvironment() {
    const gfx = this.S.gfx;
    if (!gfx || gfx.anime) { this.scene.environment = null; return; }
    this.sky.material.uniforms.real.value = 1;
    this.envGen ||= new THREE.PMREMGenerator(gfx.renderer);
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    const rt = this.envGen.fromScene(sc, 0.04, 1, 100000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 3;
  }

  updateFarStars(sx, sz) {
    const pos = [], col = [];
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
        const s = generateSector(sx + dx, sz + dz, this.S.seed);
        if (!s.star || s.star.type === 'Black hole') continue;
        pos.push(s.star.x, s.star.y, s.star.z);
        const c = new THREE.Color(s.star.color);
        col.push(c.r, c.g, c.b);
      }
    }
    const g = this.farStars.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  buildSector(sx, sz) {
    const s = generateSector(sx, sz, this.S.seed);
    const group = new THREE.Group();
    const rec = { s, group, asteroids: new Map(), planets: [], blocks: new THREE.Group(), blocksVersion: -1, extra: [] };
    group.add(rec.blocks);

    if (s.star) {
      const st = s.star;
      if (st.type === 'Black hole') {
        const hole = new THREE.Mesh(new THREE.SphereGeometry(st.r, 32, 24), new THREE.MeshBasicMaterial({ color: '#000000' }));
        hole.position.set(st.x, st.y, st.z);
        group.add(hole);
        const disk = new THREE.Mesh(new THREE.RingGeometry(st.r * 1.3, st.r * 3.2, 64), new THREE.MeshBasicMaterial({ color: '#ffaa5a', side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }));
        disk.position.copy(hole.position);
        disk.rotation.x = Math.PI / 2.3;
        group.add(disk);
        rec.extra.push({ spin: disk });
      } else {
        const sun = new THREE.Mesh(new THREE.SphereGeometry(st.r, 32, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(st.color).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.9) }));
        sun.position.set(st.x, st.y, st.z);
        group.add(sun);
        const anime = !!this.S.gfx?.anime;
        const glow = glowSprite(st.color, st.r * (anime ? 4 : 6), anime ? 0.2 : 0.4);
        glow.position.copy(sun.position);
        group.add(glow);
        const light = new THREE.PointLight(st.color, this.S.gfx?.anime === false ? 1.7 : 2.6, 0, 0);
        light.position.copy(sun.position);
        group.add(light);
        const corona = glowSprite(new THREE.Color(st.color).lerp(new THREE.Color('#ffffff'), 0.3), st.r * 1.9, anime ? 0.4 : 0.6);
        corona.position.copy(sun.position);
        group.add(corona);
        if (this.S.gfx?.q.flare) {
          flareTex ||= { core: flareTexture(), ring: flareTexture(true) };
          const flare = new Lensflare();
          flare.addElement(new LensflareElement(flareTex.core, 380, 0, new THREE.Color(st.color)));
          flare.addElement(new LensflareElement(flareTex.ring, 140, 0.4, new THREE.Color(st.color)));
          flare.addElement(new LensflareElement(flareTex.ring, 90, 0.7));
          flare.addElement(new LensflareElement(flareTex.core, 60, 0.95, new THREE.Color(st.color)));
          light.add(flare);
        }
      }
      for (const p of s.planets) {
        const q = this.S.gfx?.q;
        const tex = planetTextures(this.S.gfx.renderer, p, q?.planetTex || 512);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, q && q.planetTex >= 768 ? 96 : 64, q && q.planetTex >= 768 ? 64 : 40),
          new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: p.type === 'Gas' ? null : tex.bump, bumpScale: 4, roughness: p.type === 'Ocean' ? 0.55 : 0.9, metalness: 0.02 }));
        group.add(mesh);
        if (p.ring) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(p.r * 1.4, p.r * 2.2, 64), new THREE.MeshBasicMaterial({ color: '#dcc8a0', side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
          ring.rotation.x = Math.PI / 2.4;
          mesh.add(ring);
        }
        if (p.landable) {
          const atmo = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.07, 48, 32), atmosphereMaterial(p.starter ? '#7fffc0' : p.holy ? '#ffe8a0' : p.type === 'Lava' ? '#ff8a4a' : '#7fb8ff', 1.4));
          mesh.add(atmo);
        } else {
          mesh.add(new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.04, 48, 32), atmosphereMaterial(p.color, 0.7)));
        }
        const lb = label(p.name + (p.landable ? '' : ' (gas giant)'), p.starter ? '#9fffd0' : '#b8c8e0');
        lb.position.y = p.r + 30;
        mesh.add(lb);
        // The orbit path, traced with the same formula the planet follows (orbits are tilted).
        const pts = [];
        for (let k = 0; k < 128; k++) pts.push(new THREE.Vector3(...planetPos({ ...p, phase: (k / 128) * Math.PI * 2, period: 1e12 }, s.star, 0)));
        const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#6a8ac0', transparent: true, opacity: 0.22 }));
        group.add(orbit);
        rec.planets.push({ p, mesh });
      }
    }

    const astMat = {};
    for (const a of s.asteroids) {
      const ore = effectiveOre(a, this.S.effects);
      astMat[ore] ||= realSurface(new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: 0.95, flatShading: true, emissive: ORES[ore].color, emissiveIntensity: realism() ? 0.06 : 0.18 }), { normal: 'rock', scale: 0.9, strength: 1.3, dirt: 0.35, local: true });
      const mesh = new THREE.Mesh(asteroidGeometry(a), astMat[ore]);
      mesh.position.set(a.x, a.y, a.z);
      mesh.scale.setScalar(a.r);
      mesh.userData = { a, rot: new THREE.Vector3(a.spin, a.spin * 0.7, a.spin * 0.3) };
      group.add(mesh);
      rec.asteroids.set(a.id, mesh);
    }

    if (s.station) {
      const st = buildStation(s.station.faction, s.station.capital);
      st.position.set(s.station.x, s.station.y, s.station.z);
      const lb = label(s.station.name, s.station.faction === 'empire' ? '#ffe08a' : s.station.faction === 'rebellion' ? '#ff9a7a' : '#9fd0ff', s.station.capital ? 1.6 : 1.2);
      lb.position.y = s.station.capital ? 260 : 160;
      st.add(lb);
      group.add(st);
      rec.station = st;
      const isGate = s.home || (sx === FAR_REACH[0] && sz === FAR_REACH[1]);
      if (isGate) {
        const gate = new THREE.Group();
        const ringMat = new THREE.MeshStandardMaterial({ color: '#3a2a5a', emissive: '#b86bff', emissiveIntensity: 0.6, metalness: 0.6 });
        gate.add(new THREE.Mesh(new THREE.TorusGeometry(260, 22, 12, 64), ringMat));
        const portal = new THREE.Mesh(new THREE.CircleGeometry(240, 48), new THREE.MeshBasicMaterial({ color: '#7a4aff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        gate.add(portal);
        gate.position.set(s.station.x - 700, s.station.y + 100, s.station.z);
        gate.rotation.y = Math.PI / 2;
        const gl = label('The Ancient Gate', '#d9a8ff', 1.2);
        gl.position.y = 320;
        gate.add(gl);
        group.add(gate);
        rec.gate = gate;
      }
    }

    if (s.wormhole) {
      const wh = s.wormhole;
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(wh.r * (1 - i * 0.15), 4, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.75 + i * 0.03, 0.9, 0.6), transparent: true, opacity: 0.7 - i * 0.1, blending: THREE.AdditiveBlending }));
        g.add(t);
        rec.extra.push({ spin: t, rate: 0.6 + i * 0.3 });
      }
      g.add(glowSprite('#b86bff', wh.r * 3, 0.6));
      const lb = label(`Wormhole → ${wh.tx}, ${wh.tz}`, '#d9a8ff');
      lb.position.y = wh.r + 30;
      g.add(lb);
      g.position.set(wh.x, wh.y, wh.z);
      group.add(g);
    }

    for (const nb of s.nebulae) {
      const sp = glowSprite(new THREE.Color().setHSL(nb.hue / 360, 0.7, 0.5), nb.r * 2.2, nb.a * (this.S.gfx?.anime === false ? 0.05 : 0.8));
      sp.position.set(nb.x, nb.y, nb.z);
      group.add(sp);
    }

    this.scene.add(group);
    return rec;
  }

  disposeSector(rec) {
    this.scene.remove(rec.group);
    rec.group.traverse((o) => {
      if (o.geometry && o.geometry !== blockGeo) o.geometry.dispose();
      if (o.material && !o.material.map?.isCanvasTexture && !Object.values(blockMats).includes(o.material)) o.material.dispose?.();
    });
  }

  rebuildSectors() {
    for (const s of this.sectors.values()) this.disposeSector(s);
    this.sectors.clear();
    this.centerKey = null;
  }

  syncBlocks(rec) {
    const d = this.S.deltas.get(rec.s.key);
    const ver = d ? d.version : 0;
    if (ver === rec.blocksVersion) return;
    rec.blocksVersion = ver;
    rec.blocks.clear();
    if (!d) return;
    for (const [cell, blk] of Object.entries(d.blocks)) {
      if (!BLOCKS[blk.b]) continue;
      const [gx, gy, gz] = cell.split(',').map(Number);
      const m = new THREE.Mesh(blockGeo, blockMat(blk.b));
      m.position.set((gx + 0.5) * WORLD_GRID, (gy + 0.5) * WORLD_GRID, (gz + 0.5) * WORLD_GRID);
      m.userData = { cell, owner: blk.o };
      rec.blocks.add(m);
      if (blk.b === 'beacon') {
        const lb = label(`${blk.o}'s beacon`, '#ff9fc8');
        lb.position.y = WORLD_GRID * 2;
        m.add(lb);
        m.add(glowSprite('#ff5fa2', 60, 0.6));
      }
    }
  }

  astAmount(a) {
    const d = this.S.deltas.get(a.id.split(':')[0]);
    return d && a.id in d.asteroids ? d.asteroids[a.id] : a.amount;
  }

  *nearbyAsteroids() {
    for (const rec of this.sectors.values()) for (const m of rec.asteroids.values()) yield m.userData.a;
  }

  // ---- flight ---------------------------------------------------------------------------------

  fly(dt, input, look) {
    const me = this.S.me, st = this.S.you.stats;
    // Mouse steering, limited by how fast this ship can turn.
    const maxTurn = st.turnRate * dt;
    const yaw = Math.max(-maxTurn, Math.min(maxTurn, -look.x * 0.0022));
    const pitch = Math.max(-maxTurn, Math.min(maxTurn, -look.y * 0.0022));
    const roll = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);
    const q = new THREE.Quaternion(...me.q);
    q.multiply(tmpQ.setFromEuler(new THREE.Euler(pitch, yaw, roll * st.turnRate * dt * 0.8, 'YXZ'))).normalize();
    me.q = [q.x, q.y, q.z, q.w];
    stepShip(me, input, st, dt);
    // Gravity from this system's star (or black hole).
    const star = this.currentStar();
    if (star) {
      const [gx, gy, gz] = gravityAt(star, me.x, me.y, me.z);
      me.vx += gx * dt; me.vy += gy * dt; me.vz += gz * dt;
    }
  }

  currentStar() {
    const me = this.S.me;
    for (const rec of this.sectors.values()) {
      const st = rec.s.star;
      if (st && Math.hypot(st.x - me.x, st.z - me.z) < st.r * 30) return st;
    }
    return null;
  }

  // ---- per-frame ------------------------------------------------------------------------------

  update(dt, t, ctx) {
    const S = this.S, me = S.me;
    this.ensureSectors();
    const eff = S.effects || {};
    const bg = this.baseBg ? this.baseBg.clone() : new THREE.Color('#05060c');
    if (eff.invasion) bg.lerp(new THREE.Color('#2a0508'), 0.5);
    this.scene.background = bg;

    for (const rec of this.sectors.values()) {
      this.syncBlocks(rec);
      for (const { p, mesh } of rec.planets) {
        const [x, y, z] = planetPos(p, rec.s.star, t);
        mesh.position.set(x, y, z);
        mesh.rotation.y = t * 0.02;
      }
      for (const m of rec.asteroids.values()) {
        const a = m.userData.a, amt = this.astAmount(a);
        m.visible = amt > 0;
        if (m.visible) {
          m.scale.setScalar(a.r * (0.35 + 0.65 * Math.sqrt(amt / a.amount)));
          m.rotation.set(m.userData.rot.x * t, m.userData.rot.y * t, m.userData.rot.z * t);
        }
      }
      if (rec.station) rec.station.rotation.y = t * 0.05;
      if (rec.gate) rec.gate.visible = !!eff.gateBuilt;
      for (const e of rec.extra) e.spin.rotation.z = t * (e.rate || 0.2);
    }

    // My ship.
    if (S.you.shipRev !== this.selfRev) {
      if (this.self) this.scene.remove(this.self);
      this.self = buildShip(S.you.ship, S.you.color);
      this.selfRev = S.you.shipRev;
      this.scene.add(this.self);
    }
    this.self.visible = !S.dead;
    this.self.position.set(me.x, me.y, me.z);
    this.self.quaternion.set(...me.q);
    setThrust(this.self, ctx.thrusting, t);

    this.updateOthers(dt, t);
    this.updateNpcs(dt, t);

    // Mining beam.
    const tgt = ctx.mineTarget;
    this.beam.visible = !!tgt && !S.dead;
    if (tgt) {
      const from = new THREE.Vector3(me.x, me.y, me.z), to = new THREE.Vector3(tgt.x, tgt.y, tgt.z);
      this.beam.position.copy(from);
      this.beam.lookAt(to);
      this.beam.scale.set(1 + Math.random() * 0.6, 1 + Math.random() * 0.6, from.distanceTo(to));
      if (Math.random() < 0.3) this.fx.spark(tgt.x + (Math.random() - 0.5) * tgt.r, tgt.y + (Math.random() - 0.5) * tgt.r, tgt.z + (Math.random() - 0.5) * tgt.r, ORES[effectiveOre(tgt, eff)].color, 14);
    }

    // Build ghost.
    this.ghost.visible = ctx.mode === 'build';
    if (this.ghost.visible) {
      const cell = this.buildCell();
      this.ghost.position.set((cell[0] + 0.5) * WORLD_GRID, (cell[1] + 0.5) * WORLD_GRID, (cell[2] + 0.5) * WORLD_GRID);
      this.ghost.material.color.set(BLOCKS[ctx.block].color);
    }

    this.updateCamera(dt);
    this.starfield.position.copy(this.camera.position);
    this.sky.position.copy(this.camera.position);
    const anime = !!this.S.gfx?.anime;
    this.sky.material.uniforms.anime.value = anime ? 1 : 0;
    this.sky.material.uniforms.real.value = anime ? 0 : 1;
    this.sparkles.visible = anime;
    // Space has no air to scatter light: realistic shadows are near black, starlight is harsh.
    this.ambient.intensity = anime ? 0.35 : 0.03;
    this.hemi.intensity = anime ? 0.35 : 0.06;
    this.starfield.material.size = anime ? 1.6 : 1.1;
    if (anime) {
      this.sparkles.position.copy(this.camera.position);
      this.sparkles.material.size = 12 + Math.sin(t * 2.3) * 3;
    }
    this.sky.material.uniforms.bright.value = eff.invasion ? 0.7 : 1;
    if (eff.invasion) this.sky.material.uniforms.colB.value.lerp(new THREE.Color('#5a0a10'), 0.02);
    this.fx.update(dt);
  }

  updateCamera(dt) {
    const me = this.S.me, r = this.S.you.stats.radius;
    const q = new THREE.Quaternion(...me.q);
    const offset = new THREE.Vector3(0, 4 + r * 0.45, 12 + r * 1.9).applyQuaternion(q);
    const target = new THREE.Vector3(me.x, me.y, me.z).add(offset);
    if (!this.camInit) { this.camPos.copy(target); this.camInit = true; }
    this.camPos.lerp(target, Math.min(1, dt * 10));
    // Keep the camera from lagging too far behind fast ships.
    if (this.camPos.distanceTo(target) > r * 4) this.camPos.copy(target);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.slerp(q, Math.min(1, dt * 12));
  }

  snapCamera() { this.camInit = false; }

  updateOthers(dt, t) {
    const seen = new Set();
    for (const o of this.S.others.values()) {
      if (o.mode !== 'space') continue;
      seen.add(o.id);
      let v = this.players.get(o.id);
      const ship = this.S.ships.get(o.key);
      if (!v || v.rev !== o.rev) {
        if (v) this.scene.remove(v.group);
        if (!ship) continue;
        const group = buildShip(ship, o.color);
        const lb = label(o.name + (this.S.isPartyMember(o.key) ? ' ◆' : ''), o.color);
        lb.position.y = 22;
        group.add(lb);
        const bar = healthBar();
        bar.position.y = 16;
        group.add(bar);
        v = { group, rev: o.rev, bar };
        this.players.set(o.id, v);
        this.scene.add(group);
      }
      v.group.position.set(o.x, o.y, o.z);
      v.group.quaternion.set(...o.q);
      setThrust(v.group, o.thrust, t);
      setHealth(v.bar, o.hull / (o.maxHull || 1));
      if (o.mining) {
        const a = [...this.nearbyAsteroids()].find((x) => x.id === o.mining);
        if (a && Math.random() < 0.15) this.fx.spark(a.x, a.y, a.z, o.color, 12);
      }
    }
    for (const [id, v] of this.players) if (!seen.has(id)) { this.scene.remove(v.group); this.players.delete(id); }
  }

  updateNpcs(dt, t) {
    const seen = new Set();
    for (const n of this.S.npcs.values()) {
      seen.add(n.id);
      let v = this.npcs.get(n.id);
      if (!v) {
        const race = n.race ? ALIEN_RACES[n.race] : null;
        const group = buildNpc(n.kind, race);
        const bar = healthBar(n.kind === 'mothership' ? 0.2 : 0.05);
        bar.position.y = n.kind === 'mothership' ? 260 : 20;
        group.add(bar);
        const name = race ? `${race.name} ship` : { pirate: 'Pirate', hollow: 'Hollow', mothership: 'HIVE MOTHERSHIP', imperial: 'Imperial patrol', rebel: 'Rebel raider' }[n.kind];
        const lb = label(name, race ? race.color : { pirate: '#ff8a7a', hollow: '#b0ff6a', mothership: '#d06aff', imperial: '#ffe08a', rebel: '#ff9a7a' }[n.kind], n.kind === 'mothership' ? 1.6 : 0.9);
        lb.position.y = n.kind === 'mothership' ? 300 : 26;
        group.add(lb);
        v = { group, bar };
        this.npcs.set(n.id, v);
        this.scene.add(group);
      }
      v.group.position.set(n.x, n.y, n.z);
      tmpV.set(n.x - n.f[0], n.y - n.f[1], n.z - n.f[2]);
      if (n.kind !== 'mothership') v.group.lookAt(tmpV);
      else v.group.rotation.y = t * 0.03;
      setThrust(v.group, true, t);
      setHealth(v.bar, n.hp / n.maxHp);
      if (v.group.userData.core) v.group.userData.core.material.opacity = 0.4 + Math.sin(t * 2) * 0.2;
    }
    for (const [id, v] of this.npcs) if (!seen.has(id)) { this.scene.remove(v.group); this.npcs.delete(id); }
  }

  // ---- targeting ------------------------------------------------------------------------------

  aimRay() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return { origin: this.camera.position.clone(), dir };
  }

  pickAsteroid(range) {
    const me = this.S.me;
    const { origin, dir } = this.aimRay();
    let best = null, bestScore = Infinity;
    for (const a of this.nearbyAsteroids()) {
      if (this.astAmount(a) <= 0) continue;
      const d = Math.hypot(a.x - me.x, a.y - me.y, a.z - me.z) - a.r;
      if (d > range) continue;
      tmpV.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
      const along = tmpV.dot(dir);
      if (along < 0) continue;
      const off = Math.sqrt(Math.max(0, tmpV.lengthSq() - along * along));
      const ang = Math.atan2(Math.max(0, off - a.r), along);
      if (ang < 0.14 && ang + d * 1e-5 < bestScore) { bestScore = ang + d * 1e-5; best = a; }
    }
    return best;
  }

  nearbyStation() {
    const me = this.S.me;
    for (const rec of this.sectors.values()) {
      const st = rec.s.station;
      if (st && Math.hypot(st.x - me.x, st.y - me.y, st.z - me.z) <= DOCK_RANGE) return st;
    }
    // Docking ports on player-built stations.
    for (const d of this.S.deltas.values()) {
      for (const [cell, blk] of Object.entries(d.blocks || {})) {
        if (blk.b !== 'dock') continue;
        const [x, y, z] = cell.split(',').map((v) => (Number(v) + 0.5) * WORLD_GRID);
        if (Math.hypot(x - me.x, y - me.y, z - me.z) <= DOCK_PORT_RANGE) return { name: `${blk.o}'s station`, x, y, z, player: true };
      }
    }
    return null;
  }

  nearbyPlanet(t) {
    const me = this.S.me;
    for (const rec of this.sectors.values()) {
      for (const { p } of rec.planets) {
        const [x, y, z] = planetPos(p, rec.s.star, t);
        if (Math.hypot(x - me.x, y - me.y, z - me.z) <= p.r + LAND_MARGIN) return p;
      }
    }
    return null;
  }

  nearbyWormhole() {
    const me = this.S.me;
    for (const rec of this.sectors.values()) {
      const wh = rec.s.wormhole;
      if (wh && Math.hypot(wh.x - me.x, wh.y - me.y, wh.z - me.z) < wh.r) return wh;
    }
    return null;
  }

  // Where a structure block would go: against an existing block under the crosshair, or
  // floating ahead of the ship.
  buildCell() {
    const { origin, dir } = this.aimRay();
    const ray = new THREE.Raycaster(origin, dir, 0, 600);
    const targets = [];
    for (const rec of this.sectors.values()) targets.push(...rec.blocks.children);
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) {
      const p = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(WORLD_GRID * 0.5));
      return [Math.floor(p.x / WORLD_GRID), Math.floor(p.y / WORLD_GRID), Math.floor(p.z / WORLD_GRID)];
    }
    const me = this.S.me;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...me.q));
    const p = new THREE.Vector3(me.x, me.y, me.z).addScaledVector(f, this.buildDist + this.S.you.stats.radius);
    return [Math.floor(p.x / WORLD_GRID), Math.floor(p.y / WORLD_GRID), Math.floor(p.z / WORLD_GRID)];
  }

  blockUnderCrosshair() {
    const { origin, dir } = this.aimRay();
    const ray = new THREE.Raycaster(origin, dir, 0, 600);
    const targets = [];
    for (const rec of this.sectors.values()) targets.push(...rec.blocks.children);
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.cell.split(',').map(Number) : null;
  }

  clearEntities() {
    for (const v of this.players.values()) this.scene.remove(v.group);
    for (const v of this.npcs.values()) this.scene.remove(v.group);
    this.players.clear();
    this.npcs.clear();
    this.fx.clear();
  }
}

