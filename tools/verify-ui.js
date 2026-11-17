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
ok(dom.indexOf('筛选后 8 行明细') >= 0, '筛选统计显示 8 行明细');
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
const tablePart = dom.slice(dom.indexOf('rpt-table'));
const h1 = tablePart.indexOf('2026-01'), h2 = tablePart.indexOf('2026-02'), h10 = tablePart.indexOf('2026-10');
ok(h1 > 0 && h2 > h1 && h10 > h2, '表头月份按 2026-01 → 2026-02 → 2026-10 时间顺序');
ok(dom.indexOf('实际数') > 0 && dom.indexOf('预算数') > 0, '数据类型分列展示');
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
ok(dom.indexOf('全不选') > 0, '维度显示「全不选」');
ok(dom.indexOf('无匹配记录') > 0, '顶部提示当前无匹配记录');
ok(dom.indexOf('筛选后 8 行明细') < 0, '不再显示原来的 8 行明细');

/* ---------------- 6. 全选（月份） ---------------- */
console.log('\n[6] 全选语义');
dom = dump('select-all-month');
ok(dom.indexOf('已选 3 项') > 0, '月份全选后显示已选 3 项');

/* ---------------- 7. 无数据仍出全 0 管报 ---------------- */
console.log('\n[7] 无匹配数据时的管报');
dom = dump('none-report');
ok(count(dom, '<tr') >= 200, '无匹配数据仍渲染 201 行（实际 ' + count(dom, '<tr') + ' 行）');
ok(dom.indexOf('未生成月份列') > 0, '说明为什么没有月份列');
ok(dom.indexOf('全部为 0') > 0, '说明模板行全部为 0');

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('存在失败项'); process.exit(1); }
console.log('界面验证通过');
