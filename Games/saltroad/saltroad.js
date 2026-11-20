/*
 * Saltroad: the page. Everything the journey does lives in saltroad-core.js (window.SaltroadCore); this file
 * draws the route map, fills the panels, and talks to LAN Party: ready(), asset('routes.json'), load()/save()
 * for the best scores and a journey in progress, submitScore(), share() for a challenge (route + seed), exit().
 */
(function () {
  'use strict';

  const C = window.SaltroadCore;
  const VIEW = { width: 960, height: 300 };
  const MOVE_MS = 700;
  const COLORS = { ink: '#2b1d12', sand: '#e8d2a6', dune: '#dcc08a', sea: '#5d8fa3', foam: '#e6f0f2', walked: '#a8461f', road: '#8a7354' };

  function start(win, doc, sdk) {
    const $ = function (id) { return doc.getElementById(id); };
    const canvas = $('map');
    const ctx = canvas.getContext('2d');
    const status = $('status');
    const cards = [$('intro'), $('confirm'), $('results')];
    const panels = { camp: $('camp'), event: $('event'), post: $('post') };
    const reduceMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let routes = null;
    let saved = { best: {}, journey: null };
    let saveLoaded = false; // false when load() failed: never overwrite a save we could not read
    let challenge = null;
    let run = null; // {route, deck, s, over, submit, anim}
    let pendingStart = null; // the start waiting on the abandon-journey confirmation
    const saves = C.saveQueue(function (data) { return sdk.save(data); });

    const dpr = win.devicePixelRatio || 1;
    canvas.width = VIEW.width * dpr;
    canvas.height = VIEW.height * dpr;
    ctx.scale(dpr, dpr);

    function say(text) {
      status.textContent = text;
    }

    function errorText(e) {
      return e && e.message ? e.message : 'Something went wrong';
    }

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function showCard(card) {
      cards.forEach(function (c) { c.hidden = c !== card; });
      if (card) {
        const button = card.querySelector('button:not([hidden]):not(:disabled)');
        if (button) button.focus();
      }
    }

    // ── Saving ───────────────────────────────────────────────────────────────

    function payload() {
      const data = C.saveData(saved.best, run && !run.over ? run.s : null);
      saved.journey = data.journey;
      return data;
    }

    /** Every save goes through one queue: one in flight, later changes coalesced into the next. */
    function persist() {
      if (saveLoaded) saves.push(payload);
    }

    // ── Map ──────────────────────────────────────────────────────────────────

    function point(w) {
      return { x: 36 + (w.x / 100) * (VIEW.width - 72), y: 24 + (w.y / 100) * (VIEW.height - 48) };
    }

    function caravanAt(route, s) {
      const a = point(route.waypoints[s.wp]);
      const next = route.waypoints[s.wp + 1];
      if (!next) return a;
      const b = point(next);
      const f = Math.min(1, s.mi / next.miles);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }

    function marker(kind, p, reached) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.ink;
      ctx.fillStyle = reached ? COLORS.walked : '#fff8ea';
      ctx.beginPath();
      if (kind === 'well') {
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
      } else if (kind === 'post') {
        ctx.rect(-8, -8, 16, 16);
        ctx.fill();
        ctx.stroke();
      } else if (kind === 'canyon') {
        ctx.moveTo(0, -10);
        ctx.lineTo(10, 8);
        ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (kind === 'ford') {
        for (let i = -1; i <= 1; i++) {
          ctx.moveTo(-10, i * 5);
          ctx.quadraticCurveTo(-5, i * 5 - 4, 0, i * 5);
          ctx.quadraticCurveTo(5, i * 5 + 4, 10, i * 5);
        }
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (kind === 'market') {
        ctx.moveTo(0, -12);
        ctx.lineTo(12, 0);
        ctx.lineTo(0, 12);
        ctx.lineTo(-12, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawCaravan(p) {
      ctx.save();
      ctx.translate(p.x, p.y - 20);
      ctx.fillStyle = COLORS.ink;
      ctx.strokeStyle = '#fff8ea';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-3, -9); ctx.lineTo(3, -9); ctx.lineTo(3, -3); ctx.lineTo(9, -3); ctx.lineTo(9, 3);
      ctx.lineTo(3, 3); ctx.lineTo(3, 9); ctx.lineTo(-3, 9); ctx.lineTo(-3, 3); ctx.lineTo(-9, 3);
      ctx.lineTo(-9, -3); ctx.lineTo(-3, -3); ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(0, 16);
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      ctx.restore();
    }

    function drawMap(now) {
      if (!run) return;
      const route = run.route;
      const s = run.s;
      const pts = route.waypoints.map(point);
      ctx.clearRect(0, 0, VIEW.width, VIEW.height);

      ctx.fillStyle = COLORS.sand;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      ctx.fillStyle = COLORS.dune;
      for (let i = 0; i < 9; i++) {
        const x = 60 + i * 105;
        const y = i % 2 ? 250 : 70;
        ctx.beginPath();
        ctx.ellipse(x, y, 70, 14, 0, Math.PI, 0);
        ctx.fill();
      }
      ctx.fillStyle = COLORS.sea;
      ctx.fillRect(VIEW.width - 22, 0, 22, VIEW.height);
      ctx.strokeStyle = COLORS.foam;
      ctx.lineWidth = 2;
      for (let y = 10; y < VIEW.height; y += 24) {
        ctx.beginPath();
        ctx.moveTo(VIEW.width - 18, y);
        ctx.quadraticCurveTo(VIEW.width - 12, y - 5, VIEW.width - 6, y);
        ctx.stroke();
      }

      ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const walked = i <= s.wp;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = walked ? COLORS.walked : COLORS.road;
        ctx.lineWidth = walked ? 4 : 2;
        ctx.setLineDash(walked ? [] : [6, 6]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      route.waypoints.forEach(function (w, i) { marker(w.kind, pts[i], i <= s.wp); });

      ctx.font = 'bold 13px Georgia, serif';
      ctx.fillStyle = COLORS.ink;
      [s.wp, s.wp + 1].forEach(function (i) {
        const w = route.waypoints[i];
        if (!w) return;
        ctx.textAlign = pts[i].x > VIEW.width - 120 ? 'right' : pts[i].x < 120 ? 'left' : 'center';
        ctx.fillText(w.name, pts[i].x, pts[i].y + 26);
      });

      const target = caravanAt(route, s);
      let p = target;
      if (run.anim) {
        const k = Math.min(1, (now - run.anim.at) / MOVE_MS);
        p = { x: run.anim.from.x + (target.x - run.anim.from.x) * k, y: run.anim.from.y + (target.y - run.anim.from.y) * k };
        if (k < 1) win.requestAnimationFrame(drawMap);
        else run.anim = null;
      }
      drawCaravan(p);
    }

    // ── Panels ───────────────────────────────────────────────────────────────

    function whereText(route, s) {
      const here = route.waypoints[s.wp];
      const next = route.waypoints[s.wp + 1];
      let text = 'Day ' + s.day + ' of ' + route.deadline + ' · ' + route.name + ' · ';
      if (!next) return text + 'at ' + here.name;
      if (s.mi === 0) return text + 'at ' + here.name + ', ' + next.miles + ' mi to ' + next.name;
      return text + (next.miles - s.mi) + ' mi to ' + next.name;
    }

    function supplies(s) {
      const rows = [
        { label: 'Salt', value: s.salt + ' bars', of: C.capacity(s), n: s.salt, low: false, note: 'room for ' + C.capacity(s) },
        { label: 'Water', value: s.water + ' / ' + C.WATER_MAX, of: C.WATER_MAX, n: s.water, low: s.water < 8 },
        { label: 'Food', value: s.food + ' / ' + C.FOOD_MAX, of: C.FOOD_MAX, n: s.food, low: s.food < 8 },
        { label: 'Camels', value: String(s.camels), of: C.MAX_CAMELS, n: s.camels, low: s.camels <= 2 },
        { label: 'Camel strength', value: s.strength + ' / 100', of: 100, n: s.strength, low: s.strength < 25 },
        { label: 'Crew vigour', value: s.vigour + ' / 100', of: 100, n: s.vigour, low: s.vigour < 25 },
        { label: 'Coin', value: String(s.coin), of: 0, n: 0, low: false }
      ];
      const list = $('supplies');
      list.textContent = '';
      rows.forEach(function (r) {
        const li = el('li', r.low ? 'low' : '');
        const name = el('span', 'name', r.label);
        if (r.low) { name.appendChild(doc.createTextNode(' ')); name.appendChild(el('span', 'flag', '! low')); }
        if (r.note) { name.appendChild(doc.createTextNode(' ')); name.appendChild(el('small', '', r.note)); }
        li.appendChild(name);
        li.appendChild(el('span', 'value', r.value));
        if (r.of > 0) {
          const meter = el('span', 'meter');
          const fill = el('span');
          fill.style.width = Math.round((100 * Math.min(r.n, r.of)) / r.of) + '%';
          meter.appendChild(fill);
          li.appendChild(meter);
        }
        list.appendChild(li);
      });
    }

    function diary(s) {
      const list = $('diary');
      list.textContent = '';
      s.diary.slice(-14).reverse().forEach(function (d) {
        const li = el('li');
        li.appendChild(el('span', 'day', 'Day ' + d.day + '.'));
        li.appendChild(doc.createTextNode(d.text));
        list.appendChild(li);
      });
    }

    function eventPanel(s) {
      const card = C.CARDS[s.card.kind];
      $('event-title').textContent = card.title;
      $('event-text').textContent = card.text;
      const box = $('choices');
      box.textContent = '';
      C.currentChoices(s).forEach(function (c, i) {
        const b = el('button', 'choice');
        b.type = 'button';
        b.disabled = !c.enabled;
        b.appendChild(el('kbd', '', String(i + 1)));
        b.appendChild(doc.createTextNode(c.label + (c.enabled ? '' : ' (not possible now)')));
        b.appendChild(el('span', 'odds', c.odds));
        b.addEventListener('click', function () { act(C.choose(run.s, i)); });
        box.appendChild(b);
      });
    }

    function postPanel(route, s) {
      const w = route.waypoints[s.wp];
      $('post-title').textContent = w.name;
      const box = $('goods');
      box.textContent = '';
      const offers = {
        water: '1 bar → +' + w.prices.water + ' water',
        food: '1 bar → +' + w.prices.food + ' food',
        camel: w.prices.camel + ' bars → +1 camel',
        coin: '1 bar → +' + w.prices.coin + ' coin'
      };
      C.GOODS.forEach(function (good) {
        const b = el('button', 'choice', offers[good]);
        b.type = 'button';
        b.setAttribute('data-good', good);
        b.disabled = C.trade(s, route, good) === s;
        b.addEventListener('click', function () {
          act(C.trade(run.s, run.route, good), true);
          say('Traded: ' + offers[good] + '. ' + run.s.salt + ' bars left.');
          // The panel was rebuilt: keep the keyboard on the same offer, or on Leave once it is closed.
          const again = box.querySelector('[data-good="' + good + '"]');
          (again && !again.disabled ? again : $('leave')).focus();
        });
        box.appendChild(b);
      });
    }

    function render(focus) {
      const s = run.s;
      $('where').textContent = whereText(run.route, s);
      supplies(s);
      diary(s);
      Object.keys(panels).forEach(function (k) { panels[k].hidden = run.over || s.phase !== k; });
      if (s.phase === 'event') eventPanel(s);
      if (s.phase === 'post') postPanel(run.route, s);
      const here = run.route.waypoints[s.wp];
      canvas.setAttribute('aria-label', 'Route map: ' + run.route.name + ', ' + (s.wp + 1) + ' of ' +
        run.route.waypoints.length + ' waypoints reached, last at ' + here.name + '.');
      win.requestAnimationFrame(drawMap);
      if (focus) {
        const panel = panels[s.phase];
        const target = panel && panel.querySelector('button:not(:disabled)');
        if (target) target.focus();
      }
    }

    // ── Journey ──────────────────────────────────────────────────────────────

    function begin(level, seed, resume) {
      const route = C.routeConfig(routes, level);
      run = {
        route: route,
        deck: C.buildDeck(route, seed),
        s: resume || C.newJourney(route, seed),
        over: false,
        submit: 'idle',
        anim: null
      };
      $('camp-exit').hidden = false;
      updateButtons();
      showCard(null);
      say(resume ? 'Back on the road.' : 'Set out from ' + route.waypoints[0].name + '.');
      persist();
      render(true);
    }

    /** Applies a new journey state from the core; `stay` keeps focus where it is (trading at a post). */
    function act(next, stay) {
      if (!run || run.over || next === run.s) return;
      const before = run.s;
      if (!reduceMotion && (next.wp !== before.wp || next.mi !== before.mi)) {
        run.anim = { from: caravanAt(run.route, before), at: win.performance.now() };
      }
      run.s = next;
      const last = next.diary[next.diary.length - 1];
      const was = before.diary[before.diary.length - 1];
      if (last && (next.diary.length !== before.diary.length || last.text !== was.text)) say(last.text);
      if (next.phase === 'over') {
        render(false);
        finish();
        return;
      }
      persist();
      render(!stay);
    }

    function plan() {
      const pace = doc.querySelector('input[name="pace"]:checked');
      const rations = doc.querySelector('input[name="rations"]:checked');
      return { pace: pace ? pace.value : 'steady', rations: rations ? rations.value : 'full' };
    }

    function finish() {
      const s = run.s;
      const score = C.finalScore(s, run.route);
      run.over = true;
      const level = run.route.level;
      if (score > (saved.best[level] || 0)) saved.best[level] = score;
      persist();
      $('camp-exit').hidden = true;
      const delivered = s.end === 'delivered';
      $('results-title').textContent = delivered ? 'Salt at the sea' : 'Stranded';
      $('results-line').textContent = s.diary[s.diary.length - 1].text;
      $('final-score').textContent = String(score);
      $('final-bars').textContent = String(s.delivered);
      $('final-days').textContent = String(s.day);
      $('final-bonus').textContent = delivered ? '×' + C.daysBonus(run.route, s.day) : '–';
      $('final-best').textContent = String(saved.best[level] || 0);
      updateButtons();
      showCard($('results'));
      say(run.route.name + ' · seed ' + s.seed);
    }

    function updateButtons() {
      const disabled = C.resultButtons(run || { over: false, submit: 'idle' });
      $('submit').disabled = disabled.submit;
      $('share').disabled = disabled.share;
    }

    function submit() {
      const submitted = run;
      const s = submitted.s;
      submitted.submit = 'pending';
      updateButtons();
      sdk.submitScore({
        score: C.finalScore(s, submitted.route),
        level: submitted.route.level,
        seed: s.seed,
        meta: { bars: s.delivered, days: s.day, end: s.end }
      })
        .then(function (r) {
          submitted.submit = 'done';
          if (run === submitted) { updateButtons(); say(C.submitText(r)); }
        })
        .catch(function (e) {
          // Rate limits and outages are worth a retry; any other refusal would only repeat.
          submitted.submit = e.code === 'rate_limited' || e.code === 'unavailable' ? 'idle' : 'failed';
          if (run === submitted) { updateButtons(); say(errorText(e)); }
        });
    }

    function share() {
      const s = run.s;
      const text = s.end === 'delivered'
        ? 'I brought ' + s.delivered + ' bars of salt to market in ' + s.day + ' days on Saltroad (' + run.route.name + '). Same road, same luck:'
        : 'The road beat my caravan on Saltroad (' + run.route.name + '). Same road, same luck, your turn:';
      sdk.share({ level: run.route.level, seed: s.seed, text: text })
        .then(function () { say('Challenge link copied'); })
        .catch(function (e) { say(errorText(e)); });
    }

    function leave() {
      const done = saveLoaded ? saves.flush(payload) : Promise.resolve();
      done.then(function () { return sdk.exit(); }).catch(function () {});
    }

    /** A new start over a saved journey asks first, in the page (the sandbox has no window.confirm). */
    function startOrAsk(level, seed) {
      const note = C.abandonNote(saved.journey, routes);
      if (!note) { begin(level, seed, null); return; }
      pendingStart = { level: level, seed: seed };
      $('confirm-text').textContent = note;
      showCard($('confirm'));
    }

    function keepJourney() {
      pendingStart = null;
      showCard($('intro'));
      $('continue').focus();
    }

    // ── Input ────────────────────────────────────────────────────────────────

    Object.keys(C.PACES).forEach(function (k) { $('hint-' + k).textContent = C.paceHint(k); });
    Object.keys(C.RATIONS).forEach(function (k) { $('hint-' + k).textContent = C.rationHint(k); });

    $('travel').addEventListener('click', function () {
      act(C.travelDay(run.s, run.route, run.deck, plan()));
    });
    $('leave').addEventListener('click', function () { act(C.leavePost(run.s)); });

    doc.addEventListener('keydown', function (e) {
      if (!run || run.over || run.s.phase !== 'event' || e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      const choices = C.currentChoices(run.s);
      if (n >= 1 && n <= choices.length) {
        e.preventDefault();
        if (choices[n - 1].enabled) act(C.choose(run.s, n - 1));
        else say(choices[n - 1].label + ' is not possible right now.');
      }
    });

    $('play').addEventListener('click', function () {
      if (challenge) {
        startOrAsk(challenge.level, challenge.seed);
        return;
      }
      const picked = doc.querySelector('input[name="route"]:checked');
      startOrAsk(picked ? picked.value : '1', C.randomSeed(Math.random));
    });
    $('confirm-keep').addEventListener('click', keepJourney);
    $('confirm-start').addEventListener('click', function () {
      const start = pendingStart;
      pendingStart = null;
      if (start) begin(start.level, start.seed, null);
    });
    $('confirm').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); keepJourney(); }
    });
    $('continue').addEventListener('click', function () {
      const j = saved.journey;
      if (j) begin(j.level, j.seed, j);
    });
    $('submit').addEventListener('click', submit);
    $('share').addEventListener('click', share);
    $('again').addEventListener('click', function () {
      begin(run.route.level, C.randomSeed(Math.random), null);
    });
    $('exit').addEventListener('click', leave);
    $('camp-exit').addEventListener('click', leave);

    // ready() first; then the routes and the save.
    sdk.ready()
      .then(function (info) {
        challenge = info.challenge;
        const load = sdk.load().then(
          function (data) { saveLoaded = true; return data; },
          function () { return null; }
        );
        return Promise.all([sdk.asset('routes.json'), load]);
      })
      .then(function (loaded) {
        routes = JSON.parse(new TextDecoder().decode(loaded[0]));
        saved = C.readSave(loaded[1], routes);
        if (challenge) {
          const route = C.routeConfig(routes, challenge.level);
          challenge = { level: route.level, seed: challenge.seed };
          $('route-pick').hidden = true;
          $('intro-note').textContent = 'Challenge: ' + route.name + ', seed ' + challenge.seed + '. Same road, same deck.';
          $('play').textContent = 'Take the challenge';
        }
        $('continue').hidden = !saved.journey;
        if (saved.journey) {
          const j = saved.journey;
          $('continue').textContent = 'Continue (' + C.routeConfig(routes, j.level).name + ', day ' + j.day + ')';
        }
        say('');
        showCard($('intro'));
      })
      .catch(function (e) {
        say('Saltroad could not start: ' + errorText(e));
      });
  }

  start(window, document, window.LanParty);
}());
