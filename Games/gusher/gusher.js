/*
 * Gusher: the browser layer. Draws the board on a canvas, reads the mouse and keyboard, and wires the SDK
 * (ready, asset, load/save, submitScore, share, exit). Every rule lives in gusher-logic.js (window.Gusher).
 */
(function () {
  'use strict';

  const G = window.Gusher;
  const sdk = window.LanParty;
  const doc = document;

  const VIEW = { width: 720, height: 640 };
  const BOARD = { top: 56, height: 470, maxCell: 72 };
  const THROTTLE = 5;
  const NAMES = { straight: 'straight', bend: 'bend', cross: 'cross', valve: 'valve', tank: 'tank-junction' };
  const C = {
    deck: '#2d3842',
    seam: '#3a4651',
    rivet: '#46535f',
    rock: '#1a2127',
    hatch: '#33404b',
    steel: '#a9b4bd',
    steelEdge: '#5f6c77',
    flange: '#cfd6db',
    crude: '#1b120c',
    sheen: '#b5772a',
    amber: '#e0a43a',
    depot: '#5f7d6b',
    depotDark: '#3d5547',
    well: '#8a5a3c',
    text: '#e3e8eb',
    dim: '#97a4ae'
  };

  const canvas = doc.getElementById('field');
  const ctx = canvas.getContext('2d');
  const status = doc.getElementById('status');
  const intro = doc.getElementById('intro');
  const results = doc.getElementById('results');
  const levelPick = doc.getElementById('level');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let levels = null;
  let best = {};
  let bestLoaded = false; // false when load() failed: never overwrite a save we could not read
  let challenge = null; // {level, seed} when opened from a challenge link
  let run = null; // {state, layout, speed, lastFrame, over, submit, endedAt}
  let cursor = { x: 0, y: 0 };

  const dpr = window.devicePixelRatio || 1;
  canvas.width = VIEW.width * dpr;
  canvas.height = VIEW.height * dpr;
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
    const focus = card === intro ? levelPick : card && card.querySelector('button:not([disabled])');
    if (focus) focus.focus();
    else canvas.focus();
  }

  function levelLabel(key) {
    return key === G.LEVEL_ENDLESS ? 'Endless' : 'Level ' + key;
  }

  // ── Level select ───────────────────────────────────────────────────────────

  function fillLevelPick(selected) {
    levelPick.textContent = '';
    Object.keys(levels).concat([G.LEVEL_ENDLESS]).forEach(function (key) {
      const opt = doc.createElement('option');
      opt.value = key;
      opt.textContent = key === G.LEVEL_ENDLESS ? 'Endless: a new board for every seed' : key + ' · ' + levels[key].name;
      levelPick.appendChild(opt);
    });
    levelPick.value = selected;
    showBest();
  }

  function showBest() {
    const key = levelPick.value;
    const quota = key === G.LEVEL_ENDLESS ? G.endlessLevel('x').target : levels[key].target;
    doc.getElementById('intro-best').textContent =
      'Quota ' + quota + ' barrels · your best ' + (best[key] !== undefined ? best[key] : 'none yet');
  }

  // ── A round ────────────────────────────────────────────────────────────────

  function layoutFor(cfg) {
    const cell = Math.min(BOARD.maxCell, Math.floor(Math.min((VIEW.width - 20) / cfg.width, BOARD.height / cfg.height)));
    return {
      cell: cell,
      ox: Math.round((VIEW.width - cell * cfg.width) / 2),
      oy: BOARD.top + Math.round((BOARD.height - cell * cfg.height) / 2)
    };
  }

  function begin(level, seed) {
    const cfg = G.levelConfig(levels, level, seed);
    const state = G.newGame(cfg, seed);
    run = { state: state, layout: layoutFor(cfg), speed: 1, lastFrame: 0, over: false, submit: 'idle', endedAt: 0, pumping: false };
    cursor = { x: cfg.well.x + G.DX[cfg.well.dir], y: cfg.well.y + G.DY[cfg.well.dir] };
    updateButtons();
    show(null);
    say(levelLabel(cfg.level) + ', ' + cfg.name + '. Crude in ' + Math.ceil(cfg.countdown / 1000) + ' seconds. Next piece: ' + NAMES[state.queue[0].type] + '.');
    window.requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!run) return;
    const dt = run.lastFrame ? Math.min(250, now - run.lastFrame) : 0;
    run.lastFrame = now;
    const s = run.state;
    if (!s.over) {
      G.advance(s, s.clock + dt * run.speed);
      if (!run.pumping && G.countdownLeft(s) === 0) {
        run.pumping = true;
        say('Crude is flowing.');
      }
    }
    if (s.over && !run.over) {
      run.over = true;
      run.endedAt = now; // before draw(), so the spill puddle starts small and grows
      say(s.sealed ? 'Line sealed! Every branch ended safe.' : 'Spill at ' + G.cellName(s.spill.x, s.spill.y) + '! Round over.');
    }
    draw(now);
    if (run.over && now - run.endedAt > 1200) {
      finish();
      return;
    }
    window.requestAnimationFrame(frame);
  }

  const REFUSALS = {
    blocked: 'nothing can be laid there',
    flowing: 'crude is already in that pipe',
    outside: 'that is off the board',
    over: 'the round is over'
  };

  function layAt(x, y) {
    if (!run || run.over) return;
    const s = run.state;
    const piece = s.queue[0];
    const r = G.place(s, x, y);
    const where = G.cellName(x, y);
    if (!r.ok) {
      say(where + ': ' + REFUSALS[r.reason]);
      return;
    }
    say((r.overwrite ? 'Swapped in a ' : 'Laid a ') + NAMES[piece.type] + ' on ' + where +
      (r.overwrite ? ' (two seconds lost)' : '') + '. Next: ' + NAMES[s.queue[0].type] + '.');
  }

  function toggleThrottle() {
    if (!run || run.over) return;
    run.speed = run.speed === 1 ? THROTTLE : 1;
    say(run.speed === 1 ? 'Throttle back to normal.' : 'Throttle open: everything runs ' + THROTTLE + ' times faster.');
  }

  function updateButtons() {
    const disabled = G.resultButtons(run || { over: false, submit: 'idle' });
    doc.getElementById('submit').disabled = disabled.submit;
    doc.getElementById('share').disabled = disabled.share;
  }

  function finish() {
    const s = run.state;
    const level = s.cfg.level;
    const merged = G.mergeBest(best, level, s.score.barrels, G.levelKeys(levels));
    if (merged.improved) {
      best = merged.best;
      if (bestLoaded) sdk.save({ v: 1, best: best }).catch(function () {});
    }
    const met = s.score.barrels >= s.cfg.target;
    doc.getElementById('outcome').textContent = s.sealed ? 'Sealed!' : 'Spill!';
    doc.getElementById('final-barrels').textContent = String(s.score.barrels);
    doc.getElementById('final-cells').textContent = String(s.score.cells);
    doc.getElementById('final-tanks').textContent = String(s.score.tanks);
    doc.getElementById('final-crossings').textContent = String(s.score.crossings);
    doc.getElementById('final-depots').textContent = String(s.score.depots);
    doc.getElementById('final-quota').textContent = (met ? '✓ met (' : '✗ missed (') + s.cfg.target + ')';
    doc.getElementById('final-best').textContent = String(best[level] !== undefined ? best[level] : s.score.barrels);
    updateButtons();
    show(results);
    say(levelLabel(level) + ' · seed ' + s.seed);
  }

  function submit() {
    const submitted = run;
    const s = submitted.state;
    submitted.submit = 'pending';
    updateButtons();
    sdk.submitScore({
      score: s.score.barrels,
      level: s.cfg.level,
      seed: s.seed,
      meta: { sealed: s.sealed, cells: s.score.cells, tanks: s.score.tanks, overwrites: s.score.overwrites }
    })
      .then(function (r) {
        submitted.submit = 'done';
        if (run === submitted) { updateButtons(); say(G.submitText(r)); }
      })
      .catch(function (e) {
        submitted.submit = e.code === 'rate_limited' || e.code === 'unavailable' ? 'idle' : 'failed';
        if (run === submitted) { updateButtons(); say(errorText(e)); }
      });
  }

  function share() {
    const s = run.state;
    sdk.share({
      level: s.cfg.level,
      seed: s.seed,
      text: 'I banked ' + s.score.barrels + ' barrels on Gusher (' + levelLabel(s.cfg.level) + '). Same board, same pieces, your turn:'
    })
      .then(function () { say('Challenge link copied'); })
      .catch(function (e) { say(errorText(e)); });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function cellRect(x, y) {
    const L = run.layout;
    return { x: L.ox + x * L.cell, y: L.oy + y * L.cell, s: L.cell };
  }

  function arm(cx, cy, s, d, from, to) {
    // a segment along side d's arm, from fraction `from` to `to` of the way out from the centre
    const h = s / 2;
    return [cx + G.DX[d] * h * from, cy + G.DY[d] * h * from, cx + G.DX[d] * h * to, cy + G.DY[d] * h * to];
  }

  function stroke(seg, width, colour, cap) {
    ctx.beginPath();
    ctx.moveTo(seg[0], seg[1]);
    ctx.lineTo(seg[2], seg[3]);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.lineCap = cap || 'butt';
    ctx.stroke();
  }

  function drawDeck(x, y) {
    const r = cellRect(x, y);
    ctx.fillStyle = C.deck;
    ctx.fillRect(r.x, r.y, r.s, r.s);
    ctx.strokeStyle = C.seam;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1);
    ctx.fillStyle = C.rivet;
    [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(r.x + p[0] * r.s, r.y + p[1] * r.s, Math.max(1.5, r.s * 0.03), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawRock(x, y) {
    const r = cellRect(x, y);
    ctx.fillStyle = C.rock;
    ctx.fillRect(r.x, r.y, r.s, r.s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.s, r.s);
    ctx.clip();
    ctx.strokeStyle = C.hatch;
    ctx.lineWidth = 3;
    for (let k = -r.s; k < r.s; k += r.s / 4) {
      ctx.beginPath();
      ctx.moveTo(r.x + k, r.y + r.s);
      ctx.lineTo(r.x + k + r.s, r.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Steel for a piece (no crude). The caller sets globalAlpha for the ghost under the cursor. */
  function drawSteel(piece, cx, cy, s) {
    const band = s * 0.34;
    const ops = G.openings(piece);
    if (piece.type === 'tank') {
      ops.forEach(function (d) { stroke(arm(cx, cy, s, d, 0, 1), band, C.steelEdge); stroke(arm(cx, cy, s, d, 0, 1), band - 4, C.steel); });
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = C.steel;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.steelEdge;
      ctx.stroke();
      // hoops: the drum's shape tells it apart from any pipe
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (piece.type === 'cross') {
      [1, 3].forEach(function (d) { stroke(arm(cx, cy, s, d, 0, 1), band, C.steelEdge); stroke(arm(cx, cy, s, d, 0, 1), band - 4, C.steel); });
      // the north-south run bridges over the east-west one
      stroke([cx, cy - s * 0.3, cx, cy + s * 0.3], band + 4, C.deck);
      stroke([cx, cy - s / 2, cx, cy + s / 2], band, C.steelEdge);
      stroke([cx, cy - s / 2, cx, cy + s / 2], band - 4, C.steel);
    } else {
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const a = arm(cx, cy, s, ops[0], 1, 0);
      const b = arm(cx, cy, s, ops[1], 0, 1);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(cx, cy);
      ctx.lineTo(b[2], b[3]);
      ctx.lineCap = 'butt';
      ctx.lineWidth = band;
      ctx.strokeStyle = C.steelEdge;
      ctx.stroke();
      ctx.lineWidth = band - 4;
      ctx.strokeStyle = C.steel;
      ctx.stroke();
    }
    // flanges at every opening
    ops.forEach(function (d) {
      const e = arm(cx, cy, s, d, 0.84, 0.96);
      stroke(e, band + 6, C.flange);
    });
  }

  function drawValveWheel(piece, cx, cy, s) {
    const r = s * 0.2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.amber;
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2; // upright spokes, unlike the diagonal cross-out
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = C.amber;
    ctx.fill();
    ctx.restore();
  }

  function crude(seg, s) {
    stroke(seg, s * 0.2, C.crude, 'round');
  }

  /** Crude in one channel of a pipe: full, or partly in for an active head (entry arm, then the way out). */
  function drawCrude(cell, ch, cx, cy, s, head, t) {
    const piece = cell.piece;
    const p = head ? Math.max(0, Math.min(1, (t - head.startedAt) / head.dur)) : 1;
    if (head && p === 0) return;
    let arms;
    let entry;
    if (piece.type === 'cross') arms = ch === 0 ? [0, 2] : [1, 3];
    else arms = G.openings(piece);
    if (head) entry = head.from;
    if (piece.type === 'tank') {
      const inFrac = head ? Math.min(1, p / 0.25) : 1;
      const level = head ? Math.max(0, Math.min(1, (p - 0.25) / 0.5)) : 1;
      const outFrac = head ? Math.max(0, (p - 0.75) / 0.25) : 1;
      arms.forEach(function (d) {
        if (!head) crude(arm(cx, cy, s, d, 0, 1), s);
        else if (d === entry) crude(arm(cx, cy, s, d, 1, 1 - inFrac), s);
        else if (outFrac > 0) crude(arm(cx, cy, s, d, 0, outFrac), s);
      });
      if (level > 0) {
        const R = s * 0.33;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = C.crude;
        ctx.fillRect(cx - R, cy + R - 2 * R * level, 2 * R, 2 * R * level);
        ctx.restore();
      }
      return;
    }
    const inFrac = head ? Math.min(1, p * 2) : 1;
    const outFrac = head ? Math.max(0, p * 2 - 1) : 1;
    arms.forEach(function (d) {
      if (!head) crude(arm(cx, cy, s, d, 0, 1), s);
      else if (d === entry) crude(arm(cx, cy, s, d, 1, 1 - inFrac), s);
      else if (outFrac > 0) crude(arm(cx, cy, s, d, 0, outFrac), s);
    });
  }

  function drawSheen(cx, cy, s, t) {
    if (reduceMotion) return;
    const k = (Math.sin(t / 300 + cx * 0.05 + cy * 0.03) + 1) / 2;
    ctx.beginPath();
    ctx.arc(cx - s * 0.04, cy - s * 0.04, s * 0.035 + k * s * 0.02, 0, Math.PI * 2);
    ctx.fillStyle = C.sheen;
    ctx.globalAlpha = 0.5 + 0.4 * k;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawWell(cell, x, y, s) {
    const r = cellRect(x, y);
    const cx = r.x + s / 2;
    const cy = r.y + s / 2;
    stroke(arm(cx, cy, s, cell.dir, 0, 1), s * 0.34, C.steelEdge);
    stroke(arm(cx, cy, s, cell.dir, 0, 1), s * 0.34 - 4, C.steel);
    if (cell.filled[0] || run.state.clock >= run.state.cfg.countdown) {
      const head = run.state.heads.find(function (h) { return h.x === x && h.y === y; });
      const p = head ? Math.max(0, Math.min(1, (run.state.clock - head.startedAt) / head.dur)) : 1;
      if (p > 0) crude(arm(cx, cy, s, cell.dir, 0, p), s);
    }
    ctx.fillStyle = C.well;
    ctx.fillRect(cx - s * 0.3, cy - s * 0.3, s * 0.6, s * 0.6);
    ctx.strokeStyle = '#5a3a26';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - s * 0.3, cy - s * 0.3, s * 0.6, s * 0.6);
    // the wellhead cap: the countdown digits, then an open bore once crude flows
    ctx.fillStyle = C.amber;
    const left = G.countdownLeft(run.state);
    if (left > 0) {
      ctx.font = 'bold ' + Math.round(s * 0.34) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.ceil(left / 1000)), cx, cy + 1);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = C.crude;
      ctx.fill();
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawDepot(cell, x, y, s) {
    const r = cellRect(x, y);
    const cx = r.x + s / 2;
    const cy = r.y + s / 2;
    ctx.fillStyle = C.depotDark;
    ctx.fillRect(cx - s * 0.36, cy - s * 0.3, s * 0.72, s * 0.6);
    ctx.fillStyle = C.depot;
    ctx.fillRect(cx - s * 0.32, cy - s * 0.26, s * 0.64, s * 0.52);
    // intake notches on all four sides
    ctx.fillStyle = C.flange;
    for (let d = 0; d < 4; d++) {
      const ex = cx + G.DX[d] * s * 0.42;
      const ey = cy + G.DY[d] * s * 0.36;
      ctx.fillRect(ex - 4, ey - 4, 8, 8);
    }
    ctx.fillStyle = cell.filled[0] ? C.amber : C.text;
    ctx.font = 'bold ' + Math.round(s * 0.2) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cell.filled[0] ? 'FULL' : 'DEPOT', cx, cy + 1);
  }

  function drawPipeCell(cell, x, y, t) {
    const r = cellRect(x, y);
    const cx = r.x + r.s / 2;
    const cy = r.y + r.s / 2;
    drawSteel(cell.piece, cx, cy, r.s);
    const heads = run.state.heads.filter(function (h) { return h.x === x && h.y === y; });
    // east-west (1) first, so north-south crude stays on top of the bridge
    [1, 0].forEach(function (ch) {
      if (cell.filled[ch]) drawCrude(cell, ch, cx, cy, r.s, null, t);
    });
    heads.forEach(function (h) { drawCrude(cell, h.ch, cx, cy, r.s, h, t); });
    if (cell.piece.type === 'cross' && cell.filled[1] && !cell.filled[0]) {
      // keep the bridge on top of east-west crude
      stroke([cx, cy - r.s * 0.3, cx, cy + r.s * 0.3], r.s * 0.34 - 4, C.steel);
    }
    if (cell.piece.type === 'valve') drawValveWheel(cell.piece, cx, cy, r.s);
    if (cell.fixed) {
      ctx.fillStyle = C.dim;
      ctx.fillRect(r.x + 3, r.y + 3, 6, 6); // a bolt marks pipe that cannot be swapped
    }
    if ((cell.filled[0] || cell.filled[1]) && cell.piece.type === 'tank') drawSheen(cx, cy, r.s, run.lastFrame);
  }

  function drawSpill(sp) {
    const r = cellRect(sp.x, sp.y);
    const ex = r.x + r.s / 2 + G.DX[sp.dir] * r.s * 0.55;
    const ey = r.y + r.s / 2 + G.DY[sp.dir] * r.s * 0.55;
    const grow = reduceMotion ? 1 : Math.min(1, (run.lastFrame - run.endedAt) / 500 + 0.3);
    ctx.fillStyle = C.crude;
    [[0, 0, 0.32], [0.18, 0.1, 0.2], [-0.15, 0.14, 0.18], [0.08, -0.17, 0.16]].forEach(function (b) {
      ctx.beginPath();
      ctx.arc(ex + b[0] * r.s, ey + b[1] * r.s, b[2] * r.s * grow, 0, Math.PI * 2);
      ctx.fill();
    });
    // a warning triangle with "!" so the spill reads without colour
    const tx = ex;
    const ty = ey - r.s * 0.05;
    const k = r.s * 0.22;
    ctx.beginPath();
    ctx.moveTo(tx, ty - k);
    ctx.lineTo(tx + k, ty + k * 0.8);
    ctx.lineTo(tx - k, ty + k * 0.8);
    ctx.closePath();
    ctx.fillStyle = C.amber;
    ctx.fill();
    ctx.fillStyle = C.crude;
    ctx.font = 'bold ' + Math.round(k * 1.1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', tx, ty + k * 0.25);
  }

  function drawCursor(t) {
    const s = run.state;
    const r = cellRect(cursor.x, cursor.y);
    const cell = s.cells[cursor.y][cursor.x];
    const free = !s.over && (cell.kind === 'empty' || (cell.kind === 'pipe' && !cell.fixed && !cell.entered[0] && !cell.entered[1]));
    if (free && cell.kind === 'empty') {
      ctx.globalAlpha = 0.45;
      drawSteel(s.queue[0], r.x + r.s / 2, r.y + r.s / 2, r.s);
      if (s.queue[0].type === 'valve') drawValveWheel(s.queue[0], r.x + r.s / 2, r.y + r.s / 2, r.s);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 3;
    ctx.setLineDash(reduceMotion ? [] : [8, 5]);
    ctx.lineDashOffset = reduceMotion ? 0 : -(t / 40) % 13;
    ctx.strokeRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    ctx.setLineDash([]);
    if (!free) {
      // a cross-out: this square takes no piece
      ctx.beginPath();
      ctx.moveTo(r.x + 8, r.y + 8);
      ctx.lineTo(r.x + r.s - 8, r.y + r.s - 8);
      ctx.moveTo(r.x + r.s - 8, r.y + 8);
      ctx.lineTo(r.x + 8, r.y + r.s - 8);
      ctx.stroke();
    }
  }

  function drawQueue() {
    const q = run.state.queue;
    const y0 = 540;
    let x = 120;
    ctx.fillStyle = C.dim;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('NEXT', 40, y0 + 46);
    q.forEach(function (piece, i) {
      const size = i === 0 ? 72 : 54;
      const top = y0 + (i === 0 ? 0 : 9);
      ctx.fillStyle = i === 0 ? '#3a4651' : C.deck;
      ctx.fillRect(x, top, size, size);
      ctx.strokeStyle = i === 0 ? C.amber : C.seam;
      ctx.lineWidth = i === 0 ? 3 : 1;
      ctx.strokeRect(x, top, size, size);
      drawSteel(piece, x + size / 2, top + size / 2, size);
      if (piece.type === 'valve') drawValveWheel(piece, x + size / 2, top + size / 2, size);
      ctx.fillStyle = i === 0 ? C.text : C.dim;
      ctx.font = (i === 0 ? 'bold ' : '') + '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(NAMES[piece.type], x + size / 2, y0 + 88);
      x += size + 22;
    });
  }

  function drawHud() {
    const s = run.state;
    ctx.fillStyle = C.text;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(s.score.barrels + ' barrels', 18, 34);
    ctx.textAlign = 'center';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(levelLabel(s.cfg.level) + ' · ' + s.cfg.name + ' · quota ' + s.cfg.target, VIEW.width / 2, 32);
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px system-ui, sans-serif';
    const left = G.countdownLeft(s);
    let label = left > 0 ? 'Crude in ' + Math.ceil(left / 1000) + 's' : 'Flowing';
    if (s.over) label = s.sealed ? 'Sealed' : 'Spilled';
    else if (run.speed !== 1) label += ' ×' + run.speed;
    ctx.fillStyle = left > 0 ? C.amber : C.text;
    ctx.fillText(label, VIEW.width - 18, 34);
  }

  function draw(now) {
    const s = run.state;
    const t = s.clock;
    ctx.fillStyle = '#27313a';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    for (let y = 0; y < s.cfg.height; y++) {
      for (let x = 0; x < s.cfg.width; x++) {
        const cell = s.cells[y][x];
        if (cell.kind === 'rock') { drawRock(x, y); continue; }
        drawDeck(x, y);
      }
    }
    for (let y = 0; y < s.cfg.height; y++) {
      for (let x = 0; x < s.cfg.width; x++) {
        const cell = s.cells[y][x];
        const r = cellRect(x, y);
        if (cell.kind === 'pipe') drawPipeCell(cell, x, y, t);
        else if (cell.kind === 'well') drawWell(cell, x, y, r.s);
        else if (cell.kind === 'depot') drawDepot(cell, x, y, r.s);
      }
    }
    if (s.spill) drawSpill(s.spill);
    if (!run.over) drawCursor(now);
    drawHud();
    drawQueue();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  function toCell(e) {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * VIEW.width) / rect.width;
    const py = ((e.clientY - rect.top) * VIEW.height) / rect.height;
    const L = run.layout;
    const x = Math.floor((px - L.ox) / L.cell);
    const y = Math.floor((py - L.oy) / L.cell);
    if (x < 0 || y < 0 || x >= run.state.cfg.width || y >= run.state.cfg.height) return null;
    return { x: x, y: y };
  }

  canvas.addEventListener('pointermove', function (e) {
    if (!run || run.over) return;
    const c = toCell(e);
    if (c) cursor = c;
  });

  canvas.addEventListener('pointerdown', function (e) {
    if (!run || run.over) return;
    e.preventDefault();
    canvas.focus();
    const c = toCell(e);
    if (!c) return;
    cursor = c;
    layAt(c.x, c.y);
  });

  const MOVES = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

  doc.addEventListener('keydown', function (e) {
    if (!run || run.over || !intro.hidden || !results.hidden) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (Object.prototype.hasOwnProperty.call(MOVES, key)) {
      e.preventDefault();
      const m = MOVES[key];
      cursor = {
        x: Math.max(0, Math.min(run.state.cfg.width - 1, cursor.x + m[0])),
        y: Math.max(0, Math.min(run.state.cfg.height - 1, cursor.y + m[1]))
      };
    } else if (key === ' ' || key === 'Enter') {
      e.preventDefault();
      layAt(cursor.x, cursor.y);
    } else if (key === 'f') {
      e.preventDefault();
      toggleThrottle();
    }
  });

  levelPick.addEventListener('change', showBest);

  doc.getElementById('play').addEventListener('click', function () {
    const level = levelPick.value;
    const seed = challenge && challenge.level === level ? challenge.seed : G.randomSeed(Math.random);
    begin(level, seed);
  });
  doc.getElementById('submit').addEventListener('click', submit);
  doc.getElementById('share').addEventListener('click', share);
  doc.getElementById('again').addEventListener('click', function () {
    begin(run.state.cfg.level, G.randomSeed(Math.random));
  });
  doc.getElementById('levels').addEventListener('click', function () {
    fillLevelPick(run.state.cfg.level);
    show(intro);
  });
  doc.getElementById('exit').addEventListener('click', function () {
    sdk.exit().catch(function () {});
  });

  // ready() first; then the level table and the saved bests.
  sdk.ready()
    .then(function (info) {
      challenge = info.challenge;
      const saved = sdk.load().then(
        function (value) { bestLoaded = true; return value; },
        function () { return null; }
      );
      return Promise.all([sdk.asset('levels.json'), saved]);
    })
    .then(function (loaded) {
      levels = JSON.parse(new TextDecoder().decode(loaded[0]));
      best = G.readBest(loaded[1], G.levelKeys(levels));
      const start = G.challengeStart(levels, challenge);
      challenge = start.seed ? { level: start.level, seed: start.seed } : null;
      doc.getElementById('intro-note').textContent = start.note;
      fillLevelPick(start.level);
      say('');
      show(intro);
    })
    .catch(function (e) {
      say('Gusher could not start: ' + errorText(e));
    });
}());
