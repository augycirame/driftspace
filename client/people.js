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
  ]).then(([gltf, regions, detail, face, eye]) => {
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
    lib = { templates, regions, detail, face, eye };
    return lib;
  }).catch((e) => { console.warn('people model failed to load', e); loading = null; throw e; });
  return loading;
}
export const peopleReady = () => !!lib;

// ---- materials --------------------------------------------------------------------------------------

const BODY_PARS = `
  uniform sampler2D tRegions; uniform sampler2D tDetail; uniform sampler2D tFace;
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
  vec3 wrapIrr = ( saturate( ( nlRaw + 0.45 ) / 1.45 ) * vec3( 1.0, 0.72, 0.62 ) * ( 1.0 - dotNL ) + dotNL ) * directLight.color;
  reflectedLight.directDiffuse += mix( irradiance, wrapIrr, rSkin ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);

function bodyMaterial(o) {
  const m = new THREE.MeshPhysicalMaterial({
    color: o.skin, roughness: 0.55, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(o.skin).lerp(new THREE.Color('#ff8a70'), 0.5),
    normalMap: cc0Normal('fabric'), normalScale: new THREE.Vector2(0.55, 0.55),
  });
  m.normalMap.repeat.set(26, 26);
  const U = {
    tRegions: { value: lib.regions }, tDetail: { value: lib.detail }, tFace: { value: lib.face },
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
        float top = max( isTorso * neckline, isArm * ( 1.0 - smoothstep( uSleeve - 0.01, uSleeve + 0.01, arm ) ) ) * ( 1.0 - glove );
        float boot = isLeg * smoothstep( uBoot - 0.005, uBoot + 0.005, leg );
        float pants = isLeg * ( 1.0 - smoothstep( uPant - 0.01, uPant + 0.01, leg ) ) * ( 1.0 - boot );
        float cloth = max( top, pants );
        rSkin = 1.0 - max( cloth, max( glove, boot ) );
        // Face: lips, brows, lash line and beard shadow.
        vec3 skin = diffuseColor.rgb;
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

const SKINS = ['#f1d3c0', '#e8c0a4', '#d9a888', '#c08a68', '#9a6a4a', '#6e4a34', '#4e3426'];
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
  const bones = {};
  let body = null;
  g.traverse((n) => {
    if (n.isBone) bones[n.name.slice(sex.length + 1)] = n;
    if (n.isSkinnedMesh) {
      n.castShadow = n.receiveShadow = true;
      n.frustumCulled = false;
      const key = n.name.slice(sex.length + 1);
      if (key === 'body') body = n;
      else if (key === 'eyes') n.material = eyeMaterial(o.eyes);
      else if (key.startsWith('hair')) {
        const want = { crop: 'hair_crop', long: 'hair_long', bun: 'hair_long' }[o.hairStyle] || 'hair_crop';
        n.visible = !o.bald && (key === want || (o.hairStyle === 'bun' && key === 'hair_bun'));
        n.material = hairMaterial(o.hair, key !== 'hair_bun');
      }
      if (n.morphTargetDictionary) for (const [k, i] of Object.entries(n.morphTargetDictionary)) n.morphTargetInfluences[i] = o.build?.[k] || 0;
    }
  });
  // Necklines: a high collar for flight suits, lower for tunics (as a height on the body, like the bake).
  const neckY = modelPos(bones.neck01, g).y;
  o.neck = (neckY + (o.suit ? 0.075 : o.robe ? 0.03 : 0.0)) / 1.75;
  body.material = bodyMaterial(o);
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
  if (o.apron) put('root', rbox(0.26, 0.55, 0.012, 0.2), leather(o.apron), 0, -0.05, -0.14, 0.06);
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

  // The rifle, carried at the low ready.
  let rifle = null;
  if (o.gun) {
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
  const pose = (t, moving) => {
    const k = Math.min(1, moving), ph = t * 7.2, s = Math.sin(ph) * k;
    B.root.position.y = hipY - 0.012 * k + Math.abs(Math.cos(ph)) * 0.022 * k;
    B.root.quaternion.setFromAxisAngle(Y, s * 0.06);
    B.spine03.quaternion.setFromAxisAngle(Y, -s * 0.05);
    B.spine01.quaternion.setFromAxisAngle(X, Math.sin(t * 1.6) * 0.012);
    // Legs.
    B.upperleg01_L.quaternion.setFromAxisAngle(X, -s * 0.38);
    B.upperleg01_R.quaternion.setFromAxisAngle(X, s * 0.38);
    const kneeL = -(Math.max(0, -Math.cos(ph)) * 0.7 * k + 0.03), kneeR = -(Math.max(0, Math.cos(ph)) * 0.7 * k + 0.03);
    B.lowerleg01_L.quaternion.setFromAxisAngle(X, kneeL);
    B.lowerleg01_R.quaternion.setFromAxisAngle(X, kneeR);
    // Feet stay roughly level.
    B.foot_L.quaternion.setFromAxisAngle(X, -(-s * 0.38 + kneeL) * 0.8);
    B.foot_R.quaternion.setFromAxisAngle(X, -(s * 0.38 + kneeR) * 0.8);
    if (rifle) {
      // Rifle at the low ready in front of the chest; both hands on it.
      const chest = modelPos(B.spine02, g);
      rifle.position.set(chest.x + 0.06, chest.y - 0.12 + Math.sin(t * 1.6) * 0.004, chest.z - 0.22);
      rifle.rotation.set(-0.15, 0, 0);
      g.updateMatrixWorld(true);
      const grip = new THREE.Vector3(0.0, -0.075, 0.05).applyEuler(rifle.rotation).add(rifle.position);
      const guard = new THREE.Vector3(0.0, -0.035, -0.22).applyEuler(rifle.rotation).add(rifle.position);
      reach(g, B.upperarm01_R, B.lowerarm01_R, B.wrist_R, grip, new THREE.Vector3(0.6, -0.7, 0.3));
      reach(g, B.upperarm01_L, B.lowerarm01_L, B.wrist_L, guard, new THREE.Vector3(-0.6, -0.7, 0.2));
      B.wrist_R.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
      B.wrist_L.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5);
      curl('L', 1); curl('R', 1);
    } else {
      const hold = o.spear || o.staff || o.hammer;
      hang('L', s * 0.4, o.shield ? 1.45 : 0.15 + Math.max(0, s) * 0.4);
      hang('R', hold ? 0.1 : -s * 0.4, hold ? 1.25 : 0.15 + Math.max(0, -s) * 0.4);
      curl('R', hold ? 1 : 0.35);
      curl('L', o.shield ? 0.8 : 0.35);
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
export function lookFrom(seed) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  const eth = r();
  const skinI = eth < 0.33 ? Math.floor(r() * 3) : eth < 0.66 ? 2 + Math.floor(r() * 2) : 4 + Math.floor(r() * 3);
  return {
    r,
    skin: SKINS[Math.min(SKINS.length - 1, skinI)],
    build: {
      caucasian: eth < 0.33 ? 0.6 : 0, asian: eth >= 0.33 && eth < 0.66 ? 0.6 : 0, african: eth >= 0.66 ? 0.6 : 0,
      muscle: r() * 0.5, heavy: r() < 0.3 ? r() * 0.6 : 0, thin: r() < 0.3 ? r() * 0.5 : 0, old: r() < 0.2 ? 0.3 + r() * 0.5 : 0,
    },
  };
}
