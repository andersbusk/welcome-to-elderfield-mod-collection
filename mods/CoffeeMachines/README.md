# CoffeeMachines

Two placeable machines that turn Coffee Beans into drinks by themselves: put a bean in, come back an hour later.

| Machine | Price | Takes | Gives | Time |
|---|---|---|---|---|
| Coffee Machine | 20 gold | 1 Coffee Bean | 1 Cup of Coffee | 1 in-game hour |
| Espresso Machine | 30 gold | 2 Coffee Beans | 1 Espresso | 1 in-game hour |

- The **Coffee Machine** is a new item. It looks like the game's Coffee Maker, which stays what it was: the crafting station that makes a cup on the spot from 3 beans.
- The **Espresso Machine** is the game's own Espresso Machine, which is only a decoration in the unmodded game. This mod makes it work. It needs the [`Espresso`](../Espresso/README.md) mod; without it the Espresso Machine stays a decoration.

## Where to get them

The General Store sells both, in unlimited number. With `CheapKiosk` enabled the Mall Kiosk lists them as well.

## How they work

- Use the item from your bag to place the machine, like any other placeable. It can go in the Home, on the Farm, in the Workshop and on the Ranch, the same places as a Keg.
- Walk up to it and press the action button. An empty machine offers: brew, pick up, cancel.
- Brewing takes the beans from your bag, the cheapest quality first. Beans in the fridge or in storage are not used.
- While it brews, the button tells you how many minutes are left. When it is done, the button hands you the cup.
- The time runs on the game's processing clock, the one the Food Processor uses, so it keeps running while you are somewhere else or asleep.
- One cup at a time per machine.
- There is no sign on the machine when a cup is ready; you find out by using it.

## How the Espresso Machine looks

The game draws the Espresso Machine with nothing under it, because it is meant to stand on a table.

- On a table it looks as in the game.
- On the floor (or on a rug) it is shown standing on a counter, the same counter the Coffee Maker has, and it blocks the way like one.

The counter picture is put together while the game runs from the game's own two pictures; the mod ships no image.
Espresso Machines you placed before the mod work too.

## Settings

`CONFIG` at the top of `js/plugins/CoffeeMachines.js`:

- `MACHINES`: per machine `beans`, `minutes` and `price`. `slot` is the blank item slot of the Coffee Machine; leave it alone once you own one.
- `SHOP_NAMES`: which shops sell them.
- `PLACE_LIKE`: the placeable whose placement rules the machines borrow (`"Keg"`). `""` means Home only, as in the unmodded game.
- `ESPRESSO_ON_COUNTER`: `false` keeps the game's look and lets you walk through an Espresso Machine, as in the unmodded game.

## Your save

- A placed Coffee Machine is saved as the game's own Coffee Maker object with a marker on it. A placed Espresso Machine is the game's own Espresso Machine object. Nothing in the save points at anything this mod adds.
- If you remove the mod, placed Coffee Machines turn into ordinary Coffee Makers (and pick up as one), Espresso Machines are decorations again, and a cup that was brewing is lost. A Coffee Machine still in your bag shows as a blank "Empty" item until the mod is back.
- The General Store's saved stock is not changed.
- Version 1.0 had its own Espresso Machine item. One of those in your bag becomes the game's Espresso Machine when you load the save; one you placed keeps working and becomes the game's Espresso Machine when you pick it up.

## Works with

- `Espresso`: needed for the Espresso Machine.
- `LessGrind`: the cups are normal Cups of Coffee, so its 24-hour coffee applies.
