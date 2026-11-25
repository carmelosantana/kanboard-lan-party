# Changelog

## Unreleased

- Security: a score is accepted only with a single-use run token issued by the game page, bound to the player
  and game; each accepted score returns the next token. Scores stay client-reported.
- Security: a player holds at most one unused run token per game; loading the game page again replaces it, so
  reloads no longer add rows to `lanparty_runs`.
- Manifest: optional `scoring.min_seconds` rejects scores sent sooner than that after the run began.
- Settings → LAN Party: admins remove a player's scores for a game, or reset a game's board.

## 0.1.0 — 2026-11-20

- Game launcher page with rows of game cards, a hero banner and per-game pages.
- Game registry: games are static folders registered through `lanpartyGames`, checked against the v1 manifest
  and folder rules; invalid games are skipped and logged, duplicates keep the first registration.
- Sandboxed play overlay (`<iframe sandbox="allow-scripts">`) with a postMessage bridge and the
  `lanparty-sdk.js` game SDK: ready, asset, file, submitScore, leaderboard, save, load, share, exit.
- Scores with all-time and weekly leaderboards (best per player), bounds checks and a 5-second rate limit;
  agent users stay off the boards when the Agents plugin is installed.
- Per-player game saves (up to 64 KB of JSON).
- Challenge links: a shared level and seed reopen the game on the same run.
- Game files opened outside the launcher stay sandboxed: the SDK stops the page, and `Games/.htaccess` (Apache)
  or the README's nginx snippet serve them with `Content-Security-Policy: sandbox allow-scripts`.
- Sample game `Pop`, and the game contract for authors in `docs/game-contract.md`.
- Original game `Saltroad`: lead a salt caravan across a short or long route; seeded event deck for
  challenges, trading posts, saved journeys.
- Game `Gusher`: an oil pipe-flow puzzle with ten hand-made levels and seeded endless boards; the seeded piece
  queue gives challengers the same pieces.
- Original game `Wicklings`: lead candle-folk to the lantern with five jobs across twelve hand-made levels;
  a deterministic fixed-step simulation, scores in wicks (max 7000), saved level progress.
