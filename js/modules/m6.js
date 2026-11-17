(function () {
  const P = window.PA;
  const M = (window.PAM6 = {
    id: 'm6',
    title: 'M6 · 主数据维护',
    desc: '在线维护维度枚举、别名与科目编码，业务场景变化时即时更新，M1/M3/M2 自动跟随。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { currentRoot = null; }
  });

  let currentRoot = null;
  let selectedKey = 'subject';
  let draft = null;

  function deepDict() { return JSON.parse(JSON.stringify(window.PA_DICT)); }

  function render(root) {
    currentRoot = root;
    if (!draft) {
      draft = deepDict();
      if (P.state.masterdata && P.state.masterdata.subjectTree) draft.subjectTree = JSON.parse(JSON.stringify(P.state.masterdata.subjectTree));
    }
    const dims = draft.dimensions || [];
    const isOwner = P.state.role === 'owner';
    const custom = !!P.state.masterdata;

    const side = dims.map((d) => '<button class="md-nav' + (d.key === selectedKey ? ' active' : '') + '" data-md-key="' + d.key + '">' +
      '<b>' + P.h(d.label) + '</b><small class="mono">' + P.h(d.key) + ' · ' + ((d.values || []).length) + ' 项</small></button>').join('');

    root.innerHTML =
      '<div class="card"><div class="card-title"><h3>主数据字典维护</h3><span class="sub">' +
      (custom ? '空间自定义版本' : '当前使用系统默认') + ' · ' + dims.length + ' 个维度</span></div>' +
      '<div class="alert info tiny-text">按业务场景维护各维度的标准取值、别名与编码。保存后写入本协作空间，M1 导入规范化、M3 筛选器、M2 问数口径会自动使用新字典；其他空间不受影响。</div>' +
      '<div class="md-layout"><aside class="md-side">' + side + '</aside><div class="md-main" id="md-main"></div></div>' +
      '<div class="row end" style="margin-top:14px">' +
      (isOwner ? '<button class="btn" id="md-import-subject">从 Excel 导入科目主数据</button>' : '') +
      '<button class="btn" id="md-export">导出 JSON</button>' +
      '<button class="btn" id="md-reset">恢复系统默认</button>' +
      (isOwner ? '<button class="btn primary" id="md-save">保存到协作空间</button>' : '<span class="tiny-text muted">仅空间所有者可保存</span>') +
      '</div>' +
      '<input type="file" id="md-subject-file" accept=".xlsx,.xls,.csv" style="display:none" />' +
      '<p class="tiny-text muted" style="margin-top:8px">「从 Excel 导入科目主数据」：上传《管报主数据及定义.xlsx》，自动识别「科目主数据」sheet 的四级科目与编码列，重建科目编码体系；导入后需点「保存到协作空间」才对全空间生效。</p>' +
      '</div>';
    renderEditor();
    wire(root);
  }

  function currentDef() { return (draft.dimensions || []).find((d) => d.key === selectedKey) || {}; }

  function renderEditor() {
    const box = P.qs('#md-main', currentRoot);
    if (!box) return;
    const d = currentDef();
    const isSubject = d.key === 'subject';
    const values = d.values || [];
    const codes = d.codes || [];
    const amap = d.aliasesMap || {};

    /* 标准取值：科目维度用「编码 | 名称 | 别名」三列，其余维度单列 */
    let tableHead, tableBody;
    if (isSubject) {
      tableHead = '<tr><th style="width:90px">编码</th><th>标准名称</th><th style="width:80px">操作</th></tr>';
      tableBody = values.map((v, i) => '<tr data-vrow="' + i + '">' +
        '<td><input class="field md-code" value="' + P.h(codes[i] || '') + '" placeholder="如 2101" /></td>' +
        '<td><input class="field md-val" value="' + P.h(v) + '" /></td>' +
        '<td><button class="btn tiny danger" data-vdel="' + i + '">删</button></td></tr>').join('');
    } else {
      tableHead = '<tr><th>标准取值</th><th style="width:80px">操作</th></tr>';
      tableBody = values.map((v, i) => '<tr data-vrow="' + i + '">' +
        '<td><input class="field md-val" value="' + P.h(v) + '" /></td>' +
        '<td><button class="btn tiny danger" data-vdel="' + i + '">删</button></td></tr>').join('');
    }
    const aliasLines = Object.entries(amap).map(([k, v]) => k + '=' + v).join('\n');

    box.innerHTML =
      '<div class="row"><div><h4>' + P.h(d.label) + ' <span class="mono tiny-text muted">' + P.h(d.key) + '</span></h4>' +
      '<p class="tiny-text muted">' + (isSubject ? '科目编码用于上传录入，界面展示自动转为标准名称。编码须唯一。' : '每行一个标准取值，导入时系统按别名映射自动规范化到此列表。') + '</p></div></div>' +
      '<label class="field-label">标准取值' + (isSubject ? '（编码 / 名称）' : '') + '</label>' +
      '<div class="table-wrap md-values"><table><thead>' + tableHead + '</thead><tbody>' + tableBody + '</tbody></table></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn tiny" id="md-add-val">+ 添加一行</button></div>' +
      '<label class="field-label" style="margin-top:14px">别名映射 <span class="tiny-text muted">（每行 原写法=标准值；编码也写在这里用于导入识别）</span></label>' +
      '<textarea class="form-textarea" id="md-alias" rows="7" style="width:100%">' + P.h(aliasLines) + '</textarea>';

    P.qs('#md-add-val', box).onclick = () => { collectEditor(); draft.dimensions.find((x) => x.key === selectedKey).values.push('新取值'); renderEditor(); };
    P.qsa('[data-vdel]', box).forEach((b) => b.onclick = () => {
      collectEditor(); draft.dimensions.find((x) => x.key === selectedKey).values.splice(Number(b.dataset.vdel), 1); renderEditor();
    });
  }

  /* 把编辑器当前输入回写到 draft，避免切换维度时丢失 */
  function collectEditor() {
    const d = draft.dimensions.find((x) => x.key === selectedKey);
    if (!d) return;
    const box = P.qs('#md-main', currentRoot);
    if (!box) return;
    const vals = P.qsa('.md-val', box).map((el) => el.value.trim()).filter(Boolean);
    d.values = vals;
    const codes = P.qsa('.md-code', box).map((el) => el.value.trim());
    if (codes.length) d.codes = codes.slice(0, vals.length);
    const aliasText = P.qs('#md-alias', box).value || '';
    const amap = {};
    aliasText.split(/\r?\n/).forEach((line) => {
      const idx = line.indexOf('=');
      if (idx <= 0) return;
      const k = line.slice(0, idx).trim(), v = line.slice(idx + 1).trim();
      if (k && v) amap[k] = v;
    });
    d.aliasesMap = amap;
  }

  function wire(root) {
    P.qsa('[data-md-key]', root).forEach((b) => b.onclick = () => {
      collectEditor();
      selectedKey = b.dataset.mdKey;
      render(root);
    });
    const save = P.qs('#md-save', root);
    if (save) save.onclick = async () => {
      collectEditor();
      const cfg = { dimensions: draft.dimensions.map((d) => ({
        key: d.key, values: d.values, codes: d.codes, aliasesMap: d.aliasesMap
      })) };
      if (draft.subjectTree && draft.subjectTree.length) cfg.subjectTree = draft.subjectTree;
      save.disabled = true; save.textContent = '保存中…';
      try {
        const ws = P.state.workspace.id;
        const existing = await P.dbList(P.TABLES.masterdata, { eq: { workspace_id: ws }, limit: 1 });
        const payload = { dict_json: cfg, owner_name: P.state.user.name || null, updated_at: new Date().toISOString() };
        if (existing && existing.length) await P.dbUpdate(P.TABLES.masterdata, existing[0].id, payload);
        else await P.dbInsert(P.TABLES.masterdata, Object.assign({ workspace_id: ws }, payload));
        P.applyMasterdata(cfg);
        draft = deepDict();
        P.toast('主数据已保存并在本空间生效', 'ok');
        render(root);
      } catch (e) { P.toast('保存失败：' + e.message, 'error'); save.disabled = false; save.textContent = '保存到协作空间'; }
    };
    P.qs('#md-reset', root).onclick = async () => {
      if (!(await P.confirm('恢复系统默认字典将删除本空间的自定义主数据，确认继续？', '恢复默认'))) return;
      try {
        const existing = await P.dbList(P.TABLES.masterdata, { eq: { workspace_id: P.state.workspace.id }, limit: 1 });
        if (existing && existing.length) await P.dbDelete(P.TABLES.masterdata, existing[0].id);
        P.restoreDefaultDict();
        draft = deepDict();
        P.toast('已恢复系统默认字典', 'ok');
        render(root);
      } catch (e) { P.toast(e.message, 'error'); }
    };
    P.qs('#md-export', root).onclick = () => {
      collectEditor();
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = '管报主数据字典.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const importBtn = P.qs('#md-import-subject', root);
    const fileInput = P.qs('#md-subject-file', root);
    if (importBtn && fileInput) {
      importBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => { if (fileInput.files && fileInput.files[0]) importSubjectFile(fileInput.files[0]); fileInput.value = ''; };
    }
  }

  /* 解析用户上传的科目主数据 Excel，重建 subject 字典。
     自动定位「科目主数据」sheet；识别「科目编码」列 + 一级/二级/三级/四级科目列；
     也兼容 CSV 与无表头 multilingual 情况：编码列=首个全为数字的列，科目列=其前的文本列。 */
  async function importSubjectFile(file) {
    try {
      if (typeof XLSX === 'undefined') { P.toast('Excel 解析组件未加载，请刷新页面重试', 'error'); return; }
      const buf = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      /* 优先选「科目主数据」sheet，否则遍历所有 sheet 找含编码列的 */
      let sheet = wb.Sheets['科目主数据'];
      let rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) : [];
      if (!rows.length) {
        for (const nm of wb.SheetNames) {
          const r = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '', raw: false });
          if (detectCodeCol(r) >= 0) { rows = r; break; }
        }
      }
      const codeCol = detectCodeCol(rows);
      if (codeCol < 0) { P.toast('未识别到科目编码列（需一列全为数字编码，如 6001 / 6602010101）', 'error'); return; }
      const nameCols = [];
      for (let c = 0; c < codeCol; c++) nameCols.push(c);
      if (!nameCols.length) { P.toast('未识别到科目名称列（编码列左侧应有科目名称列）', 'error'); return; }
      /* 跳过表头行：找到第一行编码列是纯数字的行 */
      let start = 0;
      for (let i = 0; i < rows.length; i++) { if (/^\d+$/.test(String(rows[i][codeCol] || '').trim())) { start = i; break; } }
      const tree = [];
      for (let i = start; i < rows.length; i++) {
        const code = String(rows[i][codeCol] == null ? '' : rows[i][codeCol]).trim();
        if (!/^\d+$/.test(code)) continue;
        const path = nameCols.map((c) => String(rows[i][c] == null ? '' : rows[i][c]).trim()).filter(Boolean);
        if (!path.length) continue;
        tree.push({ c: code, n: path[path.length - 1], p: path, l: path[0] });
      }
      if (!tree.length) { P.toast('未解析到有效科目行', 'error'); return; }
      const built = P.buildSubjectDictFromTree(tree);
      const sub = draft.dimensions.find((d) => d.key === 'subject');
      if (sub) { sub.values = built.values; sub.codes = built.codes; sub.aliasesMap = built.aliasesMap; }
      draft.subjectTree = tree;
      selectedKey = 'subject';
      render(currentRoot);
      P.toast('已解析 ' + tree.length + ' 条科目（' + built.values.length + ' 个一级科目），请核对后保存到协作空间', 'ok');
    } catch (e) { P.toast('科目主数据导入失败：' + e.message, 'error'); }
  }

  /* 找出编码列：优先表头含「科目编码/编码/code」，否则取首个「数据区多数为纯数字」的列 */
  function detectCodeCol(rows) {
    if (!rows.length) return -1;
    const head = rows[0].map((x) => String(x == null ? '' : x).trim());
    const byName = head.findIndex((h) => /编码|code/i.test(h));
    if (byName >= 0) return byName;
    const maxCol = Math.max.apply(null, rows.map((r) => r.length));
    for (let c = 0; c < maxCol; c++) {
      let total = 0, num = 0;
      rows.forEach((r) => { const v = String(r[c] == null ? '' : r[c]).trim(); if (v) { total++; if (/^\d+$/.test(v)) num++; } });
      if (total >= 3 && num / total > 0.7) return c;
    }
    return -1;
  }
})();
