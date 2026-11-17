# -*- coding: utf-8 -*-
"""把 build_result.json 的真实科目编码写回 js/config.js：
- 替换 subject 维度的 codes 与 aliasesMap（保留 values 顺序 = 权限区间锚点不变）
- 追加 window.PA_SUBJECT_TREE（199 条完整科目树，供 M6 / 编码表 / 权限按一级归属使用）
幂等：重复执行结果一致。
"""
import os, json, re

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
cfg_path = os.path.join(root, 'js', 'config.js')
res = json.load(open(os.path.join(here, 'build_result.json'), encoding='utf-8'))

src = open(cfg_path, encoding='utf-8').read()

codes_js = '[' + ','.join(json.dumps(c, ensure_ascii=False) for c in res['codes']) + ']'
amap_js = '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + json.dumps(v, ensure_ascii=False)
                         for k, v in res['aliasesMap'].items()) + '}'

# 定位 subject 块：从 "    { key: 'subject'" 到下一个注释 "/* 旧口径兼容键" 之前
start = src.index("    { key: 'subject'")
end = src.index("    /* 旧口径兼容键", start)
new_subject = (
    "    { key: 'subject', label: '科目', aliases: ['科目', '一级科目', '二级科目', '三级科目', '四级科目', '科目编码', 'subject', '会计科目'],\n"
    "      values: " + json.dumps(res['values'], ensure_ascii=False) + ",\n"
    "      /* 科目编码来自《管报主数据及定义.xlsx》科目主数据：一级4位/二级6位/三级8位/四级10位；旧编码保留为别名兼容 */\n"
    "      codes: " + codes_js + ",\n"
    "      aliasesMap: " + amap_js + " },"
)
src = src[:start] + new_subject + src[end:]

# 管理完整科目树（199 条）：c=编码 n=末级名 p=路径 l=一级科目
tree_js = 'window.PA_SUBJECT_TREE = ' + json.dumps(res['tree'], ensure_ascii=False) + ';\n'
if 'window.PA_SUBJECT_TREE' in src:
    src = re.sub(r'window\.PA_SUBJECT_TREE = .*?;\n', tree_js, src, count=1, flags=re.S)
else:
    src = src.rstrip() + '\n\n/* 完整科目树（来自用户导入的科目主数据；供 M6 维护、编码表下载与权限按一级归属判定） */\n' + tree_js

open(cfg_path, 'w', encoding='utf-8').write(src)
print('已写回 config.js')
print('codes:', len(res['codes']), '| aliasesMap:', len(res['aliasesMap']), '| tree:', len(res['tree']))
