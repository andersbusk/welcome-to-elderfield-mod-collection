import json,sys
sysd=json.load(open('data/System.json',encoding='utf-8'))
V=sysd['variables']; S=sysd['switches']
items={it['id']:it['name'] for it in json.load(open('data/Items.json',encoding='utf-8')) if it}
ce=json.load(open('data/CommonEvents.json',encoding='utf-8'))
def vn(i): return f"V{i}[{V[i] if i<len(V) else '?'}]"
def sn(i): return f"S{i}[{S[i] if i<len(S) else '?'}]"
OPS=['=','+=','-=','*=','/=','%=']
def fmt(c):
    code,p=c['code'],c['parameters']
    if code==101: return f"ShowText face={p[0]} name={p[4] if len(p)>4 else ''}"
    if code==401: return f"  | {p[0]}"
    if code==102: return f"ShowChoices {p[0]}"
    if code==402: return f"When [{p[1]}]"
    if code==404: return "EndChoices"
    if code in (108,408): return f"# {p[0]}"
    if code==111:
        t=p[0]
        if t==0: return f"If {sn(p[1])} == {'ON' if p[2]==0 else 'OFF'}"
        if t==1:
            rhs = vn(p[3]) if p[2]==1 else str(p[3])
            return f"If {vn(p[1])} {['==','>=','<=','>','<','!='][p[4]]} {rhs}"
        if t==2: return f"If SelfSwitch {p[1]} == {'ON' if p[2]==0 else 'OFF'}"
        if t==8: return f"If party has item {p[1]}[{items.get(p[1],'?')}]"
        if t==12: return f"If script: {p[1]}"
        return f"If (type {t}) {p[1:]}"
    if code==411: return "Else"
    if code==412: return "EndIf"
    if code==112: return "Loop"
    if code==413: return "RepeatAbove"
    if code==113: return "BreakLoop"
    if code==115: return "ExitEvent"
    if code==117: return f"CallCommonEvent {p[0]}[{ce[p[0]]['name'] if p[0]<len(ce) and ce[p[0]] else '?'}]"
    if code==121: 
        rng = sn(p[0]) if p[0]==p[1] else f"S{p[0]}..S{p[1]}"
        return f"Switch {rng} = {'ON' if p[2]==0 else 'OFF'}"
    if code==122:
        rng = vn(p[0]) if p[0]==p[1] else f"V{p[0]}..V{p[1]}"
        op=OPS[p[2]]; t=p[3]
        if t==0: val=str(p[4])
        elif t==1: val=vn(p[4])
        elif t==2: val=f"rand({p[4]}..{p[5]})"
        elif t==3: val=f"gamedata{p[4:]}"
        elif t==4: val=f"script: {p[4]}"
        else: val=str(p[4:])
        return f"Var {rng} {op} {val}"
    if code==123: return f"SelfSwitch {p[0]} = {'ON' if p[1]==0 else 'OFF'}"
    if code==126:
        return f"ChangeItem {p[0]}[{items.get(p[0],'?')}] {'+' if p[1]==0 else '-'} {vn(p[3]) if p[2]==1 else p[3]}"
    if code==355: return f"Script: {p[0]}"
    if code==655: return f"   ...{p[0]}"
    if code==357: return f"PluginCmd {p[0]}.{p[1]} {json.dumps(p[3]) if len(p)>3 else ''}"
    if code==230: return f"Wait {p[0]}"
    if code==0: return ""
    return f"code{code} {p}"
for arg in sys.argv[1:]:
    i=int(arg); e=ce[i]
    print(f"\n######## CommonEvent {i}: {e['name']!r} trigger={e['trigger']} switch={sn(e['switchId'])} cmds={len(e['list'])}")
    for c in e['list']:
        line=fmt(c)
        if line: print("  "*c['indent']+line)
