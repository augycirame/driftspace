// FACTIONS and GODS: the powers of the galaxy.
//
// The Radiant Empire rules a great swath of stars from its holy capital, Aurelis, where the
// Emperor is worshipped as the Radiant Throne. The Unbound rebellion fights it along the
// frontier. Long before either, the Precursors raised temples to five ancient gods. The
// Empire calls that heresy; the rebels have started to pray again.

export const FACTIONS = {
  empire: {
    name: 'The Radiant Empire', short: 'Empire', color: '#f2cf4a',
    desc: 'A thousand worlds ruled from the holy capital of Aurelis in the name of the Radiant Throne. Order, tithes, and inquisitors.',
    ships: 'Imperial patrol', station: ['Bastion', 'Citadel', 'Prefecture', 'Tithe Station'],
    titles: [[-50, 'Enemy of the Throne'], [-15, 'Wanted'], [15, 'Neutral'], [50, 'Citizen'], [80, 'Knight of the Throne'], [101, 'Exalted']],
  },
  rebellion: {
    name: 'The Unbound', short: 'Rebellion', color: '#ff6a4a',
    desc: 'Smugglers, deserters and heretics on the Empire’s frontier, fighting for worlds without a throne. They have started praying to the old gods.',
    ships: 'Rebel raider', station: ['Hideout', 'Freehold', 'Den', 'Haven-in-Exile'],
    titles: [[-50, 'Collaborator'], [-15, 'Suspect'], [15, 'Neutral'], [50, 'Sympathizer'], [80, 'Comrade'], [101, 'Hero of the Unbound']],
  },
};
export const FACTION_IDS = Object.keys(FACTIONS);

export const HOLY_CAPITAL = {
  planet: 'Aurelis',
  station: 'Sanctum of the Radiant Throne',
  desc: 'Holy capital of the Radiant Empire. Pilgrims come from a hundred sectors to be blessed at the Sanctum. Those the Empire has declared wanted do not leave.',
  blessing: { name: 'Radiant Benediction', tithe: 250, minutes: 20, bonus: { damage: 0.2, armor: 0.2 }, minRep: 15 },
};

// Territory names shown in the HUD and on the map.
export const TERRITORY = {
  haven:     { name: 'Haven Free Colonies', color: '#78ffaa' },
  empire:    { name: 'Imperial space', color: '#f2cf4a' },
  capital:   { name: 'The Holy Capital', color: '#ffe89a' },
  rebellion: { name: 'Rebel frontier', color: '#ff6a4a' },
  wilds:     { name: 'The Wilds', color: '#9aa8c0' },
};

export function factionTitle(faction, rep) {
  for (const [max, title] of FACTIONS[faction].titles) if (rep < max) return title;
  return FACTIONS[faction].titles.at(-1)[1];
}

export const HOSTILE_REP = -15;

// The ancient gods. Each has shrines on worlds that suit it, a blessing for those who pray,
// and a relic it gives to the faithful.
export const GODS = {
  vael: {
    name: 'Vael, the Drowned Star', domain: 'Voids and voyages', color: '#6ab8ff',
    blessing: { jump: 2, speed: 0.15 }, relic: 'tearOfVael', tags: ['water', 'ice', 'crystal'],
    lore: 'Vael fell from the sky into the first ocean and still guides lost ships home. Sailors leave salt on her altars.',
  },
  kharon: {
    name: 'Kharon-Ul, the Forge Below', domain: 'Fire and weapons', color: '#ff7a3a',
    blessing: { damage: 0.25 }, relic: 'emberOfKharon', tags: ['fire', 'ash', 'rock'],
    lore: 'The smith-god who hammered the stars out of the dark. His forges still burn under volcanic worlds.',
  },
  isareth: {
    name: 'Isareth, the Pale Mother', domain: 'Life and endurance', color: '#e8f0ff',
    blessing: { armor: 0.3, regen: 1 }, relic: 'paleMothersVeil', tags: ['ice', 'temperate', 'salt'],
    lore: 'She wrapped the first living things in frost so they would survive the long night. Her faithful are hard to kill.',
  },
  morseth: {
    name: 'Mor-Seth, the Thorned Crown', domain: 'The hunt', color: '#7ad84a',
    blessing: { luck: 0.5, speed: 0.1 }, relic: 'thornCrown', tags: ['forest', 'fungal', 'toxic'],
    lore: 'The hunter-king who wears the forest as a crown. He rewards those who take their prey cleanly.',
  },
  oruun: {
    name: 'Oruun, the Silent Eye', domain: 'Secrets and riches', color: '#c27bff',
    blessing: { mining: 0.4, luck: 0.25 }, relic: 'eyeOfOruun', tags: ['ancient', 'crystal', 'bone', 'sand'],
    lore: 'The god who watched everything and said nothing. The Precursors built their vaults in Oruun’s name.',
  },
};
export const GOD_IDS = Object.keys(GODS);

export const PRAYER = { minutes: 15, cooldownMinutes: 10, favorForRelic: 5 };
