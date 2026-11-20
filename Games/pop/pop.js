/*
 * Pop: the LAN Party sample game. Bubbles rise for 30 seconds; pop them for points. Every five pops in a row
 * raise the multiplier (up to x5); a miss or a bubble that escapes the top resets the streak.
 *
 * It uses every phase 1 SDK call a game needs: ready() first, asset('levels.json'), load()/save() for the best
 * streak, submitScore(), share() for a challenge link (level + seed), exit(). A seed makes the run repeatable, so
 * a shared challenge replays the same bubbles.
 *
 * The pure parts (seeded spawns, scoring) are exported for node:test; in the browser the game starts itself.
 */
(function () {
  'use strict';

  const FIELD = { width: 480, height: 640 };
  const TINTS = ['#ff6b6b', '#ffb347', '#4ecdc4', '#5b8def', '#c77dff'];
  const POINTS = 10;
  const COMBO_STEP = 5;
  const MAX_MULTIPLIER = 5;
  const MAX_SCORE = 100000; // game.json scoring.max
  const SEED_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  // ── Pure parts ─────────────────────────────────────────────────────────────

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

  /** The named level from levels.json, or level "1" when the name is unknown. */
  function levelConfig(levels, level) {
    const key = typeof level === 'string' && Object.prototype.hasOwnProperty.call(levels, level) ? level : '1';
    return Object.assign({ level: key }, levels[key]);
  }

  function between(rand, lo, hi) {
    return Math.round(lo + rand() * (hi - lo));
  }

  /** Every bubble of a run, in spawn order: {at (ms), x, r, speed (px/s), tint}. Same seed, same run. */
  function planBubbles(cfg, seed) {
    const rand = mulberry32(seedToInt(seed));
    const out = [];
    for (let at = 0; at < cfg.seconds * 1000; at += cfg.every) {
      const r = between(rand, cfg.radius[0], cfg.radius[1]);
      out.push({
        at: at,
        x: between(rand, r, FIELD.width - r),
        r: r,
        speed: between(rand, cfg.speed[0], cfg.speed[1]),
        tint: Math.floor(rand() * TINTS.length)
      });
    }
    return out;
  }

  /** A bubble's centre height at run time t (ms): it starts just below the field and rises. */
  function bubbleY(b, t) {
    return FIELD.height + b.r - (b.speed * (t - b.at)) / 1000;
  }

  /** Index of the topmost (latest) bubble under (x, y) at time t, or -1. */
  function hitTest(live, x, y, t) {
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      const dx = x - b.x;
      const dy = y - bubbleY(b, t);
      if (dx * dx + dy * dy <= b.r * b.r) return i;
    }
    return -1;
  }

  function multiplier(combo) {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / COMBO_STEP));
  }

  function createScore() {
    return { score: 0, pops: 0, combo: 0, bestCombo: 0 };
  }

  /** Counts one pop and returns the points it earned. */
  function scorePop(s) {
    const gained = POINTS * multiplier(s.combo);
    s.score = Math.min(MAX_SCORE, s.score + gained);
    s.pops++;
    s.combo++;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    return gained;
  }

  function breakCombo(s) {
    s.combo = 0;
  }

  /**
   * Which results buttons are disabled. run.submit is idle | pending | done | failed. Share waits for a
   * successful submit: a challenge link only shows a challenge once the sharer has a score.
   */
  function resultButtons(run) {
    return { submit: !run.over || run.submit !== 'idle', share: run.submit !== 'done' };
  }

  /** The status line after a submit; rank is 0 for players kept off the boards, so leave it out then. */
  function submitText(r) {
    return r.rank > 0 ? 'Rank #' + r.rank + ' · your best ' + r.best : 'Your best ' + r.best;
  }

  // ── Browser game ───────────────────────────────────────────────────────────

  function start(win, doc, sdk) {
    const canvas = doc.getElementById('field');
    const ctx = canvas.getContext('2d');
    const status = doc.getElementById('status');
    const intro = doc.getElementById('intro');
    const results = doc.getElementById('results');
    const reduceMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keys = new Set();

    let levels = null;
    let bestStreak = 0;
    let bestLoaded = false; // false when load() failed: never overwrite a save we could not read
    let firstRun = { level: '1', seed: '' }; // the challenge, when the game was opened from one
    let run = null; // {cfg, seed, plan, next, live, rings, score, startedAt, lastFrame, shakeUntil, over, submit}
    let cursor = null; // keyboard reticle, shown once an arrow key is used

    const dpr = win.devicePixelRatio || 1;
    canvas.width = FIELD.width * dpr;
    canvas.height = FIELD.height * dpr;
    ctx.scale(dpr, dpr);

    function say(text) {
      status.textContent = text;
    }

    function errorText(e) {
      return e && e.message ? e.message : 'Something went wrong';
    }

    function show(card) {
      intro.hidden = card !== intro;
      results.hidden = card !== results;
      const button = card && card.querySelector('button');
      if (button) button.focus();
      else canvas.focus();
    }

    function begin(level, seed) {
      const cfg = levelConfig(levels, level);
      run = {
        cfg: cfg,
        seed: seed,
        plan: planBubbles(cfg, seed),
        next: 0,
        live: [],
        rings: [],
        score: createScore(),
        startedAt: win.performance.now(),
        lastFrame: 0,
        shakeUntil: 0,
        over: false,
        submit: 'idle'
      };
      updateButtons();
      show(null);
      say('');
      win.requestAnimationFrame(frame);
    }

    function popAt(x, y) {
      if (!run || run.over) return;
      const t = win.performance.now() - run.startedAt;
      const i = hitTest(run.live, x, y, t);
      if (i === -1) {
        miss(t);
        return;
      }
      const b = run.live.splice(i, 1)[0];
      scorePop(run.score);
      if (!reduceMotion) run.rings.push({ x: b.x, y: bubbleY(b, t), r: b.r, tint: b.tint, at: t });
    }

    function miss(t) {
      if (run.score.combo > 0 && !reduceMotion) run.shakeUntil = t + 200;
      breakCombo(run.score);
    }

    function frame(now) {
      if (!run) return;
      const t = now - run.startedAt;
      const dt = run.lastFrame ? Math.min(0.05, (now - run.lastFrame) / 1000) : 0;
      run.lastFrame = now;
      while (run.next < run.plan.length && run.plan[run.next].at <= t) run.live.push(run.plan[run.next++]);
      run.live = run.live.filter(function (b) {
        if (bubbleY(b, t) + b.r > 0) return true;
        miss(t); // escaped off the top
        return false;
      });
      if (cursor) moveCursor(dt);
      draw(t);
      if (t >= run.cfg.seconds * 1000) finish();
      else win.requestAnimationFrame(frame);
    }

    function moveCursor(dt) {
      const step = 360 * dt;
      if (keys.has('ArrowLeft') || keys.has('a')) cursor.x -= step;
      if (keys.has('ArrowRight') || keys.has('d')) cursor.x += step;
      if (keys.has('ArrowUp') || keys.has('w')) cursor.y -= step;
      if (keys.has('ArrowDown') || keys.has('s')) cursor.y += step;
      cursor.x = Math.max(0, Math.min(FIELD.width, cursor.x));
      cursor.y = Math.max(0, Math.min(FIELD.height, cursor.y));
    }

    function draw(t) {
      const s = run.score;
      ctx.save();
      ctx.clearRect(0, 0, FIELD.width, FIELD.height);
      if (t < run.shakeUntil) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);

      run.live.forEach(function (b) {
        const y = bubbleY(b, t);
        ctx.beginPath();
        ctx.arc(b.x, y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = TINTS[b.tint];
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.35, y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fill();
      });

      run.rings = run.rings.filter(function (ring) { return t - ring.at < 250; });
      run.rings.forEach(function (ring) {
        const k = (t - ring.at) / 250;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r * (1 + k), 0, Math.PI * 2);
        ctx.strokeStyle = TINTS[ring.tint];
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      if (cursor) {
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      const left = Math.max(0, Math.ceil(run.cfg.seconds - t / 1000));
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(s.score), 16, 32);
      ctx.textAlign = 'center';
      ctx.fillText('x' + multiplier(s.combo), FIELD.width / 2, 32);
      ctx.textAlign = 'right';
      ctx.fillText(left + 's', FIELD.width - 16, 32);
    }

    function updateButtons() {
      const disabled = resultButtons(run);
      doc.getElementById('submit').disabled = disabled.submit;
      doc.getElementById('share').disabled = disabled.share;
    }

    function finish() {
      const s = run.score;
      run.over = true;
      if (s.bestCombo > bestStreak) {
        bestStreak = s.bestCombo;
        if (bestLoaded) sdk.save({ bestStreak: bestStreak }).catch(function () {});
      }
      doc.getElementById('final-score').textContent = String(s.score);
      doc.getElementById('final-pops').textContent = String(s.pops);
      doc.getElementById('final-streak').textContent = String(s.bestCombo);
      doc.getElementById('best-streak').textContent = String(bestStreak);
      updateButtons();
      show(results);
      say('Level ' + run.cfg.level + ' · seed ' + run.seed);
    }

    function submit() {
      const submitted = run;
      submitted.submit = 'pending';
      updateButtons();
      const s = submitted.score;
      sdk.submitScore({ score: s.score, level: submitted.cfg.level, seed: submitted.seed, meta: { streak: s.bestCombo } })
        .then(function (r) {
          submitted.submit = 'done';
          if (run === submitted) { updateButtons(); say(submitText(r)); }
        })
        .catch(function (e) {
          // Rate limits and outages are worth a retry; any other refusal would only repeat.
          submitted.submit = e.code === 'rate_limited' || e.code === 'unavailable' ? 'idle' : 'failed';
          if (run === submitted) { updateButtons(); say(errorText(e)); }
        });
    }

    function share() {
      const s = run.score;
      sdk.share({ level: run.cfg.level, seed: run.seed, text: 'I scored ' + s.score + ' in Pop. Same bubbles, your turn:' })
        .then(function () { say('Challenge link copied'); })
        .catch(function (e) { say(errorText(e)); });
    }

    function toField(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * FIELD.width) / rect.width,
        y: ((e.clientY - rect.top) * FIELD.height) / rect.height
      };
    }

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      const p = toField(e);
      popAt(p.x, p.y);
    });

    doc.addEventListener('keydown', function (e) {
      if (!run || run.over) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (/^Arrow|^[wasd]$/.test(key)) {
        e.preventDefault();
        if (!cursor) cursor = { x: FIELD.width / 2, y: FIELD.height / 2 };
        keys.add(key);
      } else if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        if (cursor) popAt(cursor.x, cursor.y);
      }
    });
    doc.addEventListener('keyup', function (e) {
      keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });

    doc.getElementById('play').addEventListener('click', function () {
      begin(firstRun.level, firstRun.seed);
    });
    doc.getElementById('submit').addEventListener('click', submit);
    doc.getElementById('share').addEventListener('click', share);
    doc.getElementById('again').addEventListener('click', function () {
      begin(run.cfg.level, randomSeed(Math.random));
    });
    doc.getElementById('exit').addEventListener('click', function () {
      sdk.exit().catch(function () {});
    });

    // ready() first; then the level table and the saved best streak.
    sdk.ready()
      .then(function (info) {
        const challenge = info.challenge;
        firstRun = challenge ? { level: challenge.level, seed: challenge.seed } : { level: '1', seed: randomSeed(Math.random) };
        if (challenge) {
          doc.getElementById('intro-note').textContent = 'Challenge: level ' + challenge.level + ', seed ' + challenge.seed;
        }
        const best = sdk.load().then(
          function (saved) { bestLoaded = true; return saved; },
          function () { return null; }
        );
        return Promise.all([sdk.asset('levels.json'), best]);
      })
      .then(function (loaded) {
        levels = JSON.parse(new TextDecoder().decode(loaded[0]));
        const saved = loaded[1];
        bestStreak = saved && Number.isInteger(saved.bestStreak) ? saved.bestStreak : 0;
        say('');
        show(intro);
      })
      .catch(function (e) {
        say('Pop could not start: ' + errorText(e));
      });
  }

  const api = {
    FIELD: FIELD,
    TINTS: TINTS,
    MAX_SCORE: MAX_SCORE,
    mulberry32: mulberry32,
    seedToInt: seedToInt,
    randomSeed: randomSeed,
    levelConfig: levelConfig,
    planBubbles: planBubbles,
    bubbleY: bubbleY,
    hitTest: hitTest,
    multiplier: multiplier,
    createScore: createScore,
    scorePop: scorePop,
    breakCombo: breakCombo,
    resultButtons: resultButtons,
    submitText: submitText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    start(window, document, window.LanParty);
  }
}());
