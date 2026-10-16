// ALIEN_RACES: intelligent species living in the wilds beyond human space. Each race claims
// clusters of star systems, builds villages on worlds that suit it, flies its own ships,
// and (if it isn't hostile) trades with pilots.
//
//   disposition  friendly: never attacks first · neutral: defends its villages · hostile: attacks on sight
//   tags         terrains the race likes to settle
//   head         how the client draws them: tall, crest, insect, orb, tentacle, stone
//   ship         block design of their ships (same parts as player ships)

export const ALIEN_RACES = {
  vashti: {
    name: 'Vashti', desc: 'Tall, four-armed traders who sing their prices. They have a word for every kind of profit and none for war.',
    color: '#6ad8c8', accent: '#e8fff8', head: 'tall', arms: 4, disposition: 'friendly',
    tags: ['water', 'temperate', 'forest', 'salt', 'holy'], trader: 'Vashti Song-Merchant',
    ship: [[0, 0, -2, 'cockpit'], [0, 0, -1, 'cargo'], [0, 0, 0, 'cargo'], [0, 0, 1, 'thruster'], [-1, 0, 0, 'wing'], [1, 0, 0, 'wing'], [0, 1, 0, 'shield']],
  },
  krell: {
    name: 'Krell', desc: 'Scaled raiders who believe every world belongs to whoever bleeds on it last.',
    color: '#8aa83a', accent: '#d8e86a', head: 'crest', arms: 2, disposition: 'hostile',
    tags: ['rock', 'sand', 'ash', 'scorched', 'fire'], trader: null,
    ship: [[0, 0, -2, 'cockpit'], [0, 0, -1, 'armor'], [-1, 0, -1, 'gun'], [1, 0, -1, 'gun'], [0, 0, 0, 'hull'], [0, 0, 1, 'thruster'], [-1, 0, 1, 'thruster'], [1, 0, 1, 'thruster']],
  },
  myrmidar: {
    name: 'Myrmidar', desc: 'An insect hive-mind. Individuals are dim; the colony is brilliant, patient, and very territorial.',
    color: '#c89a3a', accent: '#ffd06a', head: 'insect', arms: 2, disposition: 'neutral',
    tags: ['sand', 'fungal', 'toxic', 'forest'], trader: 'Myrmidar Broker-Drone',
    ship: [[0, 0, -2, 'cockpit'], [0, 0, -1, 'hull'], [0, 0, 0, 'cargo'], [0, 0, 1, 'thruster'], [-1, 0, 0, 'gun'], [1, 0, 0, 'gun'], [0, -1, 0, 'armor']],
  },
  lumen: {
    name: 'Lumen', desc: 'Beings of slow light who wear crystal shells to talk to solid creatures. They remember the Precursors.',
    color: '#ffe8ff', accent: '#c8a0ff', head: 'orb', arms: 2, disposition: 'friendly',
    tags: ['crystal', 'ice', 'salt', 'ancient'], trader: 'Lumen Keeper of Echoes',
    ship: [[0, 0, -1, 'cockpit'], [0, 1, -1, 'shield'], [-1, 0, -1, 'wing'], [1, 0, -1, 'wing'], [0, 0, 0, 'thruster'], [0, -1, -1, 'shield']],
  },
  ix: {
    name: 'Thralls of Ix', desc: 'Psionic cephalopods ruled by a single drowned mind. Whatever Ix wants, it takes.',
    color: '#a04ac8', accent: '#ff6ad5', head: 'tentacle', arms: 2, disposition: 'hostile',
    tags: ['water', 'toxic', 'fungal'], trader: null,
    ship: [[0, 0, -2, 'cockpit'], [0, 0, -1, 'shield'], [0, 0, 0, 'hull'], [-1, 0, 0, 'gun'], [1, 0, 0, 'gun'], [0, 0, 1, 'thruster'], [0, 1, 0, 'wing'], [0, -1, 0, 'wing']],
  },
  ostrakar: {
    name: 'Ostrakar', desc: 'Stone-skinned miners who live a thousand years and hold grudges for all of them. Fair dealers, terrible enemies.',
    color: '#a08a6a', accent: '#ffb060', head: 'stone', arms: 2, disposition: 'neutral',
    tags: ['rock', 'fire', 'crystal', 'ash'], trader: 'Ostrakar Ore-Elder',
    ship: [[0, 0, -2, 'cockpit'], [0, 0, -1, 'armor'], [0, 0, 0, 'armor'], [0, 0, 1, 'thruster'], [-1, 0, 0, 'cargo'], [1, 0, 0, 'cargo'], [0, 1, -1, 'gun']],
  },
};
export const ALIEN_IDS = Object.keys(ALIEN_RACES);

export const alienWarrior = (race) => `alien_${race}`;
export const alienFolk = (race) => `folk_${race}`;

// Creature entries for each race's warriors and villagers (merged into CREATURES).
export function alienCreatures() {
  const out = {};
  for (const [id, r] of Object.entries(ALIEN_RACES)) {
    const warlike = { hostile: 'aggressive', neutral: 'territorial', friendly: 'passive' }[r.disposition];
    out[alienWarrior(id)] = {
      name: `${r.name} warrior`, tags: ['alien'], shape: 'alien', head: r.head, arms: r.arms, color: r.color, accent: r.accent,
      size: id === 'ostrakar' ? 1.3 : 1.1, hp: 110, dmg: 13, speed: 8, behavior: warlike, race: id, rarity: 1,
      desc: `${r.name} who guard their villages. ${r.disposition === 'hostile' ? 'They attack on sight.' : r.disposition === 'neutral' ? 'Keep your distance from their homes.' : 'They only fight if you do.'}`,
    };
    out[alienFolk(id)] = {
      name: `${r.name} villager`, tags: ['alien'], shape: 'alien', head: r.head, arms: r.arms, color: r.accent, accent: r.color,
      size: 0.9, hp: 40, dmg: 4, speed: 5, behavior: 'passive', race: id, rarity: 1, desc: r.desc,
    };
  }
  return out;
}
