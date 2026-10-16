// The 3D planet-surface scene: diggable terrain, liquids, flora, ore deposits, Haven Landing,
// precursor relics, player structures, other pilots, creatures, and parked ships.

import * as THREE from 'three';
import { findPlanet } from '/shared/universe.js';
import {
  CELL, VERTS, SURFACE_HALF, SETTLEMENT, profileOf, vertexHeight, heightAt, standHeight, deposits, floraFor, structuresOf, structureBase,
} from '/shared/planet.js';
import { ORES, BLOCKS, SURFACE_GRID } from '/shared/rules.js';
import { PLAYER_SPEED, RUN_SPEED } from '/shared/items.js';
import { buildShip, buildPerson, buildCreature, buildStructure, label, healthBar, setHealth, glowSprite } from './meshes.js';
import { CREATURES } from '/shared/content/creatures.js';
import { STRUCTURES } from '/shared/content/structures.js';
import { GODS } from '/shared/content/factions.js';
import { FX } from './fx.js';

const HALF_V = (VERTS - 1) / 2;
const blockGeo = new THREE.BoxGeometry(SURFACE_GRID, SURFACE_GRID, SURFACE_GRID);
const blockMats = {};
function blockMat(id) {
  if (!blockMats[id]) {
    const d = BLOCKS[id];
    blockMats[id] = new THREE.MeshStandardMaterial({
      color: d.color, roughness: 0.6, metalness: 0.2, transparent: !!d.transparent, opacity: d.transparent ? 0.5 : 1,
      emissive: d.glow ? d.color : '#000000', emissiveIntensity: d.glow ? 0.8 : 0,
    });
  }
  return blockMats[id];
}

export class SurfaceView {
  constructor(state) {
    this.S = state;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2000);
    this.fx = new FX(this.scene);
    this.planetId = null;
    this.yaw = 0;
    this.pitch = -0.32;
    this.firstPerson = false;
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.others = new Map();
    this.creatures = new Map();
    this.parked = new Map();
  }

  // ---- building the scene -----------------------------------------------------------------

  enter(pid, data) {
    this.leave();
    const planet = findPlanet(pid, this.S.seed);
    this.planet = planet;
    this.planetId = pid;
    this.data = data;   // { digs, blocks, deposits, looted }
    this.looted = new Set(data.looted || []);
    const prof = profileOf(planet);
    const sc = this.scene;
    sc.background = new THREE.Color(prof.sky);
    sc.fog = new THREE.Fog(prof.fog, 120, 650);

    this.root = new THREE.Group();
    sc.add(this.root);
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(200, 300, 120);
    this.root.add(sun);
    this.root.add(new THREE.HemisphereLight(prof.sky, prof.low, 1.1));
    this.root.add(new THREE.AmbientLight('#ffffff', 0.25));
    const sunGlow = glowSprite('#fff8e0', 260, 0.9);
    sunGlow.position.set(800, 900, 500);
    this.root.add(sunGlow);

    this.buildTerrain(prof);
    if (prof.water != null) {
      const liquid = new THREE.Mesh(new THREE.PlaneGeometry(SURFACE_HALF * 2.4, SURFACE_HALF * 2.4).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: prof.liquid, transparent: true, opacity: planet.type === 'Lava' ? 0.95 : 0.72, roughness: 0.15, metalness: 0.1,
          emissive: planet.type === 'Lava' ? prof.liquid : '#000000', emissiveIntensity: planet.type === 'Lava' ? 0.8 : 0 }));
      liquid.position.y = prof.water;
      this.root.add(liquid);
    }
    this.buildFlora(prof);
    this.buildDeposits();
    if (planet.starter) this.buildSettlement();
    this.buildRelic();
    this.buildStructures();
    this.blocks = new THREE.Group();
    this.root.add(this.blocks);
    for (const [cell, blk] of Object.entries(data.blocks)) this.addBlock(cell, blk);

    this.digMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.8, depthTest: false }));
    this.digMarker.renderOrder = 5;
    this.root.add(this.digMarker);
    const me = this.S.you;
    this.selfMesh = buildPerson(me.color, me.armor?.armor || 0);
    this.root.add(this.selfMesh);
    this.vel.set(0, 0, 0);
  }

  leave() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => {
        if (o.geometry && o.geometry !== blockGeo) o.geometry.dispose();
        if (o.material && !Object.values(blockMats).includes(o.material)) o.material.dispose?.();
      });
    }
    this.root = null;
    for (const m of [this.others, this.creatures, this.parked]) m.clear();
    this.fx.clear();
    this.planetId = null;
  }

  buildTerrain(prof) {
    const n = VERTS;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const idx = [];
    this.lowC = new THREE.Color(prof.low); this.midC = new THREE.Color(prof.mid); this.highC = new THREE.Color(prof.high);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = (j * n + i) * 3;
        pos[o] = (i - HALF_V) * CELL; pos[o + 2] = (j - HALF_V) * CELL;
        pos[o + 1] = vertexHeight(this.planet, i - HALF_V, j - HALF_V, this.data.digs);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrainGeo = g;
    for (let k = 0; k < n * n; k++) this.colorVertex(k);
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
    this.root.add(this.terrain);
  }

  colorVertex(k) {
    const g = this.terrainGeo, pos = g.attributes.position, col = g.attributes.color, nrm = g.attributes.normal;
    const h = pos.getY(k);
    const prof = profileOf(this.planet);
    const lo = (prof.water ?? -10) + 1;
    const t = Math.max(0, Math.min(1, (h - lo) / (prof.amp * 0.9)));
    const c = t < 0.5 ? this.lowC.clone().lerp(this.midC, t * 2) : this.midC.clone().lerp(this.highC, (t - 0.5) * 2);
    const slope = nrm ? 1 - nrm.getY(k) : 0;
    c.multiplyScalar(1 - Math.min(0.45, slope * 1.2));
    const ix = (k % VERTS) - HALF_V, iz = Math.floor(k / VERTS) - HALF_V;
    if ((this.data.digs[`${ix},${iz}`] || 0) < -0.5) c.lerp(new THREE.Color('#3a2a1e'), 0.5);
    col.setXYZ(k, c.r, c.g, c.b);
  }

  applyDig(key, d) {
    this.data.digs[key] = d;
    const [ix, iz] = key.split(',').map(Number);
    const i = ix + HALF_V, j = iz + HALF_V;
    if (i < 0 || j < 0 || i >= VERTS || j >= VERTS) return;
    const k = j * VERTS + i;
    this.terrainGeo.attributes.position.setY(k, vertexHeight(this.planet, ix, iz, this.data.digs));
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const kk = (j + dj) * VERTS + (i + di);
      if (kk >= 0 && kk < VERTS * VERTS) this.colorVertex(kk);
    }
    this.terrainGeo.attributes.color.needsUpdate = true;
  }

  buildFlora(prof) {
    const items = [];
    const tiles = Math.ceil(SURFACE_HALF / 40);
    for (let tx = -tiles; tx < tiles; tx++) for (let tz = -tiles; tz < tiles; tz++) items.push(...floraFor(this.planet, tx, tz));
    const place = (geo, mat, list, yOff, sy = 1) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      list.forEach((f, i) => {
        const y = heightAt(this.planet, f.x, f.z, this.data.digs);
        p.set(f.x, y + yOff * f.s, f.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.r);
        s.set(f.s, f.s * sy, f.s);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
      });
      this.root.add(im);
    };
    const water = prof.water ?? -999;
    const dry = items.filter((f) => heightAt(this.planet, f.x, f.z, this.data.digs) > water + 0.5);
    const wet = items.filter((f) => heightAt(this.planet, f.x, f.z, this.data.digs) <= water + 0.5);
    const of = (kind, list = dry) => list.filter((f) => f.kind === kind);
    const M = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, ...opts });
    const trunk = M({ color: '#5a4030', roughness: 1 });
    const leafColor = this.planet.holy ? '#6aaa4a' : this.planet.starter ? '#3aaa6a' : '#2f7a3a';
    place(new THREE.CylinderGeometry(0.25, 0.4, 5, 6), trunk, of('tree'), 2.5);
    place(new THREE.IcosahedronGeometry(2.4, 0), M({ color: leafColor }), of('tree'), 5.8);
    place(new THREE.CylinderGeometry(0.2, 0.3, 7, 6), trunk, of('palm'), 3.5);
    place(new THREE.ConeGeometry(2.6, 1.2, 7), M({ color: '#3a9a4a' }), of('palm'), 7.2);
    place(new THREE.DodecahedronGeometry(1.4, 0), M({ color: prof.mid, roughness: 1 }), of('rock'), 0.6, 0.7);
    place(new THREE.ConeGeometry(0.8, 5, 5), M({ color: '#cfefff', roughness: 0.2, transparent: true, opacity: 0.85 }), of('spike'), 2.4);
    place(new THREE.CylinderGeometry(0.45, 0.5, 3.4, 8), M({ color: '#4a7a3a' }), of('cactus'), 1.7);
    place(new THREE.CylinderGeometry(0.35, 0.5, 4, 8), M({ color: '#d8c8e8' }), of('mushroom'), 2);
    place(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), M({ color: '#9a5ad8', emissive: '#6a2aa8', emissiveIntensity: 0.5 }), of('mushroom'), 3.9);
    place(new THREE.OctahedronGeometry(1, 0).scale(0.6, 2.4, 0.6), M({ color: '#c8b8ff', emissive: '#8a6aff', emissiveIntensity: 0.5, roughness: 0.2, transparent: true, opacity: 0.9 }), of('crystal'), 2.2);
    place(new THREE.TorusGeometry(2.4, 0.25, 6, 12, Math.PI).rotateY(Math.PI / 2), M({ color: '#e8dcc8' }), of('bone'), 0.2);
    place(new THREE.CylinderGeometry(0.08, 0.1, 3, 4), M({ color: '#6a8a3a' }), [...of('reed'), ...of('reed', wet)], 1.3);
    place(new THREE.CylinderGeometry(0.15, 0.35, 5, 5), M({ color: '#3a3430', roughness: 1 }), of('deadtree'), 2.4);
    place(new THREE.IcosahedronGeometry(1.1, 0).scale(1, 1.6, 1), M({ color: '#ff8a9a', emissive: '#a03a5a', emissiveIntensity: 0.3 }), [...of('coral'), ...of('coral', wet)], 0.6);
  }

  // Ruins, shrines, faction bases and wrecks from the content library.
  buildStructures() {
    this.structures = [];
    for (const st of structuresOf(this.planet)) {
      const def = STRUCTURES[st.type];
      const god = st.god ? GODS[st.god] : null;
      const mesh = buildStructure(def, god?.color);
      mesh.position.set(st.x, structureBase(this.planet, st), st.z);
      mesh.rotation.y = st.rot;
      const top = Math.max(...def.parts.map((p) => p[2] + (p[0] === 'box' || p[0] === 'cyl' || p[0] === 'cone' ? (p[5] || 0) / 2 : p[4] || 0)));
      const lb = label(god ? `${def.name}: ${god.name.split(',')[0]}` : def.name, god ? god.color : def.kind === 'imperial' || def.kind === 'holy' ? '#ffe08a' : def.kind === 'rebel' ? '#ff9a7a' : '#d9c8ff', 0.85);
      lb.position.y = top + 4;
      mesh.add(lb);
      this.root.add(mesh);
      this.structures.push({ st, def, mesh });
    }
  }

  buildDeposits() {
    this.depositMeshes = new Map();
    const geo = new THREE.OctahedronGeometry(0.9, 0);
    for (const d of deposits(this.planet)) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: ORES[d.ore].color, emissive: ORES[d.ore].color, emissiveIntensity: 0.6, roughness: 0.3 });
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(geo, mat);
        c.position.set(Math.cos(i * 1.3) * 1.4, 0.6 + (i % 3) * 0.4, Math.sin(i * 1.3) * 1.4);
        c.scale.set(0.8, 1.6 + (i % 2), 0.8);
        c.rotation.z = (i - 2) * 0.2;
        g.add(c);
      }
      g.add(glowSprite(ORES[d.ore].color, 7, 0.5));
      g.position.set(d.x, heightAt(this.planet, d.x, d.z, this.data.digs), d.z);
      this.root.add(g);
      this.depositMeshes.set(d.id, g);
      g.visible = (this.data.deposits[d.id] ?? d.amount) > 0;
    }
  }

  applyDeposit(id, amt) {
    this.data.deposits[id] = amt;
    const g = this.depositMeshes.get(id);
    if (g) g.visible = amt > 0;
  }

  buildSettlement() {
    const ground = (x, z) => heightAt(this.planet, x, z, this.data.digs);
    for (const b of SETTLEMENT.buildings) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0.2 }));
      m.position.set(b.x, ground(b.x, b.z) + b.h / 2, b.z);
      this.root.add(m);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1, 0.6, b.d + 1), new THREE.MeshStandardMaterial({ color: '#4a5a72', metalness: 0.5 }));
      roof.position.set(b.x, ground(b.x, b.z) + b.h + 0.3, b.z);
      this.root.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, 0.8, b.d + 0.1), new THREE.MeshStandardMaterial({ color: '#ffe8a0', emissive: '#ffd060', emissiveIntensity: 0.7 }));
      win.position.set(b.x, ground(b.x, b.z) + b.h * 0.6, b.z);
      this.root.add(win);
      const lb = label(b.name, '#e8f0ff', 0.8);
      lb.position.set(b.x, ground(b.x, b.z) + b.h + 3, b.z);
      this.root.add(lb);
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(SETTLEMENT.pad.r, SETTLEMENT.pad.r, 0.4, 32), new THREE.MeshStandardMaterial({ color: '#3a4252', metalness: 0.6, roughness: 0.4 }));
    pad.position.set(SETTLEMENT.pad.x, ground(SETTLEMENT.pad.x, SETTLEMENT.pad.z) + 0.2, SETTLEMENT.pad.z);
    this.root.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SETTLEMENT.pad.r - 0.5, 0.15, 6, 48), new THREE.MeshBasicMaterial({ color: '#78ffaa' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pad.position).y += 0.25;
    this.root.add(ring);
    for (const npc of [SETTLEMENT.vendor, SETTLEMENT.warden]) {
      const p = buildPerson(npc === SETTLEMENT.vendor ? '#c8a050' : '#5a8ac8', 40);
      p.position.set(npc.x, ground(npc.x, npc.z), npc.z);
      p.lookAt(0, p.position.y, 34);
      const lb = label(npc.name, '#ffe08a', 0.85);
      lb.position.y = 2.4;
      p.add(lb);
      this.root.add(p);
    }
    const tower = SETTLEMENT.buildings.find((b) => b.name === 'Comms Tower');
    this.beaconLight = glowSprite('#ff6a6a', 6, 1);
    this.beaconLight.position.set(tower.x, ground(tower.x, tower.z) + tower.h + 2, tower.z);
    this.root.add(this.beaconLight);
  }

  buildRelic() {
    this.relic = null;
    const site = this.S.story?.relics?.find((r) => r.planet === this.planetId);
    if (!site) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#1a1030', emissive: site.found ? '#4a3a6a' : '#b86bff', emissiveIntensity: site.found ? 0.3 : 0.9, metalness: 0.8, roughness: 0.2 });
    const ob = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), mat);
    ob.position.y = 4.5;
    g.add(ob);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.4 + i * 0.8, 0.12, 6, 32), mat);
      r.position.y = 3 + i * 2.5;
      g.add(r);
      rings.push(r);
    }
    g.add(glowSprite('#b86bff', site.found ? 10 : 30, 0.7));
    const lb = label(site.found ? 'Precursor Relic (awake)' : 'Precursor Relic', '#d9a8ff');
    lb.position.y = 11;
    g.add(lb);
    g.position.set(site.x, heightAt(this.planet, site.x, site.z, this.data.digs), site.z);
    g.userData = { site, rings };
    this.root.add(g);
    this.relic = g;
  }

  addBlock(cell, blk) {
    const [gx, gy, gz] = cell.split(',').map(Number);
    const m = new THREE.Mesh(blockGeo, blockMat(blk.b));
    m.position.set((gx + 0.5) * SURFACE_GRID, (gy + 0.5) * SURFACE_GRID, (gz + 0.5) * SURFACE_GRID);
    m.userData = { cell };
    this.blocks.add(m);
  }

  applyBlock(cell, data) {
    if (data) { this.data.blocks[cell] = data; this.addBlock(cell, data); }
    else {
      delete this.data.blocks[cell];
      const m = this.blocks.children.find((c) => c.userData.cell === cell);
      if (m) this.blocks.remove(m);
    }
  }

  // ---- walking ------------------------------------------------------------------------------

  hasBlock(gx, gy, gz) { return !!this.data.blocks[`${gx},${gy},${gz}`]; }

  // Ground under a point: terrain, liquid, or the top of a player-built block.
  groundAt(x, z, feet) {
    let g = standHeight(this.planet, x, z, this.data.digs);
    const gx = Math.floor(x / SURFACE_GRID), gz = Math.floor(z / SURFACE_GRID);
    const top = Math.floor((feet + 0.7) / SURFACE_GRID);
    for (let gy = top; gy >= top - 30; gy--) {
      if (this.hasBlock(gx, gy, gz)) { g = Math.max(g, (gy + 1) * SURFACE_GRID); break; }
    }
    return g;
  }

  blockedAt(x, z, feet) {
    const gx = Math.floor(x / SURFACE_GRID), gz = Math.floor(z / SURFACE_GRID);
    for (let gy = Math.floor((feet + 0.7) / SURFACE_GRID); gy <= Math.floor((feet + 1.7) / SURFACE_GRID); gy++) if (this.hasBlock(gx, gy, gz)) return true;
    return false;
  }

  walk(dt, input, look) {
    const me = this.S.me;
    this.yaw -= look.x * 0.0025;
    this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - look.y * 0.0025));
    const speed = input.run ? RUN_SPEED : PLAYER_SPEED;
    const f = input.fwd || 0, s = input.strafe || 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * f + cos * s), mz = (-cos * f - sin * s);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const nx = me.x + mx * speed * dt, nz = me.z + mz * speed * dt;
    const lim = SURFACE_HALF - 2;
    if (!this.blockedAt(nx, me.z, me.y) && Math.abs(nx) < lim) me.x = nx;
    if (!this.blockedAt(me.x, nz, me.y) && Math.abs(nz) < lim) me.z = nz;
    const ground = this.groundAt(me.x, me.z, me.y);
    if (input.jump && this.onGround) { this.vel.y = 10.5; this.onGround = false; }
    this.vel.y -= 28 * dt;
    me.y += this.vel.y * dt;
    if (me.y <= ground) { me.y = ground; this.vel.y = 0; this.onGround = true; }
    else if (me.y - ground > 0.15) this.onGround = false;
    // Steep climbs: you can step up gentle slopes but not cliffs.
    me.yaw = this.yaw;
    this.moving = ml > 0.1;
  }

  // ---- per-frame ----------------------------------------------------------------------------

  update(dt, t) {
    const S = this.S, me = S.me;
    if (!this.root) return;
    this.selfMesh.position.set(me.x, me.y, me.z);
    this.selfMesh.rotation.y = this.yaw;
    this.selfMesh.visible = !this.firstPerson && !S.dead;
    if (this.beaconLight) this.beaconLight.material.opacity = 0.5 + 0.5 * Math.sin(t * 3);
    if (this.relic) for (const [i, r] of this.relic.userData.rings.entries()) r.rotation.set(t * (0.5 + i * 0.3), t * 0.4, 0);
    for (const g of this.depositMeshes.values()) g.rotation.y = t * 0.3;

    const target = this.digTarget();
    this.digMarker.visible = !!target && this.S.mode !== 'build';
    if (target) this.digMarker.position.set(target.x, target.y + 0.15, target.z);
    this.updateOthers(t);
    this.updateCreatures(t);
    this.updateParked();
    this.updateCamera();
    this.fx.update(dt);
  }

  updateOthers(t) {
    const seen = new Set();
    for (const o of this.S.others.values()) {
      if (o.mode !== 'surface') continue;
      seen.add(o.id);
      let v = this.others.get(o.id);
      const armorKey = Math.round((o.armor || 0) / 20);
      if (!v || v.armorKey !== armorKey) {
        if (v) this.root.remove(v.group);
        const group = buildPerson(o.color, o.armor);
        const lb = label(o.name + (this.S.isPartyMember(o.key) ? ' ◆' : ''), o.color, 0.8);
        lb.position.y = 2.5;
        group.add(lb);
        const bar = healthBar(0.04);
        bar.position.y = 2.2;
        group.add(bar);
        v = { group, bar, armorKey };
        this.others.set(o.id, v);
        this.root.add(group);
      }
      v.group.position.set(o.x, o.y, o.z);
      v.group.rotation.y = o.yaw;
      v.group.visible = !o.dead;
      setHealth(v.bar, o.hp / (o.maxHp || 100));
    }
    for (const [id, v] of this.others) if (!seen.has(id)) { this.root.remove(v.group); this.others.delete(id); }
  }

  updateCreatures(t) {
    const seen = new Set();
    for (const c of this.S.creatures.values()) {
      seen.add(c.id);
      let v = this.creatures.get(c.id);
      if (!v) {
        const def = CREATURES[c.sp] || CREATURES.rockCrawler;
        const group = buildCreature(def.color, c.size, c.id.length * 31 + c.id.charCodeAt(1), def.shape);
        const tall = def.shape === 'golem' ? 3 : def.shape === 'flyer' ? 2.5 : 2;
        const bar = healthBar(0.035);
        bar.position.y = c.size * tall + 0.6;
        group.add(bar);
        if (def.faction || def.behavior === 'guardian') {
          const lb = label(def.name, def.faction === 'empire' ? '#ffe08a' : def.faction === 'rebellion' ? '#ff9a7a' : '#d9a8ff', 0.7);
          lb.position.y = c.size * tall + 1.2;
          group.add(lb);
        }
        v = { group, bar, phase: Math.random() * 6 };
        this.creatures.set(c.id, v);
        this.root.add(group);
      }
      v.group.position.set(c.x, c.y, c.z);
      v.group.rotation.y = c.yaw + Math.PI;
      setHealth(v.bar, c.hp / c.maxHp);
      v.bar.visible = c.hp < c.maxHp;
      const ud = v.group.userData;
      if (ud.flap) ud.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 10 + v.phase) * 0.6 * (i ? 1 : -1); });
      else if (ud.wiggle) ud.legs.forEach((l, i) => { l.position.x = Math.sin(t * 5 + v.phase + i * 0.9) * 0.3 * c.size; });
      else if (ud.pulse) ud.legs.forEach((l) => { l.scale.y = c.size * 0.8 * (1 + Math.sin(t * 4 + v.phase) * 0.12); });
      else ud.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 8 + v.phase + i * Math.PI) * 0.5; });
    }
    for (const [id, v] of this.creatures) if (!seen.has(id)) { this.root.remove(v.group); this.creatures.delete(id); }
  }

  updateParked() {
    const seen = new Set();
    for (const p of this.S.parked) {
      seen.add(p.key);
      let v = this.parked.get(p.key);
      const ship = this.S.ships.get(p.key);
      if (!ship) continue;
      if (!v || v.rev !== p.rev) {
        if (v) this.root.remove(v.group);
        const group = buildShip(ship, p.key === this.S.you.key ? this.S.you.color : '#c8d0e0');
        group.scale.setScalar(0.55);
        const lb = label(p.key === this.S.you.key ? 'Your ship' : `${p.name}'s ship`, '#9fd0ff', 0.85);
        lb.position.y = 16;
        group.add(lb);
        v = { group, rev: p.rev };
        this.parked.set(p.key, v);
        this.root.add(group);
      }
      v.group.position.set(p.x, heightAt(this.planet, p.x, p.z, this.data.digs) + 3.2, p.z);
    }
    for (const [k, v] of this.parked) if (!seen.has(k)) { this.root.remove(v.group); this.parked.delete(k); }
  }

  updateCamera() {
    const me = this.S.me;
    const eye = new THREE.Vector3(me.x, me.y + 1.65, me.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) {
      this.camera.position.copy(eye);
    } else {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const cam = eye.clone().addScaledVector(dir, -5).addScaledVector(right, 0.9).add(new THREE.Vector3(0, 0.6, 0));
      const g = standHeight(this.planet, cam.x, cam.z, this.data.digs) + 0.4;
      if (cam.y < g) cam.y = g;
      this.camera.position.copy(cam);
    }
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  // Where the crosshair points: first block or terrain hit along the camera ray.
  aim(maxDist = 250) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    const bh = ray.intersectObjects(this.blocks.children, false)[0];
    let tHit = bh ? bh.distance : maxDist;
    let point = null;
    for (let t = 0.5; t < tHit; t += 0.5) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < standHeight(this.planet, x, z, this.data.digs)) { point = new THREE.Vector3(x, y, z); tHit = t; break; }
    }
    if (!point && bh) return { point: bh.point, dir, block: bh };
    return { point: point || origin.clone().addScaledVector(dir, maxDist), dir, terrain: !!point };
  }

  // The patch of ground right mouse would dig, if it's within reach.
  digTarget() {
    const a = this.aim(24);
    if (!a.terrain) return null;
    const me = this.S.me;
    return Math.hypot(a.point.x - me.x, a.point.z - me.z) < 9.5 ? a.point : null;
  }

  shotDir() {
    const me = this.S.me;
    const { point } = this.aim(300);
    return new THREE.Vector3(point.x - me.x, point.y - (me.y + 1.5), point.z - me.z).normalize();
  }

  buildCell() {
    const a = this.aim(14);
    let p;
    if (a.block) p = a.point.clone().add(a.block.face.normal.clone().multiplyScalar(SURFACE_GRID * 0.5));
    else p = a.point.clone().add(new THREE.Vector3(0, SURFACE_GRID * 0.4, 0));
    return [Math.floor(p.x / SURFACE_GRID), Math.floor(p.y / SURFACE_GRID), Math.floor(p.z / SURFACE_GRID)];
  }

  // What the pilot could interact with from where they stand.
  interaction() {
    const me = this.S.me, near = (x, z, r) => Math.hypot(me.x - x, me.z - z) <= r;
    const parked = this.S.you.parked;
    if (this.planet.starter && near(SETTLEMENT.warden.x, SETTLEMENT.warden.z, 7)) return { what: 'warden', text: `E: talk to ${SETTLEMENT.warden.name}` };
    if (this.planet.starter && near(SETTLEMENT.vendor.x, SETTLEMENT.vendor.z, 7)) return { what: 'vendor', text: `E: trade with ${SETTLEMENT.vendor.name}` };
    if (this.relic && near(this.relic.position.x, this.relic.position.z, 7)) return { what: 'relic', text: this.relic.userData.site.found ? 'The relic is awake.' : 'E: awaken the Precursor Relic' };
    if (parked && parked.planet === this.planetId && near(parked.x, parked.z, 14)) return { what: 'ship', text: 'E: board ship and take off · Y: shipyard' };
    for (const { st, def } of this.structures || []) {
      if (!near(st.x, st.z, st.radius + 6)) continue;
      if (def.kind === 'shrine') return { what: 'structure', id: st.id, text: `E: pray to ${GODS[st.god].name}` };
      if (st.type === 'cathedral') return { what: 'structure', id: st.id, text: 'E: enter the Cathedral of the Radiant Throne' };
      if (!def.cache) return { what: 'structure', id: st.id, text: `E: examine the ${def.name}` };
      if (this.looted.has(st.id)) return { what: 'structure', id: st.id, text: `${def.name} (already searched)` };
      return { what: 'structure', id: st.id, text: `E: search the ${def.name}` };
    }
    return null;
  }
}
