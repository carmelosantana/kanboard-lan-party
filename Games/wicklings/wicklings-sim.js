/*
 * Wicklings: the pure simulation. No DOM, no Math.random, no clock: a level plus the log of jobs handed out
 * (each stamped with the tick it was given on) replays to exactly the same outcome.
 *
 * The world is a grid of tiles, one wickling per tile step:
 *   .  air        #  earth (diggable)     X  stone (not diggable)     =  plank (diggable)
 *   ~  water      D  the door (air)       L  the lantern (air; reaching it brings a wickling home)
 * Off the left, right and top edges is solid; off the bottom is a fall out of the world.
 *
 * Exported for node:test; the browser loads it as a classic script that sets window.WicklingsSim.
 */
(function () {
  'use strict';

  const TICK_HZ = 6; // simulation steps per second at normal speed
  const MAX_SAFE_FALL = 6; // a landing after more rows than this snuffs a wickling
  const PLANKS = 8; // planks a bridger carries
  const WORK_TICKS = 2; // digging a tile, laying a plank and climbing a tile each take this many ticks
  const MAX_WICKLINGS = 40;
  const MAX_SECONDS = 300;
  const SAVE_POINTS = 100;
  const SECOND_POINTS = 10;
  const MAX_SCORE = MAX_WICKLINGS * SAVE_POINTS + MAX_SECONDS * SECOND_POINTS; // game.json scoring.max (7000)
  const JOBS = ['digger', 'blocker', 'bridger', 'climber', 'floater'];
  const TILES = '.#X=~DL';
  const ID_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
  const SEED_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  // ── Seeds (cosmetic flicker only; the puzzle is the same for every seed) ────

  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedToInt(seed) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function randomSeed(rand) {
    let s = '';
    for (let i = 0; i < 8; i++) s += SEED_CHARS[Math.floor(rand() * SEED_CHARS.length)];
    return s;
  }

  // ── Levels ─────────────────────────────────────────────────────────────────

  function isInt(n, lo, hi) {
    return Number.isInteger(n) && n >= lo && n <= hi;
  }

  /** Checks one raw level from levels.json and returns it ready to play; throws an Error naming the bad field. */
  function parseLevel(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('level is not an object');
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) throw new Error('bad level id');
    const where = 'level ' + raw.id + ': ';
    if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 40) throw new Error(where + 'bad name');
    const map = raw.map;
    if (!Array.isArray(map) || map.length < 2 || map.length > 40) throw new Error(where + 'map needs 2 to 40 rows');
    const w = typeof map[0] === 'string' ? map[0].length : 0;
    if (w < 3 || w > 64) throw new Error(where + 'row width must be 3 to 64');
    let door = null;
    let lantern = null;
    map.forEach(function (row, y) {
      if (typeof row !== 'string' || row.length !== w) throw new Error(where + 'row ' + y + ' is not ' + w + ' wide');
      for (let x = 0; x < w; x++) {
        const t = row[x];
        if (TILES.indexOf(t) === -1) throw new Error(where + 'unknown tile "' + t + '" at ' + x + ',' + y);
        if (t === 'D') {
          if (door) throw new Error(where + 'more than one door');
          door = { x: x, y: y };
        } else if (t === 'L') {
          if (lantern) throw new Error(where + 'more than one lantern');
          lantern = { x: x, y: y };
        }
      }
    });
    if (!door) throw new Error(where + 'no door');
    if (!lantern) throw new Error(where + 'no lantern');
    if (!isInt(raw.count, 1, MAX_WICKLINGS)) throw new Error(where + 'count must be 1 to ' + MAX_WICKLINGS);
    if (!isInt(raw.need, 1, raw.count)) throw new Error(where + 'need must be 1 to count');
    if (!isInt(raw.seconds, 1, MAX_SECONDS)) throw new Error(where + 'seconds must be 1 to ' + MAX_SECONDS);
    if (!isInt(raw.rate, 1, 60)) throw new Error(where + 'rate must be 1 to 60 ticks');
    const dir = raw.dir === undefined ? 1 : raw.dir;
    if (dir !== 1 && dir !== -1) throw new Error(where + 'dir must be 1 or -1');
    const jobs = {};
    const given = raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {};
    Object.keys(given).forEach(function (k) {
      if (JOBS.indexOf(k) === -1) throw new Error(where + 'unknown job ' + k);
    });
    JOBS.forEach(function (k) {
      const n = given[k] === undefined ? 0 : given[k];
      if (!isInt(n, 0, 99)) throw new Error(where + 'job ' + k + ' must be 0 to 99');
      jobs[k] = n;
    });
    return {
      id: raw.id,
      name: raw.name,
      hint: typeof raw.hint === 'string' ? raw.hint : '',
      count: raw.count,
      need: raw.need,
      seconds: raw.seconds,
      rate: raw.rate,
      dir: dir,
      jobs: jobs,
      w: w,
      h: map.length,
      tiles: map.join(''),
      door: door,
      lantern: lantern
    };
  }

  /** levels.json ({levels: [...]}) to {order: [id...], byId: {id: level}}; ids must be unique. */
  function parseLevels(json) {
    if (!json || !Array.isArray(json.levels) || json.levels.length === 0) throw new Error('levels.json has no levels');
    const byId = Object.create(null);
    const order = json.levels.map(function (raw) {
      const lv = parseLevel(raw);
      if (byId[lv.id]) throw new Error('duplicate level id ' + lv.id);
      byId[lv.id] = lv;
      return lv.id;
    });
    return { order: order, byId: byId };
  }

  // ── State ──────────────────────────────────────────────────────────────────

  function createState(level) {
    return {
      level: level,
      w: level.w,
      h: level.h,
      tiles: level.tiles,
      tick: 0,
      released: 0,
      walkers: [],
      jobs: Object.assign({}, level.jobs),
      saved: 0,
      lost: 0,
      log: [],
      over: false
    };
  }

  function tileAt(s, x, y) {
    if (x < 0 || x >= s.w || y < 0) return 'X';
    if (y >= s.h) return '.';
    return s.tiles[y * s.w + x];
  }

  function setTile(s, x, y, t) {
    const i = y * s.w + x;
    s.tiles = s.tiles.slice(0, i) + t + s.tiles.slice(i + 1);
  }

  function solid(s, x, y) {
    const t = tileAt(s, x, y);
    return t === '#' || t === 'X' || t === '=';
  }

  function blockerAt(s, x, y, self) {
    for (let i = 0; i < s.walkers.length; i++) {
      const o = s.walkers[i];
      if (o !== self && o.state === 'block' && o.x === x && o.y === y) return true;
    }
    return false;
  }

  function finished(w) {
    return w.state === 'saved' || w.state === 'lost';
  }

  function lose(s, w, cause) {
    w.state = 'lost';
    w.cause = cause;
    s.lost++;
  }

  /** What happens when a wickling arrives in a tile: home at the lantern, snuffed in water or below the map. */
  function enter(s, w) {
    if (w.y >= s.h) return lose(s, w, 'fall');
    const t = tileAt(s, w.x, w.y);
    if (t === 'L') {
      w.state = 'saved';
      s.saved++;
    } else if (t === '~') {
      lose(s, w, 'water');
    }
  }

  function walkStep(s, w) {
    const nx = w.x + w.dir;
    if (blockerAt(s, nx, w.y, w)) {
      w.dir = -w.dir;
      return;
    }
    if (solid(s, nx, w.y)) {
      if (!solid(s, nx, w.y - 1) && !solid(s, w.x, w.y - 1)) {
        w.x = nx;
        w.y -= 1;
        enter(s, w);
      } else if (w.climber) {
        w.state = 'climb';
        w.work = 0;
      } else {
        w.dir = -w.dir;
      }
      return;
    }
    w.x = nx;
    enter(s, w);
  }

  function update(s, w) {
    w.px = w.x;
    w.py = w.y;
    if (w.state === 'block') {
      if (!solid(s, w.x, w.y + 1)) {
        w.state = 'fall';
        w.fall = 0;
      }
      return;
    }
    if (w.state !== 'climb' && !solid(s, w.x, w.y + 1)) {
      if (w.state !== 'fall') {
        w.state = 'fall';
        w.fall = 0;
        w.work = 0;
      }
      if (w.floater) {
        w.drift = !w.drift; // floaters sink one row every other tick
        if (w.drift) return;
      }
      w.y += 1;
      w.fall += 1;
      enter(s, w);
      return;
    }
    if (w.state === 'fall') {
      if (w.fall > MAX_SAFE_FALL && !w.floater) return lose(s, w, 'fall');
      w.state = w.planks > 0 ? 'build' : 'walk';
      w.fall = 0;
      w.drift = false;
      return;
    }
    if (w.state === 'walk') return walkStep(s, w);
    if (w.state === 'dig') {
      if (++w.work < WORK_TICKS) return;
      w.work = 0;
      const below = tileAt(s, w.x, w.y + 1);
      if (below === '#' || below === '=') {
        setTile(s, w.x, w.y + 1, '.');
        w.y += 1;
        enter(s, w);
      } else {
        w.state = 'walk';
      }
      return;
    }
    if (w.state === 'build') {
      const nx = w.x + w.dir;
      const gap = w.y + 1 < s.h && !solid(s, nx, w.y + 1) && !solid(s, nx, w.y) && !blockerAt(s, nx, w.y, w);
      if (!gap) return walkStep(s, w);
      if (++w.work < WORK_TICKS) return;
      w.work = 0;
      setTile(s, nx, w.y + 1, '=');
      w.planks -= 1;
      if (w.planks === 0) w.state = 'walk';
      w.x = nx;
      enter(s, w);
      return;
    }
    if (w.state === 'climb') {
      if (++w.work < WORK_TICKS) return;
      w.work = 0;
      if (!solid(s, w.x + w.dir, w.y)) {
        w.x += w.dir;
        w.state = w.planks > 0 ? 'build' : 'walk';
        enter(s, w);
      } else if (solid(s, w.x, w.y - 1)) {
        w.dir = -w.dir; // a ceiling: let go and drop
        w.state = 'fall';
        w.fall = 0;
      } else {
        w.y -= 1;
      }
    }
  }

  function release(s) {
    const lv = s.level;
    const w = {
      id: s.released,
      x: lv.door.x,
      y: lv.door.y,
      px: lv.door.x,
      py: lv.door.y,
      dir: lv.dir,
      state: 'fall',
      fall: 0,
      work: 0,
      planks: 0,
      climber: false,
      floater: false,
      drift: false,
      cause: null
    };
    s.walkers.push(w);
    s.released++;
  }

  function limitTicks(s) {
    return s.level.seconds * TICK_HZ;
  }

  /** One fixed step: every wickling in id order, then the door releases the next one when it is due. */
  function step(s) {
    if (s.over) return;
    for (let i = 0; i < s.walkers.length; i++) {
      if (!finished(s.walkers[i])) update(s, s.walkers[i]);
    }
    if (s.released < s.level.count && s.tick % s.level.rate === 0) release(s);
    s.tick++;
    const settled = s.released === s.level.count && s.walkers.every(function (w) {
      return finished(w) || w.state === 'block';
    });
    if (settled || s.tick >= limitTicks(s)) s.over = true;
  }

  /** Hands a job to wickling `id`; false (and nothing changes) when it cannot take it. */
  function assign(s, id, job) {
    if (s.over || JOBS.indexOf(job) === -1 || !(s.jobs[job] > 0)) return false;
    const w = s.walkers[id];
    if (!w || finished(w)) return false;
    if (job === 'climber' || job === 'floater') {
      if (w[job]) return false;
      w[job] = true;
    } else {
      if (w.state !== 'walk') return false;
      w.work = 0;
      if (job === 'digger') w.state = 'dig';
      else if (job === 'blocker') w.state = 'block';
      else {
        w.state = 'build';
        w.planks = PLANKS;
      }
    }
    s.jobs[job] -= 1;
    s.log.push({ tick: s.tick, id: id, job: job });
    return true;
  }

  /** Gives up on the level: whoever is not home yet stays out. */
  function end(s) {
    if (s.over) return;
    s.log.push({ tick: s.tick, id: -1, job: 'end' });
    s.over = true;
  }

  /** Plays a level from scratch with a recorded job log; same level and log, same state. */
  function replay(level, log) {
    const s = createState(level);
    let i = 0;
    const cap = level.seconds * TICK_HZ + 1;
    for (let n = 0; n <= cap && !s.over; n++) {
      while (i < log.length && log[i].tick === s.tick) {
        const e = log[i++];
        if (e.job === 'end') end(s);
        else assign(s, e.id, e.job);
      }
      step(s);
    }
    return s;
  }

  function won(s) {
    return s.saved >= s.level.need;
  }

  function secondsLeft(s) {
    return Math.max(0, Math.floor((limitTicks(s) - s.tick) / TICK_HZ));
  }

  /** Wicks: 100 per wickling home, plus 10 per whole second left when the goal is met. */
  function score(s) {
    const bonus = won(s) ? secondsLeft(s) * SECOND_POINTS : 0;
    return Math.min(MAX_SCORE, s.saved * SAVE_POINTS + bonus);
  }

  function summary(s) {
    return {
      tick: s.tick,
      released: s.released,
      saved: s.saved,
      lost: s.lost,
      over: s.over,
      won: won(s),
      score: score(s)
    };
  }

  // ── Results and saves ──────────────────────────────────────────────────────

  function resultButtons(run) {
    return { submit: !run.over || run.submit !== 'idle', share: run.submit !== 'done' };
  }

  function submitText(r) {
    return r.rank > 0 ? 'Rank #' + r.rank + ' · your best ' + r.best : 'Your best ' + r.best;
  }

  /** A saved value to {v: 1, unlocked, best: {levelId: score}}, dropping anything malformed. */
  function readSave(raw, count) {
    const levels = count || 12;
    const out = { v: 1, unlocked: 1, best: {} };
    if (!raw || typeof raw !== 'object') return out;
    if (Number.isInteger(raw.unlocked)) out.unlocked = Math.max(1, Math.min(levels, raw.unlocked));
    if (raw.best && typeof raw.best === 'object') {
      Object.keys(raw.best).forEach(function (k) {
        const v = raw.best[k];
        if (ID_PATTERN.test(k) && isInt(v, 0, MAX_SCORE)) out.best[k] = v;
      });
    }
    return out;
  }

  /** Keeps the best score for a level and, on a win, unlocks the level after it. */
  function recordResult(save, order, id, points, didWin) {
    if (!(save.best[id] >= points)) save.best[id] = points;
    const at = order.indexOf(id);
    if (didWin && at !== -1) save.unlocked = Math.max(save.unlocked, Math.min(order.length, at + 2));
    return save;
  }

  const api = {
    TICK_HZ: TICK_HZ,
    MAX_SAFE_FALL: MAX_SAFE_FALL,
    PLANKS: PLANKS,
    WORK_TICKS: WORK_TICKS,
    MAX_WICKLINGS: MAX_WICKLINGS,
    MAX_SECONDS: MAX_SECONDS,
    SAVE_POINTS: SAVE_POINTS,
    SECOND_POINTS: SECOND_POINTS,
    MAX_SCORE: MAX_SCORE,
    JOBS: JOBS,
    mulberry32: mulberry32,
    seedToInt: seedToInt,
    randomSeed: randomSeed,
    parseLevel: parseLevel,
    parseLevels: parseLevels,
    createState: createState,
    tileAt: tileAt,
    solid: solid,
    step: step,
    assign: assign,
    end: end,
    replay: replay,
    won: won,
    secondsLeft: secondsLeft,
    score: score,
    summary: summary,
    resultButtons: resultButtons,
    submitText: submitText,
    readSave: readSave,
    recordResult: recordResult
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.WicklingsSim = api;
  }
}());
