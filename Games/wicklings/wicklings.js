/*
 * Wicklings: the browser layer. Draws the tile world on a canvas, runs the fixed-step simulation from
 * wicklings-sim.js on a clock, and wires the LAN Party SDK: ready(), asset('levels.json'), load()/save() for
 * level progress, submitScore(), share() (only after a successful submit) and exit().
 *
 * All game rules live in wicklings-sim.js; this file only reads the state, draws it and forwards input.
 * Cosmetic randomness (stars, flame flicker) comes from the run's seed, never from the simulation.
 */
(function () {
  'use strict';

  const Sim = window.WicklingsSim;
  const TILE = 16;
  const TICK_MS = 1000 / Sim.TICK_HZ;
  const FAST = 3;
  const JOB_KEYS = { digger: '1', blocker: '2', bridger: '3', climber: '4', floater: '5' };
  const JOB_NAMES = { digger: 'Digger', blocker: 'Blocker', bridger: 'Bridger', climber: 'Climber', floater: 'Floater' };
  // Job icons as polylines in a 10 x 10 box: the same shapes draw the buttons (SVG) and the badges (canvas).
  const ICONS = {
    digger: [[5, 1, 5, 9], [2, 6, 5, 9, 8, 6]],
    blocker: [[1, 5, 9, 5], [1, 2, 1, 8], [9, 2, 9, 8]],
    bridger: [[1, 4, 9, 4], [1, 7, 9, 7], [3, 4, 3, 7], [7, 4, 7, 7]],
    climber: [[8, 1, 8, 9], [4, 9, 4, 2], [2, 4, 4, 2, 6, 4]],
    floater: [[1, 5, 3, 2, 5, 1, 7, 2, 9, 5, 1, 5], [1, 5, 5, 9, 9, 5]]
  };
  const COLOURS = {
    earth: '#6b4a2b', earthDot: '#56391f', stone: '#5d6170', stoneEdge: '#7d8294', plank: '#c8955a',
    plankLine: '#9a6b37', water: '#2f6fb3', waterTop: '#8fd3ff', wax: '#f3e6c8', waxShade: '#d8c59c',
    flame: '#ffb84d', flameCore: '#fff2b0', eye: '#2a1d14', badge: '#1a1226', select: '#8fd3ff'
  };

  const STATE_WORDS = {
    walk: 'walking', fall: 'falling', dig: 'digging', block: 'blocking', build: 'laying planks',
    climb: 'climbing', saved: 'home', lost: 'snuffed out'
  };

  function start(win, doc, sdk) {
    const canvas = doc.getElementById('field');
    const ctx = canvas.getContext('2d');
    const status = doc.getElementById('status');
    const intro = doc.getElementById('intro');
    const results = doc.getElementById('results');
    const playBox = doc.getElementById('play');
    const reduceMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let levels = null; // {order, byId}
    let save = Sim.readSave(null);
    let saveLoaded = false; // false when load() failed: never overwrite a save we could not read
    let challenge = null; // {level, seed} when opened from a challenge link
    let run = null; // {level, seed, sim, acc, last, paused, fast, over, submit, stars, effects}
    let job = 'digger';
    let selected = -1;

    function say(text) {
      status.textContent = text;
    }

    function errorText(e) {
      return e && e.message ? e.message : 'Something went wrong';
    }

    function show(card) {
      intro.hidden = card !== intro;
      results.hidden = card !== results;
      playBox.hidden = card !== null;
      const button = card && card.querySelector('button:not(:disabled)');
      if (button) button.focus();
      else if (!card) canvas.focus();
    }

    // ── Job buttons and level list ───────────────────────────────────────────

    function icon(name) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 10 10');
      svg.setAttribute('aria-hidden', 'true');
      ICONS[name].forEach(function (pts) {
        const line = doc.createElementNS(ns, 'polyline');
        line.setAttribute('points', pts.join(' '));
        svg.appendChild(line);
      });
      return svg;
    }

    const jobButtons = {};
    Sim.JOBS.forEach(function (name) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'job';
      b.appendChild(icon(name));
      const label = doc.createElement('span');
      b.appendChild(label);
      const key = doc.createElement('span');
      key.className = 'key';
      key.textContent = '(' + JOB_KEYS[name] + ')';
      b.appendChild(key);
      b.addEventListener('click', function () { chooseJob(name); });
      doc.getElementById('jobs').appendChild(b);
      jobButtons[name] = { button: b, label: label };
    });

    function chooseJob(name) {
      job = name;
      updateJobs();
      if (run && !run.over) canvas.focus();
    }

    function updateJobs() {
      Sim.JOBS.forEach(function (name) {
        const left = run ? run.sim.jobs[name] : 0;
        jobButtons[name].label.textContent = JOB_NAMES[name] + ' ×' + left;
        jobButtons[name].button.setAttribute('aria-pressed', String(name === job));
        jobButtons[name].button.setAttribute('aria-label', JOB_NAMES[name] + ', ' + left + ' left, key ' + JOB_KEYS[name]);
      });
    }

    function buildLevelList() {
      const box = doc.getElementById('levels');
      box.textContent = '';
      levels.order.forEach(function (id, i) {
        const lv = levels.byId[id];
        const open = i < save.unlocked || (challenge && challenge.level === id);
        const b = doc.createElement('button');
        b.type = 'button';
        b.disabled = !open;
        const name = doc.createElement('span');
        name.className = 'name';
        name.textContent = id + '. ' + (open ? lv.name : 'Locked');
        const meta = doc.createElement('span');
        meta.className = 'meta';
        const best = save.best[id];
        meta.textContent = open
          ? 'Bring ' + lv.need + ' of ' + lv.count + (best !== undefined ? ' · best ' + best : '')
          : 'Win level ' + levels.order[i - 1] + ' to open';
        b.appendChild(name);
        b.appendChild(meta);
        b.addEventListener('click', function () {
          begin(id, challenge && challenge.level === id ? challenge.seed : Sim.randomSeed(Math.random));
        });
        box.appendChild(b);
      });
    }

    function showLevels() {
      run = null;
      buildLevelList();
      show(intro);
      // Focus the newest open level rather than level 1.
      const open = intro.querySelectorAll('.levels button:not(:disabled)');
      const pick = challenge ? Array.prototype.find.call(open, function (b) {
        return b.querySelector('.name').textContent.indexOf(challenge.level + '.') === 0;
      }) : open[open.length - 1];
      if (pick) pick.focus();
    }

    // ── Running a level ──────────────────────────────────────────────────────

    function begin(id, seed) {
      const level = levels.byId[id];
      const rand = Sim.mulberry32(Sim.seedToInt(seed));
      const stars = [];
      for (let i = 0; i < 40; i++) stars.push({ x: rand() * level.w * TILE, y: rand() * level.h * TILE * 0.6, r: 0.5 + rand() });
      run = {
        level: level,
        seed: seed,
        sim: Sim.createState(level),
        flicker: Sim.mulberry32(Sim.seedToInt(seed) ^ 0x5bd1e995),
        acc: 0,
        last: 0,
        paused: false,
        fast: false,
        over: false,
        submit: 'idle',
        stars: stars,
        effects: []
      };
      selected = -1;
      const dpr = win.devicePixelRatio || 1;
      canvas.width = level.w * TILE * dpr;
      canvas.height = level.h * TILE * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      doc.getElementById('hud-level').textContent = 'Level ' + level.id + ': ' + level.name;
      setToggle('pause', false);
      setToggle('fast', false);
      updateJobs();
      updateHud();
      updateButtons();
      show(null);
      say(level.hint);
      win.requestAnimationFrame(frame);
    }

    function setToggle(id, on) {
      doc.getElementById(id).setAttribute('aria-pressed', String(on));
      if (run) run[id === 'pause' ? 'paused' : 'fast'] = on;
    }

    function frame(now) {
      if (!run || run.over) return;
      const thisRun = run;
      const dt = thisRun.last ? Math.min(250, now - thisRun.last) : 0;
      thisRun.last = now;
      if (!thisRun.paused) {
        thisRun.acc += dt * (thisRun.fast ? FAST : 1);
        let ticked = false;
        while (thisRun.acc >= TICK_MS && !thisRun.sim.over) {
          const before = thisRun.sim.walkers.map(function (w) { return w.state; });
          Sim.step(thisRun.sim);
          thisRun.acc -= TICK_MS;
          noteChanges(before);
          ticked = true;
        }
        if (ticked) updateHud();
      }
      draw(thisRun.paused ? 1 : Math.min(1, thisRun.acc / TICK_MS), now);
      if (thisRun.sim.over) finish();
      else win.requestAnimationFrame(frame);
    }

    /** Effects for wicklings that just went home or out, and a word for the one the keyboard is on. */
    function noteChanges(before) {
      run.sim.walkers.forEach(function (w, i) {
        if (before[i] === w.state) return;
        if (w.state === 'saved' || w.state === 'lost') {
          if (!reduceMotion) run.effects.push({ x: w.x, y: Math.min(w.y, run.sim.h - 1), kind: w.state, at: run.sim.tick });
          if (i === selected) selectNext(1);
        }
      });
    }

    function active() {
      return run.sim.walkers.filter(function (w) { return w.state !== 'saved' && w.state !== 'lost'; });
    }

    function describe(w) {
      const knacks = (w.climber ? ', climber' : '') + (w.floater ? ', floater' : '');
      const way = w.state === 'block' ? '' : w.dir > 0 ? ' right' : ' left';
      return 'Wickling ' + (w.id + 1) + ': ' + STATE_WORDS[w.state] + way + knacks;
    }

    function selectNext(step) {
      const list = active();
      if (list.length === 0) {
        selected = -1;
        return;
      }
      let at = list.findIndex(function (w) { return w.id === selected; });
      if (at === -1) at = step > 0 ? -1 : 0;
      const w = list[(at + step + list.length) % list.length];
      selected = w.id;
      say(describe(w));
    }

    function give(id) {
      if (!run || run.over || id < 0) return;
      const problem = Sim.assignProblem(run.sim, id, job);
      if (problem) {
        say('Wickling ' + (id + 1) + ': ' + problem);
        return;
      }
      Sim.assign(run.sim, id, job);
      updateJobs();
      say('Wickling ' + (id + 1) + ' is now a ' + job);
    }

    function updateHud() {
      const s = run.sim;
      const left = Sim.secondsLeft(s);
      const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      doc.getElementById('hud-stats').textContent =
        'Out ' + s.released + '/' + s.level.count + ' · Home ' + s.saved + ' (need ' + s.level.need + ') · Snuffed ' + s.lost + ' · ' + clock;
    }

    function updateButtons() {
      const disabled = Sim.resultButtons(run);
      doc.getElementById('submit').disabled = disabled.submit;
      doc.getElementById('share').disabled = disabled.share;
    }

    function finish() {
      const s = run.sim;
      run.over = true;
      const won = Sim.won(s);
      const points = Sim.score(s);
      Sim.recordResult(save, levels.order, run.level.id, points, won);
      if (saveLoaded) sdk.save(save).catch(function () {});
      const next = levels.order[levels.order.indexOf(run.level.id) + 1];
      doc.getElementById('result-title').textContent = won ? 'Lantern lit' : 'Not enough made it home';
      doc.getElementById('result-level').textContent = 'Level ' + run.level.id + ': ' + run.level.name;
      doc.getElementById('r-home').textContent = s.saved + ' of ' + s.level.count + ' (needed ' + s.level.need + ')';
      doc.getElementById('r-lost').textContent = String(s.lost);
      doc.getElementById('r-bonus').textContent = won ? Sim.secondsLeft(s) + ' s × ' + Sim.SECOND_POINTS : 'none';
      doc.getElementById('r-score').textContent = points + ' wicks';
      doc.getElementById('r-best').textContent = String(save.best[run.level.id]);
      doc.getElementById('next').disabled = !(next && levels.order.indexOf(next) < save.unlocked);
      updateButtons();
      show(results);
      say(won ? 'Level ' + run.level.id + ' won · seed ' + run.seed : 'Level ' + run.level.id + ' · try again');
    }

    function submit() {
      const submitted = run;
      submitted.submit = 'pending';
      updateButtons();
      const s = submitted.sim;
      sdk.submitScore({
        score: Sim.score(s),
        level: submitted.level.id,
        seed: submitted.seed,
        meta: { saved: s.saved, need: s.level.need, jobs: Sim.jobsUsed(s) }
      })
        .then(function (r) {
          submitted.submit = 'done';
          if (run === submitted) { updateButtons(); say(Sim.submitText(r)); }
        })
        .catch(function (e) {
          submitted.submit = e.code === 'rate_limited' || e.code === 'unavailable' ? 'idle' : 'failed';
          if (run === submitted) { updateButtons(); say(errorText(e)); }
        });
    }

    function share() {
      const s = run.sim;
      sdk.share({
        level: run.level.id,
        seed: run.seed,
        text: 'I brought ' + s.saved + ' of ' + s.level.count + ' wicklings home on level ' + run.level.id +
          ' (' + run.level.name + ') for ' + Sim.score(s) + ' wicks. Your turn:'
      })
        .then(function () { say('Challenge link copied'); })
        .catch(function (e) { say(errorText(e)); });
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    function hash(x, y) {
      let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    function drawTile(t, x, y, now) {
      const px = x * TILE;
      const py = y * TILE;
      if (t === '#') {
        ctx.fillStyle = COLOURS.earth;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = COLOURS.earthDot;
        for (let i = 0; i < 3; i++) ctx.fillRect(px + Math.floor(hash(x, y * 3 + i) * 14), py + Math.floor(hash(y, x * 3 + i) * 14), 2, 2);
      } else if (t === 'X') {
        ctx.fillStyle = COLOURS.stone;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = COLOURS.stoneEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
      } else if (t === '=') {
        ctx.fillStyle = COLOURS.plank;
        ctx.fillRect(px, py, TILE, TILE / 2);
        ctx.fillStyle = COLOURS.plankLine;
        ctx.fillRect(px, py + 3, TILE, 1);
        ctx.fillRect(px + (x % 2 ? 4 : 11), py, 1, TILE / 2);
      } else if (t === '~') {
        ctx.fillStyle = COLOURS.water;
        ctx.fillRect(px, py + 3, TILE, TILE - 3);
        ctx.strokeStyle = COLOURS.waterTop;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const phase = reduceMotion ? 0 : now / 400;
        for (let i = 0; i <= TILE; i += 2) {
          const yy = py + 3 + Math.sin(phase + (px + i) / 5) * 1.2;
          if (i === 0) ctx.moveTo(px + i, yy);
          else ctx.lineTo(px + i, yy);
        }
        ctx.stroke();
      } else if (t === 'D') {
        // The hatch the wicklings drop out of: a dark arched opening in a wooden frame.
        ctx.fillStyle = '#7a5532';
        ctx.fillRect(px - 2, py - 4, TILE + 4, TILE + 2);
        ctx.fillStyle = '#0c0916';
        ctx.beginPath();
        ctx.moveTo(px + 2, py + TILE - 2);
        ctx.lineTo(px + 2, py + 4);
        ctx.arc(px + TILE / 2, py + 4, TILE / 2 - 2, Math.PI, 0);
        ctx.lineTo(px + TILE - 2, py + TILE - 2);
        ctx.fill();
      } else if (t === 'L') {
        drawLantern(px, py, now);
      }
    }

    function drawLantern(px, py, now) {
      const cx = px + TILE / 2;
      const glow = reduceMotion ? 1 : 0.85 + Math.sin(now / 300) * 0.15;
      const g = ctx.createRadialGradient(cx, py + 8, 1, cx, py + 8, 26);
      g.addColorStop(0, 'rgba(255, 200, 100, ' + (0.55 * glow) + ')');
      g.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 26, py - 18, 52, 52);
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(cx - 5, py - 1, 10, 2); // cap
      ctx.fillRect(cx - 1, py - 5, 2, 4); // hook
      ctx.fillStyle = '#ffd98a';
      ctx.fillRect(cx - 4, py + 1, 8, 11); // glass
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(cx - 5, py + 12, 10, 3); // base
      ctx.fillStyle = '#ff9a2e'; // the flame inside
      ctx.beginPath();
      ctx.moveTo(cx, py + 3);
      ctx.quadraticCurveTo(cx + 3, py + 8, cx, py + 10);
      ctx.quadraticCurveTo(cx - 3, py + 8, cx, py + 3);
      ctx.fill();
    }

    function drawIcon(name, x, y, size) {
      const k = size / 10;
      ctx.beginPath();
      ICONS[name].forEach(function (pts) {
        ctx.moveTo(x + pts[0] * k, y + pts[1] * k);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(x + pts[i] * k, y + pts[i + 1] * k);
      });
      ctx.stroke();
    }

    /** The job a wickling shows over its head (the job it is doing, else a knack it carries). */
    function badgeFor(w) {
      if (w.state === 'dig') return 'digger';
      if (w.state === 'block') return 'blocker';
      if (w.state === 'build' || w.planks > 0) return 'bridger';
      if (w.state === 'climb' || w.climber) return 'climber';
      if (w.floater) return 'floater';
      return null;
    }

    function drawWickling(w, alpha, now) {
      const x = (w.px + (w.x - w.px) * alpha) * TILE + TILE / 2;
      const y = (w.py + (w.y - w.py) * alpha) * TILE + TILE; // feet
      const sel = w.id === selected;
      // Legs: alternate while moving, together while still.
      ctx.fillStyle = COLOURS.waxShade;
      const stride = (w.state === 'walk' || w.state === 'build') && !reduceMotion ? (run.sim.tick % 2 ? 1 : -1) : 0;
      ctx.fillRect(x - 3 + stride, y - 2, 2, 2);
      ctx.fillRect(x + 1 - stride, y - 2, 2, 2);
      // Wax body.
      ctx.fillStyle = COLOURS.wax;
      ctx.fillRect(x - 3, y - 11, 6, 9);
      ctx.fillStyle = COLOURS.waxShade;
      ctx.fillRect(x + 2, y - 11, 1, 9);
      // Arms out for a blocker.
      if (w.state === 'block') {
        ctx.fillStyle = COLOURS.wax;
        ctx.fillRect(x - 7, y - 8, 14, 2);
      }
      // Eyes look the way it walks.
      ctx.fillStyle = COLOURS.eye;
      ctx.fillRect(x + (w.dir > 0 ? 0 : -2), y - 9, 1, 2);
      ctx.fillRect(x + (w.dir > 0 ? 2 : 0), y - 9, 1, 2);
      // Wick and flame.
      ctx.fillStyle = COLOURS.eye;
      ctx.fillRect(x - 0.5, y - 13, 1, 2);
      const lick = reduceMotion ? 0 : (run.flicker() - 0.5) * 1.6;
      ctx.fillStyle = COLOURS.flame;
      ctx.beginPath();
      ctx.moveTo(x + lick, y - 20);
      ctx.quadraticCurveTo(x + 3.5, y - 14, x, y - 12.5);
      ctx.quadraticCurveTo(x - 3.5, y - 14, x + lick, y - 20);
      ctx.fill();
      ctx.fillStyle = COLOURS.flameCore;
      ctx.fillRect(x - 0.5, y - 15, 1, 2);
      // A floater drifting down holds a leaf canopy.
      if (w.floater && w.state === 'fall') {
        ctx.strokeStyle = '#9fe08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y - 18, 7, Math.PI, 0);
        ctx.stroke();
      }
      const badge = badgeFor(w);
      if (badge) {
        ctx.fillStyle = COLOURS.badge;
        ctx.fillRect(x - 5, y - 32, 10, 10);
        ctx.strokeStyle = '#ffcf7a';
        ctx.lineWidth = 1.2;
        drawIcon(badge, x - 4, y - 31, 8);
      }
      if (sel) {
        // Selection: a dashed ring plus a pointer triangle, so it reads without colour.
        ctx.strokeStyle = COLOURS.select;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(x, y - 8, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOURS.select;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 38);
        ctx.lineTo(x + 4, y - 38);
        ctx.lineTo(x, y - 33);
        ctx.fill();
      }
    }

    function drawEffects() {
      const s = run.sim;
      run.effects = run.effects.filter(function (e) { return s.tick - e.at < 6; });
      run.effects.forEach(function (e) {
        const k = (s.tick - e.at) / 6;
        const cx = e.x * TILE + TILE / 2;
        const cy = e.y * TILE + TILE / 2;
        ctx.globalAlpha = 1 - k;
        if (e.kind === 'saved') {
          ctx.strokeStyle = '#ffd98a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 4 + k * 14, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#b8b0c8';
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(cx + (i - 1) * 4, cy - k * 14 - i * 2, 3 + k * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      });
    }

    function draw(alpha, now) {
      const s = run.sim;
      const W = s.w * TILE;
      const H = s.h * TILE;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#1d1638');
      sky.addColorStop(1, '#2c1f3f');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255, 244, 214, 0.7)';
      run.stars.forEach(function (st) { ctx.fillRect(st.x, st.y, st.r, st.r); });
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const t = s.tiles[y * s.w + x];
          if (t !== '.') drawTile(t, x, y, now);
        }
      }
      s.walkers.forEach(function (w) {
        if (w.state !== 'saved' && w.state !== 'lost') drawWickling(w, alpha, now);
      });
      drawEffects();
      if (run.paused) {
        ctx.fillStyle = 'rgba(10, 8, 20, 0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#f5ecdc';
        ctx.font = 'bold 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Paused', W / 2, H / 2);
      }
    }

    // ── Input ────────────────────────────────────────────────────────────────

    function toTiles(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * run.sim.w) / rect.width,
        y: ((e.clientY - rect.top) * run.sim.h) / rect.height
      };
    }

    /** The active wickling nearest a point (in tiles), within reach, or -1. */
    function nearest(p) {
      let best = -1;
      let bestD = 1.6 * 1.6;
      active().forEach(function (w) {
        const dx = w.x + 0.5 - p.x;
        const dy = w.y + 0.4 - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = w.id; }
      });
      return best;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!run || run.over) return;
      e.preventDefault();
      canvas.focus();
      const id = nearest(toTiles(e));
      if (id === -1) return;
      selected = id;
      give(id);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!run || run.over || e.pointerType === 'touch') return;
      const id = nearest(toTiles(e));
      if (id !== -1) selected = id;
    });

    doc.addEventListener('keydown', function (e) {
      if (!run || run.over || e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const onButton = e.target && e.target.tagName === 'BUTTON';
      const pick = Sim.JOBS.find(function (name) { return JOB_KEYS[name] === key; });
      if (pick) {
        e.preventDefault();
        chooseJob(pick);
      } else if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'd' || key === 'a') {
        e.preventDefault();
        selectNext(key === 'ArrowRight' || key === 'd' ? 1 : -1);
      } else if ((key === ' ' || key === 'Enter') && !onButton) {
        e.preventDefault();
        if (selected === -1) selectNext(1);
        else give(selected);
      } else if (key === 'p' || key === 'Escape') {
        e.preventDefault();
        setToggle('pause', !run.paused);
      } else if (key === 'f') {
        e.preventDefault();
        setToggle('fast', !run.fast);
      } else if (key === 's' && run.paused) {
        // One tick at a time while paused, for exact timing without a quick hand.
        e.preventDefault();
        const before = run.sim.walkers.map(function (w) { return w.state; });
        Sim.step(run.sim);
        noteChanges(before);
        updateHud();
      }
    });

    doc.getElementById('pause').addEventListener('click', function () { if (run) setToggle('pause', !run.paused); });
    doc.getElementById('fast').addEventListener('click', function () { if (run) setToggle('fast', !run.fast); });
    doc.getElementById('end').addEventListener('click', function () {
      if (run && !run.over) Sim.end(run.sim);
    });
    doc.getElementById('submit').addEventListener('click', submit);
    doc.getElementById('share').addEventListener('click', share);
    doc.getElementById('retry').addEventListener('click', function () {
      begin(run.level.id, run.seed);
    });
    doc.getElementById('next').addEventListener('click', function () {
      const next = levels.order[levels.order.indexOf(run.level.id) + 1];
      if (next) begin(next, Sim.randomSeed(Math.random));
    });
    doc.getElementById('to-levels').addEventListener('click', showLevels);
    doc.getElementById('exit').addEventListener('click', function () {
      sdk.exit().catch(function () {});
    });

    // ready() first; then the levels and the saved progress.
    sdk.ready()
      .then(function (info) {
        const best = sdk.load().then(
          function (saved) { saveLoaded = true; return saved; },
          function () { return null; }
        );
        return Promise.all([info, sdk.asset('levels.json'), best]);
      })
      .then(function (loaded) {
        levels = Sim.parseLevels(JSON.parse(new TextDecoder().decode(loaded[1])));
        save = Sim.readSave(loaded[2], levels.order.length);
        const c = loaded[0].challenge;
        if (c && levels.byId[c.level]) {
          challenge = { level: c.level, seed: c.seed };
          doc.getElementById('intro-note').textContent =
            'Challenge: level ' + c.level + ' (' + levels.byId[c.level].name + '), seed ' + c.seed + '. It is open for you below.';
        }
        say('');
        showLevels();
      })
      .catch(function (e) {
        say('Wicklings could not start: ' + errorText(e));
      });
  }

  start(window, document, window.LanParty);
}());
