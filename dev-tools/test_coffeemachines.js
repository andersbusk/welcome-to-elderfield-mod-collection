// Offline harness for the CoffeeMachines mod (together with Espresso). Loads the real item,
// common event, system and placeable-template data, copies the few pieces of game logic the mod
// hooks into (placement rules and the map whitelist, shop stock, self variables, character
// sprites), then runs the machine's event through a small event interpreter for every situation
// a player can be in.
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
const MAKER = 160, ESPRESSO = 317;       // template and placement numbers of the Coffee Maker and the Espresso Machine
const COFFEE_MACHINE = 1401, ESPRESSO_MACHINE = 2591, COFFEE_MAKER = 2044;
const PLACEMENT = { [COFFEE_MACHINE]: MAKER, [COFFEE_MAKER]: MAKER, [ESPRESSO_MACHINE]: ESPRESSO, 1402: MAKER };
const HOME = 2, FARM = 34, TOWN = 1;
const plain = t => String(t).replace(/\\c\[\d+\]/g, "").replace(/\n/g, " / ");

let state;                               // per boot: variables, bag, log ...

function boot(mods, tweak) {
    global.window = global;
    delete global.EspressoMod;
    delete global.CoffeeMachines;
    state = { vars: {}, self: {}, switches: {}, bag: {}, map: HOME, nextEventId: 500, placed: [], warnings: [], mapEvents: [] };
    global.$dataItems = readJson("Items.json");
    global.$dataCommonEvents = readJson("CommonEvents.json");
    global.$dataSystem = readJson("System.json");
    global.CGMZ = { Crafting: { Recipes: JSON.parse(params("CGMZ_Crafting").Recipes) } };
    global.PluginManager = { parameters: params };
    global.DataManager = {
        onLoad() {}, isDatabaseLoaded() { return true; }, extractSaveContents() {},
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
    global.PKD_EasyPlacement = { PARAMS: { ITEMS: [null].concat(list) }, Utils: { GetCommentCodeValue: (code, event) => (code === "placeOverType" && event.type) || null } };
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

    // --- character sprites (engine logic) ---
    const sheets = {};
    global.Bitmap = function(w, h) { this.width = w; this.height = h; this.smooth = true; this.drawn = []; this._canvas = {}; this._baseTexture = { destroyed: false }; };
    Bitmap.prototype.addLoadListener = function(cb) { cb(this); };
    Bitmap.prototype.blt = function(source) { this.drawn.push(source.name); this._customModified = true; };   // VisuMZ_0_CoreEngine marks drawn-on bitmaps
    Bitmap.prototype.destroy = function() {                                                                    // WTE_SpriteBaker's guard, then the engine
        if (this._wteIndestructible) return;
        this._baseTexture = null; this._canvas = null;
    };
    // VisuMZ_0_CoreEngine: a drawn-on bitmap is freed together with a sprite that shows it
    global.freeSprite = sprite => { if (sprite.bitmap && sprite.bitmap._customModified) sprite.bitmap.destroy(); };
    // the machines' sheets are 3 x 4 cells of 16 x 32, the Keg's 16 x 48
    global.ImageManager = { loadCharacter(name) { if (!sheets[name]) { sheets[name] = new Bitmap(48, /Keg/.test(name) ? 192 : 128); sheets[name].name = name; sheets[name].smooth = false; } return sheets[name]; } };
    global.Graphics = { frameCount: 0 };
    global.Sprite_Character = function(character) { this._character = character; this._characterName = undefined; this.bitmap = null; };
    Sprite_Character.prototype.updateBitmap = function() {
        if (this._characterName !== this._character.characterName()) {
            this._characterName = this._character.characterName();
            this.bitmap = ImageManager.loadCharacter(this._characterName);
        }
    };

    // --- game state ---
    global.$gameVariables = {
        value: id => state.vars[id] || 0,
        setValue: (id, v) => { state.vars[id] = typeof v === "number" ? Math.floor(v) : v; },
        selfValue: key => state.self[key] || 0,
        setSelfValue: (key, v) => { if (v) state.self[key] = Math.floor(v) || v; else delete state.self[key]; },
        isSelf: id => /^SV:/.test($dataSystem.variables[id] || "")
    };
    global.$gameMap = { mapId: () => state.map, eventsXy: (x, y) => state.mapEvents.filter(e => e.x === x && e.y === y) };
    global.$gameParty = {
        get _items() { return state.bag; },
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
const use = (template, eventId, choices) => {
    const log = [];
    const i = new Interp(eventId, (choices || []).slice(), log);
    i.run($dataEPEventsMap.events[template].pages[2].list);
    if (i.choices.length) fail("the event did not ask for all the choices the test prepared");
    return log;
};
const show = (title, log) => realLog("   " + title.padEnd(46) + log.join(" | "));
const place = (itemId, mapId) => {                              // what the game does when an item is used and put down
    state.map = mapId;
    PKD_EPManager.Start(PLACEMENT[itemId], itemId);
    const data = PKD_EPManager.CurrentPlacementItemData();
    const ok = PKD_EPManager.wteIsCurrentMapValid();
    let eventId = 0;
    if (ok) { eventId = $gameTemp._epSpawned.eventId(); PKD_EPManager.PlaceItemOn(5, 5); }
    PKD_EPManager.Stop();
    return { ok, eventId, regions: data.onlyRegions.join(","), over: data.spawnOverEventsTypes };
};
const sv = (eventId, id) => $gameVariables.selfValue([state.map, eventId, id]);

// ============================ A. Espresso + CoffeeMachines ============================
realLog("A. Espresso + CoffeeMachines: what is added");
boot(["Espresso", "CoffeeMachines"]);
if (!CoffeeMachines.enabled) fail("mod did not switch itself on");
{
    const it = $dataItems[COFFEE_MACHINE];
    realLog(`   slot ${COFFEE_MACHINE}: ${JSON.stringify(vanilla.items[COFFEE_MACHINE].name)} -> ${JSON.stringify(it.name)}, price ${it.price}, icon ${it.iconIndex}, use event ${it.effects[0].dataId}`);
    realLog("      " + plain(it.description));
    if (it.name !== "Coffee Machine" || it.price !== 20 || it.id !== COFFEE_MACHINE || it.consumable || it.effects[0].code !== 44) fail("Coffee Machine item wrong");
    const ev = $dataCommonEvents[it.effects[0].dataId];
    const cmd = ev && ev.list.find(c => c.code === 357 && c.parameters[1] === "PlacePocketEvent");
    if (!ev || ev.id < vanilla.events.length || !cmd || cmd.parameters[3].gameItemId !== String(COFFEE_MACHINE) || cmd.parameters[3].placementItemId !== String(MAKER)) fail("use event of the Coffee Machine wrong");
    const was = vanilla.items[ESPRESSO_MACHINE], now = $dataItems[ESPRESSO_MACHINE];
    realLog(`   item ${ESPRESSO_MACHINE} ${JSON.stringify(now.name)} (the game's own): icon ${now.iconIndex}, price ${now.price}, description`);
    realLog("      " + plain(was.description) + "  ->  " + plain(now.description));
    if (!same(Object.assign({}, was, { description: "" }), Object.assign({}, now, { description: "", meta: undefined })) || was.description === now.description) fail("only the description of the game's Espresso Machine may change");
}
let changed = [];
for (let i = 1; i < vanilla.items.length; i++) if (!same(vanilla.items[i], Object.assign({}, $dataItems[i], { meta: undefined }))) changed.push(i);
if (!same(changed, [1400, COFFEE_MACHINE, 1403, 1404, ESPRESSO_MACHINE]) || $dataItems.length !== vanilla.items.length) fail("items changed: " + changed);
if ($dataItems[1402].name !== "Empty") fail("slot 1402 should stay blank");
for (let i = 0; i < vanilla.events.length; i++) if (!same(vanilla.events[i], $dataCommonEvents[i])) fail("common event " + i + " was changed");
realLog("   common events added: " + $dataCommonEvents.slice(vanilla.events.length).map(e => `${e.id} "${e.name}" (${e.list.length} commands)`).join(", "));
if ($dataCommonEvents.length !== vanilla.events.length + 5) fail("expected 5 added common events (3 Espresso, 2 here)");
$dataCommonEvents.slice(vanilla.events.length).forEach((e, i) => { if (e.id !== vanilla.events.length + i) fail("added event has the wrong id"); });

let templateChanges = 0;
vanilla.templates.events.forEach((ev, i) => {
    if (!ev) return;
    ev.pages.forEach((pg, p) => {
        const now = $dataEPEventsMap.events[i].pages[p];
        if (same(pg, now)) return;
        templateChanges++;
        if ((i !== MAKER && i !== ESPRESSO) || p !== 2) return fail(`template ${i} page ${p} changed`);
        const rest = Object.assign({}, now, { list: 0 }), restWas = Object.assign({}, pg, { list: 0 });
        if (i === ESPRESSO) { if (pg.through !== true || now.through !== false) fail("Espresso Machine page: 'through' should go from on to off"); restWas.through = false; }
        if (!same(now.list.slice(5), pg.list) || !same(rest, restWas)) fail(`template ${i} page: more than the 5 leading commands changed`);
        realLog(`   ${ev.name} template page 2: 5 commands added in front -> ${now.list.slice(0, 5).map(c => c.code).join(",")}, calls event ${now.list[1].parameters[0]}` +
            (i === ESPRESSO ? "; no longer walk-through" : "") + `\n      condition: ${now.list[0].parameters[1]}`);
    });
    if ($dataEPEventsMap.events[i].pages.length !== ev.pages.length) fail("template " + i + " page count changed");
});
if (templateChanges !== 2) fail("expected exactly two changed template pages, got " + templateChanges);
const tpl = Eli.ChoiceManager.parameters.templates.coffeemachine;
const pics = tpl ? JSON.parse(tpl.choiceList).map(e => JSON.parse(e).backEnabledImage.split("/").pop()) : [];
realLog("   choice box \"coffeemachine\": " + pics.join(", "));
if (!same(pics, ["CofeeMaker", "pickup", "cancel"])) fail("choice template wrong");
if (JSON.parse(Eli.ChoiceManager.parameters.templates.coffee.choiceList).length !== 4) fail("the game's own coffee choice box was changed");

// ============================ B. where it can be placed ============================
realLog("\nB. Placing");
const keg = PKD_EasyPlacement.PARAMS.ITEMS.find(e => e && $dataEPEventsMap.events[e.eventId].name === "Keg").onlyRegions.join(",");
const narrow = PKD_EasyPlacement.PARAMS.ITEMS[MAKER].onlyRegions.join(",");
state.bag = { [COFFEE_MAKER]: 5, [COFFEE_MACHINE]: 5, [ESPRESSO_MACHINE]: 5 };
const rows = [["Coffee Maker", COFFEE_MAKER, FARM, false, narrow], ["Coffee Machine", COFFEE_MACHINE, FARM, true, keg], ["Coffee Maker", COFFEE_MAKER, FARM, false, narrow],
    ["Espresso Machine", ESPRESSO_MACHINE, FARM, true, keg], ["Espresso Machine", ESPRESSO_MACHINE, TOWN, false, keg], ["Coffee Machine", COFFEE_MACHINE, TOWN, false, keg],
    ["Coffee Maker", COFFEE_MAKER, HOME, true, narrow], ["Coffee Machine", COFFEE_MACHINE, HOME, true, keg], ["Espresso Machine", ESPRESSO_MACHINE, HOME, true, keg]];
const eventsPlaced = {};
for (const [name, item, mapId, want, regions] of rows) {
    const r = place(item, mapId);
    realLog(`   ${name.padEnd(17)} on map ${String(mapId).padEnd(3)} ${r.ok ? "allowed" : "refused"}   regions ${r.regions}`);
    if (r.ok !== want || r.regions !== regions) fail(`${name} on map ${mapId}: expected ${want ? "allowed" : "refused"} with regions ${regions}`);
    if (item === ESPRESSO_MACHINE && r.over !== PKD_EasyPlacement.PARAMS.ITEMS[ESPRESSO].spawnOverEventsTypes) fail("Espresso Machine lost its 'can stand on tables' rule");
    if (r.ok) {
        eventsPlaced[item + ":" + mapId] = r.eventId;
        const marker = $gameVariables.selfValue([mapId, r.eventId, 1286]);
        if (marker !== (item === COFFEE_MAKER ? 0 : item)) fail(`${name}: marker is ${marker}`);
    }
}
if (PKD_EasyPlacement.PARAMS.ITEMS[MAKER].onlyRegions.join(",") !== narrow || PKD_EasyPlacement.PARAMS.ITEMS[ESPRESSO].onlyRegions.join(",") !== narrow) fail("the game's own placement rules were changed");
if (state.placed.some(p => p.selfSwitch !== "D") || !same(state.placed.map(p => p.placement), [MAKER, ESPRESSO, MAKER, MAKER, ESPRESSO])) fail("objects were not placed as the game's own Coffee Maker / Espresso Machine: " + state.placed.map(p => p.placement));
if (state.bag[COFFEE_MACHINE] !== 3 || state.bag[ESPRESSO_MACHINE] !== 3 || state.bag[COFFEE_MAKER] !== 4) fail("placing did not use up the right items: " + JSON.stringify(state.bag));

// ============================ C. using the machines ============================
realLog("\nC. Using a Coffee Machine (on the Farm)");
state.map = FARM;
const cm = eventsPlaced[COFFEE_MACHINE + ":" + FARM];
state.vars[133] = 1000; state.bag = {};
let log = use(MAKER, cm, [0]); show("empty, no beans, choose brew:", log);
if (!log.some(l => /Not enough Coffee Bean/.test(l)) || !log.some(l => /Requires 1 Coffee Bean to produce 1 Cup of Coffee/.test(l)) || CoffeeMachines.state({ getSv: id => sv(cm, id) }) !== 0) fail("no-beans message wrong");
if (!/"coffeemachine" with 3 options, cancel = option 2/.test(log.join())) fail("choice box wrong");
state.bag = { 1220: 1, 1601: 2 };
log = use(MAKER, cm, [2]); show("empty, choose cancel:", log);
if (!same(state.bag, { 1220: 1, 1601: 2 }) || sv(cm, 108)) fail("cancel changed something");
log = use(MAKER, cm, [0]); show("empty, choose brew:", log);
if (!same(state.bag, { 1220: 1, 1601: 1 })) fail("should take one of the cheapest beans: " + JSON.stringify(state.bag));
if (sv(cm, 107) !== 2043 || sv(cm, 108) !== 1 || sv(cm, 106) !== 1060 || !log.includes("toast: Check back in 1 hour")) fail("brewing state wrong");
state.vars[133] = 1030;
log = use(MAKER, cm, []); show("30 minutes later:", log);
if (!same(log, ["toast: Ready in 30 min"]) || sv(cm, 108) !== 1) fail("brewing message wrong");
state.vars[133] = 1060;
log = use(MAKER, cm, []); show("60 minutes later:", log);
if (state.bag[2043] !== 1 || sv(cm, 108) || sv(cm, 107) || sv(cm, 106) || !log.includes("call: Crafting Quest Checks")) fail("collecting wrong");
if (sv(cm, 1286) !== COFFEE_MACHINE) fail("machine marker lost after collecting");
log = use(MAKER, cm, [1]); show("empty, choose pick up:", log);
if (state.bag[COFFEE_MACHINE] !== 1 || !log.includes("plugin: RemovePocketEvent2") || sv(cm, 1286) || sv(cm, 24)) fail("pick up wrong: " + JSON.stringify(state.bag));

realLog("\n   The Espresso Machine (on the Farm)");
const em = eventsPlaced[ESPRESSO_MACHINE + ":" + FARM];
state.bag = { 1601: 1 };
log = use(ESPRESSO, em, [0]); show("empty, 1 bean, choose brew:", log);
if (!log.some(l => /Requires 2 Coffee Bean to produce 1 Espresso/.test(l)) || state.bag[1601] !== 1) fail("espresso needs 2 beans");
state.bag = { 1601: 1, 1208: 3 };
log = use(ESPRESSO, em, [0]); show("empty, 4 beans, choose brew:", log);
if (!same(state.bag, { 1208: 2 }) || sv(em, 107) !== 1400) fail("espresso brew wrong: " + JSON.stringify(state.bag));
state.vars[133] += 60;
log = use(ESPRESSO, em, []); show("60 minutes later:", log);
if (state.bag[1400] !== 1) fail("no espresso handed over");
log = use(ESPRESSO, em, [1]); show("pick up:", log);
if (state.bag[ESPRESSO_MACHINE] !== 1 || log.includes("call: Deco Pickup")) fail("espresso machine not handed back by the machine's own menu");
state.self[[FARM, 950, 24]] = 1;                                   // one that was placed as a decoration before the mod
log = use(ESPRESSO, 950, [2]); show("one placed before the mod, cancel:", log);
if (!/"coffeemachine" with 3 options/.test(log.join()) || sv(950, 1286) !== ESPRESSO_MACHINE) fail("an Espresso Machine from before the mod should work as a machine");

realLog("\n   An ordinary Coffee Maker (in the Home)");
state.map = HOME;
log = use(MAKER, eventsPlaced[COFFEE_MAKER + ":" + HOME], [3]); show("use, choose cancel:", log);
if (!/"coffee" with 4 options, cancel = option 3/.test(log.join()) || !log.includes("call: Set Choice Box Coords")) fail("the Coffee Maker no longer behaves as in the game");
log = use(MAKER, eventsPlaced[COFFEE_MAKER + ":" + HOME], [2]); show("use, choose pick up:", log);
if (!log.includes("give: 1 x Coffee Maker (item 2044)")) fail("Coffee Maker pick up changed");

realLog("\n   Left over from version 1.0 (an Espresso Machine that was its own item, placed as a Coffee Maker)");
state.self[[HOME, 960, 1286]] = 1402; state.self[[HOME, 960, 24]] = 1; state.bag = { 1208: 2 };
log = use(MAKER, 960, [0]); show("placed one, choose brew:", log);
if (sv(960, 107) !== 1400 || state.bag[1208]) fail("old espresso machine should still brew espresso from 2 beans");
state.vars[133] += 60; use(MAKER, 960, []);
log = use(MAKER, 960, [1]); show("placed one, pick up:", log);
if (!log.includes("give: 1 x Espresso Machine (item 2591)")) fail("old espresso machine should pick up as the game's Espresso Machine");
state.bag = { 1402: 2, [ESPRESSO_MACHINE]: 1 };
DataManager.extractSaveContents({});
realLog("   two old ones in the bag when a save is loaded -> bag: " + JSON.stringify(state.bag));
if (!same(state.bag, { [ESPRESSO_MACHINE]: 3 })) fail("old items in the bag were not converted");

// ============================ D. the shop ============================
realLog("\nD. Shops");
const shopNames = JSON.parse(params("DM_CoreShop")["Shop Manager"]).map(s => JSON.parse(s)["Shop Name"]);
new Scene_CoreShop().create();
shopNames.forEach((name, i) => {
    $gameShop._tempShopId = i;
    const goods = $gameShop.storedGoods(), mine = goods.filter(g => g.id === COFFEE_MACHINE || g.id === ESPRESSO_MACHINE);
    const want = name === "General Store" ? 2 : 0;
    if (mine.length !== want) fail(`shop ${i + 1} "${name}" lists ${mine.length} machines`);
    if (want) {
        realLog(`   shop ${i + 1} "${name}": ` + mine.map(g => `${g.name} ${g.price} gold (stock ${g.amount === "" ? "unlimited" : g.amount})`).join(", "));
        if (!same(mine.map(g => g.price), [20, 30]) || goods.length !== $gameShop._coreShops[i]._storedContents.length + 2) fail("shop goods wrong");
        if ($gameShop.storedGoods().find(g => g.id === COFFEE_MACHINE) !== mine[0]) fail("goods are rebuilt on every call");
    }
    if ($gameShop._coreShops[i]._storedContents.some(g => g.id === COFFEE_MACHINE || g.id === ESPRESSO_MACHINE)) fail("the saved stock of shop " + (i + 1) + " was changed");
});
if ($dataItems[ESPRESSO_MACHINE].price !== vanilla.items[ESPRESSO_MACHINE].price) fail("the Espresso Machine's own value was changed");

// ============================ E. how the Espresso Machine looks ============================
realLog("\nE. The Espresso Machine on screen");
const espressoSheet = vanilla.templates.events[ESPRESSO].pages[2].image.characterName, makerSheet = vanilla.templates.events[MAKER].pages[2].image.characterName;
const object = (template, x, y, sheet) => ({ x, y, event: () => $dataEPEventsMap.events[template], characterName: () => sheet });
const frames = (sprite, n) => { for (let i = 0; i < n; i++) sprite.updateBitmap(); };
const floorOne = object(ESPRESSO, 3, 3, espressoSheet), tableOne = object(ESPRESSO, 6, 3, espressoSheet), table = { x: 6, y: 3, type: "table" };
const rugOne = object(ESPRESSO, 8, 3, espressoSheet), rug = { x: 8, y: 3, type: "lower" };
const cafe = { x: 9, y: 9, event: () => ({ name: "EV012" }), characterName: () => espressoSheet };       // a map's own event using the same picture
const makerOne = object(MAKER, 1, 1, makerSheet);
state.mapEvents = [floorOne, tableOne, table, cafe, makerOne, rugOne, rug];
const sprites = [floorOne, tableOne, cafe, makerOne, rugOne].map(c => new Sprite_Character(c));
sprites.forEach(s => frames(s, 2));
const parts = b => [...new Set(b.drawn)];
const describe = s => (s.bitmap.name ? "the game's picture" : "espresso machine on a counter, drawn from: " + parts(s.bitmap).map(n => n.split("/").pop()).join(" + "));
realLog("   alone on its tile:      " + describe(sprites[0]));
realLog("   on a table:             " + describe(sprites[1]));
realLog("   on a rug:               " + describe(sprites[4]));
if (sprites[4].bitmap.name) fail("an Espresso Machine on a rug stands on the floor");
realLog("   same picture, other map event: " + describe(sprites[2]));
if (sprites[0].bitmap.name || !same(parts(sprites[0].bitmap), [makerSheet, espressoSheet]) || sprites[0].bitmap.width !== 48 || sprites[0].bitmap.height !== 128 || sprites[0].bitmap.smooth !== false) fail("floor-standing Espresso Machine should get the counter picture");
if (sprites[1].bitmap.name !== espressoSheet || sprites[2].bitmap.name !== espressoSheet || sprites[3].bitmap.name !== makerSheet) fail("only a floor-standing placed Espresso Machine may change its picture");
state.mapEvents.push({ x: 3, y: 3, type: "table" });                 // a table is put under the first one
frames(sprites[0], 25);
state.mapEvents = state.mapEvents.filter(e => e !== table);         // and the other one's table is taken away
frames(sprites[1], 25);
realLog("   after a table is put under the first and taken from the second: " + (sprites[0].bitmap.name ? "plain" : "counter") + ", " + (sprites[1].bitmap.name ? "plain" : "counter"));
if (sprites[0].bitmap.name !== espressoSheet || sprites[1].bitmap.name) fail("the picture should follow the table");
if (ImageManager.loadCharacter(espressoSheet).drawn.length) fail("the game's own sprite sheet was drawn on");
// Leaving the map (or picking one up) frees the sprites; the shared picture must survive that.
const shared = sprites[1].bitmap;
freeSprite(sprites[1]); freeSprite(sprites[4]);
const back = [tableOne, rugOne].map(c => new Sprite_Character(c));
back.forEach(s => frames(s, 2));
const fine = b => !b.name && b._canvas && b._baseTexture && !b._baseTexture.destroyed;
realLog("   after the sprites are freed and made again (leaving and re-entering the map): " + (back.every(s => fine(s.bitmap)) ? "counter still shown" : "BROKEN") +
    (back[0].bitmap === shared ? ", same picture" : ", a new picture"));
if (!back.every(s => fine(s.bitmap)) || back[0].bitmap !== shared) fail("the counter picture did not survive its sprites being freed");
shared._baseTexture = null; shared._canvas = null;                    // freed anyway, by something that ignores the mark
back.forEach(s => frames(s, 1));
realLog("   after the picture is freed by force: " + (back.every(s => fine(s.bitmap)) && back[0].bitmap !== shared ? "drawn again" : "BROKEN"));
if (!back.every(s => fine(s.bitmap)) || back[0].bitmap === shared || back[0].bitmap !== back[1].bitmap) fail("a freed counter picture should be drawn again");

// ---- the "ready" bubble ----
realLog("\n   The \"ready\" bubble (taken from the Keg's \"done\" picture)");
const kegSheet = vanilla.templates.events.find(e => e && e.name === "Keg").pages[4].image.characterName;
const machine = (template, x, id, sheet) => ({ x, y: 1, _mapId: HOME, eventId: () => id, event: () => $dataEPEventsMap.events[template], characterName: () => sheet });
const setState = (id, marker, count, finish) => {
    if (marker) state.self[[HOME, id, 1286]] = marker;
    if (count) { state.self[[HOME, id, 108]] = count; state.self[[HOME, id, 106]] = finish; } else { delete state.self[[HOME, id, 108]]; delete state.self[[HOME, id, 106]]; }
};
state.map = HOME; state.vars[133] = 5000;
const m = { coffee: machine(MAKER, 11, 801, makerSheet), maker: machine(MAKER, 12, 802, makerSheet), floor: machine(ESPRESSO, 13, 803, espressoSheet), table: machine(ESPRESSO, 14, 804, espressoSheet) };
setState(801, COFFEE_MACHINE, 1, 5060); setState(803, ESPRESSO_MACHINE, 1, 5060); setState(804, ESPRESSO_MACHINE, 1, 5060);
setState(802, 0, 1, 1);                                              // an ordinary Coffee Maker with stray numbers on it
state.mapEvents = [m.coffee, m.maker, m.floor, m.table, { x: 14, y: 1, type: "table" }];
const sp = {}; for (const k of Object.keys(m)) { sp[k] = new Sprite_Character(m[k]); frames(sp[k], 2); }
const what = s => (s.bitmap.name ? "the game's picture" : parts(s.bitmap).map(n => n.split("/").pop()).join(" + ") + " (" + s.bitmap.width + "x" + s.bitmap.height + ")");
const report = title => realLog("   " + title.padEnd(26) + Object.keys(sp).map(k => k + ": " + what(sp[k])).join(" | "));
report("while brewing:");
if (sp.coffee.bitmap.name !== makerSheet || sp.maker.bitmap.name !== makerSheet || sp.table.bitmap.name !== espressoSheet || !same(parts(sp.floor.bitmap), [makerSheet, espressoSheet])) fail("no bubble while brewing");
state.vars[133] = 5060;
for (const k of Object.keys(sp)) frames(sp[k], 20);
report("when the cup is ready:");
if (!same(parts(sp.coffee.bitmap), [makerSheet, kegSheet]) || !same(parts(sp.floor.bitmap), [makerSheet, espressoSheet, kegSheet]) || !same(parts(sp.table.bitmap), [espressoSheet, kegSheet])) fail("ready machines should show the bubble");
if ([sp.coffee, sp.floor, sp.table].some(s => s.bitmap.width !== 48 || s.bitmap.height !== 192)) fail("a picture with the bubble should be 16 rows taller per cell");
if (sp.maker.bitmap.name !== makerSheet) fail("an ordinary Coffee Maker must never show the bubble");
const still = sp.coffee.bitmap;
Graphics.frameCount += 15; frames(sp.coffee, 1);
const bobs = sp.coffee.bitmap !== still && !sp.coffee.bitmap.name;
Graphics.frameCount += 45; frames(sp.coffee, 1);
realLog("   the bubble bobs: " + (bobs && sp.coffee.bitmap === still ? "yes, and comes back to where it started" : "NO"));
if (!bobs || sp.coffee.bitmap !== still) fail("the bubble should move and return");
setState(801, 0, 0); setState(803, 0, 0); setState(804, 0, 0);       // cups collected
for (const k of Object.keys(sp)) frames(sp[k], 20);
report("after collecting:");
if (sp.coffee.bitmap.name !== makerSheet || sp.table.bitmap.name !== espressoSheet || !same(parts(sp.floor.bitmap), [makerSheet, espressoSheet]) || sp.floor.bitmap.height !== 128) fail("the bubble should go away after collecting");
if (ImageManager.loadCharacter(kegSheet).drawn.length || ImageManager.loadCharacter(makerSheet).drawn.length) fail("a game sprite sheet was drawn on");

// ============================ F. without the Espresso mod ============================
realLog("\nF. CoffeeMachines without the Espresso mod");
boot(["CoffeeMachines"]);
realLog(`   slot ${COFFEE_MACHINE}: ${JSON.stringify($dataItems[COFFEE_MACHINE].name)}, Espresso Machine untouched: ${same(vanilla.items[ESPRESSO_MACHINE], Object.assign({}, $dataItems[ESPRESSO_MACHINE], { meta: undefined }))}, enabled: ${CoffeeMachines.enabled}`);
if ($dataItems[COFFEE_MACHINE].name !== "Coffee Machine" || !CoffeeMachines.enabled) fail("coffee machine should work alone");
if (!same(vanilla.items[ESPRESSO_MACHINE], Object.assign({}, $dataItems[ESPRESSO_MACHINE], { meta: undefined })) || !same(vanilla.templates.events[ESPRESSO], $dataEPEventsMap.events[ESPRESSO])) fail("without Espresso the game's Espresso Machine must stay a decoration");
if ($dataCommonEvents.length !== vanilla.events.length + 2) fail("expected 2 added common events");
$gameShop._tempShopId = 13;
if (!same($gameShop.storedGoods().filter(g => g.id === COFFEE_MACHINE || g.id === ESPRESSO_MACHINE).map(g => g.id), [COFFEE_MACHINE])) fail("shop should list only the Coffee Machine");
state.map = HOME; state.self[[HOME, 970, 24]] = 1;
log = use(ESPRESSO, 970, []); show("a placed Espresso Machine:", log);
if (!same(log, ["call: Deco Pickup"])) fail("should be the game's plain decoration");
const lone = new Sprite_Character({ x: 2, y: 2, event: () => $dataEPEventsMap.events[ESPRESSO], characterName: () => vanilla.templates.events[ESPRESSO].pages[2].image.characterName });
state.mapEvents = [lone._character]; lone.updateBitmap(); lone.updateBitmap();
if (!lone.bitmap.name) fail("no counter picture without the Espresso mod");

// ============================ G. safety switches ============================
realLog("\nG. Safety");
boot(["Espresso", "CoffeeMachines"], () => { $dataItems[COFFEE_MACHINE].name = "Something New"; });
realLog("   slot 1401 taken by a game update -> enabled: " + CoffeeMachines.enabled + " | " + (state.warnings.find(w => /CoffeeMachines/.test(w)) || ""));
if (CoffeeMachines.enabled || !same($dataEPEventsMap, vanilla.templates) || $dataCommonEvents.length !== vanilla.events.length + 3 || $dataItems[ESPRESSO_MACHINE].description !== vanilla.items[ESPRESSO_MACHINE].description) fail("mod should have done nothing");
$gameShop._tempShopId = 13;
if ($gameShop.storedGoods().some(g => g.id === COFFEE_MACHINE || g.id === ESPRESSO_MACHINE)) fail("disabled mod still sells machines");
boot(["Espresso", "CoffeeMachines"], () => { $dataSystem.variables[1286] = "SV: Something else"; });
realLog("   marker variable renamed by a game update -> enabled: " + CoffeeMachines.enabled);
if (CoffeeMachines.enabled || !same($dataEPEventsMap, vanilla.templates)) fail("mod should have done nothing");
boot(["Espresso", "CoffeeMachines"], () => { $dataItems[ESPRESSO_MACHINE].name = "Latte Machine"; });
realLog("   the game's Espresso Machine renamed by a game update -> Coffee Machine still on: " + CoffeeMachines.enabled + ", Espresso Machine template untouched: " + same($dataEPEventsMap.events[ESPRESSO], vanilla.templates.events[ESPRESSO]));
if (!CoffeeMachines.enabled || !same($dataEPEventsMap.events[ESPRESSO], vanilla.templates.events[ESPRESSO])) fail("only the espresso part should switch off");

// A save with placed machines, opened without the mod.
boot([]);
state.map = FARM; state.self[[FARM, 900, 1286]] = COFFEE_MACHINE; state.self[[FARM, 900, 24]] = 1;
log = use(MAKER, 900, [2]); show("Coffee Machine in a save, mod removed, pick up:", log);
if (!log.includes("give: 1 x Coffee Maker (item 2044)")) fail("without the mod a placed Coffee Machine should be a Coffee Maker");
state.self[[FARM, 901, 1286]] = ESPRESSO_MACHINE; state.self[[FARM, 901, 24]] = 1; state.self[[FARM, 901, 108]] = 1;
log = use(ESPRESSO, 901, []); show("Espresso Machine in a save, mod removed:", log);
if (!same(log, ["call: Deco Pickup"])) fail("without the mod a placed Espresso Machine should be a decoration");

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
