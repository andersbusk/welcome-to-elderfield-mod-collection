/*:
 * @target MZ
 * @plugindesc [FasterModLoader] Makes the mod loader's search for replacement pictures and sounds instant, and logs frames that freeze.
 * @author Anders
 *
 * @help
 * ============================================================================
 * FasterModLoader.js
 * ============================================================================
 * With the game's mod loader switched on, every picture and every sound the
 * game asks for is first looked up on disk in every mod folder, in case a mod
 * replaces it. That is one disk check per mod folder per request. Parts of the
 * game ask for thousands of pictures in one go (for example when it redraws a
 * map's scenery after something on it changed), and then those checks add up.
 * The more mods, the longer.
 *
 * This mod looks through the mod folders once when the game starts, remembers
 * which pictures and sounds they really contain, and answers the loader's
 * checks from that list. A mod that does replace a picture or a sound keeps
 * working exactly as before.
 *
 * It also writes a line to a small log file in the game folder whenever a
 * frame takes very long, with what the game was doing at that moment. That is
 * only there to track down freezes; switch it off in CONFIG if you like.
 *
 * Nothing is saved in your save file.
 */

(() => {
    "use strict";
    const TAG = "[FasterModLoader]";

    // ========================================================================
    // CONFIG
    // ========================================================================
    // true: answer the mod loader's checks from a list made at start-up.
    const FAST_ASSET_CHECKS = true;

    // true: frames that take longer than SLOW_FRAME_MS are written to LOG_FILE
    // in the game folder (at most LOG_MAX_LINES lines per game session).
    const LOG_SLOW_FRAMES = true;
    const SLOW_FRAME_MS = 120;
    const LOG_FILE = "mods-slow-frames.log";
    const LOG_MAX_LINES = 200;
    // ========================================================================
    // END CONFIG
    // ========================================================================

    if (typeof require !== "function" || typeof process === "undefined") {
        console.warn(TAG + " Not running in the desktop game (no file access). Mod did nothing.");
        return;
    }
    const fs = require("fs");
    const path = require("path");
    const stats = window.FasterModLoader = { files: 0, indexed: 0, real: 0, pictures: 0, pictureMs: 0 };

    // The mods folder, found the way the mod loader finds it.
    let baseDir = path.dirname(process.mainModule.filename);
    let modsDir = path.join(baseDir, "mods");
    if (!fs.existsSync(modsDir)) {
        const execDir = path.dirname(process.execPath);
        if (fs.existsSync(path.join(execDir, "mods"))) {
            baseDir = execDir;
            modsDir = path.join(baseDir, "mods");
        }
    }

    // ------------------------------------------------------------------------
    // Every picture and sound the mod folders contain: "<mod>\img\...\name.png", lower case.
    // ------------------------------------------------------------------------
    const ASSET_FOLDERS = ["img", "audio"];
    const index = new Set();
    const mods = new Set();                 // the mod folders that were looked through
    const walk = (dir, relative) => {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name), rel = relative + path.sep + name;
            if (fs.statSync(full).isDirectory()) walk(full, rel);
            else index.add(rel.toLowerCase());
        }
    };
    let indexed = false;
    try {
        for (const folder of fs.readdirSync(modsDir)) {
            if (folder.startsWith("!") || !fs.statSync(path.join(modsDir, folder)).isDirectory()) continue;
            mods.add(folder.toLowerCase());
            for (const assets of ASSET_FOLDERS) {
                const dir = path.join(modsDir, folder, assets);
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) walk(dir, folder + path.sep + assets);
            }
        }
        indexed = true;
        stats.files = index.size;
    } catch (e) {
        console.warn(TAG + " Could not read the mods folder (" + e.message + "); the loader's checks stay as they are.");
    }

    // ------------------------------------------------------------------------
    // The loader asks fs.existsSync("<mods>\<mod>\img\...") once per mod per request.
    // Answer exactly those questions from the list; everything else goes to the disk as before.
    // ------------------------------------------------------------------------
    if (FAST_ASSET_CHECKS && indexed) {
        const prefix = (modsDir + path.sep).toLowerCase();
        const assetStarts = ASSET_FOLDERS.map(name => name + path.sep);
        const realExistsSync = fs.existsSync;
        fs.existsSync = function(target) {
            if (typeof target === "string" && target.length > prefix.length) {
                const lower = target.toLowerCase();
                if (lower.startsWith(prefix)) {
                    const rest = lower.slice(prefix.length);                 // "<mod>\img\characters\name.png"
                    const cut = rest.indexOf(path.sep);
                    if (cut > 0 && mods.has(rest.slice(0, cut)) && assetStarts.some(start => rest.startsWith(start, cut + 1))) {
                        stats.indexed++;
                        return index.has(rest);
                    }
                }
            }
            stats.real++;
            return realExistsSync.apply(this, arguments);
        };
    }

    // ------------------------------------------------------------------------
    // Slow frame log: how long the frame took, where the time went, and what was running.
    // ------------------------------------------------------------------------
    if (LOG_SLOW_FRAMES && typeof SceneManager !== "undefined" && typeof performance !== "undefined") {
        const logPath = path.join(baseDir, LOG_FILE);
        let lines = 0;
        const frame = { logic: 0, sprites: 0, slowest: 0, slowestWhat: "" };
        const timed = (owner, name, key) => {
            if (!owner || typeof owner[name] !== "function") return;
            const original = owner[name];
            owner[name] = function() {
                const start = performance.now();
                try { return original.apply(this, arguments); } finally { frame[key] += performance.now() - start; }
            };
        };

        if (typeof ImageManager !== "undefined") {
            const _ImageManager_loadBitmap = ImageManager.loadBitmap;
            ImageManager.loadBitmap = function() {
                const start = performance.now();
                try {
                    return _ImageManager_loadBitmap.apply(this, arguments);
                } finally {
                    stats.pictures++;
                    stats.pictureMs += performance.now() - start;
                }
            };
        }
        if (typeof Game_Map !== "undefined") timed(Game_Map.prototype, "update", "logic");
        if (typeof Spriteset_Map !== "undefined") timed(Spriteset_Map.prototype, "update", "sprites");

        // Which event list an interpreter is running.
        const owner = (interp) => {
            try {
                const common = $dataCommonEvents.find(ev => ev && ev.list === interp._list);
                return common ? "CE " + common.id + " " + common.name : "event " + interp._eventId;
            } catch (e) {
                return "?";
            }
        };
        const running = () => {
            const names = [];
            for (let i = typeof $gameMap !== "undefined" && $gameMap ? $gameMap._interpreter : null; i && i._list; i = i._childInterpreter) names.push(owner(i));
            return names.join(" > ") || "nothing";
        };

        // The single event command that took longest this frame.
        if (typeof Game_Interpreter !== "undefined") {
            const _Game_Interpreter_executeCommand = Game_Interpreter.prototype.executeCommand;
            Game_Interpreter.prototype.executeCommand = function() {
                const command = this._list ? this._list[this._index] : null;
                const start = performance.now();
                const result = _Game_Interpreter_executeCommand.apply(this, arguments);
                const took = performance.now() - start;
                if (took > frame.slowest && command) {
                    frame.slowest = took;
                    let detail = "";
                    try { detail = JSON.stringify(command.parameters).slice(0, 160); } catch (e) { detail = "?"; }
                    frame.slowestWhat = "command " + command.code + " " + detail;
                }
                return result;
            };
        }

        const _SceneManager_updateMain = SceneManager.updateMain;
        SceneManager.updateMain = function() {
            const start = performance.now();
            const before = { pictures: stats.pictures, pictureMs: stats.pictureMs, indexed: stats.indexed, real: stats.real };
            frame.logic = 0; frame.sprites = 0; frame.slowest = 0; frame.slowestWhat = "";
            let eventBefore = "";
            try { eventBefore = running(); } catch (e) { eventBefore = "?"; }
            const result = _SceneManager_updateMain.apply(this, arguments);
            const took = performance.now() - start;
            if (took >= SLOW_FRAME_MS && lines < LOG_MAX_LINES) {
                lines++;
                try {
                    const scene = this._scene && this._scene.constructor ? this._scene.constructor.name : "?";
                    const map = typeof $gameMap !== "undefined" && $gameMap && $gameMap.mapId ? $gameMap.mapId() : 0;
                    fs.appendFileSync(logPath, [
                        new Date().toISOString(),
                        Math.round(took) + " ms",
                        scene + " map " + map,
                        "scenery baker: " + ((typeof $gameMap !== "undefined" && $gameMap && $gameMap._wteBakeState) || "-"),
                        "map logic " + Math.round(frame.logic) + " ms, sprites " + Math.round(frame.sprites) + " ms",
                        "pictures asked for: " + (stats.pictures - before.pictures) + " (" + Math.round(stats.pictureMs - before.pictureMs) + " ms)",
                        "mod folder checks: " + (stats.indexed - before.indexed) + " from the list, " + (stats.real - before.real) + " on disk",
                        "slowest event command: " + Math.round(frame.slowest) + " ms " + frame.slowestWhat,
                        "running before: " + eventBefore,
                        "running after: " + running()
                    ].join(" | ") + "\n");
                } catch (e) {
                    lines = LOG_MAX_LINES;      // cannot write: stop trying
                }
            }
            return result;
        };
    }

    console.log(TAG + " Loaded. " + index.size + " replacement pictures and sounds found in " + modsDir + ".");
})();
