// Offline harness for the equipment-stats part of LessGrind. Loads the real weapon and armor
// files, runs the mod, checks what changed, and then replays what the game's upgrade plugin
// (WTE_EquipmentUpgradeSystem) does with a save: copy the database as "vanilla" once everything
// is loaded, and on load reset to that copy and add the saved gem deltas.
//   node test_lessgrind_equipment.js "<game folder>"
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));
const source = fs.readFileSync(path.join(MODS_ROOT, "LessGrind/js/plugins/LessGrind.js"), "utf8");
const realLog = console.log;
let problems = 0;
const fail = m => { problems++; realLog("!! " + m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STATS = ["Max HP", "Max MP", "Attack", "Defense", "M. Attack", "M. Defense", "Agility", "Luck"];
const show = p => p.map((v, i) => (v ? (v > 0 ? "+" : "") + v + " " + STATS[i] : "")).filter(Boolean).join(", ") || "nothing";
const vanilla = { armors: readJson("Armors.json"), weapons: readJson("Weapons.json") };

function boot(viaFallback) {
    global.window = global;
    global.$dataArmors = readJson("Armors.json");
    global.$dataWeapons = readJson("Weapons.json");
    global.$dataCommonEvents = undefined;
    global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
    global.CGMZ = { Crafting: { Recipes: [] } };
    const realWarn = console.warn;
    console.log = () => {}; console.warn = () => {};      // the recipe part has nothing to work on here and says so
    new Function(source)();
    if (!viaFallback) { DataManager.onLoad($dataArmors); DataManager.onLoad($dataWeapons); DataManager.onLoad($dataArmors); }
    DataManager.isDatabaseLoaded();
    DataManager.isDatabaseLoaded();
    console.log = realLog; console.warn = realWarn;
}

for (const viaFallback of [false, true]) {
    boot(viaFallback);
    const changed = [];
    vanilla.armors.forEach((a, i) => { if (a && !same(a, $dataArmors[i])) changed.push(i); });
    if (!same($dataWeapons, vanilla.weapons)) fail("a weapon was changed");
    if (!same(changed, [412])) { fail("armors changed: " + changed); continue; }
    const was = vanilla.armors[412], now = $dataArmors[412];
    if (!viaFallback) {
        realLog(`armor 412 "${now.name}" (${["", "Weapon", "Offhand", "Head", "Top", "Bottom", "Feet", "Neck", "Ring", "Ring", "Trinket"][now.etypeId]})`);
        realLog("   unmodded:       " + show(was.params));
        realLog("   with LessGrind: " + show(now.params));
    }
    if (!same(now.params, [10, 10, 10, 10, 10, 10, 10, 30])) fail("Lucky Horseshoe stats are " + now.params);
    if (!same(Object.assign({}, was, { params: 0 }), Object.assign({}, now, { params: 0 }))) fail("more than the stats changed");
}

// What the upgrade plugin then does: its "vanilla" copy is taken after the mod ran.
boot(false);
const copy = JSON.parse(JSON.stringify($dataArmors[412]));            // Scene_Boot.onDatabaseLoaded
const savedHistory = [{ params: [0, 0, 0, 0, 0, 0, 0, 0] }, { params: [0, 0, 0, 0, 0, 0, 0, 6] }, { params: [12, 0, 0, 0, 0, 0, 0, 0] }];   // two gems put on it earlier
$dataArmors[412].params = [...copy.params];                           // extractSaveContents: reset to the copy ...
savedHistory.forEach(step => step.params.forEach((v, i) => { $dataArmors[412].params[i] += v; }));   // ... and add the saved gems
realLog("   after loading a save with a Greed Gem (+6 Luck) and a Blood Gem (+12 Max HP) on it: " + show($dataArmors[412].params));
if (!same($dataArmors[412].params, [22, 10, 10, 10, 10, 10, 10, 36])) fail("gems should be added on top of the new stats");

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
