// Offline harness: loads the real plugins.js recipe list, runs the mod plugin
// against it exactly as the game would, and prints before/after ingredients.
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");

const src = fs.readFileSync(path.join(gameDir, "js/plugins.js"), "utf8");
const plugins = JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
const craft = plugins.find(p => p.name === "CGMZ_Crafting");
global.CGMZ = { Crafting: { Recipes: JSON.parse(craft.parameters.Recipes) } };
global.DataManager = { onLoad() {}, isDatabaseLoaded() { return false; } };

const before = CGMZ.Crafting.Recipes.map(s => JSON.parse(s));


const modCode = fs.readFileSync(path.join(MODS_ROOT, "LessGrind/js/plugins/LessGrind.js"), "utf8");
new Function(modCode)();

const items = JSON.parse(fs.readFileSync(path.join(gameDir, "data/Items.json"), "utf8"));
const name = id => (items[id] && items[id].name) || ("item#" + id);
const fmt = ingJson => JSON.parse(ingJson).map(e => { const o = JSON.parse(e); return o.Generic ? `${o.Amount}x generic:${o.Generic}` : `${o.Amount}x ${name(+o.Item)}`; }).join(", ");

// Mimic CGMZ_RecipeTemp.setupArray to be sure the engine would read the new entries correctly
function setupArray(recipeJSONArray) {
    const out = [];
    for (const recipeJSON of JSON.parse(recipeJSONArray)) {
        const item = JSON.parse(recipeJSON);
        if (Number(item.Item) !== 0) { item.ID = Number(item.Item); item.Type = "item"; }
        else if (Number(item.Weapon) !== 0) { item.ID = Number(item.Weapon); item.Type = "weapon"; }
        else if (Number(item.Armor) !== 0) { item.ID = Number(item.Armor); item.Type = "armor"; }
        else if (item.Generic) { item.ID = 0; item.Type = "generic"; item.GenericCategory = item.Generic; }
        else { item.ID = 0; item.Type = "currency"; }
        item.Amount = Number(item.Amount);
        out.push(item);
    }
    return out;
}

let changed = 0, problems = 0;
for (let idx = 0; idx < CGMZ.Crafting.Recipes.length; idx++) { const s = CGMZ.Crafting.Recipes[idx];
    const r = JSON.parse(s);
    const b = before[idx];
    if (b.Ingredients === r.Ingredients) {
        if (JSON.stringify(b) !== JSON.stringify(r)) { problems++; console.log("!! unchanged-recipe altered:", r.Name); }
        continue;
    }
    changed++;
    console.log(`${r.Name}\n   before: ${fmt(b.Ingredients)}\n   after:  ${fmt(r.Ingredients)}`);
    for (const k of Object.keys(b)) if (k !== "Ingredients" && b[k] !== r[k]) { problems++; console.log("   !! other field changed:", k); }
    const parsed = setupArray(r.Ingredients);
    for (const p of parsed) if (!((p.Type === "item" && items[p.ID]) || p.Type === "generic") || !(p.Amount > 0)) { problems++; console.log("   !! bad ingredient entry:", p); }
}
console.log(`\nrecipes changed: ${changed}, total recipes: ${CGMZ.Crafting.Recipes.length}, problems: ${problems}`);
process.exit(problems ? 1 : 0);
