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

## Web server

Games run in a sandboxed iframe, but a game file opened directly (a new tab, a pasted URL) is an ordinary page
on your Kanboard site. The SDK refuses to start there, and the web server should send it sandboxed too:

- **Apache:** nothing to do. `Games/.htaccess` sets `Content-Security-Policy: sandbox allow-scripts` when
  `mod_headers` is enabled (and `AllowOverride` permits it).
- **nginx:** add this to the Kanboard `server` block, above the static-file location
  (`location ~* ^.+\.(ico|jpg|…)$` in the stock config), so it covers every file under a `Games` folder:

  ```nginx
  location ~ /plugins/[^/]+/Games/ {
      add_header Content-Security-Policy "sandbox allow-scripts" always;
  }
  ```

  An `add_header` inside a location drops the server-level ones there; repeat any you rely on.

**HTTP Basic auth and SSO proxies.** The SDK's `asset()` fetches game files without credentials (so a game can
never receive a signed-in page). Behind HTTP Basic auth or an SSO proxy (oauth2-proxy, Authelia, Cloudflare
Access…) those fetches are refused and `asset()` rejects `unavailable`. Exempt `/plugins/*/Games/` from the
proxy's auth if your games use `asset()` (and check that the games' own scripts and styles load: the sandboxed
frame is cross-site, so a proxy cookie set `SameSite=Lax` or `Strict` is not sent with them either).

## Games

LAN Party ships one sample game, `Pop` (`Games/pop`). Other plugins can register their own games.
Each game is a folder of static files that runs in a sandboxed iframe and talks to the launcher
only through `lanparty-sdk.js`. The rules for game authors are in
[docs/game-contract.md](https://github.com/carmelosantana/kanboard-lan-party/blob/main/docs/game-contract.md).

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
