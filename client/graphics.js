// Graphics quality: render resolution, bloom, shadows and detail, with presets the player
// can switch between (Options, key O). The choice is remembered in the browser.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

  apply() {
    const q = this.q;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, Math.min(window.devicePixelRatio || 1, 1.5) * q.scale)));
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.needsUpdate = true;
    this.composer?.dispose?.();
    this.composer = null;
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }

  // Render a scene, through bloom when the quality setting allows it.
  render(scene, camera, kind = 'space') {
    if (!this.q.bloom) {
      this.renderer.render(scene, camera);
      return;
    }
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.renderPass = new RenderPass(scene, camera);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1, 0.5, 0.6);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(innerWidth, innerHeight);
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    const [strength, radius, threshold] = BLOOM[kind];
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
    this.composer.render();
  }
}
