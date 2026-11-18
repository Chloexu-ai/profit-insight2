#!/usr/bin/env node
/**
 * 界面级验证：用无头 Chrome 打开 tools/harness.html，通过 ?act= 触发一次真实交互，
 * 再解析渲染后的 DOM 做断言。验证的是「模块真的渲染出东西」，不只是入口存在。
 *
 * 用法：node tools/verify-ui.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HARNESS = 'file:///' + path.join(ROOT, 'tools', 'harness.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function count(hay, needle) { return hay.split(needle).length - 1; }
/* 取某个维度触发器的摘要文字（复选框的 checked 属性不会出现在 dump-dom 里，只能看文案） */
function summaryOf(dom, k) {
  const m = dom.match(new RegExp('data-ms-trigger="' + k + '"[^>]*>\\s*<span class="ms-summary">([^<]*)</span>'));
  return m ? m[1] : null;
}

function dump(act) {
  const url = HARNESS + (act ? '?act=' + act : '');
  const out = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--dump-dom', '--virtual-time-budget=6000', '--window-size=1600,1400', url
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
  return out;
}

/* ---------------- 1. 默认态：筛选栏 ---------------- */
console.log('\n[1] 默认渲染');
let dom = dump('');
ok(dom.indexOf('ms-trigger') >= 0, '多选筛选控件已渲染');
ok(count(dom, 'class="ms-filter"') >= 5, '业务维度数量 ≥ 5（实际 ' + count(dom, 'class="ms-filter"') + '）');
ok(dom.indexOf('m3-views') >= 0, '视图切换入口存在');
/* 样本 8 行里有 2 行预算数，v0.11 关闭预算后应剩 6 行 */
ok(dom.indexOf('筛选后 7 行明细') >= 0, '筛选统计显示 7 行明细（样本 8 行中 1 行预算数已排除）');
ok(dom.indexOf('全部') >= 0, '未限制维度摘要显示「全部」');
ok(dom.indexOf('widget-grid') < 0, '空看板时不渲染组件容器（应显示空态提示）');
ok(dom.indexOf('选择上方模板一键生成图表') >= 0, '空态提示可见');

/* ---------------- 2. 首次一键生成（回归 bug） ---------------- */
console.log('\n[2] 首次一键生成模板');
dom = dump('tpl');
ok(count(dom, 'widget-grid') > 0, '生成后组件容器存在');
ok(count(dom, 'class="widget ') >= 7, '生成 7 个组件（实际 ' + count(dom, 'class="widget ') + '）');
ok(dom.indexOf('kpi-value') >= 0, '指标卡已渲染数值');
ok(dom.indexOf('<canvas') >= 0, '图表 canvas 已创建');
ok(dom.indexOf('canvas') >= 0 && dom.indexOf('kpi-label') >= 0, '组件内容非空');

/* ---------------- 3. 科目月度对比 ---------------- */
console.log('\n[3] 科目月度对比视图');
dom = dump('matrix');
ok(dom.indexOf('rpt-table') >= 0, '矩阵表格已渲染');
ok(count(dom, '<tr') >= 200, '包含 201 条模板行（实际 ' + count(dom, '<tr') + ' 行）');
/* 只在该表格内部判断顺序，避免被元信息条里的「期间范围」误导 */
const tStart = dom.indexOf('rpt-table');
const tablePart = dom.slice(tStart, dom.indexOf('</table>', tStart));
const h1 = tablePart.indexOf('2026-01'), h2 = tablePart.indexOf('2026-02'), h10 = tablePart.indexOf('2026-10');
ok(h1 > 0 && h2 > h1 && h10 > h2, '表头月份按 2026-01 → 2026-02 → 2026-10 时间顺序');
ok(dom.indexOf('实际数') > 0, '数据类型列存在');
ok(tablePart.indexOf('预算数') < 0, 'v0.11：预算数已关闭，矩阵表头不出现');
ok(dom.indexOf('m3-trend-box') >= 0, '趋势图容器存在');
ok(dom.indexOf('趋势科目') >= 0, '趋势科目选择器存在');
ok(dom.indexOf('无匹配数据') < 0, '有数据时不应出现「无匹配数据」');

/* ---------------- 4. 管报预览 ---------------- */
console.log('\n[4] 管报预览');
dom = dump('report');
ok(dom.indexOf('一级科目') > 0 && dom.indexOf('二级科目') > 0 && dom.indexOf('科目编码') > 0, '管报 A:E 列结构存在');
ok(dom.indexOf('rpt-table') >= 0, '管报表格已渲染');
ok(count(dom, '<tr') >= 200, '管报渲染 201 行（实际 ' + count(dom, '<tr') + ' 行）');
ok(dom.indexOf('销售收入') > 0 && dom.indexOf('6001') > 0, '科目名称与编码同时出现');
ok(dom.indexOf('1001') > 0, '数量类科目（订单量）也在模板中');

/* ---------------- 5. 全不选 ---------------- */
console.log('\n[5] 全不选语义');
dom = dump('select-none-site');
ok(summaryOf(dom, 'site') === '全不选 · 无匹配', '取消表头全选后该维度为「全不选」');
ok(dom.indexOf('无匹配记录') > 0, '顶部提示当前无匹配记录');
ok(dom.indexOf('筛选后 7 行明细') < 0, '不再显示原来的明细行数');

/* ---------------- 6. 三态全选 ---------------- */
console.log('\n[6] 表头三态复选框');
dom = dump('checkall-twice');
ok(summaryOf(dom, 'month') === '全部', '连点两次全选后回到「全部」（实际 ' + summaryOf(dom, 'month') + '）');

/* ---------------- 8. 单项勾选不再误触发全选/全不选 ---------------- */
console.log('\n[8] 单项勾选回归');
dom = dump('pick-first');
ok(summaryOf(dom, 'site') === '已选 2 项', '取消 1 项后应为「已选 2 项」（实际 ' + summaryOf(dom, 'site') + '）');
ok(summaryOf(dom, 'site') !== '全不选 · 无匹配', '不再跳出「全不选」');

/* ---------------- 7. 无数据仍出全 0 管报 ---------------- */
console.log('\n[7] 无匹配数据时的管报');
dom = dump('none-report');
ok(count(dom, '<tr') >= 210, '无匹配数据仍渲染 211 行（实际 ' + count(dom, '<tr') + ' 行）');
ok(dom.indexOf('未生成月份列') > 0, '说明为什么没有月份列');
ok(dom.indexOf('全部为 0') > 0, '说明模板行全部为 0');

/* ---------------- 8.1 层级独立勾选 + 列随层级收窄（v0.12.2） ---------------- */
console.log('\n[8.1] 层级独立勾选与列收窄');
function leadCols(d) { return count(d, '<th class="rpt-lead'); }
function checkedLevels(d) {
  const out = [];
  [1, 2, 3, 4].forEach((lv) => {
    if (d.indexOf('data-rpt-level="' + lv + '" checked') >= 0) out.push(lv);
  });
  return out.join(',');
}

dom = dump('report');
ok(checkedLevels(dom) === '1,2,3,4', '默认四级全选（实际 ' + checkedLevels(dom) + '）');
ok(leadCols(dom) === 5, '四级全选 → 4 个科目列 + 编码列（实际 ' + leadCols(dom) + '）');

dom = dump('levels-only2');
ok(checkedLevels(dom) === '2', '只勾二级时其他层级确实取消（实际 ' + checkedLevels(dom) + '）');
ok(count(dom, '<tr data-code=') === 39, '只勾二级 = 39 行（实际 ' + count(dom, '<tr data-code=') + '）');
ok(leadCols(dom) === 3, '只勾二级 → 一级列 + 二级列 + 编码列，三四级列隐藏（实际 ' + leadCols(dom) + '）');
ok(dom.indexOf('三级科目</th>') < 0 && dom.indexOf('四级科目</th>') < 0, '三级/四级表头不再出现');
ok(dom.indexOf('一级科目</th>') > 0, '上级（一级）列仍保留，便于定位归属');

dom = dump('report-lv3');
ok(checkedLevels(dom) === '3', '只勾三级，一级可以真正取消（实际 ' + checkedLevels(dom) + '）');
ok(count(dom, '<tr data-code=') === 56, '只勾三级 = 56 行（实际 ' + count(dom, '<tr data-code=') + '）');
ok(leadCols(dom) === 4, '只勾三级 → 科目列显示到三级 + 编码列（实际 ' + leadCols(dom) + '）');

dom = dump('levels-lv1-off');
ok(checkedLevels(dom) === '2,3,4', '只取消一级，其余保持（实际 ' + checkedLevels(dom) + '）');
ok(count(dom, '<tr data-code=') === 190, '取消一级后剩 190 行（实际 ' + count(dom, '<tr data-code=') + '）');

dom = dump('levels-none');
ok(checkedLevels(dom) === '', '四个层级可以全部取消');
ok(count(dom, '<tr data-code=') === 0, '全不勾 → 没有科目行（实际 ' + count(dom, '<tr data-code=') + '）');
ok(dom.indexOf('未勾选任何科目层级') > 0, '空白界面给出未勾选提示');
ok(count(dom, 'rpt-lv-item') === 4, '空白态下勾选栏仍可见，可重新勾上');

/* ---------------- 9. 经营分析报表（v0.12） ---------------- */
console.log('\n[9] 经营分析报表');
dom = dump('analysis-only2');
ok(count(dom, '<tr data-code=') === 39, '经营分析只勾二级 = 39 行（实际 ' + count(dom, '<tr data-code=') + '）');
ok(count(dom, '<th class="rpt-lead') === 3, '经营分析只勾二级 → 两列科目 + 编码（实际 ' + count(dom, '<th class="rpt-lead') + '）');
ok(dom.indexOf('只显示到二级科目') > 0, '勾选栏提示列只显示到二级');

dom = dump('analysis');
ok(dom.indexOf('rpt-analysis') > 0, '经营分析表格已渲染');
ok(count(dom, 'rpt-lv-item') === 4, '左侧层级勾选栏有 4 个选项');
ok(dom.indexOf('总计') > 0, '总计列存在');
ok(dom.indexOf('占销售收入') > 0, '占销售收入比列存在');
ok(dom.indexOf('经营分析报表') > 0, '视图标题正确');
ok(count(dom, '<tr data-code=') === 211, '默认四级全选 = 211 行（实际 ' + count(dom, '<tr data-code=') + '）');
/* 销售收入 260 = 120 + 80 + 60，占比 100% */
const row6001 = (dom.match(/<tr data-code="6001"[\s\S]*?<\/tr>/) || [''])[0];
ok(row6001.indexOf('260.00') > 0, '销售收入总计 260.00（120+80+60）');
ok(row6001.indexOf('100.0%') > 0, '销售收入占比 100.0%');

/* ---------------- 10. 管报层级勾选 ---------------- */
console.log('\n[10] 管报层级勾选与父级汇总');
dom = dump('report');
ok(count(dom, '<tr data-code=') === 211, '默认四级全选 = 211 行');
dom = dump('report-lv1');
ok(count(dom, '<tr data-code=') === 21, '只勾一级 = 21 行（实际 ' + count(dom, '<tr data-code=') + '）');
const row6602 = (dom.match(/<tr data-code="6602"[\s\S]*?<\/tr>/) || [''])[0];
ok(row6602.indexOf('-30.00') > 0, '销售费用显示下级汇总 -30.00（父级汇总生效）');
dom = dump('report-lv12');
ok(count(dom, '<tr data-code=') === 60, '勾一级+二级 = 60 行（实际 ' + count(dom, '<tr data-code=') + '）');

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('存在失败项'); process.exit(1); }
console.log('界面验证通过');
