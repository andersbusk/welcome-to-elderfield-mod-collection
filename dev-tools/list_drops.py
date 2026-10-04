"""Lists what every pickaxe / axe / scythe target drops and how many.

Run inside the game folder:  python <repo>/dev-tools/list_drops.py

A template sets "Item" (variable 30) and "Amount" (variable 31) and then calls the swing event.
Amounts are either a constant or a random range. Gem nodes pick their item at random.
"""
import glob
import json
import re
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
items = {it["id"]: it["name"] for it in json.load(open("data/Items.json", encoding="utf-8")) if it}
ce = json.load(open("data/CommonEvents.json", encoding="utf-8"))

SWING = {917: "pickaxe", 906: "axe", 978: "axe", 984: "scythe"}
REQ = {"pickaxe": 944, "axe": 942, "scythe": 946}
VAR_ITEM, VAR_AMOUNT = 30, 31


def amount_text(p):
    """Describe a Control Variables command on the Amount variable."""
    op = ["=", "+=", "-=", "*=", "/=", "%="][p[2]]
    if p[3] == 0:
        val = str(p[4])
    elif p[3] == 2:
        val = f"{p[4]}-{p[5]}"
    elif p[3] == 1:
        val = f"V{p[4]}"
    elif p[3] == 4:
        val = "script " + str(p[4])[:40]
    else:
        val = f"data{p[4:]}"
    return (val if op == "=" else f"{op} {val}")


rows = defaultdict(set)
for f in sorted(glob.glob("data/Map[0-9]*.json")):
    mid = int(re.search(r"Map(\d+)", f).group(1))
    m = json.load(open(f, encoding="utf-8"))
    for ev in m["events"]:
        if not ev:
            continue
        for pi, pg in enumerate(ev["pages"]):
            tools = {SWING[c["parameters"][0]] for c in pg["list"] if c["code"] == 117 and c["parameters"][0] in SWING}
            if not tools:
                continue
            tool = sorted(tools)[0]
            req = None
            item_cmds, amount_cmds = [], []
            for c in pg["list"]:
                p = c["parameters"]
                if c["code"] != 122:
                    continue
                if p[0] == REQ[tool] and p[2] == 0 and p[3] == 0:
                    req = p[4]
                elif p[0] == VAR_ITEM and p[1] == VAR_ITEM:
                    item_cmds.append(items.get(p[4], p[4]) if p[3] == 0 else amount_text(p))
                elif p[0] == VAR_AMOUNT and p[1] == VAR_AMOUNT:
                    amount_cmds.append(amount_text(p))
            base = re.sub(r"[ _]?\d+$", "", ev["name"]).strip()
            item = " / ".join(dict.fromkeys(str(x) for x in item_cmds)) or "(set elsewhere)"
            amount = " ; ".join(dict.fromkeys(amount_cmds)) or "(set elsewhere)"
            rows[(tool, req or 0, base, item, amount)].add(mid)

for tool in ("pickaxe", "axe", "scythe"):
    print(f"\n=== {tool} ===")
    print(f"  {'target':<26} {'tier':<5} {'drops':<34} {'amount':<16} maps")
    for (t, req, base, item, amount), maps in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
        if t != tool:
            continue
        print(f"  {base[:25]:<26} {str(req or 'any'):<5} {item[:33]:<34} {amount[:15]:<16} {sorted(maps)[:4]}")
