// Graphics quality: render resolution, bloom, shadows and detail, with presets the player
// can switch between (Options, key O). The choice is remembered in the browser.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { InkPass, stylize, setToonStyle, setHullStyle } from './toon.js';

export const STYLES = { anime: 'Anime', chibi: 'Chibi', realistic: 'Realistic' };
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
    this.level = readSetting();
    try { this.style = STYLES[localStorage.getItem('ds_style')] ? localStorage.getItem('ds_style') : 'anime'; } catch { this.style = 'anime'; }
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
    try { localStorage.setItem('ds_style', style); } catch {}
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
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = this.anime ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.anime ? this.look.exposure : 1.05;
    if (this.anime) { setToonStyle(this.style); setHullStyle(...this.look.hull); }
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
    if (!q.bloom && !anime) {
      this.renderer.render(scene, camera);
      return;
    }
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.renderPass = new RenderPass(scene, camera);
      this.composer.addPass(this.renderPass);
      this.ink = anime ? new InkPass() : null;
      if (this.ink) this.composer.addPass(this.ink);
      this.bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1, 0.5, 0.6) : null;
      if (this.bloom) this.composer.addPass(this.bloom);
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
      this.bloom.strength = strength * (anime ? (kind === 'space' ? 0.7 : 1.05) : 1);
      this.bloom.radius = radius;
      this.bloom.threshold = threshold;
    }
    this.composer.render();
  }
}
