/*:
 * @target MZ
 * @plugindesc [Espresso] Adds an Espresso drink: a stronger, 24-hour version of the Cup of Coffee speed boost.
 * @author Anders
 *
 * @help
 * ============================================================================
 * Espresso.js
 * ============================================================================
 * Adds one drink, "Espresso", brewed at the Coffee Maker. Drinking it gives
 * the same "Coffee" state as a Cup of Coffee, but marked as espresso strength:
 * faster movement, for ESPRESSO_HOURS in-game hours.
 *
 * How it is built, and what that means for your save:
 *  - The item does not get a new database ID. It takes over one of the game's
 *    blank "Empty" item slots (ITEM_SLOT), in memory only. If this mod is
 *    removed, any Espresso you still carry turns back into that blank "Empty"
 *    item instead of pointing at something that does not exist.
 *  - No new state is added. The boost uses the game's own Coffee state; the
 *    only extra data is a small "espresso" marker on the game's timer entry
 *    for that state. Without the mod the marker is ignored and the boost
 *    behaves like a normal coffee.
 *  - The recipe is added in memory. The game's own crafting sync removes
 *    recipes that no longer exist when a save is loaded.
 *  - If a game update ever fills ITEM_SLOT with a real item, this mod notices,
 *    switches itself off and logs a warning rather than overwrite that item.
 *
 * Works with or without the LessGrind mod. A normal coffee never replaces a
 * running espresso; an espresso always replaces a running coffee.
 */

(() => {
    "use strict";
    const TAG = "[Espresso]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // Blank "Empty" item slot that becomes the Espresso. Do not change this
    // once you own Espressos: the save remembers them by this number.
    const ITEM_SLOT = 1400;

    const ITEM_NAME  = "Espresso";
    const ITEM_PRICE = 200;      // shop / sell value (Cup of Coffee is 100)

    // In-game hours the boost lasts.
    const ESPRESSO_HOURS = 24;

    // Movement speed while the espresso boost is active, as the game's speed
    // value (each +1 doubles your speed; the game caps it at 6.5).
    // For reference, no boost: walk 4.0, run on foot 4.5, bike 5.0.
    const SPEED = { walk: 4.85, run: 5.3, bike: 5.8 };

    // Coffee Maker recipe: this many Coffee Beans of any quality (a Cup of
    // Coffee takes 3). Set to 0 to add no recipe.
    const RECIPE_BEANS = 6;
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const COFFEE_STATE_ID = 243;                       // the game's "Coffee" state
    const COFFEE_ITEM = { id: 2043, name: "Cup of Coffee" };
    const COFFEE_EVENT = { id: 1132, name: "Coffee Buff" };
    const COFFEE_RECIPE = "Cup of Coffee";
    const SPEED_CAP = 6.5;

    const MESSAGE_1 = "The \\c[6]Espresso\\c[0] hits like a truck!";
    const MESSAGE_2 = "A strong \\c[0]Movement Speed\\c[0] boost for \\c[6]" + ESPRESSO_HOURS + " hours\\c[0].";
    const DESCRIPTION = "A strong \\c[6]Movement Speed\\c[0] boost for \\c[6]" + ESPRESSO_HOURS +
        " hours\\c[0]. Stronger than a \\c[6]Cup of Coffee\\c[0].";

    // Set by the Espresso's own event right before it adds the Coffee state,
    // so the state hook below knows which drink it was.
    // itemId and enabled let other mods (the Espresso Machine) hand out the drink.
    const shared = window.EspressoMod = { pending: false, enabled: false, itemId: ITEM_SLOT };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const safeParse = (text, fallback) => {
        try { return JSON.parse(text); } catch (e) { return fallback; }
    };
    const isBlankSlot = (item) => !!item && (item.name.trim() === "" || item.name.trim().toLowerCase() === "empty") &&
        (!item.effects || item.effects.length === 0);

    // ------------------------------------------------------------------------
    // Database setup: runs once the item and common event files are loaded,
    // which is before the game creates any game objects or opens a save.
    // ------------------------------------------------------------------------
    const findCoffeeEvent = (list) => {
        const byId = list[COFFEE_EVENT.id];
        if (byId && byId.name === COFFEE_EVENT.name) return byId;
        return list.find(ev => ev && ev.name === COFFEE_EVENT.name) || null;
    };

    const buildEvent = (coffeeEvent, id) => {
        const list = clone(coffeeEvent.list);
        const textLines = list.filter(cmd => cmd.code === 401);
        if (textLines[0]) textLines[0].parameters[0] = MESSAGE_1;
        if (textLines[1]) textLines[1].parameters[0] = MESSAGE_2;
        // Mark the drink as an espresso just before the state is added.
        const stateIndex = list.findIndex(cmd => cmd.code === 313 && cmd.parameters[3] === COFFEE_STATE_ID);
        if (stateIndex < 0) return null;
        list.splice(stateIndex, 0, { code: 355, indent: list[stateIndex].indent, parameters: ["window.EspressoMod.pending = true;"] });
        return { id: id, list: list, name: "Espresso Buff", switchId: coffeeEvent.switchId, trigger: 0 };
    };

    const addRecipe = () => {
        if (RECIPE_BEANS <= 0) return "no recipe (RECIPE_BEANS is 0)";
        if (typeof CGMZ === "undefined" || !CGMZ.Crafting || !Array.isArray(CGMZ.Crafting.Recipes)) return "crafting plugin not found";
        const recipes = CGMZ.Crafting.Recipes;
        if (recipes.some(r => (safeParse(r, {}) || {}).Name === ITEM_NAME)) return "already present";
        const source = recipes.map(r => safeParse(r, null)).find(r => r && r.Name === COFFEE_RECIPE);
        if (!source) return "Cup of Coffee recipe not found";
        const recipe = clone(source);
        recipe.Name = ITEM_NAME;
        recipe.Products = JSON.stringify([JSON.stringify({
            Item: String(ITEM_SLOT), Weapon: "0", Armor: "0", Gold: "false", Generic: "", Amount: "1"
        })]);
        const beans = (safeParse(source.Ingredients, []) || []).map(entry => safeParse(entry, null)).filter(Boolean);
        if (beans.length !== 1) return "unexpected Cup of Coffee ingredients";
        beans[0].Amount = String(RECIPE_BEANS);
        recipe.Ingredients = JSON.stringify([JSON.stringify(beans[0])]);
        recipes.push(JSON.stringify(recipe));
        return "added (" + RECIPE_BEANS + " beans)";
    };

    const trySetup = () => {
        const items = typeof $dataItems !== "undefined" ? $dataItems : null;
        const events = typeof $dataCommonEvents !== "undefined" ? $dataCommonEvents : null;
        if (!Array.isArray(items) || !Array.isArray(events) || items.__espressoDone) return;
        items.__espressoDone = true;
        shared.enabled = false;

        const coffee = items[COFFEE_ITEM.id];
        const coffeeEvent = findCoffeeEvent(events);
        if (!coffee || coffee.name !== COFFEE_ITEM.name || !coffeeEvent) {
            console.warn(TAG + " Cup of Coffee or its event was not found. Mod disabled.");
            return;
        }
        if (!isBlankSlot(items[ITEM_SLOT])) {
            console.warn(TAG + " Item slot " + ITEM_SLOT + " is no longer blank (a game update may have used it). Mod disabled to avoid overwriting it.");
            return;
        }

        const event = buildEvent(coffeeEvent, events.length);
        if (!event) {
            console.warn(TAG + " Coffee event has an unexpected layout. Mod disabled.");
            return;
        }
        events.push(event);

        const item = clone(coffee);
        delete item.meta;
        item.id = ITEM_SLOT;
        item.name = ITEM_NAME;
        item.description = DESCRIPTION;
        item.price = ITEM_PRICE;
        item.effects = [{ code: 44, dataId: event.id, value1: 1, value2: 0 }];
        // Keep it out of the encyclopedia so its entry list and completion
        // count stay exactly as in the unmodded game.
        if (!/<cgmzencyclopediahide>/i.test(item.note)) item.note += "\n<cgmzencyclopediahide>";
        if (typeof DataManager !== "undefined" && DataManager.extractMetadata) DataManager.extractMetadata(item);
        items[ITEM_SLOT] = item;

        shared.enabled = true;
        console.log(TAG + " Item ready in slot " + ITEM_SLOT + ", event " + event.id + ", recipe: " + addRecipe() + ".");
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
    }

    // ------------------------------------------------------------------------
    // Timer entry helpers. The game's time plugin keeps one entry per timed
    // state in Game_Time._actorStates: { actorId, stateId, gameTime }.
    // ------------------------------------------------------------------------
    const timersAvailable = () => typeof Game_Time !== "undefined" && Array.isArray(Game_Time._actorStates) &&
        typeof $gameTime !== "undefined" && !!$gameTime;
    const findEntry = (actorId) => Game_Time._actorStates.find(s => s.actorId === actorId && s.stateId === COFFEE_STATE_ID);

    // ------------------------------------------------------------------------
    // Drinking: decide whether the Coffee state that was just added is an
    // espresso, and set its end time.
    // ------------------------------------------------------------------------
    if (typeof Game_Battler !== "undefined") {
        const _Game_Battler_addState = Game_Battler.prototype.addState;
        Game_Battler.prototype.addState = function(stateId) {
            // _wteIgnoreTimerRefresh: the game is re-applying a running buff
            // after a full heal; that must not change anything.
            const tracking = stateId === COFFEE_STATE_ID && this.isActor() && !this._wteIgnoreTimerRefresh && timersAvailable();
            if (!tracking) {
                _Game_Battler_addState.call(this, stateId);
                return;
            }
            const before = findEntry(this.actorId());
            const runningEspresso = before && before.espresso && this.isStateAffected(COFFEE_STATE_ID) ? before.gameTime : null;

            _Game_Battler_addState.call(this, stateId);

            const isEspresso = shared.pending;
            shared.pending = false;
            const entry = findEntry(this.actorId());
            if (!entry) return;
            if (isEspresso) {
                entry.espresso = true;
                entry.gameTime = $gameTime.clone().add("hour", ESPRESSO_HOURS);
            } else if (runningEspresso) {
                // A normal coffee on top of an espresso: keep the espresso as it was.
                entry.espresso = true;
                entry.gameTime = runningEspresso;
            } else {
                delete entry.espresso;
            }
        };
    }

    // ------------------------------------------------------------------------
    // Speed: while the espresso boost is active, use the SPEED values instead
    // of what the game's footsteps plugin (WTE_Footsteps) calculated.
    // ------------------------------------------------------------------------
    const espressoActive = () => {
        if (!timersAvailable() || typeof $gameParty === "undefined" || !$gameParty) return false;
        const leader = $gameParty.leader();
        if (!leader || !leader.isStateAffected(COFFEE_STATE_ID)) return false;
        const entry = findEntry(leader.actorId());
        return !!(entry && entry.espresso);
    };

    if (typeof Game_Player !== "undefined") {
        const _Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
        Game_Player.prototype.realMoveSpeed = function() {
            const inner = _Game_Player_realMoveSpeed.call(this);
            // Cutscenes and the plugin's own "off" switch leave _wteCachedSpeed
            // unset; stay out of the way then.
            if (this._wteIsCutscene || this._wteCachedSpeed === null || this._wteCachedSpeed === undefined) return inner;
            if (!espressoActive()) return inner;

            let speed = this._wteIsBiking ? SPEED.bike : this._wteIsRunning ? SPEED.run : SPEED.walk;
            speed = Math.min(speed, SPEED_CAP);
            // Same diagonal compensation the footsteps plugin applies to speed states.
            if (this._diagDir && this._diagDir !== 0) {
                const diagMod = (typeof Galv !== "undefined" && Galv.PMOVE) ? Galv.PMOVE.diagMod : 0.707;
                if (diagMod > 0) speed += Math.abs(Math.log2(diagMod));
            }
            return speed;
        };
    }

    console.log(TAG + " Loaded. Item slot " + ITEM_SLOT + ", " + ESPRESSO_HOURS + "h, speeds " + JSON.stringify(SPEED) + ".");
})();
