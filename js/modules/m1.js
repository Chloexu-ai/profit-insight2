(function () {
  const P = window.PA;
  const M = (window.PAM1 = {
    id: 'm1',
    title: 'M1 · 数据导入工作台',
    desc: '预算与实际数据按模板清洗、校验后写入协作空间，供 M2/M3/M4 共同使用。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { currentRoot = null; }
  });

  let currentRoot = null;
  let rawRows = null;
  let cleaned = null;
  let override = null;
  let fileName = '';

  function headerHtml() {
    return '<div class="card"><div class="card-title"><h3>导入流程</h3><span class="sub">模板 → 清洗 → 校验 → 入库</span></div>' +
      '<div class="stepper"><div class="step active">1 · 选择文件</div><div class="step">2 · 字段与清洗</div><div class="step">3 · 预览入库</div></div>' +
      '<div class="dropzone" id="dropzone"><div class="big">⇪</div><b>拖入或选择预算 / 实际数据文件</b>' +
      '<p class="muted tiny-text">支持 CSV、XLSX、XLS；首行为表头；单次最多 5000 行</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" id="pick-file">选择文件</button>' +
      '<button class="btn" id="download-template">下载标准模板</button><button class="btn" id="load-sample">载入示例数据</button></div></div>' +
      '<input type="file" id="file-input" accept=".csv,.xlsx,.xls" class="hidden" />' +
      '<div id="import-preview"></div></div>';
  }

  function datasetHtml() {
    const ds = P.state.datasets;
    return '<div class="card"><div class="card-title"><h3>空间内数据集</h3>' +
      '<span class="sub">' + ds.length + ' 份 · M2/M3/M4 实时共享</span></div>' +
      (ds.length ? '<div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>期间</th><th class="num">行数</th><th>来源</th><th>创建人</th><th>操作</th></tr></thead><tbody>' +
        ds.map((d) => '<tr><td><b>' + P.h(d.name) + '</b></td><td><span class="badge ' + (d.kind === 'budget' ? 'warn' : 'blue') + '">' +
          (d.kind === 'budget' ? '预算' : '实际') + '</span></td><td>' + P.h(d.period || '—') + '</td><td class="num">' + d.row_count +
          '</td><td class="muted">' + P.h(d.source_file || '手工') + '</td><td class="muted">' + P.h(d.owner_name || '成员') + '</td>' +
          '<td><button class="btn tiny" data-preview="' + d.id + '">预览</button> <button class="btn tiny danger" data-del="' + d.id + '">删除</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">尚无数据集。先下载模板导入，或点击「载入示例数据」快速体验 M2-M4。</div>') +
      '</div>';
  }

  function render(root) {
    currentRoot = root;
    root.innerHTML = headerHtml() + datasetHtml();
    wire(root);
    if (cleaned) renderPreview(root);
    P.qsa('.step', root).forEach((s, i) => {
      s.classList.remove('active', 'done');
      if (i === (cleaned ? (rawRows ? 1 : 2) : 0)) s.classList.add('active');
      else if (cleaned && i < 2) s.classList.add('done');
    });
  }

  function wire(root) {
    const input = P.qs('#file-input', root);
    const zone = P.qs('#dropzone', root);
    P.qs('#pick-file', root).onclick = () => input.click();
    input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

    P.qs('#download-template', root).onclick = downloadTemplate;
    P.qs('#load-sample', root).onclick = loadSample;
    P.qsa('[data-preview]', root).forEach((b) => b.onclick = () => previewSaved(Number(b.dataset.preview)));
    P.qsa('[data-del]', root).forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.del);
      if (!(await P.confirm('删除后 M2/M3/M4 将不再能读取该数据集，且不可恢复。确认删除？', '删除数据集'))) return;
      try { await P.dbDelete(P.TABLES.datasets, id); await refreshDatasets(); P.toast('数据集已删除', 'ok'); }
      catch (e) { P.toast(e.message, 'error'); }
    });
  }

  async function refreshDatasets() {
    P.state.datasets = await P.dbList(P.TABLES.datasets, { eq: { workspace_id: P.state.workspace.id }, order: 'created_at', ascending: false });
    if (window.PAApp) window.PAApp.refreshModuleIndicators();
    if (currentRoot) render(currentRoot);
  }
  M.refreshDatasets = refreshDatasets;

  async function loadFile(file) {
    if (file.size > 10 * 1024 * 1024) { P.toast('文件超过 10MB，请拆分后再导入', 'error'); return; }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      if (rows.length > 5001) { P.toast('数据超过 5000 行，请先拆分', 'error'); return; }
      rawRows = rows;
      fileName = file.name;
      override = null;
      cleaned = P.cleanRows(rawRows);
      render(currentRoot);
      P.toast('已读取 ' + (rows.length - 1) + ' 行，请确认清洗结果', 'ok');
    } catch (e) { P.toast('文件解析失败：' + e.message, 'error'); }
  }

  const TEMPLATE_HEADERS = ['月份', '品牌', '站点', '平台', '明细渠道', '素材来源', '品类', '报表产品', '属性', '值', '一级科目', '二级科目', '三级科目', '四级科目'];

  function loadSample() {
    const headers = TEMPLATE_HEADERS;
    rawRows = [headers].concat(P_SAMPLE().map((r) => headers.map((h) => r[h])));
    fileName = '示例经营数据.csv';
    override = null;
    cleaned = P.cleanRows(rawRows);
    render(currentRoot);
    P.toast('示例数据已载入，可直接确认入库', 'ok');
  }
  function P_SAMPLE() { return window.PA_SAMPLE_ROWS; }

  function downloadTemplate() {
    const rows = [
      TEMPLATE_HEADERS,
      ['2026-01', '品牌A', '官网', '天猫', '直通车', '短视频A', '家电', '空调挂机', '实际收入', 1280000, '主营业务收入', '线上', '电商', '天猫'],
      ['2026-01', '品牌A', '官网', '天猫', '直通车', '短视频A', '家电', '空调挂机', '实际成本', 842000, '主营业务成本', '线上', '电商', '天猫'],
      ['2026-01', '品牌A', '官网', '天猫', '直通车', '短视频A', '家电', '空调挂机', '预算收入', 1200000, '预算收入', '线上', '电商', '天猫'],
      ['2026-01', '品牌A', '官网', '天猫', '直通车', '短视频A', '家电', '空调挂机', '预算成本', 810000, '预算成本', '线上', '电商', '天猫']
    ];
    const csv = '\ufeff' + rows.map((r) => r.join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = '利润分析导入模板.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderPreview(root) {
    const box = P.qs('#import-preview', root);
    if (!box || !cleaned) return;
    /* 映射面板：全部维度 + 属性/值 */
    const fields = P.DIM_KEYS.map((k) => [k, P.dimLabel(k)]).concat([['__attr__', '属性'], ['__value__', '值']]);
    /* 预览表：宽表行（长表已聚合），展示主要维度与指标 */
    const tableFields = [['period', '期间'], ['brand', '品牌'], ['platform', '平台'], ['product', '报表产品'],
      ['revenue', '实际收入'], ['cost', '实际成本'], ['budget', '预算收入'], ['budget_cost', '预算成本']];
    const reverse = {};
    Object.entries(cleaned.mapping).forEach(([h, k]) => { reverse[k] = h; });
    const headers = (rawRows && rawRows[0]) || [];
    box.innerHTML = '<div class="card-title" style="margin-top:18px"><h3>字段映射与清洗结果</h3><span class="sub">' +
      P.h(fileName) + ' · ' + cleaned.rows.length + ' 行有效数据</span></div>' +
      (cleaned.issues.length ? '<div class="alert info">' + cleaned.issues.map((x) => P.h(x)).join('<br>') + '</div>' : '<div class="alert ok">字段识别完整，未发现明显异常</div>') +
      '<div class="map-grid">' + fields.map(([key, label]) => {
        const opts = ['<option value="">— 不导入（保持默认）—</option>'].concat(headers.map((h, i) =>
          '<option value="' + P.h(h) + '"' + (reverse[key] === h ? ' selected' : '') + '>' + P.h(h) + '</option>'));
        return '<div class="map-row"><span style="width:70px;color:var(--text-soft)">' + label + '</span><select data-map="' + key + '">' + opts.join('') + '</select></div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin:14px 0"><label class="tiny-text">数据集名称</label><input class="field" id="ds-name" style="max-width:260px" value="' +
      P.h(fileName.replace(/\.[^.]+$/, '')) + '" /><label class="tiny-text">类型</label><select class="form-select" id="ds-kind" style="width:120px">' +
      '<option value="actual">实际数据</option><option value="budget">预算数据</option></select>' +
      '<button class="btn primary" id="do-import">确认入库</button><button class="btn" id="cancel-import">取消</button></div>' +
      '<div class="table-wrap"><table><thead><tr>' + tableFields.map((f) => '<th>' + f[1] + '</th>').join('') + '</tr></thead><tbody>' +
      cleaned.rows.slice(0, 8).map((r) => '<tr>' + tableFields.map((f) => '<td>' + P.h(r[f[0]]) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
    P.qsa('[data-map]', box).forEach((sel) => sel.onchange = () => {
      override = {};
      P.qsa('[data-map]', box).forEach((s) => { if (s.value) override[s.dataset.map] = s.value; });
      cleaned = P.cleanRows(rawRows, override);
      renderPreview(root);
    });
    P.qs('#cancel-import', box).onclick = () => { rawRows = null; cleaned = null; override = null; render(root); };
    P.qs('#do-import', box).onclick = async () => {
      if (!cleaned.rows.length) { P.toast('没有可导入的数据', 'error'); return; }
      const btn = P.qs('#do-import', box);
      btn.disabled = true; btn.textContent = '写入中…';
      try {
        const s = P.summary(cleaned.rows);
        await P.dbInsert(P.TABLES.datasets, {
          workspace_id: P.state.workspace.id,
          owner_name: P.state.user.name || null,
          name: P.qs('#ds-name', box).value.trim() || '未命名数据集',
          kind: P.qs('#ds-kind', box).value,
          period: P.dimensionValues(cleaned.rows, 'period').sort().join(' ~ '),
          columns_json: cleaned.columns,
          rows_json: cleaned.rows,
          row_count: cleaned.rows.length,
          source_file: fileName,
          validation_json: { issues: cleaned.issues, summary: s }
        });
        rawRows = null; cleaned = null; override = null;
        await refreshDatasets();
        P.toast('导入完成，M2/M3/M4 已可读取', 'ok');
      } catch (e) { P.toast('导入失败：' + e.message, 'error'); btn.disabled = false; btn.textContent = '确认入库'; }
    };
  }

  function previewSaved(id) {
    const ds = P.state.datasets.find((d) => d.id === id);
    if (!ds) return;
    const rows = Array.isArray(ds.rows_json) ? ds.rows_json : [];
    const s = P.summary(rows);
    const m = P.openModal('数据集预览 · ' + ds.name,
      '<p class="tiny-text muted">' + ds.row_count + ' 行 · ' + P.h(ds.period || '') + ' · ' + P.h(ds.source_file || '') + '</p>' +
      '<div class="kpi-inline"><div><span class="muted tiny-text">实际收入</span><b>' + P.fmtCompact(s.revenue) + '</b></div>' +
      '<div><span class="muted tiny-text">实际利润</span><b>' + P.fmtCompact(s.actual_profit) + '</b></div>' +
      '<div><span class="muted tiny-text">利润率</span><b>' + P.fmtPercent(s.margin) + '</b></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>期间</th><th>品牌</th><th>平台</th><th>报表产品</th><th class="num">收入</th><th class="num">成本</th><th class="num">利润</th></tr></thead><tbody>' +
      rows.slice(0, 30).map((r) => '<tr><td>' + P.h(r.period) + '</td><td>' + P.h(r.brand) + '</td><td>' + P.h(r.platform) + '</td><td>' + P.h(r.product) +
        '</td><td class="num">' + P.fmtMoney(r.revenue) + '</td><td class="num">' + P.fmtMoney(r.cost) + '</td><td class="num">' +
        P.fmtMoney(P.metricValue(r, 'actual_profit')) + '</td></tr>').join('') + '</tbody></table></div>', 760);
    return m;
  }
})();
