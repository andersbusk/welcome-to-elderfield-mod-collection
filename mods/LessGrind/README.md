# LessGrind

Cuts the material grind and the waiting. Costs go down, machines finish sooner, coffee lasts all day.

## What it changes

| Area | Unmodded game | With LessGrind |
|---|---|---|
| Tool upgrades at the Upgrade station (pickaxe, axe, scythe, watering can, hoe, fishing rod; all 18 recipes) | Previous tool plus 3 to 15 of each material | Previous tool plus 1 of each original material |
| Greater Offering of Rain | Six ingredients, 64 items in total | 1 Wheat of any quality |
| Preserving Barrel, to craft | 20 Wood, 3 Leather, 5 Copper Bar, 2 Iron Bar | 1 Wood |
| Preserving Barrel, per batch | 3 days | 1 day |
| Keg, per batch | 5 days | 1 day |
| Cask | 7 days per aging stage | 1 day per stage |
| "Check back in N days" | Ready one day later than it says | Ready on the day it says. Also applies to the Drying Rack |
| Klaus's Trough Upgrade | 30 Wood, 30 Stone, 1500 gold for +4 capacity | 15 Wood, 15 Stone, 500 gold for +16 capacity |
| Trough "Add feed" box | Up to 99 at once | Up to 999 at once |
| Cup of Coffee, duration | 4 in-game hours | 24 in-game hours |
| Cup of Coffee, speed (walk / run / bike) | 4.4 / 4.85 / 5.16 | 4.5 / 5.0 / 5.5 |

Speed is the game's own scale, where +1 doubles your speed. Without coffee it is 4.0 / 4.5 / 5.0.

## Settings

Everything is in the `CONFIG` block at the top of `js/plugins/LessGrind.js`, with the unmodded value in a comment next to each setting. Some of them:

- `TOOL_UPGRADE_COST`: `ONE_OF_EACH`, or a fixed list such as `[[IRON_BAR, 1]]` for "previous tool plus 1 Iron Bar".
- `NEW_MATERIALS`: recipe costs. The Lesser and Medium rain offerings are there as commented lines.
- `BARREL_DAYS`, `KEG_DAYS`, `CASK_DAYS_PER_STAGE`, `FIX_OFF_BY_ONE`.
- `TROUGH_STEP`, `TROUGH_COST_WOOD`, `TROUGH_COST_STONE`, `TROUGH_COST_GOLD`, `TROUGH_RETROACTIVE`.
- `COFFEE_HOURS`, `COFFEE_SPEED`.

Item IDs for the settings are in [docs/ItemList.csv](../../docs/ItemList.csv).

## Your save

Nothing new is stored in the save. Costs and timers are changed in memory each time the game starts, so removing the mod puts everything back.
Things you buy or start while it is active stay as normal progress: an upgraded tool, trough capacity, a batch already in a barrel.
Troughs you upgraded before installing the mod keep their capacity; only new upgrades add the larger amount.

## Works with

`LessGrindHits` (swing counts) and `Espresso` (a stronger coffee) are separate mods and do not overlap with this one.
