// RELICS: ancient artifacts a pilot can carry (two at a time). Each gives a lasting bonus.
// Found in ruin caches and vaults, given by gods to their faithful, and dropped by the
// story's great enemies.
//
//   bonus: damage, armor, speed, mining (fractions, e.g. 0.1 = +10%), jump (sectors),
//          luck (better loot odds), regen (extra health per second), shield (personal shield)
//   rarity: 1 common … 5 legendary (also how often caches roll it)

export const RELICS = {
  // The gods' own relics, given at high favor.
  tearOfVael:      { name: 'Tear of Vael', god: 'vael', rarity: 5, bonus: { jump: 3, speed: 0.1 }, lore: 'A drop of the first ocean that never evaporates.' },
  emberOfKharon:   { name: 'Ember of Kharon-Ul', god: 'kharon', rarity: 5, bonus: { damage: 0.35 }, lore: 'A coal from the Forge Below. Still hot after ten thousand years.' },
  paleMothersVeil: { name: 'Pale Mother’s Veil', god: 'isareth', rarity: 5, bonus: { armor: 0.35, regen: 2 }, lore: 'Frost-white cloth that closes wounds it touches.' },
  thornCrown:      { name: 'The Thorn Crown', god: 'morseth', rarity: 5, bonus: { luck: 0.8, damage: 0.1 }, lore: 'It bites the brow of whoever wears it, and the hunt never fails.' },
  eyeOfOruun:      { name: 'Eye of Oruun', god: 'oruun', rarity: 5, bonus: { mining: 0.6, luck: 0.3 }, lore: 'A violet sphere that sees ore through rock.' },

  // Precursor artifacts from ruins and vaults.
  starChart:       { name: 'Precursor Star Chart', rarity: 3, bonus: { jump: 2 }, lore: 'A map of jump lanes nobody has used in an age.' },
  resonantShard:   { name: 'Resonant Shard', rarity: 2, bonus: { mining: 0.25 }, lore: 'It sings near ore veins.' },
  wardingSigil:    { name: 'Warding Sigil', rarity: 2, bonus: { armor: 0.15 }, lore: 'A carved disc that turns aside blows meant for its bearer.' },
  hunterFetish:    { name: 'Hunter’s Fetish', rarity: 1, bonus: { luck: 0.2 }, lore: 'Bone and feathers, tied with gut. It works.' },
  sunstone:        { name: 'Sunstone', rarity: 3, bonus: { damage: 0.15, regen: 0.5 }, lore: 'Warm to the touch and faintly bright.' },
  voidCompass:     { name: 'Void Compass', rarity: 3, bonus: { speed: 0.15, jump: 1 }, lore: 'Its needle points to whatever you most need to find.' },
  ancestorMask:    { name: 'Ancestor Mask', rarity: 2, bonus: { armor: 0.1, luck: 0.1 }, lore: 'The face of a Precursor, worn smooth by reverent hands.' },
  heartOfTheVault: { name: 'Heart of the Vault', rarity: 4, bonus: { shield: 30, armor: 0.1 }, lore: 'The power core of a Precursor vault, still humming.' },
  colossusEye:     { name: 'Colossus Eye', rarity: 4, bonus: { damage: 0.2, mining: 0.2 }, lore: 'Pried from the face of a fallen giant.' },
  glassRose:       { name: 'Glass Rose', rarity: 1, bonus: { regen: 0.5 }, lore: 'A flower fused from desert sand by the old catastrophe.' },

  // Imperial and rebel treasures.
  imperialSeal:    { name: 'Imperial Seal', rarity: 3, bonus: { armor: 0.15, damage: 0.05 }, lore: 'Carried by Imperial magistrates. Doors open for it.' },
  martyrsBadge:    { name: 'Martyr’s Badge', rarity: 3, bonus: { damage: 0.15, speed: 0.05 }, lore: 'Worn by the Unbound who died at the Siege of Kesh.' },
  hiveCore:        { name: 'Hive Core', rarity: 5, bonus: { damage: 0.25, shield: 20 }, lore: 'The still-beating heart of a Hollow Mothership.' },
};
export const RELIC_IDS = Object.keys(RELICS);

export const RELIC_RARITY = [null, 'Common', 'Uncommon', 'Rare', 'Mythic', 'Legendary'];
export const RELIC_COLORS = [null, '#cfd8e6', '#6aff8a', '#6aa9ff', '#c27bff', '#ffb347'];
