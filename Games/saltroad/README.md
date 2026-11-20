# Saltroad

A trail-journey survival game for LAN Party. Lead a salt caravan from the inland pans to the coastal market.

## How to play

- Each morning in camp, pick a **pace** (steady 12 mi, hard 18 mi, rest) and **rations** (full, half, lean),
  then break camp.
- Watch your supplies: **salt** (the cargo, 12 bars per camel), **water**, **food**, **camels**, **camel
  strength**, **crew vigour** and **coin**. Running dry wears the crew down; worn-out camels are lost and their
  load is left behind. If the crew's vigour or the last camel gives out, the caravan is stranded.
- The road deals one card a day: sandstorms, lame camels, oases, toll riders, traders, a lost track, or a quiet
  day. Each card offers 2–3 choices with their odds shown.
- **Wells** fill the skins as you pass. **Posts** trade salt for water, food, camels or coin. **Fords** and
  **passes** stop the caravan for a decision.
- **Score:** bars delivered × days bonus, where the bonus is the days left on the route's deadline (at least 1).
- Keyboard: Tab and Enter (or Space) work everywhere; keys 1–3 answer a card.

The journey saves after every move from day 1 on: Continue picks it up next time. Submit your score at the market, then Share
a challenge: the same route and seed deal the same cards with the same luck.

## Levels

| Level | Route | Waypoints | Deadline |
|---|---|---|---|
| `1` | The Short Road | 10 | day 28 |
| `2` | The Long Road | 20 | day 56 |

Routes live in `routes.json`; the rules are in `saltroad-core.js` (no DOM, tested under `node:test`).

## Credits

Original game, art and text for LAN Party. Code MIT, content CC-BY-4.0.
