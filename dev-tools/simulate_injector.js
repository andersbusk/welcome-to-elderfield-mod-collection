// Reproduces VirtualModLoader's plugin concatenation for the active mod folders
// and syntax-checks the result, so we know the generated injector will parse.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const modsDir = MODS_ROOT;

const activeMods = [];
for (const folder of fs.readdirSync(modsDir).filter(f => fs.statSync(path.join(modsDir, f)).isDirectory() && !f.startsWith("!"))) {
    let priority = 0;
    const jsonPath = path.join(modsDir, folder, "mod.json");
    if (fs.existsSync(jsonPath)) priority = JSON.parse(fs.readFileSync(jsonPath, "utf8")).priority || 0;
    activeMods.push({ folder, priority });
}
const pluginMods = [...activeMods].sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.folder.localeCompare(a.folder));

let code = "if (window.VirtualModLoader && window.VirtualModLoader.active) {\n";
const order = [];
for (const mod of pluginMods) {
    const dir = path.join(modsDir, mod.folder, "js", "plugins");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
        code += fs.readFileSync(path.join(dir, file), "utf8") + "\n\n";
        order.push(mod.folder + "/" + file);
    }
}
code += "} else {\n    console.warn('skipped');\n}\n";

console.log("active mod folders:", activeMods.map(m => m.folder).join(", "));
console.log("injection order:", order.join(" -> "));
new vm.Script(code, { filename: "ModLoader_Injector.js" });
console.log("combined injector code parses OK (" + code.length + " chars)");
