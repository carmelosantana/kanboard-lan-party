// Wicklings: the pure simulation (level parsing, walking, jobs, hazards, scoring, replay) under node:test.
// Each test names the mutation of wicklings-sim.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../../Games/wicklings/wicklings-sim.js');

/** A one-wickling test level around a map; jobs default to five of each. */
function level(map, extra = {}) {
  return W.parseLevel(Object.assign({
    id: 't', name: 'Test', hint: '', count: 1, need: 1, seconds: 60, rate: 4, dir: 1,
    jobs: { digger: 5, blocker: 5, bridger: 5, climber: 5, floater: 5 },
    map: map
  }, extra));
}

/** Steps until the level is over (or a safety cap), returning the state. */
function runOut(state, cap = 2000) {
  for (let i = 0; i < cap && !state.over; i++) W.step(state);
  return state;
}

/** Steps until walker 0 exists, then returns it. */
function firstWalker(state) {
  while (state.walkers.length === 0) W.step(state);
  return state.walkers[0];
}

// ── Level parsing ────────────────────────────────────────────────────────────

// Kills: a parser that accepts ragged rows, a missing door or lantern, or unknown tiles.
test('parseLevel finds the door and lantern and refuses broken maps', () => {
  const lv = level(['D...', '...L', '####']);
  assert.deepEqual(lv.door, { x: 0, y: 0 });
  assert.deepEqual(lv.lantern, { x: 3, y: 1 });
  assert.equal(lv.w, 4);
  assert.equal(lv.h, 3);
  assert.throws(() => level(['D...', '..L', '####']), /row/);
  assert.throws(() => level(['....', '...L', '####']), /door/);
  assert.throws(() => level(['D...', '....', '####']), /lantern/);
  assert.throws(() => level(['D..?', '...L', '####']), /tile/);
  assert.throws(() => level(['DD..', '...L', '####']), /door/);
});

// Kills: limits that let a level score past scoring.max, or goals that can never be met.
test('parseLevel enforces the caps that keep scores inside MAX_SCORE', () => {
  const map = ['D...', '...L', '####'];
  assert.throws(() => level(map, { count: W.MAX_WICKLINGS + 1, need: 1 }), /count/);
  assert.throws(() => level(map, { count: 0, need: 0 }), /count/);
  assert.throws(() => level(map, { count: 3, need: 4 }), /need/);
  assert.throws(() => level(map, { need: 0 }), /need/);
  assert.throws(() => level(map, { seconds: W.MAX_SECONDS + 1 }), /seconds/);
  assert.throws(() => level(map, { jobs: { digger: -1 } }), /job/);
  assert.throws(() => level(map, { jobs: { teleporter: 1 } }), /job/);
  assert.throws(() => level(map, { id: 'bad id' }), /id/);
  assert.equal(W.MAX_SCORE, W.MAX_WICKLINGS * W.SAVE_POINTS + W.MAX_SECONDS * W.SECOND_POINTS);
  assert.equal(W.MAX_SCORE, 7000);
});

// ── Walking, falling, hazards ────────────────────────────────────────────────

// Kills: a walker that walks through walls instead of turning, or never reaches the lantern.
test('a wickling drops from the door, walks, turns at a wall and reaches the lantern', () => {
  const s = W.createState(level([
    'X........X',
    'X.D......X',
    'X........X',
    'XL.......X',
    'XXXXXXXXXX'
  ]));
  const w = firstWalker(s);
  assert.equal(w.x, 2);
  runOut(s);
  assert.equal(s.saved, 1);
  assert.equal(s.lost, 0);
  assert.equal(w.state, 'saved');
  assert.ok(s.tick > 16, 'it walked right to the wall and back');
});

// Kills: walkers that cannot climb a one-tile step, or climb two-tile walls without the climber job.
test('a wickling steps up a one-tile ledge but turns at a two-tile wall', () => {
  const step = W.createState(level([
    'D.......',
    '.......L',
    '......##',
    '########'
  ]));
  runOut(step);
  assert.equal(step.saved, 1);

  const wall = W.createState(level([
    'D......L',
    '......##',
    '......##',
    '########'
  ], { seconds: 10 }));
  runOut(wall);
  assert.equal(wall.saved, 0);
});

// Kills: water that does not snuff a wickling.
test('water snuffs a wickling', () => {
  const s = W.createState(level([
    'D......L',
    '........',
    '##~~~###',
    '########'
  ]));
  runOut(s);
  assert.equal(s.saved, 0);
  assert.equal(s.lost, 1);
  assert.equal(s.walkers[0].state, 'lost');
  assert.equal(s.walkers[0].cause, 'water');
});

// Kills: no fall damage, or fall damage at the safe height.
test('a fall longer than MAX_SAFE_FALL snuffs a wickling; a fall of exactly that height does not', () => {
  // The wickling walks off the ledge at x=3 and falls exactly n rows before landing.
  const drop = (n) => {
    const rows = ['D.......', '###.....'];
    for (let i = 2; i < n; i++) rows.push('........');
    rows.push('.....L..', '########');
    return W.createState(level(rows));
  };
  const safe = runOut(drop(W.MAX_SAFE_FALL));
  assert.equal(safe.saved, 1, 'safe fall');
  const deep = runOut(drop(W.MAX_SAFE_FALL + 1));
  assert.equal(deep.lost, 1, 'deep fall');
  assert.equal(deep.walkers[0].cause, 'fall');
});

// Kills: walking off the bottom of the map without counting the wickling as lost.
test('a wickling that falls out of the map is lost', () => {
  const s = W.createState(level([
    'D.....L',
    '###..##',
    '.......'
  ]));
  runOut(s);
  assert.equal(s.lost, 1);
  assert.equal(s.walkers[0].cause, 'fall');
});

// ── Jobs ─────────────────────────────────────────────────────────────────────

// Kills: a digger that cannot dig, digs stone, or survives nothing below.
test('a digger digs down through earth and planks, and not through stone', () => {
  const s = W.createState(level([
    'D.......',
    '########',
    '========',
    '.......L',
    'XXXXXXXX'
  ]));
  const w = firstWalker(s);
  W.step(s); // land
  assert.equal(W.assign(s, w.id, 'digger'), true);
  assert.equal(s.jobs.digger, 4);
  runOut(s, 200);
  assert.equal(W.tileAt(s, 0, 1), '.');
  assert.equal(W.tileAt(s, 0, 2), '.');
  assert.equal(W.tileAt(s, 1, 1), '#');
  assert.equal(s.saved, 1, 'it dropped out of the shaft and walked to the lantern');

  const stone = W.createState(level(['D......L', 'X#######']));
  const v = firstWalker(stone);
  W.step(stone);
  assert.equal(W.assign(stone, v.id, 'digger'), true);
  runOut(stone);
  assert.equal(W.tileAt(stone, 0, 1), 'X');
  assert.equal(stone.saved, 1, 'it gave up digging and walked on');
});

// Kills: a blocker that lets walkers through, or a blocker that keeps walking.
test('a blocker stays put and turns other wicklings around', () => {
  const s = W.createState(level([
    '...D......',
    '..........',
    'L.........',
    '#######~~#'
  ], { count: 2, need: 1, rate: 6 }));
  const first = firstWalker(s);
  while (first.y < 2) W.step(s);
  W.step(s); // landing
  W.step(s); // one step right
  assert.equal(first.x, 4);
  assert.equal(W.assign(s, first.id, 'blocker'), true);
  const at = first.x;
  runOut(s);
  assert.equal(first.x, at);
  assert.equal(first.state, 'block');
  assert.equal(s.saved, 1, 'the second wickling turned at the blocker and walked home');
});

// Kills: a bridger that does not lay planks, lays more than PLANKS, or lays them on solid ground.
test('a bridger lays PLANKS planks across a gap of water', () => {
  const s = W.createState(level([
    'D.............',
    '.............L',
    '##~~~~~~~~####'
  ]));
  const w = firstWalker(s);
  while (w.y < 1) W.step(s);
  W.step(s); // landing tick
  assert.equal(W.assign(s, w.id, 'bridger'), true);
  runOut(s);
  assert.equal(s.saved, 1);
  const row = Array.from({ length: 14 }, (_, x) => W.tileAt(s, x, 2)).join('');
  assert.equal((row.match(/=/g) || []).length, W.PLANKS);
  assert.equal(W.PLANKS, 8);
  assert.equal(row, '##' + '='.repeat(8) + '####');
});

// Kills: a climber that does not climb, or climbers that walk off the top.
test('a climber scales a tall wall and walks on', () => {
  const s = W.createState(level([
    'D...........',
    '.......####L',
    '.......#####',
    '.......#####',
    '.......#####',
    '############'
  ]));
  const w = firstWalker(s);
  assert.equal(W.assign(s, w.id, 'climber'), true);
  assert.equal(w.climber, true);
  assert.equal(W.assign(s, w.id, 'climber'), false, 'one climber job per wickling');
  runOut(s);
  assert.equal(s.saved, 1);
});

// Kills: a floater that still dies from a long fall.
test('a floater survives a long fall', () => {
  const rows = ['D......', '###....'];
  for (let i = 0; i < W.MAX_SAFE_FALL + 4; i++) rows.push('.......');
  rows.push('......L', '#######');
  const s = W.createState(level(rows));
  const w = firstWalker(s);
  assert.equal(W.assign(s, w.id, 'floater'), true);
  runOut(s);
  assert.equal(s.saved, 1);
});

// Kills: jobs handed out after the stock runs out, to the snuffed or saved, or to falling walkers.
test('assign refuses empty stock, finished wicklings and wicklings in mid-air', () => {
  const s = W.createState(level([
    'D......',
    '.......',
    '.......',
    '......L',
    '#######'
  ], { jobs: { digger: 0, blocker: 1, bridger: 0, climber: 0, floater: 0 } }));
  const w = firstWalker(s);
  assert.equal(W.assign(s, w.id, 'digger'), false, 'no stock');
  assert.equal(W.assign(s, w.id, 'blocker'), false, 'falling');
  assert.equal(W.assign(s, 99, 'blocker'), false, 'no such wickling');
  assert.equal(W.assign(s, w.id, 'nonsense'), false, 'no such job');
  runOut(s);
  assert.equal(W.assign(s, w.id, 'blocker'), false, 'already home');
  assert.equal(s.jobs.blocker, 1);
  assert.deepEqual(s.log, []);
});

// ── Ending, scoring, replay ──────────────────────────────────────────────────

// Kills: a level that never ends when only blockers remain, or that ignores the time limit.
test('the level ends when every wickling is home, lost or blocking, or when time runs out', () => {
  const s = W.createState(level([
    'D........L',
    '..........',
    '##########'
  ], { need: 1, seconds: 5 }));
  const w = firstWalker(s);
  while (w.y < 1) W.step(s);
  W.step(s);
  W.assign(s, w.id, 'blocker');
  W.step(s);
  assert.equal(s.over, true, 'only a blocker is left');

  // A wickling penned in by a stone post walks back and forth until the clock runs out.
  const t = W.createState(level(['D..X..L', '#######'], { seconds: 3 }));
  runOut(t);
  assert.equal(t.over, true);
  assert.equal(t.tick, 3 * W.TICK_HZ);
});

// Kills: a time bonus paid on a failed level, or a score past MAX_SCORE.
test('score is saved x 100 plus 10 per second left, the bonus only when the goal is met', () => {
  const lv = level(['D...', '...L', '####'], { count: 4, need: 2, seconds: 100 });
  const s = W.createState(lv);
  s.saved = 3;
  s.tick = 40 * W.TICK_HZ + 3; // 59.5 s left: whole seconds only
  assert.equal(W.score(s), 300 + 59 * 10);
  s.saved = 1;
  assert.equal(W.score(s), 100);
  assert.equal(W.won(s), false);
  s.saved = 2;
  assert.equal(W.won(s), true);
  s.saved = 10000;
  assert.equal(W.score(s), W.MAX_SCORE);
});

// Kills: an end action that does not stop the level.
test('end() stops the level and is recorded in the log', () => {
  const s = W.createState(level(['D...', '...L', '####']));
  W.step(s);
  W.end(s);
  assert.equal(s.over, true);
  assert.deepEqual(s.log, [{ tick: 1, id: -1, job: 'end' }]);
});

// Kills: any hidden randomness or wall-clock time in the simulation.
test('replay of the same level and job log gives an identical outcome', () => {
  const lv = level([
    '...D..............',
    '..................',
    '.#########........',
    '.#########.......L',
    'XXXXXXXXXXX~~~~XXX'
  ], { count: 6, need: 1, rate: 3 });
  const s = W.createState(lv);
  let assigned = 0;
  for (let i = 0; i < 3000 && !s.over; i++) {
    // A digger for the first to land on row 1, then a bridger for the first to reach row 3.
    for (const w of s.walkers) {
      if (assigned === 0 && w.state === 'walk' && w.y === 1) { W.assign(s, w.id, 'digger'); assigned++; }
      else if (assigned === 1 && w.state === 'walk' && w.y === 3) { W.assign(s, w.id, 'bridger'); assigned++; }
    }
    W.step(s);
  }
  assert.equal(s.over, true);
  assert.ok(s.log.length >= 2);
  const again = W.replay(lv, s.log);
  assert.deepEqual(W.summary(again), W.summary(s));
  assert.equal(again.tiles, s.tiles);
  assert.deepEqual(again.walkers, s.walkers);
  const twice = W.replay(lv, s.log);
  assert.deepEqual(twice.walkers, again.walkers);
});

// Kills: the parsed level being mutated by play (Retry must start from the untouched map).
test('createState copies the map so a run never changes the level', () => {
  const lv = level(['D...', '####', '...L', '####']);
  const before = lv.tiles;
  const s = W.createState(lv);
  const w = firstWalker(s);
  W.step(s);
  W.assign(s, w.id, 'digger');
  runOut(s);
  assert.equal(lv.tiles, before);
  assert.notEqual(s.tiles, before);
});

// ── Seeds and results buttons (shared with the reference game) ───────────────

// Kills: an unseeded flicker generator (the seed is carried in challenges).
test('mulberry32 and seedToInt are stable, randomSeed is a valid score seed', () => {
  const a = W.mulberry32(W.seedToInt('k3x9q2ab'));
  const b = W.mulberry32(W.seedToInt('k3x9q2ab'));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  for (let i = 0; i < 20; i++) assert.match(W.randomSeed(W.mulberry32(i)), /^[a-z0-9]{8}$/);
});

// Kills: Share enabled before a successful submit, or Submit clickable twice.
test('resultButtons: Submit once per finished run, Share only after a successful submit', () => {
  const at = (over, submit) => W.resultButtons({ over, submit });
  assert.deepEqual(at(false, 'idle'), { submit: true, share: true });
  assert.deepEqual(at(true, 'idle'), { submit: false, share: true });
  assert.deepEqual(at(true, 'pending'), { submit: true, share: true });
  assert.deepEqual(at(true, 'done'), { submit: true, share: false });
  assert.deepEqual(at(true, 'failed'), { submit: true, share: true });
});

// Kills: a save shape that loses progress or accepts junk from an old or hand-edited save.
test('readSave keeps valid progress and drops junk; recordResult unlocks the next level only on a win', () => {
  assert.deepEqual(W.readSave(null), { v: 1, unlocked: 1, best: {} });
  assert.deepEqual(W.readSave({ v: 1, unlocked: 3, best: { 1: 450, 2: 'x', 3: -4 } }), { v: 1, unlocked: 3, best: { 1: 450 } });
  assert.deepEqual(W.readSave({ unlocked: 99 }).unlocked, 12);
  const save = W.readSave(null);
  const order = ['1', '2', '3'];
  W.recordResult(save, order, '1', 120, false);
  assert.deepEqual(save, { v: 1, unlocked: 1, best: { 1: 120 } });
  W.recordResult(save, order, '1', 900, true);
  assert.deepEqual(save, { v: 1, unlocked: 2, best: { 1: 900 } });
  W.recordResult(save, order, '1', 500, true);
  assert.deepEqual(save, { v: 1, unlocked: 2, best: { 1: 900 } });
});

// Kills: a refusal the player cannot understand (the UI shows this text when a job does not take).
test('assignProblem explains why a job would not take, and is empty when it would', () => {
  const s = W.createState(level(['D......', '.......', '......L', '#######'], { jobs: { digger: 1, climber: 1 } }));
  const w = firstWalker(s);
  assert.equal(W.assignProblem(s, w.id, 'digger'), 'needs firm ground');
  assert.equal(W.assignProblem(s, w.id, 'blocker'), 'no blockers left');
  assert.equal(W.assignProblem(s, w.id, 'climber'), '');
  W.assign(s, w.id, 'climber');
  assert.equal(W.assignProblem(s, w.id, 'climber'), 'no climbers left');
  s.jobs.climber = 1;
  assert.equal(W.assignProblem(s, w.id, 'climber'), 'already a climber');
  assert.equal(W.assignProblem(s, 42, 'digger'), 'no such wickling');
  runOut(s);
  assert.equal(W.assignProblem(s, w.id, 'floater'), 'the level is over');
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────

// Kills: a bridger that planks over the lantern (or the door), making a level unwinnable.
test('a bridger never lays a plank over the lantern or the door', () => {
  const s = W.createState(level(['D.......', '####L...', '########']));
  const w = firstWalker(s);
  W.step(s); // landing
  assert.equal(W.assign(s, w.id, 'bridger'), true);
  runOut(s);
  assert.equal(W.tileAt(s, 4, 1), 'L');
  assert.equal(s.saved, 1);
});

// Kills: replay() ignoring the End entry (End is how the time bonus is banked).
test('replay honours End: same log with End, same outcome and the same score', () => {
  const lv = level(['D......L', '########'], { seconds: 60 });
  const s = W.createState(lv);
  for (let i = 0; i < 3; i++) W.step(s);
  W.end(s);
  const again = W.replay(lv, s.log);
  assert.equal(again.tick, 3);
  assert.deepEqual(W.summary(again), W.summary(s));
});

// Kills: a climber that keeps climbing into a ceiling instead of letting go and turning back.
test('a climber under a ceiling lets go and turns around', () => {
  const s = W.createState(level([
    'D......L',
    '........',
    '...XXXXX',
    '......XX',
    '......XX',
    '########'
  ], { seconds: 20 }));
  const w = firstWalker(s);
  W.assign(s, w.id, 'climber');
  let highest = w.y;
  let turned = false;
  for (let i = 0; i < 60 && !s.over; i++) {
    W.step(s);
    highest = Math.min(highest, w.y);
    if (w.dir < 0 && w.x < 5) turned = true;
  }
  assert.ok(highest >= 3 || w.x === 0, 'never climbed into the ceiling row');
  assert.equal(turned, true);
});

// Kills: a step-up that ignores head-room (walking up into a ceiling).
test('a wickling does not step up a ledge when there is no head-room', () => {
  const s = W.createState(level([
    'D.......',
    '........',
    '...XXXXX',
    '....#..L',
    '########'
  ], { seconds: 10 }));
  const w = firstWalker(s);
  let furthest = 0;
  while (!s.over) {
    W.step(s);
    furthest = Math.max(furthest, w.x);
  }
  assert.equal(furthest, 3);
  assert.equal(s.saved, 0);
});

// Kills: a blocker that hangs in the air once the ground under it is gone.
test('a blocker whose ground is gone falls and stops blocking', () => {
  const s = W.createState(level(['D......L', '########', '........', '########'], { seconds: 20 }));
  const w = firstWalker(s);
  W.step(s);
  W.step(s); // landed and one step right
  assert.equal(W.assign(s, w.id, 'blocker'), true);
  const i = 1 * s.w + w.x;
  s.tiles = s.tiles.slice(0, i) + '.' + s.tiles.slice(i + 1); // the floor under it crumbles
  W.step(s); // lets go
  W.step(s); // drops into the hole
  W.step(s); // and lands below
  assert.notEqual(w.state, 'block');
  assert.equal(w.y, 2);
});

// Kills: floaters falling at full speed (they sink one row every other tick).
test('a floater falls at half speed', () => {
  const ticksToLand = (float) => {
    const s = W.createState(level(['D.......', '........', '........', '........', '.......L', '########']));
    const w = firstWalker(s);
    if (float) W.assign(s, w.id, 'floater');
    let n = 0;
    while (w.state === 'fall' && w.y < 4) { W.step(s); n++; }
    return n;
  };
  assert.equal(ticksToLand(false), 4);
  assert.equal(ticksToLand(true), 8);
});

// Kills: the door releasing on the wrong phase (first wickling at tick 0, then one every `rate` ticks).
test('the door releases the first wickling on the first step and then one every rate ticks', () => {
  const s = W.createState(level(['D......L', '########'], { count: 3, rate: 5 }));
  W.step(s);
  assert.equal(s.released, 1);
  for (let i = 0; i < 4; i++) W.step(s);
  assert.equal(s.released, 1);
  W.step(s);
  assert.equal(s.released, 2);
});

// Kills: unlocking levels the player has not won by winning a challenge on a locked level.
test('recordResult does not unlock past a challenge win on a level that was still locked', () => {
  const order = ['1', '2', '3', '4', '5', '6'];
  const save = W.readSave(null, 6);
  W.recordResult(save, order, '5', 900, true);
  assert.equal(save.unlocked, 1);
  assert.equal(save.best['5'], 900);
  W.recordResult(save, order, '1', 900, true);
  assert.equal(save.unlocked, 2);
});

// Kills: counting End as a job in the score meta.
test('jobsUsed counts handed-out jobs, not End', () => {
  const s = W.createState(level(['D......', '.......', '......L', '#######']));
  const w = firstWalker(s);
  W.assign(s, w.id, 'climber');
  W.assign(s, w.id, 'floater');
  W.end(s);
  assert.equal(s.log.length, 3);
  assert.equal(W.jobsUsed(s), 2);
});

// Kills: a level that keeps running to the clock when no job can be given and nothing can change any more.
test('a level ends by itself once no job can be given and the state repeats', () => {
  // One wickling, no jobs: it paces between the wall and the left edge for ever.
  const s = W.createState(level(['D..X..L', '#######'], { seconds: 60, jobs: {} }));
  runOut(s);
  assert.equal(s.over, true);
  assert.ok(s.tick < 30, 'ended at tick ' + s.tick);
  // A job still in stock keeps the level open (the player may yet use it).
  const t = W.createState(level(['D..X..L', '#######'], { seconds: 10, jobs: { climber: 1 } }));
  runOut(t);
  assert.equal(t.tick, 10 * W.TICK_HZ);
});
