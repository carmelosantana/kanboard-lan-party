/*
 * Saltroad: the journey rules, with no DOM. A salt caravan walks a route of waypoints from the inland pans to a
 * coastal market. Each day the player picks a pace and rations; a seeded deck deals the day's event; wells refill
 * the skins, posts trade salt for supplies, fords and passes ask for a decision. Score: bars delivered × days bonus.
 *
 * Every function here takes a journey state and returns a new one (plain JSON, so it can be saved). The deck
 * is built from the route level and the seed only, so a challenger with the same seed draws the same cards in the
 * same order, and each card carries its own roll: the same choice on the same card always turns out the same.
 */
(function () {
  'use strict';

  const MAX_SCORE = 10000; // game.json scoring.max; scoreBound() shows no route can reach it
  const MAX_CAMELS = 8;
  const BARS_PER_CAMEL = 12;
  const WATER_MAX = 40;
  const FOOD_MAX = 60;
  const DIARY_KEEP = 60;
  const SEED_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const START = { water: 30, food: 40, strength: 80, vigour: 80, coin: 10, salt: 44, camels: 4 };

  const PACES = {
    steady: { label: 'Steady', miles: 12, water: 3, strength: -1, vigour: -1 },
    hard: { label: 'Hard', miles: 18, water: 4, strength: -6, vigour: -3 },
    rest: { label: 'Rest', miles: 0, water: 2, strength: 12, vigour: 8 }
  };
  const RATIONS = {
    full: { label: 'Full', food: 3, vigour: 3 },
    half: { label: 'Half', food: 2, vigour: 0 },
    lean: { label: 'Lean', food: 1, vigour: -4 }
  };
  const TERRAIN = { flat: 1, rocky: 0.85, dunes: 0.7 };
  const KINDS = ['pans', 'plain', 'dunes', 'well', 'post', 'canyon', 'ford', 'market'];
  const GOODS = ['water', 'food', 'camel', 'coin'];

  /** How often each card turns up in the deck. Fords and passes are not in the deck: the route deals them. */
  const DECK_WEIGHTS = { quiet: 10, sandstorm: 2, lame: 2, oasis: 1.5, toll: 1.5, trader: 2, lost: 1.5 };

  const CARDS = {
    quiet: { title: 'A quiet day', text: '', choices: [] },
    sandstorm: {
      title: 'Sandstorm',
      text: 'A brown wall stands up on the horizon and starts walking toward you.',
      choices: [
        { label: 'Couch the camels and wait it out', outcomes: [
          { p: 1, effects: { days: 1 }, diary: 'We lay behind the camels and let the storm argue with them. The camels won.' }
        ] },
        { label: 'Push on through', outcomes: [
          { p: 0.6, effects: {}, diary: 'We walked into the storm with scarves over our faces and came out the far side, grittier but whole.' },
          { p: 0.4, effects: { salt: -4, strength: -10 }, diary: 'The storm tore open a pack and carried off four bars. Somewhere a dune is very well seasoned.' }
        ] }
      ]
    },
    lame: {
      title: 'Lame camel',
      text: 'The grey one is favouring a foreleg and looking at you as though it were your fault.',
      choices: [
        { label: 'Rest her a day', outcomes: [
          { p: 1, effects: { days: 1, strength: 6 }, diary: 'A day off for the grey one. She spent it eating and staring at us. Recovery, of a kind.' }
        ] },
        { label: 'Spread her load and keep going', outcomes: [
          { p: 0.7, effects: { strength: -6 }, diary: 'The others took her load with loud complaints. She walked lighter and smugger.' },
          { p: 0.3, effects: { camels: -1 }, diary: 'The grey one lay down and would not rise. We sat with her a while before we went on.' }
        ] }
      ]
    },
    oasis: {
      title: 'Oasis',
      text: 'Palms and green water, in a place the old maps leave politely blank.',
      choices: [
        { label: 'Fill the skins and go', outcomes: [
          { p: 1, effects: { water: 12 }, diary: 'Filled every skin we owned and one cooking pot. Nobody suggested drinking from the pot.' }
        ] },
        { label: 'Stay the day', outcomes: [
          { p: 1, effects: { days: 1, fill: true, vigour: 15, strength: 15 }, diary: 'We stayed the day in the shade. Someone laughed at nothing for an hour, and so did the rest of us.' }
        ] }
      ]
    },
    toll: {
      title: 'Toll riders',
      text: 'Three riders block the track and name a price for the privilege of using it.',
      choices: [
        { label: 'Pay 6 coin', requires: { coin: 6 }, outcomes: [
          { p: 1, effects: { coin: -6 }, diary: 'Paid the riders. They thanked us with the warmth of people who had not needed to ask twice.' }
        ] },
        { label: 'Pay 5 bars', requires: { salt: 5 }, outcomes: [
          { p: 1, effects: { salt: -5 }, diary: 'Paid in salt. The riders licked a bar to check it, which was more than we needed to see.' }
        ] },
        { label: 'Make a run for it', outcomes: [
          { p: 0.5, effects: { strength: -12 }, diary: 'We ran and they did not follow. The camels will be telling this story for weeks.' },
          { p: 0.5, effects: { salt: -10, vigour: -10 }, diary: 'We ran. They were faster. They took ten bars and some of our dignity.' }
        ] }
      ]
    },
    trader: {
      title: 'A passing trader',
      text: 'A trader with a cart of oddments and one excellent hat falls into step beside you.',
      choices: [
        { label: 'Buy 5 bars for 8 coin', requires: { coin: 8, room: 5 }, outcomes: [
          { p: 1, effects: { coin: -8, salt: 5 }, diary: 'Bought five bars off the trader. The salt was good. The hat was not for sale.' }
        ] },
        { label: 'Sell 4 bars for 10 coin', requires: { salt: 4 }, outcomes: [
          { p: 1, effects: { salt: -4, coin: 10 }, diary: 'Sold four bars for a fair price, then spent an hour wondering if it was fair.' }
        ] },
        { label: 'Wave and walk on', outcomes: [
          { p: 1, effects: {}, diary: 'The trader went one way and we went the other. Both of us felt we had won.' }
        ] }
      ]
    },
    lost: {
      title: 'Lost the track',
      text: 'The cairns have stopped. Every direction looks equally sure of itself.',
      choices: [
        { label: 'Backtrack to the last cairn', outcomes: [
          { p: 1, effects: { miles: -6 }, diary: 'Walked back to the last cairn, apologised to it, and started again.' }
        ] },
        { label: 'Follow the stars', outcomes: [
          { p: 0.6, effects: {}, diary: 'Steered by the stars and found the track again exactly where we had left it. Smug all evening.' },
          { p: 0.4, effects: { miles: -14, water: -3 }, diary: 'The stars meant well. We spent half a day finding out where they meant.' }
        ] }
      ]
    },
    ford: {
      title: 'The river is up',
      text: 'Brown water, moving fast, carrying a tree that had other plans this morning.',
      choices: [
        { label: 'Wait for the water to drop', outcomes: [
          { p: 1, effects: { days: 2 }, diary: 'Waited two days for the river to calm down. It took its time, as rivers do.' }
        ] },
        { label: 'Wade across now', outcomes: [
          { p: 0.7, effects: { strength: -6 }, diary: 'Waded across chest-deep, holding the packs high. Everyone made it, wetter and prouder.' },
          { p: 0.3, effects: { salt: -8, strength: -10 }, diary: 'The current took a pack of eight bars. The river is a little saltier and we are a little quieter.' }
        ] },
        { label: 'Pay the ferry, 6 coin', requires: { coin: 6 }, outcomes: [
          { p: 1, effects: { coin: -6 }, diary: 'Paid the ferry. The ferryman told us his life story, which was worth the fare.' }
        ] }
      ]
    },
    canyon: {
      title: 'The pass',
      text: 'The track narrows to a ledge the width of one careful camel.',
      choices: [
        { label: 'Take the ledge', outcomes: [
          { p: 0.75, effects: {}, diary: 'Took the ledge one camel at a time, nobody looking down. Nobody fell.' },
          { p: 0.25, effects: { camels: -1 }, diary: 'A camel slipped on the ledge. We stood a long minute at the edge before moving on.' }
        ] },
        { label: 'Go the long way round', outcomes: [
          { p: 1, effects: { days: 2, strength: -5 }, diary: 'Took the long way round. Two extra days of rocks, and all of us still here to complain.' }
        ] }
      ]
    }
  };

  const DIARY = {
    quiet: [
      'Nothing happened all day, which out here counts as good news.',
      'The cook sang the same three lines of a song until we joined in out of self-defence.',
      'Saw a lizard. The lizard saw us. Neither party was impressed.',
      'Wind from the east, then the west, then from somewhere it had no business being.',
      'Counted the bars twice. All there. Counted them a third time for luck.',
      'Someone found a coin in the sand and spent the evening deciding what it would buy.',
      'The camels walked in perfect silence. We suspect they are plotting.',
      'Long shadows, short tempers, good stew.',
      'A hawk followed us for an hour, hoping we would become interesting.',
      'We argued about whether a cloud looked like a goat. It did.',
      'Patched three water skins and one friendship.',
      'The stars came out early, as if they had heard we were good company.',
      'Walked until our feet filed a formal complaint.',
      'The youngest asked how much farther. We said a bit. It is always a bit.'
    ],
    rest: [
      'We rested. The camels pretended to be grateful.',
      'A day in camp: mending, napping, and a long debate about the best kind of bread.',
      'Rested in the shade of the biggest camel, who charged nothing for it.'
    ],
    arrive: {
      plain: 'Passed {name}, which is mostly a name.',
      dunes: 'Crossed into {name}. Every hill has another hill standing behind it.',
      well: 'Reached {name}. The water tasted of stone and was the best thing any of us had drunk.',
      post: 'Reached {name}, where everyone wants salt and pretends not to.',
      canyon: 'Came to {name}. The walls lean in as if listening.',
      ford: 'Came to {name}. The river is in a mood.',
      market: 'Reached {name}: gulls, shouting, the smell of the sea. We sold {salt} bars and slept like stones.'
    },
    dry: 'The skins ran dry. Nobody talked much.',
    hungry: 'Ate the last crumbs, then ate the idea of supper.',
    camelLost: 'Lost a camel to the road today. We said a few words; she would have hated them.',
    leftBehind: 'Not enough backs to carry it all: we left {n} bars by a cairn for whoever comes next.',
    strandedCrew: 'The crew could go no farther. We turned for home with empty hands and our lives, which is not nothing.',
    strandedHerd: 'No camels left to carry the salt. It stays here, and so, for a while, do we.',
    setOut: 'Loaded {salt} bars at {name} and set out for the coast. Spirits high, water skins higher.'
  };

  // ── Seeded randomness ──────────────────────────────────────────────────────

  /** A small seeded PRNG: returns a function giving floats in [0, 1). */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** FNV-1a: a string to the unsigned 32-bit state mulberry32 starts from. */
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

  /** A diary line from a pool, picked by seed and day, so a replay reads the same. */
  function flavour(pool, seed, day) {
    const lines = DIARY[pool];
    return lines[seedToInt(seed + '|' + day + '|' + pool) % lines.length];
  }

  // ── Routes and the deck ────────────────────────────────────────────────────

  function own(obj, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /** The named route from routes.json, or route "1" when the name is unknown. */
  function routeConfig(routes, level) {
    const key = own(routes, level) ? level : '1';
    return Object.assign({ level: key }, routes[key]);
  }

  function routeMiles(route) {
    return route.waypoints.reduce(function (t, w) { return t + w.miles; }, 0);
  }

  /**
   * The journey's deck, keyed on route level + seed: `cards` are dealt one per day in order, `stops` give the
   * roll for a ford or pass at each waypoint index. Long enough for any journey; it wraps if ever exhausted.
   */
  function buildDeck(route, seed) {
    const rand = mulberry32(seedToInt(route.level + '|' + seed));
    const kinds = Object.keys(DECK_WEIGHTS);
    const total = kinds.reduce(function (t, k) { return t + DECK_WEIGHTS[k]; }, 0);
    const cards = [];
    for (let i = 0; i < route.deadline * 3; i++) {
      let pick = rand() * total;
      let kind = kinds[kinds.length - 1];
      for (let k = 0; k < kinds.length; k++) {
        pick -= DECK_WEIGHTS[kinds[k]];
        if (pick < 0) { kind = kinds[k]; break; }
      }
      cards.push({ kind: kind, roll: rand() });
    }
    const stops = route.waypoints.map(function (w) { return { kind: w.kind, roll: rand() }; });
    return { cards: cards, stops: stops };
  }

  // ── Journey state ──────────────────────────────────────────────────────────

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function capacity(s) {
    return s.camels * BARS_PER_CAMEL;
  }

  function note(s, text) {
    s.diary.push({ day: s.day, text: text });
    if (s.diary.length > DIARY_KEEP) s.diary.splice(0, s.diary.length - DIARY_KEEP);
  }

  function fillIn(text, values) {
    return text.replace(/\{(\w+)\}/g, function (m, key) { return String(values[key]); });
  }

  function newJourney(route, seed) {
    const s = Object.assign({
      v: 1,
      level: route.level,
      seed: seed,
      day: 0,
      wp: 0,
      mi: 0,
      draws: 0,
      phase: 'camp',
      card: null,
      end: null,
      delivered: 0,
      diary: []
    }, START);
    note(s, fillIn(DIARY.setOut, { salt: s.salt, name: route.waypoints[0].name }));
    return s;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  /** Spends water and food; running short of either wears the crew (and, for water, the camels). */
  function consume(s, water, food) {
    if (s.water < water) {
      s.water = 0;
      s.vigour -= 15;
      s.strength -= 10;
      note(s, DIARY.dry);
    } else s.water -= water;
    const fed = s.food >= food;
    if (!fed) {
      s.food = 0;
      s.vigour -= 12;
      note(s, DIARY.hungry);
    } else s.food -= food;
    return fed;
  }

  /** Days lost in camp (waiting out a storm or a river): half rations, a little rest for the camels. */
  function passDays(s, n) {
    for (let i = 0; i < n; i++) {
      s.day++;
      consume(s, 2, 2);
      s.strength += 4;
    }
  }

  /** Clamps every resource, loses spent camels and their loads, and ends the journey if the caravan is spent. */
  function settle(s) {
    if (s.phase === 'over') return s; // at the market (or already stranded): the journey's books are closed
    if (s.strength <= 0 && s.camels > 0) {
      s.camels--;
      s.strength = 35;
      note(s, DIARY.camelLost);
    }
    s.camels = clamp(s.camels, 0, MAX_CAMELS);
    s.water = clamp(s.water, 0, WATER_MAX);
    s.food = clamp(s.food, 0, FOOD_MAX);
    s.strength = clamp(s.strength, 0, 100);
    s.vigour = clamp(s.vigour, 0, 100);
    s.coin = Math.max(0, s.coin);
    s.salt = Math.max(0, s.salt);
    if (s.salt > capacity(s) && s.camels > 0) {
      note(s, fillIn(DIARY.leftBehind, { n: s.salt - capacity(s) }));
      s.salt = capacity(s);
    }
    if (s.vigour <= 0 || s.camels <= 0) {
      note(s, s.camels <= 0 ? DIARY.strandedHerd : DIARY.strandedCrew);
      s.phase = 'over';
      s.end = 'stranded';
      s.card = null;
    }
    return s;
  }

  /** Miles a day's walk covers: the pace, slowed by the terrain of the leg and by tired camels. */
  function dayMiles(pace, terrain, strength) {
    const tired = strength < 25 ? 0.6 : strength < 50 ? 0.85 : 1;
    return Math.round(PACES[pace].miles * TERRAIN[terrain] * tired);
  }

  function arrive(s, route, deck) {
    s.wp++;
    s.mi = 0;
    const w = route.waypoints[s.wp];
    if (w.kind === 'market') {
      s.delivered = s.salt;
      s.phase = 'over';
      s.end = 'delivered';
      note(s, fillIn(DIARY.arrive.market, { name: w.name, salt: s.salt }));
      return true;
    }
    note(s, fillIn(DIARY.arrive[w.kind], { name: w.name }));
    if (w.kind === 'well') s.water = WATER_MAX;
    if (w.kind === 'post') { s.phase = 'post'; return true; }
    if (w.kind === 'ford' || w.kind === 'canyon') {
      s.phase = 'event';
      s.card = { kind: w.kind, roll: deck.stops[s.wp].roll };
      return true;
    }
    return false;
  }

  /** One day on the road with plan {pace, rations}: spend, walk (until a stop or the day's miles run out), then deal. */
  function travelDay(state, route, deck, plan) {
    if (state.phase !== 'camp' || !own(PACES, plan.pace) || !own(RATIONS, plan.rations)) return state;
    const s = clone(state);
    const pace = PACES[plan.pace];
    const rations = RATIONS[plan.rations];
    const next = route.waypoints[s.wp + 1];
    const miles = dayMiles(plan.pace, next.terrain, s.strength);
    s.day++;
    if (consume(s, pace.water, rations.food)) s.vigour += rations.vigour;
    s.strength += pace.strength;
    s.vigour += pace.vigour;
    // Walk on through plains, dunes and wells; posts, fords, passes and the market stop the day.
    let left = miles;
    let stopped = false;
    while (left > 0 && !stopped) {
      const leg = route.waypoints[s.wp + 1].miles - s.mi;
      if (left < leg) { s.mi += left; break; }
      left -= leg;
      stopped = arrive(s, route, deck);
    }
    settle(s);
    if (s.phase !== 'camp' || stopped) return s;

    const card = deck.cards[s.draws % deck.cards.length];
    s.draws++;
    if (card.kind === 'quiet') {
      note(s, flavour(plan.pace === 'rest' ? 'rest' : 'quiet', s.seed, s.day));
    } else {
      s.phase = 'event';
      s.card = { kind: card.kind, roll: card.roll };
    }
    return s;
  }

  function meets(s, requires) {
    if (!requires) return true;
    if (requires.coin && s.coin < requires.coin) return false;
    if (requires.salt && s.salt < requires.salt) return false;
    if (requires.room && s.salt + requires.room > capacity(s)) return false;
    return true;
  }

  /** The current card's choices as {label, odds, enabled}, for the UI. */
  function currentChoices(s) {
    if (s.phase !== 'event' || !s.card) return [];
    return CARDS[s.card.kind].choices.map(function (c) {
      return { label: c.label, odds: oddsText(c), enabled: meets(s, c.requires) };
    });
  }

  /** Index of the outcome the roll lands on, walking the cumulative odds. */
  function pickOutcome(choice, roll) {
    let edge = 0;
    for (let i = 0; i < choice.outcomes.length; i++) {
      edge += choice.outcomes[i].p;
      if (roll < edge) return i;
    }
    return choice.outcomes.length - 1;
  }

  function applyEffects(s, e) {
    if (e.days) passDays(s, e.days);
    if (e.miles) s.mi = Math.max(0, s.mi + e.miles);
    if (e.fill) s.water = WATER_MAX;
    ['water', 'food', 'strength', 'vigour', 'coin', 'salt', 'camels'].forEach(function (k) {
      if (e[k]) s[k] += e[k];
    });
  }

  /** Resolves choice `index` of the current card with the card's roll. A closed choice changes nothing. */
  function choose(state, index) {
    if (state.phase !== 'event' || !state.card) return state;
    const choice = CARDS[state.card.kind].choices[index];
    if (!choice || !meets(state, choice.requires)) return state;
    const s = clone(state);
    const outcome = choice.outcomes[pickOutcome(choice, s.card.roll)];
    applyEffects(s, outcome.effects);
    note(s, outcome.diary);
    s.card = null;
    s.phase = 'camp';
    return settle(s);
  }

  /** At a post: one bar of salt (or `camel` price bars) for one lot of the good. Nothing when it would not fit. */
  function trade(state, route, good) {
    if (state.phase !== 'post' || GOODS.indexOf(good) === -1) return state;
    const prices = route.waypoints[state.wp].prices;
    const cost = good === 'camel' ? prices.camel : 1;
    if (state.salt < cost) return state;
    if (good === 'water' && state.water >= WATER_MAX) return state;
    if (good === 'food' && state.food >= FOOD_MAX) return state;
    if (good === 'camel' && state.camels >= MAX_CAMELS) return state;
    const s = clone(state);
    s.salt -= cost;
    if (good === 'camel') {
      s.strength = Math.round((s.strength * s.camels + 90) / (s.camels + 1));
      s.camels++;
    } else {
      s[good] += prices[good];
    }
    s.water = Math.min(WATER_MAX, s.water);
    s.food = Math.min(FOOD_MAX, s.food);
    return s;
  }

  function leavePost(state) {
    if (state.phase !== 'post') return state;
    const s = clone(state);
    s.phase = 'camp';
    return s;
  }

  // ── Text for the UI ────────────────────────────────────────────────────────

  const EFFECT_ORDER = ['days', 'miles', 'fill', 'salt', 'camels', 'strength', 'vigour', 'water', 'food', 'coin'];
  const UNITS = {
    days: ['day', 'days'],
    miles: ['mile', 'miles'],
    salt: ['bar', 'bars'],
    camels: ['camel', 'camels'],
    strength: ['strength', 'strength'],
    vigour: ['vigour', 'vigour'],
    water: ['water', 'water'],
    food: ['food', 'food'],
    coin: ['coin', 'coin']
  };

  /** "−4 bars, −10 strength"; "no loss" for an outcome that changes nothing. */
  function effectsText(e) {
    const parts = [];
    EFFECT_ORDER.forEach(function (k) {
      if (!e[k]) return;
      if (k === 'fill') { parts.push('skins filled'); return; }
      const n = e[k];
      parts.push((n < 0 ? '−' : '+') + Math.abs(n) + ' ' + UNITS[k][Math.abs(n) === 1 ? 0 : 1]);
    });
    return parts.length ? parts.join(', ') : 'no loss';
  }

  /** "60%: no loss · 40%: −4 bars, −10 strength"; "Certain: …" for a single outcome. */
  function oddsText(choice) {
    if (choice.outcomes.length === 1) return 'Certain: ' + effectsText(choice.outcomes[0].effects);
    return choice.outcomes.map(function (o) {
      return Math.round(o.p * 100) + '%: ' + effectsText(o.effects);
    }).join(' · ');
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  /** Days left on the route's deadline when the salt arrives; never below 1, so a late delivery still counts. */
  function daysBonus(route, days) {
    return Math.max(1, route.deadline - days);
  }

  function finalScore(s, route) {
    if (s.end !== 'delivered') return 0;
    return clamp(s.delivered * daysBonus(route, s.day), 0, MAX_SCORE);
  }

  /** The most a route could ever score: a full eight-camel load arriving on day 1. */
  function scoreBound(route) {
    return MAX_CAMELS * BARS_PER_CAMEL * daysBonus(route, 1);
  }

  function resultButtons(run) {
    return { submit: !run.over || run.submit !== 'idle', share: run.submit !== 'done' };
  }

  function submitText(r) {
    return r.rank > 0 ? 'Rank #' + r.rank + ' · your best ' + r.best : 'Your best ' + r.best;
  }

  /**
   * The saved {best, journey}; anything unreadable becomes an empty save, and a finished journey is dropped.
   * With `routes`, a journey on a route that no longer exists, or past its last leg, is dropped too.
   */
  function readSave(saved, routes) {
    const out = { best: {}, journey: null };
    if (!saved || typeof saved !== 'object') return out;
    if (saved.best && typeof saved.best === 'object' && !Array.isArray(saved.best)) {
      Object.keys(saved.best).forEach(function (k) {
        if (Number.isInteger(saved.best[k])) out.best[k] = saved.best[k];
      });
    }
    const j = saved.journey;
    const numbers = ['day', 'wp', 'mi', 'draws', 'water', 'food', 'strength', 'vigour', 'coin', 'salt', 'camels'];
    if (j && typeof j === 'object' && typeof j.level === 'string' && typeof j.seed === 'string' &&
        ['camp', 'event', 'post'].indexOf(j.phase) !== -1 && Array.isArray(j.diary) &&
        numbers.every(function (k) { return Number.isInteger(j[k]); }) &&
        (j.phase !== 'event' || (j.card && own(CARDS, j.card.kind)))) {
      out.journey = j;
    }
    if (out.journey && routes) {
      const route = own(routes, j.level) ? routes[j.level] : null;
      if (!route || j.wp < 0 || j.wp > route.waypoints.length - 2) out.journey = null;
    }
    return out;
  }

  /** The warning shown before a new start replaces a saved journey; '' when there is none. */
  function abandonNote(journey, routes) {
    if (!journey) return '';
    return 'This replaces your saved journey on ' + routeConfig(routes, journey.level).name + ' (day ' + journey.day + ').';
  }

  /**
   * One save in flight at a time. push(payloadFn) sends now, or (while busy) remembers only the latest request,
   * sent when the current one lands; payloadFn runs at send time, so a coalesced save carries the newest state.
   * flush(payloadFn) does the same and resolves once nothing is in flight. Failed saves are swallowed.
   */
  function saveQueue(save) {
    let busy = false;
    let queued = null;
    let waiters = [];
    function send(payloadFn) {
      busy = true;
      let sent;
      try { sent = Promise.resolve(save(payloadFn())); } catch (e) { sent = Promise.reject(e); }
      sent.catch(function () {}).then(function () {
        if (queued) {
          const next = queued;
          queued = null;
          send(next);
          return;
        }
        busy = false;
        const done = waiters;
        waiters = [];
        done.forEach(function (resolve) { resolve(); });
      });
    }
    function push(payloadFn) {
      if (busy) queued = payloadFn;
      else send(payloadFn);
    }
    return {
      push: push,
      flush: function (payloadFn) {
        push(payloadFn);
        return new Promise(function (resolve) { waiters.push(resolve); });
      }
    };
  }

  /** "12 mi, 3 water"; the camp hints are written from PACES and RATIONS so they cannot drift. */
  function paceHint(key) {
    const p = PACES[key];
    if (p.miles === 0) return 'stay put, ' + p.water + ' water, recover';
    return p.miles + ' mi, ' + p.water + ' water' + (p.strength < -3 ? ', wears camels and crew' : '');
  }

  function rationHint(key) {
    const r = RATIONS[key];
    return r.food + ' food' + (r.vigour > 0 ? ', crew perks up' : r.vigour < 0 ? ', crew flags' : '');
  }

  const api = {
    MAX_SCORE: MAX_SCORE,
    MAX_CAMELS: MAX_CAMELS,
    BARS_PER_CAMEL: BARS_PER_CAMEL,
    WATER_MAX: WATER_MAX,
    FOOD_MAX: FOOD_MAX,
    DIARY_KEEP: DIARY_KEEP,
    PACES: PACES,
    RATIONS: RATIONS,
    TERRAIN: TERRAIN,
    KINDS: KINDS,
    GOODS: GOODS,
    DECK_WEIGHTS: DECK_WEIGHTS,
    CARDS: CARDS,
    DIARY: DIARY,
    mulberry32: mulberry32,
    seedToInt: seedToInt,
    randomSeed: randomSeed,
    flavour: flavour,
    routeConfig: routeConfig,
    routeMiles: routeMiles,
    buildDeck: buildDeck,
    newJourney: newJourney,
    capacity: capacity,
    dayMiles: dayMiles,
    travelDay: travelDay,
    currentChoices: currentChoices,
    pickOutcome: pickOutcome,
    choose: choose,
    trade: trade,
    leavePost: leavePost,
    effectsText: effectsText,
    oddsText: oddsText,
    daysBonus: daysBonus,
    finalScore: finalScore,
    scoreBound: scoreBound,
    resultButtons: resultButtons,
    submitText: submitText,
    readSave: readSave,
    abandonNote: abandonNote,
    saveQueue: saveQueue,
    paceHint: paceHint,
    rationHint: rationHint
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.SaltroadCore = api;
  }
}());
