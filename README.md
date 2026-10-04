# Welcome to Elderfield mod collection

Mods for the Steam game *Welcome to Elderfield*, plus a small mod manager that switches on the
game's built-in mod loader and installs the mods you pick. Windows only.

## Quick start

1. Get this folder: on the [repository page](https://github.com/andersbusk/welcome-to-elderfield-mod-collection) choose **Code**, then **Download ZIP**, and unpack it. Or clone it:

   ```
   git clone https://github.com/andersbusk/welcome-to-elderfield-mod-collection.git
   ```

2. Double-click `elderfield-mods.cmd`. It finds the game in your Steam library, lists the mods and asks which to install.
3. Restart the game.

No setup is needed. The manager is a single `.cmd` file, so PowerShell's script execution setting does not matter.

## Commands

Run these from this folder.

**Command Prompt (cmd)**

```bat
elderfield-mods.cmd install LessGrind
```

```bat
elderfield-mods.cmd disable LessGrind
```

```bat
elderfield-mods.cmd enable LessGrind
```

**PowerShell**

```powershell
.\elderfield-mods.cmd install LessGrind
```

```powershell
.\elderfield-mods.cmd disable LessGrind
```

```powershell
.\elderfield-mods.cmd enable LessGrind
```

Several names can be given at once, and `all` means every mod in this collection.

| Command | What it does |
|---|---|
| `elderfield-mods.cmd` | Interactive menu |
| `status` | Game folder, loader state, and every mod with its state |
| `install <mods>` | Copy mods into the game and switch them on. Switches the mod loader on if needed |
| `enable <mods>` / `disable <mods>` | Switch mods on or off without removing them |
| `uninstall <mods>` | Remove mods from the game |
| `update` | Bring installed mods up to date with this folder |
| `info <mod>` | Describe a mod |
| `loader on` / `loader off` | Switch the game's mod loader. Off means the game runs unmodded |
| `game "<path>"` | Set the game folder by hand if it is not found |

Good to know:

- Restart the game after any change.
- A game update switches the mod loader off again. Run `elderfield-mods.cmd loader on` afterwards.
- The only game file that is changed is one on/off flag in `js\plugins.js`. A copy of that file is kept in `%LOCALAPPDATA%\ElderfieldMods\backups` each time.
- Back up your `save` folder before playing with mods.

## The mods

Each mod has its own README with the full details.

| Mod | What it does |
|---|---|
| [`LessGrind`](mods/LessGrind/README.md) | Tool upgrades need 1 of each material. Cheap Greater Offering of Rain and Preserving Barrel. Barrel, Keg and Cask finish in a day. Cheaper, bigger trough upgrades. Coffee lasts 24 hours and is a little faster |
| [`LessGrindHits`](mods/LessGrindHits/README.md) | Fewer swings for pickaxe, axe and scythe. Stone breaks in one hit, nothing takes more than 6 |
| [`HigherDrops`](mods/HigherDrops/README.md) | Ore rocks and stone drop more pieces: coal nearly doubled, copper a bit more, iron as much as coal used to give, stone 1-4, big rocks 15-25 |
| [`CheapKiosk`](mods/CheapKiosk/README.md) | The Eldritch Slime shopkeeper in the mall sells every item for 1 gold |
| [`Espresso`](mods/Espresso/README.md) | A new drink from the Coffee Maker with a stronger speed boost than coffee |

Every number is in a `CONFIG` block at the top of the mod's `.js` file. Edit it here, then run `elderfield-mods.cmd update`.

## Making mods

[docs/MODDING_MAP.md](docs/MODDING_MAP.md) describes how the game and its mod loader work and how these mods are built.

[docs/ItemList.csv](docs/ItemList.csv) lists every item, weapon and armor with its ID, for use in the mods' settings.

To work on a mod without reinstalling after every edit, link the game to this folder instead of copying:

```bat
elderfield-mods.cmd link all
```

`dev-tools` has offline tests that run against your own copy of the game:

```
node dev-tools/run-tests.js
```
