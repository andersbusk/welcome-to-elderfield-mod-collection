// Offline harness for StrongerGems. Loads the real items and common events, applies the mod,
// prints every gem before and after, runs the game's level-range events for a spread of
// upgrade levels, and checks that nothing else changed.
//   node test_strongergems.js "<game folder>"
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const readJson = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));
const source = fs.readFileSync(path.join(MODS_ROOT, "StrongerGems/js/plugins/StrongerGems.js"), "utf8");
const realLog = console.log;
let problems = 0;
const fail = m => { problems++; realLog("   !! " + m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vanilla = { items: readJson("Items.json"), events: readJson("CommonEvents.json") };
const plain = t => String(t).replace(/\\c\[\d+\]/g, "");
const adds = it => plain(it.description.split("\n")[0]).replace(/^(Adds|Effect): /, "");
const levels = it => (/Item Level: (.*)$/.exec(plain(it.description)) || [0, "?"])[1];
const where = it => (/Upgrade Material: (.*?)<br>/.exec(plain(it.description)) || [0, "?"])[1];

function boot(edit) {
    global.window = global;
    global.$dataItems = readJson("Items.json");
    global.$dataCommonEvents = readJson("CommonEvents.json");
    global.DataManager = { onLoad() {}, isDatabaseLoaded() { return true; } };
    console.log = () => {}; console.warn = realLog;
    new Function(edit ? edit(source) : source)();
    DataManager.onLoad($dataItems);
    DataManager.onLoad($dataCommonEvents);
    DataManager.isDatabaseLoaded();
    console.log = realLog;
}
const setConfig = (name, value) => src => {
    const re = new RegExp("const " + name + " = [^;]+;");
    if (!re.test(src)) throw new Error("config " + name + " not found");
    return src.replace(re, "const " + name + " = " + value + ";");
};

// Per gem: the amounts its block hands to the upgrade plugin, read from a set of common events.
const GROUPS = vanilla.events[2885].list.filter(c => c.code === 117).map(c => c.parameters[0]);
function gemAmounts(events) {
    const out = {};
    for (const id of GROUPS) {
        let gem = 0;
        for (const c of events[id].list) {
            const p = c.parameters;
            if (c.indent === 0 && c.code === 111) gem = p[0] === 1 && p[1] === 132 ? p[3] : 0;
            else if (c.indent === 0 && c.code === 412) gem = 0;
            else if (gem && c.code === 357 && p[0] === "WTE_EquipmentUpgradeSystem" && /^Change/.test(p[1])) (out[gem] = out[gem] || []).push([p[1], Number(p[3].Value)]);
        }
    }
    return out;
}
// Run one of the game's "Check lv" events for an upgrade level: true = the gem is refused.
function refused(ev, level) {
    const list = ev.list, branch = {};
    let on = false;
    for (let i = 0; i < list.length; i++) {
        const c = list[i], p = c.parameters;
        const skip = () => { while (list[i + 1].indent > c.indent) i++; };
        if (c.code === 111) {
            let r;
            if (p[0] === 0) r = true;                                        // "CanUpgradeItem Check" is on at this point
            else if (p[0] === 1 && p[1] === 1505) r = [level === p[3], level >= p[3], level <= p[3], level > p[3], level < p[3], level !== p[3]][p[4]];
            else throw new Error("unexpected condition in " + ev.name);
            branch[c.indent] = r;
            if (!r) skip();
        } else if (c.code === 411) { if (branch[c.indent] !== false) skip(); }
        else if (c.code === 121 && p[0] === 1981) on = p[2] === 0;
    }
    return on;
}
const LEVEL_EVENTS = [2878, 2876, 2854, 2860];
const SPREAD = [0, 4, 5, 6, 9, 10, 11, 15, 16, 40];

// ============================ A. as shipped ============================
boot();
const before = gemAmounts(vanilla.events), after = gemAmounts($dataCommonEvents);
const gemIds = Object.keys(before).map(Number).sort((a, b) => a - b);
realLog("A. Every gem, unmodded -> with StrongerGems (as shipped)");
const notes = [];
realLog("   " + "gem".padEnd(22) + "goes on".padEnd(30) + "adds".padEnd(30) + "-> adds".padEnd(32) + "levels");
for (const id of gemIds) {
    const was = vanilla.items[id], now = $dataItems[id];
    realLog("   " + was.name.padEnd(22) + where(was).padEnd(30) + adds(was).padEnd(30) + ("-> " + adds(now)).padEnd(32) + levels(was) + " -> " + levels(now));
    // every amount is doubled, except a negative basic stat (the one drawback in the game)
    before[id].forEach(([cmd, v], k) => {
        const want = cmd === "ChangeParameters" && v < 0 ? v : Math.round(v * 2 * 10000) / 10000;
        if (after[id][k][0] !== cmd || after[id][k][1] !== want) fail(`${was.name}: ${cmd} ${v} became ${after[id][k][1]}, expected ${want}`);
    });
    // the description follows the commands: a number the game's own text shares with a command
    // is replaced by what that command now gives, anything else is left alone
    const numbers = it => (plain(it.description.split("\n")[0]).match(/[+-]\d+(\.\d+)?/g) || []).map(Number);
    const pool = before[id].map(([cmd, v], k) => ({ v, now: after[id][k][1] }));
    const want = numbers(was).map(n => {
        const i = pool.findIndex(e => e.v === n);
        if (i < 0) { notes.push(`${was.name}: the game's own text says "${adds(was)}" but the gem gives amounts ${before[id].map(x => x[1]).join(" and ")}; the unmatched number is left as it is`); return n; }
        return pool.splice(i, 1)[0].now;
    });
    if (!want.length || !same(numbers(now), want)) fail(`${was.name}: description says ${numbers(now)}, expected ${want}`);
    if (levels(now) !== "Any") fail(`${was.name}: level text is ${levels(now)}`);
    if (now.description.split("\n").length !== was.description.split("\n").length) fail(`${was.name}: description layout changed`);
}
realLog(`   gems: ${gemIds.length}`);
for (const n of notes) realLog("   note: " + n);
if (gemIds.length !== 61) fail("expected 61 gems with an amount, found " + gemIds.length);

realLog("\n   level ranges: is a gem refused at upgrade level ... ? (unmodded -> modded)");
for (const id of LEVEL_EVENTS) {
    const row = SPREAD.map(lv => (refused(vanilla.events[id], lv) ? "no " : "yes") + ">" + (refused($dataCommonEvents[id], lv) ? "no " : "yes"));
    realLog("   " + vanilla.events[id].name.padEnd(16) + SPREAD.map((lv, i) => ("+" + lv + " " + row[i]).padEnd(13)).join(""));
    if (SPREAD.some(lv => refused($dataCommonEvents[id], lv))) fail(vanilla.events[id].name + " still refuses a level");
}
const expectVanilla = { 2878: lv => lv >= 6, 2876: lv => lv >= 11, 2854: lv => lv < 5 || lv >= 10, 2860: lv => lv < 10 || lv >= 16 };
for (const id of LEVEL_EVENTS) for (const lv of SPREAD) if (refused(vanilla.events[id], lv) !== expectVanilla[id](lv)) fail("the test misreads the unmodded " + vanilla.events[id].name);

// nothing else changed
const changedEvents = [];
for (let i = 0; i < vanilla.events.length; i++) {
    const a = vanilla.events[i], b = $dataCommonEvents[i];
    if (same(a, b)) continue;
    changedEvents.push(i);
    if (a.list.length !== b.list.length) { fail("structure changed in CE " + i); continue; }
    a.list.forEach((c, k) => {
        const d = b.list[k];
        if (same(c, d)) return;
        const amountOnly = c.code === 357 && same(Object.assign({}, c.parameters[3], { Value: 0 }), Object.assign({}, d.parameters[3], { Value: 0 })) && same(c.parameters.slice(0, 3), d.parameters.slice(0, 3));
        const limitOnly = c.code === 111 && c.parameters[1] === 1505 && same([c.parameters[0], c.parameters[1], c.parameters[2], c.parameters[4]], [d.parameters[0], d.parameters[1], d.parameters[2], d.parameters[4]]);
        if (c.code !== d.code || c.indent !== d.indent || !(amountOnly || limitOnly)) fail(`CE ${i} command ${k}: something other than an amount or a level limit changed`);
    });
}
realLog("\n   common events changed: " + changedEvents.join(", "));
const gemGroups = GROUPS.filter(id => vanilla.events[id].list.some(c => c.code === 357 && /^Change/.test(c.parameters[1])));
if (!same(changedEvents, [...gemGroups, ...LEVEL_EVENTS].sort((a, b) => a - b))) fail("unexpected set of changed common events");
if ($dataCommonEvents.length !== vanilla.events.length) fail("common events were added");
let changedItems = 0;
for (let i = 1; i < vanilla.items.length; i++) {
    if (same(vanilla.items[i], $dataItems[i])) continue;
    changedItems++;
    if (!gemIds.includes(i) || !same(Object.assign({}, vanilla.items[i], { description: "" }), Object.assign({}, $dataItems[i], { description: "" }))) fail("item " + i + " changed in more than its description");
}
realLog("   items changed (description only): " + changedItems);
if (changedItems !== gemIds.length) fail("expected every gem description to change");
if (!same(vanilla.items[2977], $dataItems[2977])) fail("the Clear Gem was changed");

// ============================ B. other settings ============================
realLog("\nB. Other settings");
boot(setConfig("MULTIPLIER", "3"));
let a3 = gemAmounts($dataCommonEvents);
realLog(`   x3: Chipped Rage Gem ${adds(vanilla.items[2969])} -> ${adds($dataItems[2969])} | Lesser Sharp Gem ${adds(vanilla.items[2976])} -> ${adds($dataItems[2976])} | Treasure Gem ${adds(vanilla.items[2934])} -> ${adds($dataItems[2934])}`);
if (a3[2969][0][1] !== 0.6 || a3[2976][0][1] !== 6 || !same(a3[2934].map(x => x[1]), [12, -4])) fail("x3 amounts wrong");
boot(src => setConfig("MULTIPLIER", "1.5")(setConfig("MULTIPLY_PENALTIES", "true")(src)));
a3 = gemAmounts($dataCommonEvents);
realLog(`   x1.5 with penalties: Chipped Sharp Gem ${adds(vanilla.items[2974])} -> ${adds($dataItems[2974])} | Chipped Rage Gem -> ${adds($dataItems[2969])} | Treasure Gem -> ${adds($dataItems[2934])}`);
if (a3[2974][0][1] !== 2 || a3[2969][0][1] !== 0.3 || !same(a3[2934].map(x => x[1]), [6, -6])) fail("x1.5 amounts wrong");
boot(src => setConfig("MULTIPLIER", "1")(setConfig("NO_LEVEL_LIMITS", "false")(src)));
if (!same($dataCommonEvents, vanilla.events) || !same($dataItems, vanilla.items)) fail("with both settings off the mod should change nothing");
realLog("   multiplier 1 and limits kept: nothing changes");
boot(setConfig("NO_LEVEL_LIMITS", "false"));
if (LEVEL_EVENTS.some(id => !same($dataCommonEvents[id], vanilla.events[id])) || levels($dataItems[2976]) !== "0-5") fail("limits should be untouched when NO_LEVEL_LIMITS is false");

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
