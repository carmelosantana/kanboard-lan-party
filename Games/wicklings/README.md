# Wicklings

Little candle-folk tumble out of a hatch and march on until something turns them. Hand out jobs so that
enough of them reach the lantern before their wicks burn down.

## How to play

- Wicklings walk until they meet a wall, then turn around. They step up a one-tile ledge on their own.
- Water snuffs a wickling, and so does a fall of more than six tiles.
- Pick a job, then give it to a wickling:
  - **Digger** (1) digs straight down through earth and planks, not stone.
  - **Blocker** (2) stands still for good and turns everyone who walks into it.
  - **Bridger** (3) carries 8 planks and lays one wherever the floor in front runs out.
  - **Climber** (4) is a knack: it scales any wall it meets.
  - **Floater** (5) is a knack: it drifts down safely from any height.
  Digger, blocker and bridger need a wickling standing on firm ground; the two knacks can be given at any time.
- Mouse: click a job button, then click a wickling. Keyboard: 1 to 5 picks a job, Left/Right (or A/D) picks a
  wickling, Space or Enter hands the job over. P or Escape pauses (you can still hand out jobs), S steps one
  tick while paused, F runs at triple speed.
- A level ends by itself when everyone is home, snuffed or blocking, when the clock runs out, or once no job is
  left to give and nothing can change any more (the last wicklings only pace back and forth). **End** stops it
  sooner and counts who is home: useful when you have jobs left but do not mean to use them.

## Score

100 wicks for each wickling home, plus 10 for every whole second left on the clock when you met the goal.
`scoring.max` is 7000: the level format caps a level at 40 wicklings and 300 seconds, and
40 × 100 + 300 × 10 = 7000, so no legal level can score more.

## Levels

Twelve hand-made levels in `levels.json`; each opens when you win the one before. A level is a grid of
tiles, one string per row: `.` air, `#` earth, `X` stone, `=` plank, `~` water, `D` the door, `L` the lantern.

1. First Flame · 2. Underfloor · 3. Hold Fast · 4. Mill Race · 5. Sheer Face · 6. Featherfall ·
7. Two Rooms · 8. Sinkhole · 9. High Shelf · 10. Ferry · 11. Deep Cellar · 12. Last Light

The simulation steps at a fixed six ticks a second and uses no randomness, so the same level and the same
jobs given at the same ticks always end the same way. A challenge link carries the level and a seed; the
seed only changes the stars and the flicker of the flames.

## Credits

Game, levels and art: original work for LAN Party. Code MIT, art and levels CC-BY-4.0.
