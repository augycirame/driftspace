// STRUCTURES: buildings that generate on planet surfaces: Precursor ruins, shrines to the
// ancient gods, Imperial and rebel bases, wrecks. A planet picks a few whose tags match its
// terrain (and, for faction bases, whose territory it's in).
//
//   kind       ruin · shrine · imperial · rebel · wreck · holy · dungeon · village
//   tags       terrain tags it can appear on ('any' for anywhere)
//   territory  only appears in that territory (empire, rebellion, capital)
//   parts      what it's built from, relative to its centre. Each part is
//              [shape, x, y, z, size1, size2, size3, color, glow?, tiltRadians?]
//              box: w h d · cyl: radius height · cone: radius height · sphere: radius · ring: radius tube
//   cache      loot a pilot can take once: credits [min, max], item chance, relic chance
//   guardians  [creature, count] that wake when someone comes close
//   lore       shown in the codex and when you interact

const STONE = '#8a8278', DARKSTONE = '#5a544e', VIOLET = '#b86bff', GOLD = '#e8c547', WHITE = '#e8e4da';

export const STRUCTURES = {
  obelisk: {
    name: 'Precursor Obelisk', kind: 'ruin', tags: ['any'], rarity: 2, radius: 6,
    parts: [['box', 0, 1, 0, 6, 2, 6, DARKSTONE], ['box', 0, 9, 0, 2.4, 14, 2.4, STONE], ['cone', 0, 17, 0, 1.7, 3, 4, VIOLET, true]],
    cache: { credits: [40, 120], item: 0.3, relic: 0.08 },
    lore: 'Precursor waymarkers. The script spirals upward and ends in a question.',
  },
  monolithRing: {
    name: 'Ring of Monoliths', kind: 'ruin', tags: ['any'], rarity: 2, radius: 14,
    parts: [
      ['box', 12, 5, 0, 2, 10, 3, STONE], ['box', -12, 5, 0, 2, 10, 3, STONE], ['box', 0, 5, 12, 3, 10, 2, STONE], ['box', 0, 5, -12, 3, 10, 2, STONE],
      ['box', 8.5, 4, 8.5, 2, 8, 2, STONE], ['box', -8.5, 4, -8.5, 2, 8, 2, STONE], ['box', 8.5, 3, -8.5, 2, 6, 2, DARKSTONE, false, 0.4],
      ['cyl', 0, 0.3, 0, 4, 0.6, 0, VIOLET, true],
    ],
    cache: { credits: [60, 160], item: 0.4, relic: 0.12 },
    guardians: ['ruinSentinel', 1],
    lore: 'Twelve stones, eight still standing. At night they line up with stars that no longer exist.',
  },
  ziggurat: {
    name: 'Sunken Ziggurat', kind: 'ruin', tags: ['sand', 'forest', 'toxic', 'water', 'salt'], rarity: 2, radius: 16,
    parts: [['box', 0, 2, 0, 30, 4, 30, STONE], ['box', 0, 6, 0, 22, 4, 22, STONE], ['box', 0, 10, 0, 14, 4, 14, DARKSTONE], ['box', 0, 14, 0, 7, 4, 7, STONE], ['box', 0, 17, 0, 3, 2, 3, VIOLET, true]],
    cache: { credits: [120, 300], item: 0.6, relic: 0.25 },
    guardians: ['ruinSentinel', 2],
    lore: 'Half swallowed by the ground. Each tier is carved with the same god looking in a different direction.',
  },
  colossus: {
    name: 'Fallen Colossus', kind: 'ruin', tags: ['sand', 'rock', 'ash', 'bone', 'scorched', 'salt'], rarity: 2, radius: 18,
    parts: [
      ['box', 0, 2.5, 0, 26, 5, 8, STONE, false, 0.05], ['sphere', 16, 4, 0, 5, 0, 0, STONE], ['box', -12, 2, 5, 12, 3, 3, DARKSTONE],
      ['box', -12, 2, -5, 12, 3, 3, DARKSTONE], ['box', 4, 1.5, 8, 10, 3, 3, STONE], ['sphere', 18, 5, 2, 1, 0, 0, VIOLET, true],
    ],
    cache: { credits: [100, 260], item: 0.5, relic: 0.2 },
    guardians: ['ruinSentinel', 1],
    lore: 'A statue of a god, three hundred meters tall before it fell. One eye still glows.',
  },
  vault: {
    name: 'Vault of the Ancients', kind: 'ruin', tags: ['ancient', 'crystal', 'bone', 'sand', 'rock'], rarity: 1, radius: 16,
    parts: [
      ['box', 0, 5, 0, 20, 10, 20, DARKSTONE], ['box', 0, 11, 0, 16, 2, 16, STONE], ['box', 0, 4, -10.2, 6, 8, 0.6, VIOLET, true],
      ['cyl', 9, 7, 9, 1.5, 14, 0, STONE], ['cyl', -9, 7, 9, 1.5, 14, 0, STONE], ['cyl', 9, 7, -9, 1.5, 14, 0, STONE], ['cyl', -9, 7, -9, 1.5, 14, 0, STONE],
    ],
    cache: { credits: [300, 700], item: 0.9, relic: 0.6 },
    guardians: ['vaultColossus', 1],
    lore: 'Sealed by the Precursors before they vanished. Whatever they hid, they wanted to come back for it.',
  },
  shrine: {
    name: 'Shrine of the Old Gods', kind: 'shrine', tags: ['any'], rarity: 3, radius: 7,
    parts: [['cyl', 0, 0.4, 0, 6, 0.8, 0, STONE], ['box', -4, 4, 0, 1.2, 8, 1.2, STONE], ['box', 4, 4, 0, 1.2, 8, 1.2, STONE], ['box', 0, 8.4, 0, 10, 1, 1.6, STONE], ['sphere', 0, 2.2, 0, 1.1, 0, 0, '@god', true]],
    lore: 'A small altar to one of the five. Pray here to receive its god’s blessing.',
  },
  temple: {
    name: 'Temple of the Old Gods', kind: 'shrine', tags: ['any'], rarity: 1, radius: 15,
    parts: [
      ['box', 0, 1, 0, 26, 2, 18, STONE], ['cyl', -11, 7, -7, 1.3, 12, 0, WHITE], ['cyl', 11, 7, -7, 1.3, 12, 0, WHITE], ['cyl', -11, 7, 7, 1.3, 12, 0, WHITE],
      ['cyl', 11, 7, 7, 1.3, 12, 0, WHITE], ['box', 0, 13.5, 0, 28, 1.5, 20, STONE], ['cone', 0, 17, 0, 12, 5, 4, DARKSTONE], ['sphere', 0, 5, 0, 2.2, 0, 0, '@god', true],
    ],
    cache: { credits: [80, 200], item: 0.3, relic: 0.15 },
    lore: 'A great temple of one of the five gods. The Empire has tried to burn it more than once.',
  },
  imperialGarrison: {
    name: 'Imperial Garrison', kind: 'imperial', tags: ['any'], territory: 'empire', rarity: 3, radius: 16,
    parts: [
      ['box', 0, 4, 0, 18, 8, 12, WHITE], ['box', 0, 8.6, 0, 19, 1.2, 13, GOLD], ['cyl', 10, 8, 7, 2, 16, 0, WHITE], ['cone', 10, 17.5, 7, 2.6, 3, 8, GOLD],
      ['box', 0, 12, 0, 0.3, 8, 0.3, '#444'], ['box', 0, 15, 1, 0.1, 3, 2, GOLD, true],
    ],
    cache: { credits: [150, 350], item: 0.5, relic: 0.05, relics: ['imperialSeal'] },
    soldiers: ['imperialTrooper', 3],
    lore: 'Throne-sanctioned garrison. Its banners name the sector’s prefect and the tithe owed.',
  },
  listeningPost: {
    name: 'Imperial Listening Post', kind: 'imperial', tags: ['any'], territory: 'empire', rarity: 2, radius: 8,
    parts: [['box', 0, 2, 0, 6, 4, 6, WHITE], ['cyl', 0, 9, 0, 0.5, 10, 0, '#888'], ['ring', 0, 14, 0, 3, 0.25, 0, GOLD, true]],
    cache: { credits: [60, 150], item: 0.3 },
    soldiers: ['imperialTrooper', 1],
    lore: 'It listens for heresy on every band. It is always listening.',
  },
  inquisitionSpire: {
    name: 'Inquisition Spire', kind: 'imperial', tags: ['any'], territory: 'capital', rarity: 2, radius: 9,
    parts: [['box', 0, 3, 0, 8, 6, 8, '#3a2a2a'], ['cone', 0, 16, 0, 4, 20, 4, '#5a1a1a'], ['sphere', 0, 27, 0, 1.2, 0, 0, '#ff3a3a', true]],
    soldiers: ['inquisitor', 1],
    lore: 'Where the Empire questions heretics. The questions take a long time.',
  },
  rebelHideout: {
    name: 'Unbound Hideout', kind: 'rebel', tags: ['any'], territory: 'rebellion', rarity: 3, radius: 12,
    parts: [
      ['box', 0, 2, 0, 12, 4, 8, '#5a4a3a'], ['box', 0, 4.3, 0, 14, 0.6, 10, '#7a3a2a'], ['box', 8, 1.5, 4, 4, 3, 4, '#6a5a4a'],
      ['cyl', -7, 3, -4, 0.2, 6, 0, '#444'], ['box', -6, 5.5, -4, 2.4, 1.6, 0.1, '#ff6a4a', true],
    ],
    cache: { credits: [120, 300], item: 0.5, relic: 0.05, relics: ['martyrsBadge'] },
    soldiers: ['rebelFighter', 3],
    lore: 'Patched tarps, a radio, and a flag with a broken crown.',
  },
  supplyCache: {
    name: 'Rebel Supply Cache', kind: 'rebel', tags: ['any'], territory: 'rebellion', rarity: 2, radius: 6,
    parts: [['box', 0, 1, 0, 3, 2, 2, '#5a6a3a'], ['box', 2.5, 0.8, 1, 2, 1.6, 2, '#5a6a3a'], ['box', -2, 0.7, -1, 2, 1.4, 1.4, '#4a5a2a']],
    cache: { credits: [80, 220], item: 0.6 },
    lore: 'Crates stamped with Imperial markings, all of them stolen.',
  },
  crashedFreighter: {
    name: 'Crashed Freighter', kind: 'wreck', tags: ['any'], rarity: 4, radius: 14,
    parts: [['box', 0, 3, 0, 8, 6, 26, '#5a6070', false, 0.15], ['box', 0, 5, -14, 6, 4, 4, '#3a4050', false, 0.3], ['box', 6, 2, 6, 6, 1, 10, '#4a5060', false, -0.5]],
    cache: { credits: [60, 200], item: 0.4 },
    lore: 'Its transponder still broadcasts a cargo manifest. Most of the cargo is gone.',
  },
  miningRig: {
    name: 'Abandoned Mining Rig', kind: 'wreck', tags: ['rock', 'ice', 'fire', 'crystal', 'ash'], rarity: 2, radius: 10,
    parts: [['box', 0, 1.5, 0, 10, 3, 10, '#6a5a4a'], ['cyl', 0, 10, 0, 1, 16, 0, '#8a7a5a'], ['box', 0, 17, 0, 6, 2, 2, '#e0864f'], ['cyl', 3, 6, 3, 2, 6, 0, '#5a4a3a']],
    cache: { credits: [40, 120], item: 0.2 },
    lore: 'The crew left in a hurry. The drill is still in the ground.',
  },
  pilgrimCamp: {
    name: 'Pilgrim Camp', kind: 'holy', tags: ['holy'], rarity: 3, radius: 9,
    parts: [['cone', -3, 1.5, 0, 2, 3, 6, '#e8dcc0'], ['cone', 3, 1.5, 1, 2, 3, 6, '#e0d0b0'], ['cone', 0, 1.5, -4, 2, 3, 6, '#e8dcc0'], ['sphere', 0, 0.6, 1, 0.6, 0, 0, '#ffb060', true]],
    lore: 'Pilgrims rest here on the road to the Sanctum. They sing hymns to the Radiant Throne.',
  },
  cathedral: {
    name: 'Cathedral of the Radiant Throne', kind: 'holy', tags: [], rarity: 0, radius: 34,
    parts: [
      ['box', 0, 8, 0, 40, 16, 60, WHITE], ['box', 0, 17, 0, 42, 2, 62, GOLD], ['cone', 0, 30, 0, 18, 26, 4, WHITE],
      ['cyl', -24, 22, -28, 4, 44, 0, WHITE], ['cyl', 24, 22, -28, 4, 44, 0, WHITE], ['cone', -24, 48, -28, 5, 8, 8, GOLD], ['cone', 24, 48, -28, 5, 8, 8, GOLD],
      ['sphere', 0, 46, 0, 4, 0, 0, '#fff4c0', true], ['box', 0, 8, -30.4, 12, 14, 0.8, GOLD, true],
    ],
    lore: 'The heart of the Empire. The Radiant Throne itself sits beneath the golden dome, and nobody has seen the Emperor’s face in four hundred years.',
  },

  // ---- dungeon entrances: interact to go underground (themes in dungeons.js) ---------------
  cryptEntrance: {
    name: 'Crypt Entrance', kind: 'dungeon', dungeon: 'crypt', tags: ['bone', 'ancient', 'sand', 'ash', 'rock', 'scorched', 'temperate'], rarity: 3, radius: 9,
    parts: [['box', 0, 1, 0, 12, 2, 10, DARKSTONE], ['box', -4, 4.5, 0, 1.6, 7, 1.6, STONE], ['box', 4, 4.5, 0, 1.6, 7, 1.6, STONE], ['box', 0, 8.5, 0, 10, 1.4, 2, STONE], ['box', 0, 3, 0.2, 6, 4.5, 0.5, '#050505'], ['sphere', 0, 6.5, 0.6, 0.6, 0, 0, '#9affc8', true]],
    lore: 'Stairs lead down into the dark. Something down there has been waiting a long time.',
  },
  hiveMound: {
    name: 'Hive Mound', kind: 'dungeon', dungeon: 'hive', tags: ['sand', 'fungal', 'toxic', 'forest'], rarity: 3, radius: 10,
    parts: [['sphere', 0, 0, 0, 9, 0, 0, '#8a6a3a'], ['cone', 0, 9, 0, 4, 10, 8, '#7a5a2a'], ['cyl', 0, 2, -8.2, 2.4, 4, 0, '#140c04'], ['sphere', 0, 14, 0, 0.8, 0, 0, '#ffb03a', true]],
    lore: 'A mound of hardened resin, buzzing faintly. The tunnel mouth is just wide enough for a pilot.',
  },
  forgeGate: {
    name: 'Gate of the Forge', kind: 'dungeon', dungeon: 'forge', tags: ['fire', 'ash', 'rock'], rarity: 2, radius: 10,
    parts: [['box', 0, 1, 0, 14, 2, 10, '#2a1a14'], ['box', -5, 6, 0, 2.4, 10, 2.4, '#3a2418'], ['box', 5, 6, 0, 2.4, 10, 2.4, '#3a2418'], ['box', 0, 11.5, 0, 13, 2, 3, '#3a2418'], ['box', 0, 5, 0.3, 7.5, 8, 0.5, '#ff5a1a', true]],
    lore: 'An iron gate in the mountainside, glowing from within. You can hear hammering.',
  },
  crystalCave: {
    name: 'Crystal Cave', kind: 'dungeon', dungeon: 'crystal', tags: ['crystal', 'ice', 'salt'], rarity: 3, radius: 9,
    parts: [['sphere', 0, 0, 0, 7, 0, 0, '#5a5a7a'], ['cone', -4, 5, 2, 1.5, 9, 5, '#c8a0ff', true], ['cone', 4, 4, 1, 1.2, 7, 5, '#a0e8ff', true], ['cone', 1, 6, -3, 1, 6, 5, '#c8a0ff', true], ['cyl', 0, 2, -6.5, 2.6, 4.5, 0, '#0a0a14']],
    lore: 'A cave mouth fringed with humming crystal.',
  },
  drownedTemple: {
    name: 'Drowned Temple', kind: 'dungeon', dungeon: 'drowned', tags: ['water', 'toxic', 'fungal'], rarity: 2, radius: 10,
    parts: [['box', 0, 1, 0, 14, 2, 14, '#2a4a52'], ['cyl', -5, 5, -5, 1.2, 8, 0, '#3a5a62'], ['cyl', 5, 5, -5, 1.2, 8, 0, '#3a5a62', false, 0.2], ['cone', 0, 6, 0, 6, 6, 4, '#1e3a42'], ['cyl', 0, 2.2, -6.5, 2.2, 4, 0, '#041016'], ['sphere', 0, 10, 0, 1, 0, 0, '#c04ae8', true]],
    lore: 'Half-sunk steps lead down into green water and a staircase beneath it.',
  },

  // ---- alien villages: built by whichever race claims the system (see aliens.js) ----------
  alienVillage: {
    name: 'Alien Village', kind: 'village', tags: [], rarity: 0, radius: 22,
    parts: [
      ['sphere', 0, 0, 0, 7, 0, 0, '@race'], ['cone', 0, 11, 0, 2, 14, 6, '@accent', true],
      ['sphere', 13, 0, 4, 4, 0, 0, '@race'], ['sphere', -12, 0, 6, 4.5, 0, 0, '@race'], ['sphere', 4, 0, -13, 3.5, 0, 0, '@race'],
      ['sphere', -8, 0, -11, 3, 0, 0, '@race'], ['cyl', 0, 0.2, 0, 20, 0.4, 0, '@accent'], ['ring', 0, 16, 0, 3, 0.3, 0, '@accent', true],
    ],
    residents: 4, warriors: 3,
    lore: 'An alien settlement. If they trade, their merchants sell things no human shop has.',
  },
};
export const STRUCTURE_IDS = Object.keys(STRUCTURES);
