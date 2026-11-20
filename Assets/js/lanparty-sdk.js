/*
 * LAN Party game SDK (inside the sandboxed game iframe). Plain ES2017, no dependencies.
 *
 * Load it as the game page's FIRST script: <script src="../../../LanParty/Assets/js/lanparty-sdk.js?v=<version>">
 * </script>, then use the global `LanParty`. Opened outside the launcher's sandboxed iframe it stops the page and
 * throws. Every call returns a Promise; rejections are {code, message} with code one of bad_request,
 * forbidden, missing, rate_limited, too_large, unavailable.
 *
 *   ready()                               -> {player: {id, name, avatar_url}, game: {slug, title, version},
 *                                             challenge: {level, seed} | null}   (call it first)
 *   asset(path)                           -> ArrayBuffer of a file inside the game folder
 *   file(id)                              -> ArrayBuffer of an admin file slot (phase 1: rejects missing)
 *   submitScore({score, level?, seed?, meta?}) -> {accepted, rank, best}
 *   leaderboard({period?: 'all'|'week', limit?}) -> [{rank, user_id, name, score, level, date}]
 *   save(obj) / load()                    -> {saved: true} / the saved object or null
 *   share({level?, seed?, text})          -> {url}  (the launcher copies text + challenge link)
 *   exit()                                -> closes the game
 *
 * Transport: parent.postMessage({lp: 1, id, nonce, op, args}, '*'); the nonce comes from the iframe URL
 * fragment (#lp=<nonce>), and only replies from `parent` with lp === 1 and a pending id are accepted.
 */
(function () {
  'use strict';

  var CODES = ['bad_request', 'forbidden', 'missing', 'rate_limited', 'too_large', 'unavailable'];

  function isObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function fail(code, message) {
    return { code: code, message: message };
  }

  function asError(e) {
    return isObject(e) && CODES.indexOf(e.code) !== -1
      ? fail(e.code, typeof e.message === 'string' ? e.message : e.code)
      : fail('unavailable', 'Unexpected reply from LAN Party');
  }

  // Only the named keys that are present: the host sees exactly what the game passed.
  function pick(o, keys) {
    var out = {};
    keys.forEach(function (k) { if (o[k] !== undefined) out[k] = o[k]; });
    return out;
  }

  /** opts: {post(msg), nonce}. Returns {call(op, args), receive(data), api}. */
  function createClient(opts) {
    var nextId = 1;
    var pending = new Map();

    function call(op, args) {
      return new Promise(function (resolve, reject) {
        if (typeof opts.nonce !== 'string' || opts.nonce === '' || typeof opts.post !== 'function') {
          reject(fail('unavailable', 'Not running inside LAN Party'));
          return;
        }
        var id = nextId++;
        pending.set(id, { resolve: resolve, reject: reject });
        try {
          opts.post({ lp: 1, id: id, nonce: opts.nonce, op: op, args: args });
        } catch (e) {
          pending.delete(id);
          reject(fail('bad_request', 'Arguments cannot be sent to LAN Party'));
        }
      });
    }

    function receive(data) {
      if (!isObject(data) || data.lp !== 1 || !pending.has(data.id)) return;
      var p = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok === true) p.resolve(data.result);
      else p.reject(asError(data.error));
    }

    // An options object is required where the call takes one; anything else rejects instead of throwing.
    function withObject(op, keys, o, optional) {
      if (o === undefined && optional) o = {};
      return isObject(o) ? call(op, pick(o, keys)) : Promise.reject(fail('bad_request', op + ' expects an object'));
    }

    var api = {
      ready: function () { return call('ready', {}); },
      asset: function (path) { return call('asset', { path: path }); },
      file: function (id) { return call('file', { id: id }); },
      submitScore: function (o) { return withObject('submitScore', ['score', 'level', 'seed', 'meta'], o, false); },
      leaderboard: function (o) { return withObject('leaderboard', ['period', 'limit'], o, true); },
      save: function (obj) { return call('save', { data: obj }); },
      load: function () { return call('load', {}); },
      share: function (o) { return withObject('share', ['level', 'seed', 'text'], o, false); },
      exit: function () { return call('exit', {}); }
    };

    return { call: call, receive: receive, api: api };
  }

  var REFUSED = 'Open this game from LAN Party';

  /**
   * Opened top-level (a new tab, a direct URL) or framed without the sandbox, the game would run with the
   * Kanboard origin and the player's session: stop the page loading, replace it with a notice and throw, so
   * neither the SDK nor any later script of the game runs. That is why the SDK must be the game's first script.
   */
  function refuseUnsandboxed(win) {
    if (win.origin === 'null' && win.parent && win.parent !== win) return;
    if (typeof win.stop === 'function') win.stop();
    var doc = win.document;
    var root = doc && (doc.body || doc.documentElement);
    if (root) root.textContent = REFUSED;
    throw new Error('LAN Party: the game was opened outside the launcher');
  }

  /** Wires the SDK to a window: nonce from #lp=, posts to parent, replies only from parent. */
  function install(win) {
    refuseUnsandboxed(win);
    var match = /(?:^#|&)lp=([^&]*)/.exec((win.location && win.location.hash) || '');
    var parent = win.parent && win.parent !== win ? win.parent : null;
    var client = createClient({
      nonce: match ? match[1] : '',
      post: parent ? function (msg) { parent.postMessage(msg, '*'); } : null
    });
    win.addEventListener('message', function (event) {
      if (parent && event.source === parent) client.receive(event.data);
    });
    win.LanParty = Object.freeze(client.api);
    return win.LanParty;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createClient: createClient, install: install };
  } else {
    install(window);
  }
}());
