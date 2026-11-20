// Sample game `pop`: the pure parts (seeded spawns, scoring) under node:test, zero dependency.
// Each test names the mutation of pop.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Pop = require('../../Games/pop/pop.js');
const LEVELS = JSON.parse(readFileSync(new URL('../../Games/pop/levels.json', import.meta.url), 'utf8'));

// Kills: an unseeded or stateless generator (Math.random, a constant).
test('mulberry32 repeats for a seed, differs across seeds and stays in [0, 1)', () => {
  const a = Pop.mulberry32(42);
  const b = Pop.mulberry32(42);
  const c = Pop.mulberry32(43);
  const xs = Array.from({ length: 100 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 100 }, () => b()));
  assert.notDeepEqual(xs, Array.from({ length: 100 }, () => c()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(new Set(xs).size > 90);
});

// Kills: a hash that ignores characters or returns a non-uint32.
test('seedToInt maps a seed string to a stable unsigned 32-bit integer', () => {
  assert.equal(Pop.seedToInt('abc'), Pop.seedToInt('abc'));
  assert.notEqual(Pop.seedToInt('abc'), Pop.seedToInt('abd'));
  assert.notEqual(Pop.seedToInt('ab'), Pop.seedToInt('ba'));
  for (const s of ['', 'a', 'k3x9q2ab', 'zzzzzzzz']) {
    const n = Pop.seedToInt(s);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, s);
  }
});

// Kills: a seed the score endpoint would refuse (seed must match ^[A-Za-z0-9_.-]{0,64}$).
test('randomSeed gives 8 lowercase letters and digits', () => {
  const rand = Pop.mulberry32(7);
  for (let i = 0; i < 50; i++) assert.match(Pop.randomSeed(rand), /^[a-z0-9]{8}$/);
});

// Kills: an unknown challenge level crashing the game instead of falling back to level 1.
test('levelConfig returns the named level, or level 1 when unknown', () => {
  assert.equal(Pop.levelConfig(LEVELS, '2').level, '2');
  assert.equal(Pop.levelConfig(LEVELS, '2').every, LEVELS['2'].every);
  assert.equal(Pop.levelConfig(LEVELS, 'nope').level, '1');
  assert.equal(Pop.levelConfig(LEVELS, undefined).level, '1');
  assert.equal(Pop.levelConfig(LEVELS, '__proto__').level, '1');
});

// Kills: spawns that ignore the seed (a challenge must replay the same run) or leave the field.
test('planBubbles replays exactly for a seed and keeps every bubble inside the field', () => {
  const cfg = Pop.levelConfig(LEVELS, '1');
  const one = Pop.planBubbles(cfg, 'k3x9q2ab');
  assert.deepEqual(one, Pop.planBubbles(cfg, 'k3x9q2ab'));
  assert.notDeepEqual(one, Pop.planBubbles(cfg, 'k3x9q2ac'));
  assert.equal(one.length, Math.ceil((cfg.seconds * 1000) / cfg.every));
  one.forEach((b, i) => {
    assert.equal(b.at, i * cfg.every);
    assert.ok(b.r >= cfg.radius[0] && b.r <= cfg.radius[1], 'radius');
    assert.ok(b.x - b.r >= 0 && b.x + b.r <= Pop.FIELD.width, 'x inside');
    assert.ok(b.speed >= cfg.speed[0] && b.speed <= cfg.speed[1], 'speed');
    assert.ok(Number.isInteger(b.tint) && b.tint >= 0 && b.tint < Pop.TINTS.length, 'tint');
  });
});

// Kills: bubbles that start inside the field or rise at the wrong rate.
test('bubbleY starts just below the field and rises at speed px/s', () => {
  const b = { at: 1000, x: 100, r: 20, speed: 100, tint: 0 };
  assert.equal(Pop.bubbleY(b, 1000), Pop.FIELD.height + 20);
  assert.equal(Pop.bubbleY(b, 2000), Pop.FIELD.height + 20 - 100);
});

// Kills: a hit test that ignores the radius or picks the bubble underneath.
test('hitTest returns the topmost bubble under the point, or -1', () => {
  const t = 0;
  const y = Pop.FIELD.height + 20;
  const live = [
    { at: 0, x: 100, r: 20, speed: 0, tint: 0 },
    { at: 0, x: 110, r: 20, speed: 0, tint: 1 }
  ];
  assert.equal(Pop.hitTest(live, 105, y, t), 1);
  assert.equal(Pop.hitTest(live, 85, y, t), 0);
  assert.equal(Pop.hitTest(live, 100, y + 21, t), -1);
  assert.equal(Pop.hitTest([], 100, y, t), -1);
});

// Kills: a multiplier that never grows, grows every pop, or has no cap.
test('multiplier is 1 for the first five pops of a streak, +1 per five, capped at 5', () => {
  assert.deepEqual([0, 4, 5, 9, 10, 19, 20, 100].map(Pop.multiplier), [1, 1, 2, 2, 3, 4, 5, 5]);
});

// Kills: scorePop not counting the streak, or a miss that keeps the streak.
test('scorePop adds 10 x multiplier and grows the streak; breakCombo resets it but keeps the best', () => {
  const s = Pop.createScore();
  const gained = Array.from({ length: 6 }, () => Pop.scorePop(s));
  assert.deepEqual(gained, [10, 10, 10, 10, 10, 20]);
  assert.equal(s.score, 70);
  assert.equal(s.pops, 6);
  assert.equal(s.combo, 6);
  Pop.breakCombo(s);
  assert.equal(s.combo, 0);
  assert.equal(s.bestCombo, 6);
  assert.equal(Pop.scorePop(s), 10);
  assert.equal(s.bestCombo, 6);
});

// Kills: a score the endpoint would refuse (over scoring.max = 100000).
test('the score never passes MAX_SCORE', () => {
  const s = Pop.createScore();
  s.score = Pop.MAX_SCORE - 5;
  s.combo = 50;
  Pop.scorePop(s);
  assert.equal(s.score, Pop.MAX_SCORE);
  assert.equal(Pop.MAX_SCORE, 100000);
});
