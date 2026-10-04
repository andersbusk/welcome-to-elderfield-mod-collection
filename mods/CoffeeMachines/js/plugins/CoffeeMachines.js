/*:
 * @target MZ
 * @plugindesc [CoffeeMachines] Placeable Coffee Machine and Espresso Machine: put in a bean, come back an hour later.
 * @author Anders
 *
 * @help
 * ============================================================================
 * CoffeeMachines.js
 * ============================================================================
 * Adds two placeable machines, sold at the General Store:
 *
 *   Coffee Machine     1 Coffee Bean  -> 1 Cup of Coffee, one in-game hour later
 *   Espresso Machine   2 Coffee Beans -> 1 Espresso,      one in-game hour later
 *                      (only with the Espresso mod enabled)
 *
 * Walk up to a machine and press the action button: put a bean in, pick the
 * machine up, or cancel. While it brews it tells you how long is left. When it
 * is done, the same button hands you the cup. The time runs on the game's
 * own processing clock, the one the Food Processor uses, so it keeps running
 * while you are elsewhere or asleep.
 *
 * How it is built, and what that means for your save:
 *  - A placed machine is stored in the save as the game's own Coffee Maker
 *    object with a small marker on it. Nothing in the save points at anything
 *    this mod adds. If the mod is removed, every placed machine simply is a
 *    Coffee Maker again (and picks up as one).
 *  - The two items take over blank "Empty" item slots, in memory only. Without
 *    the mod, a machine you still carry shows as that blank "Empty" item.
 *  - The General Store's saved stock is not touched; the machines are added to
 *    what the shop shows.
 *  - If a game update fills an item slot or changes the Coffee Maker in a way
 *    this mod does not recognise, it switches itself off and logs a warning.
 */

(() => {
    "use strict";
    const TAG = "[CoffeeMachines]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // slot:    blank "Empty" item slot the machine takes over. Do not change it
    //          once you own the machine: the save remembers it by this number.
    // beans:   Coffee Beans (any quality, cheapest first) used per cup.
    // minutes: in-game minutes until the cup is ready.
    // price:   price at the General Store.
    const MACHINES = {
        coffee:   { slot: 1401, name: "Coffee Machine",   drink: "coffee",   beans: 1, minutes: 60, price: 500 },
        espresso: { slot: 1402, name: "Espresso Machine", drink: "espresso", beans: 2, minutes: 60, price: 1000 }
    };

    // Shops that sell the machines, by the shop's name in the game.
    const SHOP_NAMES = ["General Store"];

    // The game's Coffee Maker can only be placed in the Home. The machines can
    // be placed wherever this object can: the Keg goes in the Home, on the
    // Farm, in the Workshop and on the Ranch. "" = Home only, like the Coffee Maker.
    const PLACE_LIKE = "Keg";
    // ========================================================================
    // END CONFIG
    // ========================================================================

    const MAKER_ITEM   = { id: 2044, name: "Coffee Maker" };
    const COFFEE_ITEM  = { id: 2043, name: "Cup of Coffee" };
    const GIVE_EVENT   = { id: 837, name: "Give item (Farm)" };
    const QUEST_EVENT  = { id: 67, name: "Crafting Quest Checks" };
    const TOAST_EVENT  = { id: 820, name: "Process Item" };
    const BEAN_GENERIC = "CoffeeBean";              // <cgmzcraftinggeneric:CoffeeBean> on every Coffee Bean
    const CHOICE_SOURCE = "coffee";                 // the Coffee Maker's choice box
    const CHOICE_TEMPLATE = "coffeemachine";        // ours: the same box without the cooking storage entry
    const SE_BREW = { name: "pot", volume: 100, pitch: 90, pan: 0 };

    // Game variables. The "SV:" ones are stored per map object, and the game clears
    // all of them when an object is placed or picked up.
    const VARS = {
        item: 30, amount: 31,                       // what "Give item" hands over
        text: 15, number: 120, name: 132,           // scratch variables the game's own messages use
        clock: 133,                                 // "Processing Clock": in-game minutes, only ever counts up
        machine: 1286,                              // "SV: Item": which machine this is (its item number)
        product: 107, count: 108, finish: 106       // "SV: Smelter Product / Amount / Time"
    };
    const VAR_NAMES = { 133: "Processing Clock", 1286: "SV: Item", 107: "SV: Smelter Product", 108: "SV: Smelter Amount", 106: "SV: Smelter Time" };

    const api = window.CoffeeMachines = { enabled: false };
    const byItem = {};                              // item slot -> machine, filled once the database is ready
    const placement = { index: 0, wide: null, source: null, copy: null };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const safeParse = (text, fallback) => {
        try { return JSON.parse(text); } catch (e) { return fallback; }
    };
    const isBlankSlot = (item) => !!item && (item.name.trim() === "" || item.name.trim().toLowerCase() === "empty") &&
        (!item.effects || item.effects.length === 0);
    const findEvent = (list, ref) => {
        const byId = list[ref.id];
        if (byId && byId.name === ref.name) return byId;
        return list.find(ev => ev && ev.name === ref.name) || null;
    };
    const isPluginCommand = (cmd, plugin, command) => cmd.code === 357 && cmd.parameters[0] === plugin &&
        (command instanceof RegExp ? command.test(cmd.parameters[1]) : cmd.parameters[1] === command);

    // ------------------------------------------------------------------------
    // What a machine does. Called from its event; "interp" is the running event.
    // ------------------------------------------------------------------------
    const sv = (interp, id) => (interp && typeof interp.getSv === "function" ? Number(interp.getSv(id)) || 0 : 0);
    const machineOf = (interp) => byItem[sv(interp, VARS.machine)] || null;
    const clock = () => Number($gameVariables.value(VARS.clock)) || 0;
    const beanItems = () => $dataItems
        .filter(item => item && item.meta && String(item.meta.cgmzcraftinggeneric || "").trim() === BEAN_GENERIC)
        .sort((a, b) => a.price - b.price || a.id - b.id);
    const drinkItem = (machine) => {
        const espresso = window.EspressoMod;
        if (machine.drink === "espresso" && espresso && espresso.enabled && $dataItems[espresso.itemId]) return $dataItems[espresso.itemId];
        return $dataItems[COFFEE_ITEM.id];
    };

    api.isMachine = (interp) => api.enabled && !!machineOf(interp);
    api.machineItem = (interp) => sv(interp, VARS.machine);
    // 0 = empty, 1 = brewing, 2 = the cup is ready
    api.state = (interp) => {
        if (sv(interp, VARS.count) <= 0) return 0;
        return clock() >= sv(interp, VARS.finish) ? 2 : 1;
    };
    api.minutesLeft = (interp) => Math.max(1, sv(interp, VARS.finish) - clock());
    api.beansNeeded = (interp) => (machineOf(interp) || { beans: 1 }).beans;
    api.drinkName = (interp) => { const machine = machineOf(interp); return machine ? drinkItem(machine).name : ""; };
    api.brewTime = (interp) => {
        const minutes = (machineOf(interp) || { minutes: 60 }).minutes;
        if (minutes % 60 !== 0) return minutes + " minutes";
        return minutes === 60 ? "1 hour" : (minutes / 60) + " hours";
    };
    api.canBrew = (interp) => {
        const machine = machineOf(interp);
        return !!machine && beanItems().reduce((sum, item) => sum + $gameParty.numItems(item), 0) >= machine.beans;
    };
    api.brew = (interp) => {
        const machine = machineOf(interp);
        if (!machine || !api.canBrew(interp)) return;
        let left = machine.beans;
        for (const item of beanItems()) {
            const take = Math.min(left, $gameParty.numItems(item));
            if (take > 0) { $gameParty.loseItem(item, take, false); left -= take; }
        }
        interp.setSv(VARS.product, drinkItem(machine).id);
        interp.setSv(VARS.count, 1);
        interp.setSv(VARS.finish, clock() + machine.minutes);
    };
    // Puts the finished cup in the "give item" variables and empties the machine.
    api.collect = (interp) => {
        const product = $dataItems[sv(interp, VARS.product)];
        const usable = product && !isBlankSlot(product) ? product : $dataItems[COFFEE_ITEM.id];
        $gameVariables.setValue(VARS.item, usable.id);
        $gameVariables.setValue(VARS.amount, sv(interp, VARS.count));
        interp.setSv(VARS.product, 0);
        interp.setSv(VARS.count, 0);
        interp.setSv(VARS.finish, 0);
    };

    // ------------------------------------------------------------------------
    // The machine's event: built from pieces of the game's own Coffee Maker page,
    // so the choice box, the pick-up and the messages behave like the game's.
    // ------------------------------------------------------------------------
    const parseMakerPage = (list) => {
        const iTemplate = list.findIndex(c => isPluginCommand(c, "EliMZ_ChoiceManager", "cmd_setupByTemplate"));
        const iChoices = list.findIndex(c => c.code === 102);
        if (iTemplate < 0 || iChoices < iTemplate) return null;
        const base = list[iChoices].indent;
        const options = list[iChoices].parameters;
        let pickup = null, pickupIndex = -1;
        for (let i = iChoices + 1; i < list.length; i++) {
            const c = list[i];
            if (c.indent === base && c.code === 404) break;
            if (c.indent !== base || c.code !== 402) continue;
            const body = [];
            for (let j = i + 1; j < list.length && list[j].indent > base; j++) body.push(list[j]);
            if (body.some(b => isPluginCommand(b, "PKD_PocketEvents", /^RemovePocketEvent/))) { pickup = body; pickupIndex = c.parameters[0]; }
        }
        const cancelIndex = options[1];
        if (!pickup || pickupIndex <= 0 || cancelIndex === pickupIndex || cancelIndex < 0 || cancelIndex >= options[0].length) return null;
        const itemLine = pickup.findIndex(b => b.code === 122 && b.parameters[0] === VARS.item && b.parameters[1] === VARS.item &&
            b.parameters[2] === 0 && b.parameters[3] === 0 && b.parameters[4] === MAKER_ITEM.id);
        if (itemLine < 0) return null;
        return {
            intro: list.slice(0, iTemplate).filter(c => c.indent === base && c.code !== 0),   // choice box position, cursor sound
            options, base, pickup, pickupIndex, cancelIndex, itemLine,
            sourceTemplate: String(list[iTemplate].parameters[3].id || "")
        };
    };

    const findToast = (events) => {
        const source = findEvent(events, TOAST_EVENT);
        const cmd = source && source.list.find(c => isPluginCommand(c, "CGMZ_ToastManager", "Create Text Toast"));
        if (cmd) return clone(cmd.parameters);
        return ["CGMZ_ToastManager", "Create Text Toast", "Create Text Toast", {
            lineOne: "", lineOneAlignment: "center", lineOneColor: "0", lineTwo: "", lineTwoAlignment: "center", lineTwoColor: "0",
            height: "1", width: "360", SE: "Menu Button", "Display Time": "240", backgroundStyle: "Dim",
            windowskinTone: "{\"Red\":\"0\",\"Green\":\"0\",\"Blue\":\"0\"}", windowskin: ""
        }];
    };

    const buildMachineEvent = (id, page, events, choiceTemplate) => {
        const give = findEvent(events, GIVE_EVENT);
        const quest = findEvent(events, QUEST_EVENT);
        const toastBase = findToast(events);
        const API = "window.CoffeeMachines";
        const list = [];
        const add = (code, indent, parameters) => list.push({ code: code, indent: indent, parameters: parameters || [] });
        const script = (indent, text) => add(355, indent, [text]);
        const setVar = (indent, variable, text) => add(122, indent, [variable, variable, 0, 4, text]);
        const toast = (indent, text) => {
            const parameters = clone(toastBase);
            parameters[3].lineOne = text;
            add(357, indent, parameters);
        };
        const say = (indent, text) => { add(101, indent, ["", 0, 0, 2, ""]); add(401, indent, [text]); };
        const copy = (commands, indent, from) => {
            for (const c of commands) list.push({ code: c.code, indent: c.indent - from + indent, parameters: clone(c.parameters) });
        };
        const labels = [0, page.pickupIndex, page.cancelIndex].map(i => page.options[0][i]);

        add(111, 0, [12, API + ".state(this) === 2"]);                              // the cup is ready
            script(1, API + ".collect(this);");
            add(250, 1, [clone(SE_BREW)]);
            add(117, 1, [give.id]);
            if (quest) add(117, 1, [quest.id]);
            add(0, 1);
        add(411, 0);
            add(111, 1, [12, API + ".state(this) === 1"]);                          // still brewing
                setVar(2, VARS.text, API + ".minutesLeft(this)");
                toast(2, "Ready in \\v[" + VARS.text + "] min");
                add(0, 2);
            add(411, 1);                                                             // empty: brew, pick up or cancel
                copy(page.intro, 2, page.base);
                add(357, 2, ["EliMZ_ChoiceManager", "cmd_setupByTemplate", "Setup By Template", { id: choiceTemplate }]);
                add(102, 2, [labels, 2, page.options[2], page.options[3], page.options[4]]);
                add(402, 2, [0, labels[0]]);
                    add(111, 3, [12, API + ".canBrew(this)"]);
                        script(4, API + ".brew(this);");
                        add(250, 4, [clone(SE_BREW)]);
                        setVar(4, VARS.text, API + ".brewTime(this)");
                        toast(4, "Check back in \\v[" + VARS.text + "]");
                        add(0, 4);
                    add(411, 3);
                        setVar(4, VARS.number, API + ".beansNeeded(this)");
                        setVar(4, VARS.name, API + ".drinkName(this)");
                        say(4, "Not enough \\c[6]Coffee Bean\\c[0]. ");
                        say(4, "Requires \\v[" + VARS.number + "] \\c[6]Coffee Bean\\c[0] to produce 1 \\c[6]\\v[" + VARS.name + "]\\c[0].");
                        add(0, 4);
                    add(412, 3);
                    add(0, 3);
                add(402, 2, [1, labels[1]]);
                    const first = list.length;
                    copy(page.pickup, 3, page.base + 1);                             // ends with the branch's own terminator
                    // The game's page hands back a Coffee Maker here; hand back this machine instead.
                    list[first + page.itemLine].parameters = [VARS.item, VARS.item, 0, 4, API + ".machineItem(this)"];
                add(402, 2, [2, labels[2]]);
                    add(0, 3);
                add(404, 2);
                add(0, 2);
            add(412, 1);
            add(0, 1);
        add(412, 0);
        add(0, 0);
        return { id: id, list: list, name: "Coffee Machine (mod)", switchId: 1, trigger: 0 };
    };

    // The Coffee Maker's choice box has an entry for the cooking storage that a machine has
    // no use for. Make a copy without it.
    const addChoiceTemplate = (page) => {
        const manager = typeof Eli !== "undefined" && Eli && Eli.ChoiceManager;
        const templates = manager && manager.parameters && manager.parameters.templates;
        const source = templates && templates[page.sourceTemplate || CHOICE_SOURCE];
        if (!source) return page.sourceTemplate || CHOICE_SOURCE;
        // The plugin keeps the list as text: a JSON array whose entries are JSON text themselves.
        const entries = typeof source.choiceList === "string" ? safeParse(source.choiceList, null) : null;
        if (!Array.isArray(entries) || entries.length !== page.options[0].length) return page.sourceTemplate || CHOICE_SOURCE;
        const kept = [0, page.pickupIndex, page.cancelIndex].map(i => entries[i]);
        templates[CHOICE_TEMPLATE] = Object.assign({}, source, { id: CHOICE_TEMPLATE, choiceList: JSON.stringify(kept) });
        return CHOICE_TEMPLATE;
    };

    // ------------------------------------------------------------------------
    // Database setup: runs once the items, common events, variable names and the
    // placeable templates are loaded, which is before any save is opened.
    // ------------------------------------------------------------------------
    let setupDone = false;

    const buildUseEvent = (source, id, machine) => {
        const list = clone(source.list);
        const place = list.find(c => isPluginCommand(c, "PKD_PocketEvents", "PlacePocketEvent"));
        place.parameters[3].gameItemId = String(machine.slot);
        for (const c of list) {
            if (c.code === 657 && /^Consume Item = /.test(c.parameters[0])) c.parameters[0] = "Consume Item = " + machine.slot;
        }
        return { id: id, list: list, name: machine.name, switchId: source.switchId, trigger: 0 };
    };

    const trySetup = () => {
        if (setupDone) return;
        const items = typeof $dataItems !== "undefined" ? $dataItems : null;
        const events = typeof $dataCommonEvents !== "undefined" ? $dataCommonEvents : null;
        const system = typeof $dataSystem !== "undefined" ? $dataSystem : null;
        const templates = typeof $dataEPEventsMap !== "undefined" ? $dataEPEventsMap : null;
        if (!Array.isArray(items) || !Array.isArray(events) || !system || !Array.isArray(system.variables) ||
            !templates || !Array.isArray(templates.events)) return;
        setupDone = true;
        const stop = (why) => console.warn(TAG + " " + why + " Mod disabled.");

        for (const id of Object.keys(VAR_NAMES)) {
            if (system.variables[id] !== VAR_NAMES[id]) return stop("Variable " + id + " is no longer \"" + VAR_NAMES[id] + "\".");
        }
        const maker = items[MAKER_ITEM.id], coffee = items[COFFEE_ITEM.id];
        if (!maker || maker.name !== MAKER_ITEM.name || !coffee || coffee.name !== COFFEE_ITEM.name) return stop("Coffee Maker or Cup of Coffee item not found.");
        const useEffect = (maker.effects || []).find(e => e.code === 44);
        const useEvent = useEffect && events[useEffect.dataId];
        const place = useEvent && useEvent.list.find(c => isPluginCommand(c, "PKD_PocketEvents", "PlacePocketEvent"));
        if (!place || Number(place.parameters[3].gameItemId) !== maker.id) return stop("The Coffee Maker's placement event has an unexpected layout.");
        if (!findEvent(events, GIVE_EVENT)) return stop("\"" + GIVE_EVENT.name + "\" event not found.");

        // The Coffee Maker's template among the placeables, and its action page
        const pkd = typeof PKD_EasyPlacement !== "undefined" && PKD_EasyPlacement.PARAMS ? PKD_EasyPlacement.PARAMS.ITEMS : null;
        const index = Number(place.parameters[3].placementItemId);
        const entry = Array.isArray(pkd) ? pkd[index] : null;
        const template = templates.events[entry ? entry.eventId : index];
        if (!template || template.name !== MAKER_ITEM.name) return stop("Coffee Maker template not found among the placeables.");
        const actionPage = template.pages.slice().reverse().find(p => p.trigger === 0);
        const page = actionPage && parseMakerPage(actionPage.list);
        if (!page) return stop("The Coffee Maker's page has an unexpected layout.");

        const wanted = Object.keys(MACHINES).map(key => MACHINES[key]).filter(machine => {
            if (machine.drink !== "espresso" || window.EspressoMod) return true;
            console.log(TAG + " " + machine.name + " skipped: it needs the Espresso mod.");
            return false;
        });
        for (const machine of wanted) {
            if (!isBlankSlot(items[machine.slot])) return stop("Item slot " + machine.slot + " is no longer blank (a game update may have used it).");
        }

        // Where the machines may be placed: borrow the rules (and the wording) of another placeable
        let whereLine = String(maker.description).split("\n")[0];
        if (PLACE_LIKE && Array.isArray(pkd)) {
            const like = pkd.find(p => p && templates.events[p.eventId] && templates.events[p.eventId].name === PLACE_LIKE);
            const likeItem = items.find(item => item && item.name === PLACE_LIKE && /Placeable/.test(item.description));
            if (like && Array.isArray(like.onlyRegions) && likeItem) {
                placement.wide = like.onlyRegions.slice();
                whereLine = String(likeItem.description).split("\n")[0];
            } else {
                console.warn(TAG + " \"" + PLACE_LIKE + "\" not found among the placeables; the machines go where a Coffee Maker goes.");
            }
        }
        placement.index = index;

        // One event for both machines, called from the Coffee Maker's page when the object is a machine
        const machineEvent = buildMachineEvent(events.length, page, events, addChoiceTemplate(page));
        events.push(machineEvent);
        actionPage.list.unshift(
            { code: 111, indent: 0, parameters: [12, "window.CoffeeMachines && window.CoffeeMachines.isMachine(this)"] },
            { code: 117, indent: 1, parameters: [machineEvent.id] },
            { code: 115, indent: 1, parameters: [] },
            { code: 0, indent: 1, parameters: [] },
            { code: 412, indent: 0, parameters: [] }
        );

        for (const machine of wanted) {
            const use = buildUseEvent(useEvent, events.length, machine);
            events.push(use);
            const item = clone(maker);
            delete item.meta;
            item.id = machine.slot;
            item.name = machine.name;
            item.price = machine.price;
            const drink = machine.drink === "espresso" ? "an \\c[6]Espresso\\c[0]" : "a \\c[6]Cup of Coffee\\c[0]";
            item.description = whereLine + "\nPut in " + (machine.beans === 1 ? "a \\c[6]Coffee Bean\\c[0]" : machine.beans + " \\c[6]Coffee Beans\\c[0]") +
                " and collect " + drink + " " + (machine.minutes === 60 ? "an hour" : machine.minutes + " minutes") + " later.";
            item.effects = [{ code: 44, dataId: use.id, value1: 1, value2: 0 }];
            // Keep it out of the encyclopedia so its entry list and completion count stay as in the unmodded game.
            if (!/<cgmzencyclopediahide>/i.test(item.note)) item.note += "\n<cgmzencyclopediahide>";
            if (typeof DataManager !== "undefined" && DataManager.extractMetadata) DataManager.extractMetadata(item);
            items[machine.slot] = item;
            byItem[machine.slot] = machine;
        }
        api.enabled = true;
        console.log(TAG + " Ready: " + wanted.map(m => m.name + " in slot " + m.slot).join(", ") + "; machine event " + machineEvent.id +
            "; placeable " + (placement.wide ? "like a " + PLACE_LIKE : "like a Coffee Maker") + ".");
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

    // ------------------------------------------------------------------------
    // Placing a machine. It goes down as the game's Coffee Maker object; the item it
    // was placed from is written on it as a marker, which is what makes it a machine.
    // ------------------------------------------------------------------------
    if (typeof PKD_EPManager !== "undefined" && typeof PKD_EPManager.PlaceItemOn === "function" &&
        typeof PKD_EPManager.ItemData === "function" && typeof PKD_EPManager.Start === "function") {
        const placingMachine = () => (typeof $gameTemp !== "undefined" && $gameTemp ? byItem[$gameTemp._epPlacementPartyItemId] : null) || null;

        const _PlaceItemOn = PKD_EPManager.PlaceItemOn;
        PKD_EPManager.PlaceItemOn = function(x, y) {
            const machine = placingMachine();
            const spawned = typeof $gameTemp !== "undefined" && $gameTemp ? $gameTemp._epSpawned : null;
            const result = _PlaceItemOn.apply(this, arguments);
            if (machine && spawned) $gameVariables.setSelfValue([$gameMap.mapId(), spawned.eventId(), VARS.machine], machine.slot);
            return result;
        };

        // While a machine is being placed, use the wider placement rules.
        const _ItemData = PKD_EPManager.ItemData;
        PKD_EPManager.ItemData = function(pItemIndex) {
            const data = _ItemData.apply(this, arguments);
            if (!data || !placement.wide || Number(pItemIndex) !== placement.index || !placingMachine()) return data;
            if (placement.source !== data) {
                placement.source = data;
                placement.copy = Object.assign({}, data, { onlyRegions: placement.wide.slice() });
            }
            return placement.copy;
        };

        // The game remembers "can this object go on this map" per object type. A machine and a
        // Coffee Maker are the same type with different rules, so forget that answer on every start.
        const _Start = PKD_EPManager.Start;
        PKD_EPManager.Start = function() {
            this._wteCachedMapValidity = undefined;
            return _Start.apply(this, arguments);
        };
    } else {
        console.warn(TAG + " Placeable system (PKD_PocketEvents) not found. Machines cannot be placed.");
    }

    // ------------------------------------------------------------------------
    // The shop. A read-only addition to what the shop shows; its saved stock is untouched.
    // ------------------------------------------------------------------------
    const shopIndexes = [];
    if (typeof PluginManager !== "undefined") {
        const shops = safeParse(PluginManager.parameters("DM_CoreShop")["Shop Manager"], []) || [];
        shops.forEach((text, i) => {
            const shop = safeParse(text, null);
            if (shop && SHOP_NAMES.includes(shop["Shop Name"])) shopIndexes.push(i);       // DM_CoreShop stores shops 0-based
        });
    }
    const inMachineShop = () => typeof $gameShop !== "undefined" && $gameShop && shopIndexes.includes($gameShop._tempShopId);

    if (typeof Game_Shop !== "undefined" && shopIndexes.length > 0) {
        // Built the way DM_CoreShop builds its own goods: a copy of the item plus shop bookkeeping.
        const makeGood = (item, price) => {
            const good = Object.assign({}, item);
            good.amount = "";                 // "" = unlimited stock
            good.useCustomSell = false;
            good.price = price;
            good.retained = true;
            good.infinite = true;
            good.isInfinite = true;
            good.unlockStatus = 0;
            if (typeof $gameShop !== "undefined" && $gameShop && $gameShop.checkItemCategory) {
                $gameShop.checkItemCategory(good);
                $gameShop.checkItemWeight(good);
            }
            return good;
        };
        let goods = null;                     // rebuilt every time a shop is opened
        const _Game_Shop_storedGoods = Game_Shop.prototype.storedGoods;
        Game_Shop.prototype.storedGoods = function() {
            const original = _Game_Shop_storedGoods.call(this);
            if (!api.enabled || !shopIndexes.includes(this._tempShopId) || !Array.isArray(original)) return original;
            if (!goods) goods = Object.keys(byItem).map(Number).map(slot => makeGood($dataItems[slot], byItem[slot].price));
            return original.concat(goods.filter(good => !original.some(g => g.id === good.id && g.etypeId === undefined)));
        };
        if (typeof Scene_CoreShop !== "undefined") {
            const _Scene_CoreShop_create = Scene_CoreShop.prototype.create;
            Scene_CoreShop.prototype.create = function() {
                goods = null;
                _Scene_CoreShop_create.call(this);
            };
        }
        // DM_CoreShop caps the purchase count with a global "shopAmount" that it only updates for
        // items in the shop's saved stock. The machines are not in it, so clear the stale value.
        if (typeof Window_ShopNumber !== "undefined") {
            for (const method of ["processNumberChange", "onButtonUp", "onButtonDown"]) {
                const original = Window_ShopNumber.prototype[method];
                if (typeof original !== "function") continue;
                Window_ShopNumber.prototype[method] = function() {
                    if (inMachineShop()) window.shopAmount = undefined;
                    return original.apply(this, arguments);
                };
            }
        }
    } else {
        console.warn(TAG + " No shop named " + JSON.stringify(SHOP_NAMES) + " found. The machines are not sold anywhere.");
    }

    console.log(TAG + " Loaded. Shops: " + shopIndexes.map(i => i + 1).join(", ") + ".");
})();
