/*:
 * @target MZ
 * @plugindesc [LessGrindHits] Fewer swings for pickaxe, axe and scythe. Felled trees fall faster and you can walk away meanwhile.
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
 * Felled trees also tip over in about 1 second instead of 2.2, and you can
 * walk away while they fall (see TREE_FALL in CONFIG).
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

    // --- Tree fall ---
    // A felled tree tips over one small step at a time, in four phases of 15,
    // 8, 17 and 8 steps. Unmodded that takes about 2.2 seconds, and you stand
    // locked in place meanwhile:
    //   119 frames of tilting + 15 frames waiting for the landing screen shake.
    // With the values below the fall takes about 1 second (63 frames) and you
    // can walk away while it happens.
    const TREE_FALL = {
        enabled: true,
        // Frames between two tilt steps, one number per phase of the fall.
        // Unmodded [3, 3, 2, 2]. 1 is the fastest the game can do. A single
        // number (not a list) is used for all four phases.
        //   [1, 1, 1, 1] -> 48 frames (0.8 s)    [2, 1, 1, 1] -> 63 frames (1.05 s)
        //   [2, 2, 1, 1] -> 71 frames (1.2 s)    [2, 2, 2, 1] -> 88 frames (1.5 s)
        framesPerStep: [2, 1, 1, 1],
        // How much further each step tilts the tree. Unmodded 1. 2 halves the
        // number of steps, and so the time, once more.
        stepMultiplier: 1,
        // false: do not wait for the screen shake when the tree lands (it still plays).
        waitForShake: false,
        // true: you can walk from the moment the tree starts to fall. Only
        // walking is freed. The next swing, talking and the menu still wait
        // until the wood is in your bag, as in the unmodded game.
        moveWhileFalling: true
    };
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
    const TREE_FALL_EVENT = { id: 908, name: "Tree Fall Anim" };   // calls the "left" and "right" fall events
    const VAR_TILT        = 15;    // "Math": scratch variable the fall uses as the tilt angle
    const SWITCH_FALL_RIGHT = 622; // "Fall right"
    let fallEventId = 0;           // "Tree Fall Anim", resolved when the common events are patched
    let freeWalk = null;           // the event run that is felling a tree: { list, eventId }

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

    // The fall is two common events ("left" and "right") called by "Tree Fall Anim". Each runs
    // four loops of: rotate the tree to the angle, change the angle by a step, wait a few frames.
    const patchTreeFall = (events) => {
        if (!TREE_FALL || !TREE_FALL.enabled) return 0;
        let anim = events[TREE_FALL_EVENT.id];
        if (!anim || anim.name !== TREE_FALL_EVENT.name) anim = events.find(e => e && e.name === TREE_FALL_EVENT.name);
        if (!anim) {
            console.warn(TAG + ' Common event "' + TREE_FALL_EVENT.name + '" not found; tree fall speed unchanged.');
            return 0;
        }
        fallEventId = events.indexOf(anim);
        const perPhase = Array.isArray(TREE_FALL.framesPerStep) ? TREE_FALL.framesPerStep : [TREE_FALL.framesPerStep];
        const framesFor = (phase) => Math.max(1, Math.floor(Number(perPhase[Math.min(phase, perPhase.length - 1)]) || 1));
        const multiplier = Math.max(1, Math.floor(Number(TREE_FALL.stepMultiplier) || 1));
        const fallIds = [...new Set(anim.list.filter(cmd => cmd.code === 117).map(cmd => cmd.parameters[0]))];
        let n = 0;
        for (const id of fallIds) {
            const ev = events[id];
            if (!ev || !Array.isArray(ev.list)) continue;
            let phase = -1;                                              // which of the four loops we are in
            for (const cmd of ev.list) {
                const p = cmd.parameters;
                if (cmd.code === 112) {
                    phase++;
                } else if (cmd.code === 230 && phase >= 0 && p[0] !== framesFor(phase)) {
                    p[0] = framesFor(phase);                             // Wait: frames between steps
                    n++;
                } else if (cmd.code === 122 && p[0] === VAR_TILT && p[1] === VAR_TILT && (p[2] === 1 || p[2] === 2) &&
                           p[3] === 0 && multiplier > 1) {
                    p[4] = p[4] * multiplier;                            // angle += / -= step
                    n++;
                } else if (cmd.code === 225 && p[3] === true && !TREE_FALL.waitForShake) {
                    p[3] = false;                                        // Shake Screen: do not wait for it
                    n++;
                } else if (cmd.code === 121 && p[0] === SWITCH_FALL_RIGHT && p[1] === SWITCH_FALL_RIGHT && p[2] === 0) {
                    // The game leaves "Fall right" ON when a tree has landed (the left-hand fall
                    // switches its own flag OFF). Its safety timer then writes to the shared tilt
                    // variable two seconds later. Unmodded you are still locked at that point; with
                    // this mod you are not, so finish the way the left-hand fall does.
                    p[2] = 1;
                    n++;
                }
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
        console.log(TAG + " Swing commands patched in common events: " + swings + "; axe tier assignments: " + patchAxeCheck(events) +
            "; tree fall commands: " + patchTreeFall(events) + ".");
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

    // ------------------------------------------------------------------------
    // Walking while a tree falls
    // ------------------------------------------------------------------------
    // The fall runs inside the tree's own event, and the game does not let you walk while an
    // event runs. From the moment a tree starts to fall until its event has finished (the wood
    // is in your bag and the tree is gone), the walking check alone is told that no event is
    // running. Everything else still sees the event, so nothing new can start meanwhile.
    api.walkingIsFree = () => {
        const root = (typeof $gameMap !== "undefined" && $gameMap) ? $gameMap._interpreter : null;
        if (!root || !root._list) { freeWalk = null; return false; }
        if (freeWalk && (freeWalk.list !== root._list || freeWalk.eventId !== root._eventId)) freeWalk = null;
        if (freeWalk) return true;
        const fall = fallEventId > 0 ? $dataCommonEvents[fallEventId] : null;
        if (!fall) return false;
        for (let i = root._childInterpreter; i; i = i._childInterpreter) {
            if (i._list !== fall.list) continue;
            freeWalk = { list: root._list, eventId: root._eventId };
            // The swing switched the walking and running poses off until the event ends, and
            // without them you would glide in the standing pose. Switch them back on now; the
            // event does the same when it ends.
            if (typeof Galv !== "undefined" && Galv.CA && typeof Galv.CA.animStatus === "function") Galv.CA.animStatus(true);
            return true;
        }
        return false;
    };

    if (TREE_FALL && TREE_FALL.enabled && TREE_FALL.moveWhileFalling &&
        typeof Game_Player !== "undefined" && typeof Game_Map !== "undefined") {
        let walkCheck = false;                       // true only while the walking check below runs
        const _Game_Map_isEventRunning = Game_Map.prototype.isEventRunning;
        Game_Map.prototype.isEventRunning = function() {
            if (walkCheck) return false;
            return _Game_Map_isEventRunning.apply(this, arguments);
        };
        const _Game_Player_canMove = Game_Player.prototype.canMove;
        Game_Player.prototype.canMove = function() {
            if (!api.walkingIsFree()) return _Game_Player_canMove.apply(this, arguments);
            // Every other reason not to walk (a message on screen, a forced move, ...) still counts.
            walkCheck = true;
            try {
                return _Game_Player_canMove.apply(this, arguments);
            } finally {
                walkCheck = false;
            }
        };
    }

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
