/*:
 * @target MZ
 * @plugindesc [StrongerGems] Upgrade gems add twice as much and work on equipment of any upgrade level.
 * @author Anders
 *
 * @help
 * ============================================================================
 * StrongerGems.js
 * ============================================================================
 * Gems are applied to weapons and armor at the Anvil in the Workshop. In the
 * unmodded game every gem adds a small fixed amount, and each kind only works
 * within a range of upgrade levels (Chipped and Lesser up to +5, Greater up to
 * +10, Perfect from +10 to +15), which also makes +15 the ceiling.
 *
 * This mod:
 *  - multiplies what every gem adds (MULTIPLIER), and
 *  - removes the level ranges: any gem works on equipment of any upgrade
 *    level, and there is no ceiling.
 *
 * The gem descriptions are updated to show the new amounts.
 *
 * Your save: the mod stores nothing itself. Upgrades are stored by the game,
 * exactly as it always does, with whatever amount the gem gave at the time.
 * So upgrades made before the mod keep their old amounts, and upgrades made
 * with the mod keep theirs if the mod is removed. A Clear Gem still takes off
 * one upgrade at a time.
 */

(() => {
    "use strict";
    const TAG = "[StrongerGems]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // What every gem adds is multiplied by this. 1 = as in the unmodded game.
    // Whole numbers work best: Attack, Defense, Max HP and the like are rounded
    // to whole numbers, percentages (Hit Rate, Crit Rate, resistances) are not.
    const MULTIPLIER = 2;

    // One gem has a drawback: the Treasure Gem takes 4 Max HP away.
    // false: drawbacks stay as they are.   true: they are multiplied too.
    const MULTIPLY_PENALTIES = false;

    // true: any gem works on equipment of any upgrade level, with no ceiling.
    // false: the game's ranges (Chipped / Lesser +0 to +5, Greater +0 to +10,
    //        Perfect +10 to +15, some ring gems +5 to +10).
    const NO_LEVEL_LIMITS = true;
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const UPGRADE_PLUGIN = "WTE_EquipmentUpgradeSystem";
    const DISPATCH_EVENT = { id: 2885, name: "Check Material, do upgrade" };   // calls every gem group in turn
    const VAR_MATERIAL   = 132;      // "Math 3": the gem picked in the upgrade menu
    const VAR_PLUS_LEVEL = 1505;     // "Item PlusLevel": the +N of the chosen equipment
    // The amount is the "Value" argument of these plugin commands. Basic stats are whole numbers;
    // the others are percentages. A negative percentage (MP Cost) is a benefit, not a drawback.
    const COMMANDS = { ChangeParameters: "whole", ChangeExParams: "rate", ChangeSpParams: "rate", ChangeElementRate: "rate" };
    const NEVER = 999999;

    const isNumber = (text) => /^-?\d+(\.\d+)?$/.test(String(text).trim());
    const scale = (value, kind) => {
        if (kind === "whole") {
            if (value < 0 && !MULTIPLY_PENALTIES) return value;
            const scaled = Math.round(value * MULTIPLIER);
            return scaled === 0 && value !== 0 ? Math.sign(value) : scaled;
        }
        return Math.round(value * MULTIPLIER * 10000) / 10000;
    };
    const findEvent = (events, ref) => {
        const byId = events[ref.id];
        if (byId && byId.name === ref.name) return byId;
        return events.find(ev => ev && ev.name === ref.name) || null;
    };

    // Returns { gem item id: [{ before, after }, ...] } for the descriptions.
    const patchEvents = (events) => {
        const dispatcher = findEvent(events, DISPATCH_EVENT);
        if (!dispatcher) {
            console.warn(TAG + ' Common event "' + DISPATCH_EVENT.name + '" not found. Mod did nothing.');
            return null;
        }
        const groups = [...new Set(dispatcher.list.filter(cmd => cmd.code === 117).map(cmd => cmd.parameters[0]))];
        const gems = {};
        const called = new Set();
        let amounts = 0;
        for (const id of groups) {
            const group = events[id];
            if (!group || !Array.isArray(group.list)) continue;
            // A group is a row of blocks, one per gem: "If <picked gem> == <gem item>" ... "End".
            let gem = 0;
            for (const cmd of group.list) {
                const p = cmd.parameters;
                if (cmd.indent === 0 && cmd.code === 111) {
                    gem = (p[0] === 1 && p[1] === VAR_MATERIAL && p[2] === 0 && p[4] === 0) ? p[3] : 0;
                } else if (cmd.indent === 0 && cmd.code === 412) {
                    gem = 0;
                } else if (gem && cmd.code === 117) {
                    called.add(p[0]);
                } else if (gem && cmd.code === 357 && p[0] === UPGRADE_PLUGIN && COMMANDS[p[1]] && p[3] && isNumber(p[3].Value)) {
                    const before = Number(p[3].Value);
                    const after = scale(before, COMMANDS[p[1]]);
                    (gems[gem] = gems[gem] || []).push({ before: before, after: after });
                    if (after !== before) {
                        p[3].Value = String(after);
                        amounts++;
                    }
                }
            }
        }

        // The level ranges are small events the gem blocks call: "if the level is below / above X,
        // refuse". Move X out of reach instead of removing anything.
        let limits = 0;
        if (NO_LEVEL_LIMITS) {
            for (const id of called) {
                const ev = events[id];
                if (!ev || !Array.isArray(ev.list)) continue;
                for (const cmd of ev.list) {
                    const p = cmd.parameters;
                    if (cmd.code !== 111 || p[0] !== 1 || p[1] !== VAR_PLUS_LEVEL || p[2] !== 0) continue;
                    if (p[4] === 1 || p[4] === 3) p[3] = NEVER;                 // level >= X, level > X
                    else if (p[4] === 2 || p[4] === 4) p[3] = -NEVER;           // level <= X, level < X
                    else continue;
                    limits++;
                }
            }
        }
        console.log(TAG + " Gems: " + Object.keys(gems).length + ", amounts changed: " + amounts + ", level limits removed: " + limits + ".");
        return gems;
    };

    const format = (value) => String(Math.round(Math.abs(value) * 10000) / 10000);

    // "Adds: +2 Attack" -> "Adds: +4 Attack", and "Item Level: 0-5" -> "Item Level: Any".
    const patchDescriptions = (items, gems) => {
        for (const id of Object.keys(gems)) {
            const item = items[id];
            if (!item || typeof item.description !== "string") continue;
            const lines = item.description.split("\n");
            const amounts = gems[id].slice();
            // Signed numbers only, which leaves the colour codes (\c[23]) alone.
            lines[0] = lines[0].replace(/([+-])(\d+(?:\.\d+)?)/g, (match, sign, digits) => {
                const i = amounts.findIndex(entry => entry.before === Number(sign + digits));
                if (i < 0) return match;
                const entry = amounts.splice(i, 1)[0];
                return (entry.after < 0 ? "-" : "+") + format(entry.after);
            });
            let text = lines.join("\n");
            if (NO_LEVEL_LIMITS) text = text.replace(/(Item Level(?:\\c\[\d+\])?: )\d+-\d+/, "$1Any");
            item.description = text;
        }
    };

    let done = false;
    const trySetup = () => {
        if (done) return;
        const items = typeof $dataItems !== "undefined" ? $dataItems : null;
        const events = typeof $dataCommonEvents !== "undefined" ? $dataCommonEvents : null;
        if (!Array.isArray(items) || !Array.isArray(events)) return;
        done = true;
        const gems = patchEvents(events);
        if (gems) patchDescriptions(items, gems);
    };

    if (typeof DataManager !== "undefined") {
        const _DataManager_onLoad = DataManager.onLoad;
        DataManager.onLoad = function(object) {
            _DataManager_onLoad.call(this, object);
            trySetup();
        };
        const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
        DataManager.isDatabaseLoaded = function() {
            const loaded = _DataManager_isDatabaseLoaded.call(this);
            if (loaded) trySetup();
            return loaded;
        };
    } else {
        console.warn(TAG + " DataManager not found. Mod did nothing.");
    }
})();
