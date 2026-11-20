# Gusher

An oil pipe-flow puzzle for LAN Party. A wellhead is about to blow. Lay pipe from the queue before the countdown
ends, then stay ahead of the crude as it runs through your line, cell by cell.

## How to play

- Move with the arrow keys or WASD; Space or Enter lays the next piece. Or click or tap a square.
- F opens the throttle: everything runs five times faster (handy once your line is long enough).
- The queue shows the next five pieces. They come in a fixed orientation; you choose where they go.
- Laying over your own pipe swaps it, but the crude runs on for two seconds while you do. Pipe the crude has
  reached, bolted pipe (marked with a bolt in the corner), rock, depots and the wellhead cannot be laid over.
- Crude that reaches an open end spills and ends the round. Ending every branch in a depot, or running it back into
  crude already in the line, seals the well for a bonus.

## Pieces

| Piece | What it does |
|---|---|
| Straight | Carries crude across. |
| Bend | Turns it a quarter. |
| Cross | Two separate runs that bridge over each other; fill both for a crossing bonus. |
| Valve | A straight with a hand-wheel. Crude takes three times as long to pass, which buys you time. |
| Tank-junction | A drum open on three sides. It fills slowly (four times as long), pays a tank bonus, then sends crude out of both other sides. |

## Barrels

| | Barrels |
|---|---|
| Each pipe run filled (a cross counts twice) | 10 |
| Tank filled | +50 |
| Cross filled both ways | +30 |
| Depot reached | +100 |
| Well sealed (no spill) | +200 |

`scoring.max` is 10000: the most one square can pay is 100 (a depot; a tank pays 60, a full cross 50), the largest
board is 10 x 8, so a perfect board tops out at 80 x 100 + 200 = 8200. The game clamps to 10000 anyway.

## Levels

Ten hand-made boards in `levels.json` (`1` to `10`, from *First Strike* to *Blowout*), each with a countdown, a fill
speed and a barrel quota. Legend: `.` deck, `#` rock, `D` depot, `^ > v <` the wellhead and its outlet, `- |`
bolted straights, `+` a bolted cross.

`Endless` builds a fresh 10 x 8 board from the run's seed. The piece queue is seeded by the seed and the level, so a
shared challenge link gives the challenger the same board and the same pieces.

Your best per level is saved with LAN Party's save slot.

## Credits

Game, art and levels: original work for LAN Party. Code MIT, art and levels CC-BY-4.0.
