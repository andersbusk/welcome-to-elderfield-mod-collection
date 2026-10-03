<# : Welcome to Elderfield mod manager. Batch bootstrap; the program below is PowerShell.
@echo off
setlocal
set "EMM_SELF=%~f0"
set "EMM_ARGS=%*"
powershell.exe -NoLogo -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:EMM_SELF)))"
set "EMM_EXIT=%errorlevel%"
endlocal & exit /b %EMM_EXIT%
#>

# =============================================================================
# Welcome to Elderfield mod manager
#
# This file is both a .cmd and a PowerShell program. The batch lines above hand
# the file's own text to PowerShell as a command, so no .ps1 file is ever run
# and the script execution policy does not matter. Works on Windows PowerShell 5.1.
#
#   elderfield-mods                      interactive menu
#   elderfield-mods status               game folder, loader state, mods
#   elderfield-mods install <mod|all>    copy mod(s) into the game and switch them on
#   elderfield-mods enable  <mod|all>    switch mod(s) on
#   elderfield-mods disable <mod|all>    switch mod(s) off (kept in the game, renamed !Mod)
#   elderfield-mods uninstall <mod|all>  remove mod(s) from the game
#   elderfield-mods update               bring installed mods up to date with this folder
#   elderfield-mods link <mod|all>       for mod authors: link the game to the mod folders here
#                                        instead of copying, so edits apply without reinstalling
#   elderfield-mods info <mod>           describe a mod
#   elderfield-mods loader on|off        switch the game's mod loader
#   elderfield-mods game ["<path>"]      show or set the game folder
#   Option for any command:  --game "<path>"   use this game folder just this once
# =============================================================================

$ErrorActionPreference = 'Stop'
$EmmVersion  = '1.1.0'
$SelfPath    = $env:EMM_SELF
$RepoRoot    = Split-Path -Parent $SelfPath
$ModsSource  = Join-Path $RepoRoot 'mods'
$HomeDir     = if ($env:ELDERFIELD_MODS_HOME) { $env:ELDERFIELD_MODS_HOME } else { Join-Path $env:LOCALAPPDATA 'ElderfieldMods' }
$ConfigFile  = Join-Path $HomeDir 'config.json'
$BackupDir   = Join-Path $HomeDir 'backups'
$Utf8NoBom   = New-Object System.Text.UTF8Encoding($false)
$Latin1      = [System.Text.Encoding]::GetEncoding(28591)   # byte-exact round trip for the game's plugin list
$LoaderOff   = '"name":"VirtualModLoader","status":false'
$LoaderOn    = '"name":"VirtualModLoader","status":true'
$SampleMod   = 'Example_Mod'                                 # developer sample; overrides the home map when active
$script:Changed = $false

# ----------------------------------------------------------------------------- output
function Say([string]$text, [string]$color) {
    if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
}
function Ok([string]$t)   { Say $t 'Green' }
function Warn([string]$t) { Say $t 'Yellow' }
function Fail([string]$t) { Say $t 'Red' }

# ----------------------------------------------------------------------------- arguments
function Split-CommandLine([string]$raw) {
    $out = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        foreach ($m in [regex]::Matches($raw, '"([^"]*)"|(\S+)')) {
            if ($m.Groups[1].Success) { $out.Add($m.Groups[1].Value) } else { $out.Add($m.Groups[2].Value) }
        }
    }
    return $out
}

# ----------------------------------------------------------------------------- game folder
# Test-Path that never throws: a Steam library can sit on a drive that is not connected.
function Test-Exists([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }
    try { return [bool](Test-Path -LiteralPath $path -ErrorAction Stop) } catch { return $false }
}

function Test-GameFolder([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }
    try {
        return (Test-Exists (Join-Path $path 'js\plugins.js')) -and
               (Test-Exists (Join-Path $path 'js\plugins\VirtualModLoader.js'))
    } catch { return $false }
}

function Get-SavedGamePath {
    if (Test-Exists $ConfigFile) {
        try { return (Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json).gamePath } catch { }
    }
    return $null
}

function Save-GamePath([string]$path) {
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    [IO.File]::WriteAllText($ConfigFile, (@{ gamePath = $path } | ConvertTo-Json), $Utf8NoBom)
}

function Find-SteamInstalls {
    $roots = @()
    foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
        try {
            $props = Get-ItemProperty -Path $key -ErrorAction Stop
            foreach ($name in 'SteamPath', 'InstallPath') {
                if ($props.PSObject.Properties[$name] -and $props.$name) { $roots += ($props.$name -replace '/', '\') }
            }
        } catch { }
    }
    $libraries = @()
    foreach ($root in @($roots | Select-Object -Unique)) {
        $libraries += $root
        $vdf = $null
        try { $vdf = Join-Path $root 'steamapps\libraryfolders.vdf' } catch { continue }
        if (Test-Exists $vdf) {
            foreach ($line in @(Get-Content -LiteralPath $vdf -ErrorAction SilentlyContinue)) {
                if ($line -match '^\s*"path"\s+"(.+)"\s*$') { $libraries += ($Matches[1] -replace '\\\\', '\') }
            }
        }
    }
    $found = @()
    foreach ($lib in @($libraries | Select-Object -Unique)) {
        $common = $null
        try { $common = Join-Path $lib 'steamapps\common' } catch { continue }
        if (-not (Test-Exists $common)) { continue }
        foreach ($dir in @(Get-ChildItem -LiteralPath $common -Directory -ErrorAction SilentlyContinue)) {
            if ($dir.Name -like 'Welcome to Elderfield*' -and (Test-GameFolder $dir.FullName)) { $found += $dir.FullName }
        }
    }
    return @($found | Select-Object -Unique)
}

function Read-GamePathFromUser {
    while ($true) {
        Say ''
        Say 'Paste the path of the game folder (the one that contains Game.exe), or press Enter to cancel:'
        $answer = (Read-Host '>').Trim().Trim('"')
        if (-not $answer) { return $null }
        if (Test-GameFolder $answer) { return (Resolve-Path -LiteralPath $answer).Path }
        Fail 'That folder does not look like Welcome to Elderfield (js\plugins.js and its mod loader were not found).'
    }
}

function Resolve-Game([string]$explicit, [bool]$interactive) {
    if ($explicit) {
        if (-not (Test-GameFolder $explicit)) { throw "Not a Welcome to Elderfield game folder: $explicit" }
        return (Resolve-Path -LiteralPath $explicit).Path
    }
    if ($env:ELDERFIELD_GAME -and (Test-GameFolder $env:ELDERFIELD_GAME)) { return $env:ELDERFIELD_GAME }
    $saved = Get-SavedGamePath
    if ($saved -and (Test-GameFolder $saved)) { return $saved }

    $found = @(Find-SteamInstalls)
    $choice = $null
    if ($found.Count -eq 1) {
        $choice = $found[0]
    } elseif ($found.Count -gt 1) {
        if ($interactive) {
            Say 'More than one installation was found:'
            for ($i = 0; $i -lt $found.Count; $i++) { Say ('  {0}  {1}' -f ($i + 1), $found[$i]) }
            $n = 0
            while (-not ([int]::TryParse((Read-Host 'Which one? (number)'), [ref]$n) -and $n -ge 1 -and $n -le $found.Count)) { }
            $choice = $found[$n - 1]
        } else {
            $choice = @($found | Where-Object { $_ -like '*Full Game*' })[0]
            if (-not $choice) { $choice = $found[0] }
        }
    } elseif ($interactive) {
        Warn 'The game was not found in your Steam libraries.'
        $choice = Read-GamePathFromUser
    }
    if (-not $choice) { throw 'Game folder not found. Set it with:  elderfield-mods game "<path to the game folder>"' }
    Save-GamePath $choice
    return $choice
}

function Test-GameRunning([string]$game) {
    foreach ($p in @(Get-Process -Name 'Game' -ErrorAction SilentlyContinue)) {
        try { if ($p.Path -and $p.Path.StartsWith($game, [StringComparison]::OrdinalIgnoreCase)) { return $true } } catch { }
    }
    return $false
}

# ----------------------------------------------------------------------------- mod loader
function Get-LoaderState([string]$game) {
    $text = [IO.File]::ReadAllText((Join-Path $game 'js\plugins.js'), $Latin1)
    if ($text.Contains($LoaderOn))  { return 'on' }
    if ($text.Contains($LoaderOff)) { return 'off' }
    return 'unknown'
}

function Set-Loader([string]$game, [bool]$on) {
    $file = Join-Path $game 'js\plugins.js'
    $text = [IO.File]::ReadAllText($file, $Latin1)
    $from = if ($on) { $LoaderOff } else { $LoaderOn }
    $to   = if ($on) { $LoaderOn }  else { $LoaderOff }
    if ($text.Contains($to)) { return $false }
    if (-not $text.Contains($from)) {
        throw 'The mod loader entry was not found in js\plugins.js. A game update may have changed it. Nothing was modified.'
    }
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    Copy-Item -LiteralPath $file -Destination (Join-Path $BackupDir ('plugins.js.' + (Get-Date -Format 'yyyyMMdd_HHmmss')))
    [IO.File]::WriteAllText($file, $text.Replace($from, $to), $Latin1)
    $script:Changed = $true
    return $true
}

function Disable-SampleMod([string]$game) {
    $dir = Join-Path $game 'mods'
    $sample = Join-Path $dir $SampleMod
    if (-not (Test-Path -LiteralPath $sample)) { return }
    $newName = '!' + $SampleMod
    if (Test-Path -LiteralPath (Join-Path $dir $newName)) { $newName = '!' + $SampleMod + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') }
    Rename-Item -LiteralPath $sample -NewName $newName
    $script:Changed = $true
    Warn "Switched off the developer's sample mod ($SampleMod). It replaces parts of the home map when active."
}

function Enable-LoaderIfNeeded([string]$game) {
    $state = Get-LoaderState $game
    if ($state -eq 'off') {
        Set-Loader $game $true | Out-Null
        Ok "Mod loader switched on (a copy of the game's plugin list was saved in $BackupDir)."
    } elseif ($state -ne 'on') {
        Warn 'The mod loader entry was not found in js\plugins.js, so it could not be switched on. Mods will not load.'
    }
    Disable-SampleMod $game
}

# ----------------------------------------------------------------------------- mods
function Read-ModMeta([string]$folder) {
    $file = Join-Path $folder 'mod.json'
    if (Test-Path -LiteralPath $file) {
        try { return (Get-Content -Raw -LiteralPath $file | ConvertFrom-Json) } catch { }
    }
    return $null
}

function Get-MetaValue($meta, [string]$name, [string]$fallback) {
    if ($meta -and $meta.PSObject.Properties[$name] -and $meta.$name) { return [string]$meta.$name }
    return $fallback
}

function Test-SameContent([string]$source, [string]$target) {
    foreach ($file in @(Get-ChildItem -LiteralPath $source -Recurse -File)) {
        $relative = $file.FullName.Substring($source.Length).TrimStart('\')
        $other = Join-Path $target $relative
        if (-not (Test-Path -LiteralPath $other)) { return $false }
        $a = [IO.File]::ReadAllText($file.FullName, $Latin1) -replace "`r`n", "`n"
        $b = [IO.File]::ReadAllText($other, $Latin1) -replace "`r`n", "`n"
        if ($a -cne $b) { return $false }
    }
    return $true
}

# One row per mod: everything in this collection, plus anything else found in the game's mods folder.
function Get-ModRows([string]$game) {
    $gameMods = Join-Path $game 'mods'
    $rows = @()
    $known = @{}
    if (Test-Path -LiteralPath $ModsSource) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $ModsSource -Directory | Sort-Object Name)) {
            $meta = Read-ModMeta $dir.FullName
            if (-not $meta) { continue }
            $known[$dir.Name.ToLowerInvariant()] = $true
            $on  = Join-Path $gameMods $dir.Name
            $off = Join-Path $gameMods ('!' + $dir.Name)
            $state = 'not installed'; $installed = $null
            if (Test-Path -LiteralPath $on)      { $state = 'enabled';  $installed = $on }
            elseif (Test-Path -LiteralPath $off) { $state = 'disabled'; $installed = $off }
            $installedVersion = ''; $note = ''; $linked = $false
            if ($installed) {
                $installedVersion = Get-MetaValue (Read-ModMeta $installed) 'version' '?'
                $latest = Get-MetaValue $meta 'version' '?'
                if (Test-IsLink $installed) {
                    $linked = $true
                    if (Test-LinkPointsTo $installed $dir.FullName) { $note = 'linked to this folder' } else { $note = 'linked to another folder' }
                }
                elseif ($installedVersion -ne $latest) { $note = 'update available' }
                elseif (-not (Test-SameContent $dir.FullName $installed)) { $note = 'differs from this collection' }
            }
            $rows += [pscustomobject]@{
                Id = $dir.Name; Title = (Get-MetaValue $meta 'name' $dir.Name); Latest = (Get-MetaValue $meta 'version' '?')
                Installed = $installedVersion; State = $state; Note = $note; Source = $dir.FullName
                InstalledPath = $installed; Collection = $true; Linked = $linked; Description = (Get-MetaValue $meta 'description' '')
            }
        }
    }
    if (Test-Path -LiteralPath $gameMods) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $gameMods -Directory | Sort-Object Name)) {
            $id = $dir.Name.TrimStart('!')
            if ($known.ContainsKey($id.ToLowerInvariant())) { continue }
            $meta = Read-ModMeta $dir.FullName
            $note = 'not part of this collection'
            if ($id -like ($SampleMod + '*')) { $note = "developer sample, keep it off" }
            $state = if ($dir.Name.StartsWith('!')) { 'disabled' } else { 'enabled' }
            $rows += [pscustomobject]@{
                Id = $id; Title = (Get-MetaValue $meta 'name' $id); Latest = ''
                Installed = (Get-MetaValue $meta 'version' ''); State = $state; Note = $note; Source = $null
                InstalledPath = $dir.FullName; Collection = $false; Linked = (Test-IsLink $dir.FullName); Description = (Get-MetaValue $meta 'description' '')
            }
        }
    }
    return $rows
}

function Test-IsLink([string]$path) {
    try { return [bool]((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) } catch { return $false }
}

function Test-LinkPointsTo([string]$link, [string]$folder) {
    try {
        $target = [string]@((Get-Item -LiteralPath $link -Force).Target)[0]
        if (-not $target) { return $false }
        if ($target.StartsWith('\??\')) { $target = $target.Substring(4) }
        $a = [IO.Path]::GetFullPath($target).TrimEnd('\')
        $b = [IO.Path]::GetFullPath($folder).TrimEnd('\')
        return $a.Equals($b, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

# Deletes a folder without ever following a link. A linked folder is removed as a link only;
# what it points to is left alone. (Remove-Item -Recurse can delete through a link.)
function Remove-Tree([string]$path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $false) } else { [IO.File]::Delete($item.FullName) }
        return
    }
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
        if ($child.PSIsContainer) { Remove-Tree $child.FullName }
        else {
            if ($child.Attributes -band [IO.FileAttributes]::ReadOnly) { $child.Attributes = [IO.FileAttributes]::Normal }
            [IO.File]::Delete($child.FullName)
        }
    }
    [IO.Directory]::Delete($item.FullName, $false)
}

function Remove-ModFolder([string]$game, [string]$path) {
    # Only ever delete a folder that sits directly inside <game>\mods.
    $root = [IO.Path]::GetFullPath((Join-Path $game 'mods')).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $full.Length -le $root.Length -or
        $full.Substring($root.Length).Contains('\')) {
        throw "Refusing to delete outside the game's mods folder: $full"
    }
    Remove-Tree $full
}

function Install-Mod([string]$game, $row, [bool]$keepDisabled, [bool]$asLink) {
    if (-not $row.Collection) { throw "$($row.Id) is not part of this collection, so there is nothing to install it from." }
    $gameMods = Join-Path $game 'mods'
    New-Item -ItemType Directory -Force -Path $gameMods | Out-Null
    foreach ($name in $row.Id, ('!' + $row.Id)) {
        $existing = Join-Path $gameMods $name
        if (Test-Path -LiteralPath $existing) { Remove-ModFolder $game $existing }
    }
    $targetName = if ($keepDisabled) { '!' + $row.Id } else { $row.Id }
    $target = Join-Path $gameMods $targetName
    if ($asLink) {
        # A junction: needs no administrator rights and works across drives.
        New-Item -ItemType Junction -Path ([WildcardPattern]::Escape($target)) -Target $row.Source | Out-Null
    } else {
        Copy-Item -LiteralPath $row.Source -Destination $target -Recurse
    }
    $script:Changed = $true
}

function Set-ModEnabled([string]$game, $row, [bool]$enable) {
    $gameMods = Join-Path $game 'mods'
    $on  = Join-Path $gameMods $row.Id
    $off = Join-Path $gameMods ('!' + $row.Id)
    if ($enable) {
        if (Test-Path -LiteralPath $on) { return $false }
        if (-not (Test-Path -LiteralPath $off)) { throw "$($row.Id) is not installed." }
        Rename-Item -LiteralPath $off -NewName $row.Id
    } else {
        if (-not (Test-Path -LiteralPath $on)) { return $false }
        if (Test-Path -LiteralPath $off) { Remove-ModFolder $game $off }
        Rename-Item -LiteralPath $on -NewName ('!' + $row.Id)
    }
    $script:Changed = $true
    return $true
}

# Turn names / numbers / "all" into rows. Numbers refer to the table as last shown.
function Select-Rows($rows, $names, [bool]$collectionOnly) {
    $rows = @($rows)
    $picked = New-Object System.Collections.Generic.List[object]
    foreach ($name in @($names)) {
        if ($name -ieq 'all') {
            foreach ($r in @($rows | Where-Object { $_.Collection })) { if (-not $picked.Contains($r)) { $picked.Add($r) } }
            continue
        }
        $n = 0
        $match = $null
        if ([int]::TryParse($name, [ref]$n)) {
            if ($n -ge 1 -and $n -le $rows.Count) { $match = $rows[$n - 1] }
        } else {
            $match = @($rows | Where-Object { $_.Id -ieq $name -or ('!' + $_.Id) -ieq $name })[0]
        }
        if (-not $match) { throw "Unknown mod: $name. Run 'elderfield-mods status' to see the names." }
        if ($collectionOnly -and -not $match.Collection) { throw "$($match.Id) is not part of this collection." }
        if (-not $picked.Contains($match)) { $picked.Add($match) }
    }
    return $picked
}

# ----------------------------------------------------------------------------- actions (shared by menu and commands)
function Invoke-Install([string]$game, $rows) {
    foreach ($row in @($rows)) {
        Install-Mod $game $row $false $false
        Ok ("Installed {0} {1}" -f $row.Id, $row.Latest)
    }
    if (@($rows).Count -gt 0) { Enable-LoaderIfNeeded $game }
}

# For mod authors: the game folder points at the mod folder here, so edits apply on the next game start.
function Invoke-Link([string]$game, $rows) {
    foreach ($row in @($rows)) {
        Install-Mod $game $row ($row.State -eq 'disabled') $true
        Ok ("Linked {0} -> {1}" -f $row.Id, $row.Source)
    }
    if (@($rows).Count -gt 0) { Enable-LoaderIfNeeded $game }
}

function Invoke-Enable([string]$game, $rows) {
    foreach ($row in @($rows)) {
        if ($row.State -eq 'not installed') {
            Install-Mod $game $row $false $false
            Ok ("Installed {0} {1}" -f $row.Id, $row.Latest)
        } elseif (Set-ModEnabled $game $row $true) { Ok "Enabled $($row.Id)" }
        else { Say "$($row.Id) is already enabled." }
    }
    if (@($rows).Count -gt 0) { Enable-LoaderIfNeeded $game }
}

function Invoke-Disable([string]$game, $rows) {
    foreach ($row in @($rows)) {
        if ($row.State -eq 'not installed') { Say "$($row.Id) is not installed." }
        elseif (Set-ModEnabled $game $row $false) { Ok "Disabled $($row.Id)" }
        else { Say "$($row.Id) is already disabled." }
    }
}

function Invoke-Uninstall([string]$game, $rows) {
    foreach ($row in @($rows)) {
        if (-not $row.InstalledPath) { Say "$($row.Id) is not installed."; continue }
        Remove-ModFolder $game $row.InstalledPath
        $script:Changed = $true
        Ok "Uninstalled $($row.Id)"
    }
}

function Invoke-Update([string]$game, $rows) {
    $todo = @($rows | Where-Object { $_.Collection -and $_.InstalledPath -and $_.Note -and -not $_.Linked })
    if ($todo.Count -eq 0) { Say 'Every installed mod already matches this collection (linked mods always do).'; return }
    foreach ($row in $todo) {
        Install-Mod $game $row ($row.State -eq 'disabled') $false
        Ok ("Updated {0} to {1}" -f $row.Id, $row.Latest)
    }
}

# ----------------------------------------------------------------------------- display
function Show-Header([string]$game) {
    $loader = Get-LoaderState $game
    Say ''
    Say "Welcome to Elderfield mod manager $EmmVersion" 'Cyan'
    Say "Game:    $game"
    switch ($loader) {
        'on'      { Say 'Loader:  on' 'Green' }
        'off'     { Say 'Loader:  OFF  (mods do nothing until it is on; installing or enabling a mod switches it on)' 'Yellow' }
        default   { Say 'Loader:  not found in js\plugins.js (unsupported game version?)' 'Red' }
    }
}

function Show-Table($rows) {
    $rows = @($rows)
    Say ''
    Say ('  {0,2}  {1,-16} {2,-10} {3,-10} {4}' -f '#', 'Mod', 'Installed', 'Latest', 'State') 'DarkGray'
    for ($i = 0; $i -lt $rows.Count; $i++) {
        $r = $rows[$i]
        $state = $r.State
        if ($r.Note) { $state = "$state  ($($r.Note))" }
        $color = 'Gray'
        if ($r.State -eq 'enabled') { $color = 'Green' } elseif ($r.State -eq 'disabled') { $color = 'Yellow' }
        if (-not $r.Collection) { $color = 'DarkGray' }
        $installed = if ($r.Installed) { $r.Installed } else { '-' }
        $latest = if ($r.Latest) { $r.Latest } else { '-' }
        Say ('  {0,2}  {1,-16} {2,-10} {3,-10} {4}' -f ($i + 1), $r.Id, $installed, $latest, $state) $color
    }
    if ($rows.Count -eq 0) { Say '  (no mods found)' }
}

function Show-Info($row) {
    Say ''
    Say $row.Title 'Cyan'
    Say ("Folder: {0}    Version: {1}    State: {2}" -f $row.Id, $(if ($row.Latest) { $row.Latest } else { $row.Installed }), $row.State)
    if ($row.Description) { Say $row.Description }
}

function Show-Help {
    Say ''
    Say 'Usage:  elderfield-mods [command] [mods...] [--game "<path>"]'
    Say ''
    Say '  (no command)            interactive menu'
    Say '  status                  show the game folder, loader state and mods'
    Say '  install <mod...|all>    copy mod(s) into the game and switch them on'
    Say '  enable  <mod...|all>    switch mod(s) on'
    Say '  disable <mod...|all>    switch mod(s) off, keeping them in the game'
    Say '  uninstall <mod...|all>  remove mod(s) from the game'
    Say '  update                  bring installed mods up to date with this folder'
    Say '  link <mod...|all>       link the game to the mod folders here instead of copying (for mod authors)'
    Say '  info <mod>              describe a mod'
    Say '  loader on|off           switch the game''s mod loader'
    Say '  game ["<path>"]         show or set the game folder'
    Say ''
    Say 'Restart the game after any change. Run "loader on" again after a game update.'
}

function Show-RestartHint([string]$game) {
    if (-not $script:Changed) { return }
    if (Test-GameRunning $game) { Warn 'The game is running. Restart it for the changes to take effect.' }
    else { Say 'Changes apply the next time the game starts.' }
}

# ----------------------------------------------------------------------------- interactive menu
function Start-Menu([string]$game) {
    $first = $true
    while ($true) {
        Show-Header $game
        $rows = @(Get-ModRows $game)
        Show-Table $rows

        if ($first) {
            $first = $false
            $nothingInstalled = @($rows | Where-Object { $_.Collection -and $_.InstalledPath }).Count -eq 0
            if ($nothingInstalled -and @($rows | Where-Object { $_.Collection }).Count -gt 0) {
                Say ''
                Say 'No mods from this collection are installed yet.'
                Say "Type the numbers of the mods to install, separated by spaces, or 'all'. Press Enter to skip."
                $answer = (Read-Host 'Install').Trim()
                if ($answer) {
                    try { Invoke-Install $game (Select-Rows $rows (Split-CommandLine $answer) $true) } catch { Fail $_.Exception.Message }
                    continue
                }
            }
        }

        Say ''
        Say '  i <mods>  install / reinstall     e <mods>  enable      d <mods>  disable     u <mods>  uninstall' 'DarkGray'
        Say '  a  install all    up  update installed    l  loader on/off    ? <mod>  describe    g  game folder    q  quit' 'DarkGray'
        Say '  ln <mods>  link instead of copy (for mod authors)' 'DarkGray'
        Say "  <mods> = numbers or names, e.g.  i 1 3   or   d all" 'DarkGray'
        $line = (Read-Host '>')
        if ($null -eq $line) { break }
        $parts = @(Split-CommandLine $line.Trim())
        if ($parts.Count -eq 0) { continue }
        $cmd = $parts[0].ToLowerInvariant()
        $rest = @($parts | Select-Object -Skip 1)
        try {
            switch -Regex ($cmd) {
                '^(q|quit|exit)$'    { Show-RestartHint $game; return }
                '^(i|install)$'      { Invoke-Install $game (Select-Rows $rows $rest $true); break }
                '^(a|all)$'          { Invoke-Install $game (Select-Rows $rows @('all') $true); break }
                '^(ln|link)$'        { Invoke-Link $game (Select-Rows $rows $rest $true); break }
                '^(e|enable)$'       { Invoke-Enable $game (Select-Rows $rows $rest $false); break }
                '^(d|disable)$'      { Invoke-Disable $game (Select-Rows $rows $rest $false); break }
                '^(u|uninstall|remove)$' {
                    $targets = @(Select-Rows $rows $rest $true)
                    if ($targets.Count -gt 0) {
                        $names = ($targets | ForEach-Object { $_.Id }) -join ', '
                        if ((Read-Host "Remove $names from the game? (y/N)") -match '^(y|yes)$') { Invoke-Uninstall $game $targets }
                    }
                    break
                }
                '^(up|update)$'      { Invoke-Update $game $rows; break }
                '^(l|loader)$' {
                    $turnOn = (Get-LoaderState $game) -ne 'on'
                    if ($rest.Count -gt 0) { $turnOn = $rest[0] -ieq 'on' }
                    if ($turnOn) { Enable-LoaderIfNeeded $game; if ((Get-LoaderState $game) -eq 'on') { Ok 'Mod loader is on.' } }
                    else { Set-Loader $game $false | Out-Null; Ok 'Mod loader is off. The game runs unmodded.' }
                    break
                }
                '^(\?|info)$'        { foreach ($r in @(Select-Rows $rows $rest $false)) { Show-Info $r }; break }
                '^(g|game)$' {
                    $new = Read-GamePathFromUser
                    if ($new) { Save-GamePath $new; $game = $new; Ok "Game folder set to $new" }
                    break
                }
                '^(h|help)$'         { Show-Help; break }
                default              { Warn "Unknown command: $cmd" }
            }
        } catch {
            Fail $_.Exception.Message
        }
    }
}

# ----------------------------------------------------------------------------- entry point
function Invoke-Main {
    $argv = @(Split-CommandLine $env:EMM_ARGS)
    $explicitGame = $null
    $words = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $argv.Count; $i++) {
        $a = $argv[$i]
        if ($a -ieq '--game' -or $a -ieq '-g') {
            if ($i + 1 -ge $argv.Count) { throw '--game needs a path.' }
            $explicitGame = $argv[$i + 1]; $i++
        } elseif ($a -match '^(--help|-h|/\?)$') { $words.Insert(0, 'help') }
        else { $words.Add($a) }
    }
    $command = if ($words.Count -gt 0) { $words[0].ToLowerInvariant() } else { '' }
    $rest = @($words | Select-Object -Skip 1)

    if ($command -eq 'help') { Show-Help; return 0 }
    if ($command -eq 'version') { Say $EmmVersion; return 0 }

    if ($command -eq '') {
        $game = Resolve-Game $explicitGame $true
        Start-Menu $game
        return 0
    }

    if ($command -eq 'game') {
        if ($rest.Count -gt 0) {
            if (-not (Test-GameFolder $rest[0])) { throw "Not a Welcome to Elderfield game folder: $($rest[0])" }
            $full = (Resolve-Path -LiteralPath $rest[0]).Path
            Save-GamePath $full
            Ok "Game folder set to $full"
        } else {
            Say (Resolve-Game $explicitGame $false)
        }
        return 0
    }

    $game = Resolve-Game $explicitGame $false
    $rows = @(Get-ModRows $game)
    $needsMods = { if ($rest.Count -eq 0) { throw "Name at least one mod, or 'all'. Example:  elderfield-mods $command LessGrind" } }

    switch ($command) {
        { $_ -in 'status', 'list', 'ls' } { Show-Header $game; Show-Table $rows; Say '' }
        'install'   { & $needsMods; Invoke-Install $game (Select-Rows $rows $rest $true) }
        'enable'    { & $needsMods; Invoke-Enable $game (Select-Rows $rows $rest $false) }
        'disable'   { & $needsMods; Invoke-Disable $game (Select-Rows $rows $rest $false) }
        { $_ -in 'uninstall', 'remove' } { & $needsMods; Invoke-Uninstall $game (Select-Rows $rows $rest $true) }
        'update'    { Invoke-Update $game $rows }
        'link'      { & $needsMods; Invoke-Link $game (Select-Rows $rows $rest $true) }
        'info'      { & $needsMods; foreach ($r in @(Select-Rows $rows $rest $false)) { Show-Info $r } }
        'loader' {
            $arg = if ($rest.Count -gt 0) { $rest[0].ToLowerInvariant() } else { '' }
            if ($arg -eq 'on') { Enable-LoaderIfNeeded $game; if ((Get-LoaderState $game) -eq 'on') { Ok 'Mod loader is on.' } else { throw 'The mod loader could not be switched on.' } }
            elseif ($arg -eq 'off') {
                if (Set-Loader $game $false) { Ok 'Mod loader is off. The game runs unmodded.' } else { Say 'Mod loader is already off.' }
            }
            else { Say ("Mod loader is {0}. Use:  elderfield-mods loader on|off" -f (Get-LoaderState $game)) }
        }
        default { Show-Help; throw "Unknown command: $command" }
    }
    Show-RestartHint $game
    return 0
}

$exitCode = 1
try {
    Invoke-Main | Out-Null      # everything user-facing is written to the host, not the pipeline
    $exitCode = 0
} catch {
    Fail ("Error: " + $_.Exception.Message)
    $exitCode = 1
    # Started by double-click with no arguments: keep the window open long enough to read the error.
    if ([string]::IsNullOrWhiteSpace($env:EMM_ARGS)) { try { [void](Read-Host 'Press Enter to close') } catch { } }
}
exit $exitCode
