# Neural Duel

A 1v1 arena fighter where the CPU opponent isn't scripted — it learns to fight you
live, via tabular Q-learning, as you play.

- Pick a weapon (Blade / Spear / Gauntlets), a defense (Buckler / Tower Shield /
  Evasive), and allocate stat points before each match.
- The CPU gets a random loadout every match (never the same weapon as you).
- Light/heavy attacks, block, parry, dash, and a meter-gated special move.
- The CPU's sprite visibly glitches while it's still exploring (high epsilon) and
  cleans up as its Q-table improves — you can watch it learn in real time.

No game engine, no build step — plain HTML/CSS/JS with the UI and the AI both
hand-written. Open `index.html` directly, or serve the folder with any static
file server.

## Controls

- `←` / `→` move, `↑` jump, `Space` attack (light)
- `K` heavy attack, `Shift` block (hold), `Ctrl` dash, `E` special
- Or use the on-screen button pad below the arena

## How the AI works

Every ~220ms the CPU reads a discretized state (distance to you, both health
bands, grounded/airborne, your current action, whether its special is ready)
and picks a move with epsilon-greedy Q-learning. Landing a hit rewards it,
taking one punishes it, and winning/losing a round gives a large terminal
reward. The Q-table updates live from real fights — no pre-training.
