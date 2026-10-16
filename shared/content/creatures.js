// CREATURES: everything that walks, crawls or flies on a planet surface. Each planet picks
// a few species whose tags match its terrain, so a fungal forest gets spore-things and a
// glacier gets ice-stalkers. Ruin guardians and faction soldiers appear near their structures.
//
//   tags      terrain tags the species lives in
//   shape     body plan the client draws: quad, serpent, flyer, blob, insect, biped, golem
//   behavior  aggressive: attacks on sight · territorial: attacks if you get close
//             passive: only fights back · swarm: arrives in packs
//             guardian: protects ruins · soldier: fights for a faction
//   rarity    how often it's picked (higher = more common)

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
};
export const CREATURE_IDS = Object.keys(CREATURES);
