(function () {
  const P = window.PA;
  const M = (window.PAM5 = {
    id: 'm5',
    title: 'M5 · 数据权限中心',
    desc: '按科目级可见范围控制数据阅读与查询：管理层可见全部科目，业务端仅可见成本至毛利区间。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { currentRoot = null; }
  });

  let currentRoot = null;

  function render(root) {
    currentRoot = root;
    const views = P.dataViews();
    const curKey = P.currentViewKey();
    const ws = P.state.workspace || {};
    const isOwner = P.state.role === 'owner';

    const viewCards = Object.values(views).map((v) => {
      const active = v.key === curKey;
      const range = v.subjectMode === 'all' ? '全部科目（含净利润）' :
        '仅 ' + (v.subjectRange ? v.subjectRange[0] + ' → ' + v.subjectRange[1] : '受限区间');
      return '<div class="view-card' + (active ? ' active' : '') + '">' +
        '<div class="row"><h4>' + P.h(v.label) + '</h4><span class="badge ' + (v.subjectMode === 'all' ? 'red' : 'blue') + '">' + P.h(v.badge) + '</span>' +
        (active ? '<span class="badge teal">当前视图</span>' : '') + '</div>' +
        '<p class="tiny-text muted">' + P.h(v.desc) + '</p>' +
        '<div class="tiny-text"><b>可见科目：</b>' + P.h(range) + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn tiny ' + (active ? '' : 'primary') + '" data-preview="' + v.key + '">' +
        (active ? '正在使用' : '切换到此视图预览') + '</button></div></div>';
    }).join('');

    /* 成员视图分配（仅空间所有者可改） */
    const members = (P.state.members || []).filter((m) => ws.owner_id === P.state.user.id || m.user_id === P.state.user.id || m.owner_id === P.state.user.id);
    const ownerRow = '<div class="member-row"><div class="avatar">' + P.h((P.state.user.name || '我').slice(0, 1)) + '</div>' +
      '<div class="spacer"><b>' + P.h(P.state.user.name || '空间所有者') + '（我）</b><div class="tiny-text muted">固定为管理层视图</div></div>' +
      '<span class="badge red">管理层</span></div>';
    const memberRows = members.map((m) => {
      const dv = m.data_view || (window.PA_ROLE_VIEW && window.PA_ROLE_VIEW[m.role]) || 'business';
      const view = views[dv] || {};
      return '<div class="member-row"><div class="avatar">' + P.h((m.display_name || '成').slice(0, 1)) + '</div>' +
        '<div class="spacer"><b>' + P.h(m.display_name || '协作成员') + '</b><div class="tiny-text mono muted">' + P.h(m.user_id) + '</div></div>' +
        (isOwner
          ? '<select class="form-select" data-dv="' + m.id + '" style="width:130px">' +
            Object.values(views).map((v) => '<option value="' + v.key + '"' + (dv === v.key ? ' selected' : '') + '>' + v.label + '</option>').join('') + '</select>'
          : '<span class="badge ' + (dv === 'management' ? 'red' : 'blue') + '">' + P.h(view.label || dv) + '</span>') +
        '</div>';
    }).join('');
    const visibleSubjectList = (P.visibleSubjects() || (window.PA_DICT.dimensions.find((d) => d.key === 'subject') || {}).values || []);

    root.innerHTML =
      '<div class="card"><div class="card-title"><h3>我的数据视图</h3><span class="sub">切换后可立即查看不同角色的阅读效果</span></div>' +
      '<div class="alert info tiny-text">数据视图控制<strong>科目级的阅读与查询范围</strong>，对 M1 预览、M2 问数、M3 看板、M4 推送检查同时生效。切换仅影响你当前浏览器会话，不改变他人数据。</div>' +
      '<div class="view-grid">' + viewCards + '</div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-title"><h3>当前视图可见科目</h3><span class="sub">' + visibleSubjectList.length + ' 项</span></div>' +
      '<div class="chip-wrap">' + visibleSubjectList.map((s) => '<span class="chip">' + P.h(P.subjectDisplay(s)) + '</span>').join('') + '</div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-title"><h3>成员数据权限</h3><span class="sub">' +
      (isOwner ? '为成员分配视图，保存后对方刷新生效' : '仅空间所有者可修改') + '</span></div>' +
      ownerRow + memberRows +
      (members.length && isOwner ? '<div class="row end" style="margin-top:12px"><button class="btn primary" id="save-dv">保存成员权限</button></div>' : '') +
      (members.length ? '' : '<div class="empty">尚无其他成员，请先在顶部「成员协作」邀请。</div>') + '</div>' +

      '<div class="card" style="margin-top:16px"><div class="alert warn tiny-text">安全边界说明：本模块实现的是<strong>应用内的视图级隔离</strong>（按科目范围过滤展示与查询），适用于分工阅读与查询。原始数据仍按协作空间共享存储；如需防止直接读取底层数据的强安全隔离，需将敏感科目拆分为独立数据集并配合服务端行级权限（RLS）策略。</div></div>';

    wire(root);
  }

  function wire(root) {
    P.qsa('[data-preview]', root).forEach((b) => b.onclick = () => {
      P.setCurrentView(b.dataset.preview);
      P.toast('已切换到「' + P.currentView().label + '」，各模块刷新后按新视图显示', 'ok');
      render(root);
    });
    const save = P.qs('#save-dv', root);
    if (save) save.onclick = async () => {
      const sels = P.qsa('[data-dv]', root);
      if (!sels.length) return;
      save.disabled = true; save.textContent = '保存中…';
      try {
        for (const sel of sels) {
          await P.dbUpdate(P.TABLES.members, Number(sel.dataset.dv), { data_view: sel.value });
        }
        P.state.members = await P.dbList(P.TABLES.members, { eq: { workspace_id: P.state.workspace.id }, order: 'created_at' });
        P.toast('成员数据权限已保存，对方刷新后生效', 'ok');
        render(root);
      } catch (e) { P.toast('保存失败：' + e.message, 'error'); save.disabled = false; save.textContent = '保存成员权限'; }
    };
  }
})();
