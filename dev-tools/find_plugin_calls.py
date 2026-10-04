"""Lists every event that calls a plugin's commands, with the commands and their arguments.

Run inside the game folder:  python <repo>/dev-tools/find_plugin_calls.py <plugin name> [max argument length]

Example: python dev-tools/find_plugin_calls.py WTE_EquipmentUpgradeSystem
Shows which common events and map events drive a plugin, which is usually the fastest way to
find where a system's numbers live.
"""
import glob
import json
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
plugin = sys.argv[1]
width = int(sys.argv[2]) if len(sys.argv) > 2 else 140
ce = json.load(open("data/CommonEvents.json", encoding="utf-8"))
infos = json.load(open("data/MapInfos.json", encoding="utf-8"))


def calls(lst):
    out = []
    for c in lst:
        if c["code"] == 357 and c["parameters"][0] == plugin:
            out.append((c["parameters"][1], json.dumps(c["parameters"][3], ensure_ascii=False)))
    return out


def show(where, found):
    counts = Counter(name for name, _ in found)
    print(f"{where}: " + ", ".join(f"{n} x{k}" for n, k in counts.items()))
    seen = set()
    for name, args in found:
        if (name, args) in seen:
            continue
        seen.add((name, args))
        if len(seen) > 12:
            print("      ...")
            break
        print(f"      {name} {args[:width]}")


for e in ce:
    if e:
        found = calls(e["list"])
        if found:
            show(f"CE {e['id']} {e['name']!r}", found)
for f in sorted(glob.glob("data/Map[0-9]*.json")):
    mid = int(re.search(r"Map(\d+)", f).group(1))
    m = json.load(open(f, encoding="utf-8"))
    for ev in m["events"]:
        if not ev:
            continue
        found = [x for pg in ev["pages"] for x in calls(pg["list"])]
        if found:
            show(f"map {mid} {infos[mid]['name'] if infos[mid] else '?'} / event {ev['id']} {ev['name']!r}", found)
