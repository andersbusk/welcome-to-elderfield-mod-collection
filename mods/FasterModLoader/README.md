# FasterModLoader

Removes a slowdown that the game's mod loader adds, and that grows with every mod you enable.

## The problem

With the mod loader switched on, the game looks in every mod folder on disk for each picture and each sound it loads, in case a mod replaces it. That is one disk check per mod folder, per request.

One request is cheap: about 0.2 milliseconds with seven mods. But parts of the game ask for thousands of pictures in one go, for example when it redraws a map's scenery, and then the checks add up to a visible stall.

## What this mod does

It reads the mod folders once when the game starts, remembers which pictures and sounds they really contain, and answers the loader's checks from that list.

| | Without | With FasterModLoader |
|---|---|---|
| One picture request, seven mods | about 0.16 ms | about 0.006 ms |

A mod that does replace a picture or a sound keeps working as before. Files you add to a mod's `img` or `audio` folder are picked up on the next game start, which the loader needs anyway.

## The slow frame log

Whenever a frame takes longer than 0.12 seconds (below about 8 frames per second), one line is written to `mods-slow-frames.log` in the game folder: how long it took, how much of that was map logic and how much was drawing, how many pictures were requested, the slowest single event command, and which events were running.

It is there to find out what causes a freeze. It costs nothing noticeable, and it stops after 200 lines per game session.

## Settings

`CONFIG` at the top of `js/plugins/FasterModLoader.js`:

- `FAST_ASSET_CHECKS`: `false` leaves the mod loader's disk checks as they are.
- `LOG_SLOW_FRAMES`: `false` switches the log off. `SLOW_FRAME_MS` is the threshold.

## How it works

The mod loader calls Node's `fs.existsSync` for `mods/<mod>/img/...` and `mods/<mod>/audio/...`. This mod wraps that one function: questions about those two folders of an enabled mod are answered from the list, and every other question goes to the disk exactly as before.

## Your save

Nothing is stored in the save.
