# -*- coding: utf-8 -*-
"""基于 tools/subjects_real.json 生成：
1) 41 个系统统计科目 -> 真实编码映射（统计值）
2) subject 维度完整定义片段（codes + aliasesMap，旧编码兼容）
3) window.PA_SUBJECT_TREE（199 条完整科目树，供权限与 M6 使用）
输出 build_result.json，供人工核对后写回 config.js。
"""
import os, json

here = os.path.dirname(os.path.abspath(__file__))
real = json.load(open(os.path.join(here, 'subjects_real.json'), encoding='utf-8'))

# 系统现有 41 个统计科目（顺序即权限区间锚点，不可变更）
legacy_values = ['订单量','销量','销售收入','发货GMV','退货GMV','买家实付运费收入','物流补贴收入','产品成本-内核法','采购成本','中台结算成本','综合头程成本','空运成本','赠品成本','产品毛利-内核法','销售费用','线上货架站内推广费用','线上货架站外推广费用','Tiktok市场营销费用','售后费用','线下MT费用','线下代理商费用','品牌费用','物流费用','库存减值','综合税负','销售毛利-内核法','前台毛利-内核法','管理费用','财务费用','营业利润','营业税金及附加','企业所得税','净利润-内核法','营业外收支','平台费用','站内广告费用','资源坑位费用','联盟佣金','自播直播间费用','网红固定费','站外广告费用','素材采买费']
legacy_codes = ['1001','1002','1101','1102','1103','1104','1105','2101','2102','2103','2104','2105','2106','3101','4101','4102','4103','4104','4105','4106','4107','4108','4109','4110','4111','3102','3103','4201','4202','5101','4203','4204','5102','5103','9301','9302','9303','9304','9305','9306','9307','9308']

# 特殊名称对齐（Excel 里带括号后缀）
alias_name = {
    '营业税金及附加': '营业税金及附加（印花税/附加税）',
    '企业所得税': '企业所得税（包含预缴）',
}

def find_code(name):
    target = alias_name.get(name, name)
    # 优先精确末级名，层级越小越优先；其次前缀匹配
    hits = [o for o in real if o['name'] == target]
    if not hits:
        hits = [o for o in real if o['name'].startswith(target)]
    if not hits:
        return None, None
    hits.sort(key=lambda o: (o['level'], len(o['code'])))
    return hits[0]['code'], hits[0]

mapping = []
for v, old in zip(legacy_values, legacy_codes):
    code, hit = find_code(v)
    mapping.append({'name': v, 'old_code': old, 'new_code': code,
                    'matched': hit['name'] if hit else None, 'level': hit['level'] if hit else None})

missing = [m for m in mapping if not m['new_code']]
print('=== 41 个统计科目 -> 真实编码 ===')
for m in mapping:
    flag = '' if m['new_code'] else '  <<< 未匹配'
    print(f"{m['name']:<16} {m['old_code']:>5} -> {str(m['new_code']):>10}  [{m['matched']}]{flag}")
print('未匹配数:', len(missing))

# 生成完整 aliasesMap: 全部 199 条真实编码 -> 末级名（编码唯一，精确）+ 旧编码兼容 + 别名
amap = {}
real_codes = {o['code'] for o in real}
for o in real:
    amap[o['code']] = o['name']
# 旧编码兼容：仅当旧编码不在真实编码集合中才加入，避免真实编码被覆盖
for m in mapping:
    old = m['old_code']
    if old not in real_codes:
        amap[old] = m['name']
# 同一旧编码可能对应多个统计科目（如 4101 曾=销售费用），仅保留首个未被占用的
print('真实编码优先；已排除冲突旧编码:', sorted(set(m['old_code'] for m in mapping) & real_codes))

# 生成完整树（含 l1，供权限按一级归属判定）
tree = [{'c': o['code'], 'n': o['name'], 'p': o['path'], 'l': o['l1']} for o in real]

result = {
    'values': legacy_values,
    'codes': [m['new_code'] or m['old_code'] for m in mapping],
    'aliasesMap': amap,
    'tree': tree,
    'mapping': mapping
}
with open(os.path.join(here, 'build_result.json'), 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)
print('\n输出:', os.path.join(here, 'build_result.json'))
print('aliasesMap 条数:', len(amap), '| 科目树条数:', len(tree))
