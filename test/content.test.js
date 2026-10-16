import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAINS, CREATURES, STRUCTURES, RELICS, GODS, FACTIONS } from '../shared/content/index.js';
import { ORES } from '../shared/rules.js';
import { generateSector, findPlanet, holyCapitalSector, territoryOf } from '../shared/universe.js';
import { terrainOf, faunaOf, structuresOf, baseHeight, structureBase } from '../shared/planet.js';
import { buffsOf, makeRelic } from '../shared/items.js';

const FLORA = ['tree', 'palm', 'rock', 'spike', 'cactus', 'mushroom', 'crystal', 'bone', 'reed', 'deadtree', 'coral'];
const SHAPES = ['quad', 'serpent', 'flyer', 'blob', 'insect', 'biped', 'golem'];

test('the content library is internally consistent', () => {
  const terrainTags = new Set(Object.values(TERRAINS).flatMap((t) => t.tags));
  for (const [id, t] of Object.entries(TERRAINS)) {
    for (const [ore] of t.ore) assert.ok(ORES[ore], `${id} ore ${ore}`);
    for (const [kind] of t.flora) assert.ok(FLORA.includes(kind), `${id} flora ${kind}`);
  }
  for (const [id, c] of Object.entries(CREATURES)) {
    assert.ok(SHAPES.includes(c.shape), `${id} shape`);
    if (!['guardian', 'soldier'].includes(c.behavior) && id !== 'glowmoth') assert.ok(c.tags.some((t) => terrainTags.has(t)), `${id} has a habitat`);
    if (c.faction) assert.ok(FACTIONS[c.faction]);
  }
  for (const [id, s] of Object.entries(STRUCTURES)) {
    for (const g of [s.guardians, s.soldiers].filter(Boolean)) assert.ok(CREATURES[g[0]], `${id} guard ${g[0]}`);
    for (const r of s.cache?.relics || []) assert.ok(RELICS[r], `${id} relic ${r}`);
    assert.ok(s.parts.length > 0);
  }
  for (const [id, g] of Object.entries(GODS)) assert.equal(RELICS[g.relic].god, id);
});

test('planets draw terrain, wildlife and structures from the library', () => {
  let ruins = 0, shrines = 0, planets = 0;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    for (const p of generateSector(x, z, 1337).planets) {
      if (!p.landable) continue;
      planets++;
      assert.ok(TERRAINS[terrainOf(p)]);
      assert.ok(TERRAINS[terrainOf(p)].planetTypes[p.type] || p.starter);
      for (const c of faunaOf(p)) assert.ok(CREATURES[c]);
      for (const st of structuresOf(p)) {
        assert.ok(STRUCTURES[st.type]);
        if (STRUCTURES[st.type].kind === 'ruin') ruins++;
        if (st.god) { shrines++; assert.ok(GODS[st.god]); }
        // Ground is levelled under each structure.
        assert.ok(Math.abs(baseHeight(p, st.x, st.z) - structureBase(p, st)) < 1e-6);
      }
    }
  }
  assert.ok(planets > 20 && ruins > 5 && shrines > 2, `${planets} planets, ${ruins} ruins, ${shrines} shrines`);
});

test('the Empire has a holy capital with its Cathedral, and territory around it', () => {
  const [cx, cz] = holyCapitalSector(1337);
  assert.equal(territoryOf(cx, cz, 1337), 'capital');
  assert.equal(territoryOf(cx + 3, cz, 1337), 'empire');
  assert.equal(territoryOf(0, 0, 1337), 'haven');
  const s = generateSector(cx, cz, 1337);
  assert.equal(s.station.faction, 'empire');
  assert.ok(s.station.capital);
  const aurelis = findPlanet(`${cx},${cz}:p0`, 1337);
  assert.ok(aurelis.holy && aurelis.landable);
  assert.equal(terrainOf(aurelis), 'sacredGardens');
  assert.ok(structuresOf(aurelis).some((st) => st.type === 'cathedral'));
  assert.ok(!structuresOf(aurelis).some((st) => STRUCTURES[st.type].kind === 'shrine'), 'no heresy on Aurelis');
});

test('relics and blessings stack into buffs', () => {
  const a = makeRelic('emberOfKharon'), b = makeRelic('starChart');
  const inv = { items: [a, b], equipped: { relic1: a.id, relic2: b.id } };
  const buffs = buffsOf(inv, { bonus: { damage: 0.25 }, until: Date.now() + 1000 });
  assert.equal(buffs.damage, 0.6);
  assert.equal(buffs.jump, 2);
  assert.equal(buffsOf(inv, { bonus: { damage: 1 }, until: Date.now() - 1 }).damage, 0.35, 'expired blessings do nothing');
});
