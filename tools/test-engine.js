/* ===================================================================
 * 月度计算引擎测试脚本（纯 Node，无依赖）
 * 运行：node tools/test-engine.js
 * 任一条断言失败 → 退出码 1
 * =================================================================== */
const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'report', 'engine.js'));

let passed = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push(name);
    console.error('  FAIL ' + name);
    console.error('       ' + (e && e.message ? e.message : e));
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || '值不相等') + '\n       实际: ' + a + '\n       期望: ' + b);
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/* ---------- 测试夹具 ---------- */

const SUBJ = {
  sales: { code: '1101', name: '销售收入', parentCode: null, level: 1, path: ['销售收入'], order: 1, unit: 'money' },
  fee: { code: '66020301', name: '平台费用', parentCode: '660203', level: 3, path: ['销售费用', 'Tiktok市场营销费用', '平台费用'], order: 60, unit: 'money' },
  commission: { code: '6602030101', name: '平台佣金', parentCode: '66020301', level: 4, path: ['销售费用', 'Tiktok市场营销费用', '平台费用', '平台佣金'], order: 64, unit: 'money' }
};

const TPL = [SUBJ.sales, SUBJ.fee, SUBJ.commission];

function fact(o) {
  return Object.assign({ month: '2026-01', data_type: '实际数', amount: 0 }, o || {});
}

function cell(matrix, code, period, type) {
  const row = matrix.rows.filter(function (r) { return r.code === code; })[0];
  if (!row) throw new Error('矩阵中找不到科目 ' + code);
  const key = period + '|' + (type || '实际数');
  return row.cells[key];
}

function diagOf(matrix, code) {
  return matrix.diagnostics.filter(function (d) { return d.code === code; });
}

/* ================================================================
 * 1. 期间解析
 * ================================================================ */
console.log('\n[1] normalizePeriod 期间解析');

t('2026-01 → year/month/key/label/sortKey', function () {
  const p = R.normalizePeriod({ month: '2026-01' });
  eq(p.key, '2026-01');
  eq(p.label, '2026-01');
  eq(p.year, 2026);
  eq(p.month, 1);
  eq(p.sortKey, 202601);
  eq(p.isLegacy, false);
});

t('2026/1 与 2026年1月 都归一为 2026-01', function () {
  eq(R.normalizePeriod({ month: '2026/1' }).key, '2026-01');
  eq(R.normalizePeriod({ month: '2026年1月' }).key, '2026-01');
});

t('1月 视为无年份，不归入任何年份', function () {
  const p = R.normalizePeriod({ month: '1月' });
  eq(p.key, 'LEGACY-M01');
  eq(p.year, null);
  eq(p.month, 1);
  eq(p.isLegacy, true);
  ok(p.label.indexOf('未标年份') >= 0, 'label 应标注未标年份，实际：' + p.label);
  eq(p.sortKey, 900001);
});

t('无年份排序键一定排在真实年份之后', function () {
  ok(R.normalizePeriod({ month: '1月' }).sortKey > R.normalizePeriod({ month: '2026-12' }).sortKey, '无年份应排在最后');
});

t('month 只有「1月」时用 period 的年份补齐', function () {
  const p = R.normalizePeriod({ month: '1月', period: '2026-01' });
  eq(p.key, '2026-01');
  eq(p.year, 2026);
});

t('无法解析 → LEGACY-UNKNOWN', function () {
  const p = R.normalizePeriod({ month: '不知道' });
  eq(p.key, 'LEGACY-UNKNOWN');
  eq(p.label, '期间未知');
  eq(p.year, null);
  eq(p.month, null);
});

/* ================================================================
 * 2. 筛选条件归一化
 * ================================================================ */
console.log('\n[2] normalizeFilters 筛选条件');

t('旧格式字符串 → 单元素数组', function () {
  const f = R.normalizeFilters({ month: '1月', site: 'ID' });
  eq(f.version, 2);
  eq(f.dimensions.month, ['1月']);
  eq(f.dimensions.site, ['ID']);
  eq(f.periodMode, 'monthly');
  eq(f.reportTemplateVersion, 'management-v1');
  eq(f.source, { mode: 'all', datasetId: null });
});

t('旧格式空字符串视为「该维度全部」', function () {
  const f = R.normalizeFilters({ month: '1月', brand: '', category: null });
  ok(!Object.prototype.hasOwnProperty.call(f.dimensions, 'brand'), 'brand 不应出现');
  ok(!Object.prototype.hasOwnProperty.call(f.dimensions, 'category'), 'category 不应出现');
  eq(f.dimensions.month, ['1月']);
});

t('新格式空数组 [] 必须保留（明确全不选）', function () {
  const f = R.normalizeFilters({ dimensions: { site: [] } });
  eq(f.dimensions.site, []);
});

t('undefined → 空维度、来源全部', function () {
  const f = R.normalizeFilters(undefined);
  eq(f.dimensions, {});
  eq(f.source, { mode: 'all', datasetId: null });
});

t('month 与 period 同时存在时以 month 为准', function () {
  const f = R.normalizeFilters({ month: '2026-01', period: '1月' });
  eq(f.dimensions.month, ['2026-01']);
});

t('month 为空时回落 period', function () {
  const f = R.normalizeFilters({ month: '', period: '1月' });
  eq(f.dimensions.month, ['1月']);
});

t('dataset 来源被保留', function () {
  const f = R.normalizeFilters({ source: { mode: 'dataset', datasetId: 12 } });
  eq(f.source, { mode: 'dataset', datasetId: 12 });
});

/* ================================================================
 * 3. 明细筛选
 * ================================================================ */
console.log('\n[3] filterFacts 明细筛选');

const rowsForFilter = [
  fact({ site: 'ID', platform: 'Tiktok', amount: 10 }),
  fact({ site: 'MY', platform: 'Tiktok', amount: 20 }),
  fact({ site: 'ID', platform: 'Amazon', amount: 30 }),
  fact({ site: 'MY', platform: 'Amazon', amount: 40 })
];

t('同维度 OR、跨维度 AND', function () {
  const f = R.normalizeFilters({ dimensions: { site: ['ID', 'MY'], platform: ['Tiktok'] } });
  const res = R.filterFacts(rowsForFilter, f);
  eq(res.facts.length, 2);
  eq(res.dropped, 2);
  const total = res.facts.reduce(function (s, r) { return s + r.amount; }, 0);
  eq(total, 30);
});

t('维度不存在 = 不限制', function () {
  const res = R.filterFacts(rowsForFilter, R.normalizeFilters(undefined));
  eq(res.facts.length, 4);
});

t('空数组 = 全不选 = 无匹配（不退回全部）', function () {
  const res = R.filterFacts(rowsForFilter, R.normalizeFilters({ dimensions: { site: [] } }));
  eq(res.facts, []);
  eq(res.dropped, 4);
});

t('月份筛选同时接受 2026-01 与 LEGACY-M01 写法', function () {
  const rows = [
    fact({ month: '2026-01', amount: 1 }),
    fact({ month: '1月', amount: 2 }),
    fact({ month: '2025-01', amount: 4 })
  ];
  const f = R.normalizeFilters({ dimensions: { month: ['2026-01', 'LEGACY-M01'] } });
  const res = R.filterFacts(rows, f);
  eq(res.facts.length, 2);
});

t('旧写法 month:"1月" 能匹配无年份明细', function () {
  const res = R.filterFacts([fact({ month: '1月', amount: 5 })], R.normalizeFilters({ month: '1月' }));
  eq(res.facts.length, 1);
});

t('subject 维度优先按编码匹配，其次按名称', function () {
  const rows = [
    fact({ subject_code: '1101', subject: '销售收入', amount: 1 }),
    fact({ subject_code: '6602030101', subject: '平台佣金', amount: 2 }),
    fact({ subject: '平台佣金', amount: 3 })
  ];
  const res = R.filterFacts(rows, R.normalizeFilters({ dimensions: { subject: ['平台佣金'] } }));
  eq(res.facts.length, 2); // 编码行 + 仅名称行
  const res2 = R.filterFacts(rows, R.normalizeFilters({ dimensions: { subject: ['6602030101'] } }));
  eq(res2.facts.length, 1);
});

t('筛选不修改传入数组与行对象', function () {
  const snapshot = JSON.stringify(rowsForFilter);
  R.filterFacts(rowsForFilter, R.normalizeFilters({ site: 'ID' }));
  eq(JSON.stringify(rowsForFilter), snapshot, '传入数据被修改了');
});

/* ================================================================
 * 4. 科目解析
 * ================================================================ */
console.log('\n[4] resolveSubject 科目解析');

const REG = {
  byCode: { '6602030101': SUBJ.commission },
  byName: { '平台佣金': [SUBJ.commission] },
  list: [SUBJ.commission]
};

t('编码命中 → match:code', function () {
  const r = R.resolveSubject({ subject_code: '6602030101' }, REG);
  eq(r, { code: '6602030101', name: '平台佣金', match: 'code', error: null, conflict: null });
});

t('编码查不到 → unknown_code，不降级按名称猜', function () {
  const r = R.resolveSubject({ subject_code: '0000', subject: '平台佣金' }, REG);
  eq(r, { code: null, name: null, match: null, error: 'unknown_code', conflict: null });
});

t('名称唯一命中 → match:name', function () {
  const r = R.resolveSubject({ subject: '平台佣金' }, REG);
  eq(r, { code: '6602030101', name: '平台佣金', match: 'name', error: null });
});

t('同名多条 → ambiguous_name（不任选一个）', function () {
  const dup = { list: [SUBJ.commission, Object.assign({}, SUBJ.commission, { code: '9002' })] };
  const r = R.resolveSubject({ subject: '平台佣金' }, dup);
  eq(r.error, 'ambiguous_name');
  eq(r.code, null);
});

t('名称不存在 → unknown_name', function () {
  eq(R.resolveSubject({ subject: '不存在科目' }, REG).error, 'unknown_name');
});

/* ================================================================
 * 5. 月度矩阵
 * ================================================================ */
console.log('\n[5] buildMonthlyMatrix 月度矩阵');

t('1月 100+20=120，2月 80，3月无数据补 0', function () {
  const facts = [
    fact({ month: '1月', subject_code: '6602030101', amount: 100 }),
    fact({ month: '1月', subject_code: '6602030101', amount: 20 }),
    fact({ month: '2月', subject_code: '6602030101', amount: 80 }),
    fact({ month: '3月', subject_code: '1101', amount: 50 }) // 让 3月列存在
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.columns.length, 3);
  eq(m.meta.periods, ['LEGACY-M01', 'LEGACY-M02', 'LEGACY-M03']);
  eq(cell(m, '6602030101', 'LEGACY-M01'), 120);
  eq(cell(m, '6602030101', 'LEGACY-M02'), 80);
  eq(cell(m, '6602030101', 'LEGACY-M03'), 0);
  eq(cell(m, '1101', 'LEGACY-M03'), 50);
  ok(m.rows.filter(function (r) { return r.code === '6602030101'; })[0].hasData === true, '有数据行 hasData 应为 true');
});

t('实际数与预算数分列，互不相加', function () {
  const facts = [
    fact({ month: '2026-01', data_type: '实际数', subject_code: '6602030101', amount: 100 }),
    fact({ month: '2026-01', data_type: '预算数', subject_code: '6602030101', amount: 60 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.columns.length, 2);
  eq(m.columns[0].data_type, '实际数');
  eq(m.columns[1].data_type, '预算数');
  eq(m.columns[0].label, '2026-01 实际数');
  eq(cell(m, '6602030101', '2026-01', '实际数'), 100);
  eq(cell(m, '6602030101', '2026-01', '预算数'), 60);
});

t('月份 1、2、10 按时间顺序排列（不能 1,10,2）', function () {
  const facts = ['2026-01', '2026-02', '2026-10'].map(function (mo) {
    return fact({ month: mo, subject_code: '6602030101', amount: 1 });
  });
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.columns.map(function (c) { return c.period; }), ['2026-01', '2026-02', '2026-10']);
});

t('两个年份的同一月份不混（2025-01 与 2026-01 分列）', function () {
  const facts = [
    fact({ month: '2025-01', subject_code: '6602030101', amount: 5 }),
    fact({ month: '2026-01', subject_code: '6602030101', amount: 7 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.columns.map(function (c) { return c.period; }), ['2025-01', '2026-01']);
  eq(cell(m, '6602030101', '2025-01'), 5);
  eq(cell(m, '6602030101', '2026-01'), 7);
});

t('无年份「1月」不并入任何年份', function () {
  const facts = [
    fact({ month: '2025-01', subject_code: '6602030101', amount: 100 }),
    fact({ month: '1月', subject_code: '6602030101', amount: 20 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.columns.map(function (c) { return c.period; }), ['2025-01', 'LEGACY-M01']);
  eq(cell(m, '6602030101', '2025-01'), 100);
  eq(cell(m, '6602030101', 'LEGACY-M01'), 20);
});

t('同名不同编码的科目不混合', function () {
  const tpl = [
    { code: '9001', name: '平台佣金', level: 4, path: ['a', '平台佣金'], order: 1 },
    { code: '9002', name: '平台佣金', level: 4, path: ['b', '平台佣金'], order: 2 }
  ];
  const facts = [
    fact({ subject_code: '9001', amount: 100 }),
    fact({ subject_code: '9002', amount: 200 }),
    fact({ subject: '平台佣金', amount: 999 }) // 无编码、同名 → 歧义，不得任选
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: tpl });
  eq(m.rows[0].code, '9001');
  eq(cell(m, '9001', '2026-01'), 100);
  eq(cell(m, '9002', '2026-01'), 200);
  eq(diagOf(m, 'ambiguous_name')[0].count, 1);
  eq(m.meta.usedFactCount, 2);
});

t('父级与子级同时有数据时不重复计入', function () {
  const facts = [
    fact({ subject_code: '66020301', amount: 10 }),   // 父：平台费用
    fact({ subject_code: '6602030101', amount: 100 }) // 子：平台佣金
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(cell(m, '66020301', '2026-01'), 10);
  eq(cell(m, '6602030101', '2026-01'), 100);
});

t('负数保留原符号', function () {
  const facts = [
    fact({ subject_code: '6602030101', amount: -50 }),
    fact({ subject_code: '6602030101', amount: -50 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(cell(m, '6602030101', '2026-01'), -100);
});

t('缺失组合补 0 且 hasData=false', function () {
  const facts = [fact({ subject_code: '6602030101', amount: 10 })];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  const salesRow = m.rows.filter(function (r) { return r.code === '1101'; })[0];
  eq(salesRow.cells['2026-01|实际数'], 0);
  eq(salesRow.hasData, false);
});

t('未知编码进 diagnostics 且不计入任何行', function () {
  const facts = [
    fact({ subject_code: '6602030101', amount: 100 }),
    fact({ subject_code: '9999', amount: 500 }),
    fact({ subject_code: '9999', amount: 500 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(cell(m, '6602030101', '2026-01'), 100);
  const d = diagOf(m, 'unknown_code');
  eq(d.length, 1);
  eq(d[0].count, 2);
  eq(d[0].level, 'error');
  eq(m.meta.usedFactCount, 1);
  const total = m.rows.reduce(function (s, r) {
    return s + Object.keys(r.cells).reduce(function (x, k) { return x + r.cells[k]; }, 0);
  }, 0);
  eq(total, 100, '未知编码的 1000 不应进入矩阵');
});

t('空数组筛选返回全 0 矩阵，note 说明无匹配', function () {
  const facts = [fact({ subject_code: '6602030101', amount: 100 })];
  const f = R.normalizeFilters({ dimensions: { month: [] } });
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL, filters: f });
  eq(m.columns, []);
  eq(m.meta.usedFactCount, 0);
  ok(/无匹配/.test(m.meta.note), 'note 应说明无匹配，实际：' + m.meta.note);
  m.rows.forEach(function (r) {
    eq(r.hasData, false);
    Object.keys(r.cells).forEach(function (k) { eq(r.cells[k], 0); });
  });
});

t('金额精度：0.1 + 0.2 = 0.3', function () {
  const facts = [
    fact({ subject_code: '6602030101', amount: 0.1 }),
    fact({ subject_code: '6602030101', amount: 0.2 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(cell(m, '6602030101', '2026-01'), 0.3);
  ok(cell(m, '6602030101', '2026-01') === 0.3, '应严格等于 0.3，避免浮点误差');
});

t('选中但没有明细的月份仍保留列并补 0', function () {
  const facts = [fact({ month: '2026-01', subject_code: '6602030101', amount: 1 })];
  const f = R.normalizeFilters({ dimensions: { month: ['2026-01', '2026-02', '2026-03'] } });
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL, filters: f });
  /* 计划书 §C.3：选中哪些月份就生成哪些月份，不能因为没有明细就丢掉列 */
  eq(m.columns.map(function (c) { return c.period; }), ['2026-01', '2026-02', '2026-03']);
  eq(cell(m, '6602030101', '2026-02'), 0);
});

t('选中月份与 facts 交集：筛选外月份不进列', function () {
  const facts = [
    fact({ month: '2026-01', subject_code: '6602030101', amount: 1 }),
    fact({ month: '2026-02', subject_code: '6602030101', amount: 2 })
  ];
  const f = R.normalizeFilters({ dimensions: { month: ['2026-02'] } });
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL, filters: f });
  eq(m.columns.map(function (c) { return c.period; }), ['2026-02']);
  eq(cell(m, '6602030101', '2026-02'), 2);
});

t('行顺序严格等于模板顺序', function () {
  const facts = [fact({ subject_code: '1101', amount: 1 })];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.rows.map(function (r) { return r.code; }), ['1101', '66020301', '6602030101']);
});

t('不支持的归集规则回退 direct 并进 diagnostics', function () {
  const facts = [fact({ subject_code: '6602030101', amount: 10 })];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL, rules: { subjectRule: 'profit' } });
  eq(cell(m, '6602030101', '2026-01'), 10);
  eq(diagOf(m, 'unsupported_rule')[0].level, 'error');
});

t('非法金额进 diagnostics 且不计入', function () {
  const facts = [
    fact({ subject_code: '6602030101', amount: 10 }),
    fact({ subject_code: '6602030101', amount: 'abc' })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(cell(m, '6602030101', '2026-01'), 10);
  eq(diagOf(m, 'invalid_amount')[0].count, 1);
});

t('矩阵计算不修改 facts 行对象', function () {
  const facts = [
    fact({ month: '2025-01', subject_code: '6602030101', amount: -3 }),
    fact({ month: '1月', subject_code: '6602030101', amount: 4 })
  ];
  const snapshot = JSON.stringify(facts);
  R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(JSON.stringify(facts), snapshot, '矩阵计算修改了传入数据');
});

t('meta 字段齐全', function () {
  const facts = [
    fact({ month: '2026-01', data_type: '实际数', subject_code: '6602030101', amount: 10 }),
    fact({ month: '2026-02', data_type: '预算数', subject_code: '6602030101', amount: 20 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  eq(m.meta.factCount, 2);
  eq(m.meta.usedFactCount, 2);
  eq(m.meta.columnsCount, 4); // 2 个期间 × 2 类数据（笛卡尔列，缺数据补 0）
  eq(m.meta.subjectCount, 3);
  eq(cell(m, '6602030101', '2026-01', '预算数'), 0);
  eq(m.meta.dataTypes, ['实际数', '预算数']);
  eq(m.meta.periods, ['2026-01', '2026-02']);
  eq(m.meta.source, { mode: 'all', datasetId: null });
  eq(m.meta.periodMode, 'monthly');
  ok(typeof m.meta.note === 'string' && m.meta.note.length > 0, 'note 不能为空');
});

/* ================================================================
 * 6. 趋势
 * ================================================================ */
console.log('\n[6] buildTrend 趋势');

t('labels 按列顺序，values 缺失补 0', function () {
  const facts = [
    fact({ month: '2026-02', subject_code: '6602030101', amount: 20 }),
    fact({ month: '2026-01', subject_code: '6602030101', amount: 10 }),
    fact({ month: '2026-02', data_type: '预算数', subject_code: '6602030101', amount: 99 })
  ];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  const tr = R.buildTrend({ matrix: m, codes: ['6602030101'], data_type: '实际数' });
  eq(tr.labels, ['2026-01 实际数', '2026-02 实际数']);
  eq(tr.series.length, 1);
  eq(tr.series[0].values, [10, 20]);
  eq(tr.series[0].name, '平台佣金');
});

t('codes 为空时输出全部科目行', function () {
  const facts = [fact({ subject_code: '1101', amount: 1 })];
  const m = R.buildMonthlyMatrix({ facts: facts, template: TPL });
  const tr = R.buildTrend({ matrix: m, data_type: '实际数' });
  eq(tr.series.length, 3);
  eq(tr.series[2].values, [0]);
});

/* ================================================================
 * 7. 金额格式化
 * ================================================================ */
console.log('\n[7] fmtAmount 金额格式化');

t('千分位两位小数', function () {
  eq(R.fmtAmount(1234567.891), '1,234,567.89');
  eq(R.fmtAmount(-1234567.891), '-1,234,567.89');
  eq(R.fmtAmount(0), '0.00');
  eq(R.fmtAmount(-0), '0.00');
  eq(R.fmtAmount(null), '0.00');
  eq(R.fmtAmount(1234.5), '1,234.50');
});

/* ================================================================
 * 8. 父级汇总（rollup）与层级过滤
 * ================================================================ */
console.log('\n[8] 父级汇总与层级过滤');

/* 编码前缀自洽的模板：6602 ⊃ 660201 ⊃ 6602010101；6601 下挂 headcount 的人数 */
const RT = [
  { code: '6602', name: '销售费用', level: 1, path: ['销售费用'], order: 1, unit: 'money' },
  { code: '660201', name: '线上推广', level: 2, path: ['销售费用', '线上推广'], order: 2, unit: 'money' },
  { code: '6602010101', name: '平台佣金', level: 4, path: ['销售费用', '线上推广', '平台费用', '平台佣金'], order: 3, unit: 'money' },
  { code: '6601', name: '管理费用', level: 1, path: ['管理费用'], order: 4, unit: 'money' },
  { code: '660101', name: '人数', level: 2, path: ['管理费用', '人数'], order: 5, unit: 'headcount' }
];

const RF = [
  fact({ subject_code: '6602', amount: 10 }),
  fact({ subject_code: '660201', amount: 100 }),
  fact({ subject_code: '6602010101', amount: 50 }),
  fact({ subject_code: '6601', amount: 1000 }),
  fact({ subject_code: '660101', amount: 191 })
];

t('rollup：父级 = 自身 + 同单位子孙（不重复计入孙级的孙级）', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'rollup' } });
  eq(cell(m, '660201', '2026-01'), 150, '二级 = 100 + 50');
  eq(cell(m, '6602', '2026-01'), 160, '一级 = 10 + 100 + 50');
});

t('rollup：人数(headcount) 不会被加进金额科目', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'rollup' } });
  eq(cell(m, '6601', '2026-01'), 1000, '管理费用只含自身金额，未含 191 人数');
  eq(cell(m, '660101', '2026-01'), 191, '人数行仍显示 191');
});

t('rollup：跨单位排除会给出诊断，不静默', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'rollup' } });
  ok(diagOf(m, 'mixed_unit_skipped').length === 1, '应有 mixed_unit_skipped 诊断');
});

t('direct 仍是默认，父级只算自身', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT });
  eq(cell(m, '6602', '2026-01'), 10, 'direct 下 6602 只等于自身');
  eq(cell(m, '660201', '2026-01'), 100);
});

t('levels=[1] 只输出一级科目行', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'rollup', levels: [1] } });
  eq(m.rows.map(function (r) { return r.code; }), ['6602', '6601']);
  eq(cell(m, '6602', '2026-01'), 160, '一级仍显示汇总值');
});

t('levels=[1,2] 输出一级与二级，顺序与模板一致', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'rollup', levels: [1, 2] } });
  eq(m.rows.map(function (r) { return r.code; }), ['6602', '660201', '6601', '660101']);
});

t('levels 支持字符串与非法值', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { levels: '3,4,9,x' } });
  eq(m.rows.map(function (r) { return r.code; }), ['6602010101'], '只保留四级行');
});

t('levels=[] 视为不限制', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { levels: [] } });
  eq(m.rows.length, 5);
});

t('rollup 下负数仍保留符号', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject_code: '660201', amount: -30 }), fact({ subject_code: '6602010101', amount: 10 })],
    template: RT, rules: { subjectRule: 'rollup', levels: [1] }
  });
  eq(cell(m, '6602', '2026-01'), -20);
});

t('未知规则回退 direct 并报 unsupported_rule', function () {
  const m = R.buildMonthlyMatrix({ facts: RF, template: RT, rules: { subjectRule: 'gross_margin' } });
  eq(cell(m, '6602', '2026-01'), 10);
  ok(diagOf(m, 'unsupported_rule').length === 1);
});

/* ================================================================
 * 9. 期间矩阵（经营分析报表）
 * ================================================================ */
console.log('\n[9] buildPeriodMatrix 期间矩阵');

const PT = [
  { code: '6001', name: '销售收入', level: 1, path: ['销售收入'], order: 1, unit: 'money' },
  { code: '600101', name: '发货GMV', level: 2, path: ['销售收入', '发货GMV'], order: 2, unit: 'money' },
  { code: '6602', name: '销售费用', level: 1, path: ['销售费用'], order: 3, unit: 'money' },
  { code: '660201', name: '线上推广', level: 2, path: ['销售费用', '线上推广'], order: 4, unit: 'money' }
];

const PF = [
  fact({ month: '2026-03', subject_code: '6001', amount: 1000 }),
  fact({ month: '2026-03', subject_code: '600101', amount: 600 }),
  fact({ month: '2026-04', subject_code: '6001', amount: 800 }),
  fact({ month: '2026-04', subject_code: '660201', amount: 300 }),
  /* 预算数绝不能被加进同一列 */
  fact({ month: '2026-03', subject_code: '6001', amount: 9999, data_type: '预算数' })
];

t('列 = 月份（时间升序），不含数据类型', function () {
  const m = R.buildPeriodMatrix({ facts: PF, template: PT });
  eq(m.columns.map(function (c) { return c.key; }), ['2026-03', '2026-04']);
});

t('每行有 total，等于各月之和', function () {
  const m = R.buildPeriodMatrix({ facts: PF, template: PT });
  const row = m.rows.filter(function (r) { return r.code === '6001'; })[0];
  eq(row.total, 2400, '(1000 + 600) + 800，含下级汇总');
  eq(row.cells['2026-03'], 1600, '预算数 9999 未混入，且含 600101');
});

t('父级汇总生效：6001 = 自身 + 600101', function () {
  const m = R.buildPeriodMatrix({ facts: PF, template: PT });
  const row = m.rows.filter(function (r) { return r.code === '6001'; })[0];
  eq(row.cells['2026-03'], 1600, '1000 + 600');
});

t('basis 取销售收入合计，供占比计算', function () {
  const m = R.buildPeriodMatrix({ facts: PF, template: PT });
  eq(m.basis.code, '6001');
  eq(m.basis.found, true);
  eq(m.basis.total, 2400, '含 600101');
});

t('levels 裁行但 basis 仍是全量', function () {
  const m = R.buildPeriodMatrix({ facts: PF, template: PT, rules: { levels: [2] } });
  eq(m.rows.map(function (r) { return r.code; }), ['600101', '660201']);
  eq(m.basis.total, 2400, 'basis 不因裁行而丢');
});

t('空数组（全不选）→ 全 0 且不报错', function () {
  const m = R.buildPeriodMatrix({
    facts: PF, template: PT,
    filters: { version: 2, source: { mode: 'all', datasetId: null }, dimensions: { site: [] } }
  });
  const row = m.rows.filter(function (r) { return r.code === '6001'; })[0];
  eq(row.total, 0);
  ok(m.meta.note.indexOf('无匹配数据') >= 0);
});

/* ================================================================
 * 10. 编码与名称冲突（旧编码遗留数据）
 * ================================================================ */
console.log('\n[10] 编码/名称冲突');

const CT = [
  { code: '4102', name: '产品毛利', level: 1, path: ['产品毛利'], order: 1, unit: 'money' },
  { code: '4103', name: '销售毛利-内核法', level: 1, path: ['销售毛利-内核法'], order: 2, unit: 'money' }
];

t('编码命中但名称指向别的编码 → 进 code_name_conflict，仍按编码归集', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject_code: '4102', subject: '销售毛利-内核法', amount: 10 })],
    template: CT
  });
  eq(cell(m, '4102', '2026-01'), 10, '金额按编码归到 4102');
  eq(cell(m, '4103', '2026-01'), 0, '未被名称拉到 4103');
  ok(diagOf(m, 'code_name_conflict').length === 1, '应报 code_name_conflict');
});

t('编码与名称一致时不报冲突', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject_code: '4102', subject: '产品毛利', amount: 10 })],
    template: CT
  });
  ok(diagOf(m, 'code_name_conflict').length === 0, '一致则无诊断');
});

/* ================================================================
 * 11. 只认编码归集（subjectKey='code'）
 * ================================================================ */
console.log('\n[11] 只认编码归集');

/* 两个同名四级科目：按名称归集会并成一笔，按编码则必须分开 */
const DUP = [
  { code: '6602010101', name: '平台佣金', level: 4, path: ['销售费用', 'A', '平台费用', '平台佣金'], order: 1, unit: 'money' },
  { code: '6602030101', name: '平台佣金', level: 4, path: ['销售费用', 'B', '平台费用', '平台佣金'], order: 2, unit: 'money' },
  { code: '6001', name: '销售收入', level: 1, path: ['销售收入'], order: 3, unit: 'money' }
];

t('同名不同编码：编码口径下各自归集，不合并', function () {
  const m = R.buildMonthlyMatrix({
    facts: [
      fact({ subject_code: '6602010101', subject: '平台佣金', amount: 100 }),
      fact({ subject_code: '6602030101', subject: '平台佣金', amount: 20 })
    ],
    template: DUP, rules: { subjectKey: 'code' }
  });
  eq(cell(m, '6602010101', '2026-01'), 100);
  eq(cell(m, '6602030101', '2026-01'), 20);
});

t('只有名称（唯一）没有编码：不归集，报 missing_code', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject: '销售收入', amount: 50 })],
    template: DUP, rules: { subjectKey: 'code' }
  });
  eq(cell(m, '6001', '2026-01'), 0, '不得按名称归集');
  ok(diagOf(m, 'missing_code').length === 1, '应报 missing_code');
});

t('只有名称且重名：报 ambiguous_name，不任选一个', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject: '平台佣金', amount: 50 })],
    template: DUP, rules: { subjectKey: 'code' }
  });
  eq(cell(m, '6602010101', '2026-01'), 0);
  eq(cell(m, '6602030101', '2026-01'), 0);
  ok(diagOf(m, 'ambiguous_name').length >= 1, '应报 ambiguous_name');
});

t('缺失编码不会静默计入总额', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject_code: '6602010101', amount: 10 }), fact({ subject: '平台佣金', amount: 999 })],
    template: DUP, rules: { subjectKey: 'code' }
  });
  const total = m.rows.reduce(function (a, r) { return a + (r.cells['2026-01|实际数'] || 0); }, 0);
  eq(total, 10, '999 未混入任何行');
});

t('默认 auto 仍兼容名称唯一匹配（不改变旧行为）', function () {
  const m = R.buildMonthlyMatrix({
    facts: [fact({ subject_code: '6602010101', amount: 10 })],
    template: DUP
  });
  eq(cell(m, '6602010101', '2026-01'), 10);
});

/* ================================================================ */
setTimeout(function () {
  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    console.log('失败用例：');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  console.log('全部通过');
}, 0);
