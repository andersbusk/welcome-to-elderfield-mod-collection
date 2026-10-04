# CoffeeMachines

Two placeable machines that turn Coffee Beans into drinks by themselves: put a bean in, come back an hour later.

| Machine | Price | Takes | Gives | Time |
|---|---|---|---|---|
| Coffee Machine | 20 gold | 1 Coffee Bean | 1 Cup of Coffee | 1 in-game hour |
| Espresso Machine | 30 gold | 2 Coffee Beans | 1 Espresso | 1 in-game hour |

The Espresso Machine only exists when the [`Espresso`](../Espresso/README.md) mod is enabled too.

## Where to get them

The General Store sells both, in unlimited number. With `CheapKiosk` enabled the Mall Kiosk lists them as well.

## How they work

- Use the item from your bag to place the machine, like any other placeable. It can go in the Home, on the Farm, in the Workshop and on the Ranch, the same places as a Keg.
- Walk up to it and press the action button. An empty machine offers: brew, pick up, cancel.
- Brewing takes the beans from your bag, the cheapest quality first. Beans in the fridge or in storage are not used.
- While it brews, the button tells you how many minutes are left. When it is done, the button hands you the cup.
- The time runs on the game's processing clock, the one the Food Processor uses, so it keeps running while you are somewhere else or asleep.
- One cup at a time per machine.

Both machines look like the game's Coffee Maker. There is no sign on the machine when a cup is ready; you find out by using it.

## Settings

`CONFIG` at the top of `js/plugins/CoffeeMachines.js`:

- `MACHINES`: per machine `beans`, `minutes`, `price` and `name`. `slot` is the blank item slot it uses; leave it alone once you own a machine.
- `SHOP_NAMES`: which shops sell them.
- `PLACE_LIKE`: the placeable whose placement rules the machines borrow (`"Keg"`). `""` means Home only, like the Coffee Maker.

## Your save

- A placed machine is saved as the game's own Coffee Maker object with a marker on it. Nothing in the save points at anything this mod adds.
- If you remove the mod, placed machines turn into ordinary Coffee Makers (and pick up as one), and a cup that was brewing is lost. Machines still in your bag show as a blank "Empty" item until the mod is back.
- The General Store's saved stock is not changed.

## Works with

- `Espresso`: needed for the Espresso Machine.
- `LessGrind`: the cups are normal Cups of Coffee, so its 24-hour coffee applies.
