// Offline harness for HigherDrops. Loads the game's real spawn map (the rock templates),
// applies the mod the way the game would, and checks which "Amount" lines changed.
//   node test_higherdrops.js "<game folder>"
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));
const realLog = console.log;
let problems = 0;
const fail = m => { problems++; realLog("!! " + m); };

// The agreed table: template name -> [min, max]
const EXPECT = {
    "Coal Ore": [7, 31], "Dense Coal": [14, 62],
    "Copper Ore": [2, 3], "Dense Copper": [4, 7],
    "Iron Ore": [3, 8], "Dense Iron": [6, 14],
    "Gold Ore": [2, 4], "Dense Gold": [4, 8],
    "Salt Ore": [2, 3], "Verdite Ore": [2, 4], "Green Crystal": [2, 5], "Void Crystal Ore": [2, 3],
    "Crimson Ore": [1, 2], "Platinum Ore": [1, 2], "Dense Black Iron Ore Large": [1, 2],
    "Rock": [1, 4], "Big Rock": [15, 25],
    "Grass": [2, 6], "Big Grass": [8, 16],
    "Leaf Pile": [2, 4], "Herb": [2, 4], "Bloodberry": [1, 4],
    "RED MUSHROOM": [1, 4], "GREEN MUSHROOM": [1, 4], "Common": [1, 4], "Spiritcap": [1, 4], "Nighthood": [1, 4],
    "Corpse Ear": [1, 4], "Ashy": [1, 4], "Morel": [1, 4], "Whisptop": [1, 4], "Bulbous": [1, 4], "Dualsprout": [1, 4],
    "Golden": [1, 4]
};
const items = readJson("Items.json");
const baseName = n => n.replace(/[ _]?\d+$/, "").trim();
const amountOf = p => (p[3] === 0 ? [p[4], p[4]] : p[3] === 2 ? [p[4], p[5]] : null);
const show = r => (r[0] === r[1] ? String(r[0]) : r[0] + "-" + r[1]);

global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
console.log = () => {}; console.warn = () => {};
new Function(fs.readFileSync(path.join(MODS_ROOT, "HigherDrops/js/plugins/HigherDrops.js"), "utf8"))();
console.log = realLog; console.warn = realLog;

function load(file) {
    const original = readJson(file);
    const map = JSON.parse(JSON.stringify(original));
    console.log = () => {};
    DataManager.onLoad(map);
    DataManager.onLoad(map);              // a second load of the same object must change nothing more
    console.log = realLog;
    return { original, map };
}

// ---- spawn map: the rock templates ----
const { original, map } = load("Map036.json");
const seen = {};
let changedCmds = 0;
for (let e = 0; e < original.events.length; e++) {
    const a = original.events[e], b = map.events[e];
    if (!a) continue;
    const name = baseName(a.name);
    for (let p = 0; p < a.pages.length; p++) {
        const la = a.pages[p].list, lb = b.pages[p].list;
        if (la.length !== lb.length) { fail(`${a.name}: command count changed`); continue; }
        for (let k = 0; k < la.length; k++) {
            if (JSON.stringify(la[k]) === JSON.stringify(lb[k])) continue;
            changedCmds++;
            const before = la[k].parameters, after = lb[k].parameters;
            if (la[k].code !== 122 || before[0] !== 31 || lb[k].code !== 122 || after[0] !== 31 || after[1] !== 31 || after[2] !== 0) {
                fail(`${a.name}: a command other than "Amount =" changed`); continue;
            }
            const want = EXPECT[name];
            if (!want) { fail(`${a.name}: changed but not in the agreed table`); continue; }
            const got = amountOf(after);
            const was = amountOf(before);
            const floor = [Math.max(want[0], was[0]), Math.max(want[1], was[1])];   // never below the game's own amount
            if (!got || got[0] !== floor[0] || got[1] !== floor[1]) fail(`${a.name}: expected ${show(floor)}, got ${JSON.stringify(after)}`);
            const drop = la.find(c => c.code === 122 && c.parameters[0] === 30 && c.parameters[3] === 0);
            const key = name + (name === "Rock" ? (was[0] === 1 ? " (most areas)" : " (Catacombs mines)") : "");
            if (!seen[key]) seen[key] = { drop: drop ? items[drop.parameters[4]].name : "?", before: was, after: got, templates: 0 };
            seen[key].templates++;
            seen[name] = seen[name] || seen[key];
        }
    }
    // every template named in the table must have been changed (unless it already had that amount)
}
for (const name of Object.keys(EXPECT)) if (!seen[name]) fail(`"${name}" from the table was not found on the spawn map`);

realLog("rock".padEnd(28) + "drops".padEnd(18) + "unmodded".padEnd(10) + "modded".padEnd(8) + "average      templates");
for (const name of Object.keys(seen)) {
    if (name === "Rock") continue;                 // shown per area below
    const s = seen[name];
    if (!s) continue;
    const avg = r => (r[0] + r[1]) / 2;
    realLog(name.padEnd(28) + s.drop.padEnd(18) + show(s.before).padEnd(10) + show(s.after).padEnd(8) +
        (avg(s.before) + " -> " + avg(s.after)).padEnd(13) + s.templates);
    if (s.after[0] < s.before[0] || s.after[1] < s.before[1]) fail(`${name}: the new range is lower than the game's`);
}
realLog(`\ncommands changed on the spawn map: ${changedCmds}`);

// ---- things that must stay untouched ----
const untouched = ["Gravemoss", "Slimeweed", "Wild Herbs", "Sunflower", "Snow Pearls", "Coral1", "Vileroot", "Soul Fragments", "News Bug", "Dense Iron Ore Large", "Dense Gold Ore Large", "Small Rock 1", "Small Moon Crystal", "Large Moon Crystal", "Gem Node t1", "Damp Rock 1", "Clutter1 Crate"];
for (const n of untouched) {
    const i = original.events.findIndex(ev => ev && ev.name === n);
    if (i < 0) { fail(`template "${n}" not found (test needs updating)`); continue; }
    if (JSON.stringify(original.events[i]) !== JSON.stringify(map.events[i])) fail(`${n} was changed`);
}
// Maps without templates named in the table are untouched: an ordinary mine floor and the placeables map
for (const file of ["Map037.json", "Map053.json"]) {
    const r = load(file);
    delete r.map.__higherDropsPatched;
    if (JSON.stringify(r.original) !== JSON.stringify(r.map)) fail(`${file} was changed`);
}
realLog("large dense rocks, crystals, gem nodes, clutter, other forage and other maps untouched: " + (problems === 0 ? "yes" : "see above"));

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
