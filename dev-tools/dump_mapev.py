import os
import json,sys,re
sys.argv=[sys.argv[0]]+sys.argv[1:]
import importlib.util
spec=importlib.util.spec_from_file_location("dump_ce", os.path.join(os.path.dirname(os.path.abspath(__file__)), "dump_ce.py"))
# reuse formatter by exec with no args
src=open(spec.origin,encoding='utf-8').read().split("for arg in sys.argv[1:]:")[0]
exec(src)
mapname=sys.argv[1]; pat=re.compile(sys.argv[2], re.I)
m=json.load(open(f'data/{mapname}.json',encoding='utf-8'))
for ev in m['events']:
    if not ev or not pat.search(ev['name']): continue
    print(f"\n######## {mapname} event {ev['id']}: {ev['name']!r} note={ev['note']!r}")
    for pi,pg in enumerate(ev['pages']):
        cond=pg['conditions']
        cs=[]
        if cond['switch1Valid']: cs.append(sn(cond['switch1Id']))
        if cond['switch2Valid']: cs.append(sn(cond['switch2Id']))
        if cond['variableValid']: cs.append(f"{vn(cond['variableId'])} >= {cond['variableValue']}")
        if cond['selfSwitchValid']: cs.append(f"self {cond['selfSwitchCh']}")
        trig=['action','touch','eventtouch','autorun','parallel'][pg['trigger']]
        print(f"  --- page {pi} trigger={trig} conds={cs}")
        for c in pg['list']:
            line=fmt(c)
            if line: print("      "+"  "*c['indent']+line)
