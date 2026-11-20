// Host bridge tests: zero dependency (node:test, fake windows/events/fetch, no jsdom).
// Each test names the mutation of lanparty-host.js that it kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../../Assets/js/lanparty-host.js');

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ENDPOINTS = {
  score: '/?controller=ScoreController&action=submit&plugin=LanParty',
  scores: '/?controller=ScoreController&action=board&slug=arcade&plugin=LanParty',
  save: '/?controller=SaveController&action=save&plugin=LanParty',
  load: '/?controller=SaveController&action=load&slug=arcade&plugin=LanParty',
};
const PLAYER = { id: 2, name: 'Amy', avatar_url: null };
const GAME = { slug: 'arcade', title: 'Arcade', version: '0.1.0' };
const SHARE = 'http://kb.test/?controller=LauncherController&action=game&plugin=LanParty&slug=arcade';

// A fake response in the shape fetch() resolves with.
function res(status, body, { json = true, redirected = false } = {}) {
  const text = json ? JSON.stringify(body) : String(body);
  return {
    ok: status >= 200 && status < 300, status, redirected,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

// A host wired to a fake iframe window that records replies, and a fetch that records calls.
function setup(opts = {}) {
  const replies = [];
  const frameWin = { postMessage: (msg, origin, transfer) => replies.push({ msg, origin, transfer }) };
  const calls = [];
  const fetch = opts.fetch || (async (url, init) => { calls.push({ url, init }); return (opts.respond || (() => res(200, {})))(url, init); });
  const clipboard = opts.clipboard || { written: [], writeText(t) { this.written.push(t); return Promise.resolve(); } };
  let exited = 0;
  const host = H.createHost({
    iframe: { contentWindow: frameWin }, nonce: NONCE, endpoints: ENDPOINTS, csrf: 'tok123',
    base: '/plugins/scored/Games/arcade/', player: PLAYER, game: GAME, share: SHARE,
    challenge: opts.challenge === undefined ? null : opts.challenge,
    fetch, clipboard, onExit: () => { exited++; },
  });
  // Sends a request as the game would and waits for the host to settle it.
  const send = async (op, args = {}, over = {}) => {
    const before = replies.length;
    await host.handleMessage({ source: frameWin, data: { lp: 1, id: over.id ?? replies.length + 1, nonce: NONCE, op, args, ...over } });
    return replies.length > before ? replies[replies.length - 1] : null;
  };
  return { host, frameWin, replies, calls, clipboard, send, exited: () => exited };
}
const form = (init) => Object.fromEntries(new URLSearchParams(init.body));

// --- normalizeAssetPath -------------------------------------------------------------------------------

// Kills: a normaliser that rejects plain relative paths or keeps the leading "./".
test('normalizeAssetPath accepts relative paths inside the game folder', () => {
  assert.equal(H.normalizeAssetPath('art/a.png'), 'art/a.png');
  assert.equal(H.normalizeAssetPath('./x.js'), 'x.js');
  assert.equal(H.normalizeAssetPath('levels/./one.json'), 'levels/one.json');
  assert.equal(H.normalizeAssetPath('notes.php.txt'), 'notes.php.txt');
});

// Kills: dropping any one of the traversal, absolute, scheme, backslash, encoding, whitespace or .php checks.
test('normalizeAssetPath rejects traversal, absolute paths, schemes and tricks', () => {
  const bad = ['../x', '/x', 'a/../../x', 'a/../x', '..', 'http://x', 'HTTPS://x', '//x', 'data:text/plain,hi',
    'javascript:alert(1)', 'a\\b', '..\\x', '%2e%2e/x', 'a%2fb', 'x?y', 'x#y', ' //x', 'a b', 'a\nb',
    '', 'a//b', 'art/', '.', null, undefined, 42, {}, 'x'.repeat(513), 'x.php', 'a/b.PHP', 'shell.pHp'];
  for (const p of bad) assert.equal(H.normalizeAssetPath(p), null, JSON.stringify(p));
});

// --- validateRequest ----------------------------------------------------------------------------------

const req = (over = {}) => ({ lp: 1, id: 1, nonce: NONCE, op: 'ready', args: {}, ...over });

// Kills: a validator that passes a well-formed request as invalid.
test('validateRequest accepts every whitelisted op', () => {
  for (const op of ['ready', 'asset', 'file', 'submitScore', 'leaderboard', 'save', 'load', 'share', 'exit']) {
    assert.equal(H.validateRequest(req({ op }), NONCE), null, op);
  }
  assert.equal(H.validateRequest(req({ id: 'abc', args: undefined }), NONCE), null);
});

// Kills: removing the nonce comparison (or comparing against an empty expected nonce).
test('validateRequest rejects a wrong or missing nonce as forbidden', () => {
  assert.deepEqual(H.validateRequest(req({ nonce: 'nope' }), NONCE), { code: 'forbidden' });
  assert.deepEqual(H.validateRequest(req({ nonce: undefined }), NONCE), { code: 'forbidden' });
  assert.deepEqual(H.validateRequest(req({ nonce: '' }), ''), { code: 'forbidden' });
});

// Kills: an op check by `in`/property lookup (inherited names pass) or no op whitelist at all.
test('validateRequest rejects unknown ops, including inherited property names and phase-2 room ops', () => {
  for (const op of ['nope', 'constructor', '__proto__', 'toString', 'room.create', '', 5]) {
    assert.deepEqual(H.validateRequest(req({ op }), NONCE), { code: 'bad_request' }, String(op));
  }
});

// Kills: accepting a request without an id, or with an id that cannot be echoed back safely.
test('validateRequest rejects a missing or malformed id', () => {
  for (const id of [undefined, null, '', {}, [], 1.5, -1, NaN, 'x'.repeat(65)]) {
    assert.deepEqual(H.validateRequest(req({ id }), NONCE), { code: 'bad_request' }, String(id));
  }
});

// Kills: dereferencing non-objects (throws) or accepting arrays / a wrong envelope key.
test('validateRequest rejects non-objects, arrays, a missing lp envelope and non-object args', () => {
  for (const msg of [null, undefined, 'x', 7, [], [req()]]) {
    assert.deepEqual(H.validateRequest(msg, NONCE), { code: 'bad_request' }, String(msg));
  }
  assert.deepEqual(H.validateRequest(req({ lp: 2 }), NONCE), { code: 'bad_request' });
  assert.deepEqual(H.validateRequest(req({ lp: '1' }), NONCE), { code: 'bad_request' });
  assert.deepEqual(H.validateRequest(req({ args: [1] }), NONCE), { code: 'bad_request' });
  assert.deepEqual(H.validateRequest(req({ args: 'x' }), NONCE), { code: 'bad_request' });
});

// Kills: a missing size check, or one off by more than the 70 000-char boundary.
test('validateRequest rejects args over 70 000 chars as too_large', () => {
  const pad = (n) => ({ data: 'x'.repeat(n - '{"data":""}'.length) });
  assert.equal(JSON.stringify(pad(70000)).length, 70000);
  assert.equal(H.validateRequest(req({ op: 'save', args: pad(70000) }), NONCE), null);
  assert.deepEqual(H.validateRequest(req({ op: 'save', args: pad(70001) }), NONCE), { code: 'too_large' });
});

// Kills: letting JSON.stringify throw out of the validator (cyclic args survive structured clone).
test('validateRequest rejects args that cannot be serialised', () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.deepEqual(H.validateRequest(req({ args: cyclic }), NONCE), { code: 'bad_request' });
});

// --- message handling ---------------------------------------------------------------------------------

// Kills: removing the event.source check (a message from any other window would be answered).
test('host ignores a message from another window and answers the game iframe', async () => {
  const { host, frameWin, replies } = setup();
  const other = { postMessage: () => assert.fail('must not reply to another window') };
  await host.handleMessage({ source: other, data: req() });
  await host.handleMessage({ source: null, data: req() });
  assert.equal(replies.length, 0);
  await host.handleMessage({ source: frameWin, data: req({ id: 9 }) });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].msg.id, 9);
  assert.equal(replies[0].msg.ok, true);
});

// Kills: answering (even with an error) a message whose nonce does not match: that would be an oracle.
test('host stays silent on a wrong nonce or an unanswerable message', async () => {
  const { host, frameWin, replies } = setup();
  for (const data of [req({ nonce: 'guess' }), req({ id: undefined }), null, 'x', req({ lp: 0 })]) {
    await host.handleMessage({ source: frameWin, data });
  }
  assert.equal(replies.length, 0);
});

// Kills: replying to a fixed origin (fails for the opaque sandbox origin) or to a window other than the frame.
test('host replies to the iframe window with target origin * and the reply envelope', async () => {
  const { send } = setup();
  const r = await send('nope', {}, { id: 'q1' });
  assert.equal(r.origin, '*');
  assert.deepEqual(r.msg, { lp: 1, id: 'q1', ok: false, error: { code: 'bad_request', message: r.msg.error.message } });
  assert.equal(typeof r.msg.error.message, 'string');
});

// Kills: a ready() that omits player/game, or invents a challenge.
test('ready returns player, game and challenge (null without one)', async () => {
  assert.deepEqual((await setup().send('ready')).msg.result, { player: PLAYER, game: GAME, challenge: null });
  const r = await setup({ challenge: { level: 'l2', seed: 'abc' } }).send('ready');
  assert.deepEqual(r.msg.result.challenge, { level: 'l2', seed: 'abc' });
});

// Kills: an asset fetch outside base_url, no transfer list, or a fetch for an unsafe path.
test('asset fetches base_url + normalised path and transfers the ArrayBuffer', async () => {
  const { send, calls } = setup({ respond: () => res(200, 'PNG', { json: false }) });
  const r = await send('asset', { path: './art/a.png' });
  assert.equal(calls[0].url, '/plugins/scored/Games/arcade/art/a.png');
  assert.ok(r.msg.result instanceof ArrayBuffer);
  assert.deepEqual(r.transfer, [r.msg.result]);
  assert.equal(new TextDecoder().decode(r.msg.result), 'PNG');

  const bad = await send('asset', { path: '../../../../etc/passwd' });
  assert.equal(bad.msg.error.code, 'bad_request');
  assert.equal(calls.length, 1);
});

// Kills: an asset 404 reported as anything but missing.
test('asset maps a 404 to missing', async () => {
  const { send } = setup({ respond: () => res(404, 'Not found', { json: false }) });
  assert.equal((await send('asset', { path: 'nope.png' })).msg.error.code, 'missing');
});

// Kills: fetching assets with the session cookie or following redirects. Kanboard's web server sends a missing
// non-static file to index.php, whose dashboard (with CSRF tokens) would otherwise reach the game.
test('asset fetches without credentials and refuses redirects', async () => {
  const { send, calls } = setup({ respond: () => res(200, 'x', { json: false }) });
  await send('asset', { path: 'levels/one.json' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
});

// Kills: handing the game the body of a redirected, 3xx or other non-2xx asset response.
test('asset rejects redirected and non-2xx responses as unavailable', async () => {
  const cases = [
    res(200, '<html>dashboard</html>', { json: false, redirected: true }),
    res(302, '', { json: false }),
    res(403, '<html>Forbidden</html>', { json: false }),
    res(500, 'oops', { json: false }),
  ];
  for (const response of cases) {
    const r = await setup({ respond: () => response }).send('asset', { path: 'x.json' });
    assert.equal(r.msg.ok, false, String(response.status));
    assert.equal(r.msg.error.code, 'unavailable', String(response.status));
  }
  const thrown = await setup({ fetch: async () => { throw new TypeError('redirect mode is error'); } }).send('asset', { path: 'x.json' });
  assert.equal(thrown.msg.error.code, 'unavailable');
});

// Kills: an unbounded number of concurrent ops (a game could flood the endpoints).
test('more than 8 in-flight ops reject rate_limited before any fetch', async () => {
  const gates = [];
  const calls = [];
  const fetch = (url) => { calls.push(url); return new Promise((resolve) => gates.push(() => resolve(res(200, 'x', { json: false })))); };
  const { host, frameWin, replies } = setup({ fetch });
  const msg = (id) => ({ source: frameWin, data: { lp: 1, id, nonce: NONCE, op: 'asset', args: { path: 'a.png' } } });
  const running = [];
  for (let id = 1; id <= 8; id++) running.push(host.handleMessage(msg(id)));
  await new Promise((r) => setImmediate(r));
  const ninth = host.handleMessage(msg(9));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 8);
  assert.deepEqual(replies.map((r) => [r.msg.id, r.msg.error && r.msg.error.code]), [[9, 'rate_limited']]);
  gates.shift()();
  await running[0];
  const after = host.handleMessage(msg(10));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 9);
  gates.forEach((g) => g());
  await Promise.all([...running, after, ninth]);
  assert.equal(replies.filter((r) => r.msg.ok).length, 9);
});

// Kills: counting ready, exit and file (which never touch the network) against the in-flight cap, so a game
// with 8 slow asset loads could not even exit.
test('ready, exit and file are answered while 8 network ops are in flight', async () => {
  const gates = [];
  const fetch = () => new Promise((resolve) => gates.push(() => resolve(res(200, 'x', { json: false }))));
  const { host, frameWin, replies, exited } = setup({ fetch });
  const msg = (id, op, args = {}) => ({ source: frameWin, data: { lp: 1, id, nonce: NONCE, op, args } });
  const running = [];
  for (let id = 1; id <= 8; id++) running.push(host.handleMessage(msg(id, 'asset', { path: 'a.png' })));
  await new Promise((r) => setImmediate(r));
  await host.handleMessage(msg(20, 'ready'));
  await host.handleMessage(msg(21, 'file', { id: 'doom1' }));
  await host.handleMessage(msg(22, 'exit'));
  await host.handleMessage(msg(23, 'load'));
  assert.deepEqual(replies.map((r) => [r.msg.id, r.msg.ok, r.msg.error && r.msg.error.code]),
    [[20, true, undefined], [21, false, 'missing'], [22, true, undefined], [23, false, 'rate_limited']]);
  assert.equal(exited(), 1);
  gates.forEach((g) => g());
  await Promise.all(running);
});

// Kills: dropping file() from the whitelist, or inventing a server call for it in phase 1.
test('file rejects missing for any id without a network call', async () => {
  const { send, calls } = setup();
  assert.equal((await send('file', { id: 'doom1.wad' })).msg.error.code, 'missing');
  assert.equal(calls.length, 0);
});

// Kills: posting without csrf_token, as JSON instead of form fields, or without stringifying meta.
test('submitScore POSTs form fields with csrf_token and resolves the server result', async () => {
  const { send, calls } = setup({ respond: () => res(200, { accepted: true, rank: 3, best: 640 }) });
  const r = await send('submitScore', { score: 640, level: 'l1', seed: 's9', meta: { lives: 2 } });
  assert.deepEqual(r.msg.result, { accepted: true, rank: 3, best: 640 });
  assert.equal(calls[0].url, ENDPOINTS.score);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(form(calls[0].init), { slug: 'arcade', score: '640', level: 'l1', seed: 's9', meta: '{"lives":2}', csrf_token: 'tok123' });
});

// Kills: sending empty level/seed/meta fields the server would then validate, when the game gave none.
test('submitScore omits absent optional fields', async () => {
  const { send, calls } = setup({ respond: () => res(200, { accepted: true, rank: 1, best: 5 }) });
  await send('submitScore', { score: 5 });
  assert.deepEqual(form(calls[0].init), { slug: 'arcade', score: '5', csrf_token: 'tok123' });
});

// Kills: posting a score that is not a number (form encoding would turn objects into "[object Object]").
test('submitScore rejects a non-number score before any network call', async () => {
  const { send, calls } = setup();
  for (const score of ['12', null, { n: 1 }, Infinity]) {
    assert.equal((await send('submitScore', { score })).msg.error.code, 'bad_request');
  }
  assert.equal(calls.length, 0);
});

// Kills: an oversized request reaching the network (the size check must run before dispatch).
test('a request over 70 000 chars is rejected too_large before any network call', async () => {
  const { send, calls } = setup();
  const r = await send('save', { data: { blob: 'x'.repeat(70001) } });
  assert.equal(r.msg.error.code, 'too_large');
  assert.equal(calls.length, 0);
});

// Kills: losing the server's error code, or failing to map a non-JSON (Kanboard HTML) error by status.
test('server errors map to SDK codes: JSON body code, else 403 forbidden, else unavailable', async () => {
  const cases = [
    [res(429, { error: { code: 'rate_limited', message: 'Slow down' } }), 'rate_limited', 'Slow down'],
    [res(413, { error: { code: 'too_large', message: 'Too big' } }), 'too_large', 'Too big'],
    [res(403, '<html>Access Forbidden</html>', { json: false }), 'forbidden'],
    [res(500, '<html>oops</html>', { json: false }), 'unavailable'],
    [res(400, { error: { code: 'weird_code', message: 'x' } }), 'unavailable'],
    [res(200, '<html>login page</html>', { json: false }), 'unavailable'],
  ];
  for (const [response, code, message] of cases) {
    const r = await setup({ respond: () => response }).send('submitScore', { score: 1 });
    assert.equal(r.msg.ok, false);
    assert.equal(r.msg.error.code, code);
    if (message) assert.equal(r.msg.error.message, message);
  }
  const down = await setup({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).send('load');
  assert.equal(down.msg.error.code, 'unavailable');
});

// Kills: a leaderboard that ignores period/limit, mangles the query string, or returns the envelope.
test('leaderboard GETs the scores endpoint with period and limit and resolves the rows', async () => {
  const rows = [{ rank: 1, user_id: 2, name: 'Amy', score: 640, level: null, date: 1763500000 }];
  const { send, calls } = setup({ respond: () => res(200, { rows }) });
  const r = await send('leaderboard', { period: 'week', limit: 5 });
  assert.deepEqual(r.msg.result, rows);
  assert.equal(calls[0].url, ENDPOINTS.scores + '&period=week&limit=5');
  assert.equal(calls[0].init.method, 'GET');
  await send('leaderboard', {});
  assert.equal(calls[1].url, ENDPOINTS.scores);
  assert.equal((await send('leaderboard', { period: 'year' })).msg.error.code, 'bad_request');
  assert.equal((await send('leaderboard', { limit: 'all' })).msg.error.code, 'bad_request');
});

// Kills: posting the object itself (or a double-encoded string) as data, or dropping csrf_token.
test('save JSON-stringifies the object and POSTs it as data', async () => {
  const { send, calls } = setup({ respond: () => res(200, { saved: true }) });
  const r = await send('save', { data: { level: 3, items: ['a'] } });
  assert.deepEqual(r.msg.result, { saved: true });
  assert.equal(calls[0].url, ENDPOINTS.save);
  assert.deepEqual(form(calls[0].init), { slug: 'arcade', data: '{"level":3,"items":["a"]}', csrf_token: 'tok123' });
});

// Kills: handing the game the raw text instead of the parsed object, or parsing null into a string.
test('load parses the stored JSON text; null stays null', async () => {
  let stored = '{"level":3}';
  const { send, calls } = setup({ respond: () => res(200, { data: stored }) });
  assert.deepEqual((await send('load')).msg.result, { level: 3 });
  assert.equal(calls[0].url, ENDPOINTS.load);
  stored = null;
  assert.equal((await send('load')).msg.result, null);
});

// Kills: a share link without from, with an unvalidated level/seed, or not written to the clipboard.
test('share builds the challenge link, copies text + link and resolves {url}', async () => {
  const { send, clipboard } = setup();
  const r = await send('share', { level: 'l2', seed: 'abc', text: 'Beat my 640!' });
  const url = SHARE + '&level=l2&seed=abc&from=2';
  assert.deepEqual(r.msg.result, { url });
  assert.deepEqual(clipboard.written, ['Beat my 640! ' + url]);

  const r2 = await send('share', { level: '<b>', seed: 'x'.repeat(65), text: 'Hi' });
  assert.equal(r2.msg.result.url, SHARE + '&from=2');
});

// Kills: copying raw game text: unbounded length, or control characters/newlines into the user's clipboard.
test('share strips control characters and caps the text at 280 chars', async () => {
  const { send, clipboard } = setup();
  const url = SHARE + '&from=2';
  await send('share', { text: 'Beat\nme\r\n\tnow\u0007\u001b[31m!\u2028x' });
  assert.equal(clipboard.written[0], 'Beat me now[31m! x ' + url);
  await send('share', { text: 'a'.repeat(300) });
  assert.equal(clipboard.written[1], 'a'.repeat(280) + ' ' + url);
  await send('share', { text: '\n\u0000' });
  assert.equal(clipboard.written[2], url);
});

// Kills: letting bidi overrides and isolates through, which can make a copied message read differently
// from what it says (Trojan Source style) next to the challenge link.
test('share strips bidi embedding, override and isolate controls', async () => {
  const { send, clipboard } = setup();
  const bidi = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
  await send('share', { text: 'Beat' + bidi.join('') + ' me' });
  assert.equal(clipboard.written[0], 'Beat me ' + SHARE + '&from=2');
});

// Kills: resolving share when the clipboard write failed.
test('share rejects unavailable when the clipboard write fails', async () => {
  const clipboard = { writeText: () => Promise.reject(new Error('denied')) };
  assert.equal((await setup({ clipboard }).send('share', { text: 'x' })).msg.error.code, 'unavailable');
  assert.equal((await setup({ clipboard: {} }).send('share', { text: 'x' })).msg.error.code, 'unavailable');
});

// Kills: an exit op that does not close the overlay or never answers.
test('exit replies ok and calls onExit', async () => {
  const s = setup();
  const r = await s.send('exit');
  assert.equal(r.msg.ok, true);
  assert.equal(s.exited(), 1);
});

// --- page glue: overlay and row navigation -------------------------------------------------------------

// A tiny fake DOM: elements with attributes, children, listeners and focus.
function fakeDom() {
  const doc = {
    activeElement: null, listeners: {},
    createElement(tag) { return node(tag, doc); },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
  };
  const win = {
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i; return a; } },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => res(200, {}),
  };
  return { doc, win };
}
function node(tag, doc) {
  const n = {
    tagName: tag.toUpperCase(), attrs: {}, children: [], parentNode: null, listeners: {}, textContent: '', className: '',
    dataset: {}, contentWindow: tag === 'iframe' ? { postMessage() {} } : undefined,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    fire(t, ev = {}) { (this.listeners[t] || []).forEach((fn) => fn(ev)); },
    focus() { doc.activeElement = this; },
    closest(sel) { let p = this; while (p) { if (p.matches && p.matches(sel)) return p; p = p.parentNode; } return null; },
    matches(sel) { return sel.startsWith('.') && (' ' + this.className + ' ').includes(' ' + sel.slice(1) + ' '); },
    querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; } return null; },
  };
  Object.defineProperty(n, 'innerHTML', { set() { throw new Error('innerHTML must not be assigned'); } });
  return n;
}
function playButton(doc, extra = {}) {
  const root = node('div', doc); root.className = 'lp-launcher';
  const b = node('button', doc); b.className = 'lp-button lp-play';
  Object.assign(b.dataset, {
    lpSlug: 'arcade', lpSrc: '/plugins/scored/Games/arcade/index.html', lpCsrf: 'tok123',
    lpEndpoints: JSON.stringify(ENDPOINTS), lpBase: '/plugins/scored/Games/arcade/', lpGame: JSON.stringify(GAME),
    lpPlayer: JSON.stringify(PLAYER), lpShare: SHARE, ...extra,
  });
  root.appendChild(b);
  return { root, b };
}
const find = (n, pred) => { if (pred(n)) return n; for (const c of n.children) { const f = find(c, pred); if (f) return f; } return null; };

// Kills: adding allow-same-origin (or any other token) to the sandbox, a nonce outside the fragment, or a
// missing allow="fullscreen; gamepad".
test('openGame builds the sandboxed iframe with the nonce in the fragment', () => {
  const { doc, win } = fakeDom();
  const { root, b } = playButton(doc);
  H.openGame(b, doc, win);
  const iframe = find(root, (n) => n.tagName === 'IFRAME');
  assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(iframe.getAttribute('allow'), 'fullscreen; gamepad');
  assert.equal(iframe.getAttribute('src'), '/plugins/scored/Games/arcade/index.html#lp=000102030405060708090a0b0c0d0e0f');
  assert.equal(win.listeners.message.length, 1);
  const bar = find(root, (n) => n.className === 'lp-overlay-title');
  assert.equal(bar.textContent, 'Arcade');
});

// Kills: Esc closing the overlay, Exit not closing it, focus not returning to Play, or a leaked listener.
test('Esc does not close the overlay; Exit does, returns focus and removes the message listener', () => {
  const { doc, win } = fakeDom();
  const { root, b } = playButton(doc);
  H.openGame(b, doc, win);
  const overlay = find(root, (n) => n.className === 'lp-overlay');
  (doc.listeners.keydown || []).forEach((fn) => fn({ key: 'Escape', preventDefault() {} }));
  overlay.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.ok(find(root, (n) => n.className === 'lp-overlay'), 'overlay survives Esc');
  find(root, (n) => n.className.includes('lp-overlay-exit')).fire('click', {});
  assert.equal(find(root, (n) => n.className === 'lp-overlay'), null);
  assert.equal(doc.activeElement, b);
  assert.equal(win.listeners.message.length, 0);
});

// Kills: a second overlay stacked on the first when Play is pressed twice.
test('openGame does nothing while a game is already open', () => {
  const { doc, win } = fakeDom();
  const { root, b } = playButton(doc);
  H.openGame(b, doc, win);
  H.openGame(b, doc, win);
  assert.equal(root.children.filter((n) => n.className === 'lp-overlay').length, 1);
  assert.equal(win.listeners.message.length, 1);
});

// Kills: dropping the challenge attributes on the way into ready().
test('openGame passes the challenge from data-lp-level / data-lp-seed to ready()', async () => {
  const { doc, win } = fakeDom();
  const { root, b } = playButton(doc, { lpLevel: 'l2', lpSeed: 'abc' });
  H.openGame(b, doc, win);
  const iframe = find(root, (n) => n.tagName === 'IFRAME');
  const replies = [];
  iframe.contentWindow.postMessage = (msg) => replies.push(msg);
  const nonce = iframe.getAttribute('src').split('#lp=')[1];
  await win.listeners.message[0]({ source: iframe.contentWindow, data: { lp: 1, id: 1, nonce, op: 'ready', args: {} } });
  assert.deepEqual(replies[0].result, { player: PLAYER, game: GAME, challenge: { level: 'l2', seed: 'abc' } });
});

// Kills: arrow keys that ignore the row, wrap around, or move on other keys.
test('rowNeighbour moves focus along a row with Left/Right only', () => {
  const { doc } = fakeDom();
  const strip = node('div', doc); strip.className = 'lp-row-strip';
  const cards = [0, 1, 2].map(() => { const c = node('a', doc); c.className = 'lp-card'; strip.appendChild(c); return c; });
  assert.equal(H.rowNeighbour(cards[1], 'ArrowRight'), cards[2]);
  assert.equal(H.rowNeighbour(cards[1], 'ArrowLeft'), cards[0]);
  assert.equal(H.rowNeighbour(cards[0], 'ArrowLeft'), null);
  assert.equal(H.rowNeighbour(cards[2], 'ArrowRight'), null);
  assert.equal(H.rowNeighbour(cards[1], 'ArrowDown'), null);
  const loose = node('a', doc); loose.className = 'lp-card';
  assert.equal(H.rowNeighbour(loose, 'ArrowRight'), null);
});

// Kills: a focus trap that lets Tab / Shift+Tab leave the overlay at either end, or hijacks Tab mid-cycle.
test('focusTrapTarget wraps Tab and Shift+Tab within the overlay items', () => {
  const [a, b, c] = ['fullscreen', 'exit', 'iframe'].map((name) => ({ name }));
  const items = [a, b, c];
  assert.equal(H.focusTrapTarget(items, c, false), a);
  assert.equal(H.focusTrapTarget(items, a, true), c);
  assert.equal(H.focusTrapTarget(items, a, false), null);
  assert.equal(H.focusTrapTarget(items, b, true), null);
  assert.equal(H.focusTrapTarget(items, { name: 'body' }, false), a);
  assert.equal(H.focusTrapTarget(items, null, true), c);
});

// Kills: an overlay that never wires the trap, or lets focus escape to the page behind it.
test('the open overlay traps Tab and pulls stray focus back in; closing releases it', () => {
  const { doc, win } = fakeDom();
  const { root, b } = playButton(doc);
  H.openGame(b, doc, win);
  const overlay = find(root, (n) => n.className === 'lp-overlay');
  const iframe = find(root, (n) => n.tagName === 'IFRAME');
  const full = find(root, (n) => n.className.includes('lp-overlay-fullscreen'));
  let prevented = 0;
  doc.activeElement = iframe;
  overlay.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, full);
  overlay.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, iframe);
  assert.equal(prevented, 2);

  const outside = node('a', doc);
  root.appendChild(outside);
  (doc.listeners.focusin || []).forEach((fn) => fn({ target: outside }));
  assert.equal(doc.activeElement, full);

  find(root, (n) => n.className.includes('lp-overlay-exit')).fire('click', {});
  assert.equal((doc.listeners.focusin || []).length, 0);
});
