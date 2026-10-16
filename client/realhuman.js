// Realistic people. A sculpted head (skull, jaw, brow, cheekbones, nose and lips) with glossy
// eyes, lids, brows and strand-textured hair; an anatomically proportioned body lofted from
// cross-sections, jointed at the hips, knees, shoulders and elbows so it can walk; and real
// clothes: a pilot's flight suit with harness, belt, pouches, gloves, boots, knee pads, a patch
// and a comms headset, or a native's tunic, robe, cloak and the gear of their role.
//
// Takes the same options as buildHuman in meshes.js. Faces -z; the feet stand at y = 0.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { realSurface } from './realism.js';

const cache = new Map();
const cached = (key, make) => { let v = cache.get(key); if (!v) { v = make(); cache.set(key, v); } return v; };
const G = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- geometry -----------------------------------------------------------------------------------------

// A loft along y through cross-sections [y, halfWidth, frontDepth, backDepth, centerZ], smoothed
// between them; superellipse rings (round = 2 is an ellipse). Open arcs make capes and plates.
function loft(sections, { segs = 32, sub = 3, round = 2.2, arc = null, capTop = false, capBottom = false } = {}) {
  sections = sections.map(([y, w, df, db, cz = 0]) => [y, w, df, db, cz]);
  const rows = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const p0 = sections[Math.max(0, s - 1)], p1 = sections[s], p2 = sections[s + 1], p3 = sections[Math.min(sections.length - 1, s + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      rows.push(p1.map((_, i) => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)));
    }
  }
  rows.push(sections[sections.length - 1]);
  const closed = !arc;
  const [a0, a1] = arc || [0, Math.PI * 2];
  const ring = closed ? segs : segs + 1;
  const pos = [], idx = [];
  for (const [y, w, df, db, cz = 0] of rows) {
    for (let k = 0; k < ring; k++) {
      const a = a0 + (a1 - a0) * (k / segs);
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / round) * w;
      const zz = Math.sign(s) * Math.pow(Math.abs(s), 2 / round);
      pos.push(x, y, cz + (zz < 0 ? zz * df : zz * db));
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < (closed ? ring : ring - 1); k++) {
      const a = r * ring + k, b = r * ring + ((k + 1) % ring), c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (r, up) => {
    const [y, , , , cz = 0] = rows[r];
    const center = pos.length / 3;
    pos.push(0, y, cz);
    for (let k = 0; k < ring - (closed ? 0 : 1); k++) {
      const a = r * ring + k, b = r * ring + ((k + 1) % ring);
      if (up) idx.push(a, center, b); else idx.push(a, b, center);
    }
  };
  if (closed && capTop) cap(rows.length - 1, true);
  if (closed && capBottom) cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A limb hanging down from its joint: profile [[t 0..1 from the joint, radius, depthScale]].
function limb(len, prof, key) {
  return cached('limb' + key, () => {
    const r0 = prof[0][1], r1 = prof[prof.length - 1][1];
    const secs = [[-len - r1 * 0.75, r1 * 0.25, r1 * 0.25, r1 * 0.25], [-len - r1 * 0.45, r1 * 0.8, r1 * 0.8, r1 * 0.8]];
    for (let i = prof.length - 1; i >= 0; i--) { const [t, r, d = 1, cz = 0] = prof[i]; secs.push([-t * len, r, r * d, r * d, cz]); }
    secs.push([r0 * 0.45, r0 * 0.8, r0 * 0.8, r0 * 0.8], [r0 * 0.75, r0 * 0.25, r0 * 0.25, r0 * 0.25]);
    return loft(secs, { segs: 20, sub: 2, round: 2, capTop: true, capBottom: true });
  });
}

// The head, sculpted from a sphere. Unit-sphere coordinates: x right, y up, front is -z.
function headGeometry(female) {
  return cached('head' + female, () => {
    const g = new THREE.SphereGeometry(1, 128, 96).rotateY(Math.PI / 2);   // seam to the back
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i);
      let { x, y, z } = v;
      const f = Math.max(0, -z), ax = Math.abs(x);
      // The lower face is squarer than a sphere: keep the jaw wide down to a flatter chin.
      if (v.y < 0) {
        const pw = female ? 2.5 : 2.9, r0 = Math.sqrt(Math.max(1e-6, 1 - v.y * v.y)), r1 = Math.pow(1 - Math.pow(-v.y, pw), 1 / pw);
        const k = lerp(1, r1 / r0, smooth(0.25, -0.2, v.z) * 0.85);
        v.x *= Math.min(k, 1.6); if (v.z < 0) v.z *= Math.min(lerp(1, k, 0.6), 1.4);
        if (v.y < -0.75) v.y = -0.75 + (v.y + 0.75) * 0.7;
      }
      let d = 0;
      // Proportions follow a real head: eyes halfway down, nose base at two thirds, mouth just below.
      d += 0.07 * Math.max(0, z) * Math.max(0, y + 0.3);                          // fuller crown behind
      d -= 0.04 * smooth(0.62, 1, ax) * smooth(-0.3, 0.3, y) * (1 - smooth(-0.2, 0.4, z)); // temples
      d += (female ? 0.015 : 0.035) * G(ax, y, 0.3, 0.17, 0.32, 0.06) * f;        // brow ridge
      d -= 0.1 * G(ax, y, 0.36, 0.03, 0.15, 0.1) * f;                             // eye sockets
      d += 0.04 * G(ax, y, 0.52, -0.17, 0.2, 0.12) * f;                           // cheekbones
      d += 0.03 * G(ax, y, 0.38, -0.42, 0.2, 0.16) * f;                           // cheeks
      d += 0.075 * G(x, y, 0, -0.08, 0.06, 0.17) * f;                             // bridge of the nose
      d += (female ? 0.11 : 0.14) * G(x, y, 0, -0.27, 0.075, 0.075) * f;          // tip of the nose
      d += 0.045 * G(ax, y, 0.1, -0.31, 0.06, 0.05) * f;                          // nostril wings
      d -= 0.025 * G(x, y, 0, -0.42, 0.05, 0.03) * f;                             // groove above the lip
      d += 0.05 * G(x, y, 0, -0.47, 0.18, 0.04) * f;                              // upper lip
      d += 0.058 * G(x, y, 0, -0.58, 0.16, 0.045) * f;                            // lower lip
      d -= 0.03 * G(x, y, 0, -0.525, 0.2, 0.012) * f;                             // mouth line
      d -= 0.025 * G(ax, y, 0.2, -0.525, 0.03, 0.03) * f;                         // corners of the mouth
      d -= 0.02 * G(x, y, 0, -0.68, 0.14, 0.035) * f;                             // under the lip
      d += (female ? 0.04 : 0.07) * G(x, y, 0, -0.84, 0.24, 0.1) * f;             // chin
      v.multiplyScalar(1 + d);
      // The jaw: square for men, softer for women, narrowing only below the mouth.
      if (v.y < -0.3) {
        const k = -0.3 - v.y;
        v.x *= 1 - k * k * (female ? 0.75 : 0.5);
        if (v.z > 0) v.z *= 1 - k * 0.7;
      }
      if (v.y < 0 && v.z > 0) v.z *= 1 - (-v.y) * 0.25;
      p.setXYZ(i, v.x * 0.074, v.y * 0.112, v.z * 0.098);
      // Color: lips, a touch of rose on the cheeks and nose, slightly darker around the eyes.
      const lips = Math.min(1, (G(x, y, 0, -0.47, 0.16, 0.035) + G(x, y, 0, -0.58, 0.15, 0.04)) * f * 1.6);
      const rose = (G(ax, y, 0.5, -0.25, 0.2, 0.15) * 0.5 + G(x, y, 0, -0.3, 0.08, 0.08) * 0.4) * f;
      // Baked occlusion: eye corners, nostrils, the mouth line, under the nose and the chin.
      const shade = Math.min(1, G(ax, y, 0.36, 0.03, 0.16, 0.12) * f * 0.8 + G(ax, y, 0.2, 0.0, 0.05, 0.06) * f + G(x, y, 0, -0.525, 0.19, 0.012) * f * 1.8
        + G(ax, y, 0.07, -0.355, 0.035, 0.022) * f * 2.2 + G(x, y, 0, -0.4, 0.1, 0.03) * f * 0.5 + smooth(-0.75, -0.95, y) * 0.5);
      let r = 1, gg = 1, b = 1;
      r *= 1 - lips * 0.12; gg *= 1 - lips * 0.48; b *= 1 - lips * 0.4;
      gg *= 1 - rose * 0.12; b *= 1 - rose * 0.1;
      r *= 1 - shade * 0.4; gg *= 1 - shade * 0.48; b *= 1 - shade * 0.45;
      col.set([r, gg, b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
}

// Hair (or a beard) grown from the head: the same sphere, kept where the mask says, pushed out.
function hairGeometry(female, kind) {
  return cached(`hair${female}${kind}`, () => {
    const head = headGeometry(female);
    const g = head.clone();
    g.deleteAttribute('color');
    const p = g.attributes.position, nrm = g.attributes.normal, unit = new THREE.SphereGeometry(1, 128, 96).rotateY(Math.PI / 2).attributes.position;
    const keep = new Uint8Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = unit.getX(i), y = unit.getY(i), z = unit.getZ(i), f = -z, ax = Math.abs(x);
      let m, push;
      if (kind === 'beard') {
        const mouth = G(x, y, 0, -0.53, 0.24, 0.1) + G(x, y, 0, -0.3, 0.12, 0.12);
        m = smooth(-0.1, -0.3, y) * smooth(-0.3, 0.1, f) * (1 - smooth(0.25, 0.55, mouth));
        push = 0.004 + 0.008 * smooth(-0.4, -1, y);
      } else {
        // Hairline: high on the forehead with a little widow's peak, above the ears, low at the nape.
        const line = lerp(female ? -0.85 : -0.55, female ? 0.6 : 0.64, smooth(-0.3, 0.75, f)) - 0.05 * G(x, 0, 0, 0, 0.12, 1) * smooth(0.5, 0.9, f);
        const ear = G(ax, y, 0.95, -0.08, 0.22, 0.3) * smooth(0.3, -0.2, z) * (female ? 0 : 1);
        m = smooth(line - 0.1, line + 0.1, y) * (1 - smooth(0.3, 0.7, ear));
        push = (female ? 0.012 : 0.007) + 0.008 * smooth(0, 1, y) + (female ? 0.01 : 0.004) * Math.max(0, z);
      }
      keep[i] = m > 0.01 ? 1 : 0;
      // Where there is no hair, sink the surface just under the skin so the hairline is a clean curve.
      const k = m * push - (1 - m) * 0.006;
      p.setXYZ(i, p.getX(i) + nrm.getX(i) * k, p.getY(i) + nrm.getY(i) * k, p.getZ(i) + nrm.getZ(i) * k);
    }
    const idx = g.index.array, out = [];
    for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] || keep[idx[t + 1]] || keep[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
    g.setIndex(out);
    g.computeVertexNormals();
    return g;
  });
}

// A flat strap following a path of points, as wide as given, facing out along 'out' at each point.
function ribbon(points, width, outs) {
  const pos = [], idx = [];
  const side = new THREE.Vector3(), dir = new THREE.Vector3();
  points.forEach((p, i) => {
    dir.subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    side.crossVectors(dir, outs[i]).normalize().multiplyScalar(width / 2);
    pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Merge the meshes hanging off each joint by material, so a person is a few dozen draw calls.
function mergeParts(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh) groups.push(o); });
  for (const grp of groups) {
    const byMat = new Map();
    for (const m of grp.children) if (m.isMesh && !m.children.length) { if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(m); }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const names = list.map((m) => Object.keys(m.geometry.attributes));
      const common = names[0].filter((n) => names.every((ns) => ns.includes(n)));
      if ((mat.map || mat.normalMap) && !common.includes('uv')) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
        for (const n of Object.keys(g.attributes)) if (!common.includes(n)) g.deleteAttribute(n);
        g.morphAttributes = {};
        return g;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const m of list) grp.remove(m);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      grp.add(mesh);
    }
  }
}

// ---- textures -------------------------------------------------------------------------------------------

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Strands of hair as a normal map: fine streaks running from the crown down.
const hairNormal = () => cached('hairN', () => { const t = hairNormalTex(); t.repeat.set(3, 1); return t; });
const hairNormalTex = () => canvasTex(256, 256, (x, w, h) => {
  const img = x.createImageData(w, h);
  const line = new Float32Array(w);
  const raw = Array.from({ length: w }, (_, i) => Math.sin(i * 0.9) * 0.15 + Math.sin(i * 2.7 + 1) * 0.12 + (Math.random() - 0.5) * 0.5);
  for (let i = 0; i < w; i++) line[i] = (raw[(i + w - 1) % w] + raw[i] * 2 + raw[(i + 1) % w]) / 4;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const o = (yy * w + xx) * 4;
    const dx = (line[(xx + 1) % w] - line[(xx + w - 1) % w]) * 0.8;
    img.data[o] = (0.5 - dx * 0.5) * 255; img.data[o + 1] = 128; img.data[o + 2] = 235; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}, false);

// An eye on an equirectangular map, the iris facing -z: fibered iris, dark limbal ring, pupil.
const eyeTex = (iris) => cached('eye' + iris, () => canvasTex(256, 128, (x, w, h) => {
  x.fillStyle = '#ece6de'; x.fillRect(0, 0, w, h);
  const g0 = x.createRadialGradient(192, 64, 20, 192, 64, 70);
  g0.addColorStop(0, 'rgba(255,255,255,0)'); g0.addColorStop(1, 'rgba(210,150,140,0.5)');
  x.fillStyle = g0; x.fillRect(0, 0, w, h);
  const c = new THREE.Color(iris);
  const ring = x.createRadialGradient(192, 64, 4, 192, 64, 22);
  ring.addColorStop(0, `#${c.clone().multiplyScalar(0.5).getHexString()}`);
  ring.addColorStop(0.45, `#${c.getHexString()}`);
  ring.addColorStop(0.85, `#${c.clone().multiplyScalar(0.7).getHexString()}`);
  ring.addColorStop(1, '#151214');
  x.fillStyle = ring; x.beginPath(); x.ellipse(192, 64, 22, 22, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = `rgba(255,255,255,0.18)`;
  for (let i = 0; i < 70; i++) { const a = (i / 70) * Math.PI * 2; x.beginPath(); x.moveTo(192 + Math.cos(a) * 9, 64 + Math.sin(a) * 9); x.lineTo(192 + Math.cos(a) * 20, 64 + Math.sin(a) * 20); x.stroke(); }
  x.fillStyle = '#0a0808'; x.beginPath(); x.ellipse(192, 64, 8.5, 8.5, 0, 0, Math.PI * 2); x.fill();
}));

// Skin lets light in: soften the shadow edge with a warm, reddish wrap (a cheap subsurface look).
function subsurface(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'vec3 irradiance = dotNL * directLight.color;',
      `float nlRaw = dot( geometryNormal, directLight.direction );
      vec3 irradiance = ( saturate( ( nlRaw + 0.4 ) / 1.4 ) * vec3( 1.0, 0.78, 0.7 ) * ( 1.0 - dotNL ) + dotNL ) * directLight.color;`));
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => key() + '-sss';
  mat.needsUpdate = true;
  return mat;
}

// ---- materials ------------------------------------------------------------------------------------------

function materials(o) {
  const skinC = new THREE.Color(o.skin);
  const fabric = (c, k = {}) => realSurface(new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.92, sheen: 0.12, sheenRoughness: 0.9, sheenColor: new THREE.Color(c), ...k }), { normal: 'fabric', scale: 16, strength: 0.45, dirt: 0.1, local: true });
  const leather = (c) => realSurface(new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 }), { normal: 'leather', scale: 9, strength: 0.9, dirt: 0.2, local: true });
  const metal = (c, rough = 0.3) => realSurface(new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: 1 }), { normal: 'scratched', scale: 8, strength: 0.5, dirt: 0.1, local: true });
  return {
    skin: subsurface(realSurface(new THREE.MeshPhysicalMaterial({
      color: skinC, vertexColors: true, roughness: 0.5, sheen: 0.35, sheenRoughness: 0.5,
      sheenColor: skinC.clone().lerp(new THREE.Color('#ff8a70'), 0.5), specularIntensity: 0.6,
    }), { normal: 'fine', scale: 55, strength: 0.07, dirt: 0.03, roughVar: 0.4, local: true })),
    skinPlain: subsurface(realSurface(new THREE.MeshPhysicalMaterial({ color: skinC, roughness: 0.5, sheen: 0.35, sheenRoughness: 0.5, sheenColor: skinC.clone().lerp(new THREE.Color('#ff8a70'), 0.5), specularIntensity: 0.6 }), { normal: 'fine', scale: 55, strength: 0.07, dirt: 0.03, local: true })),
    hair: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(o.hair).multiplyScalar(0.85), roughness: 0.45, normalMap: hairNormal(), normalScale: new THREE.Vector2(0.8, 0.8),
      sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(o.hair).lerp(new THREE.Color('#ffffff'), 0.3),
    }),
    eye: new THREE.MeshPhysicalMaterial({ map: eyeTex(o.eyes), roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    fabric, leather, metal,
  };
}

// ---- the person -------------------------------------------------------------------------------------------

// Torso cross-sections (y above the hip joints, half width, front depth, back depth, center z).
const TORSO = {
  male: [[-0.12, 0.02, 0.02, 0.02], [-0.1, 0.1, 0.07, 0.075], [-0.05, 0.158, 0.09, 0.11], [0.03, 0.172, 0.095, 0.112], [0.11, 0.158, 0.09, 0.095],
    [0.2, 0.15, 0.092, 0.088], [0.28, 0.158, 0.1, 0.092], [0.36, 0.172, 0.112, 0.098], [0.43, 0.184, 0.11, 0.1], [0.49, 0.182, 0.096, 0.096],
    [0.53, 0.16, 0.078, 0.082], [0.565, 0.09, 0.062, 0.066], [0.59, 0.056, 0.052, 0.052]],
  female: [[-0.12, 0.02, 0.02, 0.02], [-0.1, 0.11, 0.07, 0.08], [-0.05, 0.172, 0.088, 0.118], [0.03, 0.18, 0.09, 0.115], [0.11, 0.152, 0.082, 0.09],
    [0.2, 0.128, 0.08, 0.08], [0.27, 0.138, 0.09, 0.084], [0.34, 0.15, 0.13, 0.09], [0.41, 0.158, 0.12, 0.09], [0.47, 0.16, 0.088, 0.088],
    [0.515, 0.148, 0.072, 0.076], [0.555, 0.085, 0.058, 0.06], [0.58, 0.05, 0.048, 0.048]],
};
const frontAt = (tbl, y) => {
  for (let i = 0; i < tbl.length - 1; i++) if (y <= tbl[i + 1][0]) { const t = (y - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]); return [lerp(tbl[i][1], tbl[i + 1][1], t), lerp(tbl[i][2], tbl[i + 1][2], t), lerp(tbl[i][3], tbl[i + 1][3], t)]; }
  return tbl[tbl.length - 1].slice(1, 4);
};
const band = (tbl, y0, y1, by) => [y0, (y0 + y1) / 2, y1].map((y) => { const [w, df, db] = frontAt(tbl, y); return [y, w + by, df + by, db + by]; });
const grow = (tbl, by, y0 = -1, y1 = 9) => tbl.filter((s) => s[0] >= y0 && s[0] <= y1).map(([y, w, df, db, cz = 0]) => [y, w + by, df + by, db + by, cz]);

// Where the rifle sits (relative to the hips), and the arm angles that put the right hand on its
// grip and the left on its handguard: a small search, done once per shoulder width.
const RIFLE = [0.09, 0.28, -0.24], RIFLE_PITCH = -0.18;
function holdPose(sh) {
  return cached('hold' + sh, () => {
    const e = new THREE.Euler(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3();
    const palm = (sx, ax, az, bx) => {
      q1.setFromEuler(e.set(ax, 0, az));
      q2.copy(q1).multiply(new THREE.Quaternion().setFromEuler(e.set(bx, 0, 0)));
      const elbow = new THREE.Vector3(0, -0.29, 0).applyQuaternion(q1);
      return v.set(0, -0.295, 0).applyQuaternion(q2).add(elbow).add(new THREE.Vector3(sx * sh, 0.5, 0.004));
    };
    const solve = (sx, target) => {
      let best = [0, 0, 0], bd = 1e9;
      const tryAt = (ax, az, bx) => { const d = palm(sx, ax, az, bx).distanceTo(target) + Math.abs(az) * 0.01; if (d < bd) { bd = d; best = [ax, az, bx]; } };
      for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) for (let k = 0; k <= 14; k++) tryAt(-0.2 + i * 0.13, -1 + j * (2 / 14), k * 0.17);
      for (let step = 0.06; step > 0.004; step /= 2) {
        const [a, b, c] = best;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) tryAt(a + i * step, b + j * step, c + k * step);
      }
      return best;
    };
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyEuler(new THREE.Euler(RIFLE_PITCH, 0, 0)).add(new THREE.Vector3(...RIFLE));
    const grip = at(0.035, -0.075, 0.05), guard = at(-0.035, -0.035, -0.24);
    return [solve(1, grip), solve(-1, guard)];
  });
}

export function buildRealHuman(opts) {
  const o = { armor: 0, female: false, ears: false, beard: false, height: 1, width: 1, gun: true, ...opts };
  const female = !!o.female, sex = female ? 'female' : 'male';
  const M = materials(o);
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(o.width, o.height, o.width);
  g.add(body);
  const HIP = 0.93;
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP;
  body.add(pelvis);
  const put = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const rbox = (w, h, d, r = 0.3) => cached(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * r));
  const pilot = !!o.pilot;
  const top = M.fabric(o.tunic), pantsM = M.fabric(o.pants || '#3a3236'), bootM = M.leather(o.boots || '#3a2e26');
  const webbing = M.fabric(o.webbing || '#2a2a26', { sheen: 0.3 }), buckle = M.metal('#9aa0a6', 0.35), dark = M.metal('#2a2c30', 0.5);
  const T = TORSO[sex];

  // Torso and neck.
  put(pelvis, cached('torso' + sex, () => loft(T, { round: 2.3 })), top);
  put(pelvis, cached('neck' + sex, () => loft([[0.5, 0.062, 0.058, 0.06], [0.6, 0.057, 0.052, 0.058, 0.004], [0.68, 0.053, 0.048, 0.055, 0.01], [0.74, 0.045, 0.04, 0.045, 0.014]], { round: 2 })), M.skinPlain);
  // Hips/trousers seat so the legs blend into the body.
  put(pelvis, cached('seat' + sex, () => loft(grow(T, 0.004, -0.13, 0.12), { round: 2.3 })), pantsM);

  // Head.
  const head = new THREE.Group();
  head.position.set(0, 0.745, -0.012);
  pelvis.add(head);
  put(head, headGeometry(female), M.skin);
  const browM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(o.hair).multiplyScalar(0.45), roughness: 0.85 });
  for (const sx of [-1, 1]) {
    // Eyes, lids and brows.
    const eye = new THREE.Group();
    eye.position.set(sx * 0.0305, 0.002, -0.0755);
    eye.rotation.y = sx * 0.06;
    head.add(eye);
    put(eye, cached('eyeball', () => new THREE.SphereGeometry(0.0118, 24, 16)), M.eye);
    put(eye, cached('lidU', () => new THREE.SphereGeometry(0.0128, 20, 10, Math.PI * 0.05, Math.PI * 0.9, 0, Math.PI * 0.42).rotateY(Math.PI)), M.skinPlain, 0, 0, 0, -0.06);
    put(eye, cached('lidL', () => new THREE.SphereGeometry(0.0125, 20, 8, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.66, Math.PI * 0.34).rotateY(Math.PI)), M.skinPlain, 0, 0, 0, 0);
    put(head, cached('brow' + female, () => new THREE.CapsuleGeometry(1, 2.6, 4, 10).rotateZ(Math.PI / 2).scale(0.0095, female ? 0.0018 : 0.0026, 0.001)), browM, sx * 0.031, 0.0185, -0.087, 0.3, -sx * 0.32, sx * (female ? -0.16 : -0.06));
    // Ears (pointed for elves).
    if (o.ears) put(head, cached('elfEar', () => new THREE.ConeGeometry(0.014, 0.075, 10).scale(1, 1, 0.45)), M.skinPlain, sx * 0.074, 0.03, 0.012, -0.5, 0, -sx * 0.55);
    else {
      put(head, cached('ear', () => new THREE.SphereGeometry(1, 18, 14).scale(0.008, 0.029, 0.018)), M.skinPlain, sx * 0.07, -0.006, 0.014, 0, sx * 0.35, 0);
      put(head, cached('earLobe', () => new THREE.SphereGeometry(0.008, 12, 10)), M.skinPlain, sx * 0.071, -0.03, 0.01);
    }
  }
  // Hair, and a beard for some men.
  if (!o.helmet || o.crown) put(head, hairGeometry(female, 'hair'), M.hair);
  if (female && !o.helmet) {
    // Hair gathered into a bun at the back.
    put(head, cached('bun', () => new THREE.SphereGeometry(0.038, 18, 14).scale(1, 0.9, 0.85)), M.hair, 0, -0.012, 0.1);
  }
  if (o.beard) {
    put(head, hairGeometry(false, 'beard'), M.hair);
    if (o.beard === 'long') put(head, cached('longBeard', () => new THREE.ConeGeometry(0.055, 0.2, 14).rotateX(Math.PI).scale(1, 1, 0.6)), M.hair, 0, -0.18, -0.06, 0.25);
  }

  // Arms: shoulder -> elbow -> wrist, each a group so they can swing and bend.
  const arms = [], forearms = [];
  const sh = female ? 0.162 : 0.182;
  for (const sx of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(sx * sh, 0.5, 0.004);
    pelvis.add(upper);
    put(upper, limb(0.29, [[0, female ? 0.047 : 0.055], [0.3, female ? 0.042 : 0.05, 1.05], [0.62, female ? 0.037 : 0.044, 0.95], [1, female ? 0.032 : 0.037]], 'ua' + sex), o.robe ? top : top);
    const fore = new THREE.Group();
    fore.position.y = -0.29;
    upper.add(fore);
    const sleeve = pilot || o.robe;
    put(fore, limb(0.25, [[0, female ? 0.032 : 0.037], [0.25, female ? 0.033 : 0.039, 0.9], [0.7, female ? 0.026 : 0.03, 0.8], [1, female ? 0.022 : 0.026, 0.75]], 'fa' + sex), sleeve ? top : M.skinPlain);
    // Hands: gloved for pilots and soldiers, bare otherwise.
    const handM = pilot || o.helmet ? M.leather('#24221f') : M.skinPlain;
    const hand = new THREE.Group();
    hand.position.y = -0.26;
    fore.add(hand);
    put(hand, rbox(0.03, 0.085, 0.075, 0.35), handM, 0, -0.035, 0);
    for (let k = 0; k < 4; k++) put(hand, limb(0.07, [[0, 0.0095], [1, 0.0075]], 'finger'), handM, sx * 0.0, -0.075, -0.026 + k * 0.017, 0.35 + k * 0.08, 0, 0);
    put(hand, limb(0.05, [[0, 0.011], [1, 0.0085]], 'thumb'), handM, -sx * 0.012, -0.03, -0.034, 0.9, 0, sx * 0.4);
    if (sleeve) put(fore, cached('cuff' + sex, () => new THREE.CylinderGeometry(female ? 0.028 : 0.032, female ? 0.028 : 0.032, 0.035, 16)), pilot ? webbing : top, 0, -0.235, 0);
    arms.push(upper);
    forearms.push(fore);
  }
  const hands = forearms.map((f) => f.children.find((c) => c.isGroup));

  // Legs: hip -> knee -> ankle.
  const thighs = [], shins = [];
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Group();
    thigh.position.set(sx * (female ? 0.095 : 0.09), -0.02, 0);
    pelvis.add(thigh);
    put(thigh, limb(0.44, [[0, female ? 0.085 : 0.082], [0.18, female ? 0.088 : 0.085], [0.55, female ? 0.07 : 0.072, 1.05], [0.88, 0.055], [1, 0.05]], 'th' + sex), pantsM);
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    thigh.add(shin);
    put(shin, limb(0.42, [[0, 0.05], [0.22, 0.055, 1.1, 0.008], [0.55, 0.046], [0.85, 0.035], [1, 0.034]], 'sh' + sex), pantsM);
    // Boots: a shaft up the calf, the foot and a thick sole.
    put(shin, cached('bootShaft', () => loft([[-0.43, 0.045, 0.05, 0.05], [-0.3, 0.046, 0.046, 0.052], [-0.2, 0.05, 0.05, 0.056]], { round: 2, capTop: false })), bootM);
    put(shin, cached('bootTop', () => new THREE.TorusGeometry(0.05, 0.007, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.08)), bootM, 0, -0.2, 0.002);
    put(shin, rbox(0.095, 0.075, 0.22, 0.4), bootM, 0, -0.455, -0.05);
    put(shin, rbox(0.1, 0.07, 0.11, 0.45), bootM, 0, -0.45, -0.13, 0.2);
    put(shin, rbox(0.104, 0.022, 0.27, 0.3), dark, 0, -0.5, -0.06);
    thighs.push(thigh);
    shins.push(shin);
    if (pilot) {
      // Knee pads and a thigh cargo pocket.
      put(shin, rbox(0.085, 0.1, 0.03, 0.4), dark, 0, -0.03, -0.055, -0.1);
      put(thigh, rbox(0.04, 0.12, 0.1, 0.3), pantsM, sx * 0.058, -0.22, 0);
      put(thigh, rbox(0.042, 0.03, 0.102, 0.35), pantsM, sx * 0.059, -0.16, 0);
    }
  }

  // Clothing over the torso.
  // A strap over the chest (dir -1) or back (dir 1) from the belt up over the shoulder.
  const strap = (x0, dir, inset = 0.006) => cached(`strap${sex}${x0}${dir}`, () => {
    const pts = [], outs = [];
    for (let y = 0.1; y <= 0.535; y += 0.012) {
      const [w, df, db] = frontAt(T, y);
      const x = x0 * (y > 0.44 ? lerp(1, 0.8, (y - 0.44) / 0.1) : 1);
      const k = Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.abs(x / w), 2.3)));
      const z = dir < 0 ? -df * k - inset : db * k + inset;
      pts.push(new THREE.Vector3(x, y, z));
      outs.push(new THREE.Vector3(x / w * 0.3, 0, dir).normalize());
    }
    // Over the top of the shoulder to join the other side.
    const [w2, df2, db2] = frontAt(T, 0.545);
    for (let i = 1; i <= 6; i++) {
      const a = (i / 6) * Math.PI / 2;
      pts.push(new THREE.Vector3(x0 * 0.8, 0.545 + Math.sin(a) * 0.012, (dir < 0 ? -df2 : db2) * Math.cos(a)));
      outs.push(new THREE.Vector3(0, Math.sin(a), dir * Math.cos(a)).normalize());
    }
    return ribbon(pts, 0.036, outs);
  });
  const zipper = cached('zip' + sex, () => {
    const pts = [], outs = [];
    for (let y = 0.1; y <= 0.6; y += 0.01) { const [, df] = y < 0.585 ? frontAt(T, y) : [0, 0.055]; pts.push(new THREE.Vector3(0, y, -df - 0.0025)); outs.push(new THREE.Vector3(0, 0, -1)); }
    return ribbon(pts, 0.008, outs);
  });
  if (pilot) {
    // Flight suit: collar, zipper, harness with a chest buckle, belt with pouches, a patch.
    put(pelvis, cached('collar' + sex, () => loft([[0.55, 0.075, 0.068, 0.07], [0.6, 0.064, 0.06, 0.064, 0.004], [0.625, 0.061, 0.058, 0.062, 0.006]], { round: 2 })), top);
    put(pelvis, zipper, buckle);
    const strapM = M.fabric(o.webbing || '#2a2a26', { side: THREE.DoubleSide });
    for (const sx of [-1, 1]) { put(pelvis, strap(sx * 0.075, -1), strapM); put(pelvis, strap(sx * 0.075, 1), strapM); }
    const [, dfc] = frontAt(T, 0.38);
    put(pelvis, rbox(0.15, 0.03, 0.008, 0.3), webbing, 0, 0.38, -dfc - 0.006);
    put(pelvis, rbox(0.05, 0.04, 0.016, 0.25), buckle, 0, 0.38, -dfc - 0.01);
    put(pelvis, cached('belt' + sex, () => loft(band(T, 0.08, 0.13, 0.008), { round: 2.3 })), webbing);
    const [, dfb, dbb] = frontAt(T, 0.105);
    put(pelvis, rbox(0.055, 0.042, 0.014, 0.25), buckle, 0, 0.105, -dfb - 0.014);
    for (const [px, pz] of [[-0.13, -0.05], [0.13, -0.05], [-0.15, 0.04], [0.15, 0.04], [0, dbb + 0.01]]) put(pelvis, rbox(px ? 0.05 : 0.11, 0.075, 0.05, 0.25), M.fabric(o.webbing || '#2f2f2a'), px, 0.07, pz);
    // Mission patch on the left shoulder in the pilot's color.
    put(arms[0], cached('patch', () => new THREE.CylinderGeometry(0.026, 0.026, 0.004, 24).rotateZ(Math.PI / 2)), new THREE.MeshPhysicalMaterial({ color: o.patch || '#c8a050', roughness: 0.7, sheen: 0.6 }), -0.052, -0.07, 0, 0, 0, 0.1);
    // Comms headset: an earpiece and a mic boom.
    put(head, rbox(0.014, 0.034, 0.03, 0.4), dark, -0.081, 0.0, 0.008);
    const ear = new THREE.Vector3(-0.08, -0.008, 0.006), mouth = new THREE.Vector3(-0.034, -0.062, -0.088);
    const boom = put(head, cached('boom', () => new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6).rotateX(Math.PI / 2)), dark, (ear.x + mouth.x) / 2, (ear.y + mouth.y) / 2, (ear.z + mouth.z) / 2);
    boom.scale.set(1, 1, ear.distanceTo(mouth));
    boom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouth.clone().sub(ear).normalize());
    put(head, cached('mic', () => new THREE.SphereGeometry(0.006, 10, 8)), webbing, mouth.x, mouth.y, mouth.z);
  } else {
    // A native's tunic hem (or robe to the ankles), belt, apron, cloak and fur.
    const hem = o.robe ? -0.88 : -0.26;
    put(pelvis, cached('skirt' + sex + o.robe, () => loft([[hem, (female ? 0.24 : 0.22) + (o.robe ? 0.06 : 0), 0.15 + (o.robe ? 0.05 : 0), 0.17 + (o.robe ? 0.06 : 0)], [hem / 2, 0.2, 0.12, 0.14], [0.05, 0.178, 0.1, 0.118], [0.14, 0.162, 0.094, 0.1]], { round: 2.2, segs: 36 })), top);
    put(pelvis, cached('nbelt' + sex, () => loft(band(T, 0.08, 0.13, 0.008), { round: 2.3 })), o.belt ? M.leather(o.belt) : M.fabric('#cbbd98'));
    if (o.apron) put(pelvis, rbox(0.24, 0.5, 0.012, 0.2), M.leather(o.apron), 0, -0.12, -0.13, 0.08);
    if (o.cloak) put(pelvis, cached('cloak' + sex, () => loft([[-0.75, 0.3, 0.2, 0.26], [-0.2, 0.25, 0.16, 0.18], [0.3, 0.2, 0.14, 0.135], [0.52, 0.19, 0.11, 0.115], [0.58, 0.1, 0.07, 0.08]], { arc: [Math.PI * -0.12, Math.PI * 1.12], round: 2.1, segs: 30 })), M.fabric(o.cloak, { side: THREE.DoubleSide }));
    if (o.fur) put(pelvis, cached('fur', () => new THREE.TorusGeometry(0.15, 0.05, 10, 24).rotateX(Math.PI / 2).scale(1.15, 1, 0.85)), M.fabric(o.fur, { sheen: 1, roughness: 1 }), 0, 0.53, 0.005);
  }
  // Armor: a breastplate, back plate and pauldrons; gold for the best.
  if (o.armor > 20) {
    const plate = M.metal(o.armor > 60 ? '#c8a050' : '#8a9098', 0.38);
    put(pelvis, cached('breast' + sex, () => loft(grow(T, 0.016, 0.16, 0.54), { round: 2.3, arc: [Math.PI * 1.02, Math.PI * 1.98] })), plate);
    put(pelvis, cached('back' + sex, () => loft(grow(T, 0.016, 0.16, 0.54), { round: 2.3, arc: [Math.PI * 0.02, Math.PI * 0.98] })), plate);
    for (const a of arms) put(a, cached('pauldron', () => new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1, 0.75, 1.05)), plate, 0, 0.015, 0);
  }

  // Role gear and headwear.
  const [lh, rh] = hands;
  const wood = M.leather('#5a4028'), steel = M.metal('#a8aeb6', 0.3), gold = M.metal('#e0b848', 0.25);
  if (o.crown) {
    put(head, cached('crown', () => new THREE.CylinderGeometry(0.083, 0.08, 0.03, 24, 1, true)), gold, 0, 0.085, 0.004);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; put(head, cached('crownPt', () => new THREE.ConeGeometry(0.011, 0.04, 6)), gold, Math.cos(a) * 0.08, 0.115, Math.sin(a) * 0.08 + 0.004); }
  }
  if (o.helmet) {
    put(head, cached('helm', () => new THREE.SphereGeometry(0.098, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.86, 1.08, 1.06)), steel, 0, 0.016, 0.006);
    put(head, rbox(0.012, 0.075, 0.014, 0.4), steel, 0, -0.01, -0.101);
    if (o.plume) put(head, cached('plume', () => new THREE.CylinderGeometry(0.012, 0.03, 0.2, 10).rotateX(0.7)), M.fabric(o.plume, { sheen: 1 }), 0, 0.13, 0.06);
  }
  if (o.hat === 'straw') put(head, cached('straw', () => new THREE.CylinderGeometry(0.055, 0.2, 0.07, 28)), M.fabric('#c8b070', { roughness: 1 }), 0, 0.11, 0);
  if (o.hat === 'wizard') put(head, cached('wiz', () => new THREE.ConeGeometry(0.12, 0.36, 24).rotateZ(0.12)), M.fabric(o.tunic), 0, 0.25, 0.02);
  if (o.spear) { put(rh, cached('shaft', () => new THREE.CylinderGeometry(0.014, 0.014, 2.0, 10)), wood, 0, -0.05, 0, Math.PI / 2 - 0.2, 0, 0); put(rh, cached('tip', () => new THREE.ConeGeometry(0.024, 0.16, 8)), steel, 0, -0.05 - 0.2 * 1.06, -0.98 * 1.06, -(Math.PI / 2 + 0.2), 0, 0); }
  if (o.shield) put(forearms[0], cached('shieldGeo', () => new THREE.CylinderGeometry(0.24, 0.24, 0.03, 32).rotateZ(Math.PI / 2)), M.leather(o.shield), -0.06, -0.15, 0);
  if (o.staff) { put(rh, cached('staff', () => new THREE.CylinderGeometry(0.016, 0.022, 1.7, 10)), wood, 0, -0.05, 0, Math.PI / 2, 0, 0); put(rh, cached('orb', () => new THREE.SphereGeometry(0.045, 18, 14)), new THREE.MeshStandardMaterial({ color: o.staff, emissive: o.staff, emissiveIntensity: 3 }), 0, -0.05, -0.88); }
  if (o.hammer) { put(rh, cached('haft', () => new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8)), wood, 0, -0.07, -0.12, Math.PI / 2, 0, 0); put(rh, rbox(0.1, 0.07, 0.07, 0.2), steel, 0, -0.07, -0.33); }
  if (o.bow) put(pelvis, cached('bowGeo', () => new THREE.TorusGeometry(0.45, 0.012, 6, 24, Math.PI * 0.9)), wood, 0.05, 0.25, 0.13, 0, 0, 1.4);
  if (o.lute) put(pelvis, cached('lute', () => new THREE.SphereGeometry(0.12, 18, 14).scale(1, 1.3, 0.45)), wood, 0.08, 0.25, 0.14, 0, 0, 0.5);

  // The pilot's rifle, held at the low ready in both hands.
  if (o.gun) {
    const rifle = new THREE.Group();
    const polymer = M.leather('#1d1f22'), gm = M.metal('#3a3d42', 0.42);
    put(rifle, rbox(0.045, 0.085, 0.34, 0.25), gm, 0, 0, 0);                       // receiver
    put(rifle, rbox(0.04, 0.06, 0.2, 0.3), polymer, 0, -0.012, -0.24);             // handguard
    put(rifle, cached('barrel', () => new THREE.CylinderGeometry(0.009, 0.009, 0.2, 12).rotateX(Math.PI / 2)), gm, 0, 0.008, -0.42);
    put(rifle, cached('muzzle', () => new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12).rotateX(Math.PI / 2)), dark, 0, 0.008, -0.52);
    put(rifle, rbox(0.035, 0.1, 0.045, 0.3), polymer, 0, -0.08, 0.05, -0.3);        // grip
    put(rifle, rbox(0.03, 0.12, 0.05, 0.25), gm, 0, -0.09, -0.06, 0.15);            // magazine
    put(rifle, rbox(0.04, 0.07, 0.18, 0.25), polymer, 0, -0.01, 0.24);              // stock
    put(rifle, rbox(0.03, 0.035, 0.08, 0.3), dark, 0, 0.06, 0.0);                   // sight
    put(rifle, cached('lens', () => new THREE.CircleGeometry(0.011, 16)), new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff3a2a', emissiveIntensity: 2 }), 0, 0.06, -0.041, 0, Math.PI, 0);
    rifle.position.set(RIFLE[0], RIFLE[1], RIFLE[2]);
    rifle.rotation.x = RIFLE_PITCH;
    pelvis.add(rifle);
    g.userData.gun = rifle;
    g.userData.aim = true;
  }

  // Posing and walking.
  const pose = (t, moving) => {
    const ph = t * 7.2, k = Math.min(1, moving);
    const s = Math.sin(ph) * k;
    thighs[0].rotation.x = s * 0.5; thighs[1].rotation.x = -s * 0.5;
    shins[0].rotation.x = -Math.max(0, -Math.cos(ph)) * 0.75 * k - 0.04;
    shins[1].rotation.x = -Math.max(0, Math.cos(ph)) * 0.75 * k - 0.04;
    pelvis.position.y = HIP - 0.012 * k + Math.abs(Math.cos(ph)) * 0.022 * k;
    pelvis.rotation.y = s * 0.06;
    const breathe = Math.sin(t * 1.6) * 0.01;
    if (g.userData.aim) {
      // Both hands on the rifle: right hand on the grip, left on the handguard.
      const [r, l] = holdPose(sh);
      arms[1].rotation.set(r[0] + breathe, 0, r[1]); forearms[1].rotation.set(r[2], 0, 0);
      arms[0].rotation.set(l[0] + breathe, 0, l[1]); forearms[0].rotation.set(l[2], 0, 0);
    } else {
      arms[0].rotation.set(-s * 0.45 + breathe, 0, -0.07); arms[1].rotation.set(s * 0.45 + breathe, 0, 0.07);
      forearms[0].rotation.x = 0.15 + Math.max(0, -s) * 0.4; forearms[1].rotation.x = 0.15 + Math.max(0, s) * 0.4;
      if (o.spear || o.staff || o.hammer) { arms[1].rotation.set(0.2, 0, -0.1); forearms[1].rotation.x = 1.2; }
      if (o.shield) { arms[0].rotation.set(0.3, 0, -0.1); forearms[0].rotation.set(1.35, 0, 0); }
    }
  };
  mergeParts(g);
  pose(0, 0);
  g.userData.animate = pose;
  g.userData.arms = null;
  return g;
}
