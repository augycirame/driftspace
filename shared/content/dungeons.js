// DUNGEONS: underground complexes reached through entrances on planet surfaces. Each one is
// generated from its seed: a maze of rooms and corridors, monsters from the theme's list,
// treasure chests, and a boss guarding the deepest room. A party enters together and shares
// one copy of the dungeon.
//
//   entrance   the structure on the surface that leads down (see structures.js)
//   tags       terrains where that entrance appears
//   enemies    creatures (from creatures.js) that live inside
//   boss       the creature waiting in the final room
//   wall, floor, light   colors for the client

export const DUNGEON_THEMES = {
  crypt: {
    name: 'Sunken Crypt', entrance: 'cryptEntrance', tags: ['bone', 'ancient', 'sand', 'ash', 'rock', 'scorched', 'temperate'],
    enemies: ['cryptGhoul', 'boneKnight', 'graveCrawler', 'bonewing'], boss: 'lichKing',
    wall: '#5a5248', floor: '#2e2a26', light: '#9affc8', fog: '#0e1410',
    relics: ['ancestorMask', 'wardingSigil', 'heartOfTheVault'],
    lore: 'Tombs of the Precursor nobility. The air tastes of dust and old incense.',
  },
  hive: {
    name: 'Hive Warren', entrance: 'hiveMound', tags: ['sand', 'fungal', 'toxic', 'forest'],
    enemies: ['hiveDrone', 'mycelid', 'duneSkitter', 'gloomBat'], boss: 'hiveQueen',
    wall: '#6a5028', floor: '#3a2a14', light: '#ffb03a', fog: '#1a1006',
    relics: ['hunterFetish', 'resonantShard', 'colossusEye'],
    lore: 'Resin tunnels that hum with a million wings.',
  },
  forge: {
    name: 'The Forge Below', entrance: 'forgeGate', tags: ['fire', 'ash', 'rock'],
    enemies: ['forgeGolem', 'emberSlime', 'magmaHound', 'cinderWing'], boss: 'magmaWyrm',
    wall: '#4a2a1e', floor: '#1e100a', light: '#ff6a2a', fog: '#1a0804',
    relics: ['sunstone', 'colossusEye', 'heartOfTheVault'],
    lore: 'Kharon-Ul’s workshops, where the stars were hammered out. The anvils are still warm.',
  },
  crystal: {
    name: 'Crystal Caverns', entrance: 'crystalCave', tags: ['crystal', 'ice', 'salt'],
    enemies: ['crystalHorror', 'shardling', 'frostWisp', 'glassCrab'], boss: 'prismTitan',
    wall: '#5a5a8a', floor: '#22223a', light: '#c8a0ff', fog: '#0c0c1a',
    relics: ['resonantShard', 'voidCompass', 'starChart'],
    lore: 'Caves of singing crystal. Every footstep becomes a chord.',
  },
  drowned: {
    name: 'Drowned Temple of Ix', entrance: 'drownedTemple', tags: ['water', 'toxic', 'fungal'],
    enemies: ['drownedThrall', 'reefLurker', 'tendril', 'bogHorror'], boss: 'eyeOfIx',
    wall: '#24485a', floor: '#10222c', light: '#4ad8e8', fog: '#041016',
    relics: ['voidCompass', 'glassRose', 'starChart'],
    lore: 'A temple the sea swallowed, where the Thralls of Ix go to listen.',
  },
};
export const DUNGEON_IDS = Object.keys(DUNGEON_THEMES);
