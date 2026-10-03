/*:
 * @target MZ
 * @plugindesc [CheapKiosk] The Mall Kiosk (the Eldritch Slime shopkeeper in Mall_1) stocks every item at 1 gold.
 * @author Anders
 *
 * @help
 * ============================================================================
 * CheapKiosk.js
 * ============================================================================
 * Turns one Dungeonmind Core Shop into an "everything for 1 gold" store.
 * By default that is Core Shop ID 1, "Mall Kiosk": the odd snack-shop
 * shopkeeper on the Mall_1 map who normally sells only Eldritch Slime.
 *
 * How it works (nothing is written to the save file or to item data):
 *  - When that shop's stock list is requested, the mod returns the shop's
 *    real stock (re-priced) plus a generated catalogue of every item, weapon
 *    and armor in the database, all priced at PRICE. The catalogue is built
 *    in memory each time the shop opens and is never stored.
 *  - Shop category tabs are set so the long list can be browsed by type.
 *
 * Item prices in the database are untouched, so selling prices and every
 * other shop stay exactly as they were. Remove or disable the mod (rename the
 * folder to "!CheapKiosk") and the kiosk is back to selling slime for 30 gold.
 *
 * Edit the CONFIG section to change the shop, price, or what is included.
 * Item IDs are the "id" values in the game's data/Items.json. A readable list can be made
 * with:  python dev-tools/make_itemlist.py "<game folder>" ItemList.csv
 */

(() => {
    "use strict";
    const TAG = "[CheapKiosk]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    const SHOP_ID = 1;        // Core Shop ID. 1 = "Mall Kiosk" (Eldritch Slime shopkeeper, Mall_1)
    const PRICE   = 1;        // gold per unit for everything in this shop

    const INCLUDE_ITEMS   = true;
    const INCLUDE_WEAPONS = true;
    const INCLUDE_ARMORS  = true;

    // Skip quest/key items (database type "Key Item" or tagged key/keyitems).
    // Handing yourself quest items can break story progress, so this is on.
    const EXCLUDE_KEY_ITEMS = true;

    // Only list entries the game itself tags with a shop category ("all").
    // This skips roughly 1300 blank / "Empty" / "=====Section=====" placeholder
    // rows in the database that are not real items.
    const ONLY_TAGGED_ENTRIES = true;

    // Extra things to leave out, by database ID.
    const EXCLUDE_IDS = { items: [], weapons: [], armors: [] };

    // Names matching any of these are developer placeholders, not real items.
    const EXCLUDE_NAME_PATTERNS = [/^TEST/, /^[-=\/]/, /^Empty$/i];

    // The shop's own original stock (the slime) is also sold at PRICE.
    const REPRICE_ORIGINAL_STOCK = true;

    // true: list everything A to Z by name (each category tab too).
    // false: database order (items, then weapons, then armors, by ID).
    const SORT_ALPHABETICALLY = true;

    // Category tabs shown in this shop. Symbols must exist in the
    // DM_ItemCategories plugin: items, material, food, seed, utility, potion,
    // deco, keyitems, weapon, armor, all. Empty list = leave the game's default.
    const SHOP_TABS = ["all", "food", "material", "seed", "potion", "utility", "deco", "weapon", "armor"];
    // ========================================================================
    // END CONFIG
    // ========================================================================

    if (typeof Game_Shop === "undefined" || typeof Scene_CoreShop === "undefined") {
        console.warn(TAG + " DM_CoreShop not found. Mod did nothing.");
        return;
    }

    const shopIndex = SHOP_ID - 1;                 // DM_CoreShop stores shops 0-based
    const isTargetShop = () => typeof $gameShop !== "undefined" && $gameShop && $gameShop._tempShopId === shopIndex;

    const CATEGORY_RE = /<Categories>([\s\S]*?)<\/Categories>/i;
    const categoriesOf = (entry) => {
        const m = CATEGORY_RE.exec(entry.note || "");
        return m ? m[1].split(/[\s,]+/).filter(s => s) : [];
    };

    const isSellable = (entry, kind) => {
        if (!entry || typeof entry.name !== "string" || !entry.name.trim()) return false;
        if (EXCLUDE_IDS[kind] && EXCLUDE_IDS[kind].includes(entry.id)) return false;
        if (EXCLUDE_NAME_PATTERNS.some(re => re.test(entry.name.trim()))) return false;
        const cats = categoriesOf(entry).map(c => c.toLowerCase());
        if (ONLY_TAGGED_ENTRIES && !cats.includes("all")) return false;
        if (EXCLUDE_KEY_ITEMS) {
            if (kind === "items" && entry.itypeId === 2) return false;
            if (cats.includes("key") || cats.includes("keyitems")) return false;
        }
        return true;
    };

    // Build a stored-goods object the same way DM_CoreShop does for its own
    // shops (a shallow copy of the database entry plus shop bookkeeping).
    const makeGood = (entry) => {
        const good = Object.assign({}, entry);
        good.amount = "";                 // "" = unlimited stock in DM_CoreShop
        good.useCustomSell = false;
        good.price = PRICE;
        good.retained = true;
        good.infinite = true;
        good.isInfinite = true;           // DM_CoreShop_SaveSync: skip purchase ledger
        good.unlockStatus = 0;
        if (typeof $gameShop !== "undefined" && $gameShop && $gameShop.checkItemCategory) {
            $gameShop.checkItemCategory(good);
            $gameShop.checkItemWeight(good);
        } else {
            good.categories = categoriesOf(entry);
        }
        return good;
    };

    const typeKey = (id, etypeId) => (etypeId === undefined ? "i" : etypeId === 1 ? "w" : "a") + ":" + id;

    let catalogue = null;   // rebuilt every time the shop scene is created

    const buildCatalogue = (original) => {
        const seen = new Set(original.map(g => typeKey(g.id, g.etypeId)));
        const out = [];
        const add = (list, kind) => {
            for (const entry of list) {
                if (!isSellable(entry, kind)) continue;
                const key = typeKey(entry.id, entry.etypeId);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(makeGood(entry));
            }
        };
        if (INCLUDE_ITEMS && typeof $dataItems !== "undefined")     add($dataItems, "items");
        if (INCLUDE_WEAPONS && typeof $dataWeapons !== "undefined") add($dataWeapons, "weapons");
        if (INCLUDE_ARMORS && typeof $dataArmors !== "undefined")   add($dataArmors, "armors");
        console.log(TAG + " Catalogue built: " + out.length + " entries at " + PRICE + " gold.");
        return out;
    };

    // ------------------------------------------------------------------------
    // Stock list override (read-only view; the saved shop data is untouched)
    // ------------------------------------------------------------------------
    // Name order: ignores upper/lower case, sorts "Item 2" before "Item 10",
    // and keeps same-named entries (quality tiers) in database order.
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const byName = (a, b) => collator.compare(a.name, b.name) || (a.id - b.id);

    const _Game_Shop_storedGoods = Game_Shop.prototype.storedGoods;
    Game_Shop.prototype.storedGoods = function() {
        const original = _Game_Shop_storedGoods.call(this);
        if (this._tempShopId !== shopIndex || !Array.isArray(original)) return original;
        if (!catalogue) {
            catalogue = buildCatalogue(original);
            if (SORT_ALPHABETICALLY) catalogue.sort(byName);
        }
        const stock = REPRICE_ORIGINAL_STOCK
            ? original.map(g => Object.assign({}, g, { price: PRICE }))
            : original.slice();
        const all = stock.concat(catalogue);
        // The catalogue is already sorted; only re-sort when real stock is mixed in.
        return SORT_ALPHABETICALLY && stock.length > 0 ? all.sort(byName) : all;
    };

    const _Scene_CoreShop_create = Scene_CoreShop.prototype.create;
    Scene_CoreShop.prototype.create = function() {
        catalogue = null;
        _Scene_CoreShop_create.call(this);
    };

    const _Scene_CoreShop_terminate = Scene_CoreShop.prototype.terminate;
    Scene_CoreShop.prototype.terminate = function() {
        _Scene_CoreShop_terminate.call(this);
        catalogue = null;
    };

    // ------------------------------------------------------------------------
    // Category tabs for this shop
    // ------------------------------------------------------------------------
    const _Game_Shop_openCoreShop = Game_Shop.prototype.openCoreShop;
    Game_Shop.prototype.openCoreShop = function(coreShopId) {
        if (Number(coreShopId) === SHOP_ID && SHOP_TABS.length > 0 &&
            typeof $gameCategories !== "undefined" && $gameCategories && $gameCategories.setCustomCategories) {
            $gameCategories.setCustomCategories(SHOP_TABS.slice());
        }
        return _Game_Shop_openCoreShop.call(this, coreShopId);
    };

    // ------------------------------------------------------------------------
    // DM_CoreShop caps the purchase count with a global "shopAmount" that it
    // only updates when the item is found in the shop's saved stock table.
    // Catalogue items are not in that table, so clear the stale value first.
    // ------------------------------------------------------------------------
    if (typeof Window_ShopNumber !== "undefined") {
        for (const method of ["processNumberChange", "onButtonUp", "onButtonDown"]) {
            const original = Window_ShopNumber.prototype[method];
            if (typeof original !== "function") continue;
            Window_ShopNumber.prototype[method] = function() {
                if (isTargetShop()) window.shopAmount = undefined;
                return original.apply(this, arguments);
            };
        }
    }

    console.log(TAG + " Active for Core Shop " + SHOP_ID + " at " + PRICE + " gold.");
})();
