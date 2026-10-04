# LessGrindHits

Fewer swings with the pickaxe, axe and scythe. Felled trees fall in half the time and no longer hold you in place.

In the unmodded game every rock, tree and grass tuft has a health value, and a swing does damage equal to your tool's tier
(Rusty 1, Basic 2, Sturdy 3, Quality 4, Superior 5). The toughest rocks take up to 15 swings.
This mod changes how many swings things take. It does **not** change which tool tier you need: if the game says the tool is too weak, it still is.

In the tables, each cell is unmodded → modded, and a dash means the tool is too weak.

## Pickaxe: nothing above 6 swings

| Rock | Rusty | Basic | Sturdy | Quality | Superior |
|---|---|---|---|---|---|
| Stone, every area | 4 → 1 | 3 → 1 | 4 → 1 | 4 → 1 | 4 → 1 |
| Small Rock | 6 → 4 | 3 → 2 | 2 → 2 | 2 → 1 | 2 → 1 |
| Coal or Salt, weak | 8 → 5 | 4 → 3 | 3 → 2 | 2 → 2 | 2 → 1 |
| Copper, weak | 10 → 6 | 5 → 3 | 4 → 2 | 3 → 2 | 2 → 2 |
| Coal, Salt or Copper, strong | - | 6 → 3 | 4 → 2 | 3 → 2 | 3 → 2 |
| Iron Ore | - | 10 → 5 | 7 → 3 | 5 → 3 | 4 → 2 |
| Gold Ore, small gem node | - | 14 → 6 | 10 → 4 | 7 → 3 | 6 → 3 |
| Void Crystal Ore | - | - | 6 → 3 | 4 → 2 | 4 → 2 |
| Big Rock | - | - | 8 → 5 | 6 → 3 | 5 → 2 |
| Verdite, Green Crystal | - | - | 10 → 5 | 7 → 4 | 6 → 3 |
| Medium gem node | - | - | 14 → 6 | 10 → 5 | 8 → 4 |
| Damp Rock | - | - | - | 4 → 2 | 4 → 2 |
| Dense Coal | - | - | - | 7 → 3 | 6 → 3 |
| Dense Copper, Iron, Gold; small crystals | - | - | - | 8 → 4 | 7 → 3 |
| Crimson Ore | - | - | - | 9 → 4 | 8 → 3 |
| Large dense Iron or Gold | - | - | - | 10 → 4 | 8 → 4 |
| Platinum Ore | - | - | - | 11 → 5 | 9 → 4 |
| Large gem node, damp gem node | - | - | - | 15 → 6 | 12 → 5 |
| Large crystals | - | - | - | - | 12 → 6 |
| Dense Black Iron | - | - | - | - | 14 → 6 |

Stone comes in four strengths depending on the area. The unmodded numbers in that row are the most swings each pickaxe
needs on any stone it is able to break. Crates, pots, bricks and other breakable clutter drop to between 1 and 5 swings.

## Axe: nothing above 4 swings

| Tree or log | Rusty | Basic | Sturdy | Quality | Superior |
|---|---|---|---|---|---|
| Small Log | 6 → 4 | 3 → 2 | 2 → 1 | 2 → 1 | 2 → 1 |
| Tree | - | 6 → 3 | 4 → 2 | 3 → 1 | 3 → 1 |
| Big Log | - | 8 → 4 | 5 → 2 | 4 → 1 | 3 → 1 |
| Hardwood, Spiritwood, Bonetree | - | - | 8 → 4 | 6 → 3 | 5 → 2 |
| Big Stump | - | - | 10 → 4 | 8 → 3 | 6 → 2 |
| Coral, Vilewood | - | - | - | 9 → 4 | 8 → 3 |
| Ancientwood | - | - | - | - | 7 → 4 |

## Scythe: nothing above 2 swings

| Grass | Rusty | Basic | Sturdy | Quality | Superior |
|---|---|---|---|---|---|
| Grass | 4 → 2 | 2 → 1 | 2 → 1 | 1 → 1 | 1 → 1 |
| Big Grass | - | 2 → 2 | 2 → 1 | 1 → 1 | 1 → 1 |

In the game itself nothing needs a scythe better than Basic, so the upper scythe tiers have little to offer with or without this mod.

## Trees fall faster, and you can walk away

When a tree is felled it tips over a small step at a time. In the unmodded game you stand locked in place until it has landed.

| | Unmodded | With LessGrindHits |
|---|---|---|
| Tipping over | 119 frames | 63 frames |
| Waiting for the landing screen shake | 15 frames | 0 (the shake still plays) |
| Length of the fall | about 2.2 seconds | about 1 second |
| Walking while it falls | no | yes |

You can walk from the moment the tree starts to tip. Only walking is freed: the next swing, talking and the menu wait
until the wood is in your bag, as before. A doorway or map exit you step onto during that second may not react until you step onto it again.

The swing itself and the item pickup are unchanged. Logs, stumps and other non-tree wood never had the long fall.

## Also fixed: the game uses your best axe

The unmodded game checks for axes starting with the weakest and stops at the first one it finds.
Carrying a Rusty Axe together with a better one makes the game treat you as having the Rusty one.
With this mod the best axe you carry counts. (Pickaxe and scythe already work that way.)

## Settings

`CONFIG` at the top of `js/plugins/LessGrindHits.js`, per tool:

- `maxSwings`: the ceiling (pickaxe 6, axe 4, scythe 2).
- `upgrade`: `"proportional"` (better tools help in proportion to tier, as in the unmodded game) or `"halve"` (each tier above the minimum halves the swings).
- `toughest`: the health of the toughest thing each tool tier can break. That thing takes `maxSwings` with that tier, and the rest scale by health.
- `overrides`: exact swing counts for named things, as `[Rusty, Basic, Sturdy, Quality, Superior]`.
- `FIX_AXE_TIER`: the axe fix above.
- `TREE_FALL`: `framesPerStep` (frames between tilt steps, one number for each of the four phases of the fall), `stepMultiplier` (how far each step tilts), `waitForShake`, `moveWhileFalling`, and `enabled`.

## Your save

Nothing is stored in the save. The mod changes the damage of a swing, not the health stored on rocks and trees,
so it also applies to things already on the map, and removing it puts everything back.
