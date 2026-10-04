/*:
 * @target MZ
 * @plugindesc [LessGrind] Cheap tool upgrades, cheap Greater Rain Offering and Preserving Barrel, 1-day Barrel / Keg / Cask, cheap and bigger trough upgrades.
 * @author Anders
 *
 * @help
 * ============================================================================
 * LessGrind.js
 * ============================================================================
 * Three things happen at game load, before any save is opened:
 *
 *  1. CRAFTING COSTS - the CGMZ Crafting recipe definitions
 *     (CGMZ.Crafting.Recipes) are rewritten with the ingredients listed in
 *     NEW_MATERIALS below.
 *
 *  2. PROCESSING TIMES - the common events that set how many days the
 *     Preserving Barrel, Keg and Cask take are patched in memory
 *     ($dataCommonEvents) with the day counts listed below.
 *
 *  3. TROUGH UPGRADE - Klaus's "Trough Upgrade" costs less and adds more
 *     capacity per purchase (same in-memory patching).
 *
 * Nothing is written to the game's own files, so the mod can be removed at
 * any time (rename the folder to "!LessGrind" to disable). Things you buy
 * or start while it is active (for example trough capacity) stay in your
 * save as normal game progress.
 *
 * Only the CONFIG section needs editing. An ingredient is [itemId, amount];
 * item IDs are listed in docs/ItemList.csv of the mod collection (e.g. 91 = Iron Bar,
 * 75 = Wood, 450 = Copper Bar).
 */

(() => {
    "use strict";
    const TAG = "[LessGrind]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    const IRON_BAR = 91;
    const WOOD     = 75;
    // "generic:<Type>" matches any item tagged <cgmzcraftinggeneric:Type> in
    // data/Items.json, e.g. "generic:Wheat" accepts Wheat of every quality.
    const ANY_WHEAT = "generic:Wheat";

    // Special cost: keep the recipe's original ingredient types (including the
    // previous-tier tool) but require only 1 of each.
    const ONE_OF_EACH = "one-of-each";

    // Cost of every tool upgrade at the Upgrade station. Either:
    //   ONE_OF_EACH        e.g. Quality Pickaxe = Sturdy Pickaxe + 1 Hardwood,
    //                      1 Void Crystal Bar, 1 Verdite Bar, 1 Green Crystal
    //   [[IRON_BAR, 1]]    previous tool + 1 Iron Bar for every tier
    const TOOL_UPGRADE_COST = ONE_OF_EACH;

    // Only used with a materials list like [[IRON_BAR, 1]]: when true, the
    // upgrade still consumes the previous-tier tool (so the tiers must be done
    // in order and you never end up with duplicate tools).
    const KEEP_PREVIOUS_TOOL = true;

    // New material cost per recipe. Recipe names must match the game's
    // internal recipe "Name" exactly.
    const NEW_MATERIALS = {
        // --- Tool upgrades (crafted at the Upgrade station) ---
        "Sturdy Watering Can":    TOOL_UPGRADE_COST,
        "Sturdy Gardening Hoe":   TOOL_UPGRADE_COST,
        "Sturdy Pickaxe":         TOOL_UPGRADE_COST,
        "Sturdy Axe":             TOOL_UPGRADE_COST,
        "Quality Watering Can":   TOOL_UPGRADE_COST,
        "Quality Gardening Hoe":  TOOL_UPGRADE_COST,
        "Quality Pickaxe":        TOOL_UPGRADE_COST,
        "Quality Axe":            TOOL_UPGRADE_COST,
        "Superior Watering Can":  TOOL_UPGRADE_COST,
        "Superior Gardening Hoe": TOOL_UPGRADE_COST,
        "Superior Pickaxe":       TOOL_UPGRADE_COST,
        "Superior Axe":           TOOL_UPGRADE_COST,
        "Basic Scythe":           TOOL_UPGRADE_COST,
        "Sturdy Scythe":          TOOL_UPGRADE_COST,
        "Quality Scythe":         TOOL_UPGRADE_COST,
        "Superior Scythe":        TOOL_UPGRADE_COST,
        "Sturdy Fishing Rod":     TOOL_UPGRADE_COST,
        "Quality Fishing Rod":    TOOL_UPGRADE_COST,

        // --- Rain rituals (crafted at the Witching Mortar) ---
        // Greater = waters crops 16 days. Lesser (4 days) and Medium (8 days)
        // are left at their vanilla cost; uncomment to cheapen them too.
        "Greater Offering of Rain": [[ANY_WHEAT, 1]],
        // "Lesser Offering of Rain":  [[ANY_WHEAT, 1]],
        // "Medium Offering of Rain":  [[ANY_WHEAT, 1]],

        // --- Placeable machines ---
        "Preserving Barrel": [[WOOD, 1]]
    };

    // Item IDs of the tools themselves. Original ingredients with one of these
    // IDs are kept when KEEP_PREVIOUS_TOOL is true; everything else is dropped.
    const TOOL_ITEM_IDS = new Set([
        999, 1000, 966, 968, 945, 959,   // Basic / Rusty can, hoe, pickaxe, axe
        965, 964, 963, 958,              // Sturdy
        932, 933, 934, 935,              // Quality
        2074, 2075, 2076, 2077,          // Superior
        944, 940, 939, 936, 2078,        // Scythes: Rusty, Basic, Sturdy, Quality, Superior
        187, 188, 189                    // Fishing rods: Old, Sturdy, Quality
    ]);

    // --- Processing times (in days) ---
    const BARREL_DAYS         = 1;   // vanilla 3  (Preserving Barrel, per batch)
    const KEG_DAYS            = 1;   // vanilla 5  (Keg, per batch)
    const CASK_DAYS_PER_STAGE = 1;   // vanilla 7  (Cask: 4 aging stages, so 1-2-3-4 days)

    // Vanilla finishes day-based processors one day LATER than the
    // "Check back in N days" message says, because the finish check uses
    // "finish day is less than today". With this on, it becomes "less than
    // or equal", so N days means ready N mornings later. This also applies
    // to the Drying Rack, which shares the Keg's finish check.
    const FIX_OFF_BY_ONE = true;

    // --- Feeding trough upgrade (Klaus, build menu "Trough Upgrade") ---
    // A field holds 8 animals, so 16 = two days of feed per upgrade.
    const TROUGH_STEP       = 16;    // vanilla 4. Capacity added per upgrade. Keep it a multiple of 4.
    const TROUGH_COST_WOOD  = 15;    // vanilla 30
    const TROUGH_COST_STONE = 15;    // vanilla 30
    const TROUGH_COST_GOLD  = 500;   // vanilla 1500
    // "Add feed" number box: vanilla allows 2 digits (99 at a time).
    const TROUGH_INPUT_DIGITS = 3;
    // false: troughs you already upgraded keep their current capacity; only
    //        new upgrades add TROUGH_STEP.
    // true:  the game's own safety check is also changed so that capacity is
    //        never below 8 + (upgrades bought so far x TROUGH_STEP). Past
    //        upgrades are then re-valued the next time you enter the Ranch.
    //        That raise is stored in your save and stays if the mod is removed.
    const TROUGH_RETROACTIVE = false;

    // --- Coffee (Cup of Coffee gives the "Coffee" movement speed state) ---
    // In-game hours the boost lasts. Vanilla 4. Applies to cups drunk while the
    // mod is active; a boost that is already running keeps its original end time.
    const COFFEE_HOURS = 6;
    // Movement speed while the coffee boost is active, as the game's speed
    // value (each +1 doubles your speed; the game caps it at 6.5).
    //   no boost:        walk 4.0,  run on foot 4.5,  bike 5.0
    //   vanilla coffee:  walk 4.4,  run on foot 4.85, bike 5.16
    // Set to null to keep the vanilla coffee speeds.
    const COFFEE_SPEED = { walk: 4.5, run: 5.0, bike: 5.5 };

    // --- Equipment ---
    // Replaces the stats of a piece of equipment. The eight numbers are, in order:
    //   Max HP, Max MP, Attack, Defense, M. Attack, M. Defense, Agility, Luck
    // Gems you put on the item are added on top, as usual. type: "armor" or
    // "weapon"; id and name as in docs/ItemList.csv. [] = change nothing.
    const EQUIPMENT_STATS = [
        // Lucky Horseshoe (trinket). Unmodded: -2 Max HP, -2 Defense, -2 M. Defense, +10 Luck.
        { type: "armor", id: 412, name: "Lucky Horseshoe", stats: [10, 10, 10, 10, 10, 10, 10, 30] }
    ];

    // (How many swings rocks, trees and grass take is handled by the separate
    // LessGrindHits mod.)
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const safeParse = (text, fallback) => {
        try { return JSON.parse(text); } catch (e) { return fallback; }
    };

    // ------------------------------------------------------------------------
    // Part 1: crafting recipe costs
    // ------------------------------------------------------------------------
    const patchRecipes = () => {
        if (typeof CGMZ === "undefined" || !CGMZ.Crafting || !Array.isArray(CGMZ.Crafting.Recipes)) {
            console.warn(TAG + " CGMZ_Crafting recipe list not found. Recipe costs unchanged.");
            return;
        }

        // CGMZ stores each ingredient as a JSON string with these exact fields.
        const makeIngredient = (idOrGeneric, amount) => {
            const isGeneric = typeof idOrGeneric === "string" && idOrGeneric.startsWith("generic:");
            return JSON.stringify({
                Item: isGeneric ? "0" : String(idOrGeneric),
                Weapon: "0", Armor: "0", Gold: "false",
                Generic: isGeneric ? idOrGeneric.slice("generic:".length) : "",
                Amount: String(amount)
            });
        };

        const recipes = CGMZ.Crafting.Recipes;
        const remaining = new Set(Object.keys(NEW_MATERIALS));
        let patched = 0;

        for (let i = 0; i < recipes.length; i++) {
            const recipe = safeParse(recipes[i], null);
            if (!recipe || !NEW_MATERIALS.hasOwnProperty(recipe.Name)) continue;

            const spec = NEW_MATERIALS[recipe.Name];
            const original = safeParse(recipe.Ingredients, []);
            let ingredients;
            if (spec === ONE_OF_EACH) {
                // Same ingredient types as the game's recipe, quantity 1 each.
                ingredients = original.map(entry => {
                    const ing = safeParse(entry, null);
                    if (!ing) return entry;
                    ing.Amount = "1";
                    return JSON.stringify(ing);
                });
            } else {
                const kept = KEEP_PREVIOUS_TOOL
                    ? original.filter(entry => {
                        const ing = safeParse(entry, null);
                        return ing && TOOL_ITEM_IDS.has(Number(ing.Item));
                    })
                    : [];
                ingredients = kept.concat(spec.map(([id, amt]) => makeIngredient(id, amt)));
            }

            recipe.Ingredients = JSON.stringify(ingredients);
            recipes[i] = JSON.stringify(recipe);
            remaining.delete(recipe.Name);
            patched++;
        }

        console.log(TAG + " Patched " + patched + " crafting recipe(s).");
        if (remaining.size > 0) {
            console.warn(TAG + " Recipes not found (renamed or removed by a game update?): " + [...remaining].join(", "));
        }
    };

    // ------------------------------------------------------------------------
    // Part 2 and 3: event data patches, applied in memory
    // ------------------------------------------------------------------------
    const VAR_MATH            = 15;    // "Math" scratch variable
    const VAR_SMELTER_TIME    = 106;   // "SV: Smelter Time"     (Barrel / Keg days)
    const VAR_CASK_PROC_TIME  = 1288;  // "SV: Processing Time"  (Cask days per stage)
    const VAR_DAY_COUNTER     = 250;   // "Day Counter"
    const VAR_COST_AMT_1      = 986;   // "Cost item amt 1"      (trough: Wood)
    const VAR_COST_AMT_2      = 987;   // "Cost item amt 2"      (trough: Stone)
    const VAR_COST_GOLD       = 991;   // "Cost money amt"
    const VAR_TROUGH_LEVEL_FIRST = 1641, VAR_TROUGH_LEVEL_LAST = 1644; // "Trough A..D Level"
    const VANILLA_TROUGH_STEP = 4;
    const OP_LESS = 4, OP_LESS_EQUAL = 2; // Conditional Branch operator codes

    // Common events are looked up by ID and verified by name; if a game update
    // moves them, they are searched by name instead.
    const EVENTS = {
        barrelCheck:   { id: 997,  name: "Check preserves Item" },
        kegCheck:      { id: 1007, name: "Check keg Item" },
        caskCheck:     { id: 2474, name: "Check Cask Item" },
        barrelWait:    { id: 1000, name: "Aging Process" },
        kegWait:       { id: 1010, name: "Keg Process 2" },
        troughCost:    { id: 2977, name: "Trough +" },
        troughUpgrade: { id: 894,  name: "Choose trough upgrade field" },
        troughUse:     { id: 886,  name: "Trough" },
        coffeeBuff:    { id: 1132, name: "Coffee Buff" }
    };

    const COFFEE_STATE_ID = 243;       // "Coffee" state
    const COFFEE_ITEM_ID = 2043;       // "Cup of Coffee"
    const VANILLA_COFFEE_HOURS = 4;
    const VANILLA_COFFEE_TEXT = /\b4 hours\b/;
    const coffeeText = (text) => text.replace(VANILLA_COFFEE_TEXT, COFFEE_HOURS + " hours");

    const findEvent = (list, spec) => {
        const byId = list[spec.id];
        if (byId && byId.name === spec.name) return byId;
        return list.find(ev => ev && ev.name === spec.name) || null;
    };

    // Control Variables (code 122): [startId, endId, operation(0 = set), operandType(0 = constant), value]
    // keepZero: leave "reset to 0" lines alone.
    const setConstantAssignments = (ev, varId, newValue, keepZero) => {
        let n = 0;
        for (const cmd of ev.list) {
            const p = cmd.parameters;
            if (cmd.code === 122 && p[0] === varId && p[1] === varId && p[2] === 0 && p[3] === 0 && p[4] !== newValue) {
                if (keepZero && p[4] === 0) continue;
                p[4] = newValue;
                n++;
            }
        }
        return n;
    };

    // Conditional Branch (code 111), variable type: [1, varId, 1 (compare to variable), otherVarId, operator]
    const relaxFinishCheck = (ev) => {
        let n = 0;
        for (const cmd of ev.list) {
            const p = cmd.parameters;
            if (cmd.code === 111 && p[0] === 1 && p[1] === VAR_SMELTER_TIME && p[2] === 1 && p[3] === VAR_DAY_COUNTER && p[4] === OP_LESS) {
                p[4] = OP_LESS_EQUAL;
                n++;
            }
        }
        return n;
    };

    // --- Trough -------------------------------------------------------------
    // What Klaus actually charges (the menu shows its own copy, patched below).
    const patchTroughCost = (ev) =>
        setConstantAssignments(ev, VAR_COST_AMT_1, TROUGH_COST_WOOD, true) +
        setConstantAssignments(ev, VAR_COST_AMT_2, TROUGH_COST_STONE, true) +
        setConstantAssignments(ev, VAR_COST_GOLD, TROUGH_COST_GOLD, true);

    // "Math += 4" after reading a trough's capacity: the amount one upgrade adds.
    const patchTroughStep = (ev) => {
        let n = 0;
        for (const cmd of ev.list) {
            const p = cmd.parameters;
            if (cmd.code === 122 && p[0] === VAR_MATH && p[1] === VAR_MATH && p[2] === 1 && p[3] === 0 && p[4] === VANILLA_TROUGH_STEP && TROUGH_STEP !== VANILLA_TROUGH_STEP) {
                p[4] = TROUGH_STEP;
                n++;
            }
        }
        return n;
    };

    // Input Number (code 103): [variableId, digits] for "Add how many?"
    const patchTroughInput = (ev) => {
        let n = 0;
        for (const cmd of ev.list) {
            if (cmd.code === 103 && cmd.parameters[1] < TROUGH_INPUT_DIGITS) {
                cmd.parameters[1] = TROUGH_INPUT_DIGITS;
                n++;
            }
        }
        return n;
    };

    // The build menu (WTE_VisualChoiceMenu) carries its own copy of the price,
    // materials and description text for each entry. Update the entry that
    // runs the trough cost event so the screen matches what is charged.
    const patchTroughMenus = (list, costEventId) => {
        let n = 0;
        for (const ev of list) {
            if (!ev || !Array.isArray(ev.list)) continue;
            for (const cmd of ev.list) {
                if (cmd.code !== 357 || cmd.parameters[0] !== "WTE_VisualChoiceMenu") continue;
                const args = cmd.parameters[3];
                if (!args || typeof args.choices !== "string" || !args.choices.includes(String(costEventId))) continue;
                const choices = safeParse(args.choices, null);
                if (!Array.isArray(choices)) continue;
                let changed = false;
                for (let i = 0; i < choices.length; i++) {
                    const choice = safeParse(choices[i], null);
                    if (!choice || Number(choice.commonEventId) !== costEventId) continue;
                    choice.price = String(TROUGH_COST_GOLD);
                    choice.mat1_qty = String(TROUGH_COST_WOOD);
                    choice.mat2_qty = String(TROUGH_COST_STONE);
                    if (typeof choice.description === "string") {
                        choice.description = choice.description.replace("+" + VANILLA_TROUGH_STEP + " ", "+" + TROUGH_STEP + " ");
                    }
                    choices[i] = JSON.stringify(choice);
                    changed = true;
                    n++;
                }
                if (changed) args.choices = JSON.stringify(choices);
            }
        }
        return n;
    };

    // Ranch trough events keep capacity at least "8 + level x 4". With
    // TROUGH_RETROACTIVE the 4 becomes TROUGH_STEP.
    const patchTroughFloor = (map) => {
        if (!TROUGH_RETROACTIVE || TROUGH_STEP === VANILLA_TROUGH_STEP) return;
        if (!map || !Array.isArray(map.events) || map.__lessGrindPatched) return;
        map.__lessGrindPatched = true;
        for (const ev of map.events) {
            if (!ev || !Array.isArray(ev.pages)) continue;
            for (const page of ev.pages) {
                const l = page.list || [];
                for (let k = 0; k + 1 < l.length; k++) {
                    const a = l[k], b = l[k + 1];
                    if (a.code === 122 && a.parameters[2] === 0 && a.parameters[3] === 1 &&
                        a.parameters[4] >= VAR_TROUGH_LEVEL_FIRST && a.parameters[4] <= VAR_TROUGH_LEVEL_LAST &&
                        b.code === 122 && b.parameters[0] === a.parameters[0] && b.parameters[2] === 3 &&
                        b.parameters[3] === 0 && b.parameters[4] === VANILLA_TROUGH_STEP) {
                        b.parameters[4] = TROUGH_STEP;
                    }
                }
            }
        }
    };

    // --- Coffee text ----------------------------------------------------------
    // The "for 4 hours" message shown when drinking (Show Text lines, code 401).
    const patchCoffeeMessage = (ev) => {
        let n = 0;
        for (const cmd of ev.list) {
            if (cmd.code !== 401 || typeof cmd.parameters[0] !== "string") continue;
            const updated = coffeeText(cmd.parameters[0]);
            if (updated !== cmd.parameters[0]) {
                cmd.parameters[0] = updated;
                n++;
            }
        }
        return n;
    };

    // The item's description line ("Adds +1 Movement Speed for 4 hours.").
    const patchCoffeeItem = (list) => {
        if (!Array.isArray(list) || list.__lessGrindPatched) return;
        list.__lessGrindPatched = true;
        const item = list[COFFEE_ITEM_ID];
        if (item && typeof item.description === "string") item.description = coffeeText(item.description);
    };

    // Equipment stats. This runs when the weapon / armor file is loaded, which is before the
    // game's upgrade system takes its copy of the "unmodded" stats. So it sees these numbers
    // as the item's own, and gem upgrades stored in a save are added on top of them.
    const patchEquipment = (list, type) => {
        if (!Array.isArray(list) || list.__lessGrindEquipment) return;
        list.__lessGrindEquipment = true;
        for (const entry of (typeof EQUIPMENT_STATS !== "undefined" && EQUIPMENT_STATS) || []) {
            if (entry.type !== type) continue;
            // The game writes an upgrade level into some names ("Lucky Horseshoe +1").
            const matches = (item) => !!item && String(item.name).startsWith(entry.name);
            const item = matches(list[entry.id]) ? list[entry.id] : list.find(matches);
            if (!item || !Array.isArray(item.params) || !Array.isArray(entry.stats) || entry.stats.length !== item.params.length) {
                console.warn(TAG + " Equipment \"" + entry.name + "\" not found or its stats have an unexpected shape; left unchanged.");
                continue;
            }
            const before = item.params.join(", ");
            item.params = entry.stats.map(n => Math.round(Number(n) || 0));
            console.log(TAG + " " + item.name + ": stats " + before + " -> " + item.params.join(", ") + ".");
        }
    };

    const patchCommonEvents = (list) => {
        if (!Array.isArray(list) || list.__lessGrindPatched) return;
        list.__lessGrindPatched = true;

        const jobs = [
            [EVENTS.barrelCheck,   ev => setConstantAssignments(ev, VAR_SMELTER_TIME, BARREL_DAYS)],
            [EVENTS.kegCheck,      ev => setConstantAssignments(ev, VAR_SMELTER_TIME, KEG_DAYS)],
            [EVENTS.caskCheck,     ev => setConstantAssignments(ev, VAR_CASK_PROC_TIME, CASK_DAYS_PER_STAGE)],
            [EVENTS.troughCost,    patchTroughCost],
            [EVENTS.troughUpgrade, patchTroughStep],
            [EVENTS.troughUse,     patchTroughInput],
            [EVENTS.coffeeBuff,    patchCoffeeMessage]
        ];
        if (FIX_OFF_BY_ONE) {
            jobs.push([EVENTS.barrelWait, relaxFinishCheck], [EVENTS.kegWait, relaxFinishCheck]);
        }

        for (const [spec, job] of jobs) {
            const ev = findEvent(list, spec);
            if (!ev) {
                console.warn(TAG + ' Common event "' + spec.name + '" not found; skipped.');
                continue;
            }
            console.log(TAG + ' "' + ev.name + '": changed ' + job(ev) + " command(s).");
        }

        const costEvent = findEvent(list, EVENTS.troughCost);
        if (costEvent) {
            console.log(TAG + " Trough upgrade menu entries updated: " + patchTroughMenus(list, costEvent.id) + ".");
        }
    };

    const isMapObject = (object) => !!(object && object.data && object.events);

    if (typeof DataManager !== "undefined") {
        const _DataManager_onLoad = DataManager.onLoad;
        DataManager.onLoad = function(object) {
            _DataManager_onLoad.call(this, object);
            if (typeof $dataCommonEvents !== "undefined" && object === $dataCommonEvents) patchCommonEvents(object);
            else if (typeof $dataItems !== "undefined" && object === $dataItems) patchCoffeeItem(object);
            else if (typeof $dataArmors !== "undefined" && object === $dataArmors) patchEquipment(object, "armor");
            else if (typeof $dataWeapons !== "undefined" && object === $dataWeapons) patchEquipment(object, "weapon");
            else if (isMapObject(object)) patchTroughFloor(object);
        };

        // Fallback in case another plugin bypasses onLoad for this file.
        const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
        DataManager.isDatabaseLoaded = function() {
            const loaded = _DataManager_isDatabaseLoaded.call(this);
            if (loaded && typeof $dataCommonEvents !== "undefined" && $dataCommonEvents) patchCommonEvents($dataCommonEvents);
            if (loaded && typeof $dataArmors !== "undefined" && $dataArmors) patchEquipment($dataArmors, "armor");
            if (loaded && typeof $dataWeapons !== "undefined" && $dataWeapons) patchEquipment($dataWeapons, "weapon");
            return loaded;
        };
    } else {
        console.warn(TAG + " DataManager not found; processing times and trough changes not applied.");
    }

    // ------------------------------------------------------------------------
    // Part 4: coffee duration
    // The game's time plugin (WTE_TimeConverter) sets the end time of the Coffee
    // state to "now + 4 hours" whenever the state is added, and keeps that end
    // time in its timed-state list. Right after it does so, move the end time.
    // ------------------------------------------------------------------------
    if (typeof Game_Battler !== "undefined" && COFFEE_HOURS !== VANILLA_COFFEE_HOURS) {
        const _Game_Battler_addState = Game_Battler.prototype.addState;
        Game_Battler.prototype.addState = function(stateId) {
            _Game_Battler_addState.call(this, stateId);
            if (stateId !== COFFEE_STATE_ID) return;
            // _wteIgnoreTimerRefresh: the game is re-applying a running buff
            // (after a full heal) and must not restart its clock.
            if (!this.isActor() || this._wteIgnoreTimerRefresh) return;
            if (typeof $gameTime === "undefined" || !$gameTime || typeof Game_Time === "undefined") return;
            if (!Array.isArray(Game_Time._actorStates)) return;
            const actorId = this.actorId();
            const entry = Game_Time._actorStates.find(s => s.actorId === actorId && s.stateId === stateId);
            if (entry) entry.gameTime = $gameTime.clone().add("hour", COFFEE_HOURS);
        };
    }

    // ------------------------------------------------------------------------
    // Part 5: coffee speed
    // The game's footsteps plugin (WTE_Footsteps) works out the player's speed
    // and keeps it in _wteCachedSpeed, with flags for the current mode. While
    // the Coffee state is active, use COFFEE_SPEED for that mode instead.
    // ------------------------------------------------------------------------
    if (typeof Game_Player !== "undefined" && COFFEE_SPEED) {
        const SPEED_CAP = 6.5;
        const coffeeActive = () => {
            if (typeof $gameParty === "undefined" || !$gameParty) return false;
            const leader = $gameParty.leader();
            if (!leader || !leader.isStateAffected(COFFEE_STATE_ID)) return false;
            // A stronger drink from another mod (Espresso) marks the game's
            // timer entry; leave the speed to that mod then.
            if (typeof Game_Time !== "undefined" && Array.isArray(Game_Time._actorStates)) {
                const actorId = leader.actorId();
                const entry = Game_Time._actorStates.find(s => s.actorId === actorId && s.stateId === COFFEE_STATE_ID);
                if (entry && entry.espresso) return false;
            }
            return true;
        };

        const _Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
        Game_Player.prototype.realMoveSpeed = function() {
            const inner = _Game_Player_realMoveSpeed.call(this);
            // Cutscenes and the plugin's own "off" switch leave _wteCachedSpeed
            // unset; stay out of the way then.
            if (this._wteIsCutscene || this._wteCachedSpeed === null || this._wteCachedSpeed === undefined) return inner;
            if (!coffeeActive()) return inner;

            let speed = this._wteIsBiking ? COFFEE_SPEED.bike : this._wteIsRunning ? COFFEE_SPEED.run : COFFEE_SPEED.walk;
            speed = Math.min(speed, SPEED_CAP);
            // Same diagonal compensation the footsteps plugin applies to speed states.
            if (this._diagDir && this._diagDir !== 0) {
                const diagMod = (typeof Galv !== "undefined" && Galv.PMOVE) ? Galv.PMOVE.diagMod : 0.707;
                if (diagMod > 0) speed += Math.abs(Math.log2(diagMod));
            }
            return speed;
        };
    }

    // ------------------------------------------------------------------------
    patchRecipes();
})();
