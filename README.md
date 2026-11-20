# LAN Party

A game launcher with leaderboards and rooms for your team, built into Kanboard. Browse rows of
game cards with cover art, play in the browser, and compete on per-game leaderboards.
Multiplayer rooms arrive in a later release.

## Install

Unzip the release into `plugins/LanParty` of your Kanboard install. The folder must be named
exactly `LanParty`: every game loads the SDK from `../../../LanParty/Assets/js/lanparty-sdk.js`.

- Kanboard >= 1.2.47
- PHP >= 8.4
- Recommended: the Agents plugin (>= 0.5.0) keeps agent users off the leaderboards.

## Games

LAN Party ships one sample game, `Pop` (`Games/pop`). Other plugins can register their own games.
Each game is a folder of static files that runs in a sandboxed iframe and talks to the launcher
only through `lanparty-sdk.js`. The rules for game authors are in
[docs/game-contract.md](docs/game-contract.md).

## Development

```sh
./testing/run-plugin-tests.sh LanParty      # PHPUnit, from the plugin harness root
node --test LanParty/Test/js/*.test.mjs     # host bridge, SDK and Pop logic
```

## Licences

- Code: MIT (see `LICENSE`).
- Original game art: CC BY 4.0.

## Original games only

LAN Party ships original games and never bundles commercial game data. Open-source engine
ports live in a separate GPL pack.
