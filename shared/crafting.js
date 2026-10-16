// Crafting: turn materials into gear. Done at your own workbench, at a town with a smith, or
// aboard a station. Skill in crafting can push the result a tier higher.

export const RECIPES = {
  sword:   { name: 'Weapon (your choice of type)', makes: 'weapon', cost: { iron: 18, wood: 6 }, perTier: { iron: 14, copper: 4, silver: 2, mithril: 1 } },
  armor:   { name: 'Armor piece', makes: 'armor', cost: { iron: 14, hide: 4 }, perTier: { iron: 10, hide: 2, silver: 2, mithril: 1 } },
  mech:    { name: 'Mech frame', makes: 'mech', cost: { iron: 140, copper: 50, gold: 12, crystal: 4 }, perTier: { iron: 60, mithril: 4, voidstone: 2 } },
  relic:   { name: 'Focus relic (random)', makes: 'relic', cost: { crystal: 10, silver: 8, gold: 6 }, perTier: {} },
};
export const RECIPE_IDS = Object.keys(RECIPES);

// Materials needed for a recipe at a tier.
export function recipeCost(id, tier = 1) {
  const r = RECIPES[id];
  const cost = { ...r.cost };
  for (let t = 1; t < tier; t++) for (const [k, v] of Object.entries(r.perTier)) cost[k] = (cost[k] || 0) + v * t;
  return cost;
}
