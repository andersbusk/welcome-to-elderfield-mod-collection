/*:
 * @target MZ
 * @plugindesc [HigherDrops] Ore rocks, stone and grass drop more: coal about three and a half times as much, copper a bit more, iron like coal used to be.
 * @author Anders
 *
 * @help
 * ============================================================================
 * HigherDrops.js
 * ============================================================================
 * How the game works: every rock is a template event that sets two variables
 * before a pickaxe swing, "Item" (what it drops) and "Amount" (how many), and
 * the amount is either a fixed number or a random range. Coal Ore already
 * drops 3-8; nearly every other ore drops exactly 1.
 *
 * What this mod does: it replaces the "Amount" line of the rocks listed in
 * DROPS with a new random range, in memory, each time the game starts.
 * Nothing is written to save files. It applies to rocks already on the map
 * too, because the amount is rolled at the moment a rock breaks.
 *
 * The game's own "2x Items!" bonus (mining and foraging) still applies on top.
 *
 * Add any other pickaxe, axe, scythe or hand-picked target to DROPS by its template name
 * (dev-tools/list_drops.py in the mod collection prints them all).
 */

(() => {
    "use strict";
    const TAG = "[HigherDrops]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // Pieces dropped per rock: [minimum, maximum]. The game picks a whole
    // number in that range each time. Use the same number twice for a fixed
    // amount. The unmodded amount is in the comment.
    const DROPS = {
        // --- Coal ---
        "Coal Ore":                   [7, 31],    // 3-8
        "Dense Coal":                 [14, 62],   // 6-14  (kept at double the plain rock, as in the game)

        // --- Copper ---
        "Copper Ore":                 [2, 3],     // 1
        "Dense Copper":               [4, 7],     // 2-4

        // --- Iron ---
        "Iron Ore":                   [3, 8],     // 1
        "Dense Iron":                 [6, 14],    // 2-4

        // --- Gold ---
        "Gold Ore":                   [2, 4],     // 1
        "Dense Gold":                 [4, 8],     // 2-4

        // --- Other ores ---
        "Salt Ore":                   [2, 3],     // 1
        "Verdite Ore":                [2, 4],     // 1
        "Green Crystal":              [2, 5],     // 1-3
        "Void Crystal Ore":           [2, 3],     // 1
        "Crimson Ore":                [1, 2],     // 1
        "Platinum Ore":               [1, 2],     // 1
        "Dense Black Iron Ore Large": [1, 2],     // 1

        // --- Stone ---
        "Rock":                       [1, 4],     // 1 (2 in the Catacombs mines, which become 2-4)
        "Big Rock":                   [15, 25],   // 10

        // --- Weeds (cut with the scythe) ---
        "Grass":                      [2, 6],     // 1-3
        "Big Grass":                  [8, 16],    // 4-8

        // --- Picked by hand ---
        "Leaf Pile":                  [2, 4],     // 1    Dead Leaves
        "Herb":                       [2, 4],     // 1-2  Bitter Herb
        "Bloodberry":                 [1, 4],     // 1    Bloodberries

        // --- Mushrooms (picked by hand) ---
        "RED MUSHROOM":               [1, 4],     // 1-2  Red Mushroom
        "GREEN MUSHROOM":             [1, 4],     // 1-2  Green Mushroom
        "Common":                     [1, 4],     // 1    Common Mushroom
        "Spiritcap":                  [1, 4],     // 1    Spiritcap Mushroom
        "Nighthood":                  [1, 4],     // 1    Night-Hood Mushroom
        "Corpse Ear":                 [1, 4],     // 1    Corpse-Ear Mushroom
        "Ashy":                       [1, 4],     // 1    Ashy Mushroom
        "Morel":                      [1, 4],     // 1    Earthen Morel
        "Whisptop":                   [1, 4],     // 1    Whisptop Mushroom
        "Bulbous":                    [1, 4],     // 1    Bulbous Mushroom
        "Dualsprout":                 [1, 4],     // 1    Dual-Sprout Mushroom
        "Golden":                     [1, 4]      // 1    Golden Mushroom (sells for 300)
        // Other forage you could add, with the game's amount:
        //   "Gravemoss" 1, "Slimeweed" 1, "Vilebloom" 1, "Vileroot" 1, "Coral" 1 (Elder Coral),
        //   "Sunflower" 1-3 (Sunflower Seeds), "Snow Pearls" 2-3, "Wild Herbs" 2-4 (Herb Portion)
    };
    // A rock never drops less than in the unmodded game: if the game's own
    // amount is higher than a number here, the game's number is used.
    //
    // Left at the game's amounts unless added above: Dense Iron Ore Large and
    // Dense Gold Ore Large (1 each), Small Rock (1),
    // the magic crystals (Small / Large ... Crystal), gem
    // nodes, Damp Rock, breakable clutter, trees, and the forage listed in the comment above.
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const VAR_AMOUNT = 31;                       // "Amount": how many pieces the next break gives
    // Events a template hands over to: pickaxe, axe (tree), axe (wood), scythe, picking by hand.
    const HARVEST_EVENTS = [917, 906, 978, 984, 865];

    // "Coal Ore 2" and "Coal Ore" are the same kind of rock: ignore a trailing number.
    const baseName = (name) => String(name || "").replace(/[ _]?\d+$/, "").trim();

    // Validate the table once so a typo cannot produce a broken command.
    const ranges = {};
    for (const name of Object.keys(DROPS)) {
        const range = DROPS[name];
        const ok = Array.isArray(range) && range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]) &&
            range[0] >= 1 && range[1] >= range[0];
        if (ok) ranges[name] = range;
        else console.warn(TAG + ' Ignoring "' + name + '": expected [minimum, maximum] with whole numbers of at least 1.');
    }

    // Control Variables (code 122) on "Amount":
    //   [31, 31, 0 set, 0 constant, n]   or   [31, 31, 0 set, 2 random, min, max]
    const patchMap = (map) => {
        if (!map || !Array.isArray(map.events) || map.__higherDropsPatched) return 0;
        map.__higherDropsPatched = true;
        let changed = 0;
        for (const ev of map.events) {
            if (!ev || !Array.isArray(ev.pages)) continue;
            const range = ranges[baseName(ev.name)];
            if (!range) continue;
            for (const page of ev.pages) {
                const list = page.list || [];
                // Only pages that actually hand over to a harvest event.
                if (!list.some(cmd => cmd.code === 117 && HARVEST_EVENTS.includes(cmd.parameters[0]))) continue;
                for (const cmd of list) {
                    const p = cmd.parameters;
                    if (cmd.code === 122 && p[0] === VAR_AMOUNT && p[1] === VAR_AMOUNT && p[2] === 0 && (p[3] === 0 || p[3] === 2)) {
                        // Never below what the game itself gives for this template.
                        const gameMin = Number(p[4]) || 0;
                        const gameMax = p[3] === 2 ? (Number(p[5]) || gameMin) : gameMin;
                        const min = Math.max(range[0], gameMin);
                        const max = Math.max(range[1], gameMax, min);
                        if (min === gameMin && max === gameMax) continue;      // already that amount
                        cmd.parameters = min === max
                            ? [VAR_AMOUNT, VAR_AMOUNT, 0, 0, min]
                            : [VAR_AMOUNT, VAR_AMOUNT, 0, 2, min, max];
                        changed++;
                    }
                }
            }
        }
        return changed;
    };

    if (typeof DataManager !== "undefined") {
        // Rock templates live on the game's spawn map, which is loaded like any other map.
        const _DataManager_onLoad = DataManager.onLoad;
        DataManager.onLoad = function(object) {
            _DataManager_onLoad.call(this, object);
            if (object && object.data && object.events) {
                const changed = patchMap(object);
                if (changed > 0) console.log(TAG + " Drop amounts changed on " + changed + " rock template(s).");
            }
        };
    } else {
        console.warn(TAG + " DataManager not found. Mod did nothing.");
    }
})();
