// Offline harness for FasterModLoader. Builds a small fake game folder with a few mods in a
// temporary directory, runs the mod against it, and checks that the mod loader's "does this mod
// replace this picture / sound?" checks get the same answers as before, only faster, and that a
// frame that takes very long ends up in the log.
//   node test_fastermodloader.js ["<game folder>"]     (the game folder is not used)
const fs = require("fs");
const os = require("os");
const path = require("path");
const MODS_ROOT = process.argv[3] || path.join(__dirname, "..", "mods");
const source = fs.readFileSync(path.join(MODS_ROOT, "FasterModLoader/js/plugins/FasterModLoader.js"), "utf8");
const realLog = console.log;
let problems = 0;
const fail = m => { problems++; realLog("!! " + m); };

const game = fs.mkdtempSync(path.join(os.tmpdir(), "elderfield-loader-test-"));
const put = rel => { const f = path.join(game, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "x"); };
put("index.html");
put("mods/Art/mod.json");
put("mods/Art/img/pictures/Title.png");
put("mods/Art/img/characters/Decor/!$Lamp.png");
put("mods/Sound/audio/se/Beep.ogg");
put("mods/Code/js/plugins/Code.js");
for (const m of ["M4", "M5", "M6", "M7"]) put("mods/" + m + "/mod.json");
put("mods/!Off/img/pictures/Title.png");
put("img/pictures/Title.png_");

const originalExists = fs.existsSync, originalMain = process.mainModule;
const answers = () => {
    // the questions the mod loader asks, built the way it builds them
    const q = (mod, folder, file) => fs.existsSync(path.join(game, "mods", mod, folder, file));
    return {
        "Art picture it has": q("Art", "img/pictures/", "Title.png"),
        "Art picture in a subfolder": q("Art", "img/characters/", "Decor/!$Lamp.png"),
        "Art picture, other case": q("Art", "img/pictures/", "TITLE.png"),
        "Art picture it lacks": q("Art", "img/pictures/", "Other.png"),
        "Code has no pictures": q("Code", "img/pictures/", "Title.png"),
        "Sound it has": q("Sound", "audio/se/", "Beep.ogg"),
        "Sound, other format": q("Sound", "audio/se/", "Beep.m4a"),
        "switched-off mod's picture": q("!Off", "img/pictures/", "Title.png"),
        "a mod's mod.json": fs.existsSync(path.join(game, "mods", "Art", "mod.json")),
        "a mod's plugin folder": fs.existsSync(path.join(game, "mods", "Code", "js", "plugins")),
        "the game's own picture": fs.existsSync(path.join(game, "img", "pictures", "Title.png_")),
        "a missing game file": fs.existsSync(path.join(game, "img", "pictures", "Nope.png_"))
    };
};
const timeIt = n => {
    const mods = ["Art", "Sound", "Code", "M4", "M5", "M6", "M7"];
    const start = process.hrtime.bigint();
    for (let i = 0; i < n; i++) for (const m of mods) fs.existsSync(path.join(game, "mods", m, "img/characters/", "Some/Sheet" + (i % 50) + ".png"));
    return Number(process.hrtime.bigint() - start) / 1e6 / n;
};

try {
    const before = answers(), slow = timeIt(3000);

    // ---- the game's pieces the mod touches ----
    global.window = global;
    global.require = require;                 // a global in the game (NW.js), module-scoped here
    process.mainModule = { filename: path.join(game, "index.html") };
    let busy = 0;
    const MODS = ["Art", "Sound", "Code", "M4", "M5", "M6", "M7"];
    global.SceneManager = {
        _scene: new (class Scene_Map {})(),
        updateMain() {                                   // a frame: some picture requests, then (maybe) a long stall
            for (let i = 0; i < 5; i++) ImageManager.loadBitmap("img/characters/", "Sheet" + i);
            const end = Date.now() + busy;
            while (Date.now() < end) { /* frozen */ }
        }
    };
    // the mod loader's hook: one check per mod folder
    global.ImageManager = { loadBitmap(folder, name) { for (const m of MODS) fs.existsSync(path.join(game, "mods", m, folder, name + ".png")); return null; } };
    global.Game_Map = function() {}; Game_Map.prototype.update = function() {};
    global.Spriteset_Map = function() {}; Spriteset_Map.prototype.update = function() {};
    global.Game_Interpreter = function() {}; Game_Interpreter.prototype.executeCommand = function() { return true; };
    global.$dataCommonEvents = [null, { id: 1, name: "Catch", list: [] }];
    global.$gameMap = { mapId: () => 7, _interpreter: { _list: $dataCommonEvents[1].list, _eventId: 3, _childInterpreter: null } };
    console.log = () => {};
    new Function(source)();
    console.log = realLog;

    const after = answers(), fast = timeIt(3000);
    realLog("question the mod loader asks".padEnd(34) + "before  with the mod");
    for (const k of Object.keys(before)) {
        realLog("  " + k.padEnd(32) + String(before[k]).padEnd(8) + after[k]);
        if (before[k] !== after[k]) fail(`"${k}" changed its answer`);
    }
    realLog(`files found in the mods' img and audio folders: ${FasterModLoader.files}`);
    if (FasterModLoader.files !== 3) fail("expected 3 replacement files in the list");
    realLog(`one picture request with 7 mods: ${slow.toFixed(4)} ms on disk -> ${fast.toFixed(4)} ms from the list (${Math.round(slow / fast)}x faster)`);
    if (fast * 5 > slow) fail("answers from the list should be much faster than disk checks");
    if (FasterModLoader.indexed === 0) fail("no check was answered from the list");

    // ---- slow frame log ----
    const logFile = path.join(game, "mods-slow-frames.log");
    busy = 0; SceneManager.updateMain();
    if (fs.existsSync(logFile)) fail("a normal frame was logged");
    busy = 450; SceneManager.updateMain();
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];
    realLog("slow frame log: " + (log[0] || "(nothing)").replace(/^\S+ \| /, ""));
    if (log.length !== 1 || !/4\d\d ms \| Scene_Map map 7/.test(log[0]) || !/running before: CE 1 Catch/.test(log[0]) ||
        !/pictures asked for: 5 /.test(log[0]) || !/mod folder checks: 35 from the list, 0 on disk/.test(log[0])) fail("slow frame not logged as expected");
} finally {
    fs.existsSync = originalExists;
    process.mainModule = originalMain;
    fs.rmSync(game, { recursive: true, force: true });
}

realLog(`\nproblems: ${problems}`);
process.exit(problems ? 1 : 0);
