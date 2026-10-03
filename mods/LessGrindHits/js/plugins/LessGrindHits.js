/*:
 * @target MZ
 * @plugindesc [LessGrindHits] Fewer swings for pickaxe, axe and scythe: nothing takes more than 6.
 * @author Anders
 *
 * @help
 * ============================================================================
 * LessGrindHits.js
 * ============================================================================
 * How the game works: every rock, tree and grass tuft has a health value and a
 * minimum tool tier. Each swing deals damage equal to your tool's tier
 * (Rusty 1, Basic 2, Sturdy 3, Quality 4, Superior 5), so swings needed is
 * health / tier, rounded up. That reaches 15 swings on the toughest rocks.
 *
 * What this mod does: it replaces the damage of a swing, so the number of
 * swings follows the table below instead. Minimum tool tiers are NOT changed:
 * if the game says you need a stronger tool, you still do.
 *
 * The rule (used wherever there is no explicit entry):
 *   Things are grouped by the weakest tool allowed to break them. In each
 *   group the toughest thing takes that tool's maxSwings with the weakest
 *   tool, and everything else in the group scales down with its health.
 *   Better tools then either keep their vanilla advantage (pickaxe) or
 *   halve the swings per tier (axe, scythe). See CONFIG.
 *   The result is never more swings than the unmodded game.
 *
 * Nothing is written to save files. Health values stored on rocks that already
 * exist are left alone; only the damage per swing changes, so it applies
 * immediately to everything, including rocks already on the map.
 */

(() => {
    "use strict";
    const TAG = "[LessGrindHits]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // Per tool:
    //   maxSwings: hard ceiling for this tool. The toughest thing in each
    //              group takes exactly this many swings with the weakest tool
    //              allowed to break it.
    //   upgrade:   what a better tool gains over that weakest tool.
    //                "proportional"  damage in proportion to tier, as in the
    //                                unmodded game (tier 4 vs tier 2 = half the swings)
    //                "halve"         every tier above the minimum halves the
    //                                swings (rounded up): 4, 2, 1, 1
    //   toughest:  { minimum tool tier: health of the toughest thing in that group }
    //   overrides: exact swing counts by event name, as
    //                [Rusty, Basic, Sturdy, Quality, Superior].
    //              null in a slot means "use the rule for that tool".
    //              First matching entry wins.
    const TOOLS = {
        pickaxe: {
            maxSwings: 6,
            upgrade: "proportional",
            toughest: { 1: 10, 2: 28, 3: 40, 4: 60, 5: 70 },
            overrides: [
                { name: /^Rock \d/,    swings: [1, 1, 1, 1, 1] },          // plain stone, every area
                { name: /^Small Rock/, swings: [4, 2, 2, 1, 1] },
                { name: /^Big Rock/,   swings: [null, null, 5, 3, 2] }
            ]
        },
        axe: {
            maxSwings: 4,
            upgrade: "halve",
            toughest: { 1: 6, 2: 15, 3: 30, 4: 36, 5: 32 },
            // From Sturdy-tier trees upward: 4 swings with the first axe that
            // can cut them, then one fewer per better axe.
            overrides: [
                { name: /^(Hardwood|Spirit|Bonetree|Big Stump)/i, swings: [null, null, 4, 3, 2] },
                { name: /^(Coral|Vilewood)/i,                     swings: [null, null, null, 4, 3] },
                { name: /^Ancient/i,                              swings: [null, null, null, null, 4] }
            ]
        },
        scythe: {
            maxSwings: 2,
            upgrade: "halve",
            toughest: { 1: 4, 2: 4 },
            overrides: []
        }
    };

    // Vanilla quirk: the axe check stops at the FIRST axe it finds, weakest
    // first. Carrying a Rusty Axe together with a better one makes the game use
    // the Rusty one. (Pickaxe and scythe already use the best one you carry.)
    // true: always use the best axe you carry.
    const FIX_AXE_TIER = true;
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const VAR_DAMAGE_DONE = 24;    // "SV: A": damage dealt to this object so far
    const VAR_HEALTH      = 25;    // "SV: B": the object's health
    const DEFS = {
        pickaxe: { levelVar: 945, requiredVar: 944, items: [966, 968, 963, 934, 2076] },
        axe:     { levelVar: 943, requiredVar: 942, items: [945, 959, 958, 935, 2077] },
        scythe:  { levelVar: 947, requiredVar: 946, items: [944, 940, 939, 936, 2078] }
    };
    const TOOL_BY_LEVEL_VAR = {};
    for (const tool of Object.keys(DEFS)) TOOL_BY_LEVEL_VAR[DEFS[tool].levelVar] = tool;
    const AXE_CHECK_EVENT = { id: 907, name: "Check Axe Lv" };

    const api = window.LessGrindHits = {};

    // ------------------------------------------------------------------------
    // The table
    // ------------------------------------------------------------------------
    // Swings needed from full health. name may be "" when unknown.
    api.swingsFor = function(tool, tier, name, requiredTier, health) {
        const vanilla = Math.max(1, Math.ceil(health / tier));
        const config = TOOLS[tool];
        if (!config) return vanilla;
        const cap = config.maxSwings;

        for (const entry of config.overrides) {
            if (!entry.name.test(name)) continue;
            const exact = entry.swings[tier - 1];
            if (exact) return Math.max(1, Math.min(exact, cap));
            break;                                   // null: fall through to the rule
        }

        // Breakable clutter (crates, bones, bricks...) never sets a required
        // tier, so the variable holds a stale value there. Any tool works on it.
        const group = /^Clutter/.test(name) ? 1 : Math.max(1, Number(requiredTier) || 1);
        const toughest = config.toughest[group];
        let swings = vanilla;
        if (toughest > 0) {
            if (config.upgrade === "halve") {
                // Swings with the weakest allowed tool, then halved per tier above it.
                const withMinimumTool = Math.ceil(health * cap / toughest - 1e-9);
                swings = Math.ceil(withMinimumTool / Math.pow(2, Math.max(0, tier - group)) - 1e-9);
            } else {
                const scaledHealth = health * cap * group / toughest;
                swings = Math.ceil(scaledHealth / tier - 1e-9);
            }
        }
        return Math.max(1, Math.min(swings, vanilla, cap));
    };

    // ------------------------------------------------------------------------
    // Called by the patched damage command: how much damage this swing deals.
    // "interp" is the running event interpreter.
    // ------------------------------------------------------------------------
    api.damage = function(interp, tool) {
        const def = DEFS[tool];
        const tier = Number($gameVariables.value(def.levelVar)) || 0;
        try {
            const mapId = typeof interp.getTargetMapIdSelfVariable === "function"
                ? interp.getTargetMapIdSelfVariable() : $gameMap.mapId();
            const eventId = typeof interp.getTargetEventIdSelfVariable === "function"
                ? interp.getTargetEventIdSelfVariable() : interp.eventId();
            const health = Number($gameVariables.selfValue([mapId, eventId, VAR_HEALTH])) || 0;
            if (!(health > 0) || !(tier > 0)) return tier;

            let name = "";
            const event = $gameMap.event(eventId);
            if (event && typeof event.event === "function") {
                const data = event.event();          // spawned events return their template here
                if (data && typeof data.name === "string") name = data.name;
            }
            const swings = api.swingsFor(tool, tier, name, $gameVariables.value(def.requiredVar), health);
            // Equal shares of the health, plus a hair so rounding can never cost an extra swing.
            return health / swings + 1e-6;
        } catch (e) {
            console.warn(TAG + " Falling back to vanilla damage: " + e.message);
            return tier;
        }
    };

    // Best tier of a tool the party carries (0 = none).
    api.bestTier = function(tool) {
        const ids = DEFS[tool].items;
        for (let i = ids.length - 1; i >= 0; i--) {
            if ($gameParty.hasItem($dataItems[ids[i]])) return i + 1;
        }
        return 0;
    };

    // ------------------------------------------------------------------------
    // Patching. The game's swing events contain the command
    //   "damage done (SV: A) += <tool tier variable>"
    // (Control Variables, code 122: [24, 24, 1 add, 1 variable, tierVar]).
    // It becomes "+= script" calling api.damage. Applies to common events and
    // to any map event that carries its own copy of the command.
    // ------------------------------------------------------------------------
    const patchList = (list) => {
        let n = 0;
        for (const cmd of list) {
            const p = cmd.parameters;
            if (cmd.code === 122 && p[0] === VAR_DAMAGE_DONE && p[1] === VAR_DAMAGE_DONE && p[2] === 1 &&
                p[3] === 1 && TOOL_BY_LEVEL_VAR[p[4]]) {
                const tool = TOOL_BY_LEVEL_VAR[p[4]];
                p[3] = 4;
                p[4] = 'window.LessGrindHits.damage(this, "' + tool + '")';
                n++;
            }
        }
        return n;
    };

    // "Check Axe Lv": every "axe tier = N" assignment becomes "axe tier = best
    // axe carried", so the order of its if/else chain no longer matters.
    const patchAxeCheck = (events) => {
        if (!FIX_AXE_TIER) return 0;
        let ev = events[AXE_CHECK_EVENT.id];
        if (!ev || ev.name !== AXE_CHECK_EVENT.name) ev = events.find(e => e && e.name === AXE_CHECK_EVENT.name);
        if (!ev) {
            console.warn(TAG + ' Common event "' + AXE_CHECK_EVENT.name + '" not found; axe tier fix skipped.');
            return 0;
        }
        const levelVar = DEFS.axe.levelVar;
        let n = 0;
        for (const cmd of ev.list) {
            const p = cmd.parameters;
            if (cmd.code === 122 && p[0] === levelVar && p[1] === levelVar && p[2] === 0 && p[3] === 0) {
                p[3] = 4;
                p[4] = 'window.LessGrindHits.bestTier("axe")';
                n++;
            }
        }
        return n;
    };

    const patchCommonEvents = (events) => {
        if (!Array.isArray(events) || events.__lessGrindHitsPatched) return;
        events.__lessGrindHitsPatched = true;
        let swings = 0;
        for (const ev of events) {
            if (ev && Array.isArray(ev.list)) swings += patchList(ev.list);
        }
        console.log(TAG + " Swing commands patched in common events: " + swings + "; axe tier assignments: " + patchAxeCheck(events) + ".");
    };

    const patchMap = (map) => {
        if (!map || !Array.isArray(map.events) || map.__lessGrindHitsPatched) return;
        map.__lessGrindHitsPatched = true;
        for (const ev of map.events) {
            if (!ev || !Array.isArray(ev.pages)) continue;
            for (const page of ev.pages) {
                if (Array.isArray(page.list)) patchList(page.list);
            }
        }
    };

    if (typeof DataManager !== "undefined") {
        const _DataManager_onLoad = DataManager.onLoad;
        DataManager.onLoad = function(object) {
            _DataManager_onLoad.call(this, object);
            if (typeof $dataCommonEvents !== "undefined" && object === $dataCommonEvents) patchCommonEvents(object);
            else if (object && object.data && object.events) patchMap(object);
        };
        const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
        DataManager.isDatabaseLoaded = function() {
            const loaded = _DataManager_isDatabaseLoaded.call(this);
            if (loaded && typeof $dataCommonEvents !== "undefined" && $dataCommonEvents) patchCommonEvents($dataCommonEvents);
            return loaded;
        };
    } else {
        console.warn(TAG + " DataManager not found. Mod did nothing.");
    }
})();
