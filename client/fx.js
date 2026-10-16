// Short-lived visual effects: blaster bolts, explosions, sparks, gun tracers.

import * as THREE from 'three';
import { glowSprite } from './meshes.js';

const boltGeo = new THREE.CylinderGeometry(1.1, 1.1, 34, 6).rotateX(Math.PI / 2);
const up = new THREE.Vector3(0, 0, 1);

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

  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      if (it.kind === 'bolt') {
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
      }
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.kind === 'burst' || it.kind === 'line') it.obj.geometry.dispose();
        it.obj.material.dispose();
      }
    }
    this.items = this.items.filter((it) => it.life > 0);
  }
}
