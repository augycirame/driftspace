// TERRAINS: every kind of ground a planet can have. When a planet is generated it picks one
// terrain that suits its type (rocky, ice, lava…). Add an entry here and new planets start
// using it; nothing else needs to change.
//
//   planetTypes  which planet types can have this terrain, and how often (weight)
//   amp, rough   hill height and small-scale roughness
//   water        height of the liquid surface (null for none)
//   low/mid/high ground colors by height; sky and fog colors; liquid color
//   ore          what digging turns up, with weights
//   flora        decorations: [kind, weight]. Kinds: tree, palm, rock, spike, cactus,
//                mushroom, crystal, bone, reed, deadtree, coral
//   tags         biome words that creatures and structures look for

export const TERRAINS = {
  havenMeadows: {
    name: 'Haven Meadows', planetTypes: {}, amp: 34, rough: 7, water: -4,
    low: '#3a5a2a', mid: '#3f7a3a', high: '#6a8a5a', sky: '#9fd0c0', fog: '#a8d8c0', liquid: '#2a7a6a',
    ore: [['iron', 5], ['copper', 3], ['gold', 1]], flora: [['tree', 1]], density: 1, tags: ['temperate', 'forest'],
    desc: 'Gentle green hills around Haven Landing. Every pilot remembers their first steps here.',
  },
  sacredGardens: {
    name: 'Sacred Gardens', planetTypes: {}, amp: 18, rough: 3, water: -2,
    low: '#6a8a4a', mid: '#8aa85a', high: '#e8dca0', sky: '#ffe8b8', fog: '#fff0c8', liquid: '#7fd8e8',
    ore: [['gold', 4], ['copper', 3], ['iron', 2]], flora: [['tree', 3], ['crystal', 1]], density: 0.8, tags: ['temperate', 'holy'],
    desc: 'The tended terraces of Aurelis, holy capital of the Radiant Empire. Every blade of grass is counted.',
  },
  highlands: {
    name: 'Barren Highlands', planetTypes: { Rocky: 4 }, amp: 42, rough: 9, water: null,
    low: '#5e5249', mid: '#7d6c5f', high: '#a39383', sky: '#8a7f78', fog: '#9b8f86', liquid: null,
    ore: [['iron', 6], ['copper', 3], ['gold', 1]], flora: [['rock', 1]], density: 1, tags: ['rock'],
    desc: 'Wind-scoured stone plateaus. Good iron, little else.',
  },
  canyonlands: {
    name: 'Canyonlands', planetTypes: { Rocky: 3, Desert: 2 }, amp: 70, rough: 14, water: null,
    low: '#8a4a2a', mid: '#b0643a', high: '#d89a6a', sky: '#e8b890', fog: '#e0a880', liquid: null,
    ore: [['copper', 5], ['iron', 4], ['gold', 2]], flora: [['rock', 2], ['deadtree', 1]], density: 0.7, tags: ['rock', 'sand'],
    desc: 'Red gorges carved by rivers that dried up a million years ago.',
  },
  craterFields: {
    name: 'Crater Fields', planetTypes: { Rocky: 2, Ice: 1 }, amp: 16, rough: 12, water: null,
    low: '#4a4a52', mid: '#6a6a74', high: '#9a9aa6', sky: '#2a2a38', fog: '#3a3a48', liquid: null,
    ore: [['iron', 4], ['voidstone', 0.6], ['gold', 1]], flora: [['rock', 2], ['crystal', 1]], density: 0.5, tags: ['rock', 'crystal'],
    desc: 'An airless, pockmarked plain. Meteor strikes left voidstone in the craters.',
  },
  glassDesert: {
    name: 'Glass Desert', planetTypes: { Desert: 1, Rocky: 1, Lava: 1 }, amp: 14, rough: 3, water: null,
    low: '#4a6a6a', mid: '#7aa0a0', high: '#c8e8e0', sky: '#a8d0d8', fog: '#c0e0e8', liquid: null,
    ore: [['ice', 2], ['gold', 3], ['voidstone', 1]], flora: [['crystal', 3], ['bone', 1]], density: 0.6, tags: ['sand', 'crystal', 'scorched', 'ancient'],
    desc: 'Sand fused to glass by an ancient catastrophe. The ruins here are older than the stars nearby.',
  },
  glacier: {
    name: 'Glacier Sheet', planetTypes: { Ice: 4 }, amp: 28, rough: 6, water: -6,
    low: '#9fc4d8', mid: '#d6ecf7', high: '#ffffff', sky: '#bcd7ea', fog: '#d4e6f2', liquid: '#7fb8d8',
    ore: [['ice', 7], ['iron', 2], ['voidstone', 0.3]], flora: [['spike', 1]], density: 1, tags: ['ice'],
    desc: 'Endless blue-white ice. Things move underneath it.',
  },
  frozenSea: {
    name: 'Frozen Sea', planetTypes: { Ice: 2, Ocean: 1 }, amp: 20, rough: 3, water: 2,
    low: '#6a8aa0', mid: '#c8e0ee', high: '#f0f8ff', sky: '#9ab8d0', fog: '#c0d4e4', liquid: '#a8d8f0',
    ore: [['ice', 8], ['copper', 1]], flora: [['spike', 2], ['rock', 1]], density: 0.4, tags: ['ice', 'water'],
    desc: 'An ocean that froze mid-wave. The surface groans when you walk on it.',
  },
  crystalTundra: {
    name: 'Crystal Tundra', planetTypes: { Ice: 2, Rocky: 1 }, amp: 24, rough: 8, water: null,
    low: '#8a9ab8', mid: '#b8c8e8', high: '#e8e0ff', sky: '#b8a8e0', fog: '#c8b8f0', liquid: null,
    ore: [['ice', 3], ['voidstone', 1.2], ['gold', 1]], flora: [['crystal', 3], ['spike', 1]], density: 0.8, tags: ['ice', 'crystal'],
    desc: 'Singing crystal spires grow from the frost. They hum when the Silent Eye is near.',
  },
  volcanic: {
    name: 'Volcanic Wastes', planetTypes: { Lava: 4 }, amp: 38, rough: 10, water: -8,
    low: '#2a1a14', mid: '#3d2a22', high: '#5a4033', sky: '#5a2a1a', fog: '#6b3020', liquid: '#ff5a1a',
    ore: [['copper', 5], ['gold', 3], ['voidstone', 0.8]], flora: [['rock', 2], ['deadtree', 1]], density: 0.8, tags: ['fire', 'rock'],
    desc: 'Black rock and rivers of fire. The Forge Below is close to the surface here.',
  },
  ashPlains: {
    name: 'Ash Plains', planetTypes: { Lava: 2, Rocky: 1 }, amp: 18, rough: 5, water: null,
    low: '#3a3634', mid: '#5a5450', high: '#8a827c', sky: '#6a5e58', fog: '#7a6e66', liquid: null,
    ore: [['iron', 4], ['copper', 3], ['gold', 1]], flora: [['deadtree', 3], ['bone', 1]], density: 0.6, tags: ['ash', 'scorched'],
    desc: 'Grey ash to the horizon, still warm. Something burned this world on purpose.',
  },
  magmaSea: {
    name: 'Magma Sea', planetTypes: { Lava: 2 }, amp: 30, rough: 9, water: 2,
    low: '#1a1210', mid: '#3a2418', high: '#5a3a2a', sky: '#7a2a10', fog: '#8a3418', liquid: '#ff7a2a',
    ore: [['gold', 4], ['copper', 3], ['voidstone', 1]], flora: [['rock', 1]], density: 0.5, tags: ['fire'],
    desc: 'Islands of basalt in a sea of molten rock. Rich, if you survive the heat.',
  },
  archipelago: {
    name: 'Archipelago', planetTypes: { Ocean: 4 }, amp: 30, rough: 5, water: 4,
    low: '#c9b98a', mid: '#4f8f4a', high: '#7a8a6a', sky: '#8fc4f0', fog: '#a9d2f2', liquid: '#2a6fb0',
    ore: [['ice', 4], ['iron', 3], ['copper', 2]], flora: [['palm', 1]], density: 1, tags: ['water', 'temperate'],
    desc: 'A thousand green islands in a warm sea.',
  },
  coralShallows: {
    name: 'Coral Shallows', planetTypes: { Ocean: 2 }, amp: 14, rough: 4, water: 3,
    low: '#e8d0a8', mid: '#d88a8a', high: '#e8b0c0', sky: '#a8e0f0', fog: '#c0e8f4', liquid: '#3ab0c8',
    ore: [['copper', 3], ['gold', 2], ['ice', 2]], flora: [['coral', 3], ['palm', 1]], density: 1, tags: ['water'],
    desc: 'Knee-deep turquoise water over living reefs.',
  },
  rainforest: {
    name: 'Rainforest', planetTypes: { Jungle: 4 }, amp: 34, rough: 7, water: -4,
    low: '#3a5a2a', mid: '#3f7a3a', high: '#6a8a5a', sky: '#9fd0c0', fog: '#a8d8c0', liquid: '#2a7a6a',
    ore: [['iron', 5], ['copper', 3], ['gold', 1]], flora: [['tree', 1]], density: 1.3, tags: ['forest', 'temperate'],
    desc: 'Dense canopy and constant rain. The Thorned Crown hunts here.',
  },
  fungalForest: {
    name: 'Fungal Forest', planetTypes: { Jungle: 2, Ocean: 1 }, amp: 26, rough: 6, water: -6,
    low: '#3a2a4a', mid: '#5a3a6a', high: '#8a6a9a', sky: '#7a5a9a', fog: '#8a6aaa', liquid: '#6a4aaa',
    ore: [['copper', 4], ['voidstone', 0.7], ['iron', 2]], flora: [['mushroom', 3], ['reed', 1]], density: 1, tags: ['fungal', 'forest'],
    desc: 'Mushrooms the size of towers, glowing violet in the dusk.',
  },
  toxicSwamp: {
    name: 'Toxic Swamp', planetTypes: { Jungle: 2, Ocean: 1 }, amp: 12, rough: 4, water: 1,
    low: '#3a4a1a', mid: '#4a5a2a', high: '#6a7a3a', sky: '#8a9a4a', fog: '#7a8a3a', liquid: '#7ab82a',
    ore: [['copper', 3], ['iron', 3], ['gold', 1]], flora: [['reed', 3], ['deadtree', 1]], density: 1, tags: ['toxic', 'water'],
    desc: 'Bubbling green water and a smell that gets into your helmet.',
  },
  duneSea: {
    name: 'Dune Sea', planetTypes: { Desert: 4 }, amp: 22, rough: 4, water: null,
    low: '#c99a5b', mid: '#d8b27a', high: '#e8cf9a', sky: '#f0d8a8', fog: '#f0dcb0', liquid: null,
    ore: [['iron', 4], ['gold', 2], ['copper', 2]], flora: [['cactus', 1]], density: 1, tags: ['sand'],
    desc: 'Rolling golden dunes. Ruins surface and sink again with the wind.',
  },
  saltFlats: {
    name: 'Salt Flats', planetTypes: { Desert: 2, Ice: 1 }, amp: 6, rough: 2, water: null,
    low: '#d8d4cc', mid: '#ece8e0', high: '#ffffff', sky: '#c8e0f0', fog: '#e0ecf4', liquid: null,
    ore: [['ice', 3], ['copper', 2], ['gold', 2]], flora: [['crystal', 1], ['rock', 1]], density: 0.3, tags: ['salt', 'sand'],
    desc: 'Blinding white and perfectly flat. You can see a temple from fifty kilometres.',
  },
  boneWastes: {
    name: 'Bone Wastes', planetTypes: { Desert: 1, Rocky: 1, Ice: 1 }, amp: 20, rough: 6, water: null,
    low: '#8a7a6a', mid: '#b0a08a', high: '#e0d4c0', sky: '#a89888', fog: '#b8a898', liquid: null,
    ore: [['iron', 3], ['gold', 2], ['voidstone', 0.9]], flora: [['bone', 3], ['rock', 1]], density: 0.6, tags: ['bone', 'ancient', 'sand'],
    desc: 'Ribcages of creatures the size of starships. Whatever killed them was bigger.',
  },
};

export const TERRAIN_IDS = Object.keys(TERRAINS);
