"""Lists everything that is broken with a pickaxe, axe or scythe: template name, drop,
required tool tier and health, plus where the damage commands live.
Run inside the game folder:  python list_breakables.py
"""
import glob
import json
import math
import re
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
items = {it["id"]: it["name"] for it in json.load(open("data/Items.json", encoding="utf-8")) if it}
infos = json.load(open("data/MapInfos.json", encoding="utf-8"))
mapname = {m["id"]: m["name"] for m in infos if m}
ce = json.load(open("data/CommonEvents.json", encoding="utf-8"))

# tool -> (current-tier variable, required-tier variable)
TOOLS = {"pickaxe": (945, 944), "axe": (943, 942), "scythe": (947, 946)}
LEVEL_VARS = {v[0]: k for k, v in TOOLS.items()}

# 1. Every "damage so far += tool tier" command, anywhere
print("=== damage commands: Var 24 (SV: A) += <tool tier variable> ===")
swing_ces = defaultdict(set)   # tool -> common event ids
for e in ce:
    if not e:
        continue
    for c in e["list"]:
        p = c["parameters"]
        if c["code"] == 122 and p[0] == 24 and p[1] == 24 and p[2] == 1 and p[3] == 1 and p[4] in LEVEL_VARS:
            swing_ces[LEVEL_VARS[p[4]]].add(e["id"])
for tool, ids in swing_ces.items():
    print(f"  {tool}: " + ", ".join(f"CE {i} {ce[i]['name']!r}" for i in sorted(ids)))
in_maps = 0
for f in sorted(glob.glob("data/Map[0-9]*.json")):
    m = json.load(open(f, encoding="utf-8"))
    for ev in m["events"]:
        if not ev:
            continue
        for pg in ev["pages"]:
            for c in pg["list"]:
                p = c["parameters"]
                if c["code"] == 122 and p[0] == 24 and p[2] == 1 and p[3] == 1 and p[4] in LEVEL_VARS:
                    in_maps += 1
print(f"  same command inside map events: {in_maps}")

# 2. Templates that call those common events
rows = defaultdict(lambda: defaultdict(set))   # tool -> (name, req, hp, drop) -> maps
for f in sorted(glob.glob("data/Map[0-9]*.json")):
    mid = int(re.search(r"Map(\d+)", f).group(1))
    m = json.load(open(f, encoding="utf-8"))
    for ev in m["events"]:
        if not ev:
            continue
        cmds = [c for pg in ev["pages"] for c in pg["list"]]
        for tool, ids in swing_ces.items():
            if not any(c["code"] == 117 and c["parameters"][0] in ids for c in cmds):
                continue
            req_var = TOOLS[tool][1]
            req, hp, drop = None, [], None
            for c in cmds:
                p = c["parameters"]
                if c["code"] == 122 and p[2] == 0 and p[3] == 0:
                    if p[0] == req_var:
                        req = p[4]
                    elif p[0] == 25 and p[1] == 25:
                        hp.append(p[4])
                    elif p[0] == 30 and drop is None:
                        drop = items.get(p[4], p[4])
            base = re.sub(r"[ _]?\d+$", "", ev["name"]).strip()
            rows[tool][(base, req, tuple(sorted(set(hp))), drop)].add(mid)

for tool in TOOLS:
    print(f"\n=== {tool}: breakables (name, required tier, health values, drop, maps) ===")
    hmax = defaultdict(int)
    for (name, req, hp, drop), maps in rows[tool].items():
        if hp:
            hmax[req or 1] = max(hmax[req or 1], max(hp))
    for (name, req, hp, drop), maps in sorted(rows[tool].items(), key=lambda kv: ((kv[0][1] or 0), kv[0][2], kv[0][0])):
        where = ", ".join(f"{mid}:{mapname.get(mid)}" for mid in sorted(maps)[:3]) + (f" +{len(maps) - 3}" if len(maps) > 3 else "")
        van = ""
        if hp:
            h = max(hp)
            van = " ".join(("-" if req and t < req else str(math.ceil(h / t))).rjust(2) for t in range(1, 6))
        print(f"  {name[:28]:<29} req {str(req):<5} hp {str(list(hp)):<12} {str(drop)[:20]:<21} vanilla swings {van}   [{where}]")
    print("  toughest health per required tier:", dict(sorted(hmax.items())))
