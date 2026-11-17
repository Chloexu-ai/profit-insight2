/* ===================================================================
 * 管报展示层 PAReportView
 * 职责：只负责把 engine 产出的矩阵 / 趋势渲染成 DOM，并做数值格式化。
 * 严禁在此文件中做任何财务计算（毛利、利润、占比、汇总一律由 engine 负责）。
 *
 * 依赖：window.PA（P.h / P.fmtMoney / P.fmtCompact / P.qs）
 *      window.Chart（可选，缺失时趋势图降级为表格）
 *      window.PA_REPORT_SUBJECTS（可选，用于按编码取单位）
 * 导出：window.PAReportView
 * =================================================================== */
(function () {
  'use strict';

  var P = window.PA || {};

  /* 图表配色，与 M3 看板保持一致 */
  var PALETTE = ['#2f6bff', '#0e9f8a', '#f79009', '#7a5af8', '#d92d20', '#12b76a', '#1570ef', '#b54708'];

  var PERIOD_MODE_LABEL = { monthly: '月度', daily: '日', weekly: '周', quarterly: '季度', yearly: '年度' };

  /* ---------------- 基础工具 ---------------- */

  /* 转义：优先复用全局 P.h，缺失时本地兜底 */
  function h(s) {
    if (typeof P.h === 'function') return P.h(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* ISO 时间 → 本地时间 YYYY-MM-DD HH:mm */
  function fmtLocalTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (!d || isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* 千分位格式化；unit 决定小数位：money 两位，quantity/headcount 取整 */
  function formatCell(n, unit) {
    var v = toNumber(n);
    if (v === null) return '—';
    if (v === 0) return '0';
    if (unit === 'quantity' || unit === 'headcount') {
      return Math.round(v).toLocaleString('zh-CN');
    }
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* 数值单元格的 class：0 弱化、负数绿色（中国习惯：负向为绿） */
  function numClass(v) {
    if (v === null) return 'num nil';
    if (v === 0) return 'num zero';
    if (v < 0) return 'num neg';
    return 'num';
  }

  /* 单位解析：优先行内 unit，其次 meta.units，再查科目模板，最后按金额处理 */
  function unitOf(row, matrix) {
    if (row && row.unit) return row.unit;
    var units = matrix && matrix.meta && matrix.meta.units;
    if (units && row && units[row.code]) return units[row.code];
    var S = window.PA_REPORT_SUBJECTS;
    if (S && S.byCode && row && S.byCode[row.code] && S.byCode[row.code].unit) return S.byCode[row.code].unit;
    return 'money';
  }

  /* 月份/期间列按 period 分组，保持原顺序（不排序，engine 已给好） */
  function groupColumns(columns) {
    var groups = [];
    var map = {};
    (columns || []).forEach(function (col) {
      var key = col.period || col.periodLabel || '';
      if (!map[key]) {
        map[key] = { key: key, label: col.periodLabel || col.period || '', cols: [] };
        groups.push(map[key]);
      }
      map[key].cols.push(col);
    });
    return groups;
  }

  /* 表头两行：第一行期间分组（colspan），第二行数据类型 */
  function headRows(groups, leadHeadCells) {
    var r1 = leadHeadCells || '';
    var r2 = '';
    groups.forEach(function (g) {
      r1 += '<th class="rpt-th-period" colspan="' + g.cols.length + '">' + h(g.label) + '</th>';
      g.cols.forEach(function (c) {
        r2 += '<th class="rpt-th-type" title="' + h(c.label || '') + '">' + h(c.data_type || '') + '</th>';
      });
    });
    return '<tr>' + r1 + '</tr><tr>' + r2 + '</tr>';
  }

  /* 数值单元格 */
  function valueCell(value, unit) {
    var v = toNumber(value);
    return '<td class="' + numClass(v) + '">' + h(formatCell(v, unit)) + '</td>';
  }

  /* 固定列定位校准：按表头实际宽度重算 left，避免长科目名把列宽撑偏后错位。
     纯几何测量，不涉及任何数值计算；测量失败（隐藏容器）时保留 CSS 默认值。 */
  function syncSticky(table) {
    if (!table || typeof table.querySelectorAll !== 'function') return;
    var heads = table.querySelectorAll('thead th');
    var lefts = [];
    var offset = 0;
    Array.prototype.forEach.call(heads, function (th) {
      var m = /rpt-sticky-(\d)/.exec(th.className || '');
      if (!m) return;
      var w = th.getBoundingClientRect ? th.getBoundingClientRect().width : (th.offsetWidth || 0);
      lefts[Number(m[1]) - 1] = offset;
      offset += w || 0;
    });
    if (!offset) return;
    var cells = table.querySelectorAll('[class*="rpt-sticky-"]');
    Array.prototype.forEach.call(cells, function (cell) {
      var m = /rpt-sticky-(\d)/.exec(cell.className || '');
      if (m && lefts[Number(m[1]) - 1] != null) cell.style.left = lefts[Number(m[1]) - 1] + 'px';
    });
  }

  /* 向上找 tr（避免依赖 Element.closest 的兼容性问题） */
  function closestRow(node, root) {
    var cur = node;
    while (cur && cur !== root) {
      if (cur.nodeType === 1 && cur.tagName === 'TR') return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function emptyBox(text) {
    return '<div class="empty">' + h(text || '暂无数据') + '</div>';
  }

  /* ---------------- 1) 元信息条 + 校验警示 ---------------- */

  function renderMeta(el, meta, diagnostics) {
    if (!el) return;
    meta = meta || {};
    var source = meta.source || {};
    var periods = meta.periods || [];
    var dataTypes = meta.dataTypes || [];

    var periodText = '—';
    if (periods.length === 1) periodText = String(periods[0]);
    else if (periods.length > 1) periodText = periods[0] + ' ~ ' + periods[periods.length - 1];
    var modeText = PERIOD_MODE_LABEL[meta.periodMode] ? '（' + PERIOD_MODE_LABEL[meta.periodMode] + '）' : '';

    var html = '<div class="rpt-meta">' +
      '<span class="rpt-meta-item"><b>数据来源</b>' + h(source.label || '全部数据集（合并）') + '</span>' +
      '<span class="rpt-meta-item"><b>期间范围</b>' + h(periodText + modeText) + '</span>' +
      '<span class="rpt-meta-item"><b>数据类型</b>' + h(dataTypes.length ? dataTypes.join(' / ') : '—') + '</span>' +
      '<span class="rpt-meta-item"><b>生成时间</b>' + h(fmtLocalTime(meta.generatedAt)) + '</span>' +
      (meta.note ? '<span class="rpt-meta-item rpt-meta-note"><b>口径说明</b>' + h(meta.note) + '</span>' : '') +
      '<span class="rpt-meta-item rpt-meta-unit"><b>单位说明</b>金额为已统一币种；数量、人数单独计量，不与金额合并汇总</span>' +
      '</div>';

    /* 校验提示：error 红、warn 橙 */
    var list = Array.isArray(diagnostics) ? diagnostics : [];
    var errors = list.filter(function (d) { return d && d.level === 'error'; });
    var warns = list.filter(function (d) { return d && d.level !== 'error'; });

    if (errors.length) {
      html += '<div class="rpt-diag rpt-diag-error">' +
        '<div class="rpt-diag-title">数据校验未通过</div>' +
        '<ul>' + errors.map(function (d) {
          return '<li>' + h(d.message || d.code || '未知问题') + ' × ' + (d.count == null ? 1 : d.count) + '</li>';
        }).join('') + '</ul>' +
        '<div class="rpt-diag-foot">存在未能归集的数据，正式管报生成前需先修正</div>' +
        '</div>';
    }
    if (warns.length) {
      html += '<div class="rpt-diag rpt-diag-warn">' +
        '<div class="rpt-diag-title">数据校验提示</div>' +
        '<ul>' + warns.map(function (d) {
          return '<li>' + h(d.message || d.code || '未知问题') + ' × ' + (d.count == null ? 1 : d.count) + '</li>';
        }).join('') + '</ul>' +
        '</div>';
    }

    el.innerHTML = html;
  }

  /* ---------------- 2) 科目 × 月度矩阵 ---------------- */

  function renderMatrix(el, matrix, options) {
    options = options || {};
    if (!el) return { destroy: function () {} };
    el.innerHTML = '';

    matrix = matrix || {};
    var rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    var columns = Array.isArray(matrix.columns) ? matrix.columns : [];

    if (!rows.length) {
      el.innerHTML = emptyBox('当前筛选条件下没有可展示的科目数据');
      return { destroy: function () {} };
    }
    /* 有模板行但没有月份列（未指定月份且数据中无期间）：仍展示模板行，并说明原因 */
    var noColsNote = columns.length ? '' :
      '<div class="rpt-diag rpt-diag-warn">当前筛选条件没有匹配的明细，模板 ' + rows.length +
      ' 行全部为 0。因未指定月份且数据中没有可识别的期间，未生成月份列。</div>';

    var total = rows.length;
    var limit = Number(options.maxRows) > 0 ? Number(options.maxRows) : total;
    var visible = limit < total ? rows.slice(0, limit) : rows;

    /* 工具条：数据量较大时给出总行数提示（不做虚拟滚动） */
    var toolbar = '';
    if (total > 200 || visible.length < total) {
      var countText = visible.length < total
        ? '共 ' + total + ' 行（当前显示前 ' + visible.length + ' 行）'
        : '共 ' + total + ' 行';
      toolbar = '<div class="rpt-toolbar"><span class="rpt-count">' + h(countText) + '</span>' +
        '<span class="rpt-hint">横向可滚动，表头与科目列固定</span></div>';
    }

    var groups = groupColumns(columns);
    var lead = '<th class="rpt-sticky-1 rpt-th-corner" rowspan="2">科目</th>' +
      '<th class="rpt-sticky-2 rpt-th-corner" rowspan="2">编码</th>';

    var body = visible.map(function (row) {
      var level = Number(row.level) || 1;
      var indent = new Array(Math.max(0, level - 1) + 1).join('　'); /* 全角空格缩进 */
      var path = Array.isArray(row.path) && row.path.length ? row.path.join(' / ') : (row.name || '');
      var cells = row.cells || {};
      var tds = columns.map(function (c) {
        return valueCell(cells[c.key], unitOf(row, matrix));
      }).join('');
      return '<tr data-code="' + h(row.code) + '"' + (row.hasData === false ? ' class="row-empty"' : '') + '>' +
        '<td class="rpt-sticky-1 rpt-subject lv' + level + '" title="' + h(path) + '">' +
        '<div class="rpt-cell">' + h(indent + (row.name || '')) + '</div></td>' +
        '<td class="rpt-sticky-2 rpt-code" title="' + h(row.code) + '">' + h(row.code) + '</td>' +
        tds + '</tr>';
    }).join('');

    el.innerHTML = toolbar + noColsNote +
      '<div class="rpt-wrap">' +
      '<table class="rpt-table rpt-matrix"><thead>' + headRows(groups, lead) + '</thead>' +
      '<tbody>' + body + '</tbody></table></div>';

    var table = P.qs ? P.qs('.rpt-table', el) : el.querySelector('.rpt-table');
    var onClick = null;

    syncSticky(table);

    if (typeof options.onRowClick === 'function' && table) {
      table.classList.add('is-clickable');
      onClick = function (e) {
        var tr = closestRow(e.target, table);
        if (tr && tr.getAttribute('data-code')) options.onRowClick(tr.getAttribute('data-code'), tr);
      };
      table.addEventListener('click', onClick);
    }

    return {
      destroy: function () {
        if (table && onClick) table.removeEventListener('click', onClick);
        el.innerHTML = '';
      }
    };
  }

  /* ---------------- 3) 趋势折线图 ---------------- */

  /* 无 Chart.js 时的降级表格：月份 × 系列，不做任何汇总 */
  function trendFallback(trend) {
    var labels = trend.labels || [];
    var series = trend.series || [];
    var head = '<th class="rpt-sticky-1">月份</th>' + series.map(function (s) {
      return '<th>' + h(s.name || s.code || '') + '</th>';
    }).join('');
    var body = labels.map(function (label, i) {
      var tds = series.map(function (s) {
        return valueCell((s.values || [])[i], 'money');
      }).join('');
      return '<tr><td class="rpt-sticky-1 rpt-subject">' + h(label) + '</td>' + tds + '</tr>';
    }).join('');
    return '<div class="rpt-wrap rpt-trend-fallback"><table class="rpt-table rpt-report">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="rpt-hint">图表组件未加载，已降级为数据表展示</div>';
  }

  function renderTrend(el, trend, options) {
    options = options || {};
    if (!el) return { destroy: function () {} };
    el.innerHTML = '';

    trend = trend || {};
    var labels = Array.isArray(trend.labels) ? trend.labels : [];
    var series = Array.isArray(trend.series) ? trend.series : [];

    if (!labels.length || !series.length) {
      el.innerHTML = emptyBox('所选科目暂无月度数据');
      return { destroy: function () {} };
    }

    /* Chart.js 缺失或初始化失败都走降级表格 */
    if (typeof window.Chart !== 'function') {
      el.innerHTML = trendFallback(trend);
      return { destroy: function () { el.innerHTML = ''; } };
    }

    var height = Number(options.height) || 260;
    var box = document.createElement('div');
    box.className = 'rpt-trend';
    box.style.height = height + 'px';
    var canvas = document.createElement('canvas');
    box.appendChild(canvas);
    el.appendChild(box);

    var datasets = series.map(function (s, i) {
      var color = PALETTE[i % PALETTE.length];
      return {
        label: s.name || s.code || ('系列 ' + (i + 1)),
        data: (s.values || []).map(function (v) { return toNumber(v); }),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: '#fff',
        pointBorderColor: color,
        pointBorderWidth: 2,
        spanGaps: true,
        fill: false
      };
    });

    var chart = null;
    try {
      chart = new window.Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14, font: { size: 11 }, color: '#667085' }
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var name = (ctx.dataset && ctx.dataset.label) || '';
                  var v = ctx.parsed ? ctx.parsed.y : ctx.raw;
                  var txt = typeof P.fmtMoney === 'function' ? P.fmtMoney(v, 2) : String(v);
                  return name + '：' + txt;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11 }, color: '#667085', maxRotation: 0, autoSkip: true }
            },
            y: {
              grid: { color: '#eef2f7' },
              ticks: {
                font: { size: 11 },
                color: '#667085',
                callback: function (v) {
                  return typeof P.fmtCompact === 'function' ? P.fmtCompact(v) : v;
                }
              }
            }
          }
        }
      });
    } catch (err) {
      /* 初始化异常同样降级，不打断整页渲染 */
      el.innerHTML = trendFallback(trend);
      return { destroy: function () { el.innerHTML = ''; } };
    }

    return {
      destroy: function () {
        if (chart && typeof chart.destroy === 'function') chart.destroy();
        chart = null;
        el.innerHTML = '';
      }
    };
  }

  /* ---------------- 4) 管报预览（正式版式） ---------------- */

  function renderReport(el, matrix, options) {
    options = options || {};
    if (!el) return { destroy: function () {} };
    el.innerHTML = '';

    matrix = matrix || {};
    var rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    var columns = Array.isArray(matrix.columns) ? matrix.columns : [];

    if (!rows.length) {
      el.innerHTML = emptyBox('当前模板下没有可生成的管报数据');
      return { destroy: function () {} };
    }
    var noColsNote = columns.length ? '' :
      '<div class="rpt-diag rpt-diag-warn">当前筛选条件没有匹配的明细，模板 ' + rows.length +
      ' 行全部为 0。因未指定月份且数据中没有可识别的期间，未生成月份列。</div>';

    var groups = groupColumns(columns);
    var lead = '<th class="rpt-sticky-1 rpt-th-corner" rowspan="2">一级科目</th>' +
      '<th class="rpt-sticky-2 rpt-th-corner" rowspan="2">二级科目</th>' +
      '<th class="rpt-sticky-3 rpt-th-corner" rowspan="2">三级科目</th>' +
      '<th class="rpt-sticky-4 rpt-th-corner" rowspan="2">四级科目</th>' +
      '<th class="rpt-sticky-5 rpt-th-corner" rowspan="2">科目编码</th>';

    /* 严格按 matrix.rows 顺序输出：不重排、不过滤、不合并同名行 */
    var lastPath = ['', '', '', ''];
    var body = rows.map(function (row) {
      var level = Number(row.level) || 1;
      var pathArr = Array.isArray(row.path) ? row.path : [];
      var fullPath = pathArr.length ? pathArr.join(' / ') : (row.name || '');
      var cells = row.cells || {};
      var unit = unitOf(row, matrix);

      /* 与上一行同祖先的层级留空，视觉上模拟 Excel 合并单元格；数值不受影响 */
      var pathTds = '';
      var sameAncestor = true;
      for (var i = 0; i < 4; i++) {
        var raw = pathArr[i] == null ? '' : pathArr[i];
        var show = raw;
        if (raw && sameAncestor && raw === lastPath[i]) show = '';
        else if (raw) sameAncestor = false;
        pathTds += '<td class="rpt-sticky-' + (i + 1) + ' rpt-subject lv' + (i + 1) + '" title="' + h(fullPath) + '">' +
          (show ? '<div class="rpt-cell">' + h(show) + '</div>' : '') + '</td>';
      }
      for (var j = 0; j < 4; j++) lastPath[j] = pathArr[j] == null ? '' : pathArr[j];

      var tds = columns.map(function (c) {
        return valueCell(cells[c.key], unit);
      }).join('');

      return '<tr data-code="' + h(row.code) + '" class="lv' + level + (row.hasData === false ? ' row-empty' : '') + '">' +
        pathTds +
        '<td class="rpt-sticky-5 rpt-code" title="' + h(row.code) + '">' + h(row.code) + '</td>' +
        tds + '</tr>';
    }).join('');

    el.innerHTML = noColsNote + '<div class="rpt-wrap">' +
      '<table class="rpt-table rpt-report"><thead>' + headRows(groups, lead) + '</thead>' +
      '<tbody>' + body + '</tbody></table></div>';

    var table = P.qs ? P.qs('.rpt-table', el) : el.querySelector('.rpt-table');
    var onClick = null;

    syncSticky(table);

    if (typeof options.onRowClick === 'function' && table) {
      table.classList.add('is-clickable');
      onClick = function (e) {
        var tr = closestRow(e.target, table);
        if (tr && tr.getAttribute('data-code')) options.onRowClick(tr.getAttribute('data-code'), tr);
      };
      table.addEventListener('click', onClick);
    }

    return {
      destroy: function () {
        if (table && onClick) table.removeEventListener('click', onClick);
        el.innerHTML = '';
      }
    };
  }

  /* ---------------- 导出 ---------------- */

  window.PAReportView = {
    renderMeta: renderMeta,
    renderMatrix: renderMatrix,
    renderTrend: renderTrend,
    renderReport: renderReport,
    formatCell: formatCell,
    /* 供外部复用的常量与工具 */
    PALETTE: PALETTE,
    fmtLocalTime: fmtLocalTime,
    unitOf: unitOf
  };
})();
