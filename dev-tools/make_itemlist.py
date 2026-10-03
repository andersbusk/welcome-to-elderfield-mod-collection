"""Writes a list of every item, weapon and armor in the game with its ID.

    python dev-tools/make_itemlist.py "<game folder>" docs/ItemList.csv
    python dev-tools/make_itemlist.py "<game folder>" ItemList.csv --descriptions

Columns: type, id, name, price, categories, generic_type.
--descriptions adds the in-game description text. The copy kept in docs/ is made without it:
the IDs are what mods need, and the descriptions are the game's own writing.
Blank and "Empty" placeholder rows are skipped.
"""
import csv
import json
import re
import sys
from collections import Counter

args = [a for a in sys.argv[1:] if not a.startswith('--')]
with_descriptions = '--descriptions' in sys.argv[1:]
if len(args) != 2:
    sys.exit(__doc__)
game, out = args

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


header = ['type', 'id', 'name', 'price', 'categories', 'generic_type']
if with_descriptions:
    header.append('description')

rows = []
for typ, f in [('Item', 'Items'), ('Weapon', 'Weapons'), ('Armor', 'Armors')]:
    with open(f'{game}/data/{f}.json', encoding='utf-8') as fh:
        data = json.load(fh)
    for it in data:
        if not it:
            continue
        name = it['name'].strip()
        if not name or name.lower() == 'empty':
            continue
        row = [typ, it['id'], it['name'], it['price'], cats(it['note']), generic(it['note'])]
        if with_descriptions:
            row.append(clean(it['description']))
        rows.append(row)

with open(out, 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)

print('rows:', len(rows), '->', out)
print(dict(Counter(r[0] for r in rows)))
