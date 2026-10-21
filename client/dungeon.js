// The 3D dungeon scene: walls and floors from the shared generator, themed lighting,
// treasure chests, the exit portal, monsters and party members.

import * as THREE from 'three';
import { generateDungeon, canStand, isFloor, DCELL, WALL_H } from '/shared/dungeon.js';
import { DUNGEON_THEMES } from '/shared/content/dungeons.js';
import { CREATURES } from '/shared/content/creatures.js';
import { PLAYER_SPEED, RUN_SPEED } from '/shared/items.js';
import { mergeBoxes, buildPerson, buildCreature, label, healthBar, setHealth, glowSprite } from './meshes.js';
import { FX } from './fx.js';
import { mulberry32 } from '/shared/rng.js';

export class DungeonView {
  constructor(state) {
    this.S = state;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400);
    this.fx = new FX(this.scene);
    this.yaw = 0;
    this.pitch = -0.2;
    this.firstPerson = false;
    this.vel = 0;
    this.onGround = true;
    this.key = null;
    this.others = new Map();
    this.creatures = new Map();
  }

  enter(msg) {
    this.leave();
    this.key = msg.key;
    this.msg = msg;
    const theme = DUNGEON_THEMES[msg.theme];
    this.theme = theme;
    const d = generateDungeon(msg.theme, msg.seed, msg.depth);
    this.layout = d;
    this.opened = new Set(msg.opened);
    this.bossDead = msg.bossDead;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(theme.fog);
    this.scene.fog = new THREE.Fog(theme.fog, 8, 70);
    this.root.add(new THREE.AmbientLight('#ffffff', 0.55));
    this.root.add(new THREE.HemisphereLight(theme.light, '#000000', 0.5));

    // Floors and walls, merged into two meshes.
    const rng = mulberry32(msg.seed);
    const floor = [], walls = [];
    const fc = new THREE.Color(theme.floor).lerp(new THREE.Color(theme.wall), 0.45).multiplyScalar(1.4), wc = new THREE.Color(theme.wall);
    for (let j = 0; j < d.H; j++) {
      for (let i = 0; i < d.W; i++) {
        const x = (i + 0.5) * DCELL, z = (j + 0.5) * DCELL;
        if (d.cells[j * d.W + i]) {
          floor.push([x, -0.2, z, DCELL, 0.4, DCELL, fc.clone().multiplyScalar(0.85 + rng() * 0.3)]);
          continue;
        }
        let edge = false;
        for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) if (d.cells[(j + dj) * d.W + i + di]) { edge = true; break; }
        if (edge) walls.push([x, WALL_H / 2, z, DCELL, WALL_H + rng() * 0.6, DCELL, wc.clone().multiplyScalar(0.75 + rng() * 0.4)]);
      }
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    mat.userData.stone = 0.9;
    this.root.add(new THREE.Mesh(mergeBoxes(floor), mat));
    this.root.add(new THREE.Mesh(mergeBoxes(walls), mat));
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(d.W * DCELL, d.H * DCELL).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 1 }));
    ceil.position.set((d.W * DCELL) / 2, WALL_H, (d.H * DCELL) / 2);
    this.root.add(ceil);

    // A light in every room, torches along the walls.
    d.rooms.forEach((r, i) => {
      const cx = (r.x + r.w / 2) * DCELL, cz = (r.y + r.h / 2) * DCELL;
      const boss = i === d.bossRoom;
      const light = new THREE.PointLight(boss ? '#ff5a4a' : theme.light, boss ? 4 : 3, Math.max(r.w, r.h) * DCELL * 1.8, 1);
      light.position.set(cx, WALL_H - 1.2, cz);
      this.root.add(light);
      const glow = glowSprite(boss ? '#ff5a4a' : theme.light, 3, 0.9);
      glow.position.copy(light.position);
      this.root.add(glow);
      this.torches ||= [];
      for (const [tx, tz] of [[r.x, r.y], [r.x + r.w - 1, r.y + r.h - 1]]) {
        const torch = glowSprite(theme.light, 1.6, 1);
        this.torches.push(torch);
        torch.position.set((tx + 0.5) * DCELL, 3.2, (tz + 0.5) * DCELL);
        this.root.add(torch);
      }
    });

    // Chests.
    this.chests = new Map();
    for (const c of d.chests) {
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: c.boss ? '#5a3a8a' : '#6a4a2a', roughness: 0.8 });
      const metal = new THREE.MeshStandardMaterial({ color: '#e8c547', metalness: 0.8, roughness: 0.3, emissive: '#6a5010', emissiveIntensity: 0.3 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), wood);
      base.position.y = 0.45;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 1.1), metal);
      lid.position.y = 1.05;
      g.add(base, lid);
      const sparkle = glowSprite(c.boss ? '#c27bff' : '#ffe08a', c.boss ? 4 : 2.5, 0.8);
      sparkle.position.y = 1.3;
      g.add(sparkle);
      g.position.set(c.x, 0, c.z);
      g.userData = { lid, sparkle, chest: c };
      this.root.add(g);
      this.chests.set(c.id, g);
      if (this.opened.has(c.id)) this.markOpened(c.id);
    }

    // The way out.
    const portal = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.12, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#78ffaa' }));
    portal.add(ring);
    const beam = glowSprite('#78ffaa', 4, 0.5);
    beam.position.y = 0.6;
    portal.add(beam);
    const pl = label('Exit to surface', '#78ffaa', 0.8);
    pl.position.y = 2.6;
    portal.add(pl);
    portal.position.set(d.start[0], 0.05, d.start[1]);
    this.portal = portal;
    this.root.add(portal);

    const me = this.S.you;
    this.selfMesh = buildPerson(me.color, me.armor?.armor || 0);
    this.root.add(this.selfMesh);
  }

  leave() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { o.geometry?.dispose?.(); if (o.material && !o.material.map) o.material.dispose?.(); });
    }
    this.root = null;
    this.torches = [];
    this.key = null;
    this.others.clear();
    this.creatures.clear();
    this.fx.clear();
  }

  markOpened(id) {
    this.opened.add(id);
    const g = this.chests.get(id);
    if (!g) return;
    g.userData.lid.rotation.x = -1.1;
    g.userData.lid.position.set(0, 1.25, -0.45);
    g.userData.sparkle.visible = false;
  }

  walk(dt, input, look) {
    const me = this.S.me, d = this.layout;
    this.yaw -= look.x * 0.0025;
    this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - look.y * 0.0025));
    const speed = input.run ? RUN_SPEED : PLAYER_SPEED;
    const f = input.fwd || 0, s = input.strafe || 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = -sin * f + cos * s, mz = -cos * f - sin * s;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const nx = me.x + mx * speed * dt, nz = me.z + mz * speed * dt;
    if (canStand(d, nx, me.z)) me.x = nx;
    if (canStand(d, me.x, nz)) me.z = nz;
    if (input.jump && this.onGround) { this.vel = 9; this.onGround = false; }
    this.vel -= 28 * dt;
    me.y += this.vel * dt;
    if (me.y <= 0) { me.y = 0; this.vel = 0; this.onGround = true; }
    me.yaw = this.yaw;
  }

  update(dt, t) {
    if (!this.root) return;
    const S = this.S, me = S.me;
    if (this.selfMesh) {
      this.selfMesh.position.set(me.x, me.y, me.z);
      this.selfMesh.rotation.y = this.yaw;
      this.selfMesh.visible = !this.firstPerson && !S.dead;
    }
    this.portal.rotation.y = t;
    // Torches flicker.
    (this.torches || []).forEach((tc, i) => { const k = 1.4 + Math.sin(t * 9 + i * 1.7) * 0.15 + Math.sin(t * 23 + i) * 0.1; tc.scale.set(k, k, 1); });
    for (const g of this.chests.values()) if (g.userData.sparkle.visible) g.userData.sparkle.material.opacity = 0.5 + 0.4 * Math.sin(t * 3);
    this.updateCreatures(t);
    this.updateOthers();
    this.updateCamera();
    this.fx.update(dt);
  }

  updateCreatures(t) {
    const seen = new Set();
    for (const c of this.S.creatures.values()) {
      seen.add(c.id);
      let v = this.creatures.get(c.id);
      if (!v) {
        const def = CREATURES[c.sp] || CREATURES.cryptGhoul;
        const group = buildCreature(def.color, c.size, c.id.length * 17 + c.id.charCodeAt(1), def.shape, def);
        const tall = def.shape === 'golem' ? 3 : def.shape === 'strider' ? 4.6 : 2.2;
        const bar = healthBar(c.boss ? 0.12 : 0.035);
        bar.position.y = c.size * tall + 0.5;
        group.add(bar);
        if (c.boss) {
          const lb = label(c.name || def.name, c.name ? '#ffb0a0' : '#ff8a7a', c.name ? 1.4 : 1.1);
          lb.position.y = c.size * tall + 1.4;
          group.add(lb);
          group.add(glowSprite('#ff5a4a', c.size * 5, 0.25));
        }
        v = { group, bar, phase: Math.random() * 6 };
        this.creatures.set(c.id, v);
        this.root.add(group);
      }
      v.group.position.set(c.x, 0, c.z);
      v.group.rotation.y = c.yaw + Math.PI;
      setHealth(v.bar, c.hp / c.maxHp);
      const ud = v.group.userData;
      (ud.legs || []).forEach((l, i) => { l.rotation.x = Math.sin(t * 8 + v.phase + i * Math.PI) * 0.4; });
    }
    for (const [id, v] of this.creatures) if (!seen.has(id)) { this.root.remove(v.group); this.creatures.delete(id); }
  }

  updateOthers() {
    const seen = new Set();
    for (const o of this.S.others.values()) {
      if (o.mode !== 'dungeon') continue;
      seen.add(o.id);
      let v = this.others.get(o.id);
      if (!v) {
        const group = buildPerson(o.color, o.armor);
        const lb = label(o.name + ' ◆', o.color, 0.8);
        lb.position.y = 2.5;
        group.add(lb);
        v = { group };
        this.others.set(o.id, v);
        this.root.add(group);
      }
      v.group.position.set(o.x, o.y, o.z);
      v.group.rotation.y = o.yaw;
      v.group.visible = !o.dead;
    }
    for (const [id, v] of this.others) if (!seen.has(id)) { this.root.remove(v.group); this.others.delete(id); }
  }

  updateCamera() {
    const me = this.S.me, d = this.layout;
    const eye = new THREE.Vector3(me.x, me.y + 1.65, me.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) this.camera.position.copy(eye);
    else {
      // Pull the camera in so it never ends up inside a wall.
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      let dist = 4.5;
      for (; dist > 0.6; dist -= 0.25) {
        const p = eye.clone().addScaledVector(dir, -dist).addScaledVector(right, 0.7);
        if (canStand(d, p.x, p.z, 0.3) && p.y < WALL_H - 0.3 && p.y > 0.3) break;
      }
      this.camera.position.copy(eye).addScaledVector(dir, -dist).addScaledVector(right, 0.7 * Math.min(1, dist / 4.5));
    }
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  // Where the crosshair points: the first wall, floor or ceiling along the camera ray.
  aimPoint(maxDist = 120) {
    const o = this.camera.position, dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    for (let t = 0.5; t < maxDist; t += 0.4) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y < 0 || y > WALL_H || !isFloor(this.layout, x, z)) return new THREE.Vector3(x, y, z);
    }
    return o.clone().addScaledVector(dir, maxDist);
  }

  shotDir() {
    const me = this.S.me, p = this.aimPoint();
    return new THREE.Vector3(p.x - me.x, p.y - (me.y + 1.5), p.z - me.z).normalize();
  }

  interaction() {
    const me = this.S.me, d = this.layout;
    const near = (x, z, r) => Math.hypot(me.x - x, me.z - z) <= r;
    if (near(d.start[0], d.start[1], 5)) return { what: 'exit', text: this.msg?.floor ? 'E: leave the Spire' : 'E: climb back to the surface' };
    for (const c of d.chests) {
      if (!near(c.x, c.z, 3)) continue;
      if (this.opened.has(c.id)) return { what: 'chest', id: c.id, text: 'Empty chest' };
      if (c.boss && !this.bossDead) return { what: 'chest', id: c.id, text: 'Sealed. Defeat the master of this place first.' };
      return { what: 'chest', id: c.id, text: c.boss ? 'E: open the treasure vault' : 'E: open chest' };
    }
    return null;
  }
}
