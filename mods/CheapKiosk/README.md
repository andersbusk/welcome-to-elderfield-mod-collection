# CheapKiosk

Turns one throwaway shop into a "everything for 1 gold" store.

The shop is the Mall Kiosk: the odd snack-shop shopkeeper on the first floor of the mall, who normally sells
nothing but Eldritch Slime. With this mod he stocks every item, weapon and armor in the game for 1 gold each.

## What you get

- About 2,000 entries: every real item, weapon and armor, listed A to Z.
- Category tabs to narrow it down: All, Food, Materials, Seeds, Potions, Utility, Decor, Weapons, Armor.
- Unlimited stock.
- His own Eldritch Slime also costs 1 gold.

Items of different quality share a name in this game, so some entries appear four times in a row. Those are the normal, silver, gold and void versions, in that order.

## What is left out

- **Quest and key items.** Handing yourself those can break story progress.
- **Placeholder rows** in the game's database (blank, "Empty", "TEST" and section-divider entries).

## Settings

`CONFIG` at the top of `js/plugins/CheapKiosk.js`:

- `SHOP_ID`: which shop to change (1 = Mall Kiosk).
- `PRICE`: gold per item.
- `INCLUDE_ITEMS`, `INCLUDE_WEAPONS`, `INCLUDE_ARMORS`, `EXCLUDE_KEY_ITEMS`, `EXCLUDE_IDS`.
- `SORT_ALPHABETICALLY`: A to Z, or database order.
- `SHOP_TABS`: which category tabs to show.

Item IDs for the settings are in [docs/ItemList.csv](../../docs/ItemList.csv).

## Your save

Item prices are not touched, so selling prices and every other shop stay as they were.
The stock list is generated in memory each time the shop opens and is never written to the save.
Remove the mod and he goes back to selling slime for 30 gold. What you bought stays yours.

Since almost everything can be bought here, achievements and progress tied to collecting or crafting become trivial. That is the point of the mod, but worth knowing.
