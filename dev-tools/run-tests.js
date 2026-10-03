// Runs every offline test against a game installation.
//   node dev-tools/run-tests.js ["<game folder>"]
// Without an argument it uses the game folder remembered by elderfield-mods.cmd.
// The mods under test are the ones in this repository (../mods), not the copies in the game.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function savedGamePath() {
    const home = process.env.ELDERFIELD_MODS_HOME || path.join(process.env.LOCALAPPDATA || "", "ElderfieldMods");
    try { return JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).gamePath; } catch (e) { return null; }
}

const gameDir = process.argv[2] || process.env.ELDERFIELD_GAME || savedGamePath();
if (!gameDir || !fs.existsSync(path.join(gameDir, "data", "CommonEvents.json"))) {
    console.error('Game folder not found. Usage: node dev-tools/run-tests.js "<game folder>"');
    process.exit(2);
}

const tests = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f)).sort();
tests.push("simulate_injector.js");
let failed = 0;
for (const file of tests) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file), gameDir], { encoding: "utf8" });
    const ok = result.status === 0;
    if (!ok) failed++;
    const lastLine = (result.stdout || "").trim().split(/\r?\n/).pop() || "";
    console.log(`${ok ? "PASS" : "FAIL"}  ${file.padEnd(28)} ${lastLine}`);
    if (!ok) console.log((result.stdout || "") + (result.stderr || ""));
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nAll ${tests.length} passed against ${gameDir}`);
process.exit(failed ? 1 : 0);
