// The galaxy's storyline. Arcs run one after another for the whole server; every pilot's
// actions push the shared goals forward, and finishing an arc permanently changes the game.
// After the last arc a new era begins: the story repeats with bigger goals and the galaxy
// keeps the changes from every era before it.

import { mulberry32, hash2, range } from './rng.js';
import { generateSector } from './universe.js';

export const ARCS = [
  {
    id: 'signal',
    title: 'The Silent Signal',
    intro: [
      'HAVEN COMMAND: All pilots, a signal is pulsing from beyond the charted sectors. It repeats every 41 seconds and it is getting louder.',
      'Our analysts say the decoder needs voidstone and a lot of iron. Deliver what you can to any station. Every shipment counts.',
    ],
    outro: 'HAVEN COMMAND: The decoder is live. The signal is not a message. It is a countdown. Something is coming.',
    goals: [
      { id: 'deliver:voidstone', label: 'Voidstone delivered', target: 40 },
      { id: 'deliver:iron', label: 'Iron delivered', target: 400 },
    ],
  },
  {
    id: 'swarm',
    title: 'The Hollow Swarm',
    intro: [
      'HAVEN COMMAND: Contact. Organic ships pouring out of nowhere. We are calling them the Hollow. They are in every sector, even ours.',
      'Destroy every Hollow you find. Stations under siege will pay bounties. Fly in parties. Stay alive.',
    ],
    outro: 'HAVEN COMMAND: The Hive Mothership is down. Its core is still transmitting coordinates. Coordinates to something ancient.',
    goals: [
      { id: 'kill:hollow', label: 'Hollow ships destroyed', target: 120 },
      { id: 'kill:mothership', label: 'Hive Mothership destroyed', target: 1, after: 'kill:hollow' },
    ],
    effects: { invasion: true },
  },
  {
    id: 'gate',
    title: 'The Ancient Gate',
    intro: [
      'HAVEN COMMAND: The coordinates match a precursor gate design. If we build it at Haven, it will open a road to the Far Reach, a thousand sectors out.',
      'Bring materials to any station. This is the biggest thing anyone has ever built out here.',
    ],
    outro: 'HAVEN COMMAND: The Gate is open. Aetherium has been sighted out in the deep. Haven Station can send you to the Far Reach any time.',
    goals: [
      { id: 'deliver:iron', label: 'Iron delivered', target: 1500 },
      { id: 'deliver:copper', label: 'Copper delivered', target: 600 },
      { id: 'deliver:gold', label: 'Gold delivered', target: 150 },
      { id: 'deliver:voidstone', label: 'Voidstone delivered', target: 60 },
    ],
    complete: { gateBuilt: true },
  },
  {
    id: 'echoes',
    title: 'Echoes of the Precursors',
    intro: [
      'HAVEN COMMAND: Since the Gate opened, five planets have started singing. Precursor relics, buried on their surfaces.',
      'Find them and wake them. Check your journal for where they are.',
    ],
    outro: 'HAVEN COMMAND: All five relics are awake. Every jump drive in the galaxy just reached further. A new era begins.',
    goals: [{ id: 'relic', label: 'Precursor relics awakened', target: 5 }],
    complete: { jumpBonus: 2 },
    relics: true,
  },
];

export function eraScale(era) {
  return 1 + era * 0.5;
}

export function goalTarget(goal, era, scale = 1) {
  if (goal.id === 'relic' || goal.id === 'kill:mothership') return goal.target;
  return Math.max(1, Math.round(goal.target * eraScale(era) * scale));
}

// Where this era's Hive Mothership appears: a few sectors out from Haven.
export function mothershipSector(era, seed) {
  const rng = mulberry32(hash2(era, 17, seed));
  const a = rng() * Math.PI * 2, d = 4 + Math.floor(rng() * 3);
  return [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)];
}

// The five relic planets of this era, with where each relic sits on its surface.
export function relicSites(era, seed) {
  const rng = mulberry32(hash2(era, 23, seed));
  const sites = [];
  let guard = 0;
  while (sites.length < 5 && guard++ < 2000) {
    const a = rng() * Math.PI * 2, d = range(rng, 8, 24);
    const sx = Math.round(Math.cos(a) * d), sz = Math.round(Math.sin(a) * d);
    const s = generateSector(sx, sz, seed);
    const p = s.planets.find((pl) => pl.landable);
    if (!p || sites.some((x) => x.planet === p.id)) continue;
    sites.push({ planet: p.id, name: p.name, sx, sz, x: range(rng, -260, 260), z: range(rng, -260, 260) });
  }
  return sites;
}

// What the current story state does to the galaxy. Server and client both read this.
export function storyEffects(story) {
  const arc = ARCS[story.arc] || ARCS[0];
  return {
    era: story.era,
    arc: story.arc,
    invasion: !!arc.effects?.invasion,
    gateBuilt: !!story.flags.gateBuilt,
    jumpBonus: story.flags.jumpBonus || 0,
    mothership: arc.id === 'swarm' && goalDone(story, 'kill:hollow') && !goalDone(story, 'kill:mothership'),
  };
}

export function goalDone(story, goalId) {
  const arc = ARCS[story.arc];
  const g = arc && arc.goals.find((x) => x.id === goalId);
  return !!g && (story.progress[goalId] || 0) >= goalTarget(g, story.era, story.scale);
}

export function newStory() {
  return { era: 0, arc: 0, progress: {}, flags: {}, relicsFound: [], log: [], scale: 1, startedAt: Date.now() };
}
