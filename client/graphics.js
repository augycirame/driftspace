// Graphics quality: render resolution, bloom, shadows and detail, with presets the player
// can switch between (Options, key O). The choice is remembered in the browser.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { InkPass, stylize, setToonStyle, setHullStyle } from './toon.js';
import { setRealism } from './realism.js';

export const STYLES = { realistic: 'Realistic', anime: 'Anime', chibi: 'Chibi' };

// The camera: a gentle vignette, fine film grain, a touch of lens fringing at the edges and a
// filmic contrast curve, applied in linear light before tone mapping.
const CinemaShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.28 }, grain: { value: 0.025 }, fringe: { value: 0.0006 }, contrast: { value: 1.1 }, saturation: { value: 1.14 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float vignette; uniform float grain; uniform float fringe; uniform float contrast; uniform float saturation; uniform float aspect;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
      vec2 off = c * fringe * r2 * 8.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, saturation);
      col = lum > 0.0 ? col * pow(max(lum, 1e-4), contrast - 1.0) : col;
      col *= 1.0 - vignette * smoothstep(0.15, 0.85, r2 * 1.6);
      // Film grain, in proportion to the light (this runs before tone mapping, which lifts the darks).
      col *= 1.0 + (h(vUv * 1000.0 + fract(time) * 37.0) - 0.5) * grain * 3.0;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};
// Realistic exposure and glow by kind of scene.
const REAL = { surface: { exposure: 0.66, bloom: [0.14, 0.45, 5] }, space: { exposure: 0.85, bloom: [0.4, 0.6, 1.4] }, dungeon: { exposure: 1.05, bloom: [0.5, 0.55, 0.7] } };
// Ink line weight per kind of scene, and the look of each cel-shaded style. Anime is the grounded,
// painted look of a seinen series: thin sepia lines, natural colors, a gentle warm grade. Chibi is
// bright and cute: bold black lines and punchy colors.
const INK = { space: { thickness: 1.4, normalK: 0.9 }, surface: { thickness: 1.7, normalK: 0.8 }, dungeon: { thickness: 1.6, normalK: 0.8 } };
const LOOK = {
  anime: { lineScale: 0.85, ink: '#22180f', inkAlpha: 0.95, saturation: 1.0, vignette: 0.4, grade: [1.03, 1.0, 0.95], hull: ['#22180f', 0.003], exposure: 1.12 },
  chibi: { lineScale: 1, ink: '#1a1020', inkAlpha: 0.92, saturation: 1.3, vignette: 1, grade: [1, 1, 1], hull: ['#1a1020', 0.0045], exposure: 1.08 },
};

export const QUALITY = {
  low:    { name: 'Low',    scale: 0.75, bloom: false, shadows: 0,    sky: false, flora: 0.5, planetTex: 256,  flare: false },
  medium: { name: 'Medium', scale: 1,    bloom: true,  shadows: 1024, sky: true,  flora: 1,   planetTex: 512,  flare: false },
  high:   { name: 'High',   scale: 1.25,  bloom: true,  shadows: 2048, sky: true,  flora: 1.5, planetTex: 1024, flare: true },
  ultra:  { name: 'Ultra',  scale: 1.75,    bloom: true,  shadows: 4096, sky: true,  flora: 2,   planetTex: 1024, flare: true },
};

// How much each kind of scene glows.
const BLOOM = { space: [0.85, 0.5, 0.78], surface: [0.35, 0.4, 0.86], dungeon: [0.9, 0.6, 0.55] };

function readSetting() {
  try { const q = localStorage.getItem('ds_quality'); if (QUALITY[q]) return q; } catch {}
  // A sensible default: phones and small screens start lower.
  return Math.min(screen.width, screen.height) < 700 ? 'low' : 'high';
}

export class Graphics {
  static QUALITY = QUALITY;

  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.level = readSetting();
    // Realistic is the default; a saved choice (from Options) wins.
    try { this.style = STYLES[localStorage.getItem('ds_style2')] ? localStorage.getItem('ds_style2') : 'realistic'; } catch { this.style = 'realistic'; }
    setRealism(this.style === 'realistic');
    this.scenes = new Set();
    this.frame = 0;
    this.listeners = [];
    this.apply();
  }

  get q() { return QUALITY[this.level]; }

  set(level) {
    if (!QUALITY[level]) return;
    this.level = level;
    try { localStorage.setItem('ds_quality', level); } catch {}
    this.apply();
    for (const fn of this.listeners) fn(this.q);
  }

  onChange(fn) { this.listeners.push(fn); }

  setStyle(style) {
    if (!STYLES[style]) return;
    this.style = style;
    try { localStorage.setItem('ds_style2', style); } catch {}
    setRealism(style === 'realistic');
    for (const sc of this.scenes) stylize(sc, style !== 'realistic');
    this.apply();
    for (const fn of this.listeners) fn(this.q);
  }

  // Both anime styles share the cel-shaded pipeline.
  get anime() { return this.style !== 'realistic'; }
  get look() { return LOOK[this.style] || LOOK.anime; }

  apply() {
    const q = this.q;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, Math.min(window.devicePixelRatio || 1, 1.5) * q.scale)));
    this.renderer.shadowMap.enabled = q.shadows > 0;
    // Soft, physically plausible shadow edges in the realistic style.
    this.renderer.shadowMap.type = this.anime ? THREE.PCFShadowMap : THREE.VSMShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = this.anime ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = this.anime ? this.look.exposure : REAL.surface.exposure;
    if (this.anime) { setToonStyle(this.style); setHullStyle(...this.look.hull); } else setHullStyle('#000000', 0);
    this.composer?.dispose?.();
    this.composer = null;
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }

  // Render a scene: cel-shading and ink lines in the anime style, bloom when quality allows.
  render(scene, camera, kind = 'space') {
    const anime = this.anime, q = this.q;
    this.scenes.add(scene);
    if (anime && (++this.frame % 6 === 0 || scene !== this.lastScene)) stylize(scene, true);
    this.lastScene = scene;
    const real = !anime;
    if (real) this.renderer.toneMappingExposure = REAL[kind].exposure * (kind === 'surface' ? this.exposureK || 1 : 1);
    if (!q.bloom && !anime && q.scale < 1) {
      this.renderer.render(scene, camera);
      return;
    }
    if (!this.composer) {
      // Realistic: render into a multisampled HDR target so edges are smooth.
      const rt = real ? new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.scale >= 1 ? 4 : 0 }) : undefined;
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.renderPass = new RenderPass(scene, camera);
      this.composer.addPass(this.renderPass);
      this.ink = anime ? new InkPass() : null;
      if (this.ink) this.composer.addPass(this.ink);
      this.bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1, 0.5, 0.6) : null;
      if (this.bloom) this.composer.addPass(this.bloom);
      this.cinema = real ? new ShaderPass(CinemaShader) : null;
      if (this.cinema) this.composer.addPass(this.cinema);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(innerWidth, innerHeight);
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.ink) {
      this.ink.scene = scene;
      this.ink.camera = camera;
      const look = this.look, ink = this.ink.settings;
      Object.assign(ink, INK[kind]);
      ink.thickness *= look.lineScale;
      ink.ink.set(look.ink);
      ink.inkAlpha = look.inkAlpha;
      ink.saturation = look.saturation;
      ink.vignette = look.vignette;
      ink.grade.setRGB(...look.grade);
      // Speed lines kick in near top speed (set each frame by the game as a 0..1 fraction).
      const target = kind === 'space' ? Math.max(0, (this.speed || 0) - 0.55) / 0.45 : 0;
      this.ink.settings.speed = kind === 'space' ? this.ink.settings.speed + (target - this.ink.settings.speed) * 0.1 : 0;
      this.ink.settings.time = performance.now() / 1000;
    }
    if (this.bloom) {
      const [strength, radius, threshold] = BLOOM[kind];
      const rb = real ? REAL[kind].bloom : null;
      this.bloom.strength = real ? rb[0] : strength * (kind === 'space' ? 0.7 : 1.05);
      this.bloom.radius = real ? rb[1] : radius;
      this.bloom.threshold = real ? rb[2] : threshold;
    }
    if (this.cinema) {
      const u = this.cinema.uniforms;
      u.time.value = performance.now() / 1000;
      u.aspect.value = innerWidth / innerHeight;
      u.vignette.value = kind === 'space' ? 0.35 : 0.26;
    }
    this.composer.render();
  }
}
