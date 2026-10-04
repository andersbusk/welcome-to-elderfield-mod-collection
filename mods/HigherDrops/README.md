# HigherDrops

Ore rocks, plain stone and grass drop more pieces, and leaf piles, herbs, berries and mushrooms give more per pick.

In the unmodded game Coal Ore drops 3 to 8 pieces, while nearly every other ore drops exactly 1.
This mod gives the other ores a range too, and raises coal.

## What it changes

| Rock | Drops | Unmodded | With HigherDrops |
|---|---|---|---|
| Coal Ore | Coal | 3-8 | 8-34 |
| Dense Coal | Coal | 6-14 | 16-68 |
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
| Grass (scythe) | Weeds | 1-3 | 2-6 |
| Big Grass (scythe) | Weeds | 4-8 | 8-16 |

Picked by hand:

| Forage | Gives | Unmodded | With HigherDrops |
|---|---|---|---|
| Leaf Pile | Dead Leaves | 1 | 2-4 |
| Herb | Bitter Herb | 1-2 | 2-4 |
| Bloodberry | Bloodberries | 1 | 2-4 |
| Red Mushroom, Green Mushroom | the same | 1-2 | 2-4 |
| Common, Spiritcap, Night-Hood, Corpse-Ear, Ashy, Whisptop, Bulbous, Dual-Sprout and Golden Mushroom, Earthen Morel | the same | 1 | 2-4 |

The game picks a whole number in the range each time a rock breaks or a plant is picked.
Its own "2x Items!" bonus, for mining and for foraging, still applies on top.

A rock never drops less than in the unmodded game. Where the game's own amount is higher than the table says, the game's number is kept, which is why the Catacombs stone starts at 2.

**Unchanged:** the large dense iron and gold rocks (1 Dense Iron Ore or Dense Gold Ore each), Small Rock (1 Stone), the magic crystals (Death, Deep, Dream, Ghost, Light, Moon), gem nodes, Damp Rock, breakable clutter, trees, and the remaining forage (Gravemoss, Slimeweed, Vilebloom, Vileroot, Elder Coral, Sunflower, Snow Pearls, Wild Herbs and the rare finds).

## Settings

The `DROPS` table at the top of `js/plugins/HigherDrops.js`. Each line is a rock's name and `[minimum, maximum]`, with the unmodded amount in a comment.
Any other pickaxe, axe or scythe target, or anything picked by hand, can be added by name. This prints every name with its current drop:

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
