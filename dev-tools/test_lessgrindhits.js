// Offline harness for LessGrindHits. Loads the real common events and template maps,
// applies the mod, then replays the game's own swing loop ("damage done += X until it
// reaches health") for every breakable template with every tool tier, using the
// patched command exactly as the interpreter would evaluate it.
//   node test_lessgrindhits.js "<game folder>"
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

const TOOLS = { pickaxe: { level: 945, required: 944 }, axe: { level: 943, required: 942 }, scythe: { level: 947, required: 946 } };
const TIERS = ["Rusty", "Basic", "Sturdy", "Quality", "Superior"];
const original = readJson("CommonEvents.json");
const items = readJson("Items.json");
const maps = { 36: readJson("Map036.json"), 53: readJson("Map053.json"), 156: readJson("Map156.json") };
const vanillaMap156 = JSON.stringify(maps[156]);

// ---- environment ----
global.window = global;
global.$dataItems = items;
global.$dataCommonEvents = JSON.parse(JSON.stringify(original));
global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
const vars = {};
let health = 0, template = null, carried = new Set();
global.$gameVariables = { value: id => vars[id] || 0, selfValue: key => (key[2] === 25 ? health : 0) };
global.$gameMap = { mapId: () => 1, event: () => (template ? { event: () => template } : null) };
global.$gameParty = { hasItem: item => !!item && carried.has(item.id) };
const interp = { getTargetMapIdSelfVariable: () => 1, getTargetEventIdSelfVariable: () => 7, eventId: () => 7 };

console.log = () => {}; console.warn = () => {};
new Function(fs.readFileSync(path.join(MODS_ROOT, "LessGrindHits/js/plugins/LessGrindHits.js"), "utf8"))();
DataManager.onLoad($dataCommonEvents);
DataManager.isDatabaseLoaded();
for (const id of Object.keys(maps)) DataManager.onLoad(maps[id]);
console.log = realLog; console.warn = realLog;

// ---- what changed ----
const changed = {};
for (let i = 0; i < original.length; i++) {
    const a = original[i], b = $dataCommonEvents[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a.list.length !== b.list.length) { fail("structure changed in CE " + i); continue; }
    changed[i] = a.list.filter((c, k) => JSON.stringify(c) !== JSON.stringify(b.list[k])).length;
}
realLog("common events changed (id: commands):", JSON.stringify(changed));
if (JSON.stringify(changed) !== JSON.stringify({ 906: 1, 907: 6, 909: 9, 910: 10, 917: 1, 978: 1, 984: 1 })) fail("unexpected set of patched common events");
const m156 = JSON.parse(vanillaMap156);
let mapCmds = 0;
maps[156].events.forEach((ev, i) => ev && ev.pages.forEach((pg, p) => pg.list.forEach((c, k) => {
    if (JSON.stringify(c) !== JSON.stringify(m156.events[i].pages[p].list[k])) mapCmds++;
})));
if (mapCmds !== 1) fail("expected the one inline damage command on map 156 to be patched, got " + mapCmds);

// ---- swing simulation with the patched command ----
const swingCes = { pickaxe: [917], axe: [906, 978], scythe: [984] };
function scriptFor(tool) {
    const cmd = $dataCommonEvents[swingCes[tool][0]].list.find(c => c.code === 122 && c.parameters[0] === 24 && c.parameters[2] === 1);
    if (cmd.parameters[3] !== 4) fail(tool + ": damage command is not a script");
    return cmd.parameters[4];
}
function swings(tool, tier, tmpl, req, hp, staleReq) {
    if (req && tier < req) return null;                      // the game's own gate, untouched by the mod
    vars[TOOLS[tool].level] = tier;
    vars[TOOLS[tool].required] = req || staleReq || 0;
    health = hp; template = tmpl;
    const script = scriptFor(tool);
    let done = 0, n = 0;
    while (done < hp && n < 100) { done += (function() { return eval(script); }).call(interp); n++; }
    return n;
}

// ---- collect templates ----
function collect(tool) {
    const out = [];
    for (const mid of [36, 53]) {
        for (const ev of maps[mid].events) {
            if (!ev) continue;
            const cmds = ev.pages.flatMap(pg => pg.list);
            if (!cmds.some(c => c.code === 117 && swingCes[tool].includes(c.parameters[0]))) continue;
            let req = null, hp = null, drop = null;
            for (const c of cmds) {
                const p = c.parameters;
                if (c.code === 122 && p[2] === 0 && p[3] === 0) {
                    if (p[0] === TOOLS[tool].required) req = p[4];
                    else if (p[0] === 25 && p[1] === 25) hp = p[4];
                    else if (p[0] === 30 && drop === null) drop = p[4];
                }
            }
            if (hp !== null) out.push({ ev, req, hp, drop });
        }
    }
    return out;
}

// Agreed pickaxe table: key "req|hp" for ores, by name for stone
const EXPECT = {
    "1|8": [5, 3, 2, 2, 1], "1|10": [6, 3, 2, 2, 2], "2|12": [null, 3, 2, 2, 2], "2|20": [null, 5, 3, 3, 2], "2|28": [null, 6, 4, 3, 3],
    "3|16": [null, null, 3, 2, 2], "3|28": [null, null, 5, 4, 3], "3|40": [null, null, 6, 5, 4],
    "4|16": [null, null, null, 2, 2], "4|26": [null, null, null, 3, 3], "4|32": [null, null, null, 4, 3], "4|36": [null, null, null, 4, 3],
    "4|38": [null, null, null, 4, 4], "4|44": [null, null, null, 5, 4], "4|60": [null, null, null, 6, 5],
    "5|60": [null, null, null, null, 6], "5|70": [null, null, null, null, 6]
};
const CAP = { pickaxe: 6, axe: 4, scythe: 2 };
// Agreed axe / scythe tables ("halve per upgrade"), key "req|hp"
const EXPECT_OTHER = {
    axe: { "1|6": [4, 2, 1, 1, 1], "2|11": [null, 3, 2, 1, 1], "2|15": [null, 4, 2, 1, 1], "3|22": [null, null, 4, 3, 2],
           "3|30": [null, null, 4, 3, 2], "4|36": [null, null, null, 4, 3], "5|32": [null, null, null, null, 4] },
    scythe: { "1|4": [2, 1, 1, 1, 1], "2|4": [null, 2, 1, 1, 1] }
};
const fmt = a => a.map(x => (x === null ? "-" : String(x)).padStart(3)).join("");
for (const tool of ["pickaxe", "axe", "scythe"]) {
    realLog(`\n=== ${tool} ===   (Rusty Basic Sturdy Quality Superior; '-' = tool too weak)`);
    realLog("name".padEnd(24) + "drop".padEnd(20) + "tier hp    vanilla           with mod");
    const seen = new Set();
    for (const t of collect(tool).sort((a, b) => (a.req || 0) - (b.req || 0) || a.hp - b.hp || a.ev.name.localeCompare(b.ev.name))) {
        const base = t.ev.name.replace(/[ _]?\d+$/, "");
        const key = base + "|" + t.req + "|" + t.hp;
        const before = TIERS.map((_, i) => (t.req && i + 1 < t.req ? null : Math.ceil(t.hp / (i + 1))));
        const after = TIERS.map((_, i) => swings(tool, i + 1, t.ev, t.req, t.hp, 4));
        for (let i = 0; i < 5; i++) {
            if (after[i] === null) { if (before[i] !== null) fail(`${t.ev.name}: gate changed`); continue; }
            if (after[i] > CAP[tool]) fail(`${t.ev.name}: ${TIERS[i]} needs ${after[i]} swings`);
            if (after[i] > before[i]) fail(`${t.ev.name}: ${TIERS[i]} got worse (${before[i]} -> ${after[i]})`);
            if (i > 0 && after[i - 1] !== null && after[i] > after[i - 1]) fail(`${t.ev.name}: better tool needs more swings`);
        }
        if (tool === "pickaxe") {
            let want = null;
            if (/^Rock \d/.test(t.ev.name)) want = before.map(x => (x === null ? null : 1));
            else if (/^Small Rock/.test(t.ev.name)) want = [4, 2, 2, 1, 1];
            else if (/^Big Rock/.test(t.ev.name)) want = [null, null, 5, 3, 2];
            else if (!/^Clutter/.test(t.ev.name)) want = EXPECT[t.req + "|" + t.hp];
            if (want && JSON.stringify(want) !== JSON.stringify(after)) fail(`${t.ev.name} (tier ${t.req}, hp ${t.hp}): expected ${fmt(want)} got ${fmt(after)}`);
            if (!want && !/^Clutter/.test(t.ev.name)) fail(`${t.ev.name}: no expectation for tier ${t.req} hp ${t.hp}`);
        }
        if (tool !== "pickaxe") {
            const want = EXPECT_OTHER[tool][t.req + "|" + t.hp];
            if (!want) fail(`${t.ev.name}: no expectation for tier ${t.req} hp ${t.hp}`);
            else if (JSON.stringify(want) !== JSON.stringify(after)) fail(`${t.ev.name} (tier ${t.req}, hp ${t.hp}): expected ${fmt(want)} got ${fmt(after)}`);
        }
        if (seen.has(key)) continue;
        seen.add(key);
        realLog(base.slice(0, 23).padEnd(24) + String(items[t.drop] ? items[t.drop].name : "(varies)").slice(0, 19).padEnd(20) +
            String(t.req || "any").padEnd(5) + String(t.hp).padEnd(4) + fmt(before) + "    " + fmt(after));
    }
}

// ---- edge cases ----
template = null;                                   // event name unknown -> the rule still applies
if (swings("pickaxe", 2, null, 2, 28) !== 6) fail("rule not applied when the event name is unknown");
const savedSelf = $gameVariables.selfValue;
$gameVariables.selfValue = () => { throw new Error("boom"); };
vars[945] = 3;
console.warn = () => {};
if (LessGrindHits.damage(interp, "pickaxe") !== 3) fail("no vanilla fallback when the lookup fails");
console.warn = realLog;
$gameVariables.selfValue = savedSelf;
health = 0;
if (LessGrindHits.damage(interp, "pickaxe") !== 3) fail("no vanilla fallback for an object without health");

// ---- tree fall: run the game's own fall events through a small interpreter and count frames ----
// Supports exactly what the fall events use: variable 15 arithmetic, Wait, Loop / Repeat Above /
// Break Loop, variable conditions, Shake Screen and switches.
function runFall(ev) {
    const list = ev.list;
    const sw = {};
    const shown = [];
    let tilt = 0, frames = 0, shakeWait = 0, pc = 0, guard = 0;
    const cmp = (a, b, op) => [a === b, a >= b, a <= b, a > b, a < b, a !== b][op];
    while (pc < list.length && guard++ < 200000) {
        const c = list[pc], p = c.parameters;
        if (c.code === 122 && p[0] === 15) {
            if (p[2] === 0) tilt = p[4]; else if (p[2] === 1) tilt += p[4]; else if (p[2] === 2) tilt -= p[4];
        } else if (c.code === 230) frames += p[0];
        else if (c.code === 355) shown.push(tilt);                       // the rotate() call
        else if (c.code === 225) { if (p[3]) shakeWait += p[2]; }
        else if (c.code === 121) sw[p[0]] = p[2] === 0;
        else if (c.code === 111) {
            if (!cmp(tilt, p[3], p[4])) { while (pc + 1 < list.length && list[pc + 1].indent > c.indent) pc++; }
        } else if (c.code === 113) {                                     // Break Loop (engine logic)
            let depth = 0;
            while (pc < list.length - 1) {
                pc++;
                if (list[pc].code === 112) depth++;
                if (list[pc].code === 413) { if (depth > 0) depth--; else break; }
            }
        } else if (c.code === 413) {                                     // Repeat Above (engine logic)
            do { pc--; } while (list[pc].indent !== c.indent);
        }
        pc++;
    }
    if (guard >= 200000) fail(ev.name + ": fall loop did not finish");
    return { frames, shakeWait, total: frames + shakeWait, steps: shown.length, maxTilt: Math.max(...shown.map(Math.abs)), sw };
}
realLog("\n=== tree fall (frames at 60 per second) ===");
for (const id of [909, 910]) {
    const before = runFall(original[id]), after = runFall($dataCommonEvents[id]);
    realLog(`CE ${id} "${original[id].name}": tilting ${before.frames} -> ${after.frames}, waiting for shake ${before.shakeWait} -> ${after.shakeWait}, ` +
        `total ${before.total} -> ${after.total} frames (${(before.total / 60).toFixed(1)}s -> ${(after.total / 60).toFixed(1)}s); ` +
        `steps ${before.steps} -> ${after.steps}; furthest tilt shown ${before.maxTilt} -> ${after.maxTilt} degrees`);
    if (before.total !== 134) fail(`CE ${id}: unmodded fall is ${before.total} frames, expected 134 (game changed?)`);
    if (after.total !== 25) fail(`CE ${id}: modded fall is ${after.total} frames, expected 25`);
    if (after.maxTilt > 90 || after.maxTilt < 80) fail(`CE ${id}: tree ends at ${after.maxTilt} degrees`);
}
const right = runFall($dataCommonEvents[910]).sw, left = runFall($dataCommonEvents[909]).sw;
realLog(`after landing: "Fall right" switch ${runFall(original[910]).sw[622] ? "ON" : "OFF"} -> ${right[622] ? "ON" : "OFF"}; "Fall Left" switch ${left[623] ? "ON" : "OFF"} (unchanged)`);
if (right[622] !== false || left[623] !== false) fail("a fall switch is left on after landing");
if (JSON.stringify(original[921]) !== JSON.stringify($dataCommonEvents[921]) || JSON.stringify(original[908]) !== JSON.stringify($dataCommonEvents[908]) ||
    JSON.stringify(original[902]) !== JSON.stringify($dataCommonEvents[902])) fail("an event outside the two fall events was changed");

// ---- axe tier quirk ----
const axeCheck = (list) => {                       // run "Check Axe Lv" (only item checks + assignments matter)
    vars[943] = -1;
    const run = (from, indent) => {
        for (let k = from; k < list.length; k++) {
            const c = list[k];
            if (c.indent < indent) return k;
            if (c.indent > indent) continue;
            if (c.code === 122) vars[943] = c.parameters[3] === 4 ? eval(c.parameters[4]) : c.parameters[4];
            else if (c.code === 111) {
                const has = carried.has(c.parameters[1]);
                let end = k + 1;
                while (end < list.length && !(list[end].indent === indent && (list[end].code === 411 || list[end].code === 412))) end++;
                if (has) run(k + 1, indent + 1);
                else if (list[end] && list[end].code === 411) run(end + 1, indent + 1);
                while (end < list.length && !(list[end].indent === indent && list[end].code === 412)) end++;
                k = end;
            }
        }
        return list.length;
    };
    run(0, 0);
    return vars[943];
};
const cases = [[[], 0], [[945], 1], [[2077], 5], [[945, 2077], 5], [[959, 935], 4]];
for (const [held, want] of cases) {
    carried = new Set(held);
    const got = axeCheck($dataCommonEvents[907].list), was = axeCheck(original[907].list);
    realLog(`axe tier carrying [${held.map(i => items[i].name).join(", ") || "nothing"}]: vanilla ${was} -> mod ${got}`);
    if (got !== want) fail("axe tier wrong for " + JSON.stringify(held));
}

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
