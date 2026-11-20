// Wicklings: the twelve shipped levels. Every level parses, needs its jobs, and has a known solution that
// meets its goal; replaying that solution's job log gives the same outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const W = require('../../Games/wicklings/wicklings-sim.js');
const JSON_LEVELS = JSON.parse(readFileSync(new URL('../../Games/wicklings/levels.json', import.meta.url), 'utf8'));

// Known solutions: hand job to wickling `id` when it stands at `at` (or as soon as it can take it).
const SOLUTIONS = {
  '1': [],
  '2': [{ id: 0, at: [8, 7], job: 'digger' }],
  '3': [{ id: 0, at: [22, 9], job: 'blocker' }],
  '4': [{ id: 0, at: [10, 11], job: 'bridger' }],
  '5': [{ id: 0, job: 'climber' }, { id: 1, job: 'climber' }, { id: 2, job: 'climber' }, { id: 3, job: 'climber' }],
  '6': [{ id: 0, job: 'floater' }, { id: 1, job: 'floater' }, { id: 2, job: 'floater' }, { id: 3, job: 'floater' }, { id: 4, job: 'floater' }],
  '7': [{ id: 0, at: [23, 7], job: 'blocker' }, { id: 1, at: [12, 7], job: 'digger' }],
  '8': [{ id: 0, at: [8, 9], job: 'bridger' }, { id: 1, at: [20, 9], job: 'bridger' }],
  '9': [{ id: 0, job: 'climber' }, { id: 0, job: 'floater' }, { id: 1, job: 'climber' }, { id: 1, job: 'floater' }, { id: 2, job: 'climber' }, { id: 2, job: 'floater' }, { id: 3, job: 'climber' }, { id: 3, job: 'floater' }, { id: 4, job: 'climber' }, { id: 4, job: 'floater' }],
  '10': [{ id: 0, at: [21, 9], job: 'blocker' }, { id: 1, at: [26, 9], job: 'bridger' }],
  '11': [{ id: 0, at: [23, 5], job: 'blocker' }, { id: 1, at: [10, 5], job: 'digger' }, { id: 1, at: [15, 11], job: 'bridger' }],
  '12': [{ id: 0, at: [6, 3], job: 'blocker' }, { id: 1, at: [15, 3], job: 'digger' }, { id: 1, at: [18, 9], job: 'bridger' }]
};

/** Plays a level with the triggers above and returns the final state. */
function solve(level, plan) {
  const s = W.createState(level);
  const done = new Set();
  while (!s.over) {
    plan.forEach((t, i) => {
      const w = s.walkers[t.id];
      if (done.has(i) || !w) return;
      if (t.at && (w.x !== t.at[0] || w.y !== t.at[1])) return;
      if (W.assign(s, t.id, t.job)) done.add(i);
    });
    W.step(s);
  }
  assert.equal(done.size, plan.length, level.id + ': every planned job was handed out');
  return s;
}

// Kills: a broken or missing level, a duplicate id, or a level too big for MAX_SCORE.
test('levels.json holds twelve valid levels, ids 1 to 12 in order, with distinct names', () => {
  const { order, byId } = W.parseLevels(JSON_LEVELS);
  assert.deepEqual(order, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  assert.equal(new Set(order.map((id) => byId[id].name)).size, 12);
  for (const id of order) {
    const lv = byId[id];
    assert.ok(lv.count * W.SAVE_POINTS + lv.seconds * W.SECOND_POINTS <= W.MAX_SCORE, id);
    assert.ok(lv.hint.length > 0, id + ' has a hint');
  }
});

// Kills: an unwinnable level, or a sim change that silently breaks a shipped puzzle.
for (const raw of JSON_LEVELS.levels) {
  test('level ' + raw.id + ' (' + raw.name + ') is won by its known solution and replays identically', () => {
    const level = W.parseLevel(raw);
    const s = solve(level, SOLUTIONS[raw.id]);
    assert.equal(W.won(s), true, 'saved ' + s.saved + ' of ' + level.need);
    const again = W.replay(level, s.log);
    assert.deepEqual(W.summary(again), W.summary(s));
    assert.equal(again.tiles, s.tiles);
  });
}

// Kills: a puzzle that is won without using any job (only the first level teaches plain walking).
test('every level after the first is lost when no job is handed out', () => {
  const { order, byId } = W.parseLevels(JSON_LEVELS);
  for (const id of order.slice(1)) {
    const s = W.createState(byId[id]);
    while (!s.over) W.step(s);
    assert.equal(W.won(s), false, id);
  }
  const first = W.createState(W.parseLevels(JSON_LEVELS).byId['1']);
  while (!first.over) W.step(first);
  assert.equal(W.won(first), true);
});

// Kills: levels where the last wicklings pace with no job left running to the clock (losing the time bonus).
test('levels 5 and 9 end early with a time bonus once every knack is used', () => {
  const { byId } = W.parseLevels(JSON_LEVELS);
  const ids = (n) => Array.from({ length: n }, (_, i) => i);
  const plans = {
    '5': ids(5).map((id) => ({ id, job: 'climber' })),
    '9': ids(6).flatMap((id) => [{ id, job: 'climber' }, { id, job: 'floater' }])
  };
  for (const id of ['5', '9']) {
    const lv = byId[id];
    const s = solve(lv, plans[id]);
    assert.equal(W.won(s), true, id);
    assert.ok(s.tick < lv.seconds * W.TICK_HZ / 2, id + ' ended at tick ' + s.tick);
    assert.ok(W.score(s) > s.saved * W.SAVE_POINTS, id + ' earned a time bonus');
    assert.deepEqual(W.summary(W.replay(lv, s.log)), W.summary(s));
  }
});
