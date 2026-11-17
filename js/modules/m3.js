(function () {
  const P = window.PA;
  const M = (window.PAM3 = {
    id: 'm3',
    title: 'M3 · 数据看板',
    desc: '按领导看数习惯一键生成图表，配置筛选器、调整布局并保存到协作空间。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { charts.forEach((c) => c.destroy && c.destroy()); charts = []; currentRoot = null; document.removeEventListener('click', closeMsOutside); }
  });

  let currentRoot = null;
  let dashboards = [];
  let current = null;
  let charts = [];
  let filteredRows = [];

  const PALETTE = ['#2f6bff', '#0e9f8a', '#f79009', '#7a5af8', '#d92d20', '#12b76a', '#1570ef', '#b54708'];

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

  function toolbar() {
    const ds = P.state.datasets;
    return '<div class="card"><div class="card-title"><h3>看板配置</h3><span class="sub">图表 · 筛选器 · 布局</span></div>' +
      '<div class="row"><div style="width:220px"><label class="field-label">数据源</label><select class="form-select" id="m3-dataset">' +
      '<option value="all">全部数据集（合并）</option>' + ds.map((d) => '<option value="' + d.id + '">' + P.h(d.name) + '</option>').join('') + '</select></div>' +
      '<div style="width:220px"><label class="field-label">已保存看板</label><select class="form-select" id="m3-dash"><option value="">— 新建看板 —</option>' +
      dashboards.map((d) => '<option value="' + d.id + '"' + (current && current.id === d.id ? ' selected' : '') + '>' + P.h(d.name) + '</option>').join('') + '</select></div>' +
      '<div style="width:160px"><label class="field-label">看板名称</label><input class="field" id="m3-name" value="' + P.h(current ? current.name : '经营分析看板') + '" /></div>' +
      '<div class="spacer"></div>' +
      Object.entries(TEMPLATES).map(([k, v]) => '<button class="btn tiny" data-tpl="' + k + '">一键生成 · ' + v.label + '</button>').join('') +
      '<button class="btn primary tiny" id="m3-save">保存看板</button><button class="btn tiny" id="m3-new">清空</button></div>' +
      '<div id="m3-filters" class="filter-bar" style="margin-top:12px"></div></div>';
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

  function render(root) {
    currentRoot = root;
    root.innerHTML = toolbar() + '<div style="margin-top:16px">' + widgetsHtml() + '</div>';
    wireToolbar(root);
    renderFilters();
    renderWidgets();
  }

  async function loadDashboards() {
    dashboards = await P.dbList(P.TABLES.dashboards, { eq: { workspace_id: P.state.workspace.id }, order: 'updated_at', ascending: false });
  }
  M.loadDashboards = loadDashboards;

  function sourceRows() {
    const sel = P.qs('#m3-dataset', currentRoot);
    const id = sel ? sel.value : 'all';
    let rows;
    if (id === 'all') rows = P.state.datasets.flatMap((d) => Array.isArray(d.rows_json) ? d.rows_json : []);
    else {
      const ds = P.state.datasets.find((d) => d.id === Number(id));
      rows = ds && Array.isArray(ds.rows_json) ? ds.rows_json : [];
    }
    /* 数据视图权限：业务端剔除敏感科目行 */
    return P.applyDataView(rows);
  }

  /* 归一化筛选值：既兼容旧的单值字符串，也支持新的数组（多选） */
  function filterValues(v) {
    if (v == null || v === '') return [];
    return Array.isArray(v) ? v.filter((x) => x !== '' && x != null).map(String) : [String(v)];
  }
  function applyFilters() {
    let rows = sourceRows();
    const f = current && current.filters ? current.filters : {};
    P.DIM_KEYS.forEach((k) => {
      const vals = filterValues(f[k]);
      if (vals.length) rows = rows.filter((r) => vals.indexOf(String(r[k])) >= 0);
    });
    filteredRows = rows;
  }

  function renderFilters() {
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    const rows = sourceRows();
    current = current || { name: '经营分析看板', widgets: [], filters: {} };
    current.filters = current.filters || {};
    const labels = window.PA_DIM_LABELS || {};
    const placeholder = { month: '未指定月份', data_type: '未分类', site: '未分类' };
    /* 只展示数据中真实存在取值的维度，避免历史/空维度塞满筛选栏 */
    const activeDims = P.DIM_KEYS.filter((k) => {
      const vals = P.dimensionValues(rows, k).filter((v) => v && v !== (placeholder[k] || '未分类'));
      return vals.length > 0;
    });
    box.innerHTML = activeDims.map((k) => {
      const label = labels[k] || k;
      const vals = P.dimensionValues(rows, k).filter((v) => v && v !== (placeholder[k] || '未分类'));
      const picked = filterValues(current.filters[k]);
      const summary = picked.length === 0 ? '全部' + label : (picked.length === 1 ? picked[0] : label + ' · 已选 ' + picked.length + ' 项');
      return '<div class="ms-filter" data-ms="' + k + '"><label class="tiny-text">' + label + '</label>' +
        '<button type="button" class="ms-trigger" data-ms-trigger="' + k + '"><span class="ms-summary">' + P.h(summary) + '</span><span class="ms-caret">▾</span>' +
        (picked.length ? '<span class="ms-count">' + picked.length + '</span>' : '') + '</button>' +
        '<div class="ms-panel hidden" data-ms-panel="' + k + '">' +
        '<div class="ms-actions"><button type="button" class="btn tiny ghost" data-ms-all="' + k + '">全选</button>' +
        '<button type="button" class="btn tiny ghost" data-ms-clear="' + k + '">清空</button></div>' +
        '<div class="ms-options">' + vals.map((v) => '<label class="ms-opt"><input type="checkbox" value="' + P.h(v) + '"' +
          (picked.indexOf(String(v)) >= 0 ? ' checked' : '') + ' /><span>' + P.h(v) + '</span></label>').join('') + '</div></div></div>';
    }).join('') + '<div class="spacer"></div>' +
      (P.isRestrictedView() ? '<span class="badge warn tiny-text">受限视图 · 敏感科目已隐藏</span>' : '') +
      '<div class="tiny-text muted">当前 ' + filteredRows.length + ' 行明细</div>';
    wireMultiSelect(box);
  }

  function wireMultiSelect(box) {
    /* 点击触发器：切换面板，点击外部关闭 */
    P.qsa('[data-ms-trigger]', box).forEach((btn) => btn.onclick = (e) => {
      e.stopPropagation();
      const k = btn.dataset.msTrigger;
      const panel = P.qs('[data-ms-panel="' + k + '"]', box);
      const willOpen = panel.classList.contains('hidden');
      P.qsa('[data-ms-panel]', box).forEach((p) => p.classList.add('hidden'));
      if (willOpen) panel.classList.remove('hidden');
    });
    document.addEventListener('click', closeMsOutside);
    /* 复选框变更：写回数组并刷新图表 */
    P.qsa('[data-ms-panel]', box).forEach((panel) => {
      const k = panel.dataset.msPanel;
      P.qsa('input[type=checkbox]', panel).forEach((cb) => cb.onchange = () => {
        current.filters[k] = P.qsa('input[type=checkbox]:checked', panel).map((x) => x.value);
        renderFilters(); renderWidgets();
      });
      const all = P.qs('[data-ms-all="' + k + '"]', panel);
      if (all) all.onclick = () => {
        current.filters[k] = P.qsa('input[type=checkbox]', panel).map((x) => x.value);
        renderFilters(); renderWidgets();
      };
      const clear = P.qs('[data-ms-clear="' + k + '"]', panel);
      if (clear) clear.onclick = () => { delete current.filters[k]; renderFilters(); renderWidgets(); };
    });
  }
  function closeMsOutside(e) {
    if (!currentRoot) return;
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    if (!box.contains(e.target)) P.qsa('[data-ms-panel]', box).forEach((p) => p.classList.add('hidden'));
  }

  function wireToolbar(root) {
    P.qs('#m3-dataset', root).onchange = () => { renderFilters(); renderWidgets(); };
    P.qs('#m3-dash', root).onchange = async (e) => {
      if (!e.target.value) { current = { name: '经营分析看板', widgets: [], filters: {} }; render(root); return; }
      const d = dashboards.find((x) => x.id === Number(e.target.value));
      if (!d) return;
      current = { id: d.id, name: d.name, widgets: Array.isArray(d.widgets_json) ? d.widgets_json : [], filters: d.filters_json || {}, layout: d.layout_json || [] };
      render(root);
    };
    P.qs('#m3-name', root).oninput = (e) => { if (current) current.name = e.target.value; };
    P.qs('#m3-new', root).onclick = () => { current = { name: '经营分析看板', widgets: [], filters: {} }; render(root); };
    P.qs('#m3-save', root).onclick = save;
    P.qsa('[data-tpl]', root).forEach((b) => b.onclick = () => {
      const tpl = TEMPLATES[b.dataset.tpl];
      current = current || { name: '经营分析看板', filters: {} };
      current.widgets = tpl.widgets.map((w, i) => Object.assign({ id: P.uid() + '-' + i }, w));
      if (nameForTpl[b.dataset.tpl]) current.name = nameForTpl[b.dataset.tpl];
      P.qs('#m3-name', root).value = current.name;
      renderWidgets();
      P.toast('已按「' + tpl.label + '」习惯生成 ' + current.widgets.length + ' 个组件', 'ok');
    });
    const add = P.qs('#add-widget', root);
    if (add) add.onclick = openAddWidget;
    P.qsa('[data-widx]', root).forEach((el) => {
      const i = Number(el.dataset.widx);
      P.qsa('[data-move]', el).forEach((btn) => btn.onclick = () => move(i, btn.dataset.move === 'up' ? -1 : 1));
      P.qs('[data-remove]', el).onclick = () => { current.widgets.splice(i, 1); render(root); };
      P.qs('[data-edit]', el).onclick = () => openAddWidget(i);
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (isNaN(from) || from === i) return;
        const item = current.widgets.splice(from, 1)[0];
        current.widgets.splice(i, 0, item);
        render(root);
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
    const labels = window.PA_DIM_LABELS || {};
    const dimOpts = P.DIM_KEYS.map((d) => '<option value="' + d + '"' + (w.dimension === d ? ' selected' : '') + '>' + (labels[d] || d) + '</option>').join('');
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

  async function save() {
    if (!current || !current.widgets.length) { P.toast('请先生成或添加组件', 'error'); return; }
    const btn = P.qs('#m3-save', currentRoot);
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const payload = {
        workspace_id: P.state.workspace.id, owner_name: P.state.user.name || null,
        name: P.qs('#m3-name', currentRoot).value.trim() || '经营分析看板',
        widgets_json: current.widgets, filters_json: current.filters || {},
        layout_json: current.widgets.map((w) => w.id), updated_at: new Date().toISOString()
      };
      let saved;
      if (current.id) saved = await P.dbUpdate(P.TABLES.dashboards, current.id, payload);
      else saved = await P.dbInsert(P.TABLES.dashboards, payload);
      current.id = saved.id; current.name = saved.name;
      await loadDashboards();
      P.toast('看板已保存到协作空间', 'ok');
      render(currentRoot);
    } catch (e) { P.toast('保存失败：' + e.message, 'error'); btn.disabled = false; btn.textContent = '保存看板'; }
  }

  function renderWidgets() {
    if (!currentRoot) return;
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
    body.innerHTML = '<div class="table-wrap"><table><thead><tr><th>' + P.h(dimLabel(w.dimension)) + '</th><th class="num">' + P.h(P.measureLabel(w.measure)) +
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

  function dimLabel(k) { return (window.PA_DIM_LABELS || {})[k] || k; }
})();
