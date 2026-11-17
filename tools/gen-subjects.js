#!/usr/bin/env node
/**
 * 从 tools/管报科目模板.csv 生成 js/report/subjects.js
 *
 * 数据来源：《管报格式.xlsx》Sheet1，A:D 为一级~四级科目名称（Excel 合并单元格，
 * 读出来只有左上角有值），E 列为科目编码，共 201 条。
 *
 * 规则：
 * - 层级由编码长度决定：4/6/8/10 位 → 1/2/3/4 级（不用合并单元格机械推断）。
 * - 名称按列向下填充（合并单元格语义），但编码层级优先。
 * - 680103 这类「二级编码行同时写了三级文字」的行：name 取编码对应层级的文字，
 *   多出来的文字留在 path 里并记入 anomalies，绝不把二级编码改判为三级。
 * - 只做结构转换，不猜任何财务公式。
 *
 * 用法：node tools/gen-subjects.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, '管报科目模板.csv');
const OUT = path.join(ROOT, 'js', 'report', 'subjects.js');

const VERSION = 'management-v1';

/* 简单 CSV 解析：支持双引号包裹与转义双引号 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* 指标单位：数量类不能与金额混合汇总 */
function unitOf(name, pathArr) {
  const joined = pathArr.join('/');
  if (/订单量|销量/.test(name)) return 'quantity';
  if (/人数/.test(joined)) return 'headcount';
  return 'money';
}

const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
const header = rows.shift();
if (!header || header.length < 5) {
  console.error('表头解析失败：', header);
  process.exit(1);
}

const filled = ['', '', '', ''];
const subjects = [];
const anomalies = [];
const seen = new Set();

rows.forEach((r, i) => {
  const order = i + 1;
  const code = String(r[4] == null ? '' : r[4]).trim();
  if (!code) {
    console.error('第 ' + order + ' 行缺少科目编码');
    process.exit(1);
  }
  if (!/^\d{4}(\d{2}){0,3}$/.test(code)) {
    console.error('第 ' + order + ' 行编码格式不合法：' + code);
    process.exit(1);
  }
  if (seen.has(code)) {
    console.error('编码重复：' + code);
    process.exit(1);
  }
  seen.add(code);

  for (let c = 0; c < 4; c++) {
    const v = String(r[c] == null ? '' : r[c]).trim();
    if (v) {
      filled[c] = v;
      /* 合并单元格语义：上级出现新值时，更深的层级必须清空，避免串到下一棵子树 */
      for (let d = c + 1; d < 4; d++) filled[d] = '';
    }
  }
  const level = code.length / 2 - 1;
  const fullPath = filled.filter((v) => v !== '');

  /* 名称取「编码对应层级」的文字；该层缺失时退到最深一级 */
  let name = fullPath[level - 1] || fullPath[fullPath.length - 1] || code;
  const extra = fullPath.slice(level);
  if (fullPath.length !== level) {
    anomalies.push({ code, reason: '层级文字数与编码层级不一致', path: fullPath, levelByCode: level });
  }

  subjects.push({
    code,
    parentCode: level > 1 ? code.slice(0, -2) : '',
    level,
    name,
    path: fullPath,
    order,
    unit: unitOf(name, fullPath),
    alt: extra
  });
});

/* ---------- 校验 ---------- */
const codes = new Set(subjects.map((s) => s.code));
const problems = [];
subjects.forEach((s) => {
  if (s.level > 1 && !codes.has(s.parentCode)) problems.push('父编码不存在：' + s.code + ' → ' + s.parentCode);
});
if (subjects.length !== 201) problems.push('科目条数不是 201，实际 ' + subjects.length);
if (problems.length) {
  console.error('校验失败：\n' + problems.join('\n'));
  process.exit(1);
}

/* ---------- 输出 ---------- */
const tuple = subjects.map((s) => [
  s.code, s.parentCode, s.level, s.name, s.path.join('|'), s.unit, s.order,
  s.alt.length ? s.alt.join('|') : ''
]);

const body = tuple.map((t) => '    ' + JSON.stringify(t).replace(/","/g, '","')).join(',\n');

const out = `/* ===================================================================
 * 管报科目模板 ${VERSION}（201 条）
 * 由 tools/gen-subjects.js 从 tools/管报科目模板.csv 生成，请勿手工编辑。
 * 数据来源：《管报格式.xlsx》Sheet1（A:D 四级科目，E 科目编码）
 *
 * 元组字段：[编码, 父编码, 层级, 科目名称, 完整路径(|分隔), 单位, 模板顺序, 备用名称(|分隔)]
 * - 层级由编码长度决定（4/6/8/10 位 → 1/2/3/4 级），不由合并单元格推断
 * - 单位：money 金额 / quantity 数量 / headcount 人数，数量与金额不得混合汇总
 * - 模板顺序 order 从 1 开始，与 Excel 行序一致，管报必须按此顺序输出
 * =================================================================== */
(function () {
  var VERSION = '${VERSION}';
  var RAW = [
${body}
  ];

  var list = RAW.map(function (t) {
    return {
      code: t[0], parentCode: t[1], level: t[2], name: t[3],
      path: t[4] ? t[4].split('|') : [], unit: t[5], order: t[6],
      alt: t[7] ? t[7].split('|') : []
    };
  });

  var byCode = {};
  var byName = {};
  list.forEach(function (s) {
    byCode[s.code] = s;
    [s.name].concat(s.alt).forEach(function (n) {
      if (!n) return;
      byName[n] = byName[n] || [];
      if (byName[n].indexOf(s) < 0) byName[n].push(s);
    });
  });

  window.PA_REPORT_SUBJECTS = {
    version: VERSION,
    list: list,
    byCode: byCode,
    byName: byName,
    /* 同名不同编码的科目：必须按编码区分，不允许按名称合并 */
    duplicates: Object.keys(byName).filter(function (k) { return byName[k].length > 1; }),
    /* 模板结构异常行，仅供审计展示 */
    anomalies: ${JSON.stringify(anomalies, null, 2).replace(/\n/g, '\n    ')},
    size: list.length
  };
})();
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

console.log('已生成 ' + path.relative(ROOT, OUT));
console.log('科目条数：' + subjects.length);
console.log('层级分布：' + [1, 2, 3, 4].map((l) => l + '级=' + subjects.filter((s) => s.level === l).length).join(' '));
const nameCount = {};
subjects.forEach((s) => { nameCount[s.name] = (nameCount[s.name] || 0) + 1; });
const dups = Object.keys(nameCount).filter((k) => nameCount[k] > 1);
console.log('重名科目：' + (dups.length ? dups.map((k) => k + '×' + nameCount[k]).join('、') : '无'));
console.log('异常行：' + (anomalies.length ? anomalies.map((a) => a.code + '(' + a.reason + ')').join('、') : '无'));
