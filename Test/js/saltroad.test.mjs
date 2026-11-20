// Saltroad: the pure journey rules (seeded deck, travel, events, trading, scoring) under node:test, zero
// dependency. Each test names the mutation of saltroad-core.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const S = require('../../Games/saltroad/saltroad-core.js');
const ROUTES = JSON.parse(readFileSync(new URL('../../Games/saltroad/routes.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('../../Games/saltroad/game.json', import.meta.url), 'utf8'));

const SHORT = S.routeConfig(ROUTES, '1');
const LONG = S.routeConfig(ROUTES, '2');
const STEADY_FULL = { pace: 'steady', rations: 'full' };

function fresh(route = SHORT, seed = 'k3x9q2ab') {
  return S.newJourney(route, seed);
}

/** A journey parked mid-leg with known resources, for single-rule tests. */
function parked(over = {}) {
  return Object.assign(fresh(), { water: 20, food: 20, strength: 70, vigour: 70, coin: 10, salt: 40, camels: 4 }, over);
}

/** A plain-minded caravan master: steady and full rations, the first open choice, top up at posts. */
function autoplay(route, seed) {
  const deck = S.buildDeck(route, seed);
  let s = S.newJourney(route, seed);
  for (let step = 0; step < 400 && s.phase !== 'over'; step++) {
    if (s.phase === 'camp') {
      const plan = { pace: s.strength < 25 ? 'rest' : 'steady', rations: s.food > 6 ? 'full' : 'half' };
      s = S.travelDay(s, route, deck, plan);
    } else if (s.phase === 'event') {
      s = S.choose(s, S.currentChoices(s).findIndex((c) => c.enabled));
    } else if (s.phase === 'post') {
      while (s.food < 30 && s.salt > 20) s = S.trade(s, route, 'food');
      while (s.water < 30 && s.salt > 20) s = S.trade(s, route, 'water');
      s = S.leavePost(s);
    }
  }
  return s;
}

// Kills: an unseeded or stateless generator (Math.random, a constant).
test('mulberry32 repeats for a seed, differs across seeds and stays in [0, 1)', () => {
  const a = S.mulberry32(42);
  const b = S.mulberry32(42);
  const c = S.mulberry32(43);
  const xs = Array.from({ length: 100 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 100 }, () => b()));
  assert.notDeepEqual(xs, Array.from({ length: 100 }, () => c()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

// Kills: a hash that ignores characters or order.
test('seedToInt is stable, order-sensitive and unsigned 32-bit', () => {
  assert.equal(S.seedToInt('abc'), S.seedToInt('abc'));
  assert.notEqual(S.seedToInt('ab'), S.seedToInt('ba'));
  for (const s of ['', 'a', '1|k3x9q2ab']) {
    const n = S.seedToInt(s);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, s);
  }
});

// Kills: a seed the score endpoint would refuse (^[A-Za-z0-9_.-]{0,64}$).
test('randomSeed gives 8 lowercase letters and digits', () => {
  const rand = S.mulberry32(7);
  for (let i = 0; i < 50; i++) assert.match(S.randomSeed(rand), /^[a-z0-9]{8}$/);
});

// Kills: an unknown challenge level crashing the game instead of falling back to the short route.
test('routeConfig returns the named route, or route 1 when unknown', () => {
  assert.equal(S.routeConfig(ROUTES, '2').level, '2');
  assert.equal(S.routeConfig(ROUTES, '2').waypoints.length, ROUTES['2'].waypoints.length);
  for (const bad of ['nope', undefined, '__proto__', 'constructor']) assert.equal(S.routeConfig(ROUTES, bad).level, '1');
});

// Kills: a route file the journey cannot walk (no start, no market, an unknown kind, a post with no prices).
test('routes.json: route 1 is short, route 2 is long, both run pans to market', () => {
  assert.deepEqual(Object.keys(ROUTES), ['1', '2']);
  assert.ok(SHORT.waypoints.length >= 8 && SHORT.waypoints.length <= 12, 'short');
  assert.equal(LONG.waypoints.length, 20, 'long');
  for (const route of [SHORT, LONG]) {
    const w = route.waypoints;
    assert.equal(w[0].kind, 'pans');
    assert.equal(w[0].miles, 0);
    assert.equal(w[w.length - 1].kind, 'market');
    assert.ok(Number.isInteger(route.deadline) && route.deadline > 0);
    w.forEach((p, i) => {
      assert.ok(S.KINDS.includes(p.kind), p.name);
      assert.ok(S.TERRAIN[p.terrain] > 0, p.name);
      assert.ok(i === 0 || (Number.isInteger(p.miles) && p.miles > 0), p.name);
      assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, p.name);
      if (p.kind === 'post') for (const k of S.GOODS) assert.ok(p.prices[k] > 0, p.name + ' ' + k);
      if (i > 0 && i < w.length - 1) assert.notEqual(p.kind, 'market', p.name);
    });
  }
  assert.ok(S.routeMiles(LONG) > 2 * S.routeMiles(SHORT) - 20, 'long is about twice the short');
});

// Kills: a deck keyed on the seed alone (both routes would share it), on neither, or with invalid cards.
test('buildDeck replays for route+seed and differs across seeds and routes', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  assert.deepEqual(deck, S.buildDeck(SHORT, 'k3x9q2ab'));
  assert.notDeepEqual(deck.cards, S.buildDeck(SHORT, 'k3x9q2ac').cards);
  assert.notDeepEqual(deck.cards, S.buildDeck(LONG, 'k3x9q2ab').cards);
  assert.ok(deck.cards.length >= SHORT.deadline * 2);
  assert.equal(deck.stops.length, SHORT.waypoints.length);
  for (const card of deck.cards.concat(deck.stops)) assert.ok(card.roll >= 0 && card.roll < 1);
  for (const card of deck.cards) assert.ok(Object.keys(S.DECK_WEIGHTS).includes(card.kind), card.kind);
  const kinds = new Set(S.buildDeck(LONG, 'zz').cards.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), Object.keys(S.DECK_WEIGHTS).sort(), 'every kind shows up in a long deck');
});

// Kills: an event with one choice, odds that do not sum to 1, or a choice with no diary line.
test('every card offers 2 or 3 choices whose odds sum to 1, each outcome with a diary line', () => {
  for (const [kind, card] of Object.entries(S.CARDS)) {
    if (kind === 'quiet') continue;
    assert.ok(card.title && card.text, kind);
    assert.ok(card.choices.length >= 2 && card.choices.length <= 3, kind);
    for (const choice of card.choices) {
      const sum = choice.outcomes.reduce((t, o) => t + o.p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, kind + ': ' + choice.label);
      for (const o of choice.outcomes) assert.ok(o.diary.length > 10 && o.diary.length <= 140, o.diary);
    }
  }
});

// Kills: hidden odds (the brief asks for visible odds) or a certain outcome shown as a percentage.
test('oddsText shows each outcome chance and what it costs', () => {
  assert.equal(S.oddsText(S.CARDS.sandstorm.choices[1]), '60%: no loss · 40%: −4 bars, −10 strength');
  assert.equal(S.oddsText(S.CARDS.sandstorm.choices[0]), 'Certain: +1 day');
  assert.equal(S.effectsText({ miles: -6 }), '−6 miles');
  assert.equal(S.effectsText({ camels: -1, coin: 10 }), '−1 camel, +10 coin');
  assert.equal(S.effectsText({ fill: true }), 'skins filled');
});

// Kills: an outcome picked by anything but the card's own roll against cumulative odds.
test('pickOutcome walks the cumulative odds with the roll', () => {
  const choice = S.CARDS.sandstorm.choices[1];
  assert.equal(S.pickOutcome(choice, 0), 0);
  assert.equal(S.pickOutcome(choice, 0.59), 0);
  assert.equal(S.pickOutcome(choice, 0.6), 1);
  assert.equal(S.pickOutcome(choice, 0.999), 1);
});

// Kills: starting with more salt than the camels can carry, or a journey that cannot be saved as JSON.
test('newJourney starts at the pans with a full load, in camp, as plain JSON', () => {
  const s = fresh();
  assert.equal(s.level, '1');
  assert.equal(s.seed, 'k3x9q2ab');
  assert.equal(s.wp, 0);
  assert.equal(s.mi, 0);
  assert.equal(s.day, 0);
  assert.equal(s.phase, 'camp');
  assert.ok(s.salt > 0 && s.salt <= S.capacity(s));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

// Kills: a day that costs nothing, or rations that eat the same at every setting.
test('travelDay at steady pace walks 12 miles and spends water and food by rations', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const before = parked();
  const full = S.travelDay(before, SHORT, deck, STEADY_FULL);
  assert.equal(full.day, 1);
  assert.equal(full.mi, 12);
  assert.equal(full.water, 20 - S.PACES.steady.water);
  assert.equal(full.food, 20 - S.RATIONS.full.food);
  assert.equal(S.travelDay(before, SHORT, deck, { pace: 'steady', rations: 'lean' }).food, 20 - S.RATIONS.lean.food);
  assert.ok(S.travelDay(before, SHORT, deck, { pace: 'steady', rations: 'lean' }).vigour < full.vigour);
  assert.equal(before.day, 0, 'travelDay does not mutate its input');
});

// Kills: a hard pace that is free, or rest that still moves.
test('hard pace walks farther and wears the camels; rest stays put and recovers', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const hard = S.travelDay(parked(), SHORT, deck, { pace: 'hard', rations: 'full' });
  const steady = S.travelDay(parked(), SHORT, deck, STEADY_FULL);
  const rest = S.travelDay(parked(), SHORT, deck, { pace: 'rest', rations: 'full' });
  assert.deepEqual([hard.wp, hard.mi], [1, 4], 'hard walks 18: past the first waypoint at 14 and on');
  assert.deepEqual([steady.wp, steady.mi], [0, 12]);
  assert.ok(hard.strength < steady.strength);
  assert.equal(rest.mi, 0);
  assert.ok(rest.strength > 70 && rest.vigour > 70);
});

// Kills: terrain and tired camels not slowing the caravan.
test('dunes and weak camels shorten the day', () => {
  assert.equal(S.dayMiles('steady', 'flat', 70), 12);
  assert.equal(S.dayMiles('steady', 'dunes', 70), 8);
  assert.equal(S.dayMiles('hard', 'flat', 70), 18);
  assert.equal(S.dayMiles('steady', 'flat', 40), 10);
  assert.equal(S.dayMiles('steady', 'flat', 20), 7);
  assert.equal(S.dayMiles('rest', 'flat', 100), 0);
});

// Kills: losing the rest of the day at every waypoint, or a well passed without refilling.
test('a well on the way fills the skins and the day walks on past it', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const s = S.travelDay(parked({ wp: 1, mi: 10, water: 5 }), SHORT, deck, { pace: 'hard', rations: 'full' });
  assert.equal(SHORT.waypoints[2].kind, 'well');
  assert.equal(s.wp, 2);
  assert.equal(s.mi, 10 + 18 - 16);
  assert.equal(s.water, S.WATER_MAX);
  assert.match(s.diary[s.diary.length - 1].text, /Kettle Well/);
});

// Kills: a post that skips trading, trades without paying salt, or ignores the caps.
test('a post opens trading: salt buys water, food, camels and coin within the caps', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  let s = S.travelDay(parked({ wp: 3, mi: 10 }), SHORT, deck, STEADY_FULL);
  assert.equal(s.phase, 'post');
  const prices = SHORT.waypoints[4].prices;
  const fed = S.trade(s, SHORT, 'food');
  assert.equal(fed.salt, s.salt - 1);
  assert.equal(fed.food, s.food + prices.food);
  assert.equal(S.trade(s, SHORT, 'coin').coin, s.coin + prices.coin);
  const herd = S.trade(s, SHORT, 'camel');
  assert.equal(herd.camels, s.camels + 1);
  assert.equal(herd.salt, s.salt - prices.camel);
  assert.equal(S.trade(Object.assign({}, s, { food: S.FOOD_MAX }), SHORT, 'food').salt, s.salt, 'full: no sale');
  assert.equal(S.trade(Object.assign({}, s, { camels: S.MAX_CAMELS }), SHORT, 'camel').camels, S.MAX_CAMELS);
  assert.equal(S.trade(Object.assign({}, s, { salt: 3 }), SHORT, 'camel').salt, 3, 'cannot afford');
  assert.deepEqual(S.trade(parked(), SHORT, 'food'), parked(), 'no trading outside a post');
  s = S.leavePost(fed);
  assert.equal(s.phase, 'camp');
});

// Kills: a ford or pass that passes without a choice, or a choice that ignores its requirement.
test('a ford stops the caravan with a choice; the ferry needs coin', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const s = S.travelDay(parked({ wp: 7, mi: 10, coin: 2 }), SHORT, deck, STEADY_FULL);
  assert.equal(s.phase, 'event');
  assert.equal(s.card.kind, 'ford');
  assert.equal(s.card.roll, deck.stops[8].roll);
  const choices = S.currentChoices(s);
  const ferry = choices.findIndex((c) => /ferry/i.test(c.label));
  assert.equal(choices[ferry].enabled, false);
  assert.deepEqual(S.choose(s, ferry), s, 'a closed choice does nothing');
  const waited = S.choose(s, 0);
  assert.equal(waited.phase, 'camp');
  assert.equal(waited.day, s.day + 2);
});

// Kills: event outcomes that ignore the roll, or effects applied to the wrong resource.
test('choose resolves the card by its roll and applies the effects', () => {
  const storm = (roll) => parked({ phase: 'event', card: { kind: 'sandstorm', roll: roll } });
  const lucky = S.choose(storm(0.1), 1);
  assert.equal(lucky.salt, 40);
  assert.equal(lucky.phase, 'camp');
  const unlucky = S.choose(storm(0.9), 1);
  assert.equal(unlucky.salt, 36);
  assert.equal(unlucky.strength, 60);
  assert.equal(unlucky.card, null);
  assert.ok(unlucky.diary.length > storm(0.9).diary.length);
  const lost = S.choose(parked({ mi: 3, phase: 'event', card: { kind: 'lost', roll: 0 } }), 0);
  assert.equal(lost.mi, 0, 'backtracking never goes behind the last waypoint');
});

// Kills: running dry without consequence.
test('empty skins and an empty larder wear the crew down', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const ok = S.travelDay(parked(), SHORT, deck, STEADY_FULL);
  const dry = S.travelDay(parked({ water: 1 }), SHORT, deck, STEADY_FULL);
  const hungry = S.travelDay(parked({ food: 0 }), SHORT, deck, STEADY_FULL);
  assert.equal(dry.water, 0);
  assert.ok(dry.vigour < ok.vigour && dry.strength < ok.strength);
  assert.ok(hungry.vigour < ok.vigour);
});

// Kills: spent camels living forever, or salt carried with no back to carry it.
test('worn-out camels are lost and their load is left behind', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const s = S.travelDay(parked({ strength: 2, salt: 48 }), SHORT, deck, { pace: 'hard', rations: 'full' });
  assert.equal(s.camels, 3);
  assert.ok(s.strength > 0);
  assert.equal(s.salt, 3 * S.BARS_PER_CAMEL);
});

// Kills: a caravan that keeps walking with no crew or camels left.
test('a spent crew is stranded: the journey ends and scores nothing', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const s = S.travelDay(parked({ vigour: 3, water: 0, food: 0 }), SHORT, deck, STEADY_FULL);
  assert.equal(s.phase, 'over');
  assert.equal(s.end, 'stranded');
  assert.equal(S.finalScore(s, SHORT), 0);
  assert.equal(S.choose(parked({ camels: 1, phase: 'event', card: { kind: 'lame', roll: 0.99 } }), 1).end, 'stranded');
});

// Kills: a market that does not end the journey, or a score that ignores the days.
test('reaching the market delivers the salt; score is bars × days bonus', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const last = SHORT.waypoints.length - 2;
  const s = S.travelDay(parked({ wp: last, mi: 10, day: 9 }), SHORT, deck, STEADY_FULL);
  assert.equal(s.phase, 'over');
  assert.equal(s.end, 'delivered');
  assert.equal(s.delivered, 40);
  assert.equal(S.daysBonus(SHORT, 10), SHORT.deadline - 10);
  assert.equal(S.daysBonus(SHORT, SHORT.deadline + 5), 1, 'late still pays, once');
  assert.equal(S.finalScore(s, SHORT), 40 * (SHORT.deadline - 10));
});

// Kills: a scoring.max the game can exceed (the endpoint would refuse) or that drifts from the manifest.
test('the score ceiling holds for every route and matches game.json', () => {
  assert.equal(MANIFEST.scoring.max, S.MAX_SCORE);
  assert.equal(MANIFEST.scoring.order, 'high');
  assert.equal(MANIFEST.scoring.unit, 'bars');
  for (const route of [SHORT, LONG]) assert.ok(S.scoreBound(route) <= S.MAX_SCORE, route.name);
  const s = parked({ phase: 'over', end: 'delivered', delivered: 1e9, day: 0 });
  assert.equal(S.finalScore(s, LONG), S.MAX_SCORE);
});

// Kills: a journey that depends on anything but the seed and the choices (async challengers must match).
test('the same seed and the same choices replay the same journey', () => {
  const a = autoplay(LONG, 'k3x9q2ab');
  assert.deepEqual(a, autoplay(LONG, 'k3x9q2ab'));
  assert.notDeepEqual(a.diary, autoplay(LONG, 'p0p0p0p0').diary);
});

// Kills: an unwinnable balance: a careful, plain player reaches the market on most seeds of both routes.
test('a careful caravan usually reaches the market with salt to sell', () => {
  for (const route of [SHORT, LONG]) {
    const seeds = Array.from({ length: 20 }, (_, i) => 'seed' + i);
    const ends = seeds.map((seed) => autoplay(route, seed));
    const delivered = ends.filter((s) => s.end === 'delivered');
    assert.ok(delivered.length >= 16, route.name + ': ' + delivered.length + '/20 delivered');
    assert.ok(delivered.every((s) => S.finalScore(s, route) > 0), route.name);
    assert.ok(ends.some((s) => S.finalScore(s, route) !== S.finalScore(ends[0], route)), 'seeds matter');
  }
});

// Kills: a save over the 64 KB limit on a long journey.
test('a finished long journey saves well under 64 KB', () => {
  const s = autoplay(LONG, 'k3x9q2ab');
  assert.ok(s.diary.length <= S.DIARY_KEEP);
  assert.ok(JSON.stringify({ v: 1, best: {}, journey: s }).length < 16 * 1024);
});

// Kills: diary text naming nobody in particular slipping into a flavour pool, or an empty pool.
test('diary pools are short and every flavour line is picked by the seed', () => {
  for (const [name, pool] of Object.entries(S.DIARY)) {
    const lines = typeof pool === 'string' ? [pool] : Object.values(pool);
    assert.ok(lines.length > 0, name);
    for (const line of lines) assert.ok(line.length <= 140, line);
  }
  assert.equal(S.flavour('quiet', 'abc', 3), S.flavour('quiet', 'abc', 3));
  const picks = new Set(Array.from({ length: 30 }, (_, d) => S.flavour('quiet', 'abc', d)));
  assert.ok(picks.size > 5);
});

// Kills: Share enabled before a score is in, or Submit clickable mid-journey or twice.
test('resultButtons: Submit once per finished journey, Share only after a successful submit', () => {
  const at = (over, submit) => S.resultButtons({ over, submit });
  assert.deepEqual(at(false, 'idle'), { submit: true, share: true });
  assert.deepEqual(at(true, 'idle'), { submit: false, share: true });
  assert.deepEqual(at(true, 'pending'), { submit: true, share: true });
  assert.deepEqual(at(true, 'done'), { submit: true, share: false });
  assert.deepEqual(at(true, 'failed'), { submit: true, share: true });
});

// Kills: showing "Rank #0" for players kept off the boards.
test('submitText leaves the rank out when it is 0', () => {
  assert.equal(S.submitText({ accepted: true, rank: 3, best: 120 }), 'Rank #3 · your best 120');
  assert.equal(S.submitText({ accepted: true, rank: 0, best: 120 }), 'Your best 120');
});

// Kills: a save that is not shaped the way the game reads it back (a stale or foreign save must not crash).
test('readSave accepts its own shape and shrugs off anything else', () => {
  const s = fresh();
  assert.deepEqual(S.readSave({ v: 1, best: { 1: 300 }, journey: s }), { best: { 1: 300 }, journey: s });
  assert.deepEqual(S.readSave(null), { best: {}, journey: null });
  assert.deepEqual(S.readSave({ v: 1, best: 'x', journey: { phase: 'camp' } }), { best: {}, journey: null });
  assert.deepEqual(S.readSave({ v: 1, best: { 1: 300 }, journey: Object.assign({}, s, { phase: 'over' }) }).journey, null);
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────

// Kills: settle() running after the market (I1): a caravan that arrives on its last breath scored as stranded.
test('arriving at the market on the last vigour still delivers', () => {
  const deck = S.buildDeck(SHORT, 'abc');
  const last = SHORT.waypoints.length - 2;
  const s = S.travelDay(parked({ wp: last, mi: 10, vigour: 2, water: 0, food: 0 }), SHORT, deck, STEADY_FULL);
  assert.equal(s.end, 'delivered');
  assert.equal(s.phase, 'over');
  assert.ok(S.finalScore(s, SHORT) > 0);
  assert.match(s.diary[s.diary.length - 1].text, /Gull Market/);
});

// Kills: a camel lost (and its load dropped) after the salt was already sold at the market (I1).
test('a camel worn out on arrival day does not unsell the delivered salt', () => {
  const deck = S.buildDeck(SHORT, 'abc');
  const last = SHORT.waypoints.length - 2;
  const s = S.travelDay(parked({ wp: last, mi: 10, strength: 3, salt: 48 }), SHORT, deck, { pace: 'hard', rations: 'full' });
  assert.equal(s.end, 'delivered');
  assert.equal(s.delivered, 48);
  assert.equal(s.salt, s.delivered);
  assert.match(s.diary[s.diary.length - 1].text, /sold 48 bars/);
});

// Kills: dropping the room check in meets() (M1): buying bars the camels cannot carry.
test('the trader cannot sell bars the camels have no room for', () => {
  const at = (salt) => S.currentChoices(parked({ salt, coin: 20, phase: 'event', card: { kind: 'trader', roll: 0 } }))[0].enabled;
  assert.equal(at(43), true);
  assert.equal(at(44), false);
});

// Kills: dropping the water cap in trade() (M1): a bar charged for skins that are already full.
test('a post refuses water when the skins are full', () => {
  const deck = S.buildDeck(SHORT, 'k3x9q2ab');
  const s = S.travelDay(parked({ wp: 3, mi: 10 }), SHORT, deck, STEADY_FULL);
  const full = Object.assign({}, s, { water: S.WATER_MAX });
  assert.equal(S.trade(full, SHORT, 'water'), full);
});

// Kills: dropping readSave's number and event-card checks (M1), or accepting a waypoint past the route's end (M2).
test('readSave drops journeys with broken numbers, unknown cards or a waypoint off the route', () => {
  const s = fresh();
  const keep = (j) => S.readSave({ v: 1, best: {}, journey: j }, ROUTES).journey;
  assert.deepEqual(keep(s), s);
  assert.equal(keep(Object.assign({}, s, { day: 1.5 })), null);
  assert.equal(keep(Object.assign({}, s, { phase: 'event', card: { kind: 'nope', roll: 0 } })), null);
  assert.equal(keep(Object.assign({}, s, { phase: 'event', card: null })), null);
  assert.ok(keep(Object.assign({}, s, { phase: 'event', card: { kind: 'sandstorm', roll: 0.5 } })));
  assert.equal(keep(Object.assign({}, s, { wp: SHORT.waypoints.length - 1 })), null, 'at the market is over, not resumable');
  assert.equal(keep(Object.assign({}, s, { wp: 99 })), null);
  assert.equal(keep(Object.assign({}, s, { wp: -1 })), null);
  assert.equal(keep(Object.assign({}, s, { level: '9' })), null, 'a route that no longer exists');
  assert.ok(keep(Object.assign({}, s, { wp: SHORT.waypoints.length - 2 })));
});

// Kills: starting over a saved journey without saying what is lost (M3).
test('abandonNote names the journey a new start would replace, or nothing', () => {
  assert.equal(S.abandonNote(null, ROUTES), '');
  const j = Object.assign(S.newJourney(LONG, 'x'), { day: 30 });
  assert.equal(S.abandonNote(j, ROUTES), 'This replaces your saved journey on The Long Road (day 30).');
});

// Kills: more than one save in flight (M4), lost coalesced saves, or a final save that is not awaited.
test('saveQueue keeps one save in flight, coalesces the rest and resolves flush() after the last', async () => {
  const sent = [];
  const pending = [];
  const q = S.saveQueue(function (payload) {
    sent.push(payload);
    return new Promise((resolve) => pending.push(resolve));
  });
  let state = 1;
  const payload = () => ({ n: state });
  q.push(payload);
  state = 2; q.push(payload);
  state = 3; q.push(payload);
  assert.deepEqual(sent, [{ n: 1 }], 'one in flight');
  let flushed = false;
  const done = q.flush(payload).then(() => { flushed = true; });
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [{ n: 1 }, { n: 3 }], 'the queued saves collapse into the latest state');
  assert.equal(flushed, false);
  pending.shift()();
  await done;
  assert.equal(flushed, true);
  assert.equal(sent.length, 2);
  const failing = S.saveQueue(() => Promise.reject({ code: 'unavailable' }));
  await failing.flush(payload); // a failed save still lets the queue (and exit) move on
});

// Kills: pace and ration hints drifting from the numbers the rules use (M5).
test('pace and ration hints are written from PACES and RATIONS', () => {
  assert.equal(S.paceHint('steady'), S.PACES.steady.miles + ' mi, ' + S.PACES.steady.water + ' water');
  assert.match(S.paceHint('hard'), new RegExp('^' + S.PACES.hard.miles + ' mi'));
  assert.match(S.paceHint('rest'), /stay put/);
  for (const k of Object.keys(S.RATIONS)) assert.match(S.rationHint(k), new RegExp('^' + S.RATIONS[k].food + ' food'));
});

// ── Fix round 2 ──────────────────────────────────────────────────────────────

// Kills: the market's early return in settle() skipping the clamps (N1): "Crew vigour -26" on the results HUD.
test('no resource goes negative or over its cap when the caravan arrives spent', () => {
  const deck = S.buildDeck(SHORT, 'abc');
  const last = SHORT.waypoints.length - 2;
  for (const over of [{ vigour: 2, water: 0, food: 0 }, { strength: 3, salt: 48 }, { vigour: 1, strength: 1, water: 0, food: 0 }]) {
    const s = S.travelDay(parked(Object.assign({ wp: last, mi: 10 }, over)), SHORT, deck, { pace: 'hard', rations: 'full' });
    assert.equal(s.end, 'delivered', JSON.stringify(over));
    for (const k of ['water', 'food', 'strength', 'vigour', 'coin', 'salt', 'camels']) assert.ok(s[k] >= 0, k + ' ' + s[k]);
    assert.ok(s.water <= S.WATER_MAX && s.food <= S.FOOD_MAX && s.strength <= 100 && s.vigour <= 100);
  }
});

// Kills: the rest hint drifting from PACES.rest.water (nit from review 2).
test('the rest hint shows the water a rest day costs', () => {
  assert.equal(S.paceHint('rest'), 'stay put, ' + S.PACES.rest.water + ' water, recover');
  const was = S.PACES.rest.water;
  try {
    S.PACES.rest.water = 7; // a retune must reach the hint, not a figure typed into it
    assert.equal(S.paceHint('rest'), 'stay put, 7 water, recover');
  } finally {
    S.PACES.rest.water = was;
  }
});
