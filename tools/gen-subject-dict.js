#!/usr/bin/env node
/**
 * 按《管报格式.xlsx》（211 条）重刷 js/config.js 里的科目字典：
 *   1) PA_DICT.dimensions 里 subject 的 values / codes / aliasesMap
 *   2) window.PA_SUBJECT_TREE（M1 导出「科目编码对照表」用）
 *
 * 为什么要生成而不是手写：
 * 编码一律照抄文档，一条都不许自己编；211 条手抄必然出错，所以由注册表统一派生。
 *
 * 旧编码策略（v0.12.1 起）：**旧编码一律停用**。
 * 历史遗留的 4 位编码（1101/2101/4201…）不再写入 aliasesMap，导入时会被判为未知编码并报警，
 * 必须换成《管报格式.xlsx》里的新编码重新导入。这样同名科目绝不会因为旧码而被错并到新科目上。
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

/* 旧编码只做统计展示，不再写入字典 */
const dropped = oldPairs
  .filter((p) => aliasesMap[p.code] == null)
  .map((p) => p.code + '（' + p.name + '）');

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
console.log('字典编码数：' + Object.keys(aliasesMap).length + '（仅新编码）');
console.log('\n已停用的旧编码（' + dropped.length + '，导入时会报未知编码）：');
dropped.forEach((x) => console.log('  ' + x));
