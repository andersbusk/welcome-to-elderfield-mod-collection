# Welcome to Elderfield: modding map for AI agents

Written 2026-10-02 from one long modding session and kept up to date since. Everything here
was read out of the game's own files (build dated 2026-09-23). A game update can move things,
so verify an ID or name before relying on it. Nothing here was verified in the running game
by the agent; the mod author tests in-game.

Repository layout: `mods\<Name>\` (the mods, source of truth), `elderfield-mods.cmd` (the mod
manager: finds the game, switches the loader on, installs / enables / disables mods),
`dev-tools\` (offline tests and event dumpers; `run-tests.js` runs them all), `docs\` (this map).
The game folder is found by the manager; `elderfield-mods game` prints it. A typical path is
`<Steam library>\steamapps\common\Welcome to Elderfield - Full Game`.

## 1. How mods in this collection are built

- Every mod folder has a `README.md` that says what the mod does, its settings and what it means for the save.
  Keep it in step with the mod: the swing tables in `LessGrindHits/README.md` mirror what `test_lessgrindhits.js` prints.
- Mods live in `mods\<Name>\` as separate folders, one concern per mod. Do not edit game files.
  The single exception already made: the loader flag in `js\plugins.js` (section 3).
- Do not change item database values (prices etc.) to get an effect. Override behaviour instead.
- Prefer changes that leave nothing behind in the save. Say plainly what a mod does write to the save.
- Every number goes in a `CONFIG` block at the top of the plugin, with the vanilla value in a comment.
- After every change: `node --check` the plugin, run `node dev-tools\run-tests.js`, bump `version` in `mod.json`,
  then `elderfield-mods update` to copy it into the game. Edit mods in this repository, not in the game folder.
  With `elderfield-mods link all` the game's mod folders are junctions to the folders here, so an edit is live on
  the next game start with no update step. The manager removes such links without touching what they point to;
  never delete one with `Remove-Item -Recurse`, which can delete through the link.
  The game must be restarted to pick up a change. An agent cannot see the game's console.
- The author gives exact numbers when they care, and likes to review a proposed table before balance changes
  are implemented; otherwise pick a sensible value, state it, make it a config knob.
- When something looks like a quest/progression gate, keep the gate by default and offer a flag.

## 2. What the game is

- RPG Maker MZ (rmmz 1.7.x) in NW.js. `Game.exe`, `index.html`, `js\main.js`, `js\rmmz_*.js`.
- `js\plugins.js`: one 6 MB file, `var $plugins = [...]`, 418 entries, one plugin per line,
  each `{"name","status","description","parameters"}`. Parameters are JSON strings nested
  several levels deep (arrays of JSON strings of objects whose fields are JSON strings).
- `js\plugins\*.js`: ~404 plugin files. Plain text except 16 obfuscated ones (`VisuMZ_*`,
  `Hendrix_Localization.js`). Developer patches are named `WTE_*`; Dungeonmind `DM_*`; Casper Gaming `CGMZ_*`.
- `data\*.json`: plain. Items 3000 slots, Weapons, Armors, States 300, CommonEvents 4000 slots,
  286 maps, `MapInfos.json`, `System.json` (switch and variable names: read these first).
- Images and audio are encrypted (`.png_`, `.ogg_`), key in `System.json`. Not needed for logic mods.
- Saves: `save\file*.rmmzsave` (pako-compressed JSON). Steam cloud is on.
- `debug.log` only has Chromium messages, not `console.log`. Devtools are disabled in `package.json`.

## 3. The mod loader

- Official loader: `js\plugins\VirtualModLoader.js` (+ `_UI`, + `ModLoader_Injector.js`). Docs: `mods\How to Mod.txt`.
- **It ships disabled.** In `plugins.js`, `VirtualModLoader` and `VirtualModLoader_UI` have `"status":false`.
  Only the injector is on, and it no-ops without the loader. Check this before telling anyone a mod is active:
  `grep -o '"name":"VirtualModLoader","status":[a-z]*' js/plugins.js` and
  `grep "MOD PLUGIN:" js/plugins/ModLoader_Injector.js` (lists what actually got loaded).
- `elderfield-mods.cmd` switches it on (`loader on`, or automatically on `install` / `enable`): it flips that one
  flag byte-exactly, keeps a copy of `plugins.js` under `%LOCALAPPDATA%\ElderfieldMods\backups`, and renames
  `Example_Mod` to `!Example_Mod`. A Steam update or "verify integrity" undoes both; run `loader on` again.
- How it works: at boot it concatenates every `mods\*\js\plugins\*.js` into `ModLoader_Injector.js`
  (wrapped in one `if` block), rewrites the file if it differs, and reloads once. The injector is plugin 416 of 418,
  so mod code runs after every game plugin has loaded, and before the database loads.
- Order: by `mod.json` `priority` ascending, then folder name descending. Current order (2026-10-02):
  FasterModLoader (10) -> StrongerGems (50) -> LessGrindHits (50) -> LessGrind (50) -> HigherDrops (50) ->
  CheapKiosk (50) -> Espresso (60) -> CoffeeMachines (70).
- Folder name starting with `!` = disabled. `Example_Mod` must stay disabled: it replaces home map events 73 and 300.
- Also supports data splicing (`data\moddedItems.json`, `moddedMap002.json`, ...) and image/audio overrides.
  Not used by our mods; splices replace whole entries by ID and go stale on game updates.
- Cost: with the loader on, every `ImageManager.loadBitmap` and `AudioManager.createBuffer` call does one
  `fs.existsSync` per mod folder (about 30 microseconds each; 0.2 ms per picture with seven mods). The loader's hook
  sits at the bottom of the alias chain and its mod list is a closure constant, so the only handle on it is `fs`
  itself. Callers that request pictures in bulk make this visible: `WTE_SpriteBaker` calls `ImageManager.loadCharacter`
  for every baked event, every frame, while a bake is loading. The `FasterModLoader` mod answers those checks from
  an index built at start-up.

## 4. Patterns that worked

All mods are a single IIFE plugin. Techniques, in order of preference:

1. **Rewrite a global another plugin built at load.** Example: `CGMZ.Crafting.Recipes` is an array of JSON
   strings that later code re-parses, so rewriting entries at mod load changes every consumer.
2. **Patch database objects in memory** by aliasing `DataManager.onLoad(object)` and checking
   `object === $dataCommonEvents` / `$dataItems`, or `object.data && object.events` for maps
   (this also catches the spawn/template maps). Add an `isDatabaseLoaded` fallback. Mark patched objects with a flag so it runs once.
3. **Alias prototype methods** (`Game_Battler.prototype.addState`, `Game_Player.prototype.realMoveSpeed`,
   `Game_Shop.prototype.storedGoods`, ...). Your alias wraps the game's, so run the original first and adjust after.
4. Plugin constants parsed into closure `const`s (e.g. speeds in `WTE_Footsteps`, durations in `WTE_TimeConverter`)
   cannot be changed. Override the function that consumes them, or fix up its output.

Rules of thumb:
- Find common events by ID **and** name, fall back to name search, warn and skip if missing.
- Change a command's parameters in place; do not insert or delete commands in existing lists (indices and jumps).
  If logic must change, switch an operand to a script (code 122 operand type 4, or code 111 type 12).
- Match commands by exact parameter shape so a game update makes the patch a no-op instead of a wrong edit.
- Adding content without new IDs: reuse a blank `"Empty"` item slot (1296 exist; 1400, 1403 and 1404 are taken by Espresso,
  1401 by CoffeeMachines; 1402 was used by its version 1.0),
  append common events at `$dataCommonEvents.length` (ID computed at load, never saved), reuse existing states.
  A new item/state ID that disappears with the mod is what can crash a save.

What lives in the save (so avoid mutating it, or know you are): `$gameShop` shop stock (DM_CoreShop),
`Game_Time._actorStates` timed states, `$cgmz` recipe discovered flags, `$gameSystem` (professions/perks,
protected tool tiers), `$gameCategories`, self variables and self switches, container contents, spawned and placed events.

## 5. Event command cheat-sheet

`{code, indent, parameters}`. Codes that mattered:

| Code | Meaning | Parameters |
|---|---|---|
| 101 / 401 | Show Text header / text line | 401: `[text]` |
| 102 / 402 / 404 | Show Choices / When / End | |
| 103 | Input Number | `[variableId, digits]` |
| 108 / 408 | Comment | |
| **109 / 409** | **Skip block (MZ)** | Everything between is disabled. A lot of old logic here is dead code. |
| 111 / 411 / 412 | If / Else / End | `[0, switchId, 0=ON]`; `[1, varId, 0 const or 1 var, value, op]` op 0 `==` 1 `>=` 2 `<=` 3 `>` 4 `<` 5 `!=`; `[4, actorId, 6, stateId]`; `[8, itemId]`; `[12, script]` |
| 117 | Call Common Event | `[id]` |
| 118 / 119 | Label / Jump to Label | |
| 121 | Control Switches | `[from, to, 0=ON 1=OFF]` |
| 122 | Control Variables | `[from, to, op, operandType, ...]` op 0 set 1 add 2 sub 3 mul 4 div 5 mod; type 0 const, 1 variable, 2 random, 3 game data, 4 script |
| 125 / 126 | Change Gold / Items | 126: `[itemId, 0 gain or 1 lose, 0 const or 1 var, value]` |
| 205 / 505 | Set Movement Route | |
| 230 | Wait | `[frames]` |
| 250 | Play SE | |
| 313 | Change State | `[0, actorId or 0, 0 add or 1 remove, stateId]` |
| 314 | Recover All | clears states; the game then re-applies timed ones |
| 355 / 655 | Script / continuation | |
| 357 / 657 | Plugin Command / editor echo lines | `[plugin, command, label, args]`; only 357's args matter |

Common event `trigger`: 0 none, 1 autorun, 2 parallel. Interpreter yields after 100,000 commands per frame.

Self variables (`EliMZ_SelfVariables`): any variable whose name starts with `SV:` is stored per event.
In events it looks like a normal variable ID (24 = `SV: A`, 25 = `SV: B`, 26 = `SV: CROP TYPE`, ...).
From script: `$gameVariables.selfValue([mapId, eventId, varId])`, `setSelfValue(...)`, `this.getSv(id)`.

## 6. Systems

### Items
- Tags in `note`: `<Categories>` block (symbols: items, material, food, seed, utility, potion, deco, keyitems, key, tool,
  weapon, armor, all), `<undroppable>` (blocks discard only; depositing in crates works), `<Cannot Sell>`, `<noq>`,
  `<Max Item: n>`, `<itemWeight:n>`, `<select filter: ...>`, `<cgmzcraftinggeneric:Type>`, `<cgmzencyclopediahide>`,
  `<Protected Tag: X>` + `<Protected Tier: n>` (tools).
- Quality tiers are separate item IDs with the same name (e.g. Wheat 901, 1094, 1098, 1102), linked by the generic tag.
- ~1340 entries are placeholders (`Empty`, blank, `=====Section=====`, `TEST...`). Real items carry the `all` category.
- `python dev-tools\make_itemlist.py "<game folder>" ItemList.csv` writes a list of every item, weapon and armor
  with its ID. `docs/ItemList.csv` is a committed copy: IDs, names, prices and categories, without the description
  text (that is the game's own writing; add `--descriptions` to make a local copy that has it).

### Crafting (CGMZ_Crafting)
- 510 recipes in plugin param `Recipes`. Fields: `Name`, `Products`, `Ingredients`, `Tools`, `Profession`
  (= which station: Upgrade, Forge, Combine, tinker, coffee maker, Witching Mortar, Utility, ...), `Discovered`,
  `Unlearn On Craft`, `Time`. An ingredient is `{"Item","Weapon","Armor","Gold","Generic","Amount"}`, all strings.
- Ingredient lists are rebuilt into `$cgmzTemp` at every boot (not saved). Discovered state is saved in `$cgmz`;
  `WTE_CGMZ_CraftingSync` re-syncs it with the recipe list on load and purges recipes that no longer exist.
- Recipe names are not unique (`Wooden Table` appears twice): compare by index, not name.
- High-quality crafting chance of 1 means none (the formula subtracts 1).

### Tools
- Tiers: Rusty 1, Basic 2, Sturdy 3, Quality 4, Superior 5. Pickaxe IDs 966, 968, 963, 934, 2076. Axe 945, 959, 958, 935, 2077.
  Scythe 944, 940, 939, 936, 2078. Watering can 999, 965, 932, 2074. Hoe 1000, 964, 933, 2075. Rod 187, 188, 189.
- 18 upgrade recipes, profession `Upgrade`, each consumes the previous tool and unlearns itself.
- Level checks: CE 916 pickaxe (sets V945), 907 axe (V943), 986 scythe (V947), 1014/2441 can reach and capacity,
  1015 hoe reach, 166 rod. Required-tier variables: V944 pickaxe, V942 axe, V946 scythe.
- Pickaxe and scythe checks are sequential ifs, so the best tool carried wins. **The axe check (CE 907) is an
  if/else chain starting at Rusty: the weakest axe carried wins.** Vanilla never has two axes (upgrades consume
  the old one), but the kiosk makes it possible. LessGrindHits fixes this (`FIX_AXE_TIER`).
- `DM_ProtectedItemsPatch` logs the highest tier ever owned per tool type and restores it to container 1 if all are lost.
- No quest, achievement or event is triggered by owning or crafting upgraded tools.

### Mining
- Rocks are templates on spawn map 36 (`EVENT SPAWN`), copied by `GALV_EventSpawner`. Each sets V944 (required tier),
  V30/V31 (drop item and amount), health in `SV: B` (25), then calls CE 917 `Check Pick and Mine Rock`.
- CE 917: needs V945 >= V944; each swing `SV: A` (24) += V945; breaks when A >= B. So swings = ceil(health / tier).
- Plain stone comes in strengths by area: required tier 1 / health 4 (one beginner room), 2 / 6 (first mine `Mine1`,
  cabins), 3 / 12 (`Mine2`), 4 / 16 (Catacombs mines); Small Rock 1 / 6; Big Rock 3 / 24.
  Spawner CEs: 871, 831, 2452, 2370. Full tables: `dev-tools\list_breakables.py` and `test_lessgrindhits.js`.
- Breakable clutter (`Clutter1 ...` templates: crates, bones, bricks) never sets V944, so the required tier there
  is whatever the last rock left in the variable.
- Drops: the template page sets V30 `Item` and V31 `Amount` right before calling the swing event, as
  `[31,31,0,0,n]` (fixed) or `[31,31,0,2,min,max]` (random, re-rolled on every swing; the roll at the breaking
  swing counts). Coal Ore is 3-8, Dense Coal 6-14, the dense metal rocks 2-4, Green Crystal 1-3, nearly
  everything else 1. CE 778 `Add Mine Bonus Items` then doubles V31 with a chance of base + mining level
  (+15 with state 26, +5 with armor 398 equipped), and CE 836 `Give item (Mine)` hands the items over.
  The swing is refused when V30 x V31 does not fit the inventory. Gem nodes set no item; they call loot
  events (CE 2865 and friends). Templates are read live from the spawn map (`$dataSpawnMap`, loaded through
  `DataManager.loadDataFile`, so `onLoad` sees it), which means a patched template also applies to rocks
  already spawned. Print everything with `dev-tools/list_drops.py`.
- Forage picked by hand (Herb, Leaf Pile, Bloodberry, the mushrooms, ...) works the same way: a spawn-map template
  sets V30 / V31 and calls CE 865 `Check and Harvest Item` (after CE 912 crouch, CE 900 shake, CE 2338 pop and
  CE 777 `Add Forage Bonus Items`, the foraging 2x roll). Nearly all give 1; Herb and the red and green mushroom
  1-2, Sunflower 1-3, Snow Pearls 2-3, Wild Herbs 2-4. `dev-tools/list_drops.py` lists them under "by hand".
- The profession perk "MiningPerk7 +1 pickaxe damage" is not referenced by any event or plugin (no effect found).
- **Axe and scythe use the identical mechanism**: CE 906 `Check Axe and Chop Tree`, CE 978 `Check Axe and Chop Wood`,
  CE 984 `Check Scythe and Cut Grass`, each with `SV: A += <tier variable>` then `A >= SV: B`. One map event
  (map 156 `Hardwood4`) carries its own copy of the axe damage command. Trees: tier 2 health 11-15, tier 3 22-30,
  tier 4 36, tier 5 32. Grass: health 4.
- Felling a tree: CE 902 `Swing Axe` -> CE 903 `Fell Tree + Give item` -> CE 908 `Tree Fall Anim` -> CE 909 `left` or
  CE 910 `right`. The fall is four loops of `rotate(V15)`, `V15 -=/+= step` (1, 2, 2, 3), `Wait` (3, 3, 2, 2) until
  the angle passes 15, 30, 65, 89: 119 frames, then Shake Screen with wait (15 frames). V15 `Math` is a shared scratch
  variable. A parallel failsafe, CE 921 `Tree Fall Timer` (switch 621), waits 120 frames and then forces V15 to 100
  or -90 if switch 622 / 623 is still on. Vanilla bug: CE 910 ends with switch 622 ON instead of OFF, so that write
  happens after every right-hand fall. `dev-tools/list_waits.py <ids>` prints where an event spends its frames.
- Why the player is locked during an event: `Game_Player.canMove` returns false while `$gameMap.isEventRunning()`
  (aliased by DK_Disable_Player_Movement, EliMZ_CameraManager, MasterLoadingFade, WTE_PocketEvents_PlacementSecurity;
  input goes through WTE_TurnInPlace's `moveByInput`). Starting things is gated separately: `updateNonmoving`,
  `startMapEvent`, the menu, and WTE_UniversalInteraction's `wteIsMeaningfulEventRunning` all ask `isEventRunning`
  themselves. So walking can be freed during one event without letting anything new start. The tool swing calls
  `GALV_CharacterAnimationsMZ.animOff` and only `animOn` at the very end of CE 902; with it off the player keeps the
  idle row of the sprite sheet while moving (`Galv.CA.animStatus(true)` turns it back on).
- To change swings without touching saved health values, replace the damage command's operand with a script
  (`[24,24,1,4,"..."]`). Inside it `this` is the interpreter: `this.getTargetMapIdSelfVariable()`,
  `this.getTargetEventIdSelfVariable()`, `$gameVariables.selfValue([map, event, 25])` for health, and
  `$gameMap.event(id).event().name` for the template name (spawned events return their spawn-map template).

### Processing machines
- All share CE 817 `Processor`, selected by `SV: Smelter Type` (V104): 1 grinder, 2 furnace, 3 food processor, 4 feedmaker,
  5 preserving barrel, 6 keg, 7 cask, 8 windmill, 9 blast kiln, 10 slicer, 11 drying rack. Types 1, 2, 4, 8, 9, 10 take up to 9 at once.
- Per-item rules live in "Check ... Item" events: 818 grinder, 846 furnace, 889 food processor, 987 feedmaker,
  997 preserves, 1007 keg, 2423 windmill, 2392 blast kiln, 2391 slicer, 2218 drying rack, 2474 cask.
  They set `SV: Smelter Time` (V106): minutes for clock machines, days for barrel (3), keg (5), drying rack (7/10).
- Day machines: finish day = V106 + V250 (`Day Counter`), checked by CE 1000 (barrel) and CE 1010 (keg, drying rack)
  with a strict `<`, i.e. one day later than the message says.
- Cask: CE 2474 sets `SV: Processing Time` (V1288) = 7 days per stage; the stage logic is a script on the cask
  template event (map 53 `EVENT PLACEABLES`, event 126, page 8). Four stages.
- Placeable machines are `PKD_PocketEvents` templates on map 53 (barrel 106, keg 107, cask 126).
- Clock machines (grinder, furnace, food processor, ...): CE 819 `Processor Checks` takes the items, CE 820
  `Process Item` sets `SV: Smelter Time` (V106) = minutes + V133 `Processing Clock` (in-game minutes, only counts
  up, also over a night's sleep) and the stage variable to 1. The template's parallel page runs CE 821
  `Processing Process`: `this.waitForVar(133, this.getSv(106))` (WTE_TimeConverter), then stage 2, whose action
  page calls CE 824 `Give Processed Item`. So "ready" is simply `V133 >= SV 106`.

### Placeables (PKD_PocketEvents)
- Templates: map 53, loaded as `$dataEPEventsMap` (through `loadDataFile`, so `DataManager.onLoad` sees it; it is
  not part of `isDatabaseLoaded`). 457 templates and 457 entries in plugin param `PlacementsList`, entry N = template
  event N. Parsed into `PKD_EasyPlacement.PARAMS.ITEMS` (index 0 is null) when the database starts loading. All
  readers go through `PKD_EPManager.ItemData(index)`, which makes it the one place to alter rules per situation.
- An item places an object through its use event: `PKD_PocketEvents PlacePocketEvent {placementItemId, gameItemId}`
  -> `PKD_EPManager.Start` -> the player picks a spot -> `PKD_EPManager.PlaceItemOn(x, y)`, which registers
  `[placement index, x, y, event id, ...]` in `$gameSystem` (saved), consumes `$gameTemp._epPlacementPartyItemId` and
  turns self switch D on. On every map load `CreateEPEventsOnMap` rebuilds the objects from that list with
  `ItemData(index).eventId`: **an index that no longer exists throws**, so a mod must never leave its own placement
  index in a save. `WTE_GalvConverter` can also turn placed objects into Galv spawn events (`_spawnEventId` =
  10000 + template), copying self switches and self variables to the new event id; keep per-object state in self
  variables, not in a table keyed by event id.
- A machine's "done" look is not a balloon or an icon: it is another row of its sprite sheet, selected by the
  ready page's `direction`, with a speech bubble drawn into the picture and `stepAnime` on so it bobs.
- Template pages follow one pattern: page 0 parallel -> CE 2397 `Object Placement Start` (CE 1299 resets every `SV:`
  variable and self switch); page 1 parallel, self switch D: sets `SV: A` (V24) and D off; page 2 action, `SV: A`
  condition: the object's menu (`EliMZ_ChoiceManager cmd_setupByTemplate {id}` + Show Choices; templates live in
  `Eli.ChoiceManager.parameters.templates`, pictures per choice). Pick-up is `RemovePocketEvent2` + CE 1299 + CE 837
  `Give item (Farm)` with V30/V31, or CE 966 `Deco Pickup` for plain decorations. Machines add a parallel
  "processing" page and a "ready" action page with `<AlwaysStep>`.
- Where an object may go: `onlyRegions` of its placement entry, plus `WTE_PocketEvents_MapWhitelist`, which maps the
  sorted region list to allowed maps (Coffee Maker `5,8,9,10,11,12,238` = Home only; Keg
  `3,4,5,8,9,10,11,12,13,14,15,238` = Home 2, Farm 34, Workshop 42, Ranch 50). It caches its answer per map and
  placement id in `PKD_EPManager._wteCachedMapValidity`.
- What can carry other objects is a comment on the event: `placeOverType:table` (18 templates), `lower` (rugs and
  floors, 87), `shelter` (6); read it with `PKD_EasyPlacement.Utils.GetCommentCodeValue("placeOverType", event)`.
  A placement entry's `spawnOverEventsTypes` lists what it may stand on. The event note `<shift N>` only changes
  draw order (WTE_SpriteSortOffset), not the position on screen.
- Sprites: character sheets named `!$Name` are 3 x 4 cells; `Sprite_Character` computes the cell size from the bitmap,
  so a same-sized bitmap can be swapped in on the sprite (never on the event, whose image name is saved).
  `ImageManager.clear()` on map transfer destroys cached bitmaps, so keep a composed bitmap outside the cache.
  **A bitmap drawn at runtime dies with its sprite:** VisuMZ_0_CoreEngine marks every bitmap that was drawn on
  (`_customModified`, set by `blt`, `fillRect`, `drawText`, ...) and destroys it when a sprite showing it is destroyed
  (leaving the map, removing an event). A bitmap shared by several sprites must set `_customModified = false` and
  `_wteIndestructible = true` (WTE_SpriteBaker makes `Bitmap.destroy` skip those), and should still check
  `_canvas` / `_baseTexture` before reuse and redraw itself when they are gone.
- `python dev-tools/find_var.py <id>` shows every reader and writer of a variable; use it before borrowing an `SV:`
  variable. `SV: Item` (1286) is only used by fishing spots, the crab pot and the cask.

### Time
- `DK_Game_Time` + `WTE_TimeConverter`. V127 Hour, V125 Month, V250 Day Counter (+1 in CE 507 `Midnight`).
- Timed states: `WTE_TimeConverter` param `State Durations` (only state 243, 4 hours). On `addState` it stores
  `{actorId, stateId, gameTime}` in `Game_Time._actorStates` (saved). `ReapplyTimedStates` restores them after
  Recover All using `actor._wteIgnoreTimerRefresh`; respect that flag in any `addState` alias.

### Movement speed
- `WTE_Footsteps` owns player speed: walk 4.0, run 3.5, bike 4.0, dash bonus +1.0, cap 6.5, state multiplier for
  state 243 (walk x1.10, run x1.10, bike x1.04). Speed is exponential: +1 doubles it; tiles/s = 2^speed * 60 / 256.
- It caches the result in `$gamePlayer._wteCachedSpeed` with flags `_wteIsBiking`, `_wteIsRunning`, `_wteIsCutscene`,
  `_wteHasSpeedState`. Override `Game_Player.prototype.realMoveSpeed` and use those flags.
- Dash = bike or run: switch 626 `Indoor Running` ON means run on foot. Each map's setup event sets it (28 maps allow
  the bike). Heavy Snow / Snow Storm and Hallows Eve costumes force running. Switch 19 = indoor. Switch 534 turns the plugin's speed off.
- The old event-based speed and coffee-timer logic (CE 1130, 1131, 1133, 2348, 2499) is inside Skip blocks: dead.

### Coffee
- `Cup of Coffee` item 2043 -> CE 1132 -> state 243 `Coffee`. Recipe at the Coffee Maker: 3 generic `CoffeeBean`.
  One coffee item only; bean quality changes nothing.

### Shops (DM_CoreShop)
- Shops are defined in plugin param `Shop Manager` (1-based IDs; ID 1 = `Mall Kiosk`, the Eldritch Slime shopkeeper,
  map 3 `Mall_1` event 30; `General Store` is ID 14 in the full game and ID 2 in the demo, map 8 `T_Store`). Opened by plugin command `DM_CoreShop openCoreShop {shopId}`.
- `$gameShop._coreShops[id-1]._storedContents` / `_storedDataContents` hold stock and are saved. Goods are shallow copies
  of database entries with `amount` ('' = unlimited), `price`, `retained`, `infinite`, `unlockStatus`, `categories`.
- The buy window reads `$gameShop.storedGoods()`; buying gives `$dataItems[good.id]`. Override `storedGoods` for a
  read-only view instead of touching saved stock. Category tabs: `$gameCategories.setCustomCategories([...])`.
- Bug to know: `Window_ShopNumber` caps purchases with an implicit global `shopAmount` that is only refreshed when the
  item exists in saved stock. Clear it for generated goods.
- Only a few vanilla `Shop Processing` (302) commands exist (travelling merchant CE 943, test events).

### Trough upgrade (Klaus)
- Real cost: CE 2977 `Trough +` sets V986/V987 (Wood 75, Stone 76 amounts) and V991 (gold); CE 895 pays from V981-V991.
- Displayed cost and text: a separate copy inside `WTE_VisualChoiceMenu openBuildingMenu` args (`choices`) in
  CE 2972 and CE 2220. Patch both.
- Effect: CE 894 adds 4 to self variable 25 of Ranch (map 50) events 4, 37, 38, 39 and +1 to V1641-V1644.
  Capacity is an absolute number in the save. The trough events also enforce a floor of 8 + level x 4. Cap check `< 999`.
- Feeding: CE 886 `Trough`; the "Add how many?" box is code 103 with 2 digits.

### Crops and day change
- CE 507 Midnight -> CE 516 `UPDATE CROP MAPS` -> CE 923 `Update all Crops` per map: Farm (map 34, plot events 30-209)
  and chamber maps 203-219. Per plot it runs ~8 common events including CE 750 (1094 commands, bitmap compositing via
  `KC_CompositeBitmaps`), plus a fixed 30-frame wait per map. This is why "Updating Crops" is slow.
- Rain rituals: items 976/977/978 (4/8/16 days), recipes at the Witching Mortar.

### Equipment upgrades (gems)
- `WTE_EquipmentUpgradeSystem`. Station: the Anvil in the Workshop (map 42 event 32) -> CE 2871 `Open Upgrade Menu`
  -> CE 2885 `Check Material, do upgrade`, which calls every gem-group event in turn: 2881, 2882, 2877 (Lesser),
  2875, 2874 (Greater), 2873, 2872 (Special), 2859, 2858, 2857 (Perfect), 2883 (Clear Gem).
- 62 gems are items 2918-2979 with the `<UpgradeMaterial>` notetag. Per gem, a group event has one block:
  `If V132 == <gem id>` -> slot event (2889 weapon, 2886 / 2888 armor) -> level-range event (CE 2878 = +0 to +5,
  CE 2876 = +0 to +10, Perfect gems +10 to +15) -> plugin command `ChangeParameters` / `ChangeExParams` /
  `ChangeSpParams` / `ChangeElementRate` with the amount in `Value` (a string, evaluated as JS) -> lose 1 gem.
  A command with `UpdateName: true` also raises the item's +N level.
- Chipped gives half; Lesser, Greater and Perfect give the same amount and differ only in the level range they
  work in. The level is read from the item's name (`GetPlusValue` mode `name`), so crafted "+4" jewelry starts at 4.
- The plugin copies every weapon and armor as "vanilla" in `Scene_Boot.onDatabaseLoaded`, and on new game and on
  every load resets the database to that copy and re-applies the saved deltas. So a mod that changes equipment
  `params` must do it when the file loads (`DataManager.onLoad` / `isDatabaseLoaded`), before that copy is taken;
  a later change is wiped on the next load.
- Upgrades apply to the equipment's database entry (every copy of that weapon or armor) and are saved in
  `$gameSystem._customStats` as a history of deltas per level; changing a gem's amount only affects upgrades made
  afterwards. `python dev-tools/find_plugin_calls.py WTE_EquipmentUpgradeSystem` prints all of it.

### Other
- Achievements: `Cyclone-Steam.js`, awarded by CE 2760 with the ID in V838. No mod or cheat gating exists.
- Quests: `CGMZ_QuestSystem` params. Build menus: `WTE_VisualChoiceMenu`. Professions and perks: `WTE_Professions`.
- Map transfers: `MasterLoadingFade` holds a black screen and retries while frames are slow.
- Developer leftovers: CE 127 `CHEAT MENU`, test maps and one-line test events that hand out items. Ignore them.

## 7. The mods that exist

| Mod | File | What it does |
|---|---|---|
| LessGrind | `LessGrind.js` | Tool upgrades need 1 of each original ingredient (`TOOL_UPGRADE_COST`); Greater Offering of Rain = 1 Wheat; Preserving Barrel = 1 Wood; barrel and keg 1 day, cask 1 day per stage, off-by-one fix; trough upgrade 15 Wood, 15 Stone, 500 gold, +16; coffee 24 h and speeds 4.5 / 5.0 / 5.5; `EQUIPMENT_STATS` replaces the `params` of listed weapons / armor when the file loads (Lucky Horseshoe, armor 412: +10 all, +30 Luck) |
| LessGrindHits | `LessGrindHits.js` | Swings for pickaxe, axe, scythe. Per tool: `maxSwings` (pickaxe 6, axe 4, scythe 2), `upgrade` (`proportional` for pickaxe = damage by tier as vanilla; `halve` for axe and scythe = each tier above the minimum halves the swings), a `toughest` table (health of the toughest thing per minimum tier, which takes maxSwings with that tier; the rest scale by health) and `overrides` by event name (plain `Rock N` = 1, Small Rock 4/2/2/1/1, Big Rock -/-/5/3/2). The user tunes these by reviewing tables; print them with `test_lessgrindhits.js`. Tier gates unchanged. Uses the best axe carried. `TREE_FALL` shortens the felling animation (waits per phase [2, 1, 1, 1] instead of [3, 3, 2, 2], no wait for the shake: 134 -> 63 frames), turns switch 622 off at the end of the right-hand fall, and lets the player walk from the start of the fall until the tree's event ends: `Game_Player.canMove` is aliased and, only inside that call, `Game_Map.isEventRunning` answers false; `Galv.CA.animStatus(true)` is called when the fall starts. Exposes `window.LessGrindHits` (`damage`, `swingsFor`, `bestTier`) |
| HigherDrops | `HigherDrops.js` | Ore rocks and forage give more: a `DROPS` table of template name -> `[min, max]` replaces the `Amount` line on the rock templates (coal 7-31, copper 2-3, iron 3-8, gold 2-4, dense rocks scaled up, rare ores 1-2, plain `Rock` 1-4, `Big Rock` 15-25, weeds from `Grass` 2-6 and `Big Grass` 8-16; forage through CE 865: `Leaf Pile` and `Herb` 2-4, `Bloodberry` and the twelve mushroom templates 1-4; any pickaxe, axe, scythe or hand-picked template can be listed). Never below the game's own amount for a template. Magic crystals and gem nodes untouched |
| CheapKiosk | `CheapKiosk.js` | Mall Kiosk (shop 1) sells every tagged item, weapon and armor for 1 gold, A to Z, key items excluded; in-memory catalogue |
| Espresso | `Espresso.js` | Three drinks in blank item slots 1400 / 1403 / 1404 (Espresso, Double, Triple), Coffee Maker recipes of 4 / 5 / 6 beans cloned from the Cup of Coffee recipe, each with its own appended common event. All reuse state 243; the timer entry gets `espresso: true` and `espressoShots` (1-3). Speeds walk 4.85, run 5.3 / 5.5 / 5.7, bike 5.8 / 6.0 / 6.3 for 24 h. A weaker drink never replaces a running stronger one. `window.EspressoMod` = `{ enabled, itemId, pending }` (`pending` = the shots of the drink being drunk) |
| CoffeeMachines | `CoffeeMachines.js` | **Coffee Machine**: new item in blank slot 1401, placed **as the Coffee Maker object** (placement 160) and marked with `SV: Item` (1286) = its item number, stamped in an alias of `PKD_EPManager.PlaceItemOn`. **Espresso Machine**: the game's own decoration (item 2591, template 317) made to work; any object of that template is adopted (marked) the first time it is used. An alias of `ItemData` swaps in the Keg's `onlyRegions` while a machine is being placed. Five commands are put in front of each template's action page: if the object is a machine, call the mod's appended common event and exit. That event (built from pieces of the game's Coffee Maker page) brews with `SV: Smelter Product / Amount / Time` (107, 108, 106) against V133. Sold through a `Game_Shop.storedGoods` alias for every shop named `General Store` (ids 2 and 14, map 8 `T_Store`). Look: an alias of `Sprite_Character.updateBitmap` gives a placed Espresso Machine that is not on a `placeOverType: table` event a bitmap composed at runtime (Coffee Maker sheet with the Espresso Machine sheet drawn over it; both are 48x128 and the espresso machine covers the coffee machine exactly); the template page's `through` is set to false. The same alias shows a "ready" bubble when `V133 >= SV 106`: the bubble is copied from the Keg's done row (`!$Keg`, 16x48 cells, row for direction 6, pattern 2, rows 12-22) into a sheet with 16 extra rows per cell, in three heights that are swapped every 15 frames. Without the mod the objects are the game's own again |
| StrongerGems | `StrongerGems.js` | Multiplies the `Value` argument of every `WTE_EquipmentUpgradeSystem` Change* command in the gem group events (found through CE 2885), rounds basic stats to whole numbers, leaves a negative basic stat (the Treasure Gem's Max HP loss) alone, and rewrites the numbers in the gem descriptions from the patched commands. Level ranges: in the `Check lv ...` events the constants compared with V1505 are moved out of reach (999999 / -999999) |
| FasterModLoader | `FasterModLoader.js` | Wraps `fs.existsSync`: questions about `mods/<enabled mod>/img|audio/...` are answered from a Set built at start-up, everything else goes to disk. Slow frame log (`mods-slow-frames.log` in the game folder): aliases `SceneManager.updateMain`, `Game_Map.update`, `Spriteset_Map.update`, `ImageManager.loadBitmap` and `Game_Interpreter.executeCommand` to record frame time, the logic / sprite split, picture requests, the slowest event command and the running event chain. **This is the way to see what the game does during a freeze**, since an agent cannot see the console |

Interplay: LessGrind and Espresso both alias `addState` and `realMoveSpeed`. LessGrind leaves speed alone when the
timer entry has `espresso` set (true for all three espresso drinks). A coffee never replaces a running espresso.

## 8. Testing without running the game

`dev-tools\` has everything used. `node dev-tools\run-tests.js ["<game folder>"]` runs the lot; without an argument
it uses the game folder remembered by the manager. Each test takes the game folder as its first argument and reads
the mods from this repository (a second argument points it at another mods folder, e.g. the copies in the game).

- `node dev-tools\simulate_injector.js "<game>"`: builds the injector the way the loader does and syntax-checks it. Shows load order.
- `test_lessgrind.js` (recipes), `test_lessgrind_events.js` (common event and map patches, prints every changed command),
  `test_lessgrind_coffee.js`, `test_lessgrindhits.js` (prints the swings tables for all three tools),
  `test_higherdrops.js`, `test_cheapkiosk.js`, `test_espresso.js`, `test_coffeemachines.js` (has a small event
  interpreter with the engine's branch logic, for running a built event list through every player choice),
  `test_strongergems.js` (prints every gem before and after), `test_fastermodloader.js` (builds a fake game folder
  in the temp directory). `python dev-tools\list_breakables.py` lists every rock, tree and grass template.
  Pattern: load the real JSON, stub the few engine/plugin functions the mod touches (copy their logic from the plugin),
  run the mod with `new Function(source)()`, then diff against the originals and assert nothing else changed.
- `python dev-tools\dump_ce.py <ids...>` (run inside the game folder): readable dump of common events with switch and
  variable names. `dump_mapev.py <MapNNN> "<name regex>"`: same for map events.
- Always `node --check` the plugin. After editing a mod: bump its version, run `elderfield-mods update`, and have
  the game restarted.
- The manager can be exercised safely against a fake game folder: any folder with `js\plugins.js` (containing the
  loader line), `js\plugins\VirtualModLoader.js` and a `mods` folder. Set `ELDERFIELD_MODS_HOME` to a scratch
  folder so its saved settings and backups stay out of the real profile, and pass `--game "<fake folder>"`.

## 9. Tooling gotchas (Claude Code on Windows)

- Bash heredocs lose backslashes (`\\` becomes `\`) and long ones can fail outright. Write scripts with the file
  tool, then run them. Set `PYTHONIOENCODING=utf-8` for Python output.
- Node 22 and Python 3.13 are installed. PowerShell 5.1.
- `plugins.js` has no BOM; write it back as UTF-8 without BOM.
- Never dump raw plugin command arguments to the terminal: some are tens of kilobytes of nested JSON.
- The game must be closed or restarted for any change; the loader reloads itself once when mods changed.
