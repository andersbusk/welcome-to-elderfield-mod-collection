# StrongerGems

Upgrade gems add three times as much, and any gem works on equipment of any upgrade level.

Gems are applied to weapons and armor at the Anvil in the Workshop. Each gem adds a fixed amount and raises the item by one + level.

## What it changes

**Every gem adds three times as much.** A few examples; the gem descriptions in the game show the new amounts.

| Gem | Unmodded | With StrongerGems |
|---|---|---|
| Chipped Sharp Gem | +1 Attack | +3 Attack |
| Lesser / Greater / Perfect Sharp Gem | +2 Attack | +6 Attack |
| Lesser / Greater / Perfect Magic Gem | +2 M. Attack | +6 M. Attack |
| Lesser / Greater / Perfect Swift Gem | +4 Agility | +12 Agility |
| Lesser / Greater / Perfect Rage Gem | +0.4% Crit Rate | +1.2% Crit Rate |
| Lesser / Greater / Perfect Armor Gem | +1 Defense | +3 Defense |
| Lesser Blood Gem | +3 Max HP | +9 Max HP |
| Greater / Perfect Blood Gem | +4 Max HP | +12 Max HP |
| Meat Gem | +6 Max HP | +18 Max HP |
| Damp Gem | -10% MP Cost | -30% MP Cost |
| Treasure Gem | +4 Luck, -4 Max HP | +12 Luck, -4 Max HP |

The Treasure Gem is the only gem with a drawback, and the drawback is not multiplied.

**No level ranges.** In the unmodded game each kind of gem only works within a range of upgrade levels, which also makes +15 the ceiling:

| Gems | Unmodded | With StrongerGems |
|---|---|---|
| Chipped, Lesser | +0 to +5 | any level |
| Greater, most special gems | +0 to +10 | any level |
| Fog Gem | +5 to +10 | any level |
| Perfect, a few special gems | +10 to +15 | any level |

So you can keep adding gems for as long as you have them.

## Settings

`CONFIG` at the top of `js/plugins/StrongerGems.js`:

- `MULTIPLIER`: `3`. Whole numbers work best: Attack, Defense, Max HP and the like are rounded to whole numbers.
- `MULTIPLY_PENALTIES`: `false`. `true` also multiplies the Treasure Gem's Max HP loss.
- `NO_LEVEL_LIMITS`: `true`. `false` keeps the game's level ranges.

## Good to know

- The game's Faithful Gem says "+1 M. Defense, +1 Luck" but really gives +1 M. Defense and +2 Max MP. The mod multiplies what it really gives; its Luck text is left as the game wrote it.
- An upgrade applies to that kind of equipment, so every copy of the same weapon or armor shares it. That is how the game works.
- Which gem goes on which slot is unchanged, and equipment the game marks as not upgradable stays that way.

## Your save

The mod stores nothing itself. Upgrades are stored by the game, as always, with the amount the gem gave at the time.

- Upgrades made before the mod keep their old amounts. A Clear Gem takes one upgrade off, so it can be redone.
- Upgrades made with the mod stay as they are if you remove it.
