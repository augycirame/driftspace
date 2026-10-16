import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSector, findAsteroid, sectorOf } from '../shared/universe.js';

test('sectors are deterministic for a seed', () => {
  const a = JSON.stringify(generateSector(12, -7, 42));
  const b = JSON.stringify(generateSector(12, -7, 42));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(generateSector(12, -7, 43)));
});

test('home sector always has a star and Haven Station', () => {
  for (const seed of [1, 2, 1337, 99999]) {
    const s = generateSector(0, 0, seed);
    assert.ok(s.star);
    assert.equal(s.station.name, 'Haven Station');
    assert.ok(s.asteroids.length >= 26);
  }
});

test('the universe keeps going far from home', () => {
  const s = generateSector(1_000_000, -2_500_000, 1337);
  assert.ok(s.region.richness > 15);
  for (const a of s.asteroids) assert.deepEqual(sectorOf(a.x, a.z).length, 2);
});

test('asteroids can be found by id', () => {
  const s = generateSector(-3, 4, 1337);
  for (const a of s.asteroids) assert.equal(findAsteroid(a.id, 1337), a);
  assert.equal(findAsteroid('nope', 1337), null);
});

import { findPlanet, STARTER_PLANET_ID } from '../shared/universe.js';
import { validateShip, shipStats, STARTER_SHIP } from '../shared/rules.js';
import { heightAt, baseHeight, CELL } from '../shared/planet.js';
import { shopStock, armorRating, makeItem } from '../shared/items.js';

test('Haven is a landable starter planet with a flat settlement', () => {
  const h = findPlanet(STARTER_PLANET_ID, 1337);
  assert.equal(h.name, 'Haven');
  assert.ok(h.landable && h.starter);
  assert.ok(Math.abs(heightAt(h, 0, 0) - heightAt(h, 30, 30)) < 0.01);
});

test('terrain height interpolates the vertex grid exactly at vertices', () => {
  const p = findPlanet('0,0:p1', 1337) || findPlanet(STARTER_PLANET_ID, 1337);
  assert.ok(Math.abs(heightAt(p, 10 * CELL, -7 * CELL) - baseHeight(p, 10 * CELL, -7 * CELL)) < 1e-9);
});

test('ships must have one cockpit and be connected', () => {
  assert.equal(validateShip(STARTER_SHIP), null);
  assert.match(validateShip(STARTER_SHIP.filter((b) => b[3] !== 'cockpit')), /cockpit/);
  assert.match(validateShip([...STARTER_SHIP, [4, 3, 6, 'hull']]), /connect/);
  const heavy = shipStats([...STARTER_SHIP, [0, 1, 0, 'armor'], [0, 1, -1, 'armor']]);
  assert.ok(heavy.hp > shipStats(STARTER_SHIP).hp);
  assert.ok(heavy.accel < shipStats(STARTER_SHIP).accel);
});

test('shops are stable for a day and armor reduces damage', () => {
  assert.deepEqual(shopStock('0,0:st', 1, 100), shopStock('0,0:st', 1, 100));
  const chest = makeItem('armor', 'chest', 3);
  const r = armorRating({ chest: chest.id }, [chest]);
  assert.ok(r.reduction > 0 && r.reduction < 1);
});
