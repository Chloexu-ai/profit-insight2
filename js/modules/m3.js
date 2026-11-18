(function () {
  const P = window.PA;
  const M = (window.PAM3 = {
    id: 'm3',
    title: 'M3 · 数据看板',
    desc: '按领导看数习惯一键生成图表，多选筛选、科目月度对比与管报预览共用同一套筛选状态。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() {
      charts.forEach((c) => c.destroy && c.destroy());
      charts = [];
      if (trendHandle && trendHandle.destroy) trendHandle.destroy();
      trendHandle = null;
      if (reportHandle && reportHandle.destroy) reportHandle.destroy();
      reportHandle = null;
      currentRoot = null;
      document.removeEventListener('click', closeMsOutside);
    }
  });

  let currentRoot = null;
  let dashboards = [];
  let current = null;
  let charts = [];
  let filteredRows = [];
  let trendHandle = null;
  let reportHandle = null;
  let currentWsId = null;
  /* 交互态（不进入持久化）：搜索词与展开的面板 */
  let ui = { search: {}, open: null, trendCodes: [] };

  const PALETTE = ['#2f6bff', '#0e9f8a', '#f79009', '#7a5af8', '#d92d20', '#12b76a', '#1570ef', '#b54708'];

  /* 参与多选的业务维度：period 已并入 month，不再单列 */
  const FILTER_DIMS = ['month', 'data_type', 'site', 'platform', 'channel', 'material', 'brand', 'category', 'report_product', 'subject', 'region', 'product'];
  const DIM_LABELS = {
    month: '月份', data_type: '数据类型', site: '站点/国家', platform: '平台', channel: '渠道',
    material: '素材来源', brand: '品牌', category: '品类', report_product: '报表产品',
    subject: '科目', region: '区域（旧）', product: '产品线（旧）'
  };
  const DATA_TYPE_ORDER = ['实际数', '预算数', '预测数'];
  /* v0.11：预算数据颗粒度不足，M3 暂不纳入预算数，也不做预算/实际对比。
     需要恢复时把这里改成 [] 即可，其它逻辑无需改动。 */
  const HIDDEN_DATA_TYPES = ['预算数'];
  const VIEWS = { chart: '图表', matrix: '科目月度对比', report: '管报', analysis: '经营分析' };
  const ALL_LEVELS = [1, 2, 3, 4];

  const TEMPLATES = {
    overview: {
      label: '经营总览', widgets: [
        { type: 'kpi', title: '实际收入', measure: 'revenue', span: 3 },
        { type: 'kpi', title: '实际利润', measure: 'actual_profit', span: 3 },
        { type: 'kpi', title: '利润率', measure: 'margin', span: 3 },
        { type: 'kpi', title: '利润预算差异', measure: 'profit_variance', span: 3 },
        { type: 'line', title: '利润趋势（按月份）', measure: 'actual_profit', dimension: 'month', span: 12 },
        { type: 'bar', title: '站点/国家收入对比', measure: 'revenue', dimension: 'site', span: 6 },
        { type: 'bar', title: '平台利润对比', measure: 'actual_profit', dimension: 'platform', span: 6 }
      ]
    },
    attribution: {
      label: '利润归因', widgets: [
        { type: 'kpi', title: '利润差异', measure: 'profit_variance', span: 4 },
        { type: 'kpi', title: '收入差异', measure: 'revenue_variance', span: 4 },
        { type: 'kpi', title: '预算利润率', measure: 'margin', span: 4 },
        { type: 'bar', title: '报表产品利润差异', measure: 'profit_variance', dimension: 'report_product', span: 6 },
        { type: 'table', title: '站点利润归因明细', measure: 'profit_variance', dimension: 'site', span: 6 },
        { type: 'pie', title: '渠道利润结构', measure: 'actual_profit', dimension: 'channel', span: 12 }
      ]
    },
    site: {
      label: '站点/国家对标', widgets: [
        { type: 'bar', title: '站点收入排名', measure: 'revenue', dimension: 'site', span: 6 },
        { type: 'bar', title: '站点利润排名', measure: 'actual_profit', dimension: 'site', span: 6 },
        { type: 'pie', title: '站点收入占比', measure: 'revenue', dimension: 'site', span: 6 },
        { type: 'table', title: '站点经营明细', measure: 'actual_profit', dimension: 'site', span: 6 }
      ]
    },
    product: {
      label: '品类 · 品牌 · 产品', widgets: [
        { type: 'bar', title: '品类收入对比', measure: 'revenue', dimension: 'category', span: 6 },
        { type: 'pie', title: '品牌利润结构', measure: 'actual_profit', dimension: 'brand', span: 6 },
        { type: 'bar', title: '报表产品收入 TOP', measure: 'revenue', dimension: 'report_product', span: 12 },
        { type: 'table', title: '报表产品经营明细', measure: 'actual_profit', dimension: 'report_product', span: 12 }
      ]
    },
    platform: {
      label: '平台 · 渠道', widgets: [
        { type: 'bar', title: '平台收入对比', measure: 'revenue', dimension: 'platform', span: 6 },
        { type: 'bar', title: '平台利润对比', measure: 'actual_profit', dimension: 'platform', span: 6 },
        { type: 'bar', title: '渠道收入排名', measure: 'revenue', dimension: 'channel', span: 6 },
        { type: 'table', title: '渠道经营明细', measure: 'actual_profit', dimension: 'channel', span: 6 }
      ]
    },
    subject: {
      label: '科目结构', widgets: [
        { type: 'bar', title: '科目金额结构', measure: 'amount', dimension: 'subject', span: 12 },
        { type: 'table', title: '科目金额明细', measure: 'amount', dimension: 'subject', span: 12 }
      ]
    },
    budget: {
      label: '预算 vs 实际', widgets: [
        { type: 'kpi', title: '利润差异', measure: 'profit_variance', span: 4 },
        { type: 'kpi', title: '收入差异', measure: 'revenue_variance', span: 4 },
        { type: 'kpi', title: '利润率', measure: 'margin', span: 4 },
        { type: 'bar', title: '数据类型金额对比', measure: 'amount', dimension: 'data_type', span: 6 },
        { type: 'bar', title: '站点利润差异', measure: 'profit_variance', dimension: 'site', span: 6 },
        { type: 'table', title: '站点预算达成明细', measure: 'profit_variance', dimension: 'site', span: 12 }
      ]
    }
  };
  const nameForTpl = { attribution: '利润归因看板', site: '站点对标看板', product: '品类品牌看板', platform: '平台渠道看板', subject: '科目结构看板', budget: '预算实际看板' };

  /* ---------------- 状态 ---------------- */

  function registry() { return window.PA_REPORT_SUBJECTS || null; }

  /* 统一筛选状态：优先用 report 引擎的归一化函数，保证与矩阵/管报同源 */
  function normalizeState(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    let state;
    if (window.PAReport && window.PAReport.normalizeFilters) {
      state = window.PAReport.normalizeFilters(s);
    } else {
      const dims = {};
      FILTER_DIMS.forEach((k) => {
        const v = s[k];
        if (v == null || v === '') return;
        dims[k] = Array.isArray(v) ? v.slice() : [String(v)];
      });
      state = { version: 2, source: { mode: 'all', datasetId: null }, dimensions: dims, periodMode: 'monthly', reportTemplateVersion: 'management-v1' };
    }
    state.source = state.source || { mode: 'all', datasetId: null };
    state.dimensions = state.dimensions || {};
    /* 旧看板里月份可能存的是「1月」这类原始写法，统一成期间 key，才能和筛选控件对上 */
    if (Array.isArray(state.dimensions.month)) {
      const seen = {};
      state.dimensions.month = state.dimensions.month.map((v) => periodOf({ month: v, period: v }).key)
        .filter((k) => (seen[k] ? false : (seen[k] = true)));
    }
    state.view = s.view || 'chart';
    if (!VIEWS[state.view]) state.view = 'chart';
    /* 层级勾选：旧看板没有该字段时默认全选四级，保证兼容 */
    state.levelFilter = normalizeLevelsInput(s.levelFilter);
    return state;
  }

  /* 层级勾选归一：四个层级各自独立，像 Excel 复选框一样想勾就勾、想取消就取消。
     不再自动补上级——上级是否显示由用户自己决定；但「展示到第几级」由最高的
     勾选层级决定（勾了二级就显示一级+二级两列，三级四级列隐藏），保证下级科目
     始终能看到它的上级归属。
     空数组 = 一个都没勾 = 报表为空白。 */
  function normalizeLevelsInput(raw) {
    if (raw == null) return ALL_LEVELS.slice();
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = [];
    arr.forEach((v) => {
      const n = Math.round(Number(v));
      if (n >= 1 && n <= 4 && out.indexOf(n) < 0) out.push(n);
    });
    out.sort((a, b) => a - b);
    return out;
  }

  function filters() {
    if (!current) current = { name: '经营分析看板', widgets: [], filters: normalizeState({}) };
    if (!current.filters) current.filters = normalizeState({});
    return current.filters;
  }

  /* 未出现 = 全部；[] = 全不选 */
  function picked(k) {
    const v = filters().dimensions[k];
    return Array.isArray(v) ? v : null;
  }
  function dimIsAll(k) { return picked(k) === null; }
  function dimIsNone(k) { const v = picked(k); return Array.isArray(v) && v.length === 0; }

  /* ---------------- 数据源 ---------------- */

  function datasetId() {
    const s = filters().source;
    return s && s.mode === 'dataset' && s.datasetId != null ? Number(s.datasetId) : null;
  }

  function sourceRows() {
    const id = datasetId();
    let rows;
    if (id == null) rows = P.state.datasets.flatMap((d) => P.datasetRows(d));
    else {
      const ds = P.state.datasets.find((d) => d.id === id);
      rows = P.datasetRows(ds);
    }
    /* 数据视图权限剔除敏感科目；再按版本开关排除暂不参与的数据类型 */
    const visible = P.applyDataView(rows);
    if (!HIDDEN_DATA_TYPES.length) return visible;
    return visible.filter((r) => HIDDEN_DATA_TYPES.indexOf(String((r && r.data_type) || '')) < 0);
  }

  function datasetLabel() {
    const id = datasetId();
    if (id == null) return '全部数据集（合并）';
    const ds = P.state.datasets.find((d) => d.id === id);
    return ds ? ds.name : '全部数据集（合并）';
  }

  /* ---------------- 维度取值 ---------------- */

  function periodOf(row) {
    if (window.PAReport && window.PAReport.normalizePeriod) return window.PAReport.normalizePeriod(row);
    const raw = row && (row.period || row.month);
    const s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^(\d{4})[年\/-](\d{1,2})/);
    if (m) return { key: m[1] + '-' + String(m[2]).padStart(2, '0'), label: m[1] + '-' + String(m[2]).padStart(2, '0'), sortKey: Number(m[1]) * 100 + Number(m[2]) };
    const m2 = s.match(/^(\d{1,2})月?$/);
    if (m2) return { key: 'LEGACY-M' + String(m2[1]).padStart(2, '0'), label: m2[1] + '月（未标年份）', sortKey: 900000 + Number(m2[1]) };
    return { key: 'LEGACY-UNKNOWN', label: '期间未知', sortKey: 999999 };
  }

  function subjectOptions(rows) {
    const reg = registry();
    const map = new Map();
    (rows || []).forEach((r) => {
      let code = r.subject_code || '';
      let name = r.subject || '';
      if (!code && reg && name) {
        const hit = reg.byName[name];
        if (hit && hit.length === 1) code = hit[0].code;
      }
      if (code && reg && reg.byCode[code]) name = reg.byCode[code].name;
      if (!code && !name) return;
      const key = code || name;
      if (!map.has(key)) map.set(key, { key, label: code && name ? name + '（' + code + '）' : (name || code) });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }

  /* 返回 [{key,label}]，key 用于筛选比较 */
  function dimOptions(rows, k) {
    if (k === 'month') {
      const m = new Map();
      (rows || []).forEach((r) => {
        const p = periodOf(r);
        if (!m.has(p.key)) m.set(p.key, { key: p.key, label: p.label, sortKey: p.sortKey });
      });
      return Array.from(m.values()).sort((a, b) => a.sortKey - b.sortKey);
    }
    if (k === 'subject') return subjectOptions(rows);
    const vals = P.dimensionValues(rows, k).filter((v) => v && v !== '未分类' && v !== '未指定月份');
    return vals.map((v) => ({ key: String(v), label: String(v) }));
  }

  function rowMatches(row, k, vals) {
    if (k === 'month') return vals.indexOf(periodOf(row).key) >= 0;
    if (k === 'subject') {
      const code = String(row.subject_code || '');
      const name = String(row.subject || '');
      return vals.indexOf(code) >= 0 || vals.indexOf(name) >= 0;
    }
    return vals.indexOf(String(row[k] == null ? '' : row[k])) >= 0;
  }

  /* 统一过滤：与矩阵/管报共用同一份结果 */
  function applyFilters() {
    const rows = sourceRows();
    const state = filters();
    const dims = state.dimensions || {};

    /* 明确全不选：任何维度是空数组 → 无匹配记录，不退回全部 */
    const noneKeys = Object.keys(dims).filter((k) => Array.isArray(dims[k]) && dims[k].length === 0);

    if (window.PAReport && window.PAReport.filterFacts) {
      const r = window.PAReport.filterFacts(rows, state);
      filteredRows = r.facts;
      lastDiagnostics = r.diagnostics || [];
      return;
    }
    let out = rows.slice();
    if (noneKeys.length) { filteredRows = []; lastDiagnostics = []; return; }
    Object.keys(dims).forEach((k) => {
      const vals = dims[k];
      if (!Array.isArray(vals) || !vals.length) return;
      if (FILTER_DIMS.indexOf(k) < 0) return;
      out = out.filter((r) => rowMatches(r, k, vals));
    });
    filteredRows = out;
    lastDiagnostics = [];
  }

  let lastDiagnostics = [];

  /* ---------------- 布局 ---------------- */

  function toolbar() {
    const ds = P.state.datasets;
    const cur = filters();
    const view = cur.view || 'chart';
    return '<div class="card"><div class="card-title"><h3>看板配置</h3><span class="sub">图表 · 筛选器 · 布局</span></div>' +
      '<div class="row"><div style="width:220px"><label class="field-label">数据源</label><select class="form-select" id="m3-dataset">' +
      '<option value="all"' + (ds && datasetId() == null ? ' selected' : '') + '>全部数据集（合并）</option>' +
      ds.map((d) => '<option value="' + d.id + '"' + (datasetId() === d.id ? ' selected' : '') + '>' + P.h(d.name) + '</option>').join('') + '</select></div>' +
      '<div style="width:220px"><label class="field-label">已保存看板</label><select class="form-select" id="m3-dash"><option value="">— 新建看板 —</option>' +
      dashboards.map((d) => '<option value="' + d.id + '"' + (current && current.id === d.id ? ' selected' : '') + '>' + P.h(d.name) + '</option>').join('') + '</select></div>' +
      '<div style="width:160px"><label class="field-label">看板名称</label><input class="field" id="m3-name" value="' + P.h(current ? current.name : '经营分析看板') + '" /></div>' +
      '<div class="spacer"></div>' +
      Object.entries(TEMPLATES).map(([k, v]) => '<button class="btn tiny" data-tpl="' + k + '">一键生成 · ' + v.label + '</button>').join('') +
      '<button class="btn primary tiny" id="m3-save">保存看板</button><button class="btn tiny" id="m3-new">清空</button></div>' +
      '<div class="m3-toolbar-line"><div class="m3-views" id="m3-views">' +
      Object.entries(VIEWS).map(([k, label]) => '<button type="button" data-view="' + k + '"' + (view === k ? ' class="active"' : '') + '>' + label + '</button>').join('') +
      '</div><span class="tiny-text muted" id="m3-filter-stat"></span></div>' +
      '<div id="m3-filters" class="filter-bar" style="margin-top:12px"></div></div>';
  }

  function filtersHtml() {
    const rows = sourceRows();
    current = current || { name: '经营分析看板', widgets: [], filters: normalizeState({}) };
    const activeDims = FILTER_DIMS.filter((k) => dimOptions(rows, k).length > 0);
    if (!activeDims.length) {
      return '<span class="tiny-text muted">当前数据源没有可用于筛选的维度取值</span>';
    }
    return activeDims.map((k) => {
      const opts = dimOptions(rows, k);
      const selected = picked(k);
      const isAll = selected === null;
      const isNone = Array.isArray(selected) && selected.length === 0;
      const summary = isAll ? '全部' : isNone ? '全不选 · 无匹配' : (selected.length === 1 ? labelOf(opts, selected[0]) : '已选 ' + selected.length + ' 项');
      const count = isAll || isNone ? 0 : selected.length;
      return '<div class="ms-filter" data-ms="' + k + '">' +
        '<label class="tiny-text">' + (DIM_LABELS[k] || k) + '</label>' +
        '<button type="button" class="ms-trigger" data-ms-trigger="' + k + '">' +
        '<span class="ms-summary">' + P.h(summary) + '</span><span class="ms-caret">▾</span>' +
        (count ? '<span class="ms-count">' + count + '</span>' : '') + '</button>' +
        '<div class="ms-panel hidden" data-ms-panel="' + k + '"></div></div>';
    }).join('') + '<div class="spacer"></div>' +
      (P.isRestrictedView() ? '<span class="badge warn tiny-text">受限视图 · 敏感科目已隐藏</span>' : '');
  }

  function labelOf(opts, key) {
    const hit = opts.find((o) => o.key === key);
    return hit ? hit.label : key;
  }

  /* 面板：搜索 + 表头三态复选框 + 选项列表。
     勾选时【不重建 DOM】，只原地同步状态——旧实现每次勾选整块重绘，
     label 与 input 在重建过程中被二次触发，导致刚勾一项就跳成「全不选」。 */
  function panelHtml(k, opts) {
    const list = opts.map((o) => '<label class="ms-opt" data-ms-opt="' + P.h(o.key) + '" data-text="' + P.h(o.label.toLowerCase()) + '">' +
      '<input type="checkbox" value="' + P.h(o.key) + '" /><span title="' + P.h(o.label) + '">' + P.h(o.label) + '</span></label>').join('');
    return '<div class="ms-search"><input type="text" data-ms-search="' + k + '" placeholder="搜索' + P.h(DIM_LABELS[k] || k) + '…" value="' + P.h(ui.search[k] || '') + '" /></div>' +
      '<label class="ms-all"><input type="checkbox" data-ms-checkall="' + k + '" /><span>全选</span>' +
      '<em class="ms-all-count" data-ms-allcount="' + k + '"></em></label>' +
      '<div class="ms-options">' + (list || '<div class="ms-empty">没有可选项</div>') + '</div>' +
      '<div class="ms-foot"><span data-ms-foot="' + k + '"></span><span>共 ' + opts.length + ' 项</span></div>';
  }

  /* 当前状态下被选中的取值集合：「全部」= 所有取值 */
  function selectedKeys(k, opts) {
    const sel = picked(k);
    if (sel === null) return opts.map((o) => o.key);
    return sel.slice();
  }

  function visibleInputs(panel) {
    return P.qsa('.ms-opt', panel).filter((el) => el.style.display !== 'none')
      .map((el) => P.qs('input', el)).filter(Boolean);
  }

  /* 原地同步：触发器摘要 / 计数、面板内勾选态、表头三态复选框、底部统计 */
  function syncDimUI(k, opts) {
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    const sel = picked(k);
    const isAll = sel === null;
    const isNone = Array.isArray(sel) && sel.length === 0;
    const n = isAll ? opts.length : sel.length;
    const summary = isAll ? '全部' : isNone ? '全不选 · 无匹配' : (n === 1 ? labelOf(opts, sel[0]) : '已选 ' + n + ' 项');

    const trigger = P.qs('[data-ms-trigger="' + k + '"]', box);
    if (trigger) {
      const span = P.qs('.ms-summary', trigger);
      if (span) span.textContent = summary;
      let badge = P.qs('.ms-count', trigger);
      if (!isAll && !isNone && n > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'ms-count';
          trigger.appendChild(badge);
        }
        badge.textContent = n;
      } else if (badge) badge.remove();
    }

    const panel = P.qs('[data-ms-panel="' + k + '"]', box);
    if (!panel || panel.classList.contains('hidden')) return;

    const keys = selectedKeys(k, opts);
    P.qsa('.ms-opt', panel).forEach((el) => {
      const input = P.qs('input', el);
      if (input) input.checked = keys.indexOf(input.value) >= 0;
    });

    const vis = visibleInputs(panel);
    const visChecked = vis.filter((cb) => cb.checked).length;
    const checkAll = P.qs('[data-ms-checkall]', panel);
    if (checkAll) {
      checkAll.checked = vis.length > 0 && visChecked === vis.length;
      checkAll.indeterminate = visChecked > 0 && visChecked < vis.length;
      checkAll.disabled = vis.length === 0;
    }
    const allCount = P.qs('[data-ms-allcount]', panel);
    if (allCount) allCount.textContent = vis.length ? visChecked + ' / ' + vis.length : '';
    const foot = P.qs('[data-ms-foot]', panel);
    if (foot) foot.textContent = isAll ? '当前为「全部」' : isNone ? '已选 0（无匹配）' : '已选 ' + n + ' 项';
  }

  /* 从面板 checkbox 读取选中项并写回状态：
     全部选中 → 删除该维度（= 全部）；一项不选 → 空数组（= 全不选）；否则显式列表 */
  function commitDim(k, opts) {
    const panel = P.qs('[data-ms-panel="' + k + '"]', currentRoot);
    const keys = panel ? P.qsa('.ms-opt input', panel).filter((cb) => cb.checked).map((cb) => cb.value) : [];
    const f = filters();
    if (keys.length === 0) f.dimensions[k] = [];
    else if (keys.length === opts.length) delete f.dimensions[k];
    else f.dimensions[k] = keys;
    syncDimUI(k, opts);
    renderViewBody();
  }

  function renderFilters() {
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    box.innerHTML = filtersHtml();
    P.qsa('[data-ms-trigger]', box).forEach((btn) => btn.onclick = (e) => {
      e.stopPropagation();
      const k = btn.dataset.msTrigger;
      const panel = P.qs('[data-ms-panel="' + k + '"]', box);
      const opening = panel.classList.contains('hidden');
      P.qsa('[data-ms-panel]', box).forEach((p) => p.classList.add('hidden'));
      if (opening) {
        panel.innerHTML = panelHtml(k, dimOptions(sourceRows(), k));
        panel.classList.remove('hidden');
        ui.open = k;
        wirePanel(panel, k);
        const input = P.qs('[data-ms-search="' + k + '"]', panel);
        if (input) input.focus();
      } else ui.open = null;
    });
    document.removeEventListener('click', closeMsOutside);
    document.addEventListener('click', closeMsOutside);

    /* 重建筛选栏后，上次打开的面板保持展开（搜索词与勾选状态原地同步） */
    if (ui.open) {
      const panel = P.qs('[data-ms-panel="' + ui.open + '"]', box);
      if (panel && P.qs('[data-ms-trigger="' + ui.open + '"]', box)) {
        panel.innerHTML = panelHtml(ui.open, dimOptions(sourceRows(), ui.open));
        panel.classList.remove('hidden');
        wirePanel(panel, ui.open);
      }
    }
    updateStat();
  }

  function wirePanel(panel, k) {
    const opts = dimOptions(sourceRows(), k);
    /* 面板内部点击不冒泡：否则 document 上的「点外部关闭」会把面板立即关掉 */
    panel.onclick = (e) => e.stopPropagation();

    const search = P.qs('[data-ms-search="' + k + '"]', panel);
    if (search) {
      search.oninput = () => {
        ui.search[k] = search.value;
        const term = search.value.trim().toLowerCase();
        P.qsa('.ms-opt', panel).forEach((el) => {
          const text = el.dataset.text || '';
          el.style.display = !term || text.indexOf(term) >= 0 ? '' : 'none';
        });
        syncDimUI(k, opts);
      };
    }

    P.qsa('.ms-opt input', panel).forEach((cb) => { cb.onchange = () => commitDim(k, opts); });

    const checkAll = P.qs('[data-ms-checkall]', panel);
    if (checkAll) checkAll.onchange = () => {
      const vis = visibleInputs(panel);
      if (!vis.length) return;
      const allChecked = vis.every((cb) => cb.checked);
      vis.forEach((cb) => { cb.checked = !allChecked; });
      commitDim(k, opts);
    };

    /* 打开时按已有状态回填勾选，并应用上次的搜索词 */
    if (search && search.value) search.oninput();
    else syncDimUI(k, opts);
  }

  function closeMsOutside(e) {
    if (!currentRoot) return;
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    if (!box.contains(e.target)) {
      P.qsa('[data-ms-panel]', box).forEach((p) => p.classList.add('hidden'));
      ui.open = null;
    }
  }

  function updateStat() {
    const el = P.qs('#m3-filter-stat', currentRoot);
    if (!el) return;
    const noneDim = FILTER_DIMS.filter((k) => dimIsNone(k));
    if (noneDim.length) {
      el.innerHTML = '<span class="badge warn">' + noneDim.map((k) => DIM_LABELS[k] || k).join('、') + ' 为「全不选」，当前无匹配记录</span>';
      return;
    }
    el.textContent = '筛选后 ' + filteredRows.length + ' 行明细 · 来源：' + datasetLabel();
  }

  function widgetsHtml() {
    if (!current || !current.widgets.length) return '<div class="card"><div class="empty">选择上方模板一键生成图表，或手动添加组件。</div></div>';
    return '<div class="widget-grid" id="widget-grid">' + current.widgets.map((w, i) => widgetHtml(w, i)).join('') + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="row"><button class="btn tiny" id="add-widget">+ 添加图表组件</button>' +
      '<span class="tiny-text muted">拖动图表可调整顺序；筛选器对所有组件生效。</span></div></div>';
  }

  function widgetHtml(w, i) {
    return '<div class="widget w-' + (w.span || 6) + (w.type === 'kpi' ? ' kpi-widget' : '') + '" draggable="true" data-widx="' + i + '">' +
      '<div class="widget-head"><h4>' + P.h(w.title) + '</h4><div class="widget-tools">' +
      '<button data-move="up" title="上移">↑</button><button data-move="down" title="下移">↓</button>' +
      '<button data-edit="1" title="编辑">✎</button><button data-remove="1" title="删除">✕</button></div></div>' +
      '<div class="widget-body" data-body="' + i + '"></div></div>';
  }

  function viewBodyHtml() {
    const view = filters().view || 'chart';
    if (view === 'chart') return '<div style="margin-top:16px">' + widgetsHtml() + '</div>';
    return '<div class="card" style="margin-top:16px"><div id="m3-report-meta"></div><div id="m3-report-body"></div></div>';
  }

  function render(root) {
    currentRoot = root;
    root.innerHTML = toolbar() + '<div style="margin-top:16px" id="m3-view-body">' + viewBodyHtml() + '</div>';
    wireToolbar(root);
    renderFilters();
    applyFilters();
    renderViewBody();
  }

  function renderViewBody() {
    if (!currentRoot) return;
    const view = filters().view || 'chart';
    const body = P.qs('#m3-view-body', currentRoot);
    if (!body) return;
    if (view === 'chart') {
      const hasGrid = P.qs('#widget-grid', currentRoot);
      if (!hasGrid && current && current.widgets && current.widgets.length) {
        /* 首次由空态切换到有组件时，需要重建容器，否则查不到挂载点 */
        body.innerHTML = viewBodyHtml();
        wireWidgets();
      }
      renderWidgets();
      updateStat();
      return;
    }
    renderReportViews();
    updateStat();
  }

  async function loadDashboards() {
    const wsId = P.state.workspace ? P.state.workspace.id : null;
    dashboards = await P.dbList(P.TABLES.dashboards, { eq: { workspace_id: wsId }, order: 'updated_at', ascending: false });
    /* 切换空间后不得保留上一个空间的看板与筛选状态 */
    if (wsId !== currentWsId) {
      currentWsId = wsId;
      current = null;
      ui = { search: {}, open: null, trendCodes: [] };
    }
  }
  M.loadDashboards = loadDashboards;

  function wireToolbar(root) {
    const sel = P.qs('#m3-dataset', root);
    if (sel) sel.onchange = () => {
      const v = sel.value;
      const f = filters();
      f.source = v === 'all' ? { mode: 'all', datasetId: null } : { mode: 'dataset', datasetId: Number(v) };
      ui.open = null;
      renderFilters(); renderViewBody();
    };
    P.qs('#m3-dash', root).onchange = async (e) => {
      if (!e.target.value) { current = { name: '经营分析看板', widgets: [], filters: normalizeState({}) }; render(root); return; }
      const d = dashboards.find((x) => x.id === Number(e.target.value));
      if (!d) return;
      current = {
        id: d.id, name: d.name,
        widgets: Array.isArray(d.widgets_json) ? d.widgets_json : [],
        filters: normalizeState(d.filters_json || {}),
        layout: d.layout_json || []
      };
      ui.open = null;
      ui.search = {};
      render(root);
    };
    P.qs('#m3-name', root).oninput = (e) => { if (current) current.name = e.target.value; };
    P.qs('#m3-new', root).onclick = () => { current = { name: '经营分析看板', widgets: [], filters: normalizeState({}) }; ui = { search: {}, open: null, trendCodes: [] }; render(root); };
    P.qs('#m3-save', root).onclick = save;
    P.qsa('[data-view]', root).forEach((b) => b.onclick = () => {
      filters().view = b.dataset.view;
      P.qsa('[data-view]', root).forEach((x) => x.classList.toggle('active', x === b));
      const body = P.qs('#m3-view-body', currentRoot);
      if (body) body.innerHTML = viewBodyHtml();
      wireWidgets();
      renderViewBody();
    });
    P.qsa('[data-tpl]', root).forEach((b) => b.onclick = () => {
      const tpl = TEMPLATES[b.dataset.tpl];
      current = current || { name: '经营分析看板', widgets: [], filters: normalizeState({}) };
      current.widgets = tpl.widgets.map((w, i) => Object.assign({ id: P.uid() + '-' + i }, w));
      if (nameForTpl[b.dataset.tpl]) current.name = nameForTpl[b.dataset.tpl];
      P.qs('#m3-name', root).value = current.name;
      /* 首次生成时组件容器还不存在，必须整体重绘后才能挂载图表 */
      filters().view = 'chart';
      P.qsa('[data-view]', root).forEach((x) => x.classList.toggle('active', x.dataset.view === 'chart'));
      renderViewBody();
      P.toast('已按「' + tpl.label + '」习惯生成 ' + current.widgets.length + ' 个组件', 'ok');
    });
    wireWidgets();
  }

  function wireWidgets() {
    const root = currentRoot;
    const add = P.qs('#add-widget', root);
    if (add) add.onclick = openAddWidget;
    P.qsa('[data-widx]', root).forEach((el) => {
      const i = Number(el.dataset.widx);
      P.qsa('[data-move]', el).forEach((btn) => btn.onclick = () => move(i, btn.dataset.move === 'up' ? -1 : 1));
      const rm = P.qs('[data-remove]', el);
      if (rm) rm.onclick = () => { current.widgets.splice(i, 1); render(currentRoot); };
      const ed = P.qs('[data-edit]', el);
      if (ed) ed.onclick = () => openAddWidget(i);
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (isNaN(from) || from === i) return;
        const item = current.widgets.splice(from, 1)[0];
        current.widgets.splice(i, 0, item);
        render(currentRoot);
      });
    });
  }

  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= current.widgets.length) return;
    const tmp = current.widgets[i]; current.widgets[i] = current.widgets[j]; current.widgets[j] = tmp;
    render(currentRoot);
  }

  function openAddWidget(editIndex) {
    const w = editIndex != null ? current.widgets[editIndex] : { type: 'bar', title: '', measure: 'actual_profit', dimension: 'site', span: 6 };
    const measureOpts = window.PA_MEASURES.map((m) => '<option value="' + m.key + '"' + (w.measure === m.key ? ' selected' : '') + '>' + m.label + '</option>').join('');
    const dimOpts = P.DIM_KEYS.map((d) => '<option value="' + d + '"' + (w.dimension === d ? ' selected' : '') + '>' + (DIM_LABELS[d] || d) + '</option>').join('');
    const m = P.openModal(editIndex != null ? '编辑组件' : '添加图表组件',
      '<div class="form-grid"><div><label class="field-label">标题</label><input class="field" id="w-title" value="' + P.h(w.title) + '" /></div>' +
      '<div><label class="field-label">类型</label><select class="form-select" id="w-type">' +
      ['kpi', 'bar', 'line', 'pie', 'table'].map((t) => '<option value="' + t + '"' + (w.type === t ? ' selected' : '') + '>' + ({ kpi: '指标卡', bar: '柱状图', line: '折线图', pie: '饼图', table: '明细表' }[t]) + '</option>').join('') + '</select></div>' +
      '<div><label class="field-label">指标</label><select class="form-select" id="w-measure">' + measureOpts + '</select></div>' +
      '<div><label class="field-label">分组维度</label><select class="form-select" id="w-dim">' + dimOpts + '</select></div>' +
      '<div><label class="field-label">宽度</label><select class="form-select" id="w-span">' +
      [4, 6, 12].map((v) => '<option value="' + v + '"' + (Number(w.span) === v ? ' selected' : '') + '>' + v + ' / 12</option>').join('') + '</select></div></div>' +
      '<div class="row end"><button class="btn" data-close>取消</button><button class="btn primary" id="w-save">保存组件</button></div>', 480);
    P.qs('#w-save', m.root).onclick = () => {
      const cfg = {
        id: w.id || P.uid(), type: P.qs('#w-type', m.root).value,
        title: P.qs('#w-title', m.root).value.trim() || P.measureLabel(P.qs('#w-measure', m.root).value),
        measure: P.qs('#w-measure', m.root).value, dimension: P.qs('#w-dim', m.root).value,
        span: Number(P.qs('#w-span', m.root).value)
      };
      if (editIndex != null) current.widgets[editIndex] = cfg; else current.widgets.push(cfg);
      m.close(); render(currentRoot);
    };
  }

  function saveState() {
    const f = filters();
    return JSON.parse(JSON.stringify({
      version: 2,
      source: f.source,
      dimensions: f.dimensions,
      periodMode: f.periodMode || 'monthly',
      reportTemplateVersion: f.reportTemplateVersion || 'management-v1',
      view: f.view || 'chart'
    }));
  }

  async function save() {
    const view = filters().view || 'chart';
    /* 矩阵/管报视图只保存筛选状态也是有效配置；图表视图才要求有组件 */
    if (!current || (!current.widgets.length && view === 'chart')) { P.toast('请先生成或添加组件', 'error'); return; }
    const btn = P.qs('#m3-save', currentRoot);
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const payload = {
        workspace_id: P.state.workspace.id, owner_name: P.state.user.name || null,
        name: P.qs('#m3-name', currentRoot).value.trim() || '经营分析看板',
        widgets_json: current.widgets, filters_json: saveState(),
        layout_json: current.widgets.map((w) => w.id), updated_at: new Date().toISOString()
      };
      let saved;
      if (current.id) saved = await P.dbUpdate(P.TABLES.dashboards, current.id, payload);
      else saved = await P.dbInsert(P.TABLES.dashboards, payload);
      current.id = saved.id; current.name = saved.name;
      await loadDashboards();
      P.toast('看板已保存到协作空间（含数据源、筛选与视图）', 'ok');
      render(currentRoot);
    } catch (e) { P.toast('保存失败：' + e.message, 'error'); btn.disabled = false; btn.textContent = '保存看板'; }
  }

  /* ---------------- 图表组件 ---------------- */

  function renderWidgets() {
    if (!currentRoot || !current || !current.widgets) return;
    charts.forEach((c) => c.destroy && c.destroy()); charts = [];
    applyFilters();
    current.widgets.forEach((w, i) => {
      const body = P.qs('[data-body="' + i + '"]', currentRoot);
      if (!body) return;
      if (w.type === 'kpi') renderKpi(body, w);
      else if (w.type === 'table') renderTable(body, w);
      else renderChart(body, w);
    });
  }

  function renderKpi(body, w) {
    const s = P.summary(filteredRows);
    const v = s[w.measure] || 0;
    const unit = P.measureUnit(w.measure);
    const cls = ['profit_variance', 'revenue_variance', 'margin'].includes(w.measure) ? P.deltaClass(v) : '';
    body.innerHTML = '<div class="kpi-value ' + cls + '">' + (unit === 'percent' ? P.fmtPercent(v) : P.fmtCompact(v)) + '</div>' +
      '<div class="kpi-label">' + P.h(w.title) + ' · ' + P.h(P.measureLabel(w.measure)) + '</div>' +
      '<div class="tiny-text muted" style="margin-top:8px">基于 ' + filteredRows.length + ' 行明细实时计算</div>';
  }

  function renderTable(body, w) {
    const rows = P.aggregate(filteredRows, { dimensions: [w.dimension], measure: w.measure, agg: 'sum', orderBy: { field: 'value', direction: 'desc' }, limit: 12 });
    const base = P.summary(filteredRows);
    body.innerHTML = '<div class="table-wrap"><table><thead><tr><th>' + P.h(DIM_LABELS[w.dimension] || w.dimension) + '</th><th class="num">' + P.h(P.measureLabel(w.measure)) +
      '</th><th class="num">占实际利润</th></tr></thead><tbody>' + rows.map((r) => {
        const share = base.actual_profit ? r.value / Math.abs(base.actual_profit) : 0;
        return '<tr><td>' + P.h(r[w.dimension]) + '</td><td class="num ' + P.deltaClass(r.value) + '">' + P.formatMeasure(w.measure, r.value) +
          '</td><td class="num">' + P.fmtPercent(share) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderChart(body, w) {
    const data = P.aggregate(filteredRows, { dimensions: [w.dimension], measure: w.measure, agg: 'sum', orderBy: { field: 'value', direction: w.type === 'line' ? 'asc' : 'desc' }, limit: 20 });
    if (typeof Chart === 'undefined') {
      body.innerHTML = '<div class="tiny-text muted">图表库未加载，以下为表格视图：</div>' + data.map((r) => P.h(r[w.dimension]) + '：' + P.formatMeasure(w.measure, r.value)).join('<br>');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.style.maxHeight = '240px';
    body.innerHTML = '';
    body.appendChild(canvas);
    const labels = data.map((r) => r[w.dimension] == null ? '' : String(r[w.dimension]));
    const values = data.map((r) => r.value);
    const isPercent = P.measureUnit(w.measure) === 'percent';
    const cfg = {
      type: w.type === 'pie' ? 'doughnut' : w.type,
      data: {
        labels,
        datasets: [{
          label: P.measureLabel(w.measure),
          data: values.map((v) => isPercent ? Number((v * 100).toFixed(2)) : Math.round(v)),
          backgroundColor: w.type === 'pie' ? labels.map((_, i) => PALETTE[i % PALETTE.length]) : (w.type === 'line' ? 'rgba(47,107,255,.12)' : labels.map((_, i) => PALETTE[i % PALETTE.length])),
          borderColor: w.type === 'line' ? '#2f6bff' : undefined,
          borderWidth: w.type === 'line' ? 2 : 0,
          fill: w.type === 'line', tension: .3,
          pointBackgroundColor: '#2f6bff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: w.type === 'pie', position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => isPercent ? ctx.parsed.y + '%' : P.fmtMoney(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed) } }
        },
        scales: w.type === 'pie' ? {} : {
          y: { ticks: { callback: (v) => isPercent ? v + '%' : P.fmtCompact(v) }, grid: { color: '#eef1f6' } },
          x: { grid: { display: false }, ticks: { maxRotation: 30 } }
        }
      }
    };
    charts.push(new Chart(canvas, cfg));
  }

  /* ---------------- 科目月度对比 / 管报 ---------------- */

  function visibleTemplate() {
    const reg = registry();
    if (!reg) return [];
    if (!P.canSeeSubjectCode) return reg.list.slice();
    return reg.list.filter((s) => P.canSeeSubjectCode(s.code));
  }

  /* opts: { rule: 'direct'|'rollup', levels: [1..4] }；不传保持旧行为（direct、全部层级） */
  function buildMatrix(opts) {
    if (!window.PAReport || !window.PAReport.buildMonthlyMatrix) return null;
    const o = opts || {};
    applyFilters();
    return window.PAReport.buildMonthlyMatrix({
      facts: filteredRows,
      template: visibleTemplate(),
      filters: filters(),
      rules: {
        subjectRule: o.rule || 'direct',
        subjectKey: 'code',
        levels: o.levels || null
      }
    });
  }

  /* 经营分析报表：按月份列出科目，父级含同单位下级汇总 */
  function buildAnalysis() {
    if (!window.PAReport || !window.PAReport.buildPeriodMatrix) return null;
    applyFilters();
    return window.PAReport.buildPeriodMatrix({
      facts: filteredRows,
      template: visibleTemplate(),
      filters: filters(),
      rules: {
        subjectRule: 'rollup',
        subjectKey: 'code',
        data_type: '实际数',
        basisCode: '6001',
        levels: filters().levelFilter
      }
    });
  }

  function renderReportViews() {
    const metaEl = P.qs('#m3-report-meta', currentRoot);
    const bodyEl = P.qs('#m3-report-body', currentRoot);
    if (!metaEl || !bodyEl) return;

    const view = filters().view;
    const levels = filters().levelFilter;

    bodyEl.innerHTML = '';
    if (trendHandle && trendHandle.destroy) { trendHandle.destroy(); trendHandle = null; }
    if (reportHandle && reportHandle.destroy) { reportHandle.destroy(); reportHandle = null; }

    const onLevelsChange = (next) => {
      filters().levelFilter = normalizeLevelsInput(next);
      renderReportViews();
    };

    /* ---- 经营分析报表：期间矩阵（行=科目，列=月份，含总计与占收入比） ---- */
    if (view === 'analysis') {
      const pm = buildAnalysis();
      if (!pm) {
        metaEl.innerHTML = '';
        bodyEl.innerHTML = '<div class="empty">报表模块尚未加载（js/report/engine.js 未就绪），请刷新页面后重试。</div>';
        return;
      }
      const diag = (pm.diagnostics || []).concat(lastDiagnostics || []);
      const meta = Object.assign({}, pm.meta, { dataTypes: [pm.meta.dataType] });
      if (window.PAReportView && window.PAReportView.renderMeta) window.PAReportView.renderMeta(metaEl, meta, diag);
      else metaEl.innerHTML = '<div class="rpt-meta">共 ' + pm.rows.length + ' 行科目 · ' + pm.columns.length + ' 个月份</div>';

      if (window.PAReportView && window.PAReportView.renderAnalysis) {
        reportHandle = window.PAReportView.renderAnalysis(bodyEl, pm, {
          levels,
          basisLabel: '销售收入',
          onLevelsChange
        });
      } else {
        bodyEl.innerHTML = '<div class="empty">经营分析展示模块尚未加载（js/report/view.js 未就绪）。</div>';
      }
      return;
    }

    /* ---- 管报：父级汇总 + 层级勾选；科目月度对比：保持导入结果口径 ---- */
    const isReport = view === 'report';
    const matrix = buildMatrix(isReport ? { rule: 'rollup', levels } : {});
    if (!matrix) {
      metaEl.innerHTML = '';
      bodyEl.innerHTML = '<div class="empty">报表模块尚未加载（js/report/engine.js 未就绪），请刷新页面后重试。</div>';
      return;
    }
    const diag = (matrix.diagnostics || []).concat(lastDiagnostics || []);
    if (window.PAReportView && window.PAReportView.renderMeta) window.PAReportView.renderMeta(metaEl, matrix.meta, diag);
    else metaEl.innerHTML = '<div class="rpt-meta">共 ' + matrix.rows.length + ' 行科目 · ' + matrix.columns.length + ' 列</div>';

    if (view === 'matrix') {
      const picker = document.createElement('div');
      picker.className = 'm3-toolbar-line';
      picker.innerHTML = trendPickerHtml(matrix);
      bodyEl.appendChild(picker);
      const trendBox = document.createElement('div');
      trendBox.id = 'm3-trend-box';
      bodyEl.appendChild(trendBox);
      const tableBox = document.createElement('div');
      tableBox.id = 'm3-matrix-box';
      bodyEl.appendChild(tableBox);
      wireTrendPicker(matrix, trendBox);
      renderTrend(matrix, trendBox);
      if (window.PAReportView && window.PAReportView.renderMatrix) {
        window.PAReportView.renderMatrix(tableBox, matrix, {
          onRowClick: (code) => { if (ui.trendCodes.indexOf(code) < 0) { ui.trendCodes.push(code); renderTrend(matrix, trendBox); } }
        });
      }
      return;
    }

    if (window.PAReportView && window.PAReportView.renderReport) {
      reportHandle = window.PAReportView.renderReport(bodyEl, matrix, {
        levels,
        onLevelsChange
      });
    } else {
      bodyEl.innerHTML = '<div class="empty">管报展示模块尚未加载（js/report/view.js 未就绪）。</div>';
    }
  }

  function trendCandidates(matrix) {
    const totals = {};
    matrix.rows.forEach((r) => {
      /* 数量、人数与金额不是同一量纲，不进同一条趋势线 */
      if ((r.unit || 'money') !== 'money') return;
      let sum = 0;
      Object.keys(r.cells || {}).forEach((k) => { sum += Math.abs(Number(r.cells[k]) || 0); });
      if (sum > 0) totals[r.code] = sum;
    });
    return Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 40).map((code) => {
      const row = matrix.rows.find((r) => r.code === code);
      return { code, name: row ? row.name : code, total: totals[code] };
    });
  }

  function trendPickerHtml(matrix) {
    const list = trendCandidates(matrix);
    const nonMoney = matrix.rows.filter((r) => (r.unit || 'money') !== 'money' && r.hasData).length;
    const hint = nonMoney ? '<span class="tiny-text muted">已排除 ' + nonMoney + ' 个数量/人数科目（不与金额同轴）</span>' : '<span class="tiny-text muted">按住 Ctrl / Cmd 可多选，最多 8 条</span>';
    if (!list.length) return '<span class="tiny-text muted">当前筛选范围没有可绘制趋势的金额科目</span>' + hint;
    if (!ui.trendCodes.length) ui.trendCodes = list.slice(0, 3).map((x) => x.code);
    return '<label class="tiny-text">趋势科目</label><select class="form-select" id="m3-trend-codes" multiple size="4" style="width:320px">' +
      list.map((x) => '<option value="' + P.h(x.code) + '"' + (ui.trendCodes.indexOf(x.code) >= 0 ? ' selected' : '') + '>' +
        P.h(x.name) + '（' + P.h(x.code) + '）</option>').join('') + '</select>' + hint;
  }

  function wireTrendPicker(matrix, trendBox) {
    const sel = P.qs('#m3-trend-codes', currentRoot);
    if (!sel) return;
    sel.onchange = () => {
      ui.trendCodes = Array.from(sel.selectedOptions).map((o) => o.value).slice(0, 8);
      renderTrend(matrix, trendBox);
    };
  }

  function renderTrend(matrix, trendBox) {
    if (!trendBox) return;
    if (trendHandle && trendHandle.destroy) { trendHandle.destroy(); trendHandle = null; }
    trendBox.innerHTML = '';
    if (!window.PAReport || !window.PAReport.buildTrend || !ui.trendCodes.length) return;
    const types = (matrix.meta && matrix.meta.dataTypes) || [];
    const dataType = types.indexOf('实际数') >= 0 ? '实际数' : types[0];
    const trend = window.PAReport.buildTrend({ matrix, codes: ui.trendCodes, data_type: dataType });
    if (!trend || !trend.labels.length) {
      trendBox.innerHTML = '<div class="empty">所选科目没有可展示的月份数据</div>';
      return;
    }
    if (window.PAReportView && window.PAReportView.renderTrend) {
      trendHandle = window.PAReportView.renderTrend(trendBox, trend, {});
    } else {
      trendBox.innerHTML = '<div class="empty">趋势展示模块未加载</div>';
    }
  }
})();
