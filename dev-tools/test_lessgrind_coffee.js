// Offline harness for the coffee part of LessGrind. Reproduces the relevant
// piece of WTE_TimeConverter (the addState wrapper that stamps an end time on
// timed states) with a minimal game clock, then loads the mod on top of it.
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));

// --- minimal clock with the same clone()/add(type, n) shape as DK_Game_Time ---
class Game_Time {
    constructor(hours = 0) { this.h = hours; }
    clone() { return new Game_Time(this.h); }
    add(type, value) { if (type !== "hour") throw new Error("unexpected unit " + type); this.h += value; return this; }
}
Game_Time._actorStates = [];
global.Game_Time = Game_Time;
global.$gameTime = new Game_Time(100);   // "now" = hour 100

// --- engine base + WTE_TimeConverter wrapper (logic copied from the plugin) ---
global.Game_Battler = function(actorId) { this._actorId = actorId; this._states = []; };
Game_Battler.prototype.isActor = function() { return this._actorId > 0; };
Game_Battler.prototype.actorId = function() { return this._actorId; };
Game_Battler.prototype.addState = function(stateId) { if (!this._states.includes(stateId)) this._states.push(stateId); };
const STATE_TIMERS = { 243: { type: "hour", duration: 4 } };
const _base = Game_Battler.prototype.addState;
Game_Battler.prototype.addState = function(stateId) {
    _base.call(this, stateId);
    if (this.isActor() && $gameTime && !this._wteIgnoreTimerRefresh) {
        const mod = STATE_TIMERS[stateId];
        if (mod && Game_Time._actorStates) {
            const expireTime = $gameTime.clone().add(mod.type, mod.duration);
            const existing = Game_Time._actorStates.find(s => s.actorId === this.actorId() && s.stateId === stateId);
            if (existing) existing.gameTime = expireTime;
            else Game_Time._actorStates.push({ actorId: this.actorId(), stateId: stateId, gameTime: expireTime });
        }
    }
};

// --- data + DataManager stub ---
global.$dataCommonEvents = readJson("CommonEvents.json");
global.$dataItems = readJson("Items.json");
const origText = $dataCommonEvents[1132].list.filter(c => c.code === 401).map(c => c.parameters[0]);
const origDesc = $dataItems[2043].description;
const otherDescs = JSON.stringify($dataItems.map(i => i && i.id !== 2043 ? i.description : null));
global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
global.CGMZ = { Crafting: { Recipes: [] } };

const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
new Function(fs.readFileSync(path.join(MODS_ROOT, "LessGrind/js/plugins/LessGrind.js"), "utf8"))();
DataManager.onLoad($dataItems);
DataManager.onLoad($dataItems);          // idempotent
DataManager.onLoad($dataCommonEvents);
console.log = log; console.warn = warn;

let problems = 0;
const fail = m => { problems++; log("!! " + m); };
const endOf = (actorId, stateId) => { const e = Game_Time._actorStates.find(s => s.actorId === actorId && s.stateId === stateId); return e ? e.gameTime.h : null; };

// 1. Drinking coffee at hour 100 -> ends at hour 124 (vanilla: 104)
const hero = new Game_Battler(1);
hero.addState(243);
log("drink at hour 100 -> buff ends at hour", endOf(1, 243), "(vanilla 104)");
if (endOf(1, 243) !== 124) fail("coffee end time not now + 24h");
if (!hero._states.includes(243)) fail("state not applied");
if ($gameTime.h !== 100) fail("the clock itself was modified");

// 2. Drinking again later restarts the 24h from that moment
$gameTime.h = 110;
hero.addState(243);
log("drink again at hour 110 -> buff ends at hour", endOf(1, 243));
if (endOf(1, 243) !== 134) fail("re-drinking did not refresh to now + 24h");
if (Game_Time._actorStates.length !== 1) fail("duplicate timer entries");

// 3. The game's re-apply after a full heal must not restart the clock
$gameTime.h = 120;
hero._states = [];
hero._wteIgnoreTimerRefresh = true; hero.addState(243); hero._wteIgnoreTimerRefresh = false;
log("re-applied after full heal at hour 120 -> still ends at hour", endOf(1, 243));
if (endOf(1, 243) !== 134) fail("re-apply changed the end time");

// 4. Other states and non-actors are untouched
hero.addState(5);
if (endOf(1, 5) !== null) fail("untimed state got a timer");
const enemy = new Game_Battler(0);
enemy.addState(243);
if (Game_Time._actorStates.length !== 1) fail("non-actor got a timer entry");

// 5. Text
const newText = $dataCommonEvents[1132].list.filter(c => c.code === 401).map(c => c.parameters[0]);
log("message:    ", JSON.stringify(origText[1]), "->", JSON.stringify(newText[1]));
log("description:", JSON.stringify(origDesc), "->", JSON.stringify($dataItems[2043].description));
if (!newText.join(" ").includes("24 hours") || newText.join(" ").match(/[^2]4 hours/)) fail("drink message not updated");
if (newText[0] !== origText[0]) fail("first message line changed unexpectedly");
if ($dataItems[2043].description !== origDesc.replace("4 hours", "24 hours")) fail("item description not updated correctly");
if (JSON.stringify($dataItems.map(i => i && i.id !== 2043 ? i.description : null)) !== otherDescs) fail("another item's description changed");

log(`problems: ${problems}`);
process.exit(problems ? 1 : 0);
