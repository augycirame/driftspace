// Shipyard: a 3D block editor for your ship. Click a face to add the selected part,
// right-click to remove, drag to orbit. Saving charges (or refunds) the ore difference.

import * as THREE from 'three';
import { SHIP_PARTS, SHIP_PART_IDS, SHIP_BLOCK, SHIP_BOUNDS, SHIP_MAX_BLOCKS, SHIP_CLASSES, ORES, shipStats, validateShip } from '/shared/rules.js';
import { buildShip } from './meshes.js';

const $ = (id) => document.getElementById(id);

export class Shipyard {
  constructor(state, send) {
    this.S = state;
    this.send = send;
    this.part = 'hull';
    this.open = false;
  }

  init() {
    if (this.renderer) return;
    const canvas = $('yard-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0f1c');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 500);
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.6));
    const d = new THREE.DirectionalLight('#ffffff', 2);
    d.position.set(30, 50, 20);
    this.scene.add(d);
    const grid = new THREE.GridHelper(SHIP_BLOCK * 14, 14, '#2a3a5a', '#1a2440');
    grid.position.y = -SHIP_BLOCK * (SHIP_BOUNDS.y + 0.5);
    this.scene.add(grid);
    const bounds = new THREE.Box3Helper(new THREE.Box3(
      new THREE.Vector3(-(SHIP_BOUNDS.x + 0.5) * SHIP_BLOCK, -(SHIP_BOUNDS.y + 0.5) * SHIP_BLOCK, -(SHIP_BOUNDS.z + 0.5) * SHIP_BLOCK),
      new THREE.Vector3((SHIP_BOUNDS.x + 0.5) * SHIP_BLOCK, (SHIP_BOUNDS.y + 0.5) * SHIP_BLOCK, (SHIP_BOUNDS.z + 0.5) * SHIP_BLOCK)), '#33415f');
    this.scene.add(bounds);
    const front = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#78ffaa' }));
    front.position.z = -(SHIP_BOUNDS.z + 2) * SHIP_BLOCK;
    this.scene.add(front);
    this.pickGroup = new THREE.Group();
    this.scene.add(this.pickGroup);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(SHIP_BLOCK, SHIP_BLOCK, SHIP_BLOCK), new THREE.MeshBasicMaterial({ color: '#78ffaa', transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.ghost);
    this.orbit = { yaw: 0.8, pitch: 0.5, dist: 70 };

    let down = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button, moved: false }; });
    addEventListener('mouseup', (e) => {
      if (!down || !this.open) return;
      if (!down.moved && e.target === canvas) this.click(e, down.b);
      down = null;
    });
    canvas.addEventListener('mousemove', (e) => {
      this.mouse = e;
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4)) {
        down.moved = true;
        this.orbit.yaw -= e.movementX * 0.01;
        this.orbit.pitch = Math.max(-1.3, Math.min(1.3, this.orbit.pitch + e.movementY * 0.01));
      }
    });
    canvas.addEventListener('wheel', (e) => { this.orbit.dist = Math.max(25, Math.min(160, this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: true });
    $('yard-save').onclick = () => this.save();
    $('yard-cancel').onclick = () => this.close();
    $('yard-reset').onclick = () => { this.draft = this.S.you.ship.map((b) => [...b]); this.refresh(); };
  }

  show() {
    this.init();
    this.open = true;
    this.draft = this.S.you.ship.map((b) => [...b]);
    $('yard').hidden = false;
    this.resize();
    this.refresh();
    const loop = () => {
      if (!this.open) return;
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  close() {
    this.open = false;
    $('yard').hidden = true;
  }

  resize() {
    const c = $('yard-canvas');
    const w = c.clientWidth, h = c.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  refresh() {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = buildShip(this.draft, this.S.you.color);
    this.scene.add(this.mesh);
    this.pickGroup.clear();
    const geo = new THREE.BoxGeometry(SHIP_BLOCK, SHIP_BLOCK, SHIP_BLOCK);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    for (const b of this.draft) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(b[0] * SHIP_BLOCK, b[1] * SHIP_BLOCK, b[2] * SHIP_BLOCK);
      m.userData.b = b;
      this.pickGroup.add(m);
    }
    this.renderPanel();
  }

  cost() {
    const count = (list) => list.reduce((m, b) => { m[b[3]] = (m[b[3]] || 0) + 1; return m; }, {});
    const before = count(this.S.you.ship), after = count(this.draft);
    const need = {};
    for (const t of SHIP_PART_IDS) {
      const d = (after[t] || 0) - (before[t] || 0);
      for (const [ore, v] of Object.entries(SHIP_PARTS[t].cost)) need[ore] = (need[ore] || 0) + d * v;
    }
    return need;
  }

  renderPanel() {
    const pal = $('yard-parts');
    pal.innerHTML = '';
    for (const id of SHIP_PART_IDS) {
      const d = SHIP_PARTS[id];
      if (d.unique) continue;
      const el = document.createElement('button');
      el.className = 'part' + (id === this.part ? ' sel' : '');
      const cost = Object.entries(d.cost).map(([k, v]) => `${v} ${ORES[k].name}`).join(', ');
      const what = d.thrust ? `+${d.thrust} thrust` : d.cargo ? `+${d.cargo} cargo` : d.gun ? 'fires bolts' : d.missile ? 'homing missiles (T lock, F fire)' : d.shield ? `+${d.shield} shield` : d.turn ? 'better turning' : `${d.hp} hull`;
      el.innerHTML = `<i style="background:${d.color}"></i><b>${d.name}</b><span>${what} · mass ${d.mass}</span><span class="dim">${cost}</span>`;
      el.onclick = () => { this.part = id; this.renderPanel(); };
      pal.appendChild(el);
    }
    const st = shipStats(this.draft, this.S.you.upg, this.S.effects), cur = this.S.you.stats;
    const row = (name, a, b, fmt = (v) => Math.round(v)) => {
      const cls = b > a ? 'up' : b < a ? 'down' : '';
      return `<tr><td>${name}</td><td>${fmt(a)}</td><td class="${cls}">${fmt(b)}</td></tr>`;
    };
    const err = validateShip(this.draft);
    const need = this.cost();
    const short = Object.entries(need).filter(([k, v]) => v > (this.S.you.cargo[k] || 0));
    const costTxt = Object.entries(need).filter(([, v]) => v !== 0).map(([k, v]) => `${v > 0 ? '−' : '+'}${Math.abs(v)} ${ORES[k].name}`).join(', ') || 'no change';
    $('yard-info').innerHTML =
      `<table><tr><th></th><th>Now</th><th>New</th></tr>` +
      `<tr><td>Class</td><td>${SHIP_CLASSES[cur.cls].name}</td><td>${SHIP_CLASSES[st.cls].name}</td></tr>` +
      row('Blocks', this.S.you.ship.length, this.draft.length) +
      row('Hull', cur.hp, st.hp) + row('Shield', cur.shield, st.shield) + row('Top speed', cur.maxSpeed, st.maxSpeed) +
      row('Acceleration', cur.accel, st.accel) + row('Turning', cur.turnRate * 100, st.turnRate * 100) +
      row('Cargo', cur.cargo, st.cargo) + row('Guns', cur.guns, st.guns) + row('Missile racks', cur.missiles, st.missiles) + `</table>` +
      `<p>Cost: ${costTxt}</p>` +
      (err ? `<p class="error">${err}</p>` : '') +
      (short.length ? `<p class="error">Not enough ${short.map(([k]) => ORES[k].name).join(', ')} in your hold.</p>` : '') +
      `<p class="small dim">${this.draft.length}/${SHIP_MAX_BLOCKS} blocks. Click a block face to add, right-click to remove, drag to orbit.</p>`;
    $('yard-save').disabled = !!err || short.length > 0;
  }

  pick(e) {
    const r = $('yard-canvas').getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObjects(this.pickGroup.children, false)[0];
  }

  click(e, button) {
    const hit = this.pick(e);
    if (!hit) return;
    const b = hit.object.userData.b;
    if (button === 2) {
      if (b[3] === 'cockpit') return;
      this.draft = this.draft.filter((x) => x !== b);
    } else {
      const n = hit.face.normal;
      const p = [b[0] + Math.round(n.x), b[1] + Math.round(n.y), b[2] + Math.round(n.z)];
      if (Math.abs(p[0]) > SHIP_BOUNDS.x || Math.abs(p[1]) > SHIP_BOUNDS.y || Math.abs(p[2]) > SHIP_BOUNDS.z) return;
      if (this.draft.some((x) => x[0] === p[0] && x[1] === p[1] && x[2] === p[2])) return;
      if (this.draft.length >= SHIP_MAX_BLOCKS) return;
      this.draft.push([...p, this.part]);
    }
    this.refresh();
  }

  save() {
    this.send({ t: 'ship_save', blocks: this.draft });
  }

  frame() {
    const o = this.orbit;
    this.camera.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    this.camera.lookAt(0, 0, 0);
    this.ghost.visible = false;
    if (this.mouse) {
      const hit = this.pick(this.mouse);
      if (hit) {
        const b = hit.object.userData.b, n = hit.face.normal;
        this.ghost.position.set((b[0] + n.x) * SHIP_BLOCK, (b[1] + n.y) * SHIP_BLOCK, (b[2] + n.z) * SHIP_BLOCK);
        this.ghost.material.color.set(SHIP_PARTS[this.part].color);
        this.ghost.visible = true;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
