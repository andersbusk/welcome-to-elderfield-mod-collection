/*:
 * @target MZ
 * @plugindesc [CoffeeMachines] A placeable Coffee Machine, and the game's Espresso Machine made to work: put in a bean, come back an hour later.
 * @author Anders
 *
 * @help
 * ============================================================================
 * CoffeeMachines.js
 * ============================================================================
 * Two machines, sold at the General Store:
 *
 *   Coffee Machine     1 Coffee Bean  -> 1 Cup of Coffee, one in-game hour later
 *                      A new item. It looks like the game's Coffee Maker.
 *   Espresso Machine   2 Coffee Beans -> 1 Espresso,      one in-game hour later
 *                      The game's own Espresso Machine decoration, which this
 *                      mod makes work. Only with the Espresso mod enabled.
 *
 * Walk up to a machine and press the action button: put a bean in, pick the
 * machine up, or cancel. While it brews it tells you how long is left. When it
 * is done, the same button hands you the cup. The time runs on the game's
 * own processing clock, the one the Food Processor uses, so it keeps running
 * while you are elsewhere or asleep.
 *
 * How it is built, and what that means for your save:
 *  - A placed Coffee Machine is stored in the save as the game's own Coffee
 *    Maker object with a small marker on it. A placed Espresso Machine is the
 *    game's own Espresso Machine object. Nothing in the save points at anything
 *    this mod adds. Without the mod a Coffee Machine is a Coffee Maker again
 *    and an Espresso Machine is a decoration again.
 *  - The Coffee Machine item takes over a blank "Empty" item slot, in memory
 *    only. Without the mod, one you still carry shows as that blank item.
 *  - The General Store's saved stock is not touched; the machines are added to
 *    what the shop shows.
 *  - If a game update fills the item slot or changes the Coffee Maker in a way
 *    this mod does not recognise, it switches itself off and logs a warning.
 */

(() => {
    "use strict";
    const TAG = "[CoffeeMachines]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // beans:   Coffee Beans (any quality, cheapest first) used per cup.
    // minutes: in-game minutes until the cup is ready.
    // price:   price at the General Store.
    // slot:    blank "Empty" item slot the Coffee Machine takes over. Do not
    //          change it once you own one: the save remembers it by this number.
    // gameItem: the game's own item that becomes the Espresso Machine.
    const MACHINES = {
        coffee:   { slot: 1401,     name: "Coffee Machine",   drink: "coffee",   beans: 1, minutes: 60, price: 20 },
        espresso: { gameItem: 2591, name: "Espresso Machine", drink: "espresso", beans: 2, minutes: 60, price: 30 }
    };

    // Shops that sell the machines, by the shop's name in the game.
    const SHOP_NAMES = ["General Store"];

    // The game's Coffee Maker and Espresso Machine can only be placed in the
    // Home. The machines can be placed wherever this object can: the Keg goes
    // in the Home, on the Farm, in the Workshop and on the Ranch. "" = Home only.
    const PLACE_LIKE = "Keg";

    // The game's Espresso Machine is drawn without anything under it, because it
    // is meant to stand on a table. true: when it stands on the floor it is
    // shown on a counter like the Coffee Maker's, and it blocks the way like
    // one. On a table it looks as in the game.
    const ESPRESSO_ON_COUNTER = true;

    // true: a machine whose cup is ready shows the same speech bubble with an
    // exclamation mark that the Keg and the Preserving Barrel show.
    const READY_SIGN = true;
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
    // Version 1.0 had its own Espresso Machine item in this slot, placed as a Coffee Maker object.
    // Those keep working, and turn into the game's Espresso Machine when picked up.
    const LEGACY_ESPRESSO_SLOT = 1402;

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
    const byItem = {};                              // item number -> machine, filled once the database is ready
    const byMarker = {};                            // marker on a placed object -> machine (byItem plus old markers)
    const placementRules = {};                      // placement number -> { wide, source, copy }
    // What the sprites are made of: the Espresso Machine's template and sheet, the Coffee Maker's
    // sheet, and the sheet and row the "ready" bubble is taken from.
    const look = { template: null, sheet: "", makerSheet: "", signSheet: "", signRow: 0 };
    const READY_SIGN_FROM = "Keg";               // the placeable whose "done" picture has the bubble

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
    const machineOf = (interp) => byMarker[sv(interp, VARS.machine)] || null;
    const clock = () => Number($gameVariables.value(VARS.clock)) || 0;
    const beanItems = () => $dataItems
        .filter(item => item && item.meta && String(item.meta.cgmzcraftinggeneric || "").trim() === BEAN_GENERIC)
        .sort((a, b) => a.price - b.price || a.id - b.id);
    const drinkItem = (machine) => {
        const espresso = window.EspressoMod;
        if (machine.drink === "espresso" && espresso && espresso.enabled && $dataItems[espresso.itemId]) return $dataItems[espresso.itemId];
        return $dataItems[COFFEE_ITEM.id];
    };

    // adoptItem: the page belongs to an object that is a machine as it stands (the game's Espresso
    // Machine, also ones placed before this mod). Mark it the first time it is used.
    api.isMachine = (interp, adoptItem) => {
        if (!api.enabled) return false;
        if (adoptItem && byItem[adoptItem] && !sv(interp, VARS.machine) && typeof interp.setSv === "function") interp.setSv(VARS.machine, adoptItem);
        return !!machineOf(interp);
    };
    api.machineItem = (interp) => { const machine = machineOf(interp); return machine ? machine.item : 0; };
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
        place.parameters[3].gameItemId = String(machine.item);
        for (const c of list) {
            if (c.code === 657 && /^Consume Item = /.test(c.parameters[0])) c.parameters[0] = "Consume Item = " + machine.item;
        }
        return { id: id, list: list, name: machine.name, switchId: source.switchId, trigger: 0 };
    };

    // An item that places an object: its use event, the placement it starts, that placement's
    // template and the template's action page.
    const placeableOf = (item, events, templates, pkd) => {
        const effect = item && (item.effects || []).find(e => e.code === 44);
        const useEvent = effect && events[effect.dataId];
        const place = useEvent && useEvent.list.find(c => isPluginCommand(c, "PKD_PocketEvents", "PlacePocketEvent"));
        if (!place || Number(place.parameters[3].gameItemId) !== item.id) return null;
        const index = Number(place.parameters[3].placementItemId);
        const entry = Array.isArray(pkd) ? pkd[index] : null;
        const template = templates.events[entry ? entry.eventId : index];
        if (!template || template.name !== item.name) return null;
        const actionPage = template.pages.slice().reverse().find(p => p.trigger === 0);
        return actionPage ? { useEvent: useEvent, index: index, template: template, actionPage: actionPage } : null;
    };

    const describe = (whereLine, machine) => {
        const drink = machine.drink === "espresso" ? "an \\c[6]Espresso\\c[0]" : "a \\c[6]Cup of Coffee\\c[0]";
        return whereLine + "\nPut in " + (machine.beans === 1 ? "a \\c[6]Coffee Bean\\c[0]" : machine.beans + " \\c[6]Coffee Beans\\c[0]") +
            " and collect " + drink + " " + (machine.minutes === 60 ? "an hour" : machine.minutes + " minutes") + " later.";
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
        const pkd = typeof PKD_EasyPlacement !== "undefined" && PKD_EasyPlacement.PARAMS ? PKD_EasyPlacement.PARAMS.ITEMS : null;
        const maker = items[MAKER_ITEM.id], coffee = items[COFFEE_ITEM.id];
        if (!maker || maker.name !== MAKER_ITEM.name || !coffee || coffee.name !== COFFEE_ITEM.name) return stop("Coffee Maker or Cup of Coffee item not found.");
        const makerPlace = placeableOf(maker, events, templates, pkd);
        const page = makerPlace && parseMakerPage(makerPlace.actionPage.list);
        if (!page) return stop("The Coffee Maker's placement or page has an unexpected layout.");
        if (!findEvent(events, GIVE_EVENT)) return stop("\"" + GIVE_EVENT.name + "\" event not found.");
        const coffeeMachine = Object.assign({}, MACHINES.coffee, { item: MACHINES.coffee.slot, placement: makerPlace.index });
        if (!isBlankSlot(items[coffeeMachine.item])) return stop("Item slot " + coffeeMachine.item + " is no longer blank (a game update may have used it).");

        // The Espresso Machine: the game's own decoration. Leave it alone when anything is off.
        let espressoMachine = null, espressoPlace = null;
        const espressoItem = items[MACHINES.espresso.gameItem];
        if (!window.EspressoMod) {
            console.log(TAG + " " + MACHINES.espresso.name + " left as a decoration: it needs the Espresso mod.");
        } else if (!espressoItem || espressoItem.name !== MACHINES.espresso.name) {
            console.warn(TAG + " Item " + MACHINES.espresso.gameItem + " is not \"" + MACHINES.espresso.name + "\"; no espresso machine.");
        } else {
            espressoPlace = placeableOf(espressoItem, events, templates, pkd);
            const returnsItself = espressoPlace && espressoPlace.actionPage.list.some(c => c.code === 122 && c.parameters[0] === VARS.item &&
                c.parameters[3] === 0 && c.parameters[4] === espressoItem.id);
            if (returnsItself) espressoMachine = Object.assign({}, MACHINES.espresso, { item: espressoItem.id, placement: espressoPlace.index });
            else console.warn(TAG + " The " + MACHINES.espresso.name + "'s placement or page has an unexpected layout; it stays a decoration.");
        }

        // Where the machines may be placed: borrow the rules (and the wording) of another placeable
        let whereLine = String(maker.description).split("\n")[0], wide = null;
        if (PLACE_LIKE && Array.isArray(pkd)) {
            const like = pkd.find(p => p && templates.events[p.eventId] && templates.events[p.eventId].name === PLACE_LIKE);
            const likeItem = items.find(item => item && item.name === PLACE_LIKE && /Placeable/.test(item.description));
            if (like && Array.isArray(like.onlyRegions) && likeItem) {
                wide = like.onlyRegions.slice();
                whereLine = String(likeItem.description).split("\n")[0];
            } else {
                console.warn(TAG + " \"" + PLACE_LIKE + "\" not found among the placeables; the machines go where the game's own objects go.");
            }
        }

        // One event for both machines. A machine's page calls it and then stops; five commands are
        // put in front of the game's page for that.
        const machineEvent = buildMachineEvent(events.length, page, events, addChoiceTemplate(page));
        events.push(machineEvent);
        const prefix = (condition) => [
            { code: 111, indent: 0, parameters: [12, condition] },
            { code: 117, indent: 1, parameters: [machineEvent.id] },
            { code: 115, indent: 1, parameters: [] },
            { code: 0, indent: 1, parameters: [] },
            { code: 412, indent: 0, parameters: [] }
        ];
        // The Coffee Maker's page: only for objects marked as a machine.
        makerPlace.actionPage.list.unshift(...prefix("window.CoffeeMachines && window.CoffeeMachines.isMachine(this)"));
        placementRules[makerPlace.index] = { wide: wide, source: null, copy: null };

        // Coffee Machine: a new item, used and placed like a Coffee Maker.
        const use = buildUseEvent(makerPlace.useEvent, events.length, coffeeMachine);
        events.push(use);
        const item = clone(maker);
        delete item.meta;
        item.id = coffeeMachine.item;
        item.name = coffeeMachine.name;
        item.price = coffeeMachine.price;
        item.description = describe(whereLine, coffeeMachine);
        item.effects = [{ code: 44, dataId: use.id, value1: 1, value2: 0 }];
        // Keep it out of the encyclopedia so its entry list and completion count stay as in the unmodded game.
        if (!/<cgmzencyclopediahide>/i.test(item.note)) item.note += "\n<cgmzencyclopediahide>";
        if (typeof DataManager !== "undefined" && DataManager.extractMetadata) DataManager.extractMetadata(item);
        items[coffeeMachine.item] = item;
        byItem[coffeeMachine.item] = byMarker[coffeeMachine.item] = coffeeMachine;

        // Espresso Machine: every object of the game's own template is one.
        if (espressoMachine) {
            espressoPlace.actionPage.list.unshift(...prefix("window.CoffeeMachines && window.CoffeeMachines.isMachine(this, " + espressoMachine.item + ")"));
            placementRules[espressoPlace.index] = { wide: wide, source: null, copy: null };
            espressoItem.description = describe(whereLine, espressoMachine);
            byItem[espressoMachine.item] = byMarker[espressoMachine.item] = espressoMachine;
            byMarker[LEGACY_ESPRESSO_SLOT] = espressoMachine;
            look.sheet = espressoPlace.actionPage.image.characterName;
            if (ESPRESSO_ON_COUNTER) {
                espressoPlace.actionPage.through = false;          // the game lets you walk through it
                look.template = espressoPlace.template;
            }
        }
        look.makerSheet = makerPlace.actionPage.image.characterName;
        if (READY_SIGN) {
            // The last page of a machine's template is its "done" page; its picture has the bubble.
            const signTemplate = templates.events.find(ev => ev && ev.name === READY_SIGN_FROM);
            const signPage = signTemplate ? signTemplate.pages[signTemplate.pages.length - 1] : null;
            if (signPage && signPage.image && signPage.image.characterName && signPage.stepAnime) {
                look.signSheet = signPage.image.characterName;
                look.signRow = (signPage.image.direction - 2) / 2;
            }
        }
        api.enabled = true;
        console.log(TAG + " Ready: " + Object.keys(byItem).map(id => byItem[id].name + " (item " + id + ")").join(", ") + "; machine event " + machineEvent.id +
            "; placeable " + (wide ? "like a " + PLACE_LIKE : "as in the game") + ".");
    };

    // A version 1.0 Espresso Machine still in the bag becomes the game's Espresso Machine.
    const convertOldItems = () => {
        const machine = byMarker[LEGACY_ESPRESSO_SLOT];
        const bag = typeof $gameParty !== "undefined" && $gameParty ? $gameParty._items : null;
        if (!machine || !bag || !(bag[LEGACY_ESPRESSO_SLOT] > 0) || !isBlankSlot($dataItems[LEGACY_ESPRESSO_SLOT])) return;
        bag[machine.item] = (bag[machine.item] || 0) + bag[LEGACY_ESPRESSO_SLOT];
        delete bag[LEGACY_ESPRESSO_SLOT];
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
        if (typeof DataManager.extractSaveContents === "function") {
            const _DataManager_extractSaveContents = DataManager.extractSaveContents;
            DataManager.extractSaveContents = function(contents) {
                _DataManager_extractSaveContents.call(this, contents);
                convertOldItems();
            };
        }
    } else {
        console.warn(TAG + " DataManager not found. Mod did nothing.");
    }

    // ------------------------------------------------------------------------
    // Placing a machine. It goes down as the game's own object; the item it was
    // placed from is written on it as a marker, which is what makes it a machine.
    // ------------------------------------------------------------------------
    if (typeof PKD_EPManager !== "undefined" && typeof PKD_EPManager.PlaceItemOn === "function" &&
        typeof PKD_EPManager.ItemData === "function" && typeof PKD_EPManager.Start === "function") {
        const placingMachine = () => (typeof $gameTemp !== "undefined" && $gameTemp ? byItem[$gameTemp._epPlacementPartyItemId] : null) || null;

        const _PlaceItemOn = PKD_EPManager.PlaceItemOn;
        PKD_EPManager.PlaceItemOn = function(x, y) {
            const machine = placingMachine();
            const spawned = typeof $gameTemp !== "undefined" && $gameTemp ? $gameTemp._epSpawned : null;
            const result = _PlaceItemOn.apply(this, arguments);
            if (machine && spawned) $gameVariables.setSelfValue([$gameMap.mapId(), spawned.eventId(), VARS.machine], machine.item);
            return result;
        };

        // While a machine is being placed, use the wider placement rules.
        const _ItemData = PKD_EPManager.ItemData;
        PKD_EPManager.ItemData = function(pItemIndex) {
            const data = _ItemData.apply(this, arguments);
            const rule = data ? placementRules[Number(pItemIndex)] : null;
            if (!rule || !rule.wide) return data;
            const machine = placingMachine();
            if (!machine || machine.placement !== Number(pItemIndex)) return data;
            if (rule.source !== data) {
                rule.source = data;
                rule.copy = Object.assign({}, data, { onlyRegions: rule.wide.slice() });
            }
            return rule.copy;
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
    // How the machines look. Only the sprite on screen is changed, never the object, so nothing
    // of this is saved. The pictures are put together while the game runs, from the game's own
    // sprite sheets:
    //  - the Espresso Machine on a counter: the Coffee Maker on its counter with the Espresso
    //    Machine drawn over it (it covers the coffee machine completely);
    //  - the "ready" sign: the speech bubble the Keg shows when it is done, drawn above the machine.
    // ------------------------------------------------------------------------
    //
    // A picture is shared by every machine that looks the same. The game frees a picture that was
    // drawn while it runs together with the first sprite that showed it: on leaving the map, on
    // picking a machine up, at the end of a placement. So each picture is marked as not to be
    // freed, and it is drawn again if it was freed anyway.
    const isUsable = (bitmap) => !!bitmap && !!bitmap._canvas && !!bitmap._baseTexture && !bitmap._baseTexture.destroyed;
    const whenLoaded = (bitmaps, then) => {
        let left = bitmaps.length;
        for (const bitmap of bitmaps) bitmap.addLoadListener(() => { if (--left === 0) then(); });
    };
    // layers: the sheets drawn, bottom first. top: rows between the top of the 32-pixel cell and
    // the top of the machine, which is where the bubble goes.
    const LOOKS = {
        coffee:  { layers: () => [look.makerSheet], top: 3 },
        bare:    { layers: () => [look.sheet], top: 2 },
        counter: { layers: () => [look.makerSheet, look.sheet], top: 2 }
    };
    const BUBBLE = { pattern: 2, top: 12, height: 11 };      // where the bubble sits in the Keg's "done" cell (16 x 48)
    const SIGN_ROOM = 16;                                     // rows added above the machine for the bubble
    const SIGN_FRAMES = [0, 1, 2, 1];                         // the bubble bobs up and down like the Keg's
    const pictures = {};
    // frame: -1 = no sign, 0..2 = the sign, that many rows higher
    const picture = (name, frame) => {
        const key = name + ":" + frame;
        const entry = pictures[key] || (pictures[key] = { bitmap: null, requested: false, failed: false });
        if (entry.bitmap && !isUsable(entry.bitmap)) entry.bitmap = null;
        if (!entry.bitmap && !entry.requested && !entry.failed) {
            entry.requested = true;
            const layers = LOOKS[name].layers().map(sheet => ImageManager.loadCharacter(sheet));
            const bubble = frame >= 0 ? ImageManager.loadCharacter(look.signSheet) : null;
            whenLoaded(bubble ? layers.concat(bubble) : layers, () => {
                entry.requested = false;
                const base = layers[0];
                const cw = base.width / 3, ch = base.height / 4;              // a sheet is 3 x 4 cells
                const bw = bubble ? bubble.width / 3 : cw, bh = bubble ? bubble.height / 4 : 0;
                if (!base.width || !Number.isInteger(cw) || !Number.isInteger(ch) || bw !== cw ||
                    layers.some(b => b.width !== base.width || b.height !== base.height) ||
                    (bubble && bh < BUBBLE.top + BUBBLE.height)) {
                    entry.failed = true;                                       // not the layout we know: keep the game's look
                    return;
                }
                const room = bubble ? SIGN_ROOM : 0;
                const bitmap = new Bitmap(base.width, (ch + room) * 4);
                bitmap.smooth = base.smooth;
                for (let row = 0; row < 4; row++) {
                    const y = row * (ch + room) + room;
                    for (const layer of layers) bitmap.blt(layer, 0, row * ch, base.width, ch, 0, y);
                    if (!bubble) continue;
                    for (let col = 0; col < 3; col++) {
                        bitmap.blt(bubble, BUBBLE.pattern * cw, look.signRow * bh + BUBBLE.top, cw, BUBBLE.height,
                            col * cw, y + LOOKS[name].top - BUBBLE.height - frame);
                    }
                }
                bitmap._wteIndestructible = true;           // the game's own mark for a shared picture (WTE_SpriteBaker)
                bitmap._customModified = false;             // the core engine's mark for "free with its sprite" (VisuMZ_0_CoreEngine)
                entry.bitmap = bitmap;
            });
        }
        return entry.bitmap;
    };
    // The game tags what can carry other objects: tables are "table", rugs and floors are "lower".
    const isTable = (event) => {
        try {
            return typeof PKD_EasyPlacement !== "undefined" && !!PKD_EasyPlacement.Utils &&
                PKD_EasyPlacement.Utils.GetCommentCodeValue("placeOverType", event) === "table";
        } catch (e) {
            return false;
        }
    };
    // A placed Espresso Machine that does not stand on a table.
    api.standsOnFloor = (character) => !!look.template && !!character && typeof character.event === "function" &&
        character.event() === look.template && !$gameMap.eventsXy(character.x, character.y).some(other => other !== character && isTable(other));
    // A machine whose cup is ready to be collected.
    api.isReady = (character) => {
        if (!api.enabled || !character || typeof character.eventId !== "function") return false;
        const mapId = character._mapId, eventId = character.eventId();
        if (!byMarker[$gameVariables.selfValue([mapId, eventId, VARS.machine])]) return false;
        return $gameVariables.selfValue([mapId, eventId, VARS.count]) > 0 && clock() >= $gameVariables.selfValue([mapId, eventId, VARS.finish]);
    };

    if (typeof Sprite_Character !== "undefined" && typeof ImageManager !== "undefined" && typeof Bitmap !== "undefined") {
        const _Sprite_Character_updateBitmap = Sprite_Character.prototype.updateBitmap;
        Sprite_Character.prototype.updateBitmap = function() {
            _Sprite_Character_updateBitmap.apply(this, arguments);
            const name = this._characterName;
            const isEspresso = !!look.sheet && name === look.sheet;
            if (!isEspresso && !(look.makerSheet && name === look.makerSheet)) return;
            // Looking at the tile and the machine every frame is not needed; a few times a second is plenty.
            this._cmTick = (this._cmTick || 0) + 1;
            if (this._cmOnFloor === undefined || this._cmTick % 20 === 0) {
                this._cmOnFloor = isEspresso && api.standsOnFloor(this._character);
                this._cmReady = !!look.signSheet && api.isReady(this._character);
            }
            const lookName = isEspresso ? (this._cmOnFloor ? "counter" : "bare") : "coffee";
            const ticks = typeof Graphics !== "undefined" ? Graphics.frameCount || 0 : 0;
            const frame = this._cmReady ? SIGN_FRAMES[Math.floor(ticks / 15) % SIGN_FRAMES.length] : -1;
            // Until a picture with the sign is drawn, show the one without it rather than flicker.
            const wanted = (frame >= 0 ? picture(lookName, frame) : null) || (lookName === "counter" ? picture(lookName, -1) : null);
            if (wanted) {
                if (this.bitmap !== wanted) this.bitmap = wanted;
                this._cmCustom = true;
            } else if (this._cmCustom) {
                this._cmCustom = false;
                this.bitmap = ImageManager.loadCharacter(name);
            }
        };
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
            if (!goods) goods = Object.keys(byItem).map(Number).map(id => makeGood($dataItems[id], byItem[id].price));
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
