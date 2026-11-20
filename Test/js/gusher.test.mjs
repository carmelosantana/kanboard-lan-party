// Gusher: the pure parts (boards, piece queue, flow simulation, scoring) under node:test, zero dependency.
// Each test names the mutation of gusher-logic.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../../Games/gusher/gusher-logic.js');
const LEVELS = JSON.parse(readFileSync(new URL('../../Games/gusher/levels.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('../../Games/gusher/game.json', import.meta.url), 'utf8'));

const { N, E, S, W } = G.DIRS;

/** A one-off board from rows, with a fixed queue so the test controls every piece. */
function game(rows, queue, opts) {
  const cfg = G.parseLevel(Object.assign({ name: 'Test', rows: rows, countdown: 1000, fillMs: 100, target: 0 }, opts || {}));
  const state = G.newGame(cfg, 'testseed');
  if (queue) state.queue = queue.map((p) => Object.assign({}, p));
  return state;
}

const H = { type: 'straight', rot: 1 };
const V = { type: 'straight', rot: 0 };

// ── PRNG and seeds ──────────────────────────────────────────────────────────

// Kills: an unseeded or stateless generator.
test('mulberry32 repeats for a seed and differs across seeds', () => {
  const xs = (s) => { const r = G.mulberry32(s); return Array.from({ length: 50 }, () => r()); };
  assert.deepEqual(xs(1), xs(1));
  assert.notDeepEqual(xs(1), xs(2));
  assert.ok(xs(3).every((x) => x >= 0 && x < 1));
});

// Kills: a hash that ignores characters, or a seed the score endpoint would refuse.
test('seedToInt is a stable uint32 and randomSeed is 8 safe characters', () => {
  assert.equal(G.seedToInt('abc'), G.seedToInt('abc'));
  assert.notEqual(G.seedToInt('ab'), G.seedToInt('ba'));
  const n = G.seedToInt('k3x9q2ab');
  assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffffffff);
  const r = G.mulberry32(9);
  for (let i = 0; i < 30; i++) assert.match(G.randomSeed(r), /^[a-z0-9]{8}$/);
});

// ── Pieces ──────────────────────────────────────────────────────────────────

// Kills: wrong opening tables (a bend that leaks, a tank with four sides, a valve that turns).
test('openings per piece and rotation', () => {
  assert.deepEqual(G.openings({ type: 'straight', rot: 0 }), [N, S]);
  assert.deepEqual(G.openings({ type: 'straight', rot: 1 }), [E, W]);
  assert.deepEqual(G.openings({ type: 'valve', rot: 1 }), [E, W]);
  assert.deepEqual(G.openings({ type: 'bend', rot: 0 }), [N, E]);
  assert.deepEqual(G.openings({ type: 'bend', rot: 1 }), [E, S]);
  assert.deepEqual(G.openings({ type: 'bend', rot: 2 }), [S, W]);
  assert.deepEqual(G.openings({ type: 'bend', rot: 3 }), [N, W]);
  assert.deepEqual(G.openings({ type: 'cross', rot: 0 }), [N, E, S, W]);
  assert.deepEqual(G.openings({ type: 'tank', rot: 0 }), [E, S, W]); // the closed side is the rotation
  assert.deepEqual(G.openings({ type: 'tank', rot: 2 }), [N, E, W]);
});

// Kills: flow that turns inside a cross, or a tank that sends crude back the way it came.
test('exitsFor routes crude through each piece', () => {
  assert.deepEqual(G.exitsFor({ type: 'straight', rot: 1 }, W), [E]);
  assert.deepEqual(G.exitsFor({ type: 'bend', rot: 0 }, N), [E]);
  assert.deepEqual(G.exitsFor({ type: 'bend', rot: 0 }, E), [N]);
  assert.deepEqual(G.exitsFor({ type: 'cross', rot: 0 }, S), [N]);
  assert.deepEqual(G.exitsFor({ type: 'cross', rot: 0 }, E), [W]);
  assert.deepEqual(G.exitsFor({ type: 'tank', rot: 0 }, W), [E, S]);
  assert.equal(G.channelOf({ type: 'cross', rot: 0 }, N), 0);
  assert.equal(G.channelOf({ type: 'cross', rot: 0 }, W), 1);
  assert.equal(G.channelOf({ type: 'bend', rot: 0 }, E), 0);
});

// Kills: a queue that ignores the seed (async challengers must get the same pieces) or the level.
test('the piece queue replays for a seed and level, shows 5, and deals every piece type', () => {
  const cfg = G.levelConfig(LEVELS, '1', 'x');
  const a = G.newGame(cfg, 'k3x9q2ab');
  const b = G.newGame(cfg, 'k3x9q2ab');
  const c = G.newGame(cfg, 'k3x9q2ac');
  assert.equal(a.queue.length, 5);
  assert.deepEqual(a.queue, b.queue);
  assert.notDeepEqual(a.queue, c.queue);
  const d = G.newGame(G.levelConfig(LEVELS, '2', 'x'), 'k3x9q2ab');
  assert.notDeepEqual(a.queue, d.queue);
  const rand = G.queueRand('k3x9q2ab', '1');
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const p = G.nextPiece(rand);
    assert.ok(G.PIECES.includes(p.type), p.type);
    assert.ok(Number.isInteger(p.rot) && p.rot >= 0 && p.rot < 4);
    if (p.type === 'straight' || p.type === 'valve') assert.ok(p.rot < 2);
    if (p.type === 'cross') assert.equal(p.rot, 0);
    seen.add(p.type);
  }
  assert.deepEqual([...seen].sort(), [...G.PIECES].sort());
});

// ── Boards ──────────────────────────────────────────────────────────────────

// Kills: a parser that misreads the legend or accepts a board the game cannot run.
test('parseLevel reads the legend and rejects broken boards', () => {
  const cfg = G.parseLevel({ name: 'T', rows: ['.#D', '>-|', '..+'], countdown: 5000, fillMs: 900, target: 50 });
  assert.equal(cfg.width, 3);
  assert.equal(cfg.height, 3);
  assert.deepEqual(cfg.well, { x: 0, y: 1, dir: E });
  assert.equal(cfg.cells[0][1].kind, 'rock');
  assert.equal(cfg.cells[0][2].kind, 'depot');
  assert.deepEqual(cfg.cells[1][1], { kind: 'pipe', piece: { type: 'straight', rot: 1 }, fixed: true });
  assert.deepEqual(cfg.cells[1][2].piece, { type: 'straight', rot: 0 });
  assert.deepEqual(cfg.cells[2][2].piece, { type: 'cross', rot: 0 });
  assert.equal(cfg.cells[2][0].kind, 'empty');
  assert.equal(cfg.countdown, 5000);

  const base = { name: 'T', countdown: 5000, fillMs: 900, target: 0 };
  const bad = [
    ['...', '...'], // no wellhead
    ['>..', '..<'], // two wellheads
    ['>..', '..'], // ragged
    ['>.x'], // unknown character
    ['<..'], // outlet off the board
    ['>#.'], // outlet into rock
    ['>' + '.'.repeat(G.MAX_W)], // too wide
    Array.from({ length: G.MAX_H + 1 }, (_, i) => (i ? '..' : '>.')) // too tall
  ];
  for (const rows of bad) assert.throws(() => G.parseLevel(Object.assign({ rows }, base)), JSON.stringify(rows));
  assert.throws(() => G.parseLevel({ name: 'T', rows: ['>.'], countdown: -1, fillMs: 900, target: 0 }));
  assert.throws(() => G.parseLevel({ name: 'T', rows: ['>.'], countdown: 1000, fillMs: 0, target: 0 }));
});

// Kills: a hand-made level that does not parse, a missing level, or a quota no run could reach.
test('levels.json holds the ten hand-made levels "1".."10", all valid', () => {
  assert.deepEqual(Object.keys(LEVELS), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  const names = new Set();
  for (const [key, def] of Object.entries(LEVELS)) {
    const cfg = G.parseLevel(def);
    assert.ok(cfg.name && !names.has(cfg.name), 'level ' + key + ' has its own name');
    names.add(cfg.name);
    assert.ok(cfg.target > 0 && cfg.target < G.MAX_SCORE, 'level ' + key + ' target');
    assert.ok(cfg.width * cfg.height >= 30, 'level ' + key + ' size');
  }
});

// Kills: an unknown challenge level crashing the game, or "endless" not reading the seed.
test('levelConfig: named level, endless from the seed, else level 1', () => {
  assert.equal(G.levelConfig(LEVELS, '4', 's').level, '4');
  assert.equal(G.levelConfig(LEVELS, '4', 's').name, LEVELS['4'].name);
  assert.equal(G.levelConfig(LEVELS, 'nope', 's').level, '1');
  assert.equal(G.levelConfig(LEVELS, '__proto__', 's').level, '1');
  assert.equal(G.levelConfig(LEVELS, undefined, 's').level, '1');
  const e = G.levelConfig(LEVELS, 'endless', 'k3x9q2ab');
  assert.equal(e.level, 'endless');
  assert.deepEqual(e, G.levelConfig(LEVELS, 'endless', 'k3x9q2ab'));
  assert.notDeepEqual(e.cells, G.levelConfig(LEVELS, 'endless', 'k3x9q2ac').cells);
  assert.match(G.LEVEL_ENDLESS, /^[A-Za-z0-9_.-]{1,32}$/);
});

// Kills: an endless board that breaks the board rules for some seeds (generated rows go through parseLevel).
test('endless boards are valid for many seeds and keep the wellhead outlet clear', () => {
  const rand = G.mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const seed = G.randomSeed(rand);
    const def = G.endlessLevel(seed);
    const cfg = G.parseLevel(def);
    assert.equal(cfg.width, G.MAX_W);
    assert.equal(cfg.height, G.MAX_H);
    const out = cfg.cells[cfg.well.y + G.DY[cfg.well.dir]][cfg.well.x + G.DX[cfg.well.dir]];
    assert.equal(out.kind, 'empty', seed);
    const depots = cfg.cells.flat().filter((c) => c.kind === 'depot').length;
    assert.equal(depots, 2, seed);
  }
});

// ── Flow ────────────────────────────────────────────────────────────────────

// Kills: crude that starts before the countdown ends, never spills, or scores the wellhead.
test('an unpiped wellhead spills one fill after the countdown', () => {
  const s = game(['>...']);
  G.advance(s, 1099);
  assert.equal(s.over, false);
  assert.equal(G.countdownLeft(s), 0);
  G.advance(s, 1100);
  assert.equal(s.over, true);
  assert.equal(s.sealed, false);
  assert.deepEqual(s.spill, { x: 0, y: 0, dir: E });
  assert.equal(s.clock, 1100);
  assert.equal(s.score.barrels, 0);
});

// Kills: pipe cells not counted, or flow ignoring piece openings.
test('crude runs along placed pipe, 10 barrels a cell, and spills at the open end', () => {
  const s = game(['>...'], [H, H, H, H, H]);
  assert.equal(G.countdownLeft(s), 1000);
  assert.ok(G.place(s, 1, 0).ok);
  assert.ok(G.place(s, 2, 0).ok);
  G.advance(s, 10000);
  assert.equal(s.score.barrels, 20);
  assert.equal(s.score.cells, 2);
  assert.deepEqual(s.spill, { x: 2, y: 0, dir: E });
  assert.equal(s.clock, 1300);
});

// Kills: a piece facing the wrong way accepting crude.
test('a piece without an opening toward the flow is a spill', () => {
  const s = game(['>..'], [V]);
  G.place(s, 1, 0);
  G.advance(s, 5000);
  assert.deepEqual(s.spill, { x: 0, y: 0, dir: E });
});

// Kills: a valve that does not hold the flow back.
test('a valve takes three fills to pass', () => {
  const s = game(['>..'], [{ type: 'valve', rot: 1 }, H]);
  G.place(s, 1, 0);
  G.place(s, 2, 0);
  G.advance(s, 99999);
  assert.equal(s.clock, 1000 + 100 + 300 + 100);
  assert.equal(s.score.barrels, 20);
});

// Kills: a cross scored once, or a second pass treated as a merge.
test('a cross filled on both channels pays the crossing bonus', () => {
  // The wellhead (B1) points down through the fixed cross (B2); three bends loop the crude back into the
  // cross from the east, and a straight on A2 carries it off the west edge.
  const s = game(['.v..', '.+..', '....'], [{ type: 'bend', rot: 0 }, { type: 'bend', rot: 3 }, { type: 'bend', rot: 2 }, H, H]);
  assert.ok(G.place(s, 1, 2).ok); // N,E
  assert.ok(G.place(s, 2, 2).ok); // N,W
  assert.ok(G.place(s, 2, 1).ok); // S,W
  assert.ok(G.place(s, 0, 1).ok); // E,W
  G.advance(s, 99999);
  assert.equal(s.score.crossings, 1);
  assert.equal(s.score.cells, 6); // cross twice, three bends, one straight
  assert.equal(s.score.barrels, 6 * G.POINTS.cell + G.POINTS.cross);
  assert.deepEqual(s.spill, { x: 0, y: 1, dir: W });
});

// Kills: a tank that does not split, a slow tank that fills in one step, or a seal without its bonus.
test('a tank-junction fills, splits both ways, and two depots seal the line', () => {
  const s = game(['..v..', 'D...D'], [{ type: 'tank', rot: 2 }, H, H]);
  assert.ok(G.place(s, 2, 1).ok); // open N, E, W
  assert.ok(G.place(s, 1, 1).ok);
  assert.ok(G.place(s, 3, 1).ok);
  G.advance(s, 99999);
  assert.equal(s.sealed, true);
  assert.equal(s.spill, null);
  assert.equal(s.score.tanks, 1);
  assert.equal(s.score.depots, 2);
  assert.equal(s.score.barrels, 3 * G.POINTS.cell + G.POINTS.tank + 2 * G.POINTS.depot + G.POINTS.seal);
  assert.equal(s.clock, 1000 + 100 + 400 + 100); // a tank takes four fills
});

// Kills: flow meeting crude already in a pipe counted as a spill (or scored twice).
test('crude that runs into a filled channel merges without a spill', () => {
  // A loop: tank splits both ways and the branches meet again.
  // . v .
  // ┌ T ┐
  // └ - ┘
  const s = game(['.v.', '...', '...'], [
    { type: 'tank', rot: 2 }, { type: 'bend', rot: 1 }, { type: 'bend', rot: 2 },
    { type: 'bend', rot: 0 }, { type: 'bend', rot: 3 }
  ]);
  assert.ok(G.place(s, 1, 1).ok); // tank N,E,W
  assert.ok(G.place(s, 0, 1).ok); // bend E,S
  assert.ok(G.place(s, 2, 1).ok); // bend S,W
  assert.ok(G.place(s, 0, 2).ok); // bend N,E
  assert.ok(G.place(s, 2, 2).ok); // bend N,W
  s.queue.unshift(H);
  assert.ok(G.place(s, 1, 2).ok); // H joins them
  G.advance(s, 99999);
  assert.equal(s.spill, null);
  assert.equal(s.sealed, true);
  assert.equal(s.score.cells, 6);
});

// ── Placing ─────────────────────────────────────────────────────────────────

// Kills: placing on rock, the wellhead, a depot, fixed pipe, outside the board, or under crude.
test('place refuses blocked cells and cells crude has reached', () => {
  const s = game(['>-#D', '....'], [H, H, H, H, H, H]);
  assert.equal(G.place(s, 0, 0).reason, 'blocked');
  assert.equal(G.place(s, 1, 0).reason, 'blocked');
  assert.equal(G.place(s, 2, 0).reason, 'blocked');
  assert.equal(G.place(s, 3, 0).reason, 'blocked');
  assert.equal(G.place(s, 9, 0).reason, 'outside');
  assert.equal(G.place(s, -1, 0).reason, 'outside');
  const t = game(['>...'], [H, H, H, H, H, H]);
  G.place(t, 1, 0);
  G.advance(t, 1150); // crude is in (1,0)
  assert.equal(G.place(t, 1, 0).reason, 'flowing');
  G.advance(t, 99999);
  assert.equal(G.place(t, 2, 0).reason, 'over');
});

// Kills: a free overwrite, or a queue that does not move on.
test('overwriting a laid piece swaps it at a time cost and the queue moves on', () => {
  const s = game(['>...'], [V, H, H, H, H], { countdown: 10000 });
  const second = s.queue[1];
  const first = G.place(s, 1, 0);
  assert.deepEqual(first, { ok: true, overwrite: false });
  assert.equal(s.queue.length, 5);
  assert.deepEqual(s.queue[0], second);
  assert.equal(s.clock, 0);
  const again = G.place(s, 1, 0);
  assert.deepEqual(again, { ok: true, overwrite: true });
  assert.deepEqual(s.cells[0][1].piece, H);
  assert.equal(s.clock, G.OVERWRITE_MS);
  assert.equal(s.score.overwrites, 1);
  assert.equal(s.score.placed, 2);
});

// ── Score bounds and results ────────────────────────────────────────────────

// Kills: a scoring.max a full board could beat, or a manifest out of step with the code.
test('MAX_SCORE matches the manifest and bounds the best possible board', () => {
  assert.deepEqual(MANIFEST.scoring, { order: 'high', unit: 'barrels', max: G.MAX_SCORE });
  const perCell = Math.max(
    G.POINTS.cell + G.POINTS.tank, // a tank
    2 * G.POINTS.cell + G.POINTS.cross, // a cross, both ways
    G.POINTS.depot
  );
  assert.ok(G.MAX_W * G.MAX_H * perCell + G.POINTS.seal <= G.MAX_SCORE);
});

// Kills: a score past MAX_SCORE reaching submitScore.
test('barrels never pass MAX_SCORE', () => {
  const s = game(['>..'], [H, H]);
  s.score.barrels = G.MAX_SCORE - 3;
  G.place(s, 1, 0);
  G.advance(s, 99999);
  assert.equal(s.score.barrels, G.MAX_SCORE);
});

// Kills: Share enabled before a score is in, or Submit clickable twice.
test('resultButtons and submitText follow the pop rules', () => {
  const at = (over, submit) => G.resultButtons({ over, submit });
  assert.deepEqual(at(false, 'idle'), { submit: true, share: true });
  assert.deepEqual(at(true, 'idle'), { submit: false, share: true });
  assert.deepEqual(at(true, 'pending'), { submit: true, share: true });
  assert.deepEqual(at(true, 'done'), { submit: true, share: false });
  assert.equal(G.submitText({ rank: 2, best: 90 }), 'Rank #2 · your best 90');
  assert.equal(G.submitText({ rank: 0, best: 90 }), 'Your best 90');
});

// Kills: a save that grows without bound or keeps junk from an older or tampered save.
test('mergeBest keeps the best per known level and drops junk', () => {
  const saved = { best: { 1: 50, 2: 'x', zz: 70, endless: 400, '3': -4 } };
  const best = G.readBest(saved);
  assert.deepEqual(best, { 1: 50, endless: 400 });
  assert.deepEqual(G.readBest(null), {});
  assert.deepEqual(G.readBest({ best: [1, 2] }), {});
  const r = G.mergeBest(best, '1', 40);
  assert.deepEqual(r, { best: { 1: 50, endless: 400 }, improved: false });
  const r2 = G.mergeBest(best, '2', 80);
  assert.deepEqual(r2, { best: { 1: 50, 2: 80, endless: 400 }, improved: true });
});

// Kills: a cell name off by one (the status line reads grid positions aloud).
test('cellName gives a column letter and a row number', () => {
  assert.equal(G.cellName(0, 0), 'A1');
  assert.equal(G.cellName(9, 7), 'J8');
});
