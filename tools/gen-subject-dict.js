#!/usr/bin/env node
/**
 * 按《管报格式.xlsx》（211 条）重刷 js/config.js 里的科目字典：
 *   1) PA_DICT.dimensions 里 subject 的 values / codes / aliasesMap
 *   2) window.PA_SUBJECT_TREE（M1 导出「科目编码对照表」用）
 *
 * 为什么要生成而不是手写：
 * 编码一律照抄文档，一条都不许自己编；211 条手抄必然出错，所以由注册表统一派生。
 *
 * 旧编码迁移规则：老 4 位编码（1101/2101/4201…）如果名称能**唯一**映射到新科目，
 * 就保留为 aliasesMap 的兼容键（老编码 → 新名称）；如果与新编码撞号（4101~4106），
 * 一律以新文档为准，不保留旧义——撞号的清理必须由业务确认，脚本不猜。
 *
 * 用法：node tools/gen-subject-dict.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'js', 'config.js');
const REG = path.join(ROOT, 'js', 'report', 'subjects.js');

/* ---------- 1. 载入注册表 ---------- */
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(REG, 'utf8'), sandbox, { filename: 'subjects.js' });
const R = sandbox.PA_REPORT_SUBJECTS;
if (!R || !Array.isArray(R.list)) {
  console.error('注册表加载失败');
  process.exit(1);
}

/* ---------- 2. 读出 config.js 里现有的旧字典，用于迁移 ---------- */
const text = fs.readFileSync(CONFIG, 'utf8');
const startAnchor = "{ key: 'subject', label: '科目'";
const start = text.indexOf(startAnchor);
if (start < 0) { console.error('找不到 subject 维度定义'); process.exit(1); }
const endMark = '/* 旧口径兼容键';
const endIdx = text.indexOf(endMark, start);
if (endIdx < 0) { console.error('找不到 subject 维度结束位置'); process.exit(1); }
const oldSeg = text.slice(start, endIdx);

const oldPairs = [];
const aliasMatch = oldSeg.match(/aliasesMap:\s*(\{[\s\S]*?\})\s*\}\s*,?\s*$/);
if (aliasMatch) {
  try {
    const map = vm.runInNewContext('(' + aliasMatch[1] + ')');
    Object.keys(map).forEach((k) => oldPairs.push({ code: k, name: map[k] }));
  } catch (e) {
    console.error('旧 aliasesMap 解析失败：' + e.message);
    process.exit(1);
  }
}

/* ---------- 3. 生成新字典 ---------- */
const values = R.list.map((s) => s.name);
const codes = R.list.map((s) => s.code);

const aliasesMap = {};
R.list.forEach((s) => { aliasesMap[s.code] = s.name; });

const legacyApplied = [];
const legacyConflicts = [];
const legacyAmbiguous = [];

oldPairs.forEach((p) => {
  if (aliasesMap[p.code] != null) {
    /* 撞号：同一个编码在新旧系统里含义不同，只能以文档为准 */
    if (aliasesMap[p.code] !== p.name) {
      legacyConflicts.push({ code: p.code, oldName: p.name, newName: aliasesMap[p.code] });
    }
    return;
  }
  const hit = R.byName[p.name];
  if (hit && hit.length === 1) {
    aliasesMap[p.code] = hit[0].name;
    legacyApplied.push({ code: p.code, oldName: p.name, newCode: hit[0].code });
  } else if (hit && hit.length > 1) {
    legacyAmbiguous.push({ code: p.code, oldName: p.name, candidates: hit.map((s) => s.code) });
  }
});

/* ---------- 4. 生成 subject 维度对象 ---------- */
const dimObj = "{ key: 'subject', label: '科目', aliases: ['科目', '一级科目', '二级科目', '三级科目', '四级科目', '科目编码', 'subject', '会计科目'],\n" +
  '      values: ' + JSON.stringify(values) + ',\n' +
  '      codes: ' + JSON.stringify(codes) + ',\n' +
  '      aliasesMap: ' + JSON.stringify(aliasesMap) + ' }' +
  ',    ';

/* ---------- 5. 生成科目树（M1 科目编码对照表数据源） ---------- */
const tree = R.list.map((s) => ({
  c: s.code,
  n: s.name,
  p: s.path.slice(),
  l: s.path[0] || s.name
}));
const treeLine = 'window.PA_SUBJECT_TREE = ' + JSON.stringify(tree) + ';';

/* ---------- 6. 写回 config.js ---------- */
let out = text.slice(0, start) + dimObj + text.slice(endIdx);

/* 替换科目树整行 */
const treeRe = /window\.PA_SUBJECT_TREE = \[[\s\S]*?\];/;
if (!treeRe.test(out)) { console.error('找不到 PA_SUBJECT_TREE 赋值语句'); process.exit(1); }
out = out.replace(treeRe, function () { return treeLine; });

fs.writeFileSync(CONFIG, out, 'utf8');

/* ---------- 7. 报告 ---------- */
console.log('已更新 ' + path.relative(ROOT, CONFIG));
console.log('科目条数：' + R.list.length + '（一级 ' + R.list.filter((s) => s.level === 1).length +
  ' / 二级 ' + R.list.filter((s) => s.level === 2).length +
  ' / 三级 ' + R.list.filter((s) => s.level === 3).length +
  ' / 四级 ' + R.list.filter((s) => s.level === 4).length + '）');
console.log('兼容键合计：' + Object.keys(aliasesMap).length + '（新编码 ' + codes.length + ' + 旧编码 ' + legacyApplied.length + '）');
console.log('\n旧编码已迁移（' + legacyApplied.length + '）：');
legacyApplied.forEach((x) => console.log('  ' + x.code + ' → ' + x.newCode + '  ' + x.oldName));
console.log('\n新旧撞号（' + legacyConflicts.length + '，以文档为准，旧义不保留）：');
legacyConflicts.forEach((x) => console.log('  ' + x.code + '  旧[' + x.oldName + '] → 新[' + x.newName + ']'));
if (legacyAmbiguous.length) {
  console.log('\n旧编码名称歧义无法自动迁移（' + legacyAmbiguous.length + '）：');
  legacyAmbiguous.forEach((x) => console.log('  ' + x.code + '  ' + x.oldName + ' → 候选 ' + x.candidates.join(',')));
}
