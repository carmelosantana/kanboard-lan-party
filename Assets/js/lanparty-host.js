/*
 * LAN Party host bridge (launcher page side). Plain ES2017, no dependencies, CSP-clean.
 *
 * Play opens a full-viewport overlay holding <iframe sandbox="allow-scripts"> (opaque origin: never
 * allow-same-origin). The game talks to this page only through postMessage:
 *   request  {lp: 1, id, nonce, op, args}
 *   reply    {lp: 1, id, ok: true, result} | {lp: 1, id, ok: false, error: {code, message}}
 * A message is answered only when it comes from the game's iframe window and carries the nonce this page put
 * in the iframe's URL fragment (#lp=<nonce>). The game never sees the CSRF token or the session.
 */
(function () {
  'use strict';

  var OPS = ['ready', 'asset', 'file', 'submitScore', 'leaderboard', 'save', 'load', 'share', 'exit'];
  var CODES = ['bad_request', 'forbidden', 'missing', 'rate_limited', 'too_large', 'unavailable'];
  var MESSAGES = {
    bad_request: 'Bad request',
    forbidden: 'Forbidden',
    missing: 'Not found',
    rate_limited: 'Too many requests',
    too_large: 'Request too large',
    unavailable: 'Service unavailable'
  };
  var MAX_ARGS = 70000;
  var MAX_PATH = 512;
  // Same list as GameRegistry::BANNED_FILE (a PHP test keeps them identical): executed or refused by the server.
  var BANNED_FILE = /\.(php\d?|phtml|phar|phps|log|sqlite)$/i;
  var MAX_IN_FLIGHT = 8;
  var LOCAL_OPS = ['ready', 'exit', 'file']; // never touch the network, so the in-flight cap leaves them alone
  var MAX_SHARE_TEXT = 280;
  var LEVEL_RE = /^[A-Za-z0-9_.-]{0,32}$/;
  var SEED_RE = /^[A-Za-z0-9_.-]{0,64}$/;

  function isObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function validId(id) {
    return (typeof id === 'string' && id.length > 0 && id.length <= 64) ||
      (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0);
  }

  function fail(code, message) {
    return { code: code, message: message || MESSAGES[code] };
  }

  function asError(e) {
    return isObject(e) && CODES.indexOf(e.code) !== -1 ? fail(e.code, typeof e.message === 'string' ? e.message : '') : fail('unavailable');
  }

  /**
   * A relative path inside the game folder, normalised ("./x.js" -> "x.js"), or null when unsafe: "..",
   * absolute paths, schemes (any ":"), backslashes, percent-encoding (WHATWG URLs read "%2e%2e" as ".."),
   * query/fragment, whitespace and control characters, empty segments and BANNED_FILE names (`.php` would
   * execute) are all refused.
   */
  function normalizeAssetPath(path) {
    if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH) return null;
    if (/[\\%?#:\s\u0000-\u001f\u007f]/.test(path) || path.charAt(0) === '/' || BANNED_FILE.test(path)) return null;
    var out = [];
    var parts = path.split('/');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '.') continue;
      if (parts[i] === '' || parts[i] === '..') return null;
      out.push(parts[i]);
    }
    return out.length ? out.join('/') : null;
  }

  /** null when the request is well-formed for this nonce, else {code}. */
  function validateRequest(msg, expectedNonce) {
    if (!isObject(msg) || msg.lp !== 1 || !validId(msg.id)) return { code: 'bad_request' };
    if (typeof expectedNonce !== 'string' || expectedNonce === '' || msg.nonce !== expectedNonce) return { code: 'forbidden' };
    if (OPS.indexOf(msg.op) === -1) return { code: 'bad_request' };
    if (msg.args !== undefined && !isObject(msg.args)) return { code: 'bad_request' };
    var json;
    try {
      json = JSON.stringify(msg.args === undefined ? {} : msg.args);
    } catch (e) {
      return { code: 'bad_request' };
    }
    return json.length > MAX_ARGS ? { code: 'too_large' } : null;
  }

  // Only a message from the right window, with the right nonce and an id to echo, gets any reply at all.
  function answerable(msg, nonce) {
    return isObject(msg) && msg.lp === 1 && validId(msg.id) && typeof nonce === 'string' && nonce !== '' && msg.nonce === nonce;
  }

  function withQuery(url, params) {
    var qs = new URLSearchParams(params).toString();
    return qs === '' ? url : url + (url.indexOf('?') === -1 ? '?' : '&') + qs;
  }

  // Game text for the clipboard: line breaks and tabs become spaces, other control characters and bidi
  // embeddings, overrides and isolates go, max 280 chars.
  function shareText(text) {
    return (text || '')
      .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
      .slice(0, MAX_SHARE_TEXT)
      .trim();
  }

  function optionalString(v) {
    return v === undefined || v === null || typeof v === 'string';
  }

  /**
   * The message handler for one open game. o: {iframe, nonce, endpoints: {score, scores, save, load}, csrf,
   * base, game: {slug, title, version}, player: {id, name, avatar_url}, challenge: {level, seed}|null,
   * share (game page URL), fetch, clipboard, onExit}.
   */
  function createHost(o) {
    function request(url, init) {
      return Promise.resolve()
        .then(function () { return o.fetch(url, init); })
        .then(null, function () { throw fail('unavailable'); });
    }

    // Every JSON endpoint: server {error: {code, message}} passes through; a non-JSON error (Kanboard's HTML
    // 403 page for a missing CSRF token, a proxy 5xx) maps by status. A redirect is an expired session bounced
    // to the login page: forbidden.
    function json(url, init) {
      return request(url, init).then(function (res) {
        if (res.redirected) throw fail('forbidden');
        return res.text().then(function (text) {
          var body;
          try { body = JSON.parse(text); } catch (e) { body = undefined; }
          if (!res.ok) {
            var err = isObject(body) && isObject(body.error) ? body.error : null;
            if (err && CODES.indexOf(err.code) !== -1) throw fail(err.code, typeof err.message === 'string' ? err.message : '');
            throw fail(res.status === 403 ? 'forbidden' : 'unavailable');
          }
          if (!isObject(body)) throw fail('unavailable');
          return body;
        });
      });
    }

    function get(url) {
      return json(url, { method: 'GET', credentials: 'same-origin' });
    }

    function post(url, fields) {
      var body = new URLSearchParams();
      Object.keys(fields).forEach(function (k) {
        if (fields[k] !== undefined && fields[k] !== null) body.append(k, String(fields[k]));
      });
      body.append('csrf_token', o.csrf);
      return json(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
    }

    var ops = {
      ready: function () {
        return { player: o.player, game: o.game, challenge: o.challenge || null };
      },
      // No cookie and no redirects: Kanboard's web server hands a missing non-static file to index.php, and the
      // signed-in dashboard (CSRF tokens included) must never reach the game.
      asset: function (a) {
        var path = normalizeAssetPath(a.path);
        if (path === null) throw fail('bad_request', 'Unsafe asset path');
        return request(o.base + path, { method: 'GET', credentials: 'omit', redirect: 'error' }).then(function (res) {
          if (res.redirected || !res.ok) throw fail(res.status === 404 && !res.redirected ? 'missing' : 'unavailable');
          return res.arrayBuffer();
        });
      },
      file: function (a) {
        if (typeof a.id !== 'string') throw fail('bad_request');
        throw fail('missing', 'No file in slot ' + a.id); // phase 1: no admin file slots are served
      },
      submitScore: function (a) {
        if (typeof a.score !== 'number' || !isFinite(a.score) || !optionalString(a.level) || !optionalString(a.seed)) {
          throw fail('bad_request');
        }
        return post(o.endpoints.score, {
          slug: o.game.slug,
          score: a.score,
          level: a.level,
          seed: a.seed,
          meta: a.meta === undefined ? undefined : JSON.stringify(a.meta)
        });
      },
      leaderboard: function (a) {
        var params = {};
        if (a.period !== undefined) {
          if (a.period !== 'all' && a.period !== 'week') throw fail('bad_request');
          params.period = a.period;
        }
        if (a.limit !== undefined) {
          if (!Number.isInteger(a.limit) || a.limit < 1) throw fail('bad_request');
          params.limit = a.limit;
        }
        return get(withQuery(o.endpoints.scores, params)).then(function (body) {
          if (!Array.isArray(body.rows)) throw fail('unavailable');
          return body.rows;
        });
      },
      save: function (a) {
        var data = JSON.stringify(a.data);
        if (data === undefined) throw fail('bad_request');
        return post(o.endpoints.save, { slug: o.game.slug, data: data });
      },
      load: function () {
        return get(o.endpoints.load).then(function (body) {
          if (body.data === null || body.data === undefined) return null;
          if (typeof body.data !== 'string') throw fail('unavailable');
          try { return JSON.parse(body.data); } catch (e) { throw fail('unavailable'); }
        });
      },
      share: function (a) {
        if (!optionalString(a.text)) throw fail('bad_request');
        var params = {};
        if (typeof a.level === 'string' && a.level !== '' && LEVEL_RE.test(a.level)) params.level = a.level;
        if (typeof a.seed === 'string' && a.seed !== '' && SEED_RE.test(a.seed)) params.seed = a.seed;
        params.from = o.player.id;
        // A relative link (no application_url set) resolves on the page's own origin so others can open it.
        var url = withQuery(o.pageUrl ? new URL(o.share, o.pageUrl).href : o.share, params);
        var clean = shareText(a.text);
        var text = clean ? clean + ' ' + url : url;
        if (!o.clipboard || typeof o.clipboard.writeText !== 'function') throw fail('unavailable', 'Clipboard unavailable');
        return Promise.resolve()
          .then(function () { return o.clipboard.writeText(text); })
          .then(function () { return { url: url }; }, function () { throw fail('unavailable', 'Clipboard write failed'); });
      },
      exit: function () {
        return null;
      }
    };

    function send(target, reply, transfer) {
      try {
        target.postMessage(reply, '*', transfer || []);
      } catch (e) {
        // The frame went away (exit, navigation): nothing to answer.
      }
    }

    var inFlight = 0;

    return {
      handleMessage: function (event) {
        var target = o.iframe.contentWindow;
        if (!event || !target || event.source !== target) return Promise.resolve();
        var msg = event.data;
        if (!answerable(msg, o.nonce)) return Promise.resolve();
        var bad = validateRequest(msg, o.nonce);
        var counted = LOCAL_OPS.indexOf(msg.op) === -1;
        if (!bad && counted && inFlight >= MAX_IN_FLIGHT) bad = { code: 'rate_limited' };
        var run;
        if (bad) {
          run = Promise.reject(fail(bad.code));
        } else {
          var step = counted ? 1 : 0;
          inFlight += step;
          run = Promise.resolve()
            .then(function () { return ops[msg.op](msg.args === undefined ? {} : msg.args); })
            .then(function (r) { inFlight -= step; return r; }, function (e) { inFlight -= step; throw e; });
        }
        return run.then(function (result) {
          // The frame's origin is opaque, so '*' is required; the target window is fixed.
          send(target, { lp: 1, id: msg.id, ok: true, result: result }, result instanceof ArrayBuffer ? [result] : []);
          if (msg.op === 'exit' && typeof o.onExit === 'function') o.onExit();
        }, function (e) {
          send(target, { lp: 1, id: msg.id, ok: false, error: asError(e) });
        });
      }
    };
  }

  /**
   * Where Tab (or Shift+Tab) should send focus to stay inside the overlay: wraps at either end and pulls in focus
   * that is outside the items; null when the browser's own move stays inside.
   */
  function focusTrapTarget(items, active, backwards) {
    var i = items.indexOf(active);
    if (i === -1) return backwards ? items[items.length - 1] : items[0];
    if (backwards && i === 0) return items[items.length - 1];
    if (!backwards && i === items.length - 1) return items[0];
    return null;
  }

  function parse(json, fallback) {
    try { return JSON.parse(json); } catch (e) { return fallback; }
  }

  function el(doc, tag, className, text) {
    var n = doc.createElement(tag);
    n.className = className;
    if (text) n.textContent = text;
    return n;
  }

  /** Opens the Play overlay for a .lp-play button; returns nothing when a game is already open. */
  function openGame(button, doc, win) {
    var root = button.closest('.lp-launcher') || doc.body;
    if (root.querySelector('.lp-overlay')) return;
    var d = button.dataset;
    var game = parse(d.lpGame, null) || { slug: d.lpSlug, title: d.lpSlug, version: '' };
    var bytes = win.crypto.getRandomValues(new Uint8Array(16));
    var nonce = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');

    var overlay = el(doc, 'div', 'lp-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', game.title);
    var bar = el(doc, 'div', 'lp-overlay-bar');
    var fullscreen = el(doc, 'button', 'lp-button lp-overlay-fullscreen', 'Fullscreen');
    var exit = el(doc, 'button', 'lp-button lp-overlay-exit', 'Exit');
    fullscreen.setAttribute('type', 'button');
    exit.setAttribute('type', 'button');
    bar.appendChild(el(doc, 'span', 'lp-overlay-title', game.title));
    bar.appendChild(fullscreen);
    bar.appendChild(exit);

    var iframe = el(doc, 'iframe', 'lp-overlay-frame');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('allow', 'fullscreen; gamepad');
    iframe.setAttribute('title', game.title);
    iframe.setAttribute('src', d.lpSrc + '#lp=' + nonce);
    overlay.appendChild(bar);
    overlay.appendChild(iframe);

    var host = createHost({
      iframe: iframe,
      nonce: nonce,
      endpoints: parse(d.lpEndpoints, {}),
      csrf: d.lpCsrf,
      base: d.lpBase,
      game: game,
      player: parse(d.lpPlayer, null),
      challenge: d.lpLevel !== undefined && d.lpSeed !== undefined ? { level: d.lpLevel, seed: d.lpSeed } : null,
      share: d.lpShare,
      pageUrl: win.location && win.location.href,
      fetch: win.fetch.bind(win),
      clipboard: win.navigator && win.navigator.clipboard,
      onExit: close
    });
    function onMessage(event) { return host.handleMessage(event); }

    var trapItems = [fullscreen, exit, iframe];
    function onTab(e) {
      if (e.key !== 'Tab') return;
      var next = focusTrapTarget(trapItems, doc.activeElement, e.shiftKey);
      if (!next) return;
      e.preventDefault();
      next.focus();
    }
    // Tabbing out of the iframe never reaches the overlay's keydown, so focus that lands behind it is pulled back.
    function onFocusIn(e) {
      if (!e.target || !e.target.closest || e.target.closest('.lp-overlay') !== overlay) fullscreen.focus();
    }

    function close() {
      win.removeEventListener('message', onMessage);
      doc.removeEventListener('focusin', onFocusIn);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      button.focus();
    }

    // Esc is deliberately not bound: games use it. Only Exit (or the game's exit()) closes the overlay.
    exit.addEventListener('click', close);
    fullscreen.addEventListener('click', function () {
      if (typeof overlay.requestFullscreen === 'function') overlay.requestFullscreen().catch(function () {});
    });
    overlay.addEventListener('keydown', onTab);
    doc.addEventListener('focusin', onFocusIn);
    win.addEventListener('message', onMessage);
    root.appendChild(overlay);
    iframe.focus();
  }

  /** The card Left/Right moves to within its own row, or null (row edge, other key, card outside a row). */
  function rowNeighbour(card, key) {
    var step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    var strip = step && card.parentNode && card.parentNode.matches && card.parentNode.matches('.lp-row-strip') ? card.parentNode : null;
    if (!strip) return null;
    var cards = Array.prototype.filter.call(strip.children, function (c) { return c.matches('.lp-card'); });
    return cards[cards.indexOf(card) + step] || null;
  }

  function init(doc, win) {
    doc.addEventListener('click', function (e) {
      var button = e.target && e.target.closest ? e.target.closest('.lp-launcher .lp-play') : null;
      if (!button) return;
      e.preventDefault();
      openGame(button, doc, win);
    });
    doc.addEventListener('keydown', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.lp-launcher .lp-card') : null;
      var next = card ? rowNeighbour(card, e.key) : null;
      if (!next) return;
      e.preventDefault();
      next.focus();
    });
  }

  var api = {
    normalizeAssetPath: normalizeAssetPath,
    validateRequest: validateRequest,
    createHost: createHost,
    openGame: openGame,
    rowNeighbour: rowNeighbour,
    focusTrapTarget: focusTrapTarget,
    init: init
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.LanPartyHost = api;
    init(document, window);
  }
}());
