"""Shows where a common event spends its time: every Wait, every movement route that the
event waits for (with the waits inside it), plugin commands and nested common events.

Run inside the game folder:  python <repo>/dev-tools/list_waits.py <common event id> [...]

Useful for finding what keeps the player locked during an animation.
"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
ce = json.load(open("data/CommonEvents.json", encoding="utf-8"))
sysd = json.load(open("data/System.json", encoding="utf-8"))
ROUTE = {1: "down", 2: "left", 3: "right", 4: "up", 12: "fwd", 13: "back", 14: "jump", 15: "wait", 16: "turn down", 17: "turn left",
         18: "turn right", 19: "turn up", 29: "speed", 30: "freq", 33: "walk anim on", 34: "walk anim off", 35: "dir fix on",
         36: "dir fix off", 37: "through on", 38: "through off", 39: "transparent on", 40: "transparent off", 41: "image",
         42: "opacity", 43: "blend", 44: "SE", 45: "script"}


def route_text(route):
    parts = []
    for x in route["list"]:
        if x["code"] == 0:
            continue
        name = ROUTE.get(x["code"], str(x["code"]))
        args = x.get("parameters") or []
        if x["code"] == 15:
            parts.append(f"wait {args[0]}")
        elif x["code"] in (29, 30, 42):
            parts.append(f"{name} {args[0]}")
        elif x["code"] == 41:
            parts.append(f"image {args[0]}[{args[1]}]")
        elif x["code"] == 45:
            parts.append("script " + str(args[0])[:50])
        elif x["code"] == 14:
            parts.append(f"jump {args}")
        else:
            parts.append(name)
    return ", ".join(parts)


def show(cid, depth=0, seen=None):
    seen = seen or set()
    e = ce[cid]
    pad = "  " * depth
    print(f"{pad}CE {cid} {e['name']!r}")
    total = 0
    for i, c in enumerate(e["list"]):
        p = c["parameters"]
        ind = pad + "  " * (c["indent"] + 1)
        if c["code"] == 230:
            total += p[0]
            print(f"{ind}[{i}] Wait {p[0]}")
        elif c["code"] == 205:
            route = p[1]
            inner = sum(x["parameters"][0] for x in route["list"] if x["code"] == 15)
            who = {-1: "player", 0: "this event"}.get(p[0], f"event {p[0]}")
            print(f"{ind}[{i}] Move route ({who}), waits for it: {route['wait']}, waits inside: {inner}f :: {route_text(route)[:150]}")
            if route["wait"]:
                total += inner
        elif c["code"] == 357:
            print(f"{ind}[{i}] Plugin {p[0]}.{p[1]} {json.dumps(p[3])[:110]}")
        elif c["code"] == 355:
            print(f"{ind}[{i}] Script {str(p[0])[:120]}")
        elif c["code"] == 121:
            print(f"{ind}[{i}] Switch {p[0]}[{sysd['switches'][p[0]]}] = {'ON' if p[2] == 0 else 'OFF'}")
        elif c["code"] == 111:
            print(f"{ind}[{i}] If {json.dumps(p)[:90]}")
        elif c["code"] in (112, 113, 413, 118, 119, 115):
            print(f"{ind}[{i}] {({112: 'Loop', 113: 'Break', 413: 'Repeat', 118: 'Label', 119: 'Jump', 115: 'Exit'})[c['code']]} {p}")
        elif c["code"] == 117:
            if p[0] in seen or depth > 3:
                print(f"{ind}[{i}] Call CE {p[0]} {ce[p[0]]['name']!r}")
            else:
                print(f"{ind}[{i}] Call:")
                total += show(p[0], depth + c["indent"] + 2, seen | {cid})
    print(f"{pad}  = {total} frames of explicit waiting in CE {cid} (60 frames = 1 second; movement itself not counted)")
    return total


for arg in sys.argv[1:]:
    show(int(arg))
    print()
