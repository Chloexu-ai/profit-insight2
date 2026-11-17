/**
 * 从 js/config.js 的 PA_DICT 自动生成 docs/管报主数据口径.md
 *
 * 用法（在项目根目录）：
 *   node tools/gen-masterdata-doc.js
 *
 * 维护约定：新增/修改维度或指标请先改 js/config.js，然后运行本脚本，
 * 让文档与代码保持一致，避免协作者看到过时口径。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(base, 'js/config.js'), 'utf8');
const sandbox = { window: {}, WorkBuddyCloud: { createWorkBuddyCloud: () => ({}) } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const w = sandbox.window;
const dict = w.PA_DICT;

function inline(arr) {
  return (arr || []).map((v) => '`' + String(v).replace(/`/g, '\\`') + '`').join(' / ');
}
function mapTable(obj) {
  if (!obj || !Object.keys(obj).length) return '_（无编码别名映射）_\n';
  let s = '| 原写法 | 标准值 |\n|---|---|\n';
  for (const [k, v] of Object.entries(obj)) {
    s += '| `' + k + '` | ' + v + ' |\n';
  }
  return s;
}

let md = '';
md += '# 管报主数据口径（代码字典同步）\n\n';
md += '> 本文件由 `tools/gen-masterdata-doc.js` 从 `js/config.js` 的 `PA_DICT` 自动导出，是 M1–M4 共用的**权威口径**。\n';
md += '> 新增/修改维度或指标请先改 `js/config.js`，再运行 `node tools/gen-masterdata-doc.js` 重新生成本文档。\n';
md += '> 数据来源：《管报主数据及定义.xlsx》。\n\n';

md += '## 1. 标准导入模板\n\n';
md += 'M1「下载管报模板」使用的标准表头（顺序固定）：\n\n';
md += '| # | 列名 | 字段 key |\n|---|---|---|\n';
const keyByLabel = {};
dict.dimensions.forEach((d) => { if (!d.key.includes('region')) keyByLabel[d.label] = d.key; });
dict.metrics.forEach((m) => { keyByLabel[m.label] = m.key; });
keyByLabel['科目编码'] = 'subject';
w.PA_TEMPLATE_HEADERS.forEach((h, i) => {
  md += '| ' + (i + 1) + ' | ' + h + ' | `' + (keyByLabel[h] || '') + '` |\n';
});
md += '\n';

md += '## 2. 维度字典\n\n';
dict.dimensions.forEach((d, idx) => {
  md += '### 2.' + (idx + 1) + ' ' + d.label + '（`' + d.key + '`）\n\n';
  md += '- **识别别名**：' + inline(d.aliases) + '\n';
  md += '- **标准取值（' + (d.values ? d.values.length : 0) + '）**：' + (d.values ? inline(d.values) : '_继承旧口径，无枚举约束_') + '\n\n';
  if (d.codes && d.codes.length) {
    md += '**录入编码 → 标准名称对照**（模板「科目编码」列用编码录入，上传后界面自动转名称）：\n\n';
    md += '| 编码 | 名称 |\n|---|---|\n';
    (d.values || []).forEach((v, i) => { md += '| `' + (d.codes[i] || '') + '` | ' + v + ' |\n'; });
    md += '\n';
  }
  if (d.aliasesMap) {
    md += '**编码 / 别名 → 标准值对照**（导入时自动规范化）：\n\n';
    md += mapTable(d.aliasesMap) + '\n';
  }
});

md += '## 3. 指标字典\n\n';
md += '### 3.1 原始指标（metrics）\n\n';
md += '| 字段 key | 名称 | 说明 |\n|---|---|---|\n';
dict.metrics.forEach((m) => {
  md += '| `' + m.key + '` | ' + m.label + ' | ' + (m.key === 'amount' ? '管报金额列，按科目+数据类型归集到下列指标' : '可由 `amount` 归集得到，也兼容旧格式直接导入') + ' |\n';
});
md += '\n### 3.2 派生指标（derived）\n\n';
md += '| 字段 key | 名称 | 计算口径 |\n|---|---|---|\n';
for (const [k, v] of Object.entries(dict.derived)) {
  md += '| `' + k + '` | ' + v.label + ' | ' + v.expr + ' |\n';
}
md += '\n';

md += '## 4. 归集口径（amount → 收入/成本/预算）\n\n';
md += '导入「金额 + 科目 + 数据类型」时，按下列规则自动归集，使管报格式与旧指标口径共存。\n\n';
md += '### 4.1 数据类型 → 预算/实际角色（`dataTypeRole`）\n\n';
md += mapTable(dict.dataTypeRole) + '\n';
md += '### 4.2 科目 → 收入/成本角色（`subjectRole`）\n\n';
md += '| 角色 | 科目 |\n|---|---|\n';
for (const [role, subjects] of Object.entries(dict.subjectRole)) {
  md += '| ' + role + ' | ' + inline(subjects) + ' |\n';
}
md += '\n> 归集逻辑：科目属于 `revenue` 组且数据类型为「实际数」→ 计入实际收入；属于 `cost` 组且为「实际数」→ 计入实际成本；数据类型为「预算数」→ 对应计入预算收入/预算成本。未命中科目不归集，仅保留 `amount` 原值。\n\n';

md += '## 5. 看板维度标签（PA_DIM_LABELS）\n\n';
md += '| 字段 key | 看板显示名 |\n|---|---|\n';
for (const [k, v] of Object.entries(w.PA_DIM_LABELS)) {
  md += '| `' + k + '` | ' + v + ' |\n';
}
md += '\n';

md += '## 6. 旧格式兼容\n\n';
md += '- 旧模板（期间 / 区域 / 产品线 / 渠道 / 实际收入 / 实际成本 / 预算收入 / 预算成本）仍可导入。\n';
md += '- `期间` 同时填充 `month` 与 `period`，保证旧看板「利润趋势（按期间）」不失效。\n';
md += '- `区域`/`产品线` 走旧口径键 `region`/`product`，不影响管报维度统计。\n\n';

md += '## 7. 示例数据（PA_SAMPLE_ROWS）\n\n';
md += '| ' + w.PA_TEMPLATE_HEADERS.join(' | ') + ' |\n';
md += '|' + w.PA_TEMPLATE_HEADERS.map(() => '---').join('|') + '|\n';
const subjDef = (dict.dimensions || []).find((d) => d.key === 'subject') || {};
w.PA_SAMPLE_ROWS.forEach((r) => {
  md += '|' + w.PA_TEMPLATE_HEADERS.map((h) => {
    if (h === '科目编码') return (subjDef.codes || [])[(subjDef.values || []).indexOf(r.subject)] || '';
    const v = r[keyByLabel[h]];
    return v == null ? '' : v;
  }).join(' | ') + '|\n';
});
md += '\n';

md += '## 8. 数据视图权限（科目级可见范围）\n\n';
md += '由 `js/config.js` 的 `PA_DATA_VIEWS` 定义，M1 预览 / M2 问数 / M3 看板 / M4 推送检查统一通过 `PA.applyDataView()` 过滤。\n\n';
md += '| 视图 | 可见科目范围 | 适用 |\n|---|---|---|\n';
Object.values(w.PA_DATA_VIEWS || {}).forEach((v) => {
  const scope = v.subjectMode === 'all' ? '全部科目（含净利润）' : (v.subjectRange || []).join(' → ');
  md += '| ' + v.label + ' | ' + scope + ' | ' + v.desc + ' |\n';
});
md += '\n- 角色默认：`owner`→管理层，`editor`/`viewer`→业务端；成员可在 M5 数据权限中心单独指定。\n';
md += '- 主数据字典可由 M6 在线维护并写入云端 `pa_masterdata`（按空间隔离），加载时覆盖系统默认字典。\n\n';

const out = path.join(base, 'docs/管报主数据口径.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md, 'utf8');
console.log('written:', out, 'bytes:', Buffer.byteLength(md, 'utf8'));
