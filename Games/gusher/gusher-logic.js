/*
 * Gusher: the pure game logic (no DOM). Boards, the seeded piece queue, the crude-flow simulation and scoring.
 *
 * A board is a grid with one wellhead. After a countdown the wellhead pumps crude, one cell per fill time.
 * Pieces come from a seeded 5-piece queue (same seed and level, same pieces), so an async challenger lays the
 * same pipe. Crude that reaches an open end spills and ends the round; crude that only ends in depots or runs
 * into crude already in a pipe seals the line for a bonus.
 *
 * In node this file exports its API (for node:test); in the browser it defines window.Gusher.
 */
(function () {
  'use strict';

  const DIRS = { N: 0, E: 1, S: 2, W: 3 };
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const MAX_W = 10;
  const MAX_H = 8;
  const QUEUE_SIZE = 5;
  const OVERWRITE_MS = 2000;
  const POINTS = { cell: 10, tank: 50, cross: 30, depot: 100, seal: 200 };
  // Per cell at most max(tank 10+50, cross 2x10+30, depot 100) = 100; a full 10x8 board plus the seal is 8200.
  const MAX_SCORE = 10000; // game.json scoring.max
  const SLOWDOWN = { straight: 1, bend: 1, cross: 1, valve: 3, tank: 4 };
  const PIECES = ['straight', 'bend', 'cross', 'valve', 'tank'];
  const WEIGHTS = [0.28, 0.36, 0.1, 0.12, 0.14];
  const LEVEL_ENDLESS = 'endless';
  const SEED_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const WELLS = { '^': 0, '>': 1, v: 2, '<': 3 };
  const FIXED = { '|': { type: 'straight', rot: 0 }, '-': { type: 'straight', rot: 1 }, '+': { type: 'cross', rot: 0 } };

  function opposite(d) {
    return (d + 2) % 4;
  }

  // ── PRNG ───────────────────────────────────────────────────────────────────

  /** A small seeded PRNG: returns a function giving floats in [0, 1). */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** FNV-1a: a seed string to the unsigned 32-bit state mulberry32 starts from. */
  function seedToInt(seed) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Eight lowercase letters and digits: always a valid score seed. */
  function randomSeed(rand) {
    let s = '';
    for (let i = 0; i < 8; i++) s += SEED_CHARS[Math.floor(rand() * SEED_CHARS.length)];
    return s;
  }

  // ── Pieces ─────────────────────────────────────────────────────────────────

  /** The sides a piece is open on, in N, E, S, W order. */
  function openings(piece) {
    switch (piece.type) {
      case 'straight':
      case 'valve':
        return piece.rot % 2 === 0 ? [0, 2] : [1, 3];
      case 'bend':
        return [piece.rot, (piece.rot + 1) % 4].sort();
      case 'cross':
        return [0, 1, 2, 3];
      case 'tank':
        return [0, 1, 2, 3].filter(function (d) { return d !== piece.rot; });
      default:
        return [];
    }
  }

  function accepts(piece, side) {
    return openings(piece).indexOf(side) !== -1;
  }

  /** Where crude entering a piece from side `from` leaves it. */
  function exitsFor(piece, from) {
    if (piece.type === 'cross' || piece.type === 'straight' || piece.type === 'valve') return [opposite(from)];
    return openings(piece).filter(function (d) { return d !== from; });
  }

  /** A cross carries two separate channels (0 north-south, 1 east-west); every other piece has one. */
  function channelOf(piece, from) {
    return piece.type === 'cross' ? from % 2 : 0;
  }

  /** The queue's own generator: seeded by the level too, so a seed deals different pieces on each level. */
  function queueRand(seed, level) {
    return mulberry32(seedToInt('queue/' + level + '/' + seed));
  }

  function nextPiece(rand) {
    const roll = rand();
    const rot = Math.floor(rand() * 4);
    let type = PIECES[PIECES.length - 1];
    let acc = 0;
    for (let i = 0; i < PIECES.length; i++) {
      acc += WEIGHTS[i];
      if (roll < acc) { type = PIECES[i]; break; }
    }
    if (type === 'cross') return { type: type, rot: 0 };
    if (type === 'straight' || type === 'valve') return { type: type, rot: rot % 2 };
    return { type: type, rot: rot };
  }

  // ── Boards ─────────────────────────────────────────────────────────────────

  function isPositiveInt(n) {
    return Number.isInteger(n) && n > 0;
  }

  /**
   * A level definition {name, rows, countdown, fillMs, target} to a board. Legend: `.` empty, `#` rock,
   * `D` depot, `^ > v <` the wellhead and its outlet, `-` `|` fixed straights, `+` a fixed cross.
   * Throws on a board the game cannot run.
   */
  function parseLevel(def) {
    if (!def || !Array.isArray(def.rows) || def.rows.length < 1) throw new Error('level has no rows');
    const height = def.rows.length;
    const width = String(def.rows[0]).length;
    if (width < 2 || width > MAX_W || height > MAX_H) throw new Error('board is ' + width + 'x' + height);
    if (!isPositiveInt(def.countdown) || !isPositiveInt(def.fillMs)) throw new Error('bad timing');
    if (!Number.isInteger(def.target) || def.target < 0) throw new Error('bad target');
    let well = null;
    const cells = def.rows.map(function (row, y) {
      if (typeof row !== 'string' || row.length !== width) throw new Error('row ' + y + ' is ragged');
      return row.split('').map(function (ch, x) {
        if (ch === '.') return { kind: 'empty' };
        if (ch === '#') return { kind: 'rock' };
        if (ch === 'D') return { kind: 'depot' };
        if (Object.prototype.hasOwnProperty.call(FIXED, ch)) {
          return { kind: 'pipe', piece: Object.assign({}, FIXED[ch]), fixed: true };
        }
        if (Object.prototype.hasOwnProperty.call(WELLS, ch)) {
          if (well) throw new Error('two wellheads');
          well = { x: x, y: y, dir: WELLS[ch] };
          return { kind: 'well', dir: WELLS[ch] };
        }
        throw new Error('unknown cell ' + JSON.stringify(ch));
      });
    });
    if (!well) throw new Error('no wellhead');
    const ox = well.x + DX[well.dir];
    const oy = well.y + DY[well.dir];
    if (ox < 0 || oy < 0 || ox >= width || oy >= height || cells[oy][ox].kind === 'rock') {
      throw new Error('wellhead outlet is blocked');
    }
    return {
      name: String(def.name || ''),
      width: width,
      height: height,
      cells: cells,
      well: well,
      countdown: def.countdown,
      fillMs: def.fillMs,
      target: def.target
    };
  }

  /** An endless board from the seed: a full-size grid, scattered rock, two depots, the wellhead inland. */
  function endlessLevel(seed) {
    const rand = mulberry32(seedToInt('board/' + seed));
    const grid = [];
    for (let y = 0; y < MAX_H; y++) grid.push(new Array(MAX_W).fill('.'));
    const wx = 2 + Math.floor(rand() * (MAX_W - 4));
    const wy = 2 + Math.floor(rand() * (MAX_H - 4));
    const dir = Math.floor(rand() * 4);
    grid[wy][wx] = '^>v<'[dir];
    const reserved = function (x, y) {
      return Math.abs(x - wx) + Math.abs(y - wy) <= 1;
    };
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rand() * MAX_W);
      const y = Math.floor(rand() * MAX_H);
      if (!reserved(x, y)) grid[y][x] = '#';
    }
    let depots = 0;
    while (depots < 2) {
      const x = Math.floor(rand() * MAX_W);
      const y = Math.floor(rand() * MAX_H);
      if (grid[y][x] === '.' && Math.abs(x - wx) + Math.abs(y - wy) >= 4) {
        grid[y][x] = 'D';
        depots++;
      }
    }
    return {
      name: 'Seed ' + seed,
      rows: grid.map(function (r) { return r.join(''); }),
      countdown: 15000,
      fillMs: 1800,
      target: 400
    };
  }

  /** The named level, an endless board for LEVEL_ENDLESS, or level "1" when the name is unknown. */
  function levelConfig(levels, level, seed) {
    if (level === LEVEL_ENDLESS) return Object.assign({ level: LEVEL_ENDLESS }, parseLevel(endlessLevel(seed)));
    const key = typeof level === 'string' && Object.prototype.hasOwnProperty.call(levels, level) ? level : '1';
    return Object.assign({ level: key }, parseLevel(levels[key]));
  }

  // ── A round ────────────────────────────────────────────────────────────────

  function newGame(cfg, seed) {
    const rand = queueRand(seed, cfg.level);
    const queue = [];
    for (let i = 0; i < QUEUE_SIZE; i++) queue.push(nextPiece(rand));
    const cells = cfg.cells.map(function (row) {
      return row.map(function (c) {
        const copy = Object.assign({}, c, { entered: [false, false], filled: [false, false] });
        if (c.piece) copy.piece = Object.assign({}, c.piece);
        return copy;
      });
    });
    cells[cfg.well.y][cfg.well.x].entered[0] = true;
    return {
      cfg: cfg,
      seed: seed,
      cells: cells,
      rand: rand,
      queue: queue,
      clock: 0,
      heads: [{ x: cfg.well.x, y: cfg.well.y, from: -1, ch: 0, startedAt: cfg.countdown, dur: cfg.fillMs }],
      score: { barrels: 0, cells: 0, tanks: 0, crossings: 0, depots: 0, placed: 0, overwrites: 0 },
      over: false,
      sealed: false,
      spill: null
    };
  }

  function cellAt(state, x, y) {
    if (x < 0 || y < 0 || y >= state.cells.length || x >= state.cells[0].length) return null;
    return state.cells[y][x];
  }

  function addBarrels(state, n) {
    state.score.barrels = Math.min(MAX_SCORE, state.score.barrels + n);
  }

  function countdownLeft(state) {
    return Math.max(0, state.cfg.countdown - state.clock);
  }

  /** Crude finished filling one channel: score it, then send it on, or spill. */
  function complete(state, h) {
    const cell = state.cells[h.y][h.x];
    const end = h.startedAt + h.dur;
    cell.filled[h.ch] = true;
    let exits;
    if (cell.kind === 'well') {
      exits = [cell.dir];
    } else {
      state.score.cells++;
      addBarrels(state, POINTS.cell);
      if (cell.piece.type === 'tank') {
        state.score.tanks++;
        addBarrels(state, POINTS.tank);
      }
      if (cell.piece.type === 'cross' && cell.filled[0] && cell.filled[1]) {
        state.score.crossings++;
        addBarrels(state, POINTS.cross);
      }
      exits = exitsFor(cell.piece, h.from);
    }
    for (let i = 0; i < exits.length; i++) {
      const d = exits[i];
      const nx = h.x + DX[d];
      const ny = h.y + DY[d];
      const n = cellAt(state, nx, ny);
      const side = opposite(d);
      if (n && n.kind === 'depot') {
        if (!n.entered[0]) {
          n.entered[0] = true;
          n.filled[0] = true;
          state.score.depots++;
          addBarrels(state, POINTS.depot);
        }
        continue;
      }
      if (!n || n.kind !== 'pipe' || !accepts(n.piece, side)) {
        state.over = true;
        state.spill = { x: h.x, y: h.y, dir: d };
        state.heads = [];
        state.clock = end;
        return;
      }
      const ch = channelOf(n.piece, side);
      if (n.entered[ch]) continue; // crude meets crude: the branches merge
      n.entered[ch] = true;
      state.heads.push({ x: nx, y: ny, from: side, ch: ch, startedAt: end, dur: state.cfg.fillMs * SLOWDOWN[n.piece.type] });
    }
    if (state.heads.length === 0) {
      state.over = true;
      state.sealed = true;
      addBarrels(state, POINTS.seal);
      state.clock = end;
    }
  }

  /** Runs the flow up to clock `to` (ms). Heads finish in time order; a tie goes to the older head. */
  function advance(state, to) {
    while (!state.over) {
      let best = -1;
      let bestEnd = Infinity;
      for (let i = 0; i < state.heads.length; i++) {
        const end = state.heads[i].startedAt + state.heads[i].dur;
        if (end <= to && end < bestEnd) { best = i; bestEnd = end; }
      }
      if (best === -1) break;
      complete(state, state.heads.splice(best, 1)[0]);
    }
    if (!state.over) state.clock = Math.max(state.clock, to);
  }

  /**
   * Lays the front queue piece at (x, y). Overwriting a laid piece (one crude has not reached) costs
   * OVERWRITE_MS of flow. Returns {ok, overwrite} or {ok: false, reason}.
   */
  function place(state, x, y) {
    if (state.over) return { ok: false, reason: 'over' };
    const cell = cellAt(state, x, y);
    if (!cell) return { ok: false, reason: 'outside' };
    if (cell.kind !== 'empty' && cell.kind !== 'pipe') return { ok: false, reason: 'blocked' };
    if (cell.fixed) return { ok: false, reason: 'blocked' };
    if (cell.entered[0] || cell.entered[1]) return { ok: false, reason: 'flowing' };
    const overwrite = cell.kind === 'pipe';
    cell.kind = 'pipe';
    cell.piece = state.queue.shift();
    state.queue.push(nextPiece(state.rand));
    state.score.placed++;
    if (overwrite) {
      state.score.overwrites++;
      advance(state, state.clock + OVERWRITE_MS);
    }
    return { ok: true, overwrite: overwrite };
  }

  // ── Results and saves ──────────────────────────────────────────────────────

  /** Which results buttons are disabled; Share waits for a successful submit (see pop). */
  function resultButtons(run) {
    return { submit: !run.over || run.submit !== 'idle', share: run.submit !== 'done' };
  }

  function submitText(r) {
    return r.rank > 0 ? 'Rank #' + r.rank + ' · your best ' + r.best : 'Your best ' + r.best;
  }

  /** Every playable level key: the hand-made ones from levels.json, then endless. */
  function levelKeys(levels) {
    return Object.keys(levels).concat([LEVEL_ENDLESS]);
  }

  /** The best-per-level map from a save, keeping only known levels with a valid score. */
  function readBest(saved, keys) {
    const out = {};
    const best = saved && saved.best;
    if (!best || typeof best !== 'object' || Array.isArray(best)) return out;
    Object.keys(best).forEach(function (k) {
      const v = best[k];
      if (keys.indexOf(k) !== -1 && Number.isInteger(v) && v >= 0 && v <= MAX_SCORE) out[k] = v;
    });
    return out;
  }

  function mergeBest(best, level, score, keys) {
    const improved = keys.indexOf(level) !== -1 && !(best[level] >= score);
    if (!improved) return { best: best, improved: false };
    const next = Object.assign({}, best);
    next[level] = score;
    return { best: next, improved: true };
  }

  /**
   * The first run of a session: the challenge's level and seed when the level still exists, else level "1"
   * with no seed (a fresh one is drawn) and a note that says the challenged level is gone.
   */
  function challengeStart(levels, challenge) {
    if (!challenge) return { level: '1', seed: null, note: '' };
    const label = challenge.level === LEVEL_ENDLESS ? 'Endless' : 'Level ' + challenge.level;
    if (levelKeys(levels).indexOf(challenge.level) !== -1) {
      return { level: challenge.level, seed: challenge.seed, note: 'Challenge: ' + label + ', seed ' + challenge.seed + '. Same board, same pieces.' };
    }
    return { level: '1', seed: null, note: 'This challenge was for ' + label + ', which is no longer here. Starting at Level 1 with new pieces.' };
  }

  /** A1 is the top-left cell. */
  function cellName(x, y) {
    return 'ABCDEFGHIJ'[x] + (y + 1);
  }

  const api = {
    DIRS: DIRS,
    DX: DX,
    DY: DY,
    MAX_W: MAX_W,
    MAX_H: MAX_H,
    QUEUE_SIZE: QUEUE_SIZE,
    OVERWRITE_MS: OVERWRITE_MS,
    POINTS: POINTS,
    MAX_SCORE: MAX_SCORE,
    PIECES: PIECES,
    SLOWDOWN: SLOWDOWN,
    LEVEL_ENDLESS: LEVEL_ENDLESS,
    mulberry32: mulberry32,
    seedToInt: seedToInt,
    randomSeed: randomSeed,
    openings: openings,
    exitsFor: exitsFor,
    channelOf: channelOf,
    queueRand: queueRand,
    nextPiece: nextPiece,
    parseLevel: parseLevel,
    endlessLevel: endlessLevel,
    levelConfig: levelConfig,
    newGame: newGame,
    countdownLeft: countdownLeft,
    advance: advance,
    place: place,
    resultButtons: resultButtons,
    submitText: submitText,
    levelKeys: levelKeys,
    readBest: readBest,
    mergeBest: mergeBest,
    challengeStart: challengeStart,
    cellName: cellName
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Gusher = api;
  }
}());
