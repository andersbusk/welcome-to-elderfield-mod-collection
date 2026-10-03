// Offline harness for CheapKiosk: stubs the DM_CoreShop environment, loads the
// real item/weapon/armor databases, runs the mod and checks the stock it returns.
const fs = require("fs");
const path = require("path");
const gameDir = process.argv[2];
// Mods under test: this repository's mods folder. Pass a second argument to test another
// folder instead, for example the copies inside the game: "<game folder>/mods".
const MODS_ROOT = process.argv[3] || require("path").join(__dirname, "..", "mods");
const load = f => JSON.parse(fs.readFileSync(path.join(gameDir, "data", f), "utf8"));

// --- RPG Maker metadata extraction (same regex as rmmz_managers.js) ---
const extractMetadata = data => {
    const regExp = /<([^<>:]+)(:?)([^>]*)>/g;
    data.meta = {};
    for (;;) {
        const match = regExp.exec(data.note);
        if (match) data.meta[match[1]] = match[2] === ":" ? match[3] : true; else break;
    }
};
global.window = global;
global.$dataItems = load("Items.json");
global.$dataWeapons = load("Weapons.json");
global.$dataArmors = load("Armors.json");
for (const list of [$dataItems, $dataWeapons, $dataArmors]) for (const e of list) if (e) extractMetadata(e);

// --- DM_CoreShop stubs (copied logic where the mod depends on it) ---
global.Game_Shop = function() {};
Game_Shop.prototype.storedGoods = function() { return this._coreShops[this._tempShopId]._storedContents; };
Game_Shop.prototype.openCoreShop = function(id) { this._tempShopId = id - 1; return "goto"; };
Game_Shop.prototype.checkItemCategory = function(item) {
    if (item.categories) return item;
    item.categories = item.note.replaceAll("<Categories>", "").replaceAll("</Categories>", "").replaceAll("\n", ",").split(",")
        .filter(s => s !== "").filter(s => !s.startsWith("<"));
    return item;
};
Game_Shop.prototype.checkItemWeight = function(item) { if (item.meta.itemWeight) item.itemWeight = Number(item.meta.itemWeight); return item; };
global.Scene_CoreShop = function() {};
Scene_CoreShop.prototype.create = function() { this.created = true; };
Scene_CoreShop.prototype.terminate = function() {};
global.Window_ShopNumber = function() {};
Window_ShopNumber.prototype.processNumberChange = function() { return global.shopAmount; };
Window_ShopNumber.prototype.onButtonUp = function() { return global.shopAmount; };
Window_ShopNumber.prototype.onButtonDown = function() { return global.shopAmount; };
global.$gameCategories = { setCustomCategories(c) { this.last = c; } };

const slime = Object.assign({}, $dataItems[225], { amount: "1", price: 30, retained: true, infinite: false, unlockStatus: 0, useCustomSell: false });
slime.categories = ["keyitems", "key", "all"];
const otherGood = Object.assign({}, $dataItems[91], { amount: "", price: 80, retained: true, infinite: true, unlockStatus: 0 });
global.$gameShop = new Game_Shop();
$gameShop._coreShops = [
    { "Shop Name": "Mall Kiosk", _storedContents: [slime], _storedDataContents: [{ itemId: 225, amount: "1", etypeId: undefined }] },
    { "Shop Name": "Other", _storedContents: [otherGood], _storedDataContents: [{ itemId: 91, amount: "", etypeId: undefined }] }
];

// --- run the mod ---
const log = console.log;
new Function(fs.readFileSync(path.join(MODS_ROOT, "CheapKiosk/js/plugins/CheapKiosk.js"), "utf8"))();

let problems = 0;
const fail = msg => { problems++; log("!! " + msg); };
const isSlime = g => g.etypeId === undefined && g.id === 225;
const ironBar = list => list.find(g => g.etypeId === undefined && g.id === 91);

// Open the kiosk the way the plugin command does
$gameShop.openCoreShop(Number("1"));
if (!$gameCategories.last || !$gameCategories.last.includes("all")) fail("category tabs not set for kiosk");
new Scene_CoreShop().create();
const goods = $gameShop.storedGoods();

// Original stock present, re-priced, saved object untouched
const slimeGood = goods.find(isSlime);
if (!slimeGood || slimeGood.price !== 1) fail("slime missing or not at price 1");
if (slimeGood === slime) fail("saved slime object was handed out instead of a copy");
if (slime.price !== 30 || $gameShop._coreShops[0]._storedContents.length !== 1 || $gameShop._coreShops[0]._storedContents[0] !== slime) fail("saved stock was mutated");

const items = goods.filter(g => g.etypeId === undefined), weapons = goods.filter(g => g.etypeId === 1), armors = goods.filter(g => g.etypeId > 1);
log(`kiosk stock: ${goods.length} total = ${items.length} items, ${weapons.length} weapons, ${armors.length} armors`);
const keys = new Set();
for (const g of goods.filter(g => g !== slimeGood)) {
    if (g.price !== 1) fail("price != 1 for " + g.name);
    if (g.infinite !== true || g.isInfinite !== true || g.amount !== "" || g.retained !== true || g.unlockStatus !== 0) fail("bad bookkeeping on " + g.name);
    if (!Array.isArray(g.categories) || !g.categories.includes("all")) fail("missing 'all' category on " + g.name);
    if (!g.name.trim() || /^[-=]/.test(g.name) || /^TEST/i.test(g.name) || g.name === "Empty") fail("placeholder leaked: " + g.name);
    if (g.itypeId === 2 || g.categories.includes("key") || g.categories.includes("keyitems")) fail("key item leaked: " + g.name);
    const k = (g.etypeId === undefined ? "i" : g.etypeId === 1 ? "w" : "a") + g.id;
    if (keys.has(k)) fail("duplicate " + k); keys.add(k);
    const db = g.etypeId === undefined ? $dataItems : g.etypeId === 1 ? $dataWeapons : $dataArmors;
    if (!db[g.id] || db[g.id].name !== g.name) fail("id mismatch " + k);
}

// A to Z order across the whole list, and therefore within every category tab
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
let unsorted = 0;
for (let i = 1; i < goods.length; i++) if (collator.compare(goods[i - 1].name, goods[i].name) > 0) unsorted++;
if (unsorted) fail(`list is not A to Z (${unsorted} out-of-order neighbours)`);
log("first 8:", goods.slice(0, 8).map(g => g.name).join(" | "));
log("last 4: ", goods.slice(-4).map(g => g.name).join(" | "));
const foods = goods.filter(g => g.categories.includes("food")).slice(0, 5).map(g => g.name);
log("Food tab starts:", foods.join(" | "));
const idx = goods.indexOf(slimeGood);
log("slime sits between:", goods[idx - 1].name, "|", slimeGood.name, "|", goods[idx + 1].name);

// database prices and order untouched
if ($dataItems[91].price !== 80 || $dataItems[225].price !== 30 || $dataItems[91].id !== 91) fail("database was modified");
// same catalogue objects reused within one scene, rebuilt on next create
if (ironBar($gameShop.storedGoods()) !== ironBar(goods)) fail("catalogue not cached within a scene");
new Scene_CoreShop().create();
if (ironBar($gameShop.storedGoods()) === ironBar(goods)) fail("catalogue not rebuilt on new scene");
// sold-out slime: list still works and stays sorted
$gameShop._coreShops[0]._storedContents = [];
new Scene_CoreShop().create();
const soldOut = $gameShop.storedGoods();
if (soldOut.find(isSlime)) fail("slime listed although sold out");
if (soldOut.length !== goods.length - 1) fail("unexpected stock size when slime is sold out");
for (let i = 1; i < soldOut.length; i++) if (collator.compare(soldOut[i - 1].name, soldOut[i].name) > 0) { fail("sold-out list not sorted"); break; }
// other shops untouched
$gameShop._tempShopId = 1;
if ($gameShop.storedGoods() !== $gameShop._coreShops[1]._storedContents) fail("other shop stock was replaced");
// stale shopAmount guard
$gameShop._tempShopId = 0; global.shopAmount = 5;
if (new Window_ShopNumber().processNumberChange() !== undefined) fail("shopAmount not cleared in kiosk");
$gameShop._tempShopId = 1; global.shopAmount = 5;
if (new Window_ShopNumber().processNumberChange() !== 5) fail("shopAmount cleared outside kiosk");

log(`problems: ${problems}`);
process.exit(problems ? 1 : 0);
