// Personal equipment: hand weapons and armor the pilot uses on foot.

import { mulberry32, hash2, weightedPick, pick } from './rng.js';

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
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const ARMOR_SLOTS = {
  helmet: { name: 'Helmet', armor: 4, price: 50 },
  chest:  { name: 'Chestplate', armor: 9, price: 90 },
  legs:   { name: 'Greaves', armor: 6, price: 70 },
};
export const ARMOR_SLOT_IDS = Object.keys(ARMOR_SLOTS);

export const PLAYER_HP = 100;
export const PLAYER_SPEED = 11;
export const RUN_SPEED = 17;

export function itemName(it) {
  const tier = TIERS[it.tier].name;
  return it.kind === 'weapon' ? `${tier} ${WEAPONS[it.type].name}` : `${tier} ${ARMOR_SLOTS[it.type].name}`;
}

export function weaponStats(it) {
  const w = WEAPONS[it?.type] || WEAPONS.pistol;
  const m = it ? TIERS[it.tier].mult : 0.8;
  return { ...w, damage: w.damage * m, range: w.range * (1 + 0.08 * ((it?.tier || 1) - 1)) };
}

export function armorRating(equipped, items) {
  let armor = 0, shield = 0;
  for (const slot of ARMOR_SLOT_IDS) {
    const it = items.find((i) => i.id === equipped[slot]);
    if (!it) continue;
    armor += ARMOR_SLOTS[slot].armor * it.tier * TIERS[it.tier].mult;
    if (it.tier >= 5) shield += 15;
  }
  return { armor: Math.round(armor), shield, reduction: armor / (armor + 100) };
}

export function itemValue(it) {
  const base = it.kind === 'weapon' ? WEAPONS[it.type].price : ARMOR_SLOTS[it.type].price;
  return Math.round(base * Math.pow(2.2, it.tier - 1));
}

let idCounter = 0;
export const newItemId = () => `i${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function makeItem(kind, type, tier) {
  return { id: newItemId(), kind, type, tier: Math.max(1, Math.min(MAX_TIER, tier)) };
}

// Better loot further from home; occasionally one tier above.
export function lootTier(richness, rng = Math.random) {
  const base = Math.min(MAX_TIER, 1 + Math.floor((richness - 1) / 1.6));
  return Math.min(MAX_TIER, base + (rng() < 0.15 ? 1 : 0));
}

export function randomItem(richness, rng = Math.random) {
  const tier = lootTier(richness, rng);
  if (rng() < 0.5) return makeItem('weapon', weightedPick(rng, [['pistol', 4], ['rifle', 3], ['shotgun', 3], ['plasma', 2], ['railgun', 1]]), tier);
  return makeItem('armor', pick(rng, ARMOR_SLOT_IDS), tier);
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
  return stock.map((s, i) => ({ ...s, slot: i, price: Math.round(itemValue(s) * 1.6) }));
}

// Damage after armor, shared so the client can preview it.
export function mitigate(damage, reduction) {
  return damage * (1 - reduction);
}
