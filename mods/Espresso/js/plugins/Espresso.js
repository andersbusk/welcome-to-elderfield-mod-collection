/*:
 * @target MZ
 * @plugindesc [Espresso] Adds Espresso, Double Espresso and Triple Espresso: stronger, 24-hour versions of the Cup of Coffee speed boost.
 * @author Anders
 *
 * @help
 * ============================================================================
 * Espresso.js
 * ============================================================================
 * Adds three drinks, brewed at the Coffee Maker: Espresso, Double Espresso and
 * Triple Espresso. Drinking one gives the same "Coffee" state as a Cup of
 * Coffee, but marked with its strength: faster movement, for ESPRESSO_HOURS
 * in-game hours. The stronger the drink, the faster you run and bike.
 *
 * How it is built, and what that means for your save:
 *  - The items do not get new database IDs. Each takes over one of the game's
 *    blank "Empty" item slots, in memory only. If this mod is removed, a drink
 *    you still carry turns back into that blank "Empty" item instead of
 *    pointing at something that does not exist.
 *  - No new state is added. The boost uses the game's own Coffee state; the
 *    only extra data is a small marker on the game's timer entry for that
 *    state. Without the mod the marker is ignored and the boost behaves like
 *    a normal coffee.
 *  - The recipes are added in memory. The game's own crafting sync removes
 *    recipes that no longer exist when a save is loaded.
 *  - If a game update ever fills one of the slots with a real item, this mod
 *    notices, leaves that drink out and logs a warning rather than overwrite
 *    the item.
 *
 * Works with or without the LessGrind mod. A weaker drink never replaces a
 * stronger one that is still running; an equal or stronger one replaces it
 * and starts the hours again.
 */

(() => {
    "use strict";
    const TAG = "[Espresso]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // The drinks, weakest first.
    //   slot:  blank "Empty" item slot the drink takes over. Do not change it
    //          once you own the drink: the save remembers it by this number.
    //   beans: Coffee Beans of any quality in the Coffee Maker recipe (a Cup of
    //          Coffee takes 3). 0 = no recipe.
    //   price: shop / sell value (Cup of Coffee is 100).
    //   speed: movement speed while the boost is active, as the game's speed
    //          value (each +1 doubles your speed; the game caps it at 6.5).
    //          For reference, no boost: walk 4.0, run on foot 4.5, bike 5.0.
    const DRINKS = [
        { slot: 1400, name: "Espresso",        beans: 4, price: 200, speed: { walk: 4.85, run: 5.3, bike: 5.8 } },
        { slot: 1403, name: "Double Espresso", beans: 5, price: 250, speed: { walk: 4.85, run: 5.5, bike: 6.0 } },
        { slot: 1404, name: "Triple Espresso", beans: 6, price: 300, speed: { walk: 4.85, run: 5.7, bike: 6.3 } }
    ];

    // In-game hours the boost lasts.
    const ESPRESSO_HOURS = 24;
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const COFFEE_STATE_ID = 243;                       // the game's "Coffee" state
    const COFFEE_ITEM = { id: 2043, name: "Cup of Coffee" };
    const COFFEE_EVENT = { id: 1132, name: "Coffee Buff" };
    const COFFEE_RECIPE = "Cup of Coffee";
    const SPEED_CAP = 6.5;
    const STRENGTH = ["strong", "very strong", "huge"];

    // pending: set by a drink's own event right before it adds the Coffee state, so the state
    // hook below knows which drink it was (1, 2 or 3).
    // enabled and itemId describe the plain Espresso and let other mods hand it out.
    const shared = window.EspressoMod = { pending: false, enabled: false, itemId: DRINKS[0].slot };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const safeParse = (text, fallback) => {
        try { return JSON.parse(text); } catch (e) { return fallback; }
    };
    const isBlankSlot = (item) => !!item && (item.name.trim() === "" || item.name.trim().toLowerCase() === "empty") &&
        (!item.effects || item.effects.length === 0);
    const boostText = (shots) => "A " + STRENGTH[Math.min(shots, STRENGTH.length) - 1] + " \\c[6]Movement Speed\\c[0] boost for \\c[6]" +
        ESPRESSO_HOURS + " hours\\c[0].";

    // ------------------------------------------------------------------------
    // Database setup: runs once the item and common event files are loaded,
    // which is before the game creates any game objects or opens a save.
    // ------------------------------------------------------------------------
    const findCoffeeEvent = (list) => {
        const byId = list[COFFEE_EVENT.id];
        if (byId && byId.name === COFFEE_EVENT.name) return byId;
        return list.find(ev => ev && ev.name === COFFEE_EVENT.name) || null;
    };

    const buildEvent = (coffeeEvent, id, drink, shots) => {
        const list = clone(coffeeEvent.list);
        const textLines = list.filter(cmd => cmd.code === 401);
        if (textLines[0]) textLines[0].parameters[0] = "The \\c[6]" + drink.name + "\\c[0] hits like a truck!";
        if (textLines[1]) textLines[1].parameters[0] = boostText(shots);
        // Mark the drink just before the state is added.
        const stateIndex = list.findIndex(cmd => cmd.code === 313 && cmd.parameters[3] === COFFEE_STATE_ID);
        if (stateIndex < 0) return null;
        list.splice(stateIndex, 0, { code: 355, indent: list[stateIndex].indent, parameters: ["window.EspressoMod.pending = " + shots + ";"] });
        return { id: id, list: list, name: drink.name + " Buff", switchId: coffeeEvent.switchId, trigger: 0 };
    };

    const addRecipe = (drink) => {
        if (!(drink.beans > 0)) return "no recipe";
        if (typeof CGMZ === "undefined" || !CGMZ.Crafting || !Array.isArray(CGMZ.Crafting.Recipes)) return "crafting plugin not found";
        const recipes = CGMZ.Crafting.Recipes;
        if (recipes.some(r => (safeParse(r, {}) || {}).Name === drink.name)) return "recipe already present";
        const source = recipes.map(r => safeParse(r, null)).find(r => r && r.Name === COFFEE_RECIPE);
        if (!source) return "Cup of Coffee recipe not found";
        const recipe = clone(source);
        recipe.Name = drink.name;
        recipe.Products = JSON.stringify([JSON.stringify({
            Item: String(drink.slot), Weapon: "0", Armor: "0", Gold: "false", Generic: "", Amount: "1"
        })]);
        const beans = (safeParse(source.Ingredients, []) || []).map(entry => safeParse(entry, null)).filter(Boolean);
        if (beans.length !== 1) return "unexpected Cup of Coffee ingredients";
        beans[0].Amount = String(drink.beans);
        recipe.Ingredients = JSON.stringify([JSON.stringify(beans[0])]);
        recipes.push(JSON.stringify(recipe));
        return drink.beans + " beans";
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

        const added = [];
        DRINKS.forEach((drink, index) => {
            const shots = index + 1;
            if (!isBlankSlot(items[drink.slot])) {
                console.warn(TAG + " Item slot " + drink.slot + " is no longer blank (a game update may have used it). " + drink.name + " left out to avoid overwriting it.");
                return;
            }
            const event = buildEvent(coffeeEvent, events.length, drink, shots);
            if (!event) {
                console.warn(TAG + " Coffee event has an unexpected layout. " + drink.name + " left out.");
                return;
            }
            events.push(event);

            const weaker = index === 0 ? COFFEE_ITEM.name : DRINKS[index - 1].name;
            const item = clone(coffee);
            delete item.meta;
            item.id = drink.slot;
            item.name = drink.name;
            item.description = boostText(shots) + " Stronger than " + (/^[AEIOU]/i.test(weaker) ? "an" : "a") + " \\c[6]" + weaker + "\\c[0].";
            item.price = drink.price;
            item.effects = [{ code: 44, dataId: event.id, value1: 1, value2: 0 }];
            // Keep it out of the encyclopedia so its entry list and completion
            // count stay exactly as in the unmodded game.
            if (!/<cgmzencyclopediahide>/i.test(item.note)) item.note += "\n<cgmzencyclopediahide>";
            if (typeof DataManager !== "undefined" && DataManager.extractMetadata) DataManager.extractMetadata(item);
            items[drink.slot] = item;
            if (index === 0) shared.enabled = true;
            added.push(drink.name + " in slot " + drink.slot + " (event " + event.id + ", " + addRecipe(drink) + ")");
        });
        console.log(TAG + " " + (added.length ? added.join("; ") : "No drink could be added") + ".");
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
    // This mod adds: espresso (true) and espressoShots (1, 2 or 3).
    // ------------------------------------------------------------------------
    const timersAvailable = () => typeof Game_Time !== "undefined" && Array.isArray(Game_Time._actorStates) &&
        typeof $gameTime !== "undefined" && !!$gameTime;
    const findEntry = (actorId) => Game_Time._actorStates.find(s => s.actorId === actorId && s.stateId === COFFEE_STATE_ID);
    // An entry from before the stronger drinks existed has no espressoShots: a plain Espresso.
    const shotsOf = (entry) => Math.min(DRINKS.length, Math.max(1, Math.floor(Number(entry.espressoShots)) || 1));

    // ------------------------------------------------------------------------
    // Drinking: decide which drink the Coffee state that was just added came
    // from, and set its strength and end time.
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
            const running = before && before.espresso && this.isStateAffected(COFFEE_STATE_ID)
                ? { shots: shotsOf(before), gameTime: before.gameTime } : null;

            _Game_Battler_addState.call(this, stateId);

            // 0 = a Cup of Coffee; true is what version 1.0 of the event set.
            const shots = shared.pending === true ? 1 : Math.floor(Number(shared.pending)) || 0;
            shared.pending = false;
            const entry = findEntry(this.actorId());
            if (!entry) return;
            if (shots > 0 && (!running || shots >= running.shots)) {
                entry.espresso = true;
                entry.espressoShots = Math.min(shots, DRINKS.length);
                entry.gameTime = $gameTime.clone().add("hour", ESPRESSO_HOURS);
            } else if (running) {
                // A weaker drink on top of a stronger one: keep the stronger one as it was.
                entry.espresso = true;
                entry.espressoShots = running.shots;
                entry.gameTime = running.gameTime;
            } else {
                delete entry.espresso;
                delete entry.espressoShots;
            }
        };
    }

    // ------------------------------------------------------------------------
    // Speed: while an espresso boost is active, use that drink's speed values
    // instead of what the game's footsteps plugin (WTE_Footsteps) calculated.
    // ------------------------------------------------------------------------
    const activeDrink = () => {
        if (!timersAvailable() || typeof $gameParty === "undefined" || !$gameParty) return null;
        const leader = $gameParty.leader();
        if (!leader || !leader.isStateAffected(COFFEE_STATE_ID)) return null;
        const entry = findEntry(leader.actorId());
        return entry && entry.espresso ? DRINKS[shotsOf(entry) - 1] : null;
    };

    if (typeof Game_Player !== "undefined") {
        const _Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
        Game_Player.prototype.realMoveSpeed = function() {
            const inner = _Game_Player_realMoveSpeed.call(this);
            // Cutscenes and the plugin's own "off" switch leave _wteCachedSpeed
            // unset; stay out of the way then.
            if (this._wteIsCutscene || this._wteCachedSpeed === null || this._wteCachedSpeed === undefined) return inner;
            const drink = activeDrink();
            if (!drink) return inner;

            let speed = this._wteIsBiking ? drink.speed.bike : this._wteIsRunning ? drink.speed.run : drink.speed.walk;
            speed = Math.min(speed, SPEED_CAP);
            // Same diagonal compensation the footsteps plugin applies to speed states.
            if (this._diagDir && this._diagDir !== 0) {
                const diagMod = (typeof Galv !== "undefined" && Galv.PMOVE) ? Galv.PMOVE.diagMod : 0.707;
                if (diagMod > 0) speed += Math.abs(Math.log2(diagMod));
            }
            return speed;
        };
    }

    console.log(TAG + " Loaded. " + DRINKS.map(d => d.name + " " + JSON.stringify(d.speed)).join(", ") + ", " + ESPRESSO_HOURS + "h.");
})();
