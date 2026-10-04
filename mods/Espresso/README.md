# Espresso

Adds one new drink: an Espresso, a stronger version of the Cup of Coffee speed boost.

## What it does

- **Recipe:** brewed at the Coffee Maker from 6 Coffee Beans of any quality. A Cup of Coffee takes 3.
- **Effect:** faster movement for 24 in-game hours.

| Speed (walk / run / bike) | |
|---|---|
| No boost | 4.0 / 4.5 / 5.0 |
| Cup of Coffee, unmodded | 4.4 / 4.85 / 5.16 |
| Cup of Coffee with the LessGrind mod | 4.5 / 5.0 / 5.5 |
| Espresso | 4.85 / 5.3 / 5.8 |

Speed is the game's own scale, where +1 doubles your speed.

- An espresso always replaces a running coffee boost.
- A coffee never weakens or shortens a running espresso.
- The buff icon and tooltip still say "Coffee" for both drinks.

Works with or without the `LessGrind` mod.

## Settings

`CONFIG` at the top of `js/plugins/Espresso.js`: `SPEED`, `ESPRESSO_HOURS`, `ITEM_PRICE`, `RECIPE_BEANS`, and `ITEM_SLOT`.
Do not change `ITEM_SLOT` once you own Espressos; the save remembers them by that number.

## Your save

This is the only mod in the collection that adds something new, so it is built to leave nothing broken behind:

- **No new item number.** The Espresso takes over one of the game's blank "Empty" item slots, in memory only.
  If you remove the mod, any Espresso you still carry becomes that blank "Empty" item.
- **No new buff.** It uses the game's own Coffee state plus a small marker on the game's timer for it.
  Without the mod the marker is ignored and the boost behaves like a normal coffee.
- **Safe against game updates.** If an update ever uses that item slot for a real item, the mod notices,
  switches itself off, and leaves the new item alone.
- **Hidden from the encyclopedia**, so its completion count stays as in the unmodded game.

The [`CoffeeMachines`](../CoffeeMachines/README.md) mod adds an Espresso Machine that brews this drink from 2 Coffee Beans.
