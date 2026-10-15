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
  for (const a of s.asteroids) assert.deepEqual(sectorOf(a.x, a.y).length, 2);
});

test('asteroids can be found by id', () => {
  const s = generateSector(-3, 4, 1337);
  for (const a of s.asteroids) assert.equal(findAsteroid(a.id, 1337), a);
  assert.equal(findAsteroid('nope', 1337), null);
});
