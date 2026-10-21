// The Spire: floor after floor of labyrinth, each ending in a floor boss. The front line (the
// highest open floor) is shared by everyone on the server and climbs when a party clears it.

import { DUNGEON_THEMES } from './content/dungeons.js';
import { mulberry32, hashString, pick } from './rng.js';

export const MAX_FLOOR = 100;
const THEMES = Object.keys(DUNGEON_THEMES);
const NAMES = ['Illfang', 'Asterion', 'Gleameyes', 'Nerius', 'Fatal Scythe', 'Baran', 'Kagachi', 'Morvath', 'Ashkar', 'Velgrim', 'Oruth', 'Sarzael', 'Thrandor', 'Xyllia', 'Grimmaw', 'Ulgoth', 'Zerathis', 'Kharn', 'Nyxara', 'Volkas'];
const TITLES = ['the Kobold Lord', 'the Taurus King', 'the Blue Demon', 'the Hollow Knight', 'the Skull Reaper', 'the General', 'the Serpent', 'the Gatekeeper', 'the Devourer', 'the Iron Colossus', 'Lord of Ash', 'the Twin-Headed', 'the Crowned Wyrm', 'the Shattered', 'Queen of Thorns', 'the Pale Rider', 'the Abyss Watcher', 'the Storm Tyrant'];

export const floorTheme = (floor) => THEMES[(floor - 1) % THEMES.length];
export const floorSeed = (floor) => hashString(`spire:${floor}`) >>> 0;
// Deeper labyrinths further up; enemies scale with the floor.
export const floorDepth = (floor) => Math.min(8, 1 + Math.floor((floor - 1) / 2));
export const floorScale = (floor) => 1 + 0.35 * (floor - 1);

export function floorBoss(floor) {
  const rng = mulberry32(floorSeed(floor) ^ 0x9e3779b9);
  return {
    name: ((n, t) => (t.startsWith("the ") ? `${n} ${t}` : `${n}, ${t}`))(pick(rng, NAMES), pick(rng, TITLES)),
    species: DUNGEON_THEMES[floorTheme(floor)].boss,
    hp: 5 + floor * 0.6, // times the species' own health, before party scaling
    dmg: 1.4 + floor * 0.08,
    size: 1.6,
  };
}

// A raid boss grows with the party that fights it.
export const raidScale = (members) => 1 + 0.8 * Math.max(0, members - 1);
