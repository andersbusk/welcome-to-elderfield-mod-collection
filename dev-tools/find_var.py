"""Shows where a game variable is read or written: common events, map event pages and page conditions.

Run inside the game folder:  python <repo>/dev-tools/find_var.py <variable id> [...]

Useful before reusing a variable (for example a self variable, the ones named "SV: ...") for
something new: it shows whether any other logic depends on it.
"""
import glob
import json
import re
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
ids = [int(a) for a in sys.argv[1:]]
sysd = json.load(open("data/System.json", encoding="utf-8"))
ce = json.load(open("data/CommonEvents.json", encoding="utf-8"))


def uses(cmd, vid):
    """Return 'write', 'read' or None for one event command."""
    c, p = cmd["code"], cmd["parameters"]
    if c == 122:
        if p[0] <= vid <= p[1]:
            return "write"
        if p[3] == 1 and p[4] == vid:
            return "read"
        if p[3] == 2 and False:
            return None
        if p[3] == 4 and re.search(r"\b%d\b" % vid, str(p[4])):
            return "script"
    elif c == 111:
        if p[0] == 1 and (p[1] == vid or (p[2] == 1 and p[3] == vid)):
            return "read"
        if p[0] == 12 and re.search(r"\b%d\b" % vid, str(p[1])):
            return "script"
    elif c in (355, 655):
        if re.search(r"(value|Value|getSv|setSv)\(\[?[^)]*\b%d\b" % vid, str(p[0])):
            return "script"
    elif c == 103 and p[0] == vid:
        return "write"
    elif c in (126, 127, 128, 125) and len(p) > 3 and p[2] == 1 and p[3] == vid:
        return "read"
    elif c in (101, 401) and re.search(r"\\[vV]\[%d\]" % vid, str(p[0] if p else "")):
        return "text"
    return None


for vid in ids:
    print(f"\n=== V{vid} [{sysd['variables'][vid]}] ===")
    for e in ce:
        if not e:
            continue
        kinds = defaultdict(int)
        for cmd in e["list"]:
            k = uses(cmd, vid)
            if k:
                kinds[k] += 1
        if kinds:
            print(f"  CE {e['id']:<5} {e['name'][:40]:<40} {dict(kinds)}")
    rows = defaultdict(lambda: defaultdict(int))
    for f in sorted(glob.glob("data/Map[0-9]*.json")):
        mid = int(re.search(r"Map(\d+)", f).group(1))
        m = json.load(open(f, encoding="utf-8"))
        for ev in m["events"]:
            if not ev:
                continue
            for pg in ev["pages"]:
                c = pg["conditions"]
                if c.get("variableValid") and c.get("variableId") == vid:
                    rows[(mid, ev["name"])]["page condition"] += 1
                for cmd in pg["list"]:
                    k = uses(cmd, vid)
                    if k:
                        rows[(mid, ev["name"])][k] += 1
    by_name = defaultdict(list)
    for (mid, name), kinds in rows.items():
        by_name[(name, json.dumps(dict(kinds), sort_keys=True))].append(mid)
    for (name, kinds), mids in sorted(by_name.items()):
        shown = mids[:6] + (["..."] if len(mids) > 6 else [])
        print(f"  map event {name[:34]:<34} {kinds}  maps {shown}")
