// Offline harness for the CoffeeMachines mod (together with Espresso). Loads the real item,
// common event, system and placeable-template data, copies the few pieces of game logic the mod
// hooks into (placement rules and the map whitelist, shop stock, self variables), then runs the
// machine's event through a small event interpreter for every situation a player can be in.
//   node test_coffeemachines.js "<game folder>"
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));
const modSrc = name => fs.readFileSync(path.join(MODS_ROOT, name, "js/plugins", name + ".js"), "utf8");
const realLog = console.log;
let problems = 0;
const fail = m => { problems++; realLog("   !! " + m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pluginsText = fs.readFileSync(path.join(gameDir, "js/plugins.js"), "utf8");
const plugins = JSON.parse(pluginsText.slice(pluginsText.indexOf("["), pluginsText.lastIndexOf("]") + 1));
const params = name => (plugins.find(p => p.name === name) || { parameters: {} }).parameters;
const vanilla = { items: readJson("Items.json"), events: readJson("CommonEvents.json"), templates: readJson("Map053.json") };
const MAKER = 160;                       // the Coffee Maker's template and placement number
const HOME = 2, FARM = 34, TOWN = 1;

let state;                               // per boot: variables, bag, log ...

function boot(mods, tweak) {
    global.window = global;
    delete global.EspressoMod;
    delete global.CoffeeMachines;
    state = { vars: {}, self: {}, switches: {}, bag: {}, map: HOME, nextEventId: 500, placed: [], warnings: [] };
    global.$dataItems = readJson("Items.json");
    global.$dataCommonEvents = readJson("CommonEvents.json");
    global.$dataSystem = readJson("System.json");
    global.CGMZ = { Crafting: { Recipes: JSON.parse(params("CGMZ_Crafting").Recipes) } };
    global.PluginManager = { parameters: params };
    global.DataManager = {
        onLoad() {}, isDatabaseLoaded() { return true; },
        extractMetadata(data) {
            const re = /<([^<>:]+)(:?)([^>]*)>/g; data.meta = {};
            for (;;) { const m = re.exec(data.note); if (m) data.meta[m[1]] = m[2] === ":" ? m[3] : true; else break; }
        }
    };
    for (const item of $dataItems) if (item) DataManager.extractMetadata(item);          // the engine does this when it loads the file

    // --- placeables (PKD_PocketEvents logic) ---
    const list = JSON.parse(params("PKD_PocketEvents").PlacementsList).map(l => JSON.parse(l));
    for (const e of list) {
        e.eventId = parseInt(e.eventId);
        e.onlyRegions = JSON.parse(e.onlyRegions).map(Number);
        e.exceptRegions = JSON.parse(e.exceptRegions).map(Number);
    }
    global.PKD_EasyPlacement = { PARAMS: { ITEMS: [null].concat(list) } };
    global.$gameTemp = { _epPlacementPartyItemId: null, _epPlacementItemId: null, _epSpawned: null };
    const whitelists = {};                                                                // WTE_PocketEvents_MapWhitelist logic
    for (const row of JSON.parse(params("WTE_PocketEvents_MapWhitelist").whitelists).map(r => JSON.parse(r))) {
        const sig = row.regions.split(",").map(n => Number(n.trim())).filter(n => n > 0).sort((a, b) => a - b).join(",");
        whitelists[sig] = row.maps.split(",").map(n => Number(n.trim())).filter(n => n > 0);
    }
    global.PKD_EPManager = {
        isActive: false,
        ItemData(i) { return PKD_EasyPlacement.PARAMS.ITEMS[i]; },
        CurrentPlacementItemData() { return $gameTemp._epPlacementItemId ? this.ItemData($gameTemp._epPlacementItemId) : null; },
        Start(pItemIndex, gItemId) {
            const item = this.ItemData(pItemIndex);
            if (!item || item.eventId <= 0) return;
            $gameTemp._epPlacementPartyItemId = gItemId;
            $gameTemp._epPlacementItemId = item.eventId;
            const id = state.nextEventId++;
            $gameTemp._epSpawned = { eventId: () => id };
            this.isActive = true;
        },
        PlaceItemOn(x, y) {
            const id = $gameTemp._epSpawned.eventId();
            state.placed.push({ placement: $gameTemp._epPlacementItemId, eventId: id, selfSwitch: this.ItemData($gameTemp._epPlacementItemId).sSwitch });
            $gameParty.gainItem($dataItems[$gameTemp._epPlacementPartyItemId], -1);
        },
        Stop() { $gameTemp._epPlacementPartyItemId = null; $gameTemp._epPlacementItemId = null; $gameTemp._epSpawned = null; this.isActive = false; },
        wteIsCurrentMapValid() {
            const mapId = $gameMap.mapId(), itemId = $gameTemp._epPlacementItemId;
            if (this._wteCachedMapValidity !== undefined && this._wteCachedMapId === mapId && this._wteCachedItemId === itemId) return this._wteCachedMapValidity;
            let valid = true;
            const data = this.isActive && itemId ? this.ItemData(itemId) : null;
            if (data && data.onlyRegions.length > 0) {
                const allowed = whitelists[[...data.onlyRegions].sort((a, b) => a - b).join(",")];
                if (allowed && !allowed.includes(mapId)) valid = false;
            }
            this._wteCachedMapId = mapId; this._wteCachedItemId = itemId; this._wteCachedMapValidity = valid;
            return valid;
        }
    };

    // --- choice box templates (EliMZ_ChoiceManager logic) ---
    const templates = {};
    for (const text of JSON.parse(params("EliMZ_ChoiceManager").templates)) {
        const temp = JSON.parse(text);
        temp.id = temp.id.toLowerCase().replace(/\s/g, "");
        templates[temp.id] = temp;
    }
    global.Eli = { ChoiceManager: { parameters: { templates } } };

    // --- shops (DM_CoreShop logic) ---
    const shops = JSON.parse(params("DM_CoreShop")["Shop Manager"]).map(s => JSON.parse(s));
    global.Game_Shop = function() {
        this._tempShopId = 0;
        this._coreShops = shops.map(s => ({ _storedContents: JSON.parse(s.Items || "[]").slice(0, 3).map(g => Object.assign({}, $dataItems[Number(JSON.parse(g)["Item Id"])])) }));
    };
    Game_Shop.prototype.storedGoods = function() { return this._coreShops[this._tempShopId]._storedContents; };
    global.Scene_CoreShop = function() {};
    Scene_CoreShop.prototype.create = function() {};
    Scene_CoreShop.prototype.terminate = function() {};

    // --- game state ---
    global.$gameVariables = {
        value: id => state.vars[id] || 0,
        setValue: (id, v) => { state.vars[id] = typeof v === "number" ? Math.floor(v) : v; },
        selfValue: key => state.self[key] || 0,
        setSelfValue: (key, v) => { if (v) state.self[key] = Math.floor(v) || v; else delete state.self[key]; },
        isSelf: id => /^SV:/.test($dataSystem.variables[id] || "")
    };
    global.$gameMap = { mapId: () => state.map };
    global.$gameParty = {
        numItems: item => state.bag[item.id] || 0,
        gainItem(item, n) { state.bag[item.id] = (state.bag[item.id] || 0) + n; if (state.bag[item.id] <= 0) delete state.bag[item.id]; },
        loseItem(item, n) { this.gainItem(item, -n); }
    };

    if (tweak) tweak();
    global.$dataEPEventsMap = undefined;
    console.log = () => {}; console.warn = m => state.warnings.push(String(m));
    for (const m of mods) new Function(modSrc(m))();
    DataManager.onLoad($dataItems);
    DataManager.onLoad($dataCommonEvents);
    DataManager.onLoad($dataSystem);
    DataManager.isDatabaseLoaded();
    global.$dataEPEventsMap = readJson("Map053.json");                                    // arrives last, like in the game
    DataManager.onLoad($dataEPEventsMap);
    DataManager.isDatabaseLoaded();
    console.log = realLog; console.warn = realLog;
    global.$gameShop = new Game_Shop();
}

// ---- a small event interpreter with the engine's own branch logic ----
const subst = text => String(text).replace(/\\[vV]\[(\d+)\]/g, (m, id) => $gameVariables.value(Number(id)));
class Interp {
    constructor(eventId, choices, log) { this._mapId = state.map; this._eventId = eventId; this.choices = choices; this.log = log; }
    eventId() { return this._eventId; }
    getSv(id) { return $gameVariables.isSelf(id) ? $gameVariables.selfValue([this._mapId, this._eventId, id]) : 0; }
    setSv(id, v) { if ($gameVariables.isSelf(id)) $gameVariables.setSelfValue([this._mapId, this._eventId, id], v); }
    skipBranch() { while (this._list[this._index + 1].indent > this._indent) this._index++; }
    run(list) {
        this._list = list; this._index = 0; this._branch = {};
        for (let guard = 0; this._index < this._list.length; this._index++) {
            if (guard++ > 5000) throw new Error("event does not end");
            const c = this._list[this._index], p = c.parameters;
            this._indent = c.indent;
            switch (c.code) {
                case 111: {
                    let result;
                    if (p[0] === 12) result = !!eval(p[1]);
                    else if (p[0] === 0) result = !!state.switches[p[1]] === (p[2] === 0);
                    else throw new Error("condition type " + p[0] + " not supported by the test");
                    this._branch[this._indent] = result;
                    if (result === false) this.skipBranch();
                    break;
                }
                case 411: if (this._branch[this._indent] !== false) this.skipBranch(); break;
                case 102: {
                    if (!this.choices.length) throw new Error("the event asked for a choice the test did not expect");
                    this.log.push(`choice box "${this.template}" with ${p[0].length} options, cancel = option ${p[1]}`);
                    this._branch[this._indent] = this.choices.shift();
                    break;
                }
                case 402: if (this._branch[this._indent] !== p[0]) this.skipBranch(); break;
                case 115: this._index = this._list.length; break;
                case 117: this.call(p[0]); break;
                case 122: {
                    const value = p[3] === 0 ? p[4] : p[3] === 1 ? $gameVariables.value(p[4]) : p[3] === 4 ? eval(p[4]) : (() => { throw new Error("operand type " + p[3]); })();
                    if (p[2] !== 0) throw new Error("only 'set' is supported by the test");
                    for (let id = p[0]; id <= p[1]; id++) {
                        if ($gameVariables.isSelf(id)) this.setSv(id, value); else $gameVariables.setValue(id, value);
                    }
                    break;
                }
                case 121: for (let id = p[0]; id <= p[1]; id++) state.switches[id] = p[2] === 0; break;
                case 355: eval(p[0]); break;
                case 357:
                    if (p[0] === "EliMZ_ChoiceManager") this.template = p[3].id;
                    else if (p[0] === "CGMZ_ToastManager") this.log.push("toast: " + subst(p[3].lineOne));
                    else if (p[0] === "PKD_PocketEvents") this.log.push("plugin: " + p[1]);
                    else this.log.push("plugin: " + p[0] + " " + p[1]);
                    break;
                case 401: this.log.push("text: " + subst(p[0]).replace(/\\c\[\d+\]/g, "").trim()); break;
                case 250: this.log.push("sound: " + p[0].name); break;
                case 0: case 101: case 404: case 412: case 657: case 230: case 108: case 408: break;
                default: throw new Error("command " + c.code + " not supported by the test");
            }
        }
    }
    call(id) {
        const ev = $dataCommonEvents[id];
        if (id >= vanilla.events.length) {                       // an event a mod added: really run it
            const child = new Interp(this._eventId, this.choices, this.log);
            child.template = this.template;
            child.run(ev.list);
            return;
        }
        if (ev.name === "Give item (Farm)") {
            const item = $dataItems[$gameVariables.value(30)], n = $gameVariables.value(31);
            $gameParty.gainItem(item, n);
            this.log.push(`give: ${n} x ${item.name} (item ${item.id})`);
        } else if (ev.name === "Reset All Object SV/SS") {
            for (const key of Object.keys(state.self)) if (key.startsWith(this._mapId + "," + this._eventId + ",")) delete state.self[key];
            this.log.push("reset object variables");
        } else this.log.push("call: " + ev.name);
    }
}
const use = (eventId, choices) => {
    const log = [];
    const i = new Interp(eventId, (choices || []).slice(), log);
    i.run($dataEPEventsMap.events[MAKER].pages[2].list);
    if (i.choices.length) fail("the event did not ask for all the choices the test prepared");
    return log;
};
const show = (title, log) => realLog("   " + title.padEnd(44) + log.join(" | "));
const place = (itemId, mapId) => {                              // what the game does when an item is used and put down
    state.map = mapId;
    PKD_EPManager.Start(MAKER, itemId);
    const data = PKD_EPManager.CurrentPlacementItemData();
    const ok = PKD_EPManager.wteIsCurrentMapValid();
    let eventId = 0;
    if (ok) { eventId = $gameTemp._epSpawned.eventId(); PKD_EPManager.PlaceItemOn(5, 5); }
    PKD_EPManager.Stop();
    return { ok, eventId, regions: data.onlyRegions.join(",") };
};
const sv = (eventId, id) => $gameVariables.selfValue([state.map, eventId, id]);

// ============================ A. Espresso + CoffeeMachines ============================
realLog("A. Espresso + CoffeeMachines: what is added");
boot(["Espresso", "CoffeeMachines"]);
if (!CoffeeMachines.enabled) fail("mod did not switch itself on");
const coffeeM = $dataItems[1401], espressoM = $dataItems[1402];
for (const [slot, name, price] of [[1401, "Coffee Machine", 20], [1402, "Espresso Machine", 30]]) {
    const it = $dataItems[slot];
    realLog(`   slot ${slot}: ${JSON.stringify(vanilla.items[slot].name)} -> ${JSON.stringify(it.name)}, price ${it.price}, icon ${it.iconIndex}, use event ${it.effects[0].dataId}`);
    realLog("      " + it.description.replace(/\\c\[\d+\]/g, "").replace("\n", " / "));
    if (it.name !== name || it.price !== price || it.id !== slot || it.consumable || it.effects[0].code !== 44) fail("item " + slot + " wrong");
    const ev = $dataCommonEvents[it.effects[0].dataId];
    const cmd = ev && ev.list.find(c => c.code === 357 && c.parameters[1] === "PlacePocketEvent");
    if (!ev || ev.id < vanilla.events.length || !cmd || cmd.parameters[3].gameItemId !== String(slot) || cmd.parameters[3].placementItemId !== String(MAKER)) fail("use event of " + name + " wrong");
}
let changed = [];
for (let i = 1; i < vanilla.items.length; i++) if (!same(vanilla.items[i], Object.assign({}, $dataItems[i], { meta: undefined }))) changed.push(i);
if (!same(changed, [1400, 1401, 1402]) || $dataItems.length !== vanilla.items.length) fail("items changed: " + changed);
for (let i = 0; i < vanilla.events.length; i++) if (!same(vanilla.events[i], $dataCommonEvents[i])) fail("common event " + i + " was changed");
realLog("   common events added: " + $dataCommonEvents.slice(vanilla.events.length).map(e => `${e.id} "${e.name}" (${e.list.length} commands)`).join(", "));
if ($dataCommonEvents.length !== vanilla.events.length + 4) fail("expected 4 added common events (1 Espresso, 3 here)");
$dataCommonEvents.slice(vanilla.events.length).forEach((e, i) => { if (e.id !== vanilla.events.length + i) fail("added event has the wrong id"); });

let templateChanges = 0;
vanilla.templates.events.forEach((ev, i) => {
    if (!ev) return;
    ev.pages.forEach((pg, p) => {
        const now = $dataEPEventsMap.events[i].pages[p];
        if (same(pg, now)) return;
        templateChanges++;
        if (i !== MAKER || p !== 2) return fail(`template ${i} page ${p} changed`);
        if (!same(now.list.slice(5), pg.list) || !same(Object.assign({}, now, { list: 0 }), Object.assign({}, pg, { list: 0 }))) fail("Coffee Maker page: more than the 5 leading commands changed");
        realLog("   Coffee Maker template page 2: 5 commands added in front -> " + now.list.slice(0, 5).map(c => c.code).join(",") + ", calls event " + now.list[1].parameters[0]);
    });
    if ($dataEPEventsMap.events[i].pages.length !== ev.pages.length) fail("template " + i + " page count changed");
});
if (templateChanges !== 1) fail("expected exactly one changed template page, got " + templateChanges);
const tpl = Eli.ChoiceManager.parameters.templates.coffeemachine;
const pics = tpl ? JSON.parse(tpl.choiceList).map(e => JSON.parse(e).backEnabledImage.split("/").pop()) : [];
realLog("   choice box \"coffeemachine\": " + pics.join(", "));
if (!same(pics, ["CofeeMaker", "pickup", "cancel"])) fail("choice template wrong");
if (JSON.parse(Eli.ChoiceManager.parameters.templates.coffee.choiceList).length !== 4) fail("the game's own coffee choice box was changed");

// ============================ B. where it can be placed ============================
realLog("\nB. Placing");
const keg = PKD_EasyPlacement.PARAMS.ITEMS.find(e => e && $dataEPEventsMap.events[e.eventId].name === "Keg").onlyRegions.join(",");
const narrow = PKD_EasyPlacement.PARAMS.ITEMS[MAKER].onlyRegions.join(",");
state.bag = { 2044: 5, 1401: 5, 1402: 5 };
const rows = [["Coffee Maker", 2044, FARM, false, narrow], ["Coffee Machine", 1401, FARM, true, keg], ["Coffee Maker", 2044, FARM, false, narrow],
    ["Espresso Machine", 1402, FARM, true, keg], ["Coffee Machine", 1401, TOWN, false, keg], ["Coffee Maker", 2044, HOME, true, narrow], ["Coffee Machine", 1401, HOME, true, keg]];
const eventsPlaced = {};
for (const [name, item, mapId, want, regions] of rows) {
    const r = place(item, mapId);
    realLog(`   ${name.padEnd(17)} on map ${String(mapId).padEnd(3)} ${r.ok ? "allowed" : "refused"}   regions ${r.regions}`);
    if (r.ok !== want || r.regions !== regions) fail(`${name} on map ${mapId}: expected ${want ? "allowed" : "refused"} with regions ${regions}`);
    if (r.ok) {
        eventsPlaced[item + ":" + mapId] = r.eventId;
        const marker = $gameVariables.selfValue([mapId, r.eventId, 1286]);
        if (marker !== (item === 2044 ? 0 : item)) fail(`${name}: marker is ${marker}`);
    }
}
if (PKD_EasyPlacement.PARAMS.ITEMS[MAKER].onlyRegions.join(",") !== narrow) fail("the Coffee Maker's own placement rules were changed");
if (state.placed.some(p => p.placement !== MAKER || p.selfSwitch !== "D")) fail("a machine was not placed as the Coffee Maker object");
if (state.bag[1401] !== 3 || state.bag[1402] !== 4 || state.bag[2044] !== 4) fail("placing did not use up the right items: " + JSON.stringify(state.bag));

// ============================ C. using the machines ============================
realLog("\nC. Using a Coffee Machine (on the Farm)");
state.map = FARM;
const cm = eventsPlaced["1401:" + FARM];
state.vars[133] = 1000; state.bag = {};
let log = use(cm, [0]); show("empty, no beans, choose brew:", log);
if (!log.some(l => /Not enough Coffee Bean/.test(l)) || !log.some(l => /Requires 1 Coffee Bean to produce 1 Cup of Coffee/.test(l)) || CoffeeMachines.state({ getSv: id => sv(cm, id) }) !== 0) fail("no-beans message wrong");
if (!/"coffeemachine" with 3 options, cancel = option 2/.test(log.join())) fail("choice box wrong");
state.bag = { 1220: 1, 1601: 2 };
log = use(cm, [2]); show("empty, choose cancel:", log);
if (!same(state.bag, { 1220: 1, 1601: 2 }) || sv(cm, 108)) fail("cancel changed something");
log = use(cm, [0]); show("empty, choose brew:", log);
if (!same(state.bag, { 1220: 1, 1601: 1 })) fail("should take one of the cheapest beans: " + JSON.stringify(state.bag));
if (sv(cm, 107) !== 2043 || sv(cm, 108) !== 1 || sv(cm, 106) !== 1060 || !log.includes("toast: Check back in 1 hour")) fail("brewing state wrong");
state.vars[133] = 1030;
log = use(cm, []); show("30 minutes later:", log);
if (!same(log, ["toast: Ready in 30 min"]) || sv(cm, 108) !== 1) fail("brewing message wrong");
state.vars[133] = 1060;
log = use(cm, []); show("60 minutes later:", log);
if (state.bag[2043] !== 1 || sv(cm, 108) || sv(cm, 107) || sv(cm, 106) || !log.includes("call: Crafting Quest Checks")) fail("collecting wrong");
if (sv(cm, 1286) !== 1401) fail("machine marker lost after collecting");
log = use(cm, [1]); show("empty, choose pick up:", log);
if (state.bag[1401] !== 1 || !log.includes("plugin: RemovePocketEvent2") || sv(cm, 1286) || sv(cm, 24)) fail("pick up wrong: " + JSON.stringify(state.bag));

realLog("\n   Espresso Machine (on the Farm)");
const em = eventsPlaced["1402:" + FARM];
state.bag = { 1601: 1 };
log = use(em, [0]); show("empty, 1 bean, choose brew:", log);
if (!log.some(l => /Requires 2 Coffee Bean to produce 1 Espresso/.test(l)) || state.bag[1601] !== 1) fail("espresso needs 2 beans");
state.bag = { 1601: 1, 1208: 3 };
log = use(em, [0]); show("empty, 4 beans, choose brew:", log);
if (!same(state.bag, { 1208: 2 }) || sv(em, 107) !== 1400) fail("espresso brew wrong: " + JSON.stringify(state.bag));
state.vars[133] += 60;
log = use(em, []); show("60 minutes later:", log);
if (state.bag[1400] !== 1) fail("no espresso handed over");
log = use(em, [1]); show("pick up:", log);
if (state.bag[1402] !== 1) fail("espresso machine not handed back");

realLog("\n   An ordinary Coffee Maker (in the Home)");
state.map = HOME;
log = use(eventsPlaced["2044:" + HOME], [3]); show("use, choose cancel:", log);
if (!/"coffee" with 4 options, cancel = option 3/.test(log.join()) || !log.includes("call: Set Choice Box Coords")) fail("the Coffee Maker no longer behaves as in the game");
log = use(eventsPlaced["2044:" + HOME], [2]); show("use, choose pick up:", log);
if (!log.includes("give: 1 x Coffee Maker (item 2044)")) fail("Coffee Maker pick up changed");

// ============================ D. the shop ============================
realLog("\nD. Shops");
const shopNames = JSON.parse(params("DM_CoreShop")["Shop Manager"]).map(s => JSON.parse(s)["Shop Name"]);
new Scene_CoreShop().create();
shopNames.forEach((name, i) => {
    $gameShop._tempShopId = i;
    const goods = $gameShop.storedGoods(), mine = goods.filter(g => g.id === 1401 || g.id === 1402);
    const want = name === "General Store" ? 2 : 0;
    if (mine.length !== want) fail(`shop ${i + 1} "${name}" lists ${mine.length} machines`);
    if (want) {
        realLog(`   shop ${i + 1} "${name}": ` + mine.map(g => `${g.name} ${g.price} gold (stock ${g.amount === "" ? "unlimited" : g.amount})`).join(", "));
        if (!same(mine.map(g => g.price), [20, 30]) || goods.length !== $gameShop._coreShops[i]._storedContents.length + 2) fail("shop goods wrong");
        if ($gameShop.storedGoods().find(g => g.id === 1401) !== mine[0]) fail("goods are rebuilt on every call");
    }
    if ($gameShop._coreShops[i]._storedContents.some(g => g.id === 1401 || g.id === 1402)) fail("the saved stock of shop " + (i + 1) + " was changed");
});

// ============================ E. without the Espresso mod ============================
realLog("\nE. CoffeeMachines without the Espresso mod");
boot(["CoffeeMachines"]);
realLog(`   slot 1401: ${JSON.stringify($dataItems[1401].name)}, slot 1402: ${JSON.stringify($dataItems[1402].name)}, enabled: ${CoffeeMachines.enabled}`);
if ($dataItems[1401].name !== "Coffee Machine" || $dataItems[1402].name !== "Empty" || !CoffeeMachines.enabled) fail("coffee machine should work alone");
if ($dataCommonEvents.length !== vanilla.events.length + 2) fail("expected 2 added common events");
$gameShop._tempShopId = 1;
if ($gameShop.storedGoods().filter(g => g.id === 1401 || g.id === 1402).length !== 1) fail("shop should list only the Coffee Machine");

// ============================ F. safety switches ============================
realLog("\nF. Safety");
boot(["Espresso", "CoffeeMachines"], () => { $dataItems[1401].name = "Something New"; });
realLog("   slot 1401 taken by a game update -> enabled: " + CoffeeMachines.enabled + " | " + (state.warnings.find(w => /CoffeeMachines/.test(w)) || ""));
if (CoffeeMachines.enabled || $dataItems[1402].name !== "Empty" || !same($dataEPEventsMap, vanilla.templates) || $dataCommonEvents.length !== vanilla.events.length + 1) fail("mod should have done nothing");
$gameShop._tempShopId = 1;
if ($gameShop.storedGoods().some(g => g.id === 1401 || g.id === 1402)) fail("disabled mod still sells machines");
boot(["Espresso", "CoffeeMachines"], () => { $dataSystem.variables[1286] = "SV: Something else"; });
realLog("   marker variable renamed by a game update -> enabled: " + CoffeeMachines.enabled);
if (CoffeeMachines.enabled || !same($dataEPEventsMap, vanilla.templates)) fail("mod should have done nothing");

// A save with a placed machine, opened without the mod: it is a Coffee Maker.
boot([]);
state.map = FARM; state.self[[FARM, 900, 1286]] = 1401; state.self[[FARM, 900, 24]] = 1;
log = use(900, [2]); show("machine in a save, mod removed, pick up:", log);
if (!log.includes("give: 1 x Coffee Maker (item 2044)")) fail("without the mod a placed machine should be a Coffee Maker");

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
