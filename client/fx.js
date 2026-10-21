// Short-lived visual effects: blaster bolts, explosions, sparks, gun tracers.

import * as THREE from 'three';
import { glowSprite } from './meshes.js';

const boltGeo = new THREE.CylinderGeometry(1.1, 1.1, 34, 6).rotateX(Math.PI / 2);
const up = new THREE.Vector3(0, 0, 1);
const missileGeo = new THREE.CylinderGeometry(0.9, 0.9, 9, 8).rotateX(Math.PI / 2);
let puffMat = null;
// Soft round smoke for missile trails.
function smokeMat() {
  if (puffMat) return puffMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  puffMat = new THREE.SpriteMaterial({ map: tex, color: '#7a7e88', transparent: true, opacity: 0.35, depthWrite: false });
  return puffMat;
}
let circleTex = null;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.obj);
    this.items = [];
  }

  bolt(b) {
    const mat = new THREE.MeshBasicMaterial({ color: b.c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(boltGeo, mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(b.vx, b.vy, b.vz).normalize());
    const glow = glowSprite(b.c, 30, 0.9);
    mesh.add(glow);
    this.scene.add(mesh);
    this.items.push({ obj: mesh, life: b.l, max: b.l, v: [b.vx, b.vy, b.vz], kind: 'bolt' });
  }

  // A homing missile: a small body with a hot exhaust and a smoke trail. It steers toward
  // wherever where() says its target is, the same way the server's missile does.
  missile(m, where) {
    const body = new THREE.Mesh(missileGeo, new THREE.MeshBasicMaterial({ color: '#e8e4d8' }));
    body.position.set(m.x, m.y, m.z);
    body.add(glowSprite('#ffb050', 14, 1).translateZ(5));
    this.scene.add(body);
    this.items.push({ obj: body, life: 7, max: 7, kind: 'missile', v: [m.vx, m.vy, m.vz], where, target: m.target, smoke: 0 });
  }

  explosion(x, y, z, size, color = '#ffb060') {
    const flash = glowSprite(color, size * 2, 1);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    this.items.push({ obj: flash, life: 0.8, max: 0.8, kind: 'flash', size });
    const n = 50;
    const pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([x, y, z], i * 3);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(size * (1 + Math.random() * 2.5));
      vel.push(v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: Math.max(2, size * 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(pts);
    this.items.push({ obj: pts, life: 1.4, max: 1.4, kind: 'burst', vel });
  }

  spark(x, y, z, color = '#ffe0a0', size = 8) {
    const s = glowSprite(color, size, 1);
    s.position.set(x, y, z);
    this.scene.add(s);
    this.items.push({ obj: s, life: 0.25, max: 0.25, kind: 'flash', size: size / 2 });
  }

  tracer(from, to, color) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.items.push({ obj: line, life: 0.12, max: 0.12, kind: 'line' });
  }

  // A damage number that pops up and floats away: white on enemies, gold for big hits, red on you.
  damage(x, y, z, dmg, { you = false, scale = 1, crit = false } = {}) {
    const big = dmg >= 40 || crit;
    const text = crit ? `${dmg}!` : String(dmg);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.font = `${crit ? 'italic ' : ''}900 ${crit ? 80 : big ? 72 : 60}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(10,12,24,0.9)';
    g.strokeText(text, 128, 50);
    const grad = g.createLinearGradient(0, 18, 0, 82);
    const [top, bot] = you ? ['#ff8a8a', '#e01a2a'] : crit ? ['#ffffff', '#ffcc22'] : big ? ['#fff4b0', '#ffaa20'] : ['#ffffff', '#b8d8ff'];
    grad.addColorStop(0, top); grad.addColorStop(1, bot);
    g.fillStyle = grad;
    g.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    s.renderOrder = 999;
    s.position.set(x + (Math.random() - 0.5) * 0.6 * scale, y + 0.4 * scale, z + (Math.random() - 0.5) * 0.6 * scale);
    this.scene.add(s);
    this.items.push({ obj: s, life: 1.1, max: 1.1, kind: 'number', base: (crit ? 1.6 : big ? 1.25 : 0.95) * scale, rise: 1.6 * scale });
  }

  // Hit sparks: bright streaks flying out from the impact, falling and fading.
  burst(x, y, z, color = '#ffe0a0', size = 1) {
    const n = 18, pos = new Float32Array(n * 6), vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([x, y, z, x, y, z], i * 6);
      vel.push(new THREE.Vector3().randomDirection().multiplyScalar(size * (3 + Math.random() * 5)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.scene.add(lines);
    this.items.push({ obj: lines, life: 0.4, max: 0.4, kind: 'streaks', vel, size });
    this.spark(x, y, z, color, size * 2.2);
  }

  // A glowing beam (a gun or spell) with a bright core, fading fast.
  beam(from, to, color, width = 0.06) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    const grp = new THREE.Group();
    const mk = (r, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    grp.add(mk(width, '#ffffff', 1), mk(width * 3.2, color, 0.45));
    grp.position.copy(a).lerp(b, 0.5);
    grp.lookAt(b);
    this.scene.add(grp);
    this.items.push({ obj: grp, life: 0.16, max: 0.16, kind: 'beam' });
    this.spark(from[0], from[1], from[2], color, width * 22);
  }

  // A glowing magic circle that spins open on the ground and fades.
  circle(x, y, z, color = '#9ad8ff', radius = 2) {
    if (!circleTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      g.translate(256, 256);
      g.strokeStyle = '#ffffff';
      for (const [r, w] of [[240, 6], [222, 3], [160, 4], [100, 3]]) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
      g.lineWidth = 3;
      for (let k = 0; k < 2; k++) {                     // two interlocked triangles: a hexagram
        g.beginPath();
        for (let i = 0; i <= 3; i++) { const a = k * Math.PI / 3 + (i / 3) * Math.PI * 2 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 222, Math.sin(a) * 222); }
        g.stroke();
      }
      g.font = '28px serif'; g.fillStyle = '#ffffff';
      const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
      for (let i = 0; i < 24; i++) { g.save(); g.rotate((i / 24) * Math.PI * 2); g.fillText(runes[i], -9, -184); g.restore(); }
      circleTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: circleTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, y + 0.06, z);
    this.scene.add(m);
    this.items.push({ obj: m, life: 1.3, max: 1.3, kind: 'circle' });
  }

  // A sword's slash: a glowing arc in front of the swordsman (all round for a sword skill),
  // or for Vorpal Strike a streak along the lunge.
  slash(m) {
    if (m.combo === 'vorpal' && m.to) {
      this.beam([m.x, m.y, m.z], m.to, m.c, 0.12);
      this.burst(m.to[0], m.to[1], m.to[2], m.c, 0.8);
      return;
    }
    const skill = m.combo === 3, reach = m.reach || 3;
    const arc = skill ? Math.PI * 2 : 2.3;
    const mid = Math.atan2(-m.dir[1], m.dir[0]);
    const grp = new THREE.Group();
    const ring = (r0, r1, color, o) => new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40, 1, mid - arc / 2, arc).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    grp.add(ring(reach * 0.45, reach, m.c, 0.55), ring(reach * 0.88, reach * 0.97, '#ffffff', 0.9));
    grp.position.set(m.x, m.y, m.z);
    // Alternate swings tilt one way then the other, like real cuts.
    grp.rotation.z = skill ? 0 : (m.combo % 2 ? 0.25 : -0.25);
    this.scene.add(grp);
    this.items.push({ obj: grp, life: skill ? 0.45 : 0.24, max: skill ? 0.45 : 0.24, kind: 'slash', skill });
    if (skill) this.circle(m.x, m.y - 1.05, m.z, m.c, reach * 1.1);
  }

  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      if (it.kind === 'missile') {
        const v = it.v, sp = Math.hypot(...v) || 1, speed = Math.min(1500, sp + 900 * dt);
        let d = [v[0] / sp, v[1] / sp, v[2] / sp];
        const t = it.where(it.target), pos = it.obj.position;
        if (t) {
          const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z, dl = Math.hypot(dx, dy, dz) || 1;
          if (dl < (t.r || 12)) it.life = 0;
          const k = Math.min(1, 2.6 * dt);
          d = [d[0] + (dx / dl - d[0]) * k, d[1] + (dy / dl - d[1]) * k, d[2] + (dz / dl - d[2]) * k];
          const l = Math.hypot(...d) || 1;
          d = [d[0] / l, d[1] / l, d[2] / l];
        }
        it.v = [d[0] * speed, d[1] * speed, d[2] * speed];
        pos.x += it.v[0] * dt; pos.y += it.v[1] * dt; pos.z += it.v[2] * dt;
        it.obj.quaternion.setFromUnitVectors(up, new THREE.Vector3(...d).negate());
        // Smoke puffs that linger and fade behind it.
        it.smoke += dt;
        while (it.smoke > 0.05) {
          it.smoke -= 0.05;
          const puff = new THREE.Sprite(smokeMat().clone());
          puff.position.copy(pos);
          puff.scale.setScalar(3);
          this.scene.add(puff);
          this.items.push({ obj: puff, life: 0.9, max: 0.9, kind: 'puff' });
        }
      } else if (it.kind === 'puff') {
        it.obj.material.opacity = 0.35 * k;
        it.obj.scale.setScalar(3 + (1 - k) * 9);
      } else if (it.kind === 'bolt') {
        it.obj.position.x += it.v[0] * dt; it.obj.position.y += it.v[1] * dt; it.obj.position.z += it.v[2] * dt;
      } else if (it.kind === 'flash') {
        it.obj.material.opacity = k;
        const s = it.size * (2 + (1 - k) * 2);
        it.obj.scale.set(s, s, 1);
      } else if (it.kind === 'burst') {
        const p = it.obj.geometry.attributes.position;
        for (let i = 0; i < it.vel.length; i++) {
          p.setXYZ(i, p.getX(i) + it.vel[i].x * dt, p.getY(i) + it.vel[i].y * dt, p.getZ(i) + it.vel[i].z * dt);
        }
        p.needsUpdate = true;
        it.obj.material.opacity = k;
      } else if (it.kind === 'line') {
        it.obj.material.opacity = k;
      } else if (it.kind === 'number') {
        const age = 1 - k, pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.7 : 1.3 - Math.min(0.3, (age - 0.12) * 1.5);
        it.obj.scale.set(it.base * pop * 2.4, it.base * pop * 0.9, 1);
        it.obj.position.y += it.rise * dt * (1.2 - age);
        it.obj.material.opacity = Math.min(1, k * 3);
      } else if (it.kind === 'streaks') {
        const p = it.obj.geometry.attributes.position;
        for (let i = 0; i < it.vel.length; i++) {
          const v = it.vel[i];
          v.y -= 9 * dt * it.size;
          const hx = p.getX(i * 2) + v.x * dt, hy = p.getY(i * 2) + v.y * dt, hz = p.getZ(i * 2) + v.z * dt;
          p.setXYZ(i * 2, hx, hy, hz);
          p.setXYZ(i * 2 + 1, hx - v.x * 0.03, hy - v.y * 0.03, hz - v.z * 0.03);
        }
        p.needsUpdate = true;
        it.obj.material.opacity = k;
      } else if (it.kind === 'slash') {
        const age = 1 - k;
        const sc = 0.75 + age * (it.skill ? 0.6 : 0.35);
        it.obj.scale.set(sc, 1, sc);
        if (it.skill) it.obj.rotation.y += dt * 9;
        it.obj.children.forEach((c, i) => { c.material.opacity = k * (i ? 0.9 : 0.55); });
      } else if (it.kind === 'beam') {
        it.obj.children.forEach((c, i) => { c.material.opacity = k * (i ? 0.45 : 1); });
      } else if (it.kind === 'circle') {
        const age = 1 - k;
        it.obj.rotation.y += dt * 1.6;
        const s = Math.min(1, age * 5);
        it.obj.scale.set(s, 1, s);
        it.obj.material.opacity = Math.min(1, k * 2.5);
      }
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.kind === 'burst' || it.kind === 'line' || it.kind === 'streaks' || it.kind === 'circle') it.obj.geometry.dispose();
        if (it.kind === 'beam' || it.kind === 'slash') it.obj.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
        else { it.obj.material.map?.isCanvasTexture && it.kind === 'number' && it.obj.material.map.dispose(); it.obj.material.dispose(); }
      }
    }
    this.items = this.items.filter((it) => it.life > 0);
  }
}
