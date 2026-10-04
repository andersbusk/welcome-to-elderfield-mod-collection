# HigherDrops

Ore rocks and plain stone drop more pieces per rock.

In the unmodded game Coal Ore drops 3 to 8 pieces, while nearly every other ore drops exactly 1.
This mod gives the other ores a range too, and raises coal.

## What it changes

| Rock | Drops | Unmodded | With HigherDrops |
|---|---|---|---|
| Coal Ore | Coal | 3-8 | 6-14 |
| Dense Coal | Coal | 6-14 | 11-26 |
| Copper Ore | Copper Ore | 1 | 2-3 |
| Dense Copper | Copper Ore | 2-4 | 4-7 |
| Iron Ore | Iron Ore | 1 | 3-8 |
| Dense Iron | Iron Ore | 2-4 | 6-14 |
| Gold Ore | Gold Ore | 1 | 2-4 |
| Dense Gold | Gold Ore | 2-4 | 4-8 |
| Salt Ore | Salt Rock | 1 | 2-3 |
| Verdite Ore | Verdite Ore | 1 | 2-4 |
| Green Crystal | Green Crystal | 1-3 | 2-5 |
| Void Crystal Ore | Raw Void Crystal | 1 | 2-3 |
| Crimson Ore | Crimson Ore | 1 | 1-2 |
| Platinum Ore | Platinum Ore | 1 | 1-2 |
| Dense Black Iron Ore Large | Blackiron Ore | 1 | 1-2 |
| Rock (plain stone) | Stone | 1 | 1-4 |
| Rock in the Catacombs mines | Stone | 2 | 2-4 |
| Big Rock | Stone | 10 | 15-25 |

The game picks a whole number in the range each time a rock breaks.
Its own "2x Items!" mining bonus still applies on top.

A rock never drops less than in the unmodded game. Where the game's own amount is higher than the table says, the game's number is kept, which is why the Catacombs stone starts at 2.

**Unchanged:** the large dense iron and gold rocks (1 Dense Iron Ore or Dense Gold Ore each), Small Rock (1 Stone), the magic crystals (Death, Deep, Dream, Ghost, Light, Moon), gem nodes, Damp Rock, breakable clutter, trees and grass.

## Settings

The `DROPS` table at the top of `js/plugins/HigherDrops.js`. Each line is a rock's name and `[minimum, maximum]`, with the unmodded amount in a comment.
Any other pickaxe, axe or scythe target can be added by name. This prints every name with its current drop:

```
python dev-tools/list_drops.py
```

Run it from inside the game folder, giving the full path to the script.

## Good to know

- Bigger drops weigh more. The game refuses to break a rock when the drop would not fit in your inventory, so you may see "overburdened" more often.
- It works on rocks that are already on the map, since the amount is rolled when a rock breaks.

## Your save

Nothing is stored in the save. The amounts are changed in memory each time the game starts, so removing the mod puts them back. Ore you already picked up stays yours.

## Works with

`LessGrindHits` changes how many swings a rock takes; this mod changes what it drops. They do not overlap.
