# Espresso

Adds three new drinks: Espresso, Double Espresso and Triple Espresso. Each is a stronger version of the Cup of Coffee speed boost.

## What it does

All three are brewed at the game's Coffee Maker from Coffee Beans of any quality, and each boost lasts 8 in-game hours.

| Drink | Coffee Beans | Walk | Run | Bike |
|---|---|---|---|---|
| No boost | | 4.0 | 4.5 | 5.0 |
| Cup of Coffee, unmodded | 3 | 4.4 | 4.85 | 5.16 |
| Cup of Coffee with the LessGrind mod | 3 | 4.5 | 5.0 | 5.5 |
| Espresso | 4 | 4.85 | 5.3 | 5.8 |
| Double Espresso | 5 | 4.85 | 5.5 | 6.0 |
| Triple Espresso | 6 | 4.85 | 5.7 | 6.3 |

Speed is the game's own scale, where +1 doubles your speed. The game caps it at 6.5.

- A weaker drink never replaces a stronger one that is still running: a coffee does nothing to an espresso, an Espresso does nothing to a Double.
- The same or a stronger drink replaces the running one and starts the 8 hours again.
- The buff icon and tooltip still say "Coffee" for all of them.

Works with or without the `LessGrind` mod.

## Settings

`CONFIG` at the top of `js/plugins/Espresso.js`: the `DRINKS` list (name, `beans`, `price`, `speed` and `slot` for each drink) and `ESPRESSO_HOURS`.
Do not change a `slot` once you own that drink; the save remembers it by that number.

## Your save

The mod adds new items, so it is built to leave nothing broken behind:

- **No new item numbers.** Each drink takes over one of the game's blank "Empty" item slots, in memory only.
  If you remove the mod, a drink you still carry becomes that blank "Empty" item.
- **No new buff.** It uses the game's own Coffee state plus a small marker on the game's timer for it.
  Without the mod the marker is ignored and the boost behaves like a normal coffee.
- **Safe against game updates.** If an update ever uses one of the item slots for a real item, the mod notices,
  leaves that drink out, and leaves the new item alone.
- **Hidden from the encyclopedia**, so its completion count stays as in the unmodded game.

The [`CoffeeMachines`](../CoffeeMachines/README.md) mod, if you use it, makes the game's Espresso Machine brew an Espresso from 2 Coffee Beans.
