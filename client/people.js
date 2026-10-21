// Realistic people from the MakeHuman-based model (built by tools/people/build.py from CC0 assets):
// a skinned body with morphs for build, age and ethnicity, fitted eyes and hair. Each person is a
// clone with their own shape, height, skin, eyes, hair and clothes. The clothes are painted onto
// the body by a shader from baked maps (where the arms, legs and torso are, and the flight suit's
// straps, zipper, seams and pads), with real gear (rifle, belt pouches, soles, helmets, skirts,
// weapons) attached to the bones. They walk, and pilots hold their rifle in both hands.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cc0Normal } from './realism.js';

let lib = null, loading = null;
const SEXES = ['male', 'female'];

export function loadPeople() {
  if (loading) return loading;
  const tl = new THREE.TextureLoader();
  const tex = (url, srgb = false) => new Promise((ok, fail) => tl.load(url, (t) => {
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    ok(t);
  }, undefined, fail));
  loading = Promise.all([
    new GLTFLoader().loadAsync('/models/people.glb'),
    tex('/models/people-regions.png'), tex('/models/people-detail.png'), tex('/models/people-face.png'), tex('/models/people-eye.png'),
    fetch('/models/people-anims.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    tex('/models/people-skin.png'),
  ]).then(([gltf, regions, detail, face, eye, anims, skinMap]) => {
    const templates = {};
    for (const sex of SEXES) {
      const g = new THREE.Group();
      const parts = {};
      for (const o of [...gltf.scene.children]) {
        if (!o.name.startsWith(sex + '_')) continue;
        parts[o.name.slice(sex.length + 1)] = o;
        g.add(o);
      }
      templates[sex] = g;
    }
    lib = { templates, regions, detail, face, eye, anims, skinMap, clips: {} };
    return lib;
  }).catch((e) => { console.warn('people model failed to load', e); loading = null; throw e; });
  return loading;
}
export const peopleReady = () => !!lib;

// Motion-captured clips (retargeted by tools/people/anims.py) as three.js clips for one body.
function clipsFor(sex, rootRest) {
  if (!lib.anims) return null;
  if (lib.clips[sex]) return lib.clips[sex];
  const out = {};
  for (const [name, c] of Object.entries(lib.anims.clips)) {
    const body = c.bodies[sex];
    if (!body) continue;
    const fps = c.fps || lib.anims.fps;
    const times = Float32Array.from({ length: c.frames }, (_, i) => i / fps);
    const tracks = Object.entries(body.bones).map(([bone, q]) => new THREE.QuaternionKeyframeTrack(`${sex}_${bone}.quaternion`, times, q));
    const pos = new Float32Array(c.frames * 3);
    for (let i = 0; i < c.frames; i++) pos.set([rootRest.x, rootRest.y + body.hipsY[i], rootRest.z], i * 3);
    tracks.push(new THREE.VectorKeyframeTrack(`${sex}_root.position`, times, pos));
    out[name] = new THREE.AnimationClip(name, -1, tracks);
  }
  lib.clips[sex] = out;
  return out;
}

// ---- materials --------------------------------------------------------------------------------------

const BODY_PARS = `
  uniform sampler2D tRegions; uniform sampler2D tDetail; uniform sampler2D tFace; uniform sampler2D tSkin;
  uniform float uFlush; uniform float uFreckle; uniform vec3 uScatter;
  uniform vec3 uTop; uniform vec3 uPants; uniform vec3 uGloveC; uniform vec3 uBootC; uniform vec3 uHairC; uniform vec3 uStrap;
  uniform float uNeck; uniform float uSleeve; uniform float uPant; uniform float uBoot; uniform float uGlove; uniform float uDetail; uniform float uBeard; uniform float uLips;
  float rSkin = 1.0;
`;
// Wrap lighting for skin: light bleeds a little, warm, past the shadow line.
// Only the diffuse light is wrapped: the specular term must keep the true N.L, or it blows up at
// silhouettes.
const SSS = (chunk) => chunk.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
  `float nlRaw = dot( geometryNormal, directLight.direction );
  vec3 wrapIrr = ( saturate( ( nlRaw + 0.45 ) / 1.45 ) * uScatter * ( 1.0 - dotNL ) + dotNL ) * directLight.color;
  reflectedLight.directDiffuse += mix( irradiance, wrapIrr, rSkin ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);

// ---- the anime look: cel shading and ink outlines that follow the skeleton --------------------

let toonGrad = null;
function gradient() {
  if (!toonGrad) {
    toonGrad = new THREE.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, THREE.RedFormat);
    toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter;
    toonGrad.needsUpdate = true;
  }
  return toonGrad;
}
// The same material (and its shader patches) as a cel-shaded one.
function toonify(m) {
  const t = new THREE.MeshToonMaterial({
    color: m.color, map: m.map, normalMap: m.normalMap, normalScale: m.normalScale, alphaTest: m.alphaTest, alphaHash: m.alphaHash,
    alphaToCoverage: m.alphaToCoverage, side: m.side, transparent: m.transparent, gradientMap: gradient(),
    polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits,
  });
  t.onBeforeCompile = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  t.customProgramCacheKey = () => key + '-toon';
  t.userData = m.userData;
  return t;
}
let inkMat = null;
function inkOutline(mesh, width = 0.006) {
  inkMat ||= (() => {
    const m = new THREE.MeshBasicMaterial({ color: '#1e1418', side: THREE.BackSide });
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize( objectNormal ) * ${width.toFixed(4)};`); };
    m.customProgramCacheKey = () => 'person-ink';
    return m;
  })();
  const ol = new THREE.SkinnedMesh(mesh.geometry, inkMat);
  ol.bind(mesh.skeleton, mesh.bindMatrix);
  ol.morphTargetDictionary = mesh.morphTargetDictionary;
  ol.morphTargetInfluences = mesh.morphTargetInfluences;
  ol.frustumCulled = false;
  ol.userData.noInk = true;
  mesh.parent.add(ol);
  return ol;
}

function bodyMaterial(o) {
  const m = new THREE.MeshPhysicalMaterial({
    color: o.skin, roughness: 0.55, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(o.skin).lerp(new THREE.Color('#ff8a70'), 0.5),
    normalMap: cc0Normal('fabric'), normalScale: new THREE.Vector2(0.55, 0.55),
  });
  m.normalMap.repeat.set(26, 26);
  const U = {
    tRegions: { value: lib.regions }, tDetail: { value: lib.detail }, tFace: { value: lib.face }, tSkin: { value: lib.skinMap },
    // Blood shows through fair skin more; darker skin scatters a less red light.
    uFlush: { value: o.flush ?? 0.5 }, uFreckle: { value: o.freckles ?? 0 },
    uScatter: { value: new THREE.Color(1, 0.72, 0.62).lerp(new THREE.Color(1, 0.86, 0.78), o.melanin ?? 0.3) },
    uTop: { value: new THREE.Color(o.top) }, uPants: { value: new THREE.Color(o.pants) }, uGloveC: { value: new THREE.Color(o.gloves || o.boots) },
    uBootC: { value: new THREE.Color(o.boots) }, uHairC: { value: new THREE.Color(o.hair) }, uStrap: { value: new THREE.Color(o.strap || '#2a2a26') },
    uNeck: { value: o.neck ?? 0.84 }, uSleeve: { value: o.sleeve ?? 0.79 }, uPant: { value: o.pantLen ?? 0.86 }, uBoot: { value: o.bootTop ?? 0.66 }, uGlove: { value: o.gloved ? 1 : 0 },
    uDetail: { value: o.suit ? 1 : 0 }, uBeard: { value: o.beard ? 1 : o.stubble || 0 }, uLips: { value: o.female ? 1 : 0.6 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + BODY_PARS)
      .replace('#include <lights_physical_pars_fragment>', SSS(THREE.ShaderChunk.lights_physical_pars_fragment))
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 rg = texture2D( tRegions, vNormalMapUv / 26.0 );
        vec4 dt = texture2D( tDetail, vNormalMapUv / 26.0 );
        vec4 fc = texture2D( tFace, vNormalMapUv / 26.0 );
        float part = rg.a, arm = rg.r, leg = rg.g;
        // Overlapping ranges, so the blend between torso and arm never shows bare skin.
        float isTorso = smoothstep( 0.2, 0.28, part ) * ( 1.0 - smoothstep( 0.56, 0.62, part ) );
        float isArm = smoothstep( 0.4, 0.46, part ) * ( 1.0 - smoothstep( 0.86, 0.9, part ) );
        float isLeg = smoothstep( 0.86, 0.94, part );
        float glove = isArm * smoothstep( 0.785, 0.8, arm ) * uGlove;
        float neckline = 1.0 - smoothstep( uNeck - 0.002, uNeck + 0.002, rg.b );
        // The neck and shoulders below the neckline are clothed even where the bake calls them head.
        isTorso = max( isTorso, ( 1.0 - smoothstep( 0.1, 0.2, part ) ) * neckline );
        float top = max( isTorso * neckline, isArm * ( 1.0 - smoothstep( uSleeve - 0.01, uSleeve + 0.01, arm ) ) ) * ( 1.0 - glove );
        float boot = isLeg * smoothstep( uBoot - 0.005, uBoot + 0.005, leg );
        float pants = isLeg * ( 1.0 - smoothstep( uPant - 0.01, uPant + 0.01, leg ) ) * ( 1.0 - boot );
        float cloth = max( top, pants );
        rSkin = 1.0 - max( cloth, max( glove, boot ) );
        // Face: lips, brows, lash line and beard shadow.
        vec3 skin = diffuseColor.rgb;
        // Living skin: mottling, flushed cheeks, nose, ears and knuckles, darker creases, freckles.
        vec4 sk = texture2D( tSkin, vNormalMapUv / 26.0 );
        skin *= 1.0 + ( sk.a - 0.5 ) * 0.08;
        skin = mix( skin, skin * vec3( 1.06, 0.8, 0.77 ), sk.r * uFlush );
        skin *= 1.0 - sk.g * 0.17;
        skin = mix( skin, skin * vec3( 0.76, 0.6, 0.48 ), sk.b * uFreckle );
        skin = mix( skin, skin * vec3( 0.86, 0.56, 0.56 ), fc.r * uLips );
        skin = mix( skin, uHairC * 0.32, fc.g );
        skin = mix( skin, skin * 0.35, fc.b * 0.85 );
        skin = mix( skin, mix( skin, uHairC * 0.6, 0.35 ), fc.a * uBeard );
        vec3 col = skin;
        col = mix( col, uTop, top );
        col = mix( col, uPants, pants );
        col = mix( col, uGloveC, glove );
        col = mix( col, uBootC, boot );
        // The flight suit: harness and belt webbing, zipper and buckles, seams, knee pads.
        float strap = dt.r * uDetail * cloth, metalBits = dt.g * uDetail * cloth;
        col = mix( col, uStrap, strap );
        col = mix( col, col * 0.62, dt.b * uDetail * cloth );
        col = mix( col, uBootC * 0.8, dt.a * uDetail * pants );
        col = mix( col, vec3( 0.62, 0.64, 0.66 ), metalBits );
        diffuseColor.rgb = col;
        float rLeather = max( glove, boot );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( mix( 0.5, 0.9, cloth ), 0.55, rLeather );
        roughnessFactor = mix( roughnessFactor, 0.32, metalBits );
        roughnessFactor = mix( roughnessFactor, 0.48, fc.r * uLips * rSkin );`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = metalBits;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // Sheen is the soft glow of skin and cloth; leather and metal have none.
        material.sheenColor *= max( rSkin, cloth * 0.35 );`)
      .replace('#include <normal_fragment_maps>', `vec3 rBaseN = normal;
        #include <normal_fragment_maps>
        // Fingers and ears have squashed uvs where the normal map's frame breaks down (NaN): skip it there.
        float rNw = max( cloth, rLeather * 0.5 );
        normal = ( rNw < 0.01 || any( isnan( normal ) ) || any( isinf( normal ) ) ) ? rBaseN : normalize( mix( rBaseN, normal, rNw ) );`);
  };
  m.customProgramCacheKey = () => 'person-body';
  m.userData.uniforms = U;
  return m;
}

function eyeMaterial(iris) {
  const m = new THREE.MeshPhysicalMaterial({ map: lib.eye, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, alphaTest: 0.5 });
  const U = { uIris: { value: new THREE.Color(iris) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uIris;')
      .replace('#include <map_fragment>', `
        vec4 eyeT = texture2D( map, vMapUv );
        diffuseColor.rgb = mix( vec3( eyeT.r * 0.85 ), uIris * ( 0.12 + eyeT.r * 0.75 ), eyeT.g );
        diffuseColor.a *= eyeT.a;`);
  };
  m.customProgramCacheKey = () => 'person-eye';
  return m;
}

// Strands of hair on a card: four clumps side by side, fine wavy strands of varying brightness,
// thinning out toward the tips.
let strandTex = null;
function strands() {
  if (strandTex) return strandTex;
  const W = 512, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  let seed = 9;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let clump = 0; clump < 4; clump++) {
    const x0 = clump * 128;
    for (let i = 0; i < 70; i++) {
      const cx = x0 + 10 + r() * 108, len = H * (0.65 + r() * 0.35), wav = r() * 6.28, amp = 1 + r() * 3;
      const b = Math.floor(150 + r() * 105), a = 0.35 + r() * 0.65;
      x.strokeStyle = `rgba(${b},${b},${b},${a})`;
      x.lineWidth = 0.8 + r() * 1.6;
      x.beginPath();
      for (let y = 0; y <= len; y += 8) {
        const edge = Math.min(1, (cx - x0) / 20, (x0 + 128 - cx) / 20);
        const px = cx + Math.sin(y * 0.02 + wav) * amp * edge;
        if (y === 0) x.moveTo(px, y); else x.lineTo(px, y);
      }
      x.stroke();
    }
  }
  // Fade the tips.
  const g = x.createLinearGradient(0, H * 0.6, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = g;
  x.fillRect(0, H * 0.6, W, H * 0.4);
  strandTex = new THREE.CanvasTexture(c);
  strandTex.colorSpace = THREE.SRGBColorSpace;
  strandTex.flipY = false;
  strandTex.anisotropy = 8;
  return strandTex;
}

// Hair cards: see-through strands that sway, stream back when walking and darken at the roots.
function cardMaterial(color) {
  const hc = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({
    color: hc, map: strands(), roughness: 0.5, side: THREE.DoubleSide, alphaTest: 0.3, alphaToCoverage: true,
    sheen: 0.25, sheenRoughness: 0.35, sheenColor: hc.clone(), specularIntensity: 0.5,
  });
  const U = { uTime: { value: 0 }, uSwing: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nuniform float uTime; uniform float uSwing;\nvarying vec3 vCard;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCard = color;
        float along = color.g * color.g, ph = color.b * 6.283;
        transformed += vec3( sin( uTime * 1.3 + ph ) * 0.012, 0.0, cos( uTime * 1.1 + ph * 1.7 ) * 0.01 + uSwing * 0.06 ) * along;
        transformed.y += uSwing * 0.02 * along;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix( 0.55, 1.05, smoothstep( 0.0, 0.35, vCard.g ) ) * ( 0.85 + 0.3 * vCard.b );`);
  };
  m.customProgramCacheKey = () => 'person-hair-cards';
  m.userData.uniforms = U;
  return m;
}

let hairNormal = null;
function hairMaterial(color, fade = true) {
  if (!hairNormal) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d'), img = x.createImageData(256, 256);
    const raw = Array.from({ length: 256 }, () => Math.random() - 0.5);
    const line = raw.map((v, i) => (raw[(i + 255) % 256] + v * 2 + raw[(i + 1) % 256]) / 4);
    for (let yy = 0; yy < 256; yy++) for (let xx = 0; xx < 256; xx++) {
      const o = (yy * 256 + xx) * 4, dx = (line[(xx + 1) % 256] - line[(xx + 255) % 256]) * 1.2;
      img.data[o] = (0.5 - dx * 0.5) * 255; img.data[o + 1] = 128; img.data[o + 2] = 240; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    hairNormal = new THREE.CanvasTexture(c);
    hairNormal.wrapS = hairNormal.wrapT = THREE.RepeatWrapping;
    hairNormal.repeat.set(10, 2);
  }
  const hc = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({
    color: hc.clone().multiplyScalar(0.8), roughness: 0.5, normalMap: hairNormal, normalScale: new THREE.Vector2(0.6, 0.6),
    sheen: 1, sheenRoughness: 0.35, sheenColor: hc.clone().lerp(new THREE.Color('#ffffff'), 0.25),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaHash: fade,
  });
  if (!fade) return m;
  // The hairline thins out (dithered), using how much hair grows at each vertex.
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying float vGrow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrow = color.r;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= smoothstep( 0.05, 0.55, vGrow );\ndiffuseColor.rgb *= 0.75 + 0.25 * smoothstep( 0.2, 0.9, vGrow );');
  };
  m.customProgramCacheKey = () => 'person-hair';
  return m;
}

// ---- helpers -------------------------------------------------------------------------------------------

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

// Point a bone (rest direction = its child's offset) along a direction given in the model's frame.
function aimBone(bone, restDir, dirModel, parentModelQ) {
  _q.setFromUnitVectors(_v.copy(restDir).normalize(), _v2.copy(dirModel).normalize());
  bone.quaternion.copy(_q2.copy(parentModelQ).invert().multiply(_q));
  return _q.clone();
}

// The model-frame rotation of a bone, given its parents' in the same frame.
function modelQuat(bone, model) {
  const q = new THREE.Quaternion();
  const chain = [];
  for (let b = bone; b && b !== model; b = b.parent) chain.unshift(b);
  for (const b of chain) q.multiply(b.quaternion);
  return q;
}
function modelPos(bone, model) {
  const m = new THREE.Matrix4();
  const chain = [];
  for (let b = bone; b && b !== model; b = b.parent) chain.unshift(b);
  for (const b of chain) { b.updateMatrix(); m.multiply(b.matrix); }
  return new THREE.Vector3().setFromMatrixPosition(m);
}

// Two-bone reach: put the hand at 'target' (model frame), the elbow bending toward 'pole'.
function reach(model, upper, lower, hand, target, pole) {
  const s = modelPos(upper, model);
  const a = lower.position.length(), b = hand.position.length();
  const toT = target.clone().sub(s);
  const d = Math.min(toT.length(), (a + b) * 0.999);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const elbow = s.clone().add(dir.clone().multiplyScalar(a * cosA)).add(side.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));
  const wrist = s.clone().add(dir.clone().multiplyScalar(d));
  const pq = modelQuat(upper.parent, model);
  const uq = aimBone(upper, lower.position, elbow.clone().sub(s), pq);
  aimBone(lower, hand.position, wrist.clone().sub(elbow), uq);
}

// ---- building a person -----------------------------------------------------------------------------------

const rbox = (w, h, d, r = 0.3) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * r);
const leather = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 });
const metal = (c, r = 0.3) => new THREE.MeshPhysicalMaterial({ color: c, roughness: Math.max(r, 0.4), metalness: 1 });
const cloth = (c, extra = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.9, sheen: 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(c), ...extra });

// o: { sex, skin, hair, eyes, hairStyle, beard, build: {muscle, heavy, thin, old, african, asian, caucasian, elf},
//      height, width, top, pants, boots, gloves, suit, sleeve, pantLen, bootTop, gloved, gun, gear... }
export function buildModelPerson(o) {
  if (!lib) return null;
  const sex = o.female ? 'female' : 'male';
  const g = SkeletonUtils.clone(lib.templates[sex]);
  o = { ...o };
  const cards = [], unused = [];
  const bones = {};
  let body = null;
  g.traverse((n) => {
    if (n.isBone) bones[n.name.slice(sex.length + 1)] = n;
    if (n.isSkinnedMesh) {
      n.castShadow = n.receiveShadow = true;
      n.frustumCulled = false;
      const key = n.name.slice(sex.length + 1);
      if (key === 'body') body = n;
      else if (key === 'eyes') n.material = o.toon ? toonify(eyeMaterial(o.eyes)) : eyeMaterial(o.eyes);
      else if (key.startsWith('hair')) {
        // Each style is a scalp layer plus, for the longer ones, strands or a bun.
        const parts = { crop: ['hair_crop'], long: ['hair_long', 'hair_long_cards'], bob: ['hair_long', 'hair_bob_cards'],
          ponytail: ['hair_long', 'hair_ponytail_cards'], bun: ['hair_long', 'hair_bun'] }[o.hairStyle] || ['hair_crop'];
        n.visible = !o.bald && parts.includes(key);
        if (key.endsWith('_cards')) { n.material = cardMaterial(o.hair); cards.push(n.material.userData.uniforms); }
        else n.material = hairMaterial(o.hair, key !== 'hair_bun');
        if (o.toon) n.material = toonify(n.material);
        if (!n.visible) unused.push(n);
      }
      if (n.morphTargetDictionary) for (const [k, i] of Object.entries(n.morphTargetDictionary)) n.morphTargetInfluences[i] = k === 'covered' ? (o.top ? 1 : 0) : o.build?.[k] || 0;
    }
  });
  for (const n of unused) n.parent.remove(n);
  // Necklines: a high collar for flight suits, lower for tunics (as a height on the body, like the bake).
  const neckY = modelPos(bones.neck01, g).y;
  o.neck = (neckY + (o.suit ? 0.075 : o.robe ? 0.04 : 0.03)) / 1.75;
  body.material = o.toon ? toonify(bodyMaterial(o)) : bodyMaterial(o);
  if (o.toon) inkOutline(body);
  const root = new THREE.Group();
  root.add(g);
  g.scale.set((o.width || 1) * (o.height || 1), o.height || 1, (o.width || 1) * (o.height || 1));
  root.userData.bones = bones;

  // Gear on the bones (bones have no rest rotation, so offsets are in the model's axes).
  const put = (bone, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    bones[bone].add(m);
    return m;
  };
  // Same, but positioned in the model's frame (bone origins are not at the body's middle).
  const putAt = (bone, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const at = modelPos(bones[bone], g);
    return put(bone, geo, mat, x - at.x, y - at.y, z - at.z, rx, ry, rz);
  };
  const headTop = new THREE.Vector3(...(bones.head.userData.tail || [0, 0.2, 0]));
  const dark = metal('#2a2c30', 0.5), steel = metal('#a8aeb6', 0.3), gold = metal('#e0b848', 0.25), wood = leather('#5a4028');
  // Boot soles and heels.
  for (const s of ['L', 'R']) {
    const foot = bones[`foot_${s}`];
    const tail = new THREE.Vector3(...(foot.userData.tail || [0, -0.04, -0.12]));
    const bootM = leather(o.boots || '#2a2622');
    put(`foot_${s}`, rbox(0.098, 0.02, 0.27, 0.3), dark, tail.x * 0.5, -0.064, tail.z * 0.5 - 0.03);
    put(`foot_${s}`, rbox(0.108, 0.068, 0.19, 0.5), bootM, tail.x * 0.85, -0.028, tail.z * 0.85 - 0.05);
    put(`foot_${s}`, rbox(0.088, 0.07, 0.09, 0.45), bootM, tail.x * 0.15, -0.025, 0.03);
  }
  if (o.suit) {
    // Belt pouches and a holster, and a comms earpiece.
    const pouch = cloth(o.strap || '#2f2f2a');
    const beltY = modelPos(bones.root, g).y + 0.1;
    for (const [x, z] of [[-0.1, -0.075], [0.1, -0.075], [-0.13, 0.03], [0.13, 0.03]]) putAt('root', rbox(0.045, 0.06, 0.035, 0.25), pouch, x, beltY, z, 0, Math.atan2(x, -z), 0);
    put('head', rbox(0.014, 0.032, 0.026, 0.4), dark, sex === 'male' ? 0.077 : 0.071, 0.02, 0.005);
  }
  if (o.beard === 'long') {
    const beard = new THREE.SphereGeometry(1, 24, 18, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7).scale(0.07, 0.14, 0.05);
    const bm = hairMaterial(new THREE.Color(o.hair).multiplyScalar(1.5).lerp(new THREE.Color('#6a4a32'), 0.25), false);
    bm.roughness = 0.85; bm.sheen = 0.6; bm.normalScale.set(1.4, 1.4);
    put('head', beard, bm, 0, -0.085, -0.075, 0.25);
  }
  if (o.helmet) {
    put('head', new THREE.SphereGeometry(0.108, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.88, 1.05, 1.06), steel, 0, headTop.y * 0.52, headTop.z * 0.5 - 0.008);
    if (o.plume) put('head', new THREE.CylinderGeometry(0.012, 0.03, 0.2, 10).rotateX(-0.7), cloth(o.plume, { sheen: 1 }), 0, headTop.y + 0.05, 0.06);
  }
  if (o.crown) {
    put('head', new THREE.CylinderGeometry(0.088, 0.085, 0.035, 24, 1, true), gold, 0, headTop.y * 0.86, headTop.z * 0.8);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; put('head', new THREE.ConeGeometry(0.012, 0.045, 6), gold, Math.cos(a) * 0.087, headTop.y * 0.86 + 0.035, Math.sin(a) * 0.087 + headTop.z * 0.8); }
  }
  if (o.hat === 'straw') put('head', new THREE.CylinderGeometry(0.06, 0.21, 0.08, 28), cloth('#c8b070', { roughness: 1 }), 0, headTop.y * 0.92, 0);
  if (o.hat === 'wizard') put('head', new THREE.ConeGeometry(0.12, 0.38, 24).rotateZ(0.12), cloth(o.top), 0, headTop.y * 0.9 + 0.12, 0.02);
  // Tunic hem or robe, and a cloak: open cones from the waist / shoulders (they hang from the hips).
  if (o.skirt) {
    // From the waist, out over the hips, down to the hem.
    const w = o.female ? 0.135 : 0.15, h = o.skirt;
    const prof = [[w + 0.07 + h * 0.08, -h], [w + 0.065, -Math.min(0.32, h * 0.6)], [w + 0.055, -0.14], [w + 0.03, -0.04], [w + 0.005, 0.03]].map(([r, y]) => new THREE.Vector2(r, y));
    putAt('root', new THREE.LatheGeometry(prof, 40).scale(1, 1, 0.78), cloth(o.top, { side: THREE.DoubleSide }), 0, modelPos(bones.root, g).y + 0.13, 0.005);
  }
  if (o.cloak) put('spine01', new THREE.CylinderGeometry(0.18, 0.33, 1.25, 28, 1, true, Math.PI * 0.62, Math.PI * 1.76).translate(0, -0.62, 0).scale(1.1, 1, 0.8), cloth(o.cloak, { side: THREE.DoubleSide }), 0, 0.06, 0.02);
  if (o.fur) put('spine01', new THREE.TorusGeometry(0.15, 0.05, 10, 24).rotateX(Math.PI / 2).scale(1.15, 1, 0.85), cloth(o.fur, { sheen: 1, roughness: 1 }), 0, 0.06, 0);
  if (o.apron) putAt('root', rbox(0.26, 0.55, 0.012, 0.2), leather(o.apron), 0, modelPos(bones.root, g).y - 0.05, -0.14, 0.06);
  if (o.armor > 20) {
    const plate = metal(o.armor > 60 ? '#c8a050' : '#8a9098', 0.38);
    put('spine02', new THREE.SphereGeometry(0.2, 28, 16, Math.PI * 1.05, Math.PI * 0.9, Math.PI * 0.22, Math.PI * 0.5).scale(0.95, 1.4, 0.75), plate, 0, 0.05, 0.0);
    for (const s of ['L', 'R']) put(`upperarm01_${s}`, new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1, 0.75, 1.05), plate, 0, 0.01, 0);
  }
  // Weapons in the right hand, a shield on the left forearm.
  const upright = [];
  const pole = (parts) => { const grp = new THREE.Group(); grp.position.set(0.03, -0.06, -0.02); for (const m of parts) grp.add(m); bones.wrist_R.add(grp); upright.push(grp); };
  const mesh = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; return m; };
  if (o.spear) pole([mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.0, 10), wood, 0.3), mesh(new THREE.ConeGeometry(0.024, 0.16, 8), steel, 1.36)]);
  if (o.staff) pole([mesh(new THREE.CylinderGeometry(0.016, 0.022, 1.7, 10), wood, 0.2), mesh(new THREE.SphereGeometry(0.045, 18, 14), new THREE.MeshStandardMaterial({ color: o.staff, emissive: o.staff, emissiveIntensity: 3 }), 1.06)]);
  if (o.hammer) { put('wrist_R', new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), wood, 0, -0.05, 0); put('wrist_R', rbox(0.1, 0.07, 0.07, 0.2), steel, 0, -0.25, 0); }
  let shield = null;
  if (o.shield) {
    shield = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.035, 36).rotateX(Math.PI / 2), leather(o.shield));
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), steel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.012, 8, 40), steel);
    boss.position.z = -0.02; disc.castShadow = boss.castShadow = rim.castShadow = true;
    shield.add(disc, boss, rim);
    shield.position.set(0, -0.15, -0.06);
    bones.lowerarm01_L.add(shield);
  }
  if (o.bow) put('spine02', new THREE.TorusGeometry(0.45, 0.012, 6, 24, Math.PI * 0.9), wood, -0.05, 0.05, 0.13, 0, 0, 1.4);
  if (o.lute) put('spine02', new THREE.SphereGeometry(0.12, 18, 14).scale(1, 1.3, 0.45), wood, -0.08, 0, 0.15, 0, 0, 0.5);

  // A sword in the right hand: an energy blade (glowing edge) or a greatsword.
  let sword = null, swingAt = -1, swingKind = 0, swingStart = null;
  if (o.sword) {
    sword = new THREE.Group();
    const big = o.sword === 'greatsword', L = big ? 1.25 : 0.95;
    const col = big ? '#ffb05a' : '#7ad8ff';
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; sword.add(m); };
    add(new THREE.CylinderGeometry(0.018, 0.02, 0.2, 10), leather('#2a2420'), 0);
    add(rbox(big ? 0.26 : 0.18, 0.035, 0.05, 0.3), metal('#8a8e96', 0.35), 0.11);
    add(rbox(big ? 0.075 : 0.045, L, 0.012, 0.3), metal(big ? '#c8ccd2' : '#d8e8f0', 0.2), 0.13 + L / 2);
    if (!big) add(rbox(0.012, L * 0.98, 0.016, 0.4), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3, toneMapped: false }), 0.13 + L / 2);
    add(new THREE.SphereGeometry(0.03, 10, 8), metal('#8a8e96', 0.35), -0.11);
    g.add(sword);
    root.userData.swing = (combo) => { swingKind = combo; swingAt = 0; swingStart = null; };
  }

  // The rifle, carried at the low ready.
  let rifle = null;
  if (o.gun && !o.sword) {
    rifle = new THREE.Group();
    const polymer = leather('#1d1f22'), gm = metal('#3a3d42', 0.42);
    const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; rifle.add(m); };
    add(rbox(0.045, 0.085, 0.34, 0.25), gm, 0, 0, 0);
    add(rbox(0.04, 0.06, 0.2, 0.3), polymer, 0, -0.012, -0.24);
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.2, 12).rotateX(Math.PI / 2), gm, 0, 0.008, -0.42);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12).rotateX(Math.PI / 2), dark, 0, 0.008, -0.52);
    add(rbox(0.035, 0.1, 0.045, 0.3), polymer, 0, -0.08, 0.05, -0.3);
    add(rbox(0.03, 0.12, 0.05, 0.25), gm, 0, -0.09, -0.06, 0.15);
    add(rbox(0.04, 0.07, 0.18, 0.25), polymer, 0, -0.01, 0.24);
    add(rbox(0.03, 0.035, 0.08, 0.3), dark, 0, 0.06, 0);
    add(new THREE.CircleGeometry(0.011, 16).rotateY(Math.PI), new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff3a2a', emissiveIntensity: 2 }), 0, 0.06, -0.041);
    rifle.traverse((m) => { m.castShadow = true; });
    g.add(rifle);
    root.userData.gun = rifle;
  }

  // ---- posing -----------------------------------------------------------------------------------
  const B = bones;
  const rest = {};
  for (const [k, b] of Object.entries(B)) rest[k] = b.position.clone();
  const hipY = rest.root.y;
  const X = new THREE.Vector3(1, 0, 0);
  // An arm hanging at the side, swung forward by 'swing' and bent at the elbow by 'bend' (radians).
  const hang = (side, swing, bend) => {
    const sx = side === 'L' ? -1 : 1;
    const up = new THREE.Vector3(sx * 0.12, -Math.cos(swing), -Math.sin(swing));
    const uq = aimBone(B[`upperarm01_${side}`], rest[`lowerarm01_${side}`], up, modelQuat(B[`upperarm01_${side}`].parent, g));
    const fore = new THREE.Vector3(sx * 0.06, -Math.cos(swing + bend), -Math.sin(swing + bend));
    aimBone(B[`lowerarm01_${side}`], rest[`wrist_${side}`], fore, uq);
    B[`wrist_${side}`].quaternion.identity();
  };
  const curl = (s, k) => {
    // Curl the fingers to grip (around the axis across the palm).
    for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) {
      const bn = B[`finger${f}_${j}_${s}`];
      if (!bn) continue;
      const axis = f === 1 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, 1);
      bn.quaternion.setFromAxisAngle(axis, k * (f === 1 ? 0.35 : 0.55 + j * 0.15));
    }
  };
  // Motion capture: idle, walk and run blended by speed; idle natives now and then nod or shake
  // their heads. Hands holding things are posed on top.
  const clips = clipsFor(sex, rest.root);
  let mixer = null, last = null, emote = null, emoteIn = 4 + Math.random() * 10;
  const act = {};
  if (clips) {
    mixer = new THREE.AnimationMixer(g);
    for (const n of ['idle', 'walk', 'run']) {
      if (!clips[n]) continue;
      // Bards dance when they are not walking anywhere.
      act[n] = mixer.clipAction(n === 'idle' && o.dance && clips.sambaDance ? clips.sambaDance : clips[n]);
      act[n].play();
      act[n].time = Math.random() * clips[n].duration;
      act[n].setEffectiveWeight(n === 'idle' ? 1 : 0);
    }
    for (const n of ['agree', 'headShake']) if (clips[n]) { act[n] = mixer.clipAction(clips[n]); act[n].setLoop(THREE.LoopOnce, 1); }
  }
  const pose = (t, moving, speed) => {
    const k = Math.min(1, moving), ph = t * 7.2, s = Math.sin(ph) * k;
    const dt = last == null ? 0 : THREE.MathUtils.clamp(t - last, 0, 0.1);
    last = t;
    for (const u of cards) { u.uTime.value = t % 1000; u.uSwing.value += (Math.min(1, (speed ?? k) / 4) - u.uSwing.value) * 0.1; }
    if (mixer && act.idle && act.walk) {
      const sp = speed ?? k * 1.5;
      const runW = act.run ? THREE.MathUtils.clamp((sp - 3) / 2.5, 0, 1) * k : 0;
      act.idle.setEffectiveWeight(1 - k);
      act.walk.setEffectiveWeight(k * (1 - runW));
      act.walk.timeScale = THREE.MathUtils.clamp(sp / 1.5, 0.6, 2.2);
      if (act.run) { act.run.setEffectiveWeight(runW); act.run.timeScale = THREE.MathUtils.clamp(sp / 4.5, 0.7, 1.5); }
      // Gestures while standing around.
      if (!rifle && k < 0.1 && act.agree) {
        emoteIn -= dt;
        if (emoteIn < 0 && !emote) {
          emote = act[Math.random() < 0.6 ? 'agree' : 'headShake'];
          emote.reset().play();
          emoteIn = 8 + Math.random() * 16;
        }
      }
      if (emote) {
        const f = emote.time / emote.getClip().duration;
        emote.setEffectiveWeight(k < 0.1 && emote.isRunning() ? Math.sin(Math.PI * Math.min(1, f)) : 0);
        if (!emote.isRunning()) { emote.stop(); emote = null; }
      }
      mixer.update(dt);
    } else {
      B.root.position.y = hipY - 0.012 * k + Math.abs(Math.cos(ph)) * 0.022 * k;
      B.root.quaternion.setFromAxisAngle(Y, s * 0.06);
      B.spine03.quaternion.setFromAxisAngle(Y, -s * 0.05);
      B.upperleg01_L.quaternion.setFromAxisAngle(X, -s * 0.38);
      B.upperleg01_R.quaternion.setFromAxisAngle(X, s * 0.38);
      const kneeL = -(Math.max(0, -Math.cos(ph)) * 0.7 * k + 0.03), kneeR = -(Math.max(0, Math.cos(ph)) * 0.7 * k + 0.03);
      B.lowerleg01_L.quaternion.setFromAxisAngle(X, kneeL);
      B.lowerleg01_R.quaternion.setFromAxisAngle(X, kneeR);
      B.foot_L.quaternion.setFromAxisAngle(X, -(-s * 0.38 + kneeL) * 0.8);
      B.foot_R.quaternion.setFromAxisAngle(X, -(s * 0.38 + kneeR) * 0.8);
    }
    if (sword) {
      // En garde, or mid-swing: the hand travels an arc across the body (alternating cuts), a
      // sword skill spins the whole body round, Vorpal Strike thrusts straight ahead.
      const chest = modelPos(B.spine02, g);
      if (swingAt >= 0 && swingStart == null) swingStart = t;
      const dur = swingKind === 3 ? 0.45 : swingKind === 'vorpal' ? 0.35 : 0.28;
      const u = swingStart == null ? -1 : (t - swingStart) / dur;
      if (u >= 1) { swingAt = -1; swingStart = null; }
      let hand, dir;
      if (u >= 0 && u < 1 && swingKind === 'vorpal') {
        const e = Math.sin(Math.min(1, u * 1.6) * Math.PI / 2);
        hand = chest.clone().add(new THREE.Vector3(0.16, -0.12, -0.25 - 0.35 * e));
        dir = new THREE.Vector3(0, 0.05, -1);
      } else if (u >= 0 && u < 1) {
        const e = 1 - Math.pow(1 - u, 3);
        const from = 1.25, to = -1.25, side = swingKind === 3 || swingKind % 2 ? 1 : -1;
        const a = (from + (to - from) * e) * side;
        hand = chest.clone().add(new THREE.Vector3(Math.sin(a) * 0.45, -0.12 + (side > 0 ? 0.1 - 0.2 * e : -0.1 + 0.2 * e), -Math.cos(a) * 0.42));
        dir = new THREE.Vector3(Math.sin(a), 0.15, -Math.cos(a));
        if (swingKind === 3) B.root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI * 2 * e));
      } else {
        hand = chest.clone().add(new THREE.Vector3(0.22, -0.34, -0.2));
        dir = new THREE.Vector3(0.12, 0.65, -1);
      }
      reach(g, B.upperarm01_R, B.lowerarm01_R, B.wrist_R, hand, new THREE.Vector3(0.7, -0.6, 0.2));
      curl('R', 1);
      sword.position.copy(modelPos(B.wrist_R, g)).add(new THREE.Vector3(0, -0.06, -0.03));
      sword.quaternion.setFromUnitVectors(Y, dir.normalize());
      if (!mixer) { hang('L', s * 0.4, 0.15 + Math.max(0, s) * 0.4); curl('L', 0.35); }
    } else if (rifle) {
      // Rifle at the low ready in front of the chest; both hands on it.
      // It moves with the chest, so the arms keep their grip as the body sways.
      const chest = modelPos(B.spine02, g), cq = modelQuat(B.spine02, g);
      rifle.position.copy(chest).add(new THREE.Vector3(0.06, -0.13 + Math.sin(t * 1.6) * 0.004, -0.19).applyQuaternion(cq));
      rifle.quaternion.copy(cq).multiply(new THREE.Quaternion().setFromAxisAngle(X, -0.12));
      const grip = new THREE.Vector3(0.0, -0.075, 0.05).applyQuaternion(rifle.quaternion).add(rifle.position);
      const guard = new THREE.Vector3(0.0, -0.035, -0.19).applyQuaternion(rifle.quaternion).add(rifle.position);
      reach(g, B.upperarm01_R, B.lowerarm01_R, B.wrist_R, grip, new THREE.Vector3(0.6, -0.7, 0.3));
      reach(g, B.upperarm01_L, B.lowerarm01_L, B.wrist_L, guard, new THREE.Vector3(-0.6, -0.7, 0.2));
      B.wrist_R.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
      B.wrist_L.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5);
      curl('L', 1); curl('R', 1);
    } else {
      const hold = o.spear || o.staff || o.hammer;
      if (!mixer || o.shield) { hang('L', s * 0.4, o.shield ? 1.45 : 0.15 + Math.max(0, s) * 0.4); curl('L', o.shield ? 0.8 : 0.35); }
      if (!mixer || hold) { hang('R', hold ? 0.1 : -s * 0.4, hold ? 1.25 : 0.15 + Math.max(0, -s) * 0.4); curl('R', hold ? 1 : 0.35); }
      // Spears and staffs stay upright whatever the hand does; the shield faces forward.
      if (upright.length) {
        const wq = modelQuat(B.wrist_R, g).invert();
        for (const m of upright) m.quaternion.copy(wq);
      }
      if (shield) shield.quaternion.copy(modelQuat(B.lowerarm01_L, g).invert());
    }
  };
  pose(0, 0);
  root.userData.animate = pose;
  root.userData.body = body;
  return root;
}

// A natural look from a seed: skin, hair and eye colors and a build.
// Real skin: tones along a measured scale from very fair to very dark, with a pink, neutral,
// olive or golden undertone; face shape, hair and eyes that go with them. Peoples differ: elves
// are fair, dwarves ruddy, vampires pale and cool, werewolves weathered.
const TONES = ['#e9c2a4', '#dfb291', '#d29f7b', '#bf8963', '#a9734e', '#8f5e3e', '#744930', '#5a3723', '#43281a'];
const HAIRS = {
  black: '#16110e', darkBrown: '#2b1d15', brown: '#46301f', lightBrown: '#6b4a2f', darkBlond: '#8c6c46',
  blond: '#b39159', platinum: '#d6c49c', auburn: '#5e2a17', red: '#86391b', grey: '#8a8580', white: '#cdc8c0',
};
const EYES = { darkBrown: '#2e1a10', brown: '#4a2c18', hazel: '#6a5530', green: '#4c6a3c', blue: '#4c6c96', grey: '#6c7a84', amber: '#8a5a20' };
const pickW = (r, table) => { let t = r() * table.reduce((a, [, w]) => a + w, 0); for (const [v, w] of table) if ((t -= w) <= 0) return v; return table[0][0]; };
function toneAt(m) {
  const f = THREE.MathUtils.clamp(m, 0, 1) * (TONES.length - 1), i = Math.min(TONES.length - 2, Math.floor(f));
  return new THREE.Color(TONES[i]).lerp(new THREE.Color(TONES[i + 1]), f - i);
}
export function lookFrom(seed, people = 'human', old = false) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  // Melanin, 0 (very fair) to 1 (very dark).
  let m = people === 'elf' ? r() * 0.22 : people === 'vampire' ? r() * 0.06 : people === 'dwarf' ? 0.1 + r() * 0.35
    : people === 'werewolf' ? 0.25 + r() * 0.4 : pickW(r, [[r() * 0.3, 3], [0.25 + r() * 0.35, 3], [0.55 + r() * 0.45, 3]]);
  const under = people === 'vampire' ? 'cool' : people === 'dwarf' ? 'pink' : pickW(r, [['pink', 2], ['neutral', 3], ['olive', 2], ['golden', 2]]);
  const skin = toneAt(m);
  if (under === 'pink') skin.offsetHSL(-0.008, 0.02, 0);
  if (under === 'olive') skin.offsetHSL(0.012, -0.03, 0);
  if (under === 'golden') skin.offsetHSL(0.01, 0.04, 0);
  if (under === 'cool') skin.lerp(new THREE.Color('#d8d4dc'), 0.35);
  // The face shape that tends to go with the tone and undertone.
  const build = {
    caucasian: m < 0.45 && under !== 'golden' ? 0.55 : 0, asian: under === 'golden' && m < 0.6 ? 0.6 : 0, african: m > 0.6 ? 0.4 + (m - 0.6) * 0.8 : 0,
    muscle: r() * 0.5, heavy: r() < 0.3 ? r() * 0.6 : 0, thin: r() < 0.3 ? r() * 0.5 : 0, old: old ? 0.5 : r() < 0.15 ? 0.3 + r() * 0.4 : 0,
  };
  const grey = build.old > 0.45 && r() < 0.7;
  const hairTable = m > 0.6 || under === 'golden' ? [['black', 6], ['darkBrown', 3], ['brown', 1]]
    : [['darkBrown', 3], ['brown', 3], ['lightBrown', 2], ['darkBlond', 2], ['blond', 1.5], ['auburn', 0.8], ['red', m < 0.15 ? 0.8 : 0.1]];
  let hair = HAIRS[grey ? (r() < 0.5 ? 'grey' : 'white') : pickW(r, hairTable)];
  if (people === 'elf' && r() < 0.5) hair = HAIRS[r() < 0.5 ? 'platinum' : 'blond'];
  const eyes = EYES[m > 0.5 ? pickW(r, [['darkBrown', 5], ['brown', 3], ['hazel', 0.5]])
    : pickW(r, [['brown', 3], ['hazel', 2], ['green', 1.5], ['blue', m < 0.25 ? 2.5 : 0.5], ['grey', 1]])];
  return {
    r, skin: '#' + skin.getHexString(), hair, eyes, build, melanin: m,
    flush: 0.7 - m * 0.55 + (people === 'dwarf' ? 0.3 : 0), freckles: m < 0.2 && (hair === HAIRS.red || hair === HAIRS.auburn || r() < 0.25) ? 0.4 + r() * 0.6 : 0,
  };
}
