# -*- coding: utf-8 -*-
"""从《管报主数据及定义.xlsx》的「科目主数据」sheet 解析真实科目编码树。
输出 subjects_real.json（每个科目: code / path / name / level），供生成 config 使用。
用法: python tools/parse_subject_codes.py [xlsx路径]
"""
import sys, os, json, zipfile, re
import xml.etree.ElementTree as ET

DEFAULT = r'C:\Users\1\Desktop\管报主数据及定义.xlsx'
path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

z = zipfile.ZipFile(path)
# shared strings
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    for si in root.findall('m:si', ns):
        ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
# workbook -> sheet targets
wb = ET.fromstring(z.read('xl/workbook.xml'))
rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
relmap = {r.get('Id'): r.get('Target') for r in rels}
sheets = []
for sh in wb.find('m:sheets', ns):
    rid = sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
    tgt = relmap[rid]
    if not tgt.startswith('xl/'):
        tgt = 'xl/' + tgt.lstrip('/')
    sheets.append((sh.get('name'), tgt))

def colnum(ref):
    m = re.match(r'([A-Z]+)', ref)
    n = 0
    for c in m.group(1):
        n = n * 26 + ord(c) - 64
    return n - 1

target = None
for name, tgt in sheets:
    if name == '科目主数据':
        target = tgt
        break
if not target:
    raise SystemExit('未找到「科目主数据」sheet')

root = ET.fromstring(z.read(target))
rows = []
for row in root.findall('.//m:sheetData/m:row', ns):
    cells = {}
    for c in row.findall('m:c', ns):
        v = c.find('m:v', ns)
        val = ''
        if v is not None:
            val = ss[int(v.text)] if c.get('t') == 's' else (v.text or '')
        elif c.get('t') == 'inlineStr':
            val = ''.join(t.text or '' for t in c.iter(NS + 't'))
        cells[colnum(c.get('r'))] = val
    mx = max(cells.keys()) if cells else -1
    rows.append([(cells.get(i, '') or '').strip() for i in range(min(mx + 1, 6))])

out = []
for r in rows:
    code = r[4] if len(r) > 4 else ''
    if not code or not re.fullmatch(r'\d+', code):
        continue
    parts = [x for x in r[:4] if x]
    out.append({
        'code': code,
        'path': parts,
        'name': parts[-1] if parts else '',
        'level': len(parts),
        'l1': parts[0] if len(parts) > 0 else ''
    })

here = os.path.dirname(os.path.abspath(__file__))
outfile = os.path.join(here, 'subjects_real.json')
with open(outfile, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('已解析科目数:', len(out))
print('层级分布:', {lv: sum(1 for o in out if o['level'] == lv) for lv in (1, 2, 3, 4)})
print('输出:', outfile)
