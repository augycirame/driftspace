// Personal equipment: hand weapons and armor the pilot uses on foot.

import { mulberry32, hash2, weightedPick, pick } from './rng.js';
import { RELICS, RELIC_IDS, RELIC_COLORS } from './content/relics.js';
import { GODS } from './content/factions.js';

export const TIERS = [
  null,
  { name: 'Scrap',     color: '#9aa3ad', mult: 1.0 },
  { name: 'Standard',  color: '#e8f0ff', mult: 1.35 },
  { name: 'Military',  color: '#6aa9ff', mult: 1.8 },
  { name: 'Prototype', color: '#c27bff', mult: 2.4 },
  { name: 'Void',      color: '#ffb347', mult: 3.2 },
];
export const MAX_TIER = 5;

export const WEAPONS = {
  pistol:  { name: 'Pistol',  damage: 14, rate: 3,   range: 70,  spread: 0.012, pellets: 1, price: 60,  color: '#cfd8e6' },
  rifle:   { name: 'Rifle',   damage: 9,  rate: 9,   range: 100, spread: 0.022, pellets: 1, price: 160, color: '#9fe08a' },
  shotgun: { name: 'Shotgun', damage: 8,  rate: 1.3, range: 30,  spread: 0.09,  pellets: 8, price: 140, color: '#e0b06a' },
  plasma:  { name: 'Plasma',  damage: 32, rate: 2,   range: 80,  spread: 0.01,  pellets: 1, price: 260, color: '#6af0ff' },
  railgun: { name: 'Railgun', damage: 95, rate: 0.6, range: 220, spread: 0,     pellets: 1, price: 420, color: '#ff6ad5' },
  // Swords: swing in an arc (range is reach); every third swing in a row is a sword skill.
  blade:   { name: 'Energy blade', damage: 26, rate: 2.6, range: 3.0, arc: 2.2, melee: true, spread: 0, pellets: 1, price: 220, color: '#7ad8ff' },
  greatsword: { name: 'Greatsword', damage: 52, rate: 1.2, range: 3.8, arc: 2.6, melee: true, spread: 0, pellets: 1, price: 340, color: '#ffb05a' },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const ARMOR_SLOTS = {
  helmet: { name: 'Helmet', armor: 4, price: 50 },
  chest:  { name: 'Chestplate', armor: 9, price: 90 },
  legs:   { name: 'Greaves', armor: 6, price: 70 },
};
export const ARMOR_SLOT_IDS = Object.keys(ARMOR_SLOTS);

// Grades, from common to legendary: stronger base stats and more bonus stats (affixes).
export const GRADES = {
  common:    { name: 'Common',    color: '#c8d0dc', mult: 1.0,  affixes: 0, value: 1 },
  rare:      { name: 'Rare',      color: '#5aa8ff', mult: 1.1,  affixes: 1, value: 2 },
  epic:      { name: 'Epic',      color: '#b86bff', mult: 1.22, affixes: 2, value: 4 },
  unique:    { name: 'Unique',    color: '#ffd84a', mult: 1.38, affixes: 3, value: 9 },
  legendary: { name: 'Legendary', color: '#ff7a2a', mult: 1.6,  affixes: 4, value: 24 },
};
export const GRADE_IDS = Object.keys(GRADES);
export const AFFIXES = {
  sharp:  { name: 'Sharpness', on: 'weapon', min: 6, max: 16, fmt: (v) => `+${v}% damage` },
  swift:  { name: 'Swiftness', on: 'weapon', min: 5, max: 14, fmt: (v) => `+${v}% attack speed` },
  crit:   { name: 'Precision', on: 'weapon', min: 5, max: 16, fmt: (v) => `${v}% critical hits (double damage)` },
  drain:  { name: 'Life drain', on: 'weapon', min: 3, max: 9, fmt: (v) => `heals ${v}% of damage dealt` },
  reach:  { name: 'Reach', on: 'weapon', min: 8, max: 22, fmt: (v) => `+${v}% range` },
  tough:  { name: 'Toughness', on: 'armor', min: 8, max: 24, fmt: (v) => `+${v}% armor` },
  vital:  { name: 'Vitality', on: 'armor', min: 8, max: 26, fmt: (v) => `+${v} max health` },
};
// Enhancement: +1 at a time up to +10, each harder than the last; past +5 a failure costs a level.
export const MAX_PLUS = 10;
export const ENHANCE_CHANCE = [1, 1, 0.95, 0.88, 0.8, 0.7, 0.58, 0.46, 0.35, 0.25];
export const enhanceCost = (it) => {
  const n = (it.plus || 0) + 1;
  return { credits: Math.round(60 * Math.pow(n, 1.7) * it.tier), ores: { iron: 6 * n * it.tier, ...(n >= 5 ? { silver: n - 3 } : {}), ...(n >= 8 ? { mithril: n - 6 } : {}) } };
};
export const gradeOf = (it) => GRADES[it?.grade] || GRADES.common;
export const affix = (it, id) => (it?.affixes || []).find((a) => a.id === id)?.v || 0;

export const PLAYER_HP = 100;
export const PLAYER_SPEED = 11;
export const RUN_SPEED = 17;

export function itemName(it) {
  if (it.kind === 'relic') return RELICS[it.type]?.name || 'Unknown relic';
  const tier = TIERS[it.tier].name;
  if (it.kind === 'mech') return `${tier} Mech Frame`;
  const base = it.kind === 'weapon' ? WEAPONS[it.type].name : ARMOR_SLOTS[it.type].name;
  const plus = it.plus ? `+${it.plus} ` : '';
  return it.title ? `${plus}${it.title}` : `${plus}${tier} ${base}`;
}
// The color an item's name is shown in: its grade, or for plain items its tier.
export const itemColor = (it) => (it.grade && it.grade !== 'common' ? GRADES[it.grade].color : TIERS[it.tier]?.color || '#ffffff');

export function weaponStats(it) {
  const w = WEAPONS[it?.type] || WEAPONS.pistol;
  const m = (it ? TIERS[it.tier].mult : 0.8) * gradeOf(it).mult * (1 + 0.07 * (it?.plus || 0)) * (1 + affix(it, 'sharp') / 100);
  return {
    ...w, damage: w.damage * m, rate: w.rate * (1 + affix(it, 'swift') / 100),
    range: w.range * (1 + 0.08 * ((it?.tier || 1) - 1)) * (1 + affix(it, 'reach') / 100),
    crit: affix(it, 'crit') / 100, drain: affix(it, 'drain') / 100,
  };
}

// One blow: a critical hit (Precision) doubles the damage.
export function strike(ws, dmg, rng = Math.random) {
  const crit = rng() < (ws.crit || 0);
  return { dmg: crit ? dmg * 2 : dmg, crit };
}

export function armorRating(equipped, items, buffs = {}) {
  let armor = 0, shield = buffs.shield || 0;
  for (const slot of ARMOR_SLOT_IDS) {
    const it = items.find((i) => i.id === equipped[slot]);
    if (!it) continue;
    armor += ARMOR_SLOTS[slot].armor * it.tier * TIERS[it.tier].mult * gradeOf(it).mult * (1 + 0.06 * (it.plus || 0)) * (1 + affix(it, 'tough') / 100);
    shield += affix(it, 'vital');
    if (it.tier >= 5) shield += 15;
  }
  armor = (armor + (buffs.armor ? 10 : 0)) * (1 + (buffs.armor || 0));
  return { armor: Math.round(armor), shield, reduction: armor / (armor + 100) };
}

// ---- relics and blessings --------------------------------------------------------------------

export const RELIC_SLOTS = ['relic1', 'relic2'];
export const BUFF_KEYS = ['damage', 'armor', 'speed', 'mining', 'jump', 'luck', 'regen', 'shield'];

export function makeRelic(type) {
  return { id: newItemId(), kind: 'relic', type, tier: Math.min(5, RELICS[type].rarity) };
}

// A random relic: rarer ones are less likely; gods' own relics never drop at random.
export function randomRelic(rng = Math.random, pool = null) {
  const ids = pool || RELIC_IDS.filter((id) => !RELICS[id].god && id !== 'hiveCore');
  return makeRelic(weightedPick(rng, ids.map((id) => [id, 6 - RELICS[id].rarity])));
}

export const relicColor = (it) => RELIC_COLORS[RELICS[it.type]?.rarity || 1];

// Everything currently boosting a pilot: carried relics plus an active blessing.
export function buffsOf(inv, blessing, now = Date.now()) {
  const b = {};
  for (const k of BUFF_KEYS) b[k] = 0;
  for (const slot of RELIC_SLOTS) {
    const it = inv.items.find((i) => i.id === inv.equipped[slot]);
    const r = it && RELICS[it.type];
    if (r) for (const [k, v] of Object.entries(r.bonus)) b[k] += v;
  }
  if (blessing && blessing.until > now) for (const [k, v] of Object.entries(blessing.bonus)) b[k] += v;
  return b;
}

export function describeBonus(bonus) {
  const fmt = { damage: 'damage', armor: 'armor', speed: 'speed', mining: 'mining', luck: 'loot luck' };
  return Object.entries(bonus).map(([k, v]) => {
    if (k === 'jump') return `+${v} jump range`;
    if (k === 'regen') return `+${v} health/s`;
    if (k === 'shield') return `+${v} personal shield`;
    return `+${Math.round(v * 100)}% ${fmt[k] || k}`;
  }).join(', ');
}

export const godBlessing = (god) => ({ god, name: `Blessing of ${GODS[god].name.split(',')[0]}`, bonus: GODS[god].blessing });

export function itemValue(it) {
  if (it.kind === 'relic') return 300 * Math.pow(2, (RELICS[it.type]?.rarity || 1) - 1);
  if (it.kind === 'mech') return Math.round(1600 * Math.pow(1.8, it.tier - 1));
  const base = it.kind === 'weapon' ? WEAPONS[it.type].price : ARMOR_SLOTS[it.type].price;
  return Math.round(base * Math.pow(2.2, it.tier - 1) * gradeOf(it).value * (1 + 0.25 * (it.plus || 0)));
}

let idCounter = 0;
export const newItemId = () => `i${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function makeItem(kind, type, tier, grade = 'common', rng = Math.random) {
  const it = { id: newItemId(), kind, type, tier: Math.max(1, Math.min(MAX_TIER, tier)) };
  if (kind === 'weapon' || kind === 'armor') {
    it.grade = GRADES[grade] ? grade : 'common';
    it.plus = 0;
    // Bonus stats for the grade, no stat twice.
    const pool = Object.entries(AFFIXES).filter(([, a]) => a.on === kind).map(([id]) => id);
    it.affixes = [];
    for (let i = 0; i < GRADES[it.grade].affixes && pool.length; i++) {
      const id = pool.splice(Math.floor(rng() * pool.length), 1)[0], a = AFFIXES[id];
      it.affixes.push({ id, v: Math.round(a.min + (a.max - a.min) * rng()) });
    }
    if (it.grade === 'unique' || it.grade === 'legendary') it.title = legendName(it, rng);
  }
  return it;
}

// Grades roll like loot in a game: mostly common, legendary rarely. Luck (crafting skill, deep
// dungeons) shifts the odds up.
export function rollGrade(rng = Math.random, luck = 0) {
  const w = [['common', 60 - luck * 30], ['rare', 25], ['epic', 10 + luck * 12], ['unique', 4 + luck * 9], ['legendary', 1 + luck * 5]];
  return weightedPick(rng, w.map(([g, x]) => [g, Math.max(0.1, x)]));
}

// Unique and legendary items carry a name.
const LEGEND_A = ['Starfall', 'Dawnbreaker', 'Voidsong', 'Emberheart', 'Frostbane', 'Gloam', 'Sunforged', 'Ironvow', 'Stormcaller', 'Nightglass', 'Moonwake', 'Ashen', 'Godslayer', 'Wyrmfang', 'Silverstep', 'Thornwhisper'];
const LEGEND_B = ['of the Fallen Star', 'of the Hollow King', 'of Seven Winters', 'of the Last Light', 'of the Drowned Moon', 'of the First Smith', 'of Endless Night', 'of the Iron Crown', 'of Vagrant Stars', 'of the Silent Choir'];
function legendName(it, rng) {
  const base = (it.kind === 'weapon' ? WEAPONS[it.type].name.split(' ').pop() : ARMOR_SLOTS[it.type].name).replace(/^./, (c) => c.toUpperCase());
  const a = LEGEND_A[Math.floor(rng() * LEGEND_A.length)], b = LEGEND_B[Math.floor(rng() * LEGEND_B.length)];
  return it.grade === 'legendary' ? `${a} ${base} ${b}` : `${a} ${base}`;
}

// Better loot further from home; occasionally one tier above.
export function lootTier(richness, rng = Math.random) {
  const base = Math.min(MAX_TIER, 1 + Math.floor((richness - 1) / 1.6));
  return Math.min(MAX_TIER, base + (rng() < 0.15 ? 1 : 0));
}

export function randomItem(richness, rng = Math.random) {
  const tier = lootTier(richness, rng);
  const grade = rollGrade(rng, Math.min(1, (richness - 1) / 8));
  if (rng() < 0.5) return makeItem('weapon', weightedPick(rng, [['pistol', 4], ['rifle', 3], ['shotgun', 3], ['plasma', 2], ['railgun', 1], ['blade', 2], ['greatsword', 1]]), tier, grade, rng);
  return makeItem('armor', pick(rng, ARMOR_SLOT_IDS), tier, grade, rng);
}

// What a shop sells: fixed per shop and per day so everyone sees the same stock.
export function shopStock(shopId, richness, day) {
  const rng = mulberry32(hash2(day, shopId.length * 7919 + [...shopId].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) | 0, 4242));
  const maxTier = Math.min(MAX_TIER, 1 + Math.floor(richness / 1.5));
  const stock = [];
  for (const type of WEAPON_IDS) {
    if (type === 'railgun' && maxTier < 3) continue;
    stock.push({ kind: 'weapon', type, tier: Math.max(1, maxTier - (rng() < 0.5 ? 1 : 0)) });
  }
  for (const type of ARMOR_SLOT_IDS) stock.push({ kind: 'armor', type, tier: Math.max(1, maxTier - (rng() < 0.4 ? 1 : 0)) });
  // Stations and the Haven trade hall sell mech frames.
  if (shopId.endsWith(':st') || shopId === 'haven-landing') stock.push({ kind: 'mech', type: 'mech', tier: Math.max(1, maxTier - 1) });
  return stock.map((s, i) => ({ ...s, slot: i, price: Math.round(itemValue(s) * 1.6) }));
}

// Damage after armor, shared so the client can preview it.
export function mitigate(damage, reduction) {
  return damage * (1 - reduction);
}
