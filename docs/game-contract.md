# LAN Party game contract (v1)

This is the contract between LAN Party and a game. It describes the plugin as built (0.1.0) and is frozen for
v1: a game that follows it keeps working across 0.x releases. The sample game in `Games/pop` follows every rule
here and is the easiest place to start.

A game is a folder of static files. LAN Party lists it on the launcher, opens it in a sandboxed iframe, and
gives it one way to talk to the page: the `LanParty` object from `lanparty-sdk.js`.

## Folder

```
<Plugin>/Games/<slug>/
  game.json        the manifest (below)
  index.html       the entry page (any relative path, named by `entry`)
  cover.svg        card art, 2:3 portrait (svg, png or jpg)
  hero.svg         banner art, 21:9 (optional; the cover is used when it is missing)
  …                scripts, styles, levels, sounds: anything else the game needs
```

The registry rejects (and logs) a game whose folder breaks any of these rules:

| Rule | Why |
|---|---|
| The folder sits at `<Plugin>/Games/<slug>` inside Kanboard's `plugins/` folder (after resolving `..`), its name equals the manifest `slug`, and `<Plugin>` is letters, digits and `_` only. | The launcher serves it at `plugins/<Plugin>/Games/<slug>/`: the folder checked is the folder served. |
| No path segment starts with `data` (any case), including the slug folder itself: no `data/`, `database.json`, `Datasets/`. | Kanboard's stock nginx rule `location ~ /data` answers 404 for any URL containing `/data`. |
| No file name matches `\.(php\d?\|phtml\|phar\|phps\|log\|sqlite)$`, any case: `.php`, `.php5`, `.phtml`, `.phar`, `.phps`, `.log`, `.sqlite`. | PHP handlers execute or print the first five; the web server refuses the others. `asset()` refuses the same list. |
| No dot-files or dot-folders (`.htaccess`, `.git/`). | A game's own `.htaccess` could switch PHP on, or the sandbox header off. |
| No symlinks. | Nothing may point outside the folder. |

Paths a game names (`entry`, `art.cover`, `art.hero`, and every `asset()` path) are relative to the game folder
and may not contain a `..` segment or start with `/`. A backslash `\` is refused anywhere in the path, not only at
the start (browsers read it as `/`), and so are `:`, `%`, `?` and `#`. Keep file names to letters, digits, `-`,
`_` and `.`.

## Manifest `game.json`

```json
{
  "slug": "pop",
  "title": "Pop",
  "tagline": "Thirty seconds. Pop every bubble you can.",
  "version": "0.1.0",
  "kind": "original",
  "licence": "MIT",
  "content_licence": "CC-BY-4.0",
  "entry": "index.html",
  "art": { "cover": "cover.svg", "hero": "hero.svg" },
  "players": { "min": 1, "max": 1 },
  "modes": ["solo", "async"],
  "scoring": { "order": "high", "unit": "pops", "max": 100000 },
  "files": []
}
```

| Field | Rule |
|---|---|
| `slug` | Required. `^[a-z][a-z0-9-]{1,31}$`, equal to the folder name, unique across all registered games (the first registration wins; later duplicates are skipped and logged). |
| `title` | Required, at most 40 characters. |
| `tagline` | Optional, at most 80 characters. |
| `version` | Required string. Shown to the game by `ready()`. |
| `kind` | `original` or `engine`. |
| `licence`, `content_licence` | Required SPDX ids for the code and the art/content; the game page shows both. |
| `entry` | Required relative path of the page to open. |
| `art.cover` | Required relative path. `art.hero` is optional. Art carries no text: the launcher draws the title over the card and the title and tagline over the hero, so a baked-in wordmark shows twice. |
| `players.min`, `players.max` | Integers with 1 ≤ min ≤ max ≤ 16. |
| `modes` | Non-empty list drawn from `solo`, `async`, `realtime`. |
| `scoring` | Optional; a game without it has no leaderboard and `submitScore()` rejects `unavailable`. `order` is `high` or `low`; `unit` is a label of at most 12 characters; `max` is an integer ≥ 1; `min_seconds` (optional, 0 to 86400) is the shortest plausible run, and a score sent sooner after the run began is rejected `bad_request`. |
| `files` | Optional list of admin-supplied file slots `{ "id", "label", "accept": [".wad"], "required": true }` (`id` follows the slug pattern). Originals use `[]`. |

The registry adds `plugin` (the owning plugin) and `base_url` (`plugins/<Plugin>/Games/<slug>/`); anything the
manifest sets under those names is ignored. A game listed in the config key `lanparty_disabled` (a CSV of
slugs) is hidden from players.

## Registration

LAN Party registers its own `Games/*` folders. Any other plugin adds its games in `initialize()`:

```php
$this->container['lanpartyGames'] = array_merge(
    $this->container['lanpartyGames'] ?? [],
    [['plugin' => 'MyGames', 'path' => __DIR__.'/Games/snake']]
);
```

LAN Party's own folder must be named exactly `LanParty`: every game loads the SDK from
`../../../LanParty/Assets/js/lanparty-sdk.js`.

## Where the game runs

The game page opens in `<iframe sandbox="allow-scripts">`. Its origin is opaque, which means:

- It has no cookies, no Kanboard session and no CSRF token, and it cannot read the launcher page.
- `localStorage`, `sessionStorage` and IndexedDB are unavailable; use `save()` / `load()`.
- `fetch()` or XHR of its own files fails; read data files with `asset()`. Plain `<script src>`,
  `<link rel="stylesheet">` and `<img src>` with relative URLs load as usual.
- It cannot open pop-ups, navigate the top page or write to the clipboard; `share()` and `exit()` do those.

**The frame is not network-isolated.** The sandbox keeps the game away from cookies and the launcher page, but it
does not block outbound requests: a game's script can still send anything it has to any host. Treat everything a
game receives as something that can leave the browser: the player's name and id from `ready()`, and the names on
`leaderboard()` rows (a user with no display name appears under their username). Only install games you trust
with that.

Opened outside the launcher (a game URL in a new tab), the SDK stops the page and replaces it with "Open this
game from LAN Party"; on Apache, `Games/.htaccess` also serves every game file with
`Content-Security-Policy: sandbox allow-scripts` (the README has the nginx equivalent). Keep scripts in files
(no inline `<script>` blocks, no `onclick=` attributes) and make no requests to other hosts, so a game keeps
working under that header and any stricter policy.

## SDK

Load it with a classic script tag as the **first** `<script>` of the entry page, before any of your own code:

```html
<script src="../../../LanParty/Assets/js/lanparty-sdk.js?v=0.1.0"></script>
```

The SDK checks that it runs in the launcher's sandboxed iframe and, when it does not, stops the page before any
later script runs. A script placed ahead of it would run unchecked, with the Kanboard origin, if the page were
opened directly.

Add `?v=<version>` to every script and stylesheet URL in your game's HTML: the LAN Party version for the SDK,
your game's `version` for your own files, bumped on every release. Kanboard's stock nginx config caches `.js`
and `.css` for 7 days, so an unversioned URL can serve last release's file after an upgrade.

It defines a global `LanParty`. Every call returns a Promise. Call `ready()` first.

| Call | Resolves to | Notes |
|---|---|---|
| `ready()` | `{ player: {id, name, avatar_url}, game: {slug, title, version}, challenge: {level, seed} \| null }` | `challenge` is set when the game was opened from a challenge link. |
| `asset(path)` | `ArrayBuffer` of a file in the game folder | Decode text with `new TextDecoder().decode(buf)`. See "Asset fetches" below. |
| `file(id)` | `ArrayBuffer` of an admin file slot | Phase 1 serves no slots: always rejects `missing` (`bad_request` if `id` is not a string). |
| `submitScore({score, level?, seed?, meta?})` | `{ accepted: true, rank, best }` | `score` an integer from 0 to `scoring.max`; `level` at most 32 and `seed` at most 64 characters of `[A-Za-z0-9_.-]`; `meta` any JSON of at most 1 KB. One score per player per game every 5 seconds. Scores are client-reported and moderated: the host sends each one with a single-use run token from the game page (the game never sees it), and admins can remove scores. `rank` is the player's place on the all-time board (0 for agent users, who are kept off the boards), `best` their best score. |
| `leaderboard({period?, limit?})` | `[{rank, user_id, name, score, level, date}]` | `period` `all` (default) or `week` (last 7 days); `limit` an integer ≥ 1, default 10, capped at 100. One row per player (their best; a tie goes to whoever got there first). `name` is the display name, or the username when a user has none. `date` is a Unix timestamp. Agent users are left out when the Agents plugin is installed. |
| `save(obj)` | `{ saved: true }` | Stores one JSON value per player per game, at most 64 KB as JSON; a new save replaces the old one. |
| `load()` | the saved value, or `null` | |
| `share({level?, seed?, text})` | `{ url }` | Copies `text` and a challenge link to the player's clipboard. `text` is flattened to one line and cut to 280 characters. A link carries a challenge only when it has both `level` and `seed` (invalid ones are dropped): the game opens on that level and seed. The "Beat <name>'s best" banner shows only when the sharer has a score on that level, so share after submitting. |
| `exit()` | `null` | Closes the game and returns to the launcher. |

Every rejection is `{ code, message }`, with `code` one of:

| Code | Meaning |
|---|---|
| `bad_request` | The arguments are wrong: an unsafe path, a score out of range, malformed level/seed/meta, data that is not JSON. |
| `forbidden` | The request was refused, for example an expired session (the request was redirected to the login page), or a score without a valid run token (reload the game page). |
| `missing` | The game, asset or file slot does not exist. |
| `rate_limited` | A score less than 5 seconds after the last one, or more than 8 network calls in flight. |
| `too_large` | The call's arguments exceed about 70 KB of JSON, or a save exceeds 64 KB. |
| `unavailable` | The server or browser could not answer, the game has no `scoring`, or the clipboard is blocked. Usually worth a retry. |

At most 8 network calls (`asset`, `submitScore`, `leaderboard`, `save`, `load`, `share`) may be pending at once
per game; the 9th rejects `rate_limited` until one finishes. `ready()`, `file()` and `exit()` never touch the
network and are always answered. Load assets one after another or in small batches.

### Asset fetches

`asset(path)` fetches `base_url + path` from the launcher page without cookies and without following
redirects, so a game can never receive a signed-in Kanboard page. Besides the path rules above, the launcher
refuses paths with whitespace or control characters, empty segments (`a//b`), a name on the banned-extension
list (`.php`, `.php5`, `.phtml`, `.phar`, `.phps`, `.log`, `.sqlite`), or more than 512 characters
(`bad_request`); `./` segments are dropped.

`asset()` sends no credentials, so on a site behind HTTP Basic auth or an SSO proxy it rejects `unavailable`
unless the admin exempts the game folders (see the README).

A missing file rejects `missing` only when the web server answers 404 for it, which nginx does for static types
(images, scripts, styles, fonts). For other names, such as `.json` or `.bin`, Kanboard's front controller answers
instead and the call rejects `unavailable`. Check that every asset you load ships with the game.

## A minimal game

`Games/hello/game.json`:

```json
{
  "slug": "hello",
  "title": "Hello",
  "version": "0.1.0",
  "kind": "original",
  "licence": "MIT",
  "content_licence": "CC-BY-4.0",
  "entry": "index.html",
  "art": { "cover": "cover.svg" },
  "players": { "min": 1, "max": 1 },
  "modes": ["solo"],
  "scoring": { "order": "high", "unit": "clicks", "max": 1000 },
  "files": []
}
```

`Games/hello/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hello</title>
</head>
<body>
<p id="greeting">Loading…</p>
<button type="button" id="click">Click</button>
<button type="button" id="done">Submit and exit</button>
<script src="../../../LanParty/Assets/js/lanparty-sdk.js?v=0.1.0"></script>
<script src="hello.js?v=0.1.0"></script>
</body>
</html>
```

`Games/hello/hello.js`:

```js
let clicks = 0;

LanParty.ready()
  .then(function (info) {
    document.getElementById('greeting').textContent = 'Hello, ' + info.player.name;
  })
  .catch(function (e) {
    document.getElementById('greeting').textContent = 'Hello could not start: ' + e.message;
  });

document.getElementById('click').addEventListener('click', function () {
  clicks++;
});

document.getElementById('done').addEventListener('click', function () {
  LanParty.submitScore({ score: Math.min(clicks, 1000) })
    .catch(function (e) { console.warn(e.code, e.message); })
    .then(function () { return LanParty.exit(); });
});
```

Add the `cover.svg` too: the registry does not check that art files exist, so a missing cover shows as a broken
image on the launcher. A folder under `LanParty/Games/` is listed automatically; a game in another plugin also
needs the snippet from "Registration" in that plugin's `initialize()`. For seeded challenges, saves and assets,
read `Games/pop/pop.js`.
