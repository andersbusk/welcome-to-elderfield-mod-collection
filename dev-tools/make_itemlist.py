import csv
import json
import re
import sys
from collections import Counter

game = sys.argv[1]
out = sys.argv[2]

ESC_COLOR = re.compile(r'\\[cC]\[\d+\]')          # \c[6]
ESC_OTHER = re.compile(r'\\[a-zA-Z]+\[[^\]]*\]')   # \v[15], \i[123] ...
CATS = re.compile(r'<Categories>(.*?)</Categories>', re.S)
GENERIC = re.compile(r'<cgmzcraftinggeneric:([^>]*)>')


def clean(s):
    s = s or ''
    s = ESC_COLOR.sub('', s)
    s = ESC_OTHER.sub('', s)
    s = s.replace('<br>', ' ').replace('\r', '').replace('\n', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def cats(note):
    m = CATS.search(note or '')
    return ' '.join(m.group(1).split()) if m else ''


def generic(note):
    m = GENERIC.search(note or '')
    return m.group(1) if m else ''


rows = []
for typ, f in [('Item', 'Items'), ('Weapon', 'Weapons'), ('Armor', 'Armors')]:
    with open(f'{game}/data/{f}.json', encoding='utf-8') as fh:
        data = json.load(fh)
    for it in data:
        if not it or not it['name'].strip():
            continue
        rows.append([typ, it['id'], it['name'], it['price'], cats(it['note']), generic(it['note']), clean(it['description'])])

with open(out, 'w', encoding='utf-8-sig', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['type', 'id', 'name', 'price', 'categories', 'generic_type', 'description'])
    w.writerows(rows)

print('rows:', len(rows), '->', out)
print(Counter(r[0] for r in rows))
print('rows still containing a backslash code:', sum(1 for r in rows if '\\' in r[6]))
