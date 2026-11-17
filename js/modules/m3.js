(function () {
  const P = window.PA;
  const M = (window.PAM3 = {
    id: 'm3',
    title: 'M3 · 数据看板',
    desc: '按领导看数习惯一键生成图表，配置筛选器、调整布局并保存到协作空间。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { charts.forEach((c) => c.destroy && c.destroy()); charts = []; currentRoot = null; }
  });

  let currentRoot = null;
  let dashboards = [];
  let current = null;
  let charts = [];
  let filteredRows = [];
  let datasetSel = 'all';

  const PALETTE = ['#2f6bff', '#0e9f8a', '#f79009', '#7a5af8', '#d92d20', '#12b76a', '#1570ef', '#b54708'];

  /* 点击空白处 / Esc 关闭筛选浮层（模块只挂一次） */
  document.addEventListener('click', () => closeFilterPops());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilterPops(); });

  const TEMPLATES = {
    overview: {
      label: '经营总览', widgets: [
        { type: 'kpi', title: '实际收入', measure: 'revenue', span: 3 },
        { type: 'kpi', title: '实际利润', measure: 'actual_profit', span: 3 },
        { type: 'kpi', title: '利润率', measure: 'margin', span: 3 },
        { type: 'kpi', title: '利润预算差异', measure: 'profit_variance', span: 3 },
        { type: 'line', title: '利润趋势（按期间）', measure: 'actual_profit', dimension: 'period', span: 12 },
        { type: 'bar', title: '品牌收入对比', measure: 'revenue', dimension: 'brand', span: 6 },
        { type: 'bar', title: '报表产品利润对比', measure: 'actual_profit', dimension: 'product', span: 6 }
      ]
    },
    attribution: {
      label: '利润归因', widgets: [
        { type: 'kpi', title: '利润差异', measure: 'profit_variance', span: 4 },
        { type: 'kpi', title: '收入差异', measure: 'revenue_variance', span: 4 },
        { type: 'kpi', title: '预算利润率', measure: 'margin', span: 4 },
        { type: 'bar', title: '报表产品利润差异', measure: 'profit_variance', dimension: 'product', span: 6 },
        { type: 'table', title: '品牌利润归因明细', measure: 'profit_variance', dimension: 'brand', span: 6 },
        { type: 'pie', title: '明细渠道利润结构', measure: 'actual_profit', dimension: 'channel', span: 12 }
      ]
    },
    brand: {
      label: '品牌对标', widgets: [
        { type: 'bar', title: '品牌收入排名', measure: 'revenue', dimension: 'brand', span: 6 },
        { type: 'bar', title: '品牌利润排名', measure: 'actual_profit', dimension: 'brand', span: 6 },
        { type: 'table', title: '品牌经营明细', measure: 'actual_profit', dimension: 'brand', span: 12 }
      ]
    }
  };

  function toolbar() {
    const ds = P.state.datasets;
    return '<div class="card"><div class="card-title"><h3>看板配置</h3><span class="sub">图表 · 筛选器 · 布局</span></div>' +
      '<div class="row"><div style="width:220px"><label class="field-label">数据源</label><select class="form-select" id="m3-dataset">' +
      '<option value="all"' + (datasetSel === 'all' ? ' selected' : '') + '>全部数据集（合并）</option>' +
      ds.map((d) => '<option value="' + d.id + '"' + (String(datasetSel) === String(d.id) ? ' selected' : '') + '>' + P.h(d.name) + '</option>').join('') + '</select></div>' +
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
    const id = sel ? sel.value : datasetSel;
    if (id === 'all') return P.state.datasets.flatMap((d) => Array.isArray(d.rows_json) ? d.rows_json : []);
    const ds = P.state.datasets.find((d) => d.id === Number(id));
    return ds && Array.isArray(ds.rows_json) ? ds.rows_json : [];
  }

  /* 筛选值统一为数组：兼容旧看板保存的字符串格式 */
  function normalizeFilters(f) {
    const out = {};
    Object.entries(f || {}).forEach(([k, v]) => {
      const arr = (Array.isArray(v) ? v : (v == null || String(v) === '' ? [] : [v])).map(String).filter((x) => x !== '');
      if (arr.length) out[k] = arr;
    });
    return out;
  }

  function filterText(k, list) {
    const label = P.dimLabel(k);
    if (!list || !list.length) return '全部' + label;
    if (list.length <= 2) return list.join('、');
    return '已选 ' + list.length + ' 项';
  }

  function closeFilterPops(except) {
    if (!currentRoot) return;
    P.qsa('.msf.open', currentRoot).forEach((el) => { if (el !== except) el.classList.remove('open'); });
  }

  function applyFilters() {
    let rows = sourceRows();
    const f = normalizeFilters(current && current.filters);
    P.DIM_KEYS.forEach((k) => {
      const sel = f[k];
      if (sel && sel.length) {
        const set = new Set(sel.map(String));
        rows = rows.filter((r) => set.has(String(r[k])));
      }
    });
    filteredRows = rows;
  }

  function renderFilters() {
    const box = P.qs('#m3-filters', currentRoot);
    if (!box) return;
    const rows = sourceRows();
    current = current || { name: '经营分析看板', widgets: [], filters: {} };
    current.filters = normalizeFilters(current.filters);
    box.innerHTML = P.DIM_KEYS.map((k) => {
      const label = P.dimLabel(k);
      const sel = (current.filters[k] || []).map(String);
      /* 已选值即使当前数据里没有也保留，避免切数据集后筛选失效 */
      const vals = Array.from(new Set(P.dimensionValues(rows, k).concat(sel))).sort();
      const searchable = vals.length > 8;
      return '<div class="msf" data-msf="' + k + '">' +
        '<label class="tiny-text">' + label + '</label>' +
        '<button type="button" class="msf-btn' + (sel.length ? ' active' : '') + '" title="' + P.h(filterText(k, sel)) + '">' +
        '<span class="msf-text">' + P.h(filterText(k, sel)) + '</span><span class="msf-caret">▾</span></button>' +
        '<div class="msf-pop" data-msf-pop="1">' +
        (searchable ? '<input class="msf-search" placeholder="搜索' + P.h(label) + '…" />' : '') +
        '<div class="msf-actions"><button type="button" data-msf-all>全选</button><button type="button" data-msf-none>清空</button>' +
        '<span class="msf-count">' + sel.length + ' / ' + vals.length + '</span></div>' +
        '<div class="msf-list">' + (vals.length ? vals.map((v) => {
          const text = String(v);
          return '<label class="msf-item" data-text="' + P.h(text.toLowerCase()) + '">' +
            '<input type="checkbox" value="' + P.h(text) + '"' + (sel.includes(text) ? ' checked' : '') + ' />' +
            '<span>' + P.h(text) + '</span></label>';
        }).join('') : '<div class="msf-empty">暂无可选值</div>') + '</div></div></div>';
    }).join('') +
      '<div class="spacer"></div>' +
      '<div class="msf-tail"><span class="tiny-text muted">当前 ' + rows.length + ' 行明细</span>' +
      '<button type="button" class="btn tiny" id="m3-filter-reset">清除筛选</button></div>';
    wireFilters(box);
  }

  function wireFilters(box) {
    P.qsa('.msf', box).forEach((msf) => {
      const k = msf.dataset.msf;
      const btn = P.qs('.msf-btn', msf);
      const countEl = P.qs('.msf-count', msf);
      const labelEl = P.qs('.msf-text', msf);
      const boxes = P.qsa('input[type="checkbox"]', msf);
      const sync = () => {
        const list = boxes.filter((b) => b.checked).map((b) => b.value);
        if (list.length) current.filters[k] = list; else delete current.filters[k];
        if (labelEl) labelEl.textContent = filterText(k, list);
        btn.classList.toggle('active', list.length > 0);
        btn.title = filterText(k, list);
        if (countEl) countEl.textContent = list.length + ' / ' + boxes.length;
        renderWidgets();
      };
      btn.onclick = (e) => {
        e.stopPropagation();
        const wasOpen = msf.classList.contains('open');
        closeFilterPops();
        if (!wasOpen) {
          msf.classList.add('open');
          const search = P.qs('.msf-search', msf);
          if (search) search.focus();
        }
      };
      const pop = P.qs('[data-msf-pop]', msf);
      if (pop) pop.onclick = (e) => e.stopPropagation();
      boxes.forEach((b) => { b.onchange = sync; });
      const all = P.qs('[data-msf-all]', msf);
      if (all) all.onclick = () => {
        P.qsa('.msf-item', msf).forEach((it) => {
          const cb = P.qs('input', it);
          if (cb && it.style.display !== 'none') cb.checked = true;
        });
        sync();
      };
      const none = P.qs('[data-msf-none]', msf);
      if (none) none.onclick = () => { boxes.forEach((b) => { b.checked = false; }); sync(); };
      const search = P.qs('.msf-search', msf);
      if (search) search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        P.qsa('.msf-item', msf).forEach((it) => {
          it.style.display = !q || (it.dataset.text || '').indexOf(q) >= 0 ? '' : 'none';
        });
      };
    });
    const reset = P.qs('#m3-filter-reset', box);
    if (reset) reset.onclick = () => {
      current.filters = {};
      renderFilters();
      renderWidgets();
      P.toast('筛选条件已清除', 'ok');
    };
  }

  function wireToolbar(root) {
    P.qs('#m3-dataset', root).onchange = (e) => { datasetSel = e.target.value; renderFilters(); renderWidgets(); };
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
      if (b.dataset.tpl === 'attribution') current.name = '利润归因看板';
      if (b.dataset.tpl === 'brand') current.name = '品牌对标看板';
      P.qs('#m3-name', root).value = current.name;
      /* 当前没有组件容器时要整体重绘，否则图表无处可渲染 */
      if (P.qs('#widget-grid', root)) renderWidgets(); else render(root);
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
    const w = editIndex != null ? current.widgets[editIndex] : { type: 'bar', title: '', measure: 'actual_profit', dimension: 'brand', span: 6 };
    const measureOpts = window.PA_MEASURES.map((m) => '<option value="' + m.key + '"' + (w.measure === m.key ? ' selected' : '') + '>' + m.label + '</option>').join('');
    const dimOpts = P.DIM_KEYS.map((d) => '<option value="' + d + '"' + (w.dimension === d ? ' selected' : '') + '>' + P.dimLabel(d) + '</option>').join('');
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

  function dimLabel(k) { return P.dimLabel(k); }
})();
