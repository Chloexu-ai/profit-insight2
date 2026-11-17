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
    if (!draft) draft = deepDict();
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
      '<button class="btn" id="md-export">导出 JSON</button>' +
      '<button class="btn" id="md-reset">恢复系统默认</button>' +
      (isOwner ? '<button class="btn primary" id="md-save">保存到协作空间</button>' : '<span class="tiny-text muted">仅空间所有者可保存</span>') +
      '</div></div>';
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
  }
})();
