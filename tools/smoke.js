#!/usr/bin/env node
/**
 * 集成冒烟测试：在没有浏览器的情况下加载 config.js + core.js + subjects.js + engine.js，
 * 验证「筛选 → 计算 → 模板行」这一条链路，以及 M1 的科目编码解析。
 *
 * 用法：node tools/smoke.js
 * 注意：这里只验证数据链路，不替代浏览器里的交互验证（多选面板、首次生成、切空间）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---------------- 最小 DOM / 云 SDK 桩 ---------------- */
function fakeEl() {
  const el = {
    value: '', textContent: '', innerHTML: '', disabled: false,
    style: {}, dataset: {}, selectedOptions: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, focus() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return fakeEl(); }, querySelectorAll() { return []; }
  };
  return el;
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: require('crypto').webcrypto,
  location: { href: 'http://localhost/', search: '', pathname: '/', origin: 'http://localhost' },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  URLSearchParams,
  document: {
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return fakeEl(); }
  },
  WorkBuddyCloud: {
    createWorkBuddyCloud() {
      return {
        auth: { getSession: async () => ({ data: null }) },
        database: { from() { return {}; } },
        llm: { models: { list: async () => [] } }
      };
    }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

['js/config.js', 'js/core.js', 'js/report/subjects.js', 'js/report/engine.js'].forEach(load);

const P = sandbox.PA;
const R = sandbox.PAReport;
const REG = sandbox.PA_REPORT_SUBJECTS;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, '期望 ' + b + '，实际 ' + a); }

/* ---------------- 1. 科目注册表 ---------------- */
console.log('\n[1] 科目模板');
ok(!!REG, '注册表已加载');
eq(REG.size, 211, '科目条数 = 211（2026-11-18 版模板）');
eq(REG.list.filter((s) => s.level === 1).length, 21, '一级科目 21 条');
eq(REG.list.filter((s) => s.level === 4).length, 95, '四级科目 95 条');
eq(REG.byCode['6001'].name, '销售收入', '6001 = 销售收入');
eq(REG.byCode['680103'].level, 2, '680103 按编码判定为二级');
eq(REG.byCode['680103'].name, '进口成本预缴增值税', '680103 名称取二级文字');
eq(REG.byCode['680103'].path.length, 3, '680103 保留三级文字在路径中');
ok(REG.duplicates.indexOf('平台佣金') >= 0, '同名科目「平台佣金」被标记为重复');
ok(REG.list.every((s, i) => s.order === i + 1), '模板顺序连续（1..211）');

/* ---------------- 2. 筛选语义 ---------------- */
console.log('\n[2] 筛选语义');
const rows = [
  { month: '2026-01', data_type: '实际数', site: 'ID', platform: 'Tiktok', subject: '销售收入', subject_code: '6001', amount: 100 },
  { month: '2026-01', data_type: '实际数', site: 'ID', platform: 'Tiktok', subject: '销售收入', subject_code: '6001', amount: 20 },
  { month: '2026-02', data_type: '实际数', site: 'MY', platform: 'Shopee', subject: '销售收入', subject_code: '6001', amount: 80 },
  { month: '2026-01', data_type: '预算数', site: 'ID', platform: 'Tiktok', subject: '销售收入', subject_code: '6001', amount: 150 },
  { month: '1月', data_type: '实际数', site: 'ID', platform: 'Tiktok', subject: '订单量', subject_code: '1001', amount: 7, unit: 'quantity' }
];

const s1 = R.normalizeFilters({ dimensions: { site: ['ID', 'MY'], data_type: ['实际数'] } });
eq(R.filterFacts(rows, s1).facts.length, 4, '同维度 OR + 跨维度 AND（含无年份的 ID 实际数行）');

const s2 = R.normalizeFilters({ dimensions: { site: [] } });
eq(R.filterFacts(rows, s2).facts.length, 0, '全不选（[]）返回无匹配，不退回全部');

const s3 = R.normalizeFilters({ site: 'ID' });
eq(s3.dimensions.site.length, 1, '旧字符串迁移为单元素数组');

const s4 = R.normalizeFilters({ site: '' });
ok(!('site' in s4.dimensions), '旧空串视为「全部」并删除该键');

const s5 = R.normalizeFilters({ month: '2026-01', period: '2026-02' });
eq(s5.dimensions.month[0], '2026-01', 'month 与 period 冲突时以 month 为准');

/* ---------------- 3. 月度矩阵 ---------------- */
console.log('\n[3] 月度矩阵');
const m = R.buildMonthlyMatrix({
  facts: rows,
  template: REG.list,
  filters: R.normalizeFilters({ dimensions: { month: ['2026-01', '2026-02', '2026-03'], data_type: ['实际数', '预算数'] } }),
  rules: { subjectRule: 'direct' }
});
eq(m.rows.length, 211, '管报行数 = 211（模板完整保留）');
eq(m.columns.length, 6, '3 个月 × 2 个数据类型 = 6 列');
const colKeys = m.columns.map((c) => c.key);
eq(colKeys[0], '2026-01|实际数', '同月内数据类型按 实际→预算 固定顺序');
eq(colKeys[1], '2026-01|预算数', '第 2 列为预算');
eq(colKeys[2], '2026-02|实际数', '月份按时间升序');

const rev = m.rows.find((r) => r.code === '6001');
eq(rev.cells['2026-01|实际数'], 120, '1月实际 100+20=120');
eq(rev.cells['2026-02|实际数'], 80, '2月实际 80');
eq(rev.cells['2026-03|实际数'], 0, '3月无数据补 0');
eq(rev.cells['2026-01|预算数'], 150, '预算单独成列，不与实际相加');

const qty = m.rows.find((r) => r.code === '1001');
eq(qty.cells['2026-01|实际数'], 0, '无年份的「1月」数据不并入 2026-01');
ok(REG.byCode['1001'].unit === 'quantity', '订单量标记为数量单位，不与金额混合');

const empty = R.buildMonthlyMatrix({
  facts: [], template: REG.list,
  filters: R.normalizeFilters({ dimensions: { month: [] } }),
  rules: { subjectRule: 'direct' }
});
eq(empty.rows.length, 211, '空筛选仍输出 211 行');
ok(empty.rows.every((r) => Object.keys(r.cells).every((k) => r.cells[k] === 0)), '空筛选全部补 0');
ok(/无匹配/.test(empty.meta.note || ''), '空矩阵 meta 注明无匹配数据');

const unknownFacts = rows.concat([
  { month: '2026-01', data_type: '实际数', site: 'ID', platform: 'Tiktok', subject: '不存在的科目', subject_code: '9999999999', amount: 66 }
]);
const mu = R.buildMonthlyMatrix({
  facts: unknownFacts, template: REG.list,
  filters: R.normalizeFilters({ dimensions: { month: ['2026-01'] } }),
  rules: { subjectRule: 'direct' }
});
const total = mu.rows.reduce((a, r) => a + (r.cells['2026-01|实际数'] || 0), 0);
eq(total, 120, '未知编码不计入任何行（实际数合计仍为 120）');
const totalBudget = mu.rows.reduce((a, r) => a + (r.cells['2026-01|预算数'] || 0), 0);
eq(totalBudget, 150, '预算单独成列，未知编码的 66 不落到任何列');
ok(mu.diagnostics.some((d) => d.code === 'unknown_code'), '未知编码进入 diagnostics');

const amb = R.buildMonthlyMatrix({
  facts: [{ month: '2026-01', data_type: '实际数', subject: '平台佣金', amount: 50 }],
  template: REG.list,
  filters: R.normalizeFilters({ dimensions: { month: ['2026-01'] } }),
  rules: { subjectRule: 'direct' }
});
ok(amb.diagnostics.some((d) => d.code === 'ambiguous_name'), '同名科目按名称归集时报歧义，不任选一个');

/* ---------------- 4. M1 科目编码解析 ---------------- */
console.log('\n[4] M1 导入兼容');
if (typeof P.resolveSubjectValue === 'function') {
  const a = P.resolveSubjectValue('6602030101');
  eq(a.match, 'code', '编码命中注册表');
  eq(a.name, '平台佣金', '编码转名称');
  const b = P.resolveSubjectValue('平台佣金');
  eq(b.error, 'ambiguous_name', '重名科目返回歧义');
  ok(b.candidates && b.candidates.length >= 2, '歧义返回候选编码');
  const c = P.resolveSubjectValue('不存在的科目');
  eq(c.error, 'unknown_name', '未知名称报错而不是静默通过');
  const d = P.resolveSubjectValue('9999999999');
  eq(d.error, 'unknown_code', '未知编码报错，不降级按名称猜');
} else {
  fail++; console.log('  FAIL js/core.js 未提供 resolveSubjectValue');
}

if (typeof P.cleanRows === 'function') {
  const raw = [
    ['月份', '数据类型', '站点/国家', '平台', '渠道', '素材来源', '品牌', '品类', '报表产品', '科目编码', '金额'],
    ['2026-01', '实际数', 'ID', 'Tiktok', 'tt自播', '自制', 'GMEELAN', '底妆', '黑气垫', '6001', '1000'],
    ['2026-01', '实际数', 'ID', 'Tiktok', 'tt自播', '自制', 'GMEELAN', '底妆', '黑气垫', '6602030101', '200']
  ];
  const cleaned = P.cleanRows(raw);
  eq(cleaned.rows.length, 2, '编码导入 2 行');
  eq(cleaned.rows[0].subject_code, '6001', '第一行写入 subject_code');
  eq(cleaned.rows[0].subject, '销售收入', '第一行科目名转换为标准名');
  eq(cleaned.rows[1].subject_code, '6602030101', '第二行保留四级编码');
  eq(cleaned.rows[1].subject, '平台佣金', '第二行名称取注册表名称');
  eq(P.resolveSubjectPath(['销售费用', '线上货架站内推广费用', '平台费用', '平台佣金']).code, '6602010101', '完整路径可唯一定位（解决重名）');
  eq(P.resolveSubjectPath(['销售费用', 'Tiktok市场营销费用', '平台费用', '平台佣金']).code, '6602030101', '同名不同树的两条路径分别定位到不同编码');

  /* 旧 4 位编码已停用：不再按旧名称回退，必须报出来 */
  const legacyRaw = [
    ['月份', '数据类型', '站点/国家', '平台', '渠道', '素材来源', '品牌', '品类', '报表产品', '科目编码', '金额'],
    ['2026-01', '实际数', 'ID', 'Tiktok', 'tt自播', '自制', 'GMEELAN', '底妆', '黑气垫', '1101', '1000']
  ];
  const legacy = P.cleanRows(legacyRaw);
  eq(legacy.rows[0].subject_code, '', '旧编码 1101 不再写入 subject_code');
  ok((legacy.issues || []).some((m) => String(m).indexOf('旧版科目编码已停用') >= 0), '导入时报「旧版科目编码已停用」');
  eq(P.resolveSubjectValue('1101').error, 'unknown_code', 'resolveSubjectValue 对旧编码返回 unknown_code');
  eq(P.resolveSubjectValue('1101').hint, 'legacy_code', '并标记为 legacy_code');
  eq(P.subjectCodeToName('1101'), null, '字典里不再有旧编码别名');
} else {
  fail++; console.log('  FAIL js/core.js 未提供 cleanRows');
}

/* ---------------- 旧数据补编码（v0.13.1：存量数据没有 subject_code） ---------------- */
if (P.backfillSubjectCodes && P.reportRegistry()) {
  const legacy = [
    { subject: '销售收入', amount: 1 },
    { subject: '平台佣金', amount: 2 },
    { subject: '并不存在的科目', amount: 3 },
    { subject: '销售收入', subject_code: '6001', amount: 4 }
  ];
  const st = P.backfillSubjectCodes(legacy);
  eq(st.filled, 1, '名称唯一 → 只补 1 行');
  eq(legacy[0].subject_code, '6001', '销售收入按名称补到 6001');
  eq(st.ambiguous, 1, '重名科目计入歧义，不猜');
  ok(!legacy[1].subject_code, '平台佣金 保持空编码（不猜）');
  eq(st.unknown, 1, '注册表里没有的名称计入未知');
  ok(!legacy[2].subject_code, '未知名称不写编码');
  eq(legacy[3].subject_code, '6001', '已有编码的行不受影响');
  eq(legacy[3].amount, 4, '补码不改动金额');
}

/* ---------------- 数据视图权限（不得随模板换版而放宽） ---------------- */
if (P.visibleSubjectCodes) {
  const savedView = P.state.dataView, savedRole = P.state.role;
  P.state.dataView = 'business'; P.state.role = 'editor';
  const codes = P.visibleSubjectCodes() || [];
  eq(codes.length, 24, '业务端可见编码 24 个（19 个名称，含 6402 成本子树的 5 个同名明细）');
  ok(codes.indexOf('6602') >= 0, '业务端可见销售费用小计');
  ok(codes.indexOf('6602010101') < 0, '业务端看不到平台佣金等明细（未放宽）');
  ok(codes.indexOf('9002') < 0, '业务端看不到净利润');
  ok(codes.indexOf('660101') < 0, '业务端看不到人数');
  P.state.dataView = 'management'; P.state.role = 'owner';
  ok(P.visibleSubjectCodes() === null, '管理层视图全部可见');
  P.state.dataView = savedView; P.state.role = savedRole;
}

/* ---------------- 汇总 ---------------- */
console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('存在失败项'); process.exit(1); }
console.log('集成冒烟通过');
