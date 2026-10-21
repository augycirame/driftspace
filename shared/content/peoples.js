// The native peoples of the galaxy's worlds: who lives where, how they look, how they build,
// how they are ruled, what they trade, and what they're called. Towns, their people and their
// politics are generated from these (shared/towns.js).

export const PEOPLES = {
  human: {
    name: 'Reachfolk', noun: 'human', plural: 'humans',
    lore: 'Descendants of the first colony ships, gone native long ago. Farmers, traders and stubborn soldiers.',
    habitats: { temperate: 5, forest: 3, water: 3, sand: 2, salt: 1, rock: 2, ice: 1, holy: 2 },
    style: 'timber', height: 1, ears: false, beard: 0.35,
    skin: ['#f1d1ba', '#e2b896', '#c89470', '#a0704c', '#7a5236'],
    hair: ['#d9c28e', '#8a6038', '#4a3426', '#1f1a1c', '#9a4a2a', '#b89a6a'],
    eyes: ['#7a8ab0', '#7a5a3a', '#6a8a6a', '#5a4a3a'],
    clothes: ['#a8903a', '#7a5a3a', '#5a6a4a', '#8a3a2a', '#4a5a7a', '#9a8a6a'],
    governments: ['kingdom', 'council', 'chiefdom'],
    goods: ['grain', 'ale', 'wool', 'tools', 'timber'],
    temperament: 'practical, wary of strangers until they prove themselves, fond of ale and old songs',
    syll: { first: ['Al', 'Bran', 'Ced', 'Ed', 'Ger', 'Hal', 'Ing', 'Mar', 'Os', 'Ro', 'Sig', 'Tor', 'Wil', 'Ast', 'Bjor', 'Eir', 'Fre', 'Hel', 'Ast', 'Thor'],
      mid: ['', 'a', 'e', 'i', 'o', 'ri', 'la', 'ny'], last: ['ric', 'win', 'da', 'mund', 'wyn', 'helm', 'gar', 'ny', 'rid', 'ulf', 'a', 'is'],
      place: ['ford', 'stead', 'holm', 'by', 'wick', 'ton', 'vale', 'dal', 'haven', 'gard'] },
    gods: ['Wanderer', 'Hearth'],
  },
  elf: {
    name: 'Eldar', noun: 'elf', plural: 'elves',
    lore: 'Long-lived and patient, the Eldar shape living wood and starlight. They keep the old magics and older grudges.',
    habitats: { forest: 6, holy: 4, crystal: 3, temperate: 3, water: 2, fungal: 1 },
    style: 'elven', height: 1.06, ears: true, beard: 0,
    skin: ['#f6e2d4', '#ecd2c0', '#d8c0b0', '#c8b8c8'],
    hair: ['#f0e6c8', '#e8e8e8', '#c8b8a0', '#2a2a3a', '#6a4a8a', '#c87a4a'],
    eyes: ['#6ac8a8', '#8ab8e8', '#b8a8e8', '#c8b86a'],
    clothes: ['#e8e4d8', '#4a7a5a', '#6a8a9a', '#8a7aa8', '#c8b878'],
    governments: ['conclave', 'kingdom'],
    goods: ['silk', 'moonwine', 'herbs', 'bows', 'starlight'],
    temperament: 'graceful, proud, speaks in measured and slightly archaic phrases, slow to trust',
    syll: { first: ['Ae', 'Cael', 'El', 'Fae', 'Gal', 'Il', 'Lir', 'Mel', 'Nim', 'Sy', 'Thal', 'Val', 'Ys', 'Ari'],
      mid: ['an', 'el', 'ith', 'ar', 'ri', 'ae', 'lo', 'na'], last: ['dril', 'wen', 'ion', 'thas', 'riel', 'mir', 'ra', 'las', 'nor', 'eth'],
      place: ['lorien', 'dell', 'sylva', 'thil', 'aras', 'ondor', 'mere', 'wood'] },
    gods: ['Moon', 'Verdance'],
  },
  dwarf: {
    name: 'Khazar', noun: 'dwarf', plural: 'dwarves',
    lore: 'Stout miners and master smiths who carve halls into the roots of mountains. Their word is iron; their grudges are older.',
    habitats: { rock: 6, ice: 3, fire: 3, crystal: 4, ash: 1, salt: 2 },
    style: 'dwarven', height: 0.78, ears: false, beard: 0.95,
    skin: ['#e8c0a0', '#d8a888', '#b8886a', '#8a6248'],
    hair: ['#8a3a1a', '#5a3a22', '#2a2220', '#b8b0a0', '#c87a3a', '#6a6a6a'],
    eyes: ['#5a4a3a', '#6a7a8a', '#3a5a4a'],
    clothes: ['#6a3a2a', '#4a4a5a', '#7a6a3a', '#3a4a3a', '#8a2a2a'],
    governments: ['thanehold', 'council'],
    goods: ['mithril', 'iron', 'tools', 'ale', 'gems'],
    temperament: 'gruff, blunt, honor-bound, loves a good bargain and despises cheats',
    syll: { first: ['Bal', 'Dur', 'Gim', 'Thor', 'Kil', 'Bof', 'Dw', 'Grom', 'Har', 'Mor', 'Brok', 'Dag', 'Rur', 'Thra'],
      mid: ['', 'a', 'o', 'u', 'in', 'ar'], last: ['in', 'li', 'ek', 'grim', 'din', 'rak', 'bur', 'dun', 'nar', 'ok', 'rim'],
      place: ['karak', 'heim', 'dun', 'deep', 'forge', 'gard', 'hold', 'barad'] },
    gods: ['Forge'],
  },
  vampire: {
    name: 'Nocturne', noun: 'vampire', plural: 'vampires',
    lore: 'An old and elegant aristocracy of the night. They trade in secrets and blood, and their manors never quite sleep.',
    habitats: { ash: 5, scorched: 3, bone: 4, ancient: 3, toxic: 2, rock: 1, ice: 1 },
    style: 'gothic', height: 1.04, ears: false, beard: 0.1, curse: 'vampire',
    skin: ['#ece6ea', '#e0d8e0', '#d4ccd8'],
    hair: ['#141218', '#e8e4ec', '#4a1a2a', '#2a2430', '#8a8a9a'],
    eyes: ['#c81a2a', '#a8102a', '#e83a3a'],
    clothes: ['#2a1a2a', '#4a0e1a', '#1a1a24', '#3a2a4a', '#6a1a2a'],
    governments: ['court'],
    goods: ['bloodwine', 'secrets', 'velvet', 'silver', 'relics'],
    temperament: 'charming, sardonic, coldly polite, always weighing what you are worth',
    syll: { first: ['Vlad', 'Mor', 'Sel', 'Lu', 'Dra', 'Cas', 'Ser', 'Vic', 'Is', 'Ca', 'Na', 'Ver', 'Ze'],
      mid: ['an', 'e', 'i', 'or', 'ra', 'en'], last: ['imir', 'gana', 'ene', 'cius', 'mira', 'sian', 'ade', 'tine', 'ova', 'ius'],
      place: ['mourn', 'grave', 'shade', 'crypt', 'noct', 'veil', 'thorn', 'crimson'] },
    gods: ['Night'],
  },
  werewolf: {
    name: 'Lycan Clans', noun: 'werewolf', plural: 'werewolves',
    lore: 'Proud hunting clans who share their bodies with the wolf. By day, hunters and storytellers; by night, something else.',
    habitats: { forest: 4, ice: 4, fungal: 3, temperate: 2, rock: 2, toxic: 1 },
    style: 'clan', height: 1.08, ears: false, beard: 0.5, curse: 'werewolf',
    skin: ['#e0bc9c', '#c89878', '#a87858', '#8a6044'],
    hair: ['#5a4a3a', '#8a8070', '#2a2420', '#c8c0b0', '#6a4a2a'],
    eyes: ['#e8a83a', '#d8c84a', '#c88a2a'],
    clothes: ['#6a5040', '#4a3a2a', '#7a6a50', '#5a4a3a'],
    governments: ['clan'],
    goods: ['furs', 'pelts', 'meat', 'bone charms', 'herbs'],
    temperament: 'fierce, loyal to the pack, few words, respects strength and despises cowardice',
    syll: { first: ['Fen', 'Ul', 'Rag', 'Sko', 'Ar', 'Var', 'Gar', 'Ka', 'Tyr', 'Hroth', 'Bey', 'Ylv'],
      mid: ['', 'a', 'u', 'ri', 'o'], last: ['rir', 'fang', 'ulf', 'mar', 'ka', 'grim', 'hild', 'nar', 'wyn', 'ga'],
      place: ['howl', 'den', 'fang', 'moon', 'pack', 'claw', 'hollow', 'tooth'] },
    gods: ['Moon', 'Hunt'],
  },
};
export const PEOPLE_IDS = Object.keys(PEOPLES);

// How each people governs itself, and what its rulers are called.
export const GOVERNMENTS = {
  kingdom: { name: 'Kingdom', ruler: ['King', 'Queen'], realm: 'Kingdom of', succession: 'heir' },
  council: { name: 'Free Council', ruler: ['Speaker', 'Speaker'], realm: 'Free Council of', succession: 'vote' },
  chiefdom: { name: 'Chiefdom', ruler: ['Chief', 'Chief'], realm: 'Chiefdom of', succession: 'strongest' },
  conclave: { name: 'Conclave', ruler: ['High Archon', 'High Archon'], realm: 'Conclave of', succession: 'vote' },
  thanehold: { name: 'Thanehold', ruler: ['Thane', 'Thane'], realm: 'Thanehold of', succession: 'heir' },
  court: { name: 'Night Court', ruler: ['Count', 'Countess'], realm: 'Night Court of', succession: 'strongest' },
  clan: { name: 'Clan', ruler: ['Alpha', 'Alpha'], realm: 'Clan', succession: 'strongest' },
};

// The people who live in a town, by role. Rulers live in the capital; the rest anywhere.
export const ROLES = {
  ruler: { name: '%ruler%', talk: true, guard: false },
  steward: { name: 'Steward', talk: true },
  captain: { name: 'Captain of the Guard', talk: true, armed: true },
  merchant: { name: 'Merchant', talk: true, trade: true },
  smith: { name: 'Smith', talk: true, trade: true },
  priest: { name: 'Priest', talk: true },
  healer: { name: 'Healer', talk: true },
  innkeeper: { name: 'Innkeeper', talk: true },
  mage: { name: 'Mage', talk: true },
  hunter: { name: 'Hunter', talk: true },
  farmer: { name: 'Farmer', talk: true },
  bard: { name: 'Bard', talk: true },
  guard: { name: 'Guard', talk: true, armed: true },
};

// Town sizes: how many buildings and people, and which roles they need.
export const TOWN_SIZES = {
  hamlet: { name: 'hamlet', radius: 26, houses: [3, 5], roles: ['farmer', 'hunter', 'guard'], extra: 1 },
  village: { name: 'village', radius: 34, houses: [5, 8], roles: ['steward', 'merchant', 'farmer', 'hunter', 'guard', 'guard', 'innkeeper'], extra: 2 },
  town: { name: 'town', radius: 44, houses: [8, 12], roles: ['steward', 'captain', 'merchant', 'smith', 'priest', 'innkeeper', 'healer', 'guard', 'guard', 'guard', 'bard'], extra: 2 },
  city: { name: 'city', radius: 96, houses: [11, 15], roles: ['ruler', 'steward', 'captain', 'merchant', 'merchant', 'smith', 'priest', 'mage', 'healer', 'innkeeper', 'bard', 'guard', 'guard', 'guard', 'guard'], extra: 14 },
};

// Trade goods sold in towns. Prices move with supply, demand and politics.
export const GOODS = {
  grain: { name: 'Grain', price: 6 }, ale: { name: 'Ale', price: 10 }, wool: { name: 'Wool', price: 9 }, tools: { name: 'Tools', price: 24 },
  timber: { name: 'Timber', price: 8 }, silk: { name: 'Elven silk', price: 40 }, moonwine: { name: 'Moonwine', price: 34 }, herbs: { name: 'Herbs', price: 12 },
  bows: { name: 'Longbows', price: 45 }, starlight: { name: 'Bottled starlight', price: 80 }, mithril: { name: 'Mithril', price: 90 }, iron: { name: 'Iron bars', price: 16 },
  gems: { name: 'Cut gems', price: 70 }, bloodwine: { name: 'Bloodwine', price: 55 }, secrets: { name: 'Sealed secrets', price: 120 }, velvet: { name: 'Velvet', price: 30 },
  silver: { name: 'Silver', price: 50 }, relics: { name: 'Dark relics', price: 140 }, furs: { name: 'Furs', price: 22 }, pelts: { name: 'Pelts', price: 18 },
  meat: { name: 'Smoked meat', price: 8 }, 'bone charms': { name: 'Bone charms', price: 26 },
};
export const GOOD_IDS = Object.keys(GOODS);

// Climates, from the terrain's tags. Weather is drawn from each climate's list over time.
export const CLIMATES = {
  frozen: { name: 'Frozen', temp: -2, weather: [['clear', 3], ['snow', 4], ['blizzard', 1.5], ['overcast', 2]] },
  cold: { name: 'Cold', temp: -1, weather: [['clear', 4], ['snow', 2], ['overcast', 3], ['fog', 1]] },
  temperate: { name: 'Temperate', temp: 0, weather: [['clear', 6], ['overcast', 3], ['rain', 3], ['storm', 1], ['fog', 1]] },
  humid: { name: 'Humid', temp: 1, weather: [['clear', 3], ['overcast', 2], ['rain', 4], ['storm', 2], ['fog', 2]] },
  arid: { name: 'Arid', temp: 2, weather: [['clear', 7], ['sandstorm', 1.5], ['overcast', 1]] },
  scorching: { name: 'Scorching', temp: 3, weather: [['clear', 4], ['ashfall', 3], ['overcast', 1]] },
};

export const WEATHER = {
  clear: { name: 'Clear skies', fog: 1, light: 1 },
  overcast: { name: 'Overcast', fog: 0.8, light: 0.75 },
  rain: { name: 'Rain', fog: 0.6, light: 0.6, precip: 'rain' },
  storm: { name: 'Thunderstorm', fog: 0.45, light: 0.45, precip: 'rain', lightning: true },
  snow: { name: 'Snowfall', fog: 0.55, light: 0.8, precip: 'snow' },
  blizzard: { name: 'Blizzard', fog: 0.25, light: 0.6, precip: 'snow', exposure: 2 },
  fog: { name: 'Fog', fog: 0.3, light: 0.8 },
  sandstorm: { name: 'Sandstorm', fog: 0.25, light: 0.7, precip: 'sand', exposure: 1 },
  ashfall: { name: 'Ashfall', fog: 0.45, light: 0.6, precip: 'ash', exposure: 1 },
};
