(function () {
  const P = window.PA;
  const M = (window.PAM1 = {
    id: 'm1',
    title: 'M1 · 数据导入工作台',
    desc: '按管报主数据模板导入预算 / 实际 / 预测数据，清洗校验后写入协作空间，供 M2/M3/M4 共同使用。',
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

  const TEMPLATE_HEADERS = () => window.PA_TEMPLATE_HEADERS || ['月份','数据类型','站点/国家','平台','渠道','素材来源','品牌','品类','报表产品','科目','金额'];
  const LABEL = () => window.PA_DIM_LABELS || {};
  const SUBJECT_UNIT_LABEL = { money: '金额', quantity: '数量', headcount: '人数' };

  function csvCell(c) {
    const s = String(c == null ? '' : c);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(rows, filename) {
    const csv = '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /* 科目名称 → 编码：优先 201 条注册表，其次旧 43 条简化编码 */
  function subjectCodeFor(name) {
    const res = P.resolveSubjectValue ? P.resolveSubjectValue(name) : null;
    if (res && res.match) return res.code;
    return P.subjectNameToCode(name) || '';
  }
  /* 预览/映射展示的字段：管报维度 + 金额 + 兼容指标 */
  const VIEW_FIELDS = [
    ['month', '月份'], ['data_type', '数据类型'], ['site', '站点/国家'], ['platform', '平台'],
    ['channel', '渠道'], ['material', '素材来源'], ['brand', '品牌'], ['category', '品类'],
    ['report_product', '报表产品'], ['subject', '科目'], ['amount', '金额'],
    ['revenue', '实际收入(归集)'], ['cost', '实际成本(归集)'], ['budget', '预算收入(归集)'], ['budget_cost', '预算成本(归集)']
  ];

  function headerHtml() {
    return '<div class="card"><div class="card-title"><h3>导入流程</h3><span class="sub">管报模板 → 清洗 → 校验 → 入库</span></div>' +
      '<div class="stepper"><div class="step active">1 · 选择文件</div><div class="step">2 · 字段与清洗</div><div class="step">3 · 预览入库</div></div>' +
      '<div class="dropzone" id="dropzone"><div class="big">⇪</div><b>拖入或选择预算 / 实际 / 预测数据文件</b>' +
      '<p class="muted tiny-text">支持 CSV、XLSX、XLS；首行为表头；按管报主数据模板：' + TEMPLATE_HEADERS().join(' / ') + '</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" id="pick-file">选择文件</button>' +
      '<button class="btn" id="download-template">下载管报模板</button><button class="btn" id="download-codes">科目编码表</button>' +
      '<button class="btn" id="view-master">查看主数据字典</button>' +
      '<button class="btn" id="load-sample">载入示例数据</button></div></div>' +
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
        '</tbody></table></div>' : '<div class="empty">尚无数据集。先下载管报模板导入，或点击「载入示例数据」快速体验 M2-M4。</div>') +
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
    P.qs('#download-codes', root).onclick = downloadSubjectCodes;
    P.qs('#load-sample', root).onclick = loadSample;
    P.qs('#view-master', root).onclick = viewMaster;
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

  function loadSample() {
    const headers = TEMPLATE_HEADERS();
    const map = { '月份':'month','数据类型':'data_type','站点/国家':'site','平台':'platform','渠道':'channel','素材来源':'material','品牌':'brand','品类':'category','报表产品':'report_product','科目':'subject','科目编码':'subject','金额':'amount' };
    rawRows = [headers].concat(window.PA_SAMPLE_ROWS.map((r) => headers.map((h) => h === '科目编码'
      ? (subjectCodeFor(r.subject) || r.subject)
      : r[map[h]])));
    fileName = '管报示例数据.csv';
    override = null;
    cleaned = P.cleanRows(rawRows);
    render(currentRoot);
    P.toast('管报示例数据已载入（科目以编码导入、自动转名称），可直接入库', 'ok');
  }

  function downloadTemplate() {
    const headers = TEMPLATE_HEADERS();
    const rows = [
      headers,
      ['1月','实际数','ID','Tiktok','tt自播','自制','GMEELAN','底妆','黑气垫',subjectCodeFor('销售收入') || '6001',1280000],
      ['1月','实际数','ID','Tiktok','tt自播','自制','GMEELAN','底妆','黑气垫',subjectCodeFor('产品成本-内核法') || '6401',842000],
      ['1月','预算数','ID','Tiktok','tt自播','自制','GMEELAN','底妆','黑气垫',subjectCodeFor('销售收入') || '6001',1200000]
    ];
    downloadCsv(rows, '管报数据导入模板.csv');
  }

  /* 科目编码对照表下载：优先导出完整科目树（含四级），否则退回统计科目表 */
  function downloadSubjectCodes() {
    let rows;
    const tree = window.PA_SUBJECT_TREE;
    if (Array.isArray(tree) && tree.length) {
      rows = [['科目编码', '一级科目', '二级科目', '三级科目', '四级科目', '科目名称']].concat(tree.map((o) => {
        const p = o.p || [];
        return [o.c, p[0] || '', p[1] || '', p[2] || '', p[3] || '', o.n];
      }));
    } else {
      const def = (window.PA_DICT.dimensions || []).find((d) => d.key === 'subject') || {};
      rows = [['科目编码','科目名称']].concat((def.values || []).map((v, i) => [def.codes ? def.codes[i] : '', v]));
    }
    const csv = '\ufeff' + rows.map((r) => r.map((c) => String(c == null ? '' : c).indexOf(',') >= 0 ? '"' + c + '"' : c).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = '科目编码对照表.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* 科目注册表统计：201 条、层级分布、重名提示 */
  function subjectStatsHtml() {
    const reg = P.reportRegistry();
    if (!reg) return '<div class="alert info">科目注册表（js/report/subjects.js）未加载，暂按旧版 43 条科目编码展示。</div>';
    const levels = { 1: 0, 2: 0, 3: 0, 4: 0 };
    (reg.list || []).forEach((s) => { if (levels[s.level] != null) levels[s.level] += 1; });
    const dups = reg.duplicates || [];
    const dupSample = dups.slice(0, 6).join('、');
    return '<div class="alert info"><b>科目模板 ' + P.h(reg.version) + ' · 共 ' + reg.size + ' 条</b>' +
      '<div class="tiny-text" style="margin-top:6px">层级分布：一级 ' + levels[1] + ' 条 / 二级 ' + levels[2] + ' 条 / 三级 ' + levels[3] + ' 条 / 四级 ' + levels[4] + ' 条</div>' +
      '<div class="tiny-text" style="margin-top:4px">重名科目 ' + dups.length + ' 组' + (dupSample ? '（如 ' + P.h(dupSample) + ' 等）' : '') +
      '：<b>同名不同编码，必须按编码区分，不能按名称合并</b>。</div>' +
      ((reg.anomalies || []).length ? '<div class="tiny-text" style="margin-top:4px">模板结构异常 ' + reg.anomalies.length + ' 行：编码 ' +
        P.h(reg.anomalies.map((a) => a.code).join('、')) + '（编码层级与文字层级不一致，按编码层级归档）</div>' : '') +
      '</div>';
  }

  function viewMaster() {
    const dims = window.PA_DICT.dimensions || [];
    const rows = dims.map((d) => {
      const vals = (d.values || []).slice(0, 14);
      const more = (d.values || []).length > vals.length ? ' …等 ' + d.values.length + ' 项' : '';
      return '<tr><td><b>' + P.h(d.label) + '</b></td><td class="mono tiny-text">' + P.h(d.key) + '</td><td>' +
        P.h(vals.join('、')) + more + '</td></tr>';
    }).join('');
    P.openModal('管报主数据字典（维度与取值）',
      '<p class="tiny-text muted">导入时系统已按此字典自动规范化：编码（如 C10/S33/T02）、别名（如「德国」「速卖通」）与大小写都会转换为标准值；德国编码 DE 统一为 GE。</p>' +
      subjectStatsHtml() +
      '<div class="table-wrap"><table><thead><tr><th>维度</th><th>字段</th><th>标准取值</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="tiny-text muted" style="margin-top:10px">数据类型：实际数 / 预算数 / 预测数；金额 + 科目 + 数据类型会自动归集出实际收入、成本与预算指标，供 M2/M3/M4 使用。</p>' +
      '<p class="tiny-text muted" style="margin-top:8px"><b>科目请用编码录入</b>（编码来自你的《管报主数据及定义.xlsx》科目主数据，如 6001=销售收入、6401=产品成本-内核法、4102=销售毛利-内核法、9002=净利润-内核法，支持四级明细如 6602010101=平台佣金）：编码比汉字更不易写错，上传后界面自动显示为标准名称。完整对照可点「科目编码表」下载；如主数据有更新，请到 M6「从 Excel 导入科目主数据」重新导入。</p>', 760);
  }

  function renderPreview(root) {
    const box = P.qs('#import-preview', root);
    if (!box || !cleaned) return;
    const reverse = {};
    Object.entries(cleaned.mapping).forEach(([h, k]) => { reverse[k] = h; });
    const headers = (rawRows && rawRows[0]) || [];
    box.innerHTML = '<div class="card-title" style="margin-top:18px"><h3>字段映射与清洗结果</h3><span class="sub">' +
      P.h(fileName) + ' · ' + cleaned.rows.length + ' 行有效数据</span></div>' +
      (cleaned.issues.length ? '<div class="alert info">' + cleaned.issues.map((x) => P.h(x)).join('<br>') + '</div>' : '<div class="alert ok">字段识别完整，未发现明显异常</div>') +
      '<div class="map-grid">' + VIEW_FIELDS.map(([key, label]) => {
        const opts = ['<option value="">— 不导入 —</option>'].concat(headers.map((h, i) =>
          '<option value="' + P.h(h) + '"' + (reverse[key] === h ? ' selected' : '') + '>' + P.h(h) + '</option>'));
        return '<div class="map-row"><span style="width:96px;color:var(--text-soft)">' + label + '</span><select data-map="' + key + '">' + opts.join('') + '</select></div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin:14px 0"><label class="tiny-text">数据集名称</label><input class="field" id="ds-name" style="max-width:260px" value="' +
      P.h(fileName.replace(/\.[^.]+$/, '')) + '" /><label class="tiny-text">类型</label><select class="form-select" id="ds-kind" style="width:120px">' +
      '<option value="actual">实际数据</option><option value="budget">预算数据</option></select>' +
      '<button class="btn primary" id="do-import">确认入库</button><button class="btn" id="cancel-import">取消</button></div>' +
      '<div class="table-wrap"><table><thead><tr>' + VIEW_FIELDS.map((f) => '<th>' + f[1] + '</th>').join('') + '</tr></thead><tbody>' +
      cleaned.rows.slice(0, 8).map((r) => '<tr>' + VIEW_FIELDS.map((f) => {
        let cell = r[f[0]];
        if (f[0] === 'subject' && cell) {
          const code = r.subject_code || P.subjectNameToCode(cell);
          if (code) cell = cell + ' (' + code + ')';
        }
        return '<td>' + P.h(cell) + '</td>';
      }).join('') + '</tr>').join('') +
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
        const dts = P.dimensionValues(cleaned.rows.filter((r) => r.data_type !== '未分类'), 'data_type').filter(Boolean);
        await P.dbInsert(P.TABLES.datasets, {
          workspace_id: P.state.workspace.id,
          owner_name: P.state.user.name || null,
          name: P.qs('#ds-name', box).value.trim() || '未命名数据集',
          kind: P.qs('#ds-kind', box).value,
          period: (dts.length ? dts.join('/') + ' · ' : '') + P.dimensionValues(cleaned.rows, 'month').filter((v) => v !== '未指定月份').sort().join(' ~ '),
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
    const rows = P.applyDataView(Array.isArray(ds.rows_json) ? ds.rows_json : []);
    const s = P.summary(rows);
    const hasMgmt = rows.some((r) => r.site || r.platform || r.data_type);
    const cols = hasMgmt
      ? [['month','月份'],['site','站点'],['platform','平台'],['subject','科目'],['data_type','类型'],['amount','金额']]
      : [['period','期间'],['region','区域'],['product','产品线'],['revenue','收入'],['cost','成本']];
    const m = P.openModal('数据集预览 · ' + ds.name,
      '<p class="tiny-text muted">' + ds.row_count + ' 行 · ' + P.h(ds.period || '') + ' · ' + P.h(ds.source_file || '') + '</p>' +
      '<div class="kpi-inline"><div><span class="muted tiny-text">实际收入</span><b>' + P.fmtCompact(s.revenue) + '</b></div>' +
      '<div><span class="muted tiny-text">实际利润</span><b>' + P.fmtCompact(s.actual_profit) + '</b></div>' +
      '<div><span class="muted tiny-text">利润率</span><b>' + P.fmtPercent(s.margin) + '</b></div></div>' +
      '<div class="table-wrap"><table><thead><tr>' + cols.map((c) => '<th>' + c[1] + '</th>').join('') + '</tr></thead><tbody>' +
      rows.slice(0, 30).map((r) => '<tr>' + cols.map((c) => '<td>' + P.h(c[0] === 'amount' ? P.fmtMoney(r[c[0]]) : r[c[0]]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>', 820);
    return m;
  }
})();
