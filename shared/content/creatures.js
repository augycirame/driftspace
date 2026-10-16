// CREATURES: everything that walks, crawls or flies on a planet surface. Each planet picks
// a few species whose tags match its terrain, so a fungal forest gets spore-things and a
// glacier gets ice-stalkers. Ruin guardians and faction soldiers appear near their structures.
//
//   tags      terrain tags the species lives in
//   shape     body plan the client draws: quad, serpent, flyer, blob, insect, biped, golem,
//             crab, tentacled, strider, alien
//   behavior  aggressive: attacks on sight · territorial: attacks if you get close
//             passive: only fights back · swarm: arrives in packs
//             guardian: protects ruins · soldier: fights for a faction
//   rarity    how often it's picked (higher = more common)

import { alienCreatures } from './aliens.js';

export const CREATURES = {
  glowmoth:      { name: 'Glowmoth', tags: ['havenOnly'], shape: 'flyer', color: '#a0ffd0', size: 0.9, hp: 25, dmg: 4, speed: 6, behavior: 'passive', rarity: 1, desc: 'Harmless, luminous, and curious. Haven’s children chase them at dusk.' },

  rockCrawler:   { name: 'Rock Crawler', tags: ['rock'], shape: 'insect', color: '#7a6a58', size: 1.3, hp: 50, dmg: 8, speed: 7, behavior: 'aggressive', rarity: 4, desc: 'A six-legged boulder with a bad temper.' },
  cliffStrider:  { name: 'Cliff Strider', tags: ['rock', 'sand'], shape: 'quad', color: '#a07050', size: 1.6, hp: 70, dmg: 10, speed: 10, behavior: 'territorial', rarity: 2, desc: 'Long-legged grazers that turn vicious near their nests.' },
  frostStalker:  { name: 'Frost Stalker', tags: ['ice'], shape: 'quad', color: '#cfe8ff', size: 1.2, hp: 60, dmg: 10, speed: 9, behavior: 'aggressive', rarity: 4, desc: 'White fur, blue eyes, and absolute patience.' },
  rimeWyrm:      { name: 'Rime Wyrm', tags: ['ice', 'water'], shape: 'serpent', color: '#9ad0f0', size: 2.2, hp: 140, dmg: 16, speed: 7, behavior: 'territorial', rarity: 1, desc: 'Swims through ice as if it were water.' },
  shardling:     { name: 'Shardling', tags: ['crystal'], shape: 'blob', color: '#c8b8ff', size: 0.8, hp: 30, dmg: 6, speed: 9, behavior: 'swarm', rarity: 3, desc: 'Living crystal fragments that hunt in chiming packs.' },
  magmaHound:    { name: 'Magma Hound', tags: ['fire'], shape: 'quad', color: '#ff7a3a', size: 1.4, hp: 80, dmg: 14, speed: 10, behavior: 'aggressive', rarity: 4, desc: 'It drinks lava and breathes what’s left.' },
  cinderWing:    { name: 'Cinder Wing', tags: ['fire', 'ash'], shape: 'flyer', color: '#ff9a4a', size: 1.1, hp: 40, dmg: 9, speed: 12, behavior: 'swarm', rarity: 2, desc: 'Burning moths as big as dogs.' },
  ashWalker:     { name: 'Ash Walker', tags: ['ash', 'scorched'], shape: 'biped', color: '#6a625c', size: 1.5, hp: 90, dmg: 12, speed: 6, behavior: 'territorial', rarity: 3, desc: 'A grey silhouette that never stops walking. Nobody knows what it was before.' },
  reefLurker:    { name: 'Reef Lurker', tags: ['water'], shape: 'serpent', color: '#3fb0a0', size: 1.2, hp: 55, dmg: 9, speed: 8, behavior: 'aggressive', rarity: 4, desc: 'Waits in the shallows with its mouth open.' },
  shellback:     { name: 'Shellback', tags: ['water', 'temperate'], shape: 'quad', color: '#8a9a6a', size: 1.8, hp: 120, dmg: 8, speed: 4, behavior: 'passive', rarity: 3, desc: 'A slow, armored beach-dweller. Leave it alone and it leaves you alone.' },
  vineBeast:     { name: 'Vine Beast', tags: ['forest'], shape: 'quad', color: '#5a9a3a', size: 1.5, hp: 65, dmg: 11, speed: 8.5, behavior: 'aggressive', rarity: 4, desc: 'Moss, thorns and teeth.' },
  canopyGlider:  { name: 'Canopy Glider', tags: ['forest', 'temperate'], shape: 'flyer', color: '#c8e86a', size: 1, hp: 35, dmg: 6, speed: 11, behavior: 'passive', rarity: 3, desc: 'Gliding herbivores that scatter like leaves.' },
  sporeLord:     { name: 'Spore Lord', tags: ['fungal'], shape: 'blob', color: '#b07ad8', size: 2, hp: 110, dmg: 13, speed: 5, behavior: 'territorial', rarity: 2, desc: 'A walking mushroom colony with opinions.' },
  mycelid:       { name: 'Mycelid', tags: ['fungal', 'toxic'], shape: 'insect', color: '#8a6aaa', size: 0.9, hp: 30, dmg: 7, speed: 9, behavior: 'swarm', rarity: 3, desc: 'Spore-fed crawlers that move as one mind.' },
  bogHorror:     { name: 'Bog Horror', tags: ['toxic'], shape: 'serpent', color: '#7ab82a', size: 2, hp: 100, dmg: 14, speed: 6, behavior: 'aggressive', rarity: 3, desc: 'Mostly mouth. The rest is worse.' },
  duneSkitter:   { name: 'Dune Skitter', tags: ['sand'], shape: 'insect', color: '#c08a4a', size: 1.1, hp: 45, dmg: 9, speed: 11, behavior: 'swarm', rarity: 4, desc: 'Sand-colored, fast, and never alone.' },
  sandWyrm:      { name: 'Sand Wyrm', tags: ['sand', 'salt'], shape: 'serpent', color: '#d8a86a', size: 2.6, hp: 180, dmg: 18, speed: 8, behavior: 'territorial', rarity: 1, desc: 'You feel it in your boots before you see it.' },
  saltDrifter:   { name: 'Salt Drifter', tags: ['salt'], shape: 'flyer', color: '#f0f0f0', size: 1, hp: 30, dmg: 5, speed: 7, behavior: 'passive', rarity: 3, desc: 'Floating jellies that feed on mineral dust.' },
  boneGnawer:    { name: 'Bone Gnawer', tags: ['bone'], shape: 'quad', color: '#d0c0a8', size: 1.3, hp: 60, dmg: 12, speed: 10, behavior: 'aggressive', rarity: 4, desc: 'Scavengers that got a taste for the living.' },
  gardenWarden:  { name: 'Garden Warden', tags: ['holy'], shape: 'flyer', color: '#ffe89a', size: 1, hp: 50, dmg: 8, speed: 9, behavior: 'passive', rarity: 2, desc: 'Gilded birds bred by the Church to keep the sacred terraces.' },

  // Ruin guardians: created by the Precursors, still keeping their oaths.
  ruinSentinel:  { name: 'Precursor Sentinel', tags: ['guardian'], shape: 'golem', color: '#8a7ab8', size: 1.8, hp: 160, dmg: 15, speed: 6, behavior: 'guardian', rarity: 3, desc: 'Stone and violet light. It asks a question in a dead language, then attacks.' },
  vaultColossus: { name: 'Vault Colossus', tags: ['guardian'], shape: 'golem', color: '#5a4a8a', size: 3, hp: 450, dmg: 26, speed: 4, behavior: 'guardian', rarity: 1, desc: 'The last door of a Precursor vault, and it walks.' },

  // Faction soldiers: hostile only to pilots their faction considers enemies.
  imperialTrooper: { name: 'Imperial Trooper', tags: ['empire'], shape: 'biped', color: '#e8e0c0', size: 1, hp: 90, dmg: 12, speed: 8, behavior: 'soldier', faction: 'empire', rarity: 3, desc: 'White-and-gold armor, a rifle, and a catechism.' },
  inquisitor:      { name: 'Inquisitor', tags: ['empire'], shape: 'biped', color: '#a01a1a', size: 1.2, hp: 180, dmg: 20, speed: 7, behavior: 'soldier', faction: 'empire', rarity: 1, desc: 'The Throne’s hunters of heresy. They can smell incense from the old gods.' },
  rebelFighter:    { name: 'Unbound Fighter', tags: ['rebellion'], shape: 'biped', color: '#c86a3a', size: 1, hp: 80, dmg: 12, speed: 9, behavior: 'soldier', faction: 'rebellion', rarity: 3, desc: 'Patched armor, a stolen rifle, and nothing to lose.' },

  // ---- more wildlife -------------------------------------------------------------------------
  glassCrab:     { name: 'Glass Crab', tags: ['crystal', 'salt'], shape: 'crab', color: '#bfe8ff', size: 1.2, hp: 70, dmg: 10, speed: 7, behavior: 'territorial', rarity: 3, desc: 'Its shell is a living prism. When it pinches, it means it.' },
  tidecrab:      { name: 'Tidecrab', tags: ['water'], shape: 'crab', color: '#d86a4a', size: 1.4, hp: 85, dmg: 11, speed: 6, behavior: 'territorial', rarity: 3, desc: 'Shore-dwelling crabs the size of a hover car.' },
  slagback:      { name: 'Slagback', tags: ['fire', 'ash'], shape: 'crab', color: '#5a3a2a', size: 1.6, hp: 130, dmg: 15, speed: 5, behavior: 'aggressive', rarity: 2, desc: 'Armored in cooled lava. Glows orange where the shell cracks.' },
  tendril:       { name: 'Lurking Tendril', tags: ['toxic', 'fungal'], shape: 'tentacled', color: '#6a8a2a', size: 1.5, hp: 90, dmg: 12, speed: 3, behavior: 'territorial', rarity: 3, desc: 'Roots that are not roots. They wait for warmth.' },
  bloomHorror:   { name: 'Bloom Horror', tags: ['forest', 'temperate'], shape: 'tentacled', color: '#d84a8a', size: 1.8, hp: 120, dmg: 14, speed: 4, behavior: 'aggressive', rarity: 1, desc: 'A beautiful flower, until it opens.' },
  frostKraken:   { name: 'Frost Kraken', tags: ['ice', 'water'], shape: 'tentacled', color: '#7ab0e0', size: 2.4, hp: 200, dmg: 18, speed: 4, behavior: 'territorial', rarity: 1, desc: 'Lives under frozen seas and breaks through when it hears footsteps.' },
  skyStrider:    { name: 'Sky Strider', tags: ['temperate', 'sand', 'salt'], shape: 'strider', color: '#e8d8a8', size: 1.6, hp: 80, dmg: 6, speed: 12, behavior: 'passive', rarity: 3, desc: 'Grazers on legs ten metres long. Herds walk over you without noticing.' },
  stiltWader:    { name: 'Stilt Wader', tags: ['water', 'toxic'], shape: 'strider', color: '#8aa0a8', size: 1.3, hp: 60, dmg: 9, speed: 9, behavior: 'territorial', rarity: 3, desc: 'Spears fish with a beak like a harpoon, and spears pilots the same way.' },
  ashStrider:    { name: 'Ash Strider', tags: ['ash', 'scorched'], shape: 'strider', color: '#4a4440', size: 1.5, hp: 90, dmg: 12, speed: 10, behavior: 'aggressive', rarity: 2, desc: 'Charred, long-legged, and always hungry.' },
  gloomBat:      { name: 'Gloom Bat', tags: ['fungal', 'rock'], shape: 'flyer', color: '#4a3a5a', size: 0.9, hp: 30, dmg: 7, speed: 13, behavior: 'swarm', rarity: 3, desc: 'Blind, silent, and in a hurry.' },
  stormRay:      { name: 'Storm Ray', tags: ['water', 'salt'], shape: 'flyer', color: '#6ab8ff', size: 1.6, hp: 70, dmg: 13, speed: 11, behavior: 'territorial', rarity: 2, desc: 'Glides on sea winds and discharges lightning through its tail.' },
  sunKite:       { name: 'Sun Kite', tags: ['sand', 'holy'], shape: 'flyer', color: '#ffd06a', size: 1.2, hp: 45, dmg: 8, speed: 12, behavior: 'passive', rarity: 2, desc: 'Golden gliders that ride thermals over hot sand.' },
  bonewing:      { name: 'Bonewing', tags: ['bone', 'ancient'], shape: 'flyer', color: '#e0d4c0', size: 1.3, hp: 55, dmg: 11, speed: 12, behavior: 'aggressive', rarity: 3, desc: 'Skeletal fliers. Nobody is sure they are alive.' },
  graveCrawler:  { name: 'Grave Crawler', tags: ['bone', 'ash'], shape: 'insect', color: '#6a5a4a', size: 1.1, hp: 55, dmg: 10, speed: 9, behavior: 'swarm', rarity: 3, desc: 'Burrowing scavengers that strip a carcass in minutes.' },
  dustDevil:     { name: 'Dust Devil', tags: ['sand', 'scorched'], shape: 'blob', color: '#d8b07a', size: 1.4, hp: 60, dmg: 9, speed: 11, behavior: 'aggressive', rarity: 2, desc: 'A whirlwind with a grudge and something solid at its heart.' },
  emberSlime:    { name: 'Ember Slime', tags: ['fire'], shape: 'blob', color: '#ff6a2a', size: 1.2, hp: 70, dmg: 12, speed: 6, behavior: 'aggressive', rarity: 3, desc: 'Molten jelly. It leaves glass where it crawls.' },
  frostWisp:     { name: 'Frost Wisp', tags: ['ice', 'crystal'], shape: 'blob', color: '#e8f8ff', size: 0.9, hp: 40, dmg: 8, speed: 10, behavior: 'swarm', rarity: 2, desc: 'Floating cold. Breathe near one and your helmet frosts over.' },
  mireToad:      { name: 'Mire Toad', tags: ['toxic', 'water'], shape: 'quad', color: '#5a7a3a', size: 1.5, hp: 90, dmg: 10, speed: 7, behavior: 'territorial', rarity: 3, desc: 'Its croak shakes the swamp. Its tongue reaches twenty metres.' },
  ironTortoise:  { name: 'Iron Tortoise', tags: ['rock', 'crystal'], shape: 'quad', color: '#6a7078', size: 2, hp: 250, dmg: 10, speed: 3, behavior: 'passive', rarity: 2, desc: 'It eats ore and grows a shell of it. Miners follow them.' },
  thunderOx:     { name: 'Thunder Ox', tags: ['temperate', 'forest'], shape: 'quad', color: '#8a6a4a', size: 2.2, hp: 220, dmg: 18, speed: 9, behavior: 'territorial', rarity: 2, desc: 'Herd beasts. Startle one and the whole herd charges.' },
  voidLeech:     { name: 'Void Leech', tags: ['crystal', 'ancient'], shape: 'serpent', color: '#3a2a5a', size: 1.6, hp: 100, dmg: 14, speed: 9, behavior: 'aggressive', rarity: 2, desc: 'Feeds on voidstone and anything that has touched it.' },

  // ---- dungeon dwellers: only found underground ---------------------------------------------
  cryptGhoul:    { name: 'Crypt Ghoul', tags: ['dungeon'], shape: 'biped', color: '#8a9a7a', size: 1.1, hp: 80, dmg: 12, speed: 9, behavior: 'aggressive', rarity: 3, desc: 'What the crypts do to the people who stay too long.' },
  boneKnight:    { name: 'Bone Knight', tags: ['dungeon'], shape: 'biped', color: '#e0d8c8', size: 1.3, hp: 160, dmg: 16, speed: 7, behavior: 'aggressive', rarity: 2, desc: 'A Precursor soldier still keeping its last watch.' },
  hiveDrone:     { name: 'Hive Drone', tags: ['dungeon'], shape: 'insect', color: '#c8a03a', size: 1, hp: 50, dmg: 9, speed: 11, behavior: 'swarm', rarity: 4, desc: 'Workers and soldiers of the hive, interchangeable and endless.' },
  forgeGolem:    { name: 'Forge Golem', tags: ['dungeon'], shape: 'golem', color: '#6a3a2a', size: 1.8, hp: 220, dmg: 18, speed: 5, behavior: 'aggressive', rarity: 2, desc: 'Built by Kharon-Ul’s smiths to guard the Forge Below.' },
  crystalHorror: { name: 'Crystal Horror', tags: ['dungeon'], shape: 'blob', color: '#c8a0ff', size: 1.4, hp: 120, dmg: 13, speed: 7, behavior: 'aggressive', rarity: 3, desc: 'Shards that pull themselves together when they hear you.' },
  drownedThrall: { name: 'Drowned Thrall', tags: ['dungeon'], shape: 'tentacled', color: '#4a6a8a', size: 1.3, hp: 100, dmg: 12, speed: 6, behavior: 'aggressive', rarity: 3, desc: 'Servants of Ix, still dripping.' },

  // ---- dungeon bosses -------------------------------------------------------------------------
  lichKing:      { name: 'The Hollow King', tags: ['boss'], shape: 'golem', color: '#d8d0ff', size: 2.6, hp: 1400, dmg: 26, speed: 6, behavior: 'aggressive', rarity: 1, boss: true, desc: 'A Precursor ruler who refused to die with his people.' },
  hiveQueen:     { name: 'Hive Queen', tags: ['boss'], shape: 'insect', color: '#ffb03a', size: 3.2, hp: 1600, dmg: 24, speed: 5, behavior: 'aggressive', rarity: 1, boss: true, desc: 'The mind of the hive, enormous and furious.' },
  magmaWyrm:     { name: 'Magma Wyrm', tags: ['boss'], shape: 'serpent', color: '#ff5a1a', size: 3.4, hp: 1800, dmg: 28, speed: 6, behavior: 'aggressive', rarity: 1, boss: true, desc: 'Coiled around the heart of the Forge Below.' },
  prismTitan:    { name: 'Prism Titan', tags: ['boss'], shape: 'golem', color: '#a0e8ff', size: 3, hp: 1500, dmg: 25, speed: 5, behavior: 'aggressive', rarity: 1, boss: true, desc: 'A Precursor war-machine grown over with singing crystal.' },
  eyeOfIx:       { name: 'The Eye of Ix', tags: ['boss'], shape: 'tentacled', color: '#c04ae8', size: 3.6, hp: 1700, dmg: 26, speed: 3, behavior: 'aggressive', rarity: 1, boss: true, desc: 'A sliver of the drowned god-mind, and it is awake.' },
};
Object.assign(CREATURES, alienCreatures());
export const CREATURE_IDS = Object.keys(CREATURES);
