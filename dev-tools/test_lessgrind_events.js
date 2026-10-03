// Offline harness for the event-data part of LessGrind: loads the real
// CommonEvents.json and the Ranch map, runs the mod with a stub DataManager,
// and diffs the result against the originals.
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const modPath = path.join(MODS_ROOT, "LessGrind/js/plugins/LessGrind.js");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));
const sysd = readJson("System.json");
const vn = i => `V${i}[${sysd.variables[i]}]`;
const OPS = ["==", ">=", "<=", ">", "<", "!="];

function run(modCode) {
    const original = readJson("CommonEvents.json");
    global.$dataCommonEvents = JSON.parse(JSON.stringify(original));
    const originalMap = readJson("Map050.json");
    const map = JSON.parse(JSON.stringify(originalMap));
    global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
    global.CGMZ = { Crafting: { Recipes: [] } }; // recipe part is covered by the other harness
    const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
    new Function(modCode)();
    DataManager.onLoad($dataCommonEvents);
    DataManager.isDatabaseLoaded();   // fallback path must be a no-op the second time
    DataManager.onLoad(map);
    DataManager.onLoad(map);          // idempotent
    console.log = log; console.warn = warn;
    return { original, patched: $dataCommonEvents, originalMap, map };
}

let problems = 0;
const fail = m => { problems++; console.log("!! " + m); };

// ---------- default config ----------
const src = fs.readFileSync(modPath, "utf8");
let r = run(src);
const expected = new Set([997, 1007, 2474, 1000, 1010, 2977, 894, 886, 2972, 2220, 1132]);
const summary = {};
for (let i = 0; i < r.original.length; i++) {
    const a = r.original[i], b = r.patched[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!expected.has(i)) fail("unexpected event changed: " + i);
    if (!a || !b || a.list.length !== b.list.length) { fail("structural change in event " + i); continue; }
    for (let k = 0; k < a.list.length; k++) {
        const ca = a.list[k], cb = b.list[k];
        if (JSON.stringify(ca) === JSON.stringify(cb)) continue;
        let line;
        if (ca.code === 122 && cb.parameters[3] === 4) line = "damage per swing: pickaxe tier  ->  " + cb.parameters[4];
        else if (ca.code === 122) line = `${vn(ca.parameters[0])} ${["=", "+="][ca.parameters[2]]} ${ca.parameters[4]}  ->  ${cb.parameters[4]}`;
        else if (ca.code === 111) line = `If ${vn(ca.parameters[1])} ${OPS[ca.parameters[4]]} ${vn(ca.parameters[3])}  ->  ${OPS[cb.parameters[4]]}`;
        else if (ca.code === 401) line = "text: " + ca.parameters[0] + "  ->  " + cb.parameters[0];
        else if (ca.code === 103) line = `Input Number digits ${ca.parameters[1]}  ->  ${cb.parameters[1]}`;
        else if (ca.code === 357) {
            const pick = cmd => JSON.parse(cmd.parameters[3].choices).map(s => JSON.parse(s)).find(c => c.commonEventId === "2977");
            const o = pick(ca), n = pick(cb);
            line = `menu entry "${o.name}": price ${o.price} -> ${n.price}, wood ${o.mat1_qty} -> ${n.mat1_qty}, stone ${o.mat2_qty} -> ${n.mat2_qty}, text ${JSON.parse(o.description)} -> ${JSON.parse(n.description)}`;
            // every other menu entry must be untouched
            const strip = cmd => JSON.parse(cmd.parameters[3].choices).filter(s => JSON.parse(s).commonEventId !== "2977");
            if (JSON.stringify(strip(ca)) !== JSON.stringify(strip(cb))) fail("other menu entries changed in CE " + i);
            const rest = cmd => JSON.stringify([cmd.parameters[0], cmd.parameters[1], cmd.parameters[2], Object.keys(cmd.parameters[3])]);
            if (rest(ca) !== rest(cb)) fail("plugin command shape changed in CE " + i);
        } else { fail(`unexpected command change in CE ${i}: code ${ca.code}`); continue; }
        const key = `CE ${i} "${a.name}": ${line}`;
        summary[key] = (summary[key] || 0) + 1;
    }
}
for (const [k, v] of Object.entries(summary)) console.log(String(v).padStart(3) + "x  " + k);
for (const id of expected) if (JSON.stringify(r.original[id]) === JSON.stringify(r.patched[id])) fail("expected event not changed: " + id);
if (JSON.stringify(r.originalMap) !== JSON.stringify(Object.assign({}, r.map, { __lessGrindPatched: undefined }))) fail("Ranch map changed although TROUGH_RETROACTIVE is false");
else console.log("Ranch map untouched with TROUGH_RETROACTIVE = false");

// ---------- retroactive variant ----------
if (!src.includes("const TROUGH_RETROACTIVE = false;")) fail("could not find retroactive flag to flip");
r = run(src.replace("const TROUGH_RETROACTIVE = false;", "const TROUGH_RETROACTIVE = true;"));
let floorChanges = 0;
for (let e = 0; e < r.originalMap.events.length; e++) {
    const a = r.originalMap.events[e], b = r.map.events[e];
    if (!a) continue;
    for (let p = 0; p < a.pages.length; p++) for (let k = 0; k < a.pages[p].list.length; k++) {
        const ca = a.pages[p].list[k], cb = b.pages[p].list[k];
        if (JSON.stringify(ca) === JSON.stringify(cb)) continue;
        floorChanges++;
        if (!(ca.code === 122 && ca.parameters[2] === 3 && ca.parameters[4] === 4 && cb.parameters[4] === 16)) fail("unexpected map change in event " + a.id);
        else console.log(`retroactive: Ranch event ${a.id} "${a.name}" floor multiplier ${ca.parameters[4]} -> ${cb.parameters[4]}`);
    }
}
if (floorChanges !== 4) fail("expected 4 trough floor formulas, changed " + floorChanges);

console.log(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
