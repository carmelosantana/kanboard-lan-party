// Game SDK tests: zero dependency (node:test, fake windows/events, no jsdom).
// Each test names the mutation of lanparty-sdk.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SDK = require('../../Assets/js/lanparty-sdk.js');

const NONCE = 'n0nce';
function client() {
  const sent = [];
  const c = SDK.createClient({ nonce: NONCE, post: (msg) => sent.push(msg) });
  return { c, sent };
}
const settled = async (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
const tick = () => new Promise((r) => setImmediate(r));

// Kills: a request envelope without lp/nonce/op/args, or ids that repeat.
test('call posts {lp: 1, id, nonce, op, args} with a fresh id each time', () => {
  const { c, sent } = client();
  c.call('ready', {});
  c.call('load', {});
  assert.deepEqual(Object.keys(sent[0]).sort(), ['args', 'id', 'lp', 'nonce', 'op']);
  assert.equal(sent[0].lp, 1);
  assert.equal(sent[0].nonce, NONCE);
  assert.equal(sent[0].op, 'ready');
  assert.deepEqual(sent[0].args, {});
  assert.notEqual(sent[0].id, sent[1].id);
});

// Kills: matching replies by arrival order instead of id, or resolving an error reply.
test('replies resolve and reject the request with the matching id, in any order', async () => {
  const { c, sent } = client();
  const a = c.call('ready', {});
  const b = c.call('submitScore', { score: 1 });
  c.receive({ lp: 1, id: sent[1].id, ok: false, error: { code: 'rate_limited', message: 'Slow down' } });
  c.receive({ lp: 1, id: sent[0].id, ok: true, result: { player: { id: 2 } } });
  assert.deepEqual(await settled(a), { ok: true, v: { player: { id: 2 } } });
  assert.deepEqual(await settled(b), { ok: false, e: { code: 'rate_limited', message: 'Slow down' } });
});

// Kills: accepting replies for unknown ids, without the lp envelope, or settling one request twice.
test('replies with unknown ids, a wrong envelope or a repeated id are ignored', async () => {
  const { c, sent } = client();
  let done = 0;
  const p = c.call('load', {}).then((v) => { done++; return v; });
  for (const data of [null, 'x', { lp: 1, id: 999, ok: true, result: 'evil' }, { lp: 2, id: sent[0].id, ok: true, result: 'evil' },
    { id: sent[0].id, ok: true, result: 'evil' }]) {
    c.receive(data);
  }
  await tick();
  assert.equal(done, 0);
  c.receive({ lp: 1, id: sent[0].id, ok: true, result: { level: 3 } });
  c.receive({ lp: 1, id: sent[0].id, ok: true, result: 'again' });
  assert.deepEqual(await p, { level: 3 });
  assert.equal(done, 1);
});

// Kills: passing an unknown or missing error code through to the game.
test('a reply with an unknown or missing error code rejects unavailable', async () => {
  const { c, sent } = client();
  const a = c.call('load', {});
  const b = c.call('load', {});
  c.receive({ lp: 1, id: sent[0].id, ok: false, error: { code: 'pwned', message: 'x' } });
  c.receive({ lp: 1, id: sent[1].id, ok: false });
  assert.equal((await settled(a)).e.code, 'unavailable');
  const eb = (await settled(b)).e;
  assert.equal(eb.code, 'unavailable');
  assert.equal(typeof eb.message, 'string');
});

// Kills: letting a DataCloneError (functions, DOM nodes in args) escape as a thrown exception.
test('args that cannot be posted reject bad_request', async () => {
  const c = SDK.createClient({ nonce: NONCE, post: () => { throw new Error('DataCloneError'); } });
  assert.equal((await settled(c.call('save', { data: () => 1 }))).e.code, 'bad_request');
});

// Kills: posting without a nonce (outside LAN Party), which the host would silently ignore forever.
test('without a nonce or a parent every call rejects unavailable and nothing is posted', async () => {
  let posted = 0;
  const noNonce = SDK.createClient({ nonce: '', post: () => { posted++; } });
  assert.equal((await settled(noNonce.call('ready', {}))).e.code, 'unavailable');
  const noPost = SDK.createClient({ nonce: NONCE, post: null });
  assert.equal((await settled(noPost.call('ready', {}))).e.code, 'unavailable');
  assert.equal(posted, 0);
});

// Kills: an API that misses or renames an op, shapes args differently from the host, or stubs room.*.
test('the LanParty API maps each call to its op and args', () => {
  const { c, sent } = client();
  const api = c.api;
  assert.deepEqual(Object.keys(api).sort(), ['asset', 'exit', 'file', 'leaderboard', 'load', 'ready', 'save', 'share', 'submitScore']);
  assert.equal(api.room, undefined);
  for (const [name, fn] of Object.entries(api)) {
    const p = fn();
    assert.ok(p instanceof Promise, name);
    p.catch(() => {});
  }
  sent.length = 0;
  api.ready();
  api.asset('art/a.png');
  api.file('doom1');
  api.submitScore({ score: 640, level: 'l1', meta: { lives: 2 }, junk: 1 });
  api.leaderboard({ period: 'week', limit: 5 });
  api.leaderboard();
  api.save({ level: 3 });
  api.load();
  api.share({ level: 'l1', seed: 's', text: 'Beat me' });
  api.exit();
  assert.deepEqual(sent.map((m) => [m.op, m.args]), [
    ['ready', {}],
    ['asset', { path: 'art/a.png' }],
    ['file', { id: 'doom1' }],
    ['submitScore', { score: 640, level: 'l1', meta: { lives: 2 } }],
    ['leaderboard', { period: 'week', limit: 5 }],
    ['leaderboard', {}],
    ['save', { data: { level: 3 } }],
    ['load', {}],
    ['share', { level: 'l1', seed: 's', text: 'Beat me' }],
    ['exit', {}],
  ]);
});

// Kills: an API call that throws synchronously instead of returning a rejected Promise.
test('a non-object argument rejects bad_request without posting', async () => {
  const { c, sent } = client();
  sent.length = 0;
  assert.equal((await settled(c.api.submitScore(640))).e.code, 'bad_request');
  assert.equal((await settled(c.api.share('hi'))).e.code, 'bad_request');
  assert.equal(sent.length, 0);
});

// --- browser glue ---------------------------------------------------------------------------------------

function fakeWindow(hash) {
  const parent = { posted: [], postMessage(msg, origin) { this.posted.push({ msg, origin }); } };
  const win = {
    parent, origin: 'null', location: { hash }, listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    deliver(ev) { (this.listeners.message || []).forEach((fn) => fn(ev)); },
  };
  return win;
}

// Kills: reading the nonce from anywhere but #lp=, or posting to a fixed origin instead of '*' on parent.
test('install reads the nonce from #lp= and posts to parent with target origin *', () => {
  const win = fakeWindow('#lp=abc123');
  const api = SDK.install(win);
  assert.equal(win.LanParty, api);
  api.ready();
  assert.equal(win.parent.posted.length, 1);
  assert.equal(win.parent.posted[0].origin, '*');
  assert.equal(win.parent.posted[0].msg.nonce, 'abc123');
  const other = fakeWindow('#x=1&lp=zz9');
  SDK.install(other).ready();
  assert.equal(other.parent.posted[0].msg.nonce, 'zz9');
});

// Kills: removing the event.source === parent check (any window could answer the game's requests).
test('install accepts replies only from parent', async () => {
  const win = fakeWindow('#lp=abc123');
  const api = SDK.install(win);
  const p = api.load();
  const id = win.parent.posted[0].msg.id;
  win.deliver({ source: { not: 'parent' }, data: { lp: 1, id, ok: true, result: 'evil' } });
  win.deliver({ source: null, data: { lp: 1, id, ok: true, result: 'evil' } });
  win.deliver({ source: win.parent, data: { lp: 1, id, ok: true, result: { level: 1 } } });
  assert.deepEqual(await p, { level: 1 });
});

// Kills: posting without a nonce, which the host would silently ignore forever.
test('install without a nonce rejects unavailable and posts nothing', async () => {
  const bare = fakeWindow('');
  assert.equal((await settled(SDK.install(bare).ready())).e.code, 'unavailable');
  assert.equal(bare.parent.posted.length, 0);
});

// A window with a document whose body (or root, when the SDK runs from <head>) records what replaced it.
function withDocument(win, { body = true } = {}) {
  const node = () => ({ textContent: 'game markup', innerHTML: 'untouched' });
  win.document = { body: body ? node() : null, documentElement: node() };
  win.stopped = 0;
  win.stop = () => { win.stopped++; };
  return win;
}

// Kills: installing the SDK (and letting the page's scripts run) when the game is opened top-level or framed
// without the sandbox, where it would run with the Kanboard origin and the player's session.
test('install refuses a top-level or same-origin window: stops loading, replaces the page, throws', () => {
  const top = withDocument(fakeWindow('#lp=abc'));
  top.parent = top;
  top.origin = 'https://kb.test';
  top.postMessage = () => assert.fail('must not post to itself');
  const unsandboxed = withDocument(fakeWindow('#lp=abc'));
  unsandboxed.origin = 'https://kb.test';
  const opaqueButTop = withDocument(fakeWindow('#lp=abc'));
  opaqueButTop.parent = opaqueButTop;
  const noOrigin = withDocument(fakeWindow('#lp=abc'));
  delete noOrigin.origin;
  for (const [name, win] of Object.entries({ top, unsandboxed, opaqueButTop, noOrigin })) {
    assert.throws(() => SDK.install(win), /LAN Party/, name);
    assert.equal(win.LanParty, undefined, name);
    assert.equal(win.stopped, 1, name);
    assert.equal(win.document.body.textContent, 'Open this game from LAN Party', name);
    assert.equal(win.document.body.innerHTML, 'untouched', name + ': textContent only');
    assert.equal(win.parent === win ? 0 : win.parent.posted.length, 0, name);
  }
  // From <head> there is no body yet: the root element is replaced instead. No stop() is not fatal.
  const head = withDocument(fakeWindow('#lp=abc'), { body: false });
  head.origin = 'https://kb.test';
  delete head.stop;
  assert.throws(() => SDK.install(head), /LAN Party/);
  assert.equal(head.document.documentElement.textContent, 'Open this game from LAN Party');
});

// Kills: a guard that also refuses the real case, an opaque-origin frame inside the launcher.
test('install proceeds in an opaque-origin frame inside a parent', () => {
  const win = withDocument(fakeWindow('#lp=abc'));
  SDK.install(win).ready();
  assert.equal(win.stopped, 0);
  assert.equal(win.document.body.textContent, 'game markup');
  assert.equal(win.parent.posted.length, 1);
});
