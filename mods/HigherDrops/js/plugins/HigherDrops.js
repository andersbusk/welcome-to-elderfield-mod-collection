/*:
 * @target MZ
 * @plugindesc [HigherDrops] Ore rocks drop more pieces: coal nearly doubled, copper a bit more, iron like coal used to be.
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
 * The game's own "2x Items!" mining bonus still applies on top.
 *
 * Add any other pickaxe, axe or scythe target to DROPS by its template name
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
        "Coal Ore":                   [6, 14],    // 3-8
        "Dense Coal":                 [11, 26],   // 6-14

        // --- Copper ---
        "Copper Ore":                 [2, 3],     // 1
        "Dense Copper":               [4, 7],     // 2-4

        // --- Iron ---
        "Iron Ore":                   [3, 8],     // 1
        "Dense Iron":                 [6, 14],    // 2-4
        "Dense Iron Ore Large":       [1, 2],     // 1   (drops the Dense Iron Ore item)

        // --- Gold ---
        "Gold Ore":                   [2, 4],     // 1
        "Dense Gold":                 [4, 8],     // 2-4
        "Dense Gold Ore Large":       [1, 2],     // 1   (drops the Dense Gold Ore item)

        // --- Other ores ---
        "Salt Ore":                   [2, 3],     // 1
        "Verdite Ore":                [2, 4],     // 1
        "Green Crystal":              [2, 5],     // 1-3
        "Void Crystal Ore":           [2, 3],     // 1
        "Crimson Ore":                [1, 2],     // 1
        "Platinum Ore":               [1, 2],     // 1
        "Dense Black Iron Ore Large": [1, 2]      // 1
    };
    // Left at the game's amounts unless added above: plain stone (Rock, Small
    // Rock, Big Rock), the magic crystals (Small / Large ... Crystal), gem
    // nodes, Damp Rock, breakable clutter, trees and grass.
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const VAR_AMOUNT = 31;                       // "Amount": how many pieces the next break gives
    const SWING_EVENTS = [917, 906, 978, 984];   // pickaxe, axe (tree), axe (wood), scythe

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
                // Only pages that actually hand over to a swing event.
                if (!list.some(cmd => cmd.code === 117 && SWING_EVENTS.includes(cmd.parameters[0]))) continue;
                for (const cmd of list) {
                    const p = cmd.parameters;
                    if (cmd.code === 122 && p[0] === VAR_AMOUNT && p[1] === VAR_AMOUNT && p[2] === 0 && (p[3] === 0 || p[3] === 2)) {
                        cmd.parameters = range[0] === range[1]
                            ? [VAR_AMOUNT, VAR_AMOUNT, 0, 0, range[0]]
                            : [VAR_AMOUNT, VAR_AMOUNT, 0, 2, range[0], range[1]];
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
