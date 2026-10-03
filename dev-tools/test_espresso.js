// Integration harness for the Espresso mod together with LessGrind's coffee
// changes. Replicates the relevant bits of WTE_TimeConverter (timed states)
// and WTE_Footsteps (cached speed + mode flags), loads the real databases,
// then loads the mods in a chosen order and plays through drink scenarios.
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
const near = (a, b) => Math.abs(a - b) < 1e-9;

function boot(mods, tweak) {
    global.window = global;
    delete global.EspressoMod;
    // --- clock + timed states (WTE_TimeConverter logic) ---
    class Game_Time {
        constructor(h = 0) { this.h = h; }
        clone() { return new Game_Time(this.h); }
        add(type, v) { if (type !== "hour") throw new Error("unit " + type); this.h += v; return this; }
    }
    Game_Time._actorStates = [];
    global.Game_Time = Game_Time;
    global.$gameTime = new Game_Time(100);
    global.Game_Battler = function(id) { this._actorId = id; this._states = []; };
    const GB = Game_Battler.prototype;
    GB.isActor = function() { return this._actorId > 0; };
    GB.actorId = function() { return this._actorId; };
    GB.isStateAffected = function(id) { return this._states.includes(id); };
    GB.addState = function(id) { if (!this._states.includes(id)) this._states.push(id); };
    const baseAdd = GB.addState;
    GB.addState = function(stateId) {
        baseAdd.call(this, stateId);
        if (this.isActor() && $gameTime && !this._wteIgnoreTimerRefresh && stateId === 243) {
            const expire = $gameTime.clone().add("hour", 4);
            const ex = Game_Time._actorStates.find(s => s.actorId === this.actorId() && s.stateId === stateId);
            if (ex) ex.gameTime = expire; else Game_Time._actorStates.push({ actorId: this.actorId(), stateId, gameTime: expire });
        }
    };
    // --- player speed (WTE_Footsteps logic) ---
    global.Game_Player = function() { this._wteCachedSpeed = 4; this._diagDir = 0; };
    Game_Player.prototype.realMoveSpeed = function() {
        if (this._wteIsCutscene) return 4;
        let speed = this._wteCachedSpeed;
        if (this._diagDir && this._wteHasSpeedState) speed += Math.abs(Math.log2(0.707));
        return speed;
    };
    // --- data ---
    global.$dataItems = readJson("Items.json");
    global.$dataCommonEvents = readJson("CommonEvents.json");
    const s = fs.readFileSync(path.join(gameDir, "js/plugins.js"), "utf8");
    const plugins = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
    global.CGMZ = { Crafting: { Recipes: JSON.parse(plugins.find(p => p.name === "CGMZ_Crafting").parameters.Recipes) } };
    global.DataManager = {
        onLoad() {}, isDatabaseLoaded() { return true; },
        extractMetadata(data) {
            const re = /<([^<>:]+)(:?)([^>]*)>/g; data.meta = {};
            for (;;) { const m = re.exec(data.note); if (m) data.meta[m[1]] = m[2] === ":" ? m[3] : true; else break; }
        }
    };
    if (tweak) tweak();
    console.log = () => {}; console.warn = () => {};
    for (const m of mods) new Function(modSrc(m))();
    DataManager.onLoad($dataItems);
    DataManager.onLoad($dataCommonEvents);
    DataManager.isDatabaseLoaded();
    DataManager.isDatabaseLoaded();
    console.log = realLog; console.warn = realLog;
    const hero = new Game_Battler(1);
    const player = new Game_Player();
    global.$gameParty = { leader: () => hero };
    // What WTE_Footsteps would cache for a mode, given whether the Coffee state is on
    const speeds = (diag = 0) => {
        const coffee = hero.isStateAffected(243);
        const out = {};
        for (const [mode, base, mult, dash] of [["walk", 4, 1.10, 0], ["run", 3.5, 1.10, 1], ["bike", 4, 1.04, 1]]) {
            player._wteIsBiking = mode === "bike"; player._wteIsRunning = mode === "run";
            player._wteHasSpeedState = coffee; player._diagDir = diag;
            player._wteCachedSpeed = Math.min(base * (coffee ? mult : 1) + dash, 6.5);
            out[mode] = Math.round(player.realMoveSpeed() * 1000) / 1000;
        }
        return out;
    };
    const entry = () => Game_Time._actorStates.find(e => e.actorId === 1 && e.stateId === 243);
    const drinkCoffee = () => hero.addState(243);
    const drinkEspresso = () => { eval($dataCommonEvents[$dataItems[1400].effects[0].dataId].list.find(c => c.code === 355).parameters[0]); hero.addState(243); };
    const expire = () => { hero._states = []; Game_Time._actorStates = []; };
    return { hero, player, speeds, entry, drinkCoffee, drinkEspresso, expire };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ============================ A. LessGrind + Espresso ============================
realLog("A. LessGrind + Espresso (the order the game's loader uses)");
const vanillaItems = readJson("Items.json"), vanillaEvents = readJson("CommonEvents.json");
let g = boot(["LessGrind", "Espresso"]);
const esp = $dataItems[1400];
realLog("   slot 1400 was", JSON.stringify(vanillaItems[1400].name), "-> now", JSON.stringify(esp.name), "| price", esp.price, "| icon", esp.iconIndex, "| categories", esp.note.split("\n").slice(1, 4).join(" "));
if (esp.name !== "Espresso" || esp.id !== 1400 || !esp.meta || !esp.consumable) fail("espresso item not set up");
const ceId = esp.effects[0].dataId, ev = $dataCommonEvents[ceId];
if (ceId !== vanillaEvents.length || !ev || ev.id !== ceId) fail("event not appended at the end");
realLog("   event", ceId, JSON.stringify(ev.name) + ":", ev.list.map(c => c.code).join(","));
realLog("   text:", ev.list.filter(c => c.code === 401).map(c => c.parameters[0]).join("  /  "));
if (ev.list.findIndex(c => c.code === 355) + 1 !== ev.list.findIndex(c => c.code === 313)) fail("marker script not directly before the state change");
const rec = CGMZ.Crafting.Recipes.map(r => JSON.parse(r)).filter(r => r.Name === "Espresso");
if (rec.length !== 1) fail("recipe count " + rec.length);
else {
    const prod = JSON.parse(JSON.parse(rec[0].Products)[0]), ing = JSON.parse(JSON.parse(rec[0].Ingredients)[0]);
    realLog("   recipe: at", JSON.stringify(rec[0].Profession), "->", prod.Amount + "x item " + prod.Item, "from", ing.Amount + "x generic:" + ing.Generic, "| discovered", rec[0].Discovered);
    if (prod.Item !== "1400" || ing.Generic !== "CoffeeBean" || ing.Amount !== "6" || rec[0].Profession !== "coffee maker") fail("recipe wrong");
}
let changedItems = 0;
for (let i = 1; i < vanillaItems.length; i++) if (JSON.stringify(vanillaItems[i]) !== JSON.stringify(Object.assign({}, $dataItems[i], { meta: undefined }))) changedItems++;
if (changedItems !== 2) fail("expected exactly 2 items to differ from vanilla (coffee text, espresso slot), got " + changedItems);
if ($dataItems.length !== vanillaItems.length) fail("item list length changed");

realLog("   no boost:            ", JSON.stringify(g.speeds()));
if (!same(g.speeds(), { walk: 4, run: 4.5, bike: 5 })) fail("default speeds wrong");
g.drinkCoffee();
realLog("   coffee at hour 100:  ", JSON.stringify(g.speeds()), "ends hour", g.entry().gameTime.h);
if (!same(g.speeds(), { walk: 4.5, run: 5, bike: 5.5 }) || g.entry().gameTime.h !== 124 || g.entry().espresso) fail("coffee wrong");
if (!near(g.speeds(8).walk, 5.0)) fail("coffee diagonal compensation wrong: " + g.speeds(8).walk);
$gameTime.h = 105;
g.drinkEspresso();
realLog("   espresso at hour 105:", JSON.stringify(g.speeds()), "ends hour", g.entry().gameTime.h);
if (!same(g.speeds(), { walk: 4.85, run: 5.3, bike: 5.8 }) || g.entry().gameTime.h !== 129 || !g.entry().espresso) fail("espresso wrong");
if (EspressoMod.pending) fail("pending flag not cleared");
$gameTime.h = 110;
g.drinkCoffee();
realLog("   coffee at hour 110 while espresso runs:", JSON.stringify(g.speeds()), "ends hour", g.entry().gameTime.h);
if (!same(g.speeds(), { walk: 4.85, run: 5.3, bike: 5.8 }) || g.entry().gameTime.h !== 129 || !g.entry().espresso) fail("coffee replaced a running espresso");
g.hero._states = []; g.hero._wteIgnoreTimerRefresh = true; g.hero.addState(243); g.hero._wteIgnoreTimerRefresh = false;
if (g.entry().gameTime.h !== 129 || !g.entry().espresso || !same(g.speeds(), { walk: 4.85, run: 5.3, bike: 5.8 })) fail("full-heal re-apply changed the espresso");
g.player._wteIsCutscene = true;
if (g.player.realMoveSpeed() !== 4) fail("cutscene speed was overridden");
g.player._wteIsCutscene = false;
g.expire();
if (!same(g.speeds(), { walk: 4, run: 4.5, bike: 5 })) fail("speeds not back to default after expiry");
$gameTime.h = 200; g.drinkCoffee();
if (g.entry().espresso || !same(g.speeds(), { walk: 4.5, run: 5, bike: 5.5 }) || g.entry().gameTime.h !== 224) fail("coffee after an expired espresso wrong");
realLog("   after expiry -> default speeds; a later coffee is a plain coffee again: ok");

// ============================ B. Espresso alone ============================
realLog("B. Espresso without LessGrind");
g = boot(["Espresso"]);
g.drinkCoffee();
realLog("   coffee:  ", JSON.stringify(g.speeds()), "ends hour", g.entry().gameTime.h, "(vanilla values)");
if (!same(g.speeds(), { walk: 4.4, run: 4.85, bike: 5.16 }) || g.entry().gameTime.h !== 104) fail("vanilla coffee disturbed");
g.drinkEspresso();
realLog("   espresso:", JSON.stringify(g.speeds()), "ends hour", g.entry().gameTime.h);
if (!same(g.speeds(), { walk: 4.85, run: 5.3, bike: 5.8 }) || g.entry().gameTime.h !== 124) fail("espresso alone wrong");
if ($dataItems[2043].description !== vanillaItems[2043].description) fail("coffee description changed without LessGrind");

// ============================ C. Slot taken by a game update ============================
realLog("C. Item slot 1400 no longer blank");
g = boot(["LessGrind", "Espresso"], () => { $dataItems[1400].name = "Some New Item"; });
if ($dataItems[1400].name !== "Some New Item" || $dataCommonEvents.length !== vanillaEvents.length ||
    CGMZ.Crafting.Recipes.some(r => JSON.parse(r).Name === "Espresso") || EspressoMod.enabled) fail("mod did not stand down");
else realLog("   mod stood down: item untouched, no event, no recipe");
g.drinkCoffee();
if (!same(g.speeds(), { walk: 4.5, run: 5, bike: 5.5 })) fail("LessGrind coffee broken when Espresso is disabled");

// ============================ D. Reverse load order ============================
realLog("D. Reverse order (Espresso loaded first)");
g = boot(["Espresso", "LessGrind"]);
g.drinkCoffee();
const c = g.speeds();
g.drinkEspresso();
realLog("   coffee", JSON.stringify(c), "| espresso", JSON.stringify(g.speeds()));
if (!same(c, { walk: 4.5, run: 5, bike: 5.5 }) || !same(g.speeds(), { walk: 4.85, run: 5.3, bike: 5.8 })) fail("speeds depend on load order");

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
