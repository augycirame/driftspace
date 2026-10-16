// What a pilot can become: skilled through practice, a spellcaster taught by mages, touched by
// a god with a superpower, cursed with vampirism or lycanthropy, or strapped into a mech.

export const SKILLS = {
  combat: { name: 'Combat', what: 'killing things on foot', bonus: 'damage on foot', per: 0.03 },
  mining: { name: 'Mining', what: 'digging and mining', bonus: 'mining speed and digging yield', per: 0.04 },
  trade: { name: 'Trade', what: 'buying and selling', bonus: 'better prices', per: 0.015 },
  speech: { name: 'Speech', what: 'quests and good conversation', bonus: 'standing gained and quest pay', per: 0.03 },
  piloting: { name: 'Piloting', what: 'space combat', bonus: 'ship speed', per: 0.015 },
  magic: { name: 'Magic', what: 'casting spells', bonus: 'spell power and mana', per: 0.05 },
  crafting: { name: 'Crafting', what: 'making things', bonus: 'crafted gear quality', per: 0.04 },
};
export const SKILL_IDS = Object.keys(SKILLS);
export const MAX_SKILL = 20;

export const skillLevel = (xp = 0) => Math.min(MAX_SKILL, Math.floor(Math.sqrt(xp / 40)));
export const xpForLevel = (lvl) => lvl * lvl * 40;
// The fractional bonus a skill gives at its current level.
export const skillBonus = (skills, id) => skillLevel(skills?.[id]) * SKILLS[id].per;

// ---- magic --------------------------------------------------------------------------------------

export const SPELLS = {
  firebolt: { name: 'Firebolt', mana: 12, cooldown: 0.8, damage: 38, range: 70, color: '#ff8a3a', price: 120, teachers: ['mage', 'priest'],
    text: 'Hurl a bolt of fire.' },
  frost: { name: 'Frost Nova', mana: 22, cooldown: 4, damage: 26, radius: 12, color: '#9ae8ff', price: 220, teachers: ['mage'],
    text: 'Freeze and wound everything around you; frozen foes are slowed.' },
  heal: { name: 'Mending', mana: 18, cooldown: 3, heal: 55, color: '#9affb0', price: 150, teachers: ['mage', 'priest', 'healer'],
    text: 'Close your wounds.' },
  blink: { name: 'Blink', mana: 15, cooldown: 2.5, distance: 14, color: '#c8a0ff', price: 260, teachers: ['mage'],
    text: 'Step through space a short way forward.' },
  lightning: { name: 'Chain Lightning', mana: 26, cooldown: 2, damage: 34, range: 50, chains: 3, color: '#e8f4ff', price: 380, teachers: ['mage'],
    text: 'Lightning that leaps between up to three foes.' },
  ward: { name: 'Ward', mana: 22, cooldown: 12, shield: 70, seconds: 20, color: '#ffe08a', price: 300, teachers: ['mage', 'priest'],
    text: 'A shimmering shield that soaks up damage.' },
  sunlance: { name: 'Sunlance', mana: 30, cooldown: 3, damage: 70, range: 60, color: '#fff2a0', price: 450, teachers: ['priest'], holy: true,
    text: 'A spear of holy light; doubly deadly to vampires and the undead.' },
};
export const SPELL_IDS = Object.keys(SPELLS);
export const BASE_MANA = 60;
export const maxMana = (skills, people) => Math.round(BASE_MANA + skillLevel(skills?.magic) * 8);

// ---- superpowers (granted by gods) -----------------------------------------------------------------

export const POWERS = {
  flight: { name: 'Wings of Vael', god: 'vael', drain: 9, text: 'Hold Space to fly while active.' },
  titan: { name: 'Forge-Strength', god: 'kharon', drain: 6, text: '+60% damage and triple digging while active.' },
  aegis: { name: 'Pale Aegis', god: 'isareth', cost: 70, seconds: 6, cooldown: 45, text: 'Six seconds of invulnerability, and your wounds close.' },
  speed: { name: "Hunter's Stride", god: 'morseth', drain: 7, text: 'Run at two and a half times normal speed while active.' },
  veil: { name: 'Silent Veil', god: 'oruun', cost: 60, seconds: 12, cooldown: 40, text: 'Twelve seconds unseen: nothing hunts you.' },
};
export const POWER_IDS = Object.keys(POWERS);
export const FAVOR_FOR_POWER = 3;
export const MAX_ENERGY = 100;

// ---- curses --------------------------------------------------------------------------------------

export const CURSES = {
  vampire: { name: 'Vampirism', text: 'Stronger and faster at night, and your hits drink blood. Sunlight burns you outside towns. A priest can cure it.', bite: 0.12 },
  werewolf: { name: 'Lycanthropy', text: 'At night, press T to become a great wolf: fast, tough, with deadly claws, but no guns or spells. A priest can cure it.', bite: 0.15 },
};
export const CURE_PRICE = 400;

// The wolf form.
export const WOLF = { speed: 1.75, hp: 1.6, claw: 32, reach: 3.6 };

// ---- mechs -------------------------------------------------------------------------------------------

export const MECH = { hp: 420, armor: 0.5, damage: 85, rate: 1.1, splash: 4.5, range: 160, speed: 1.15, jump: 1.7, repairPerSec: 6, price: 1600 };
export const mechStats = (tier) => {
  const k = 1 + (tier - 1) * 0.55;
  return { hp: Math.round(MECH.hp * k), damage: MECH.damage * k, rate: MECH.rate, splash: MECH.splash, range: MECH.range, armor: Math.min(0.75, MECH.armor + (tier - 1) * 0.05) };
};
