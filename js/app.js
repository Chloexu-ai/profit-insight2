(function () {
  const P = window.PA;
  let shellBound = false;

  const MODULES = () => ({ m1: window.PAM1, m2: window.PAM2, m3: window.PAM3, m4: window.PAM4 });

  const App = (window.PAApp = {
    async onSession(session) {
      if (!shellBound) { bindShell(); shellBound = true; }
      await loadWorkspaces();
      const select = P.qs('#workspace-select');
      if (!P.state.workspaces.length) {
        try {
          await P.dbInsert(P.TABLES.workspaces, {
            name: '默认协作空间', description: '我的利润分析工作区', owner_name: P.state.user.name || null
          });
          await loadWorkspaces();
        } catch (e) { P.toast('初始化协作空间失败：' + e.message, 'error'); }
      }
      select.innerHTML = P.state.workspaces.map((w) => '<option value="' + w.id + '">' + P.h(w.name) + '</option>').join('');
      if (P.state.workspaces.length) await switchWorkspace(P.state.workspaces[0].id);
      await App.activateModule('m1');
    },

    async activateModule(id) {
      P.state.activeModule = id;
      P.qsa('#module-nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.module === id));
      const mod = MODULES()[id];
      if (!mod) return;
      P.qs('#module-header').innerHTML = '<h1>' + P.h(mod.title) + '</h1><p>' + P.h(mod.desc) + '</p>';
      const root = P.qs('#module-root');
      root.innerHTML = '';
      try { mod.mount(root); }
      catch (e) { root.innerHTML = '<div class="module-error">模块加载失败：' + P.h(e.message) + '</div>'; }
    },

    refreshModuleIndicators() {
      const flags = {
        m1: P.state.datasets.length > 0,
        m2: P.state.datasets.length > 0,
        m3: P.state.datasets.length > 0,
        m4: P.state.datasets.length > 0
      };
      P.qsa('#module-nav .nav-item').forEach((b) => b.classList.toggle('ready', !!flags[b.dataset.module]));
    }
  });

  async function loadWorkspaces() {
    P.state.workspaces = await P.dbList(P.TABLES.workspaces, { order: 'created_at' });
  }

  async function switchWorkspace(id) {
    const ws = P.state.workspaces.find((w) => w.id === Number(id));
    if (!ws) return;
    P.state.workspace = ws;
    const uid = P.state.user.id;
    P.state.role = ws.owner_id === uid ? 'owner' : 'viewer';
    P.state.members = await P.dbList(P.TABLES.members, { eq: { workspace_id: ws.id }, order: 'created_at' });
    const mine = P.state.members.find((m) => m.user_id === uid);
    if (mine && P.state.role !== 'owner') P.state.role = mine.role;
    P.state.datasets = await P.dbList(P.TABLES.datasets, { eq: { workspace_id: ws.id }, order: 'created_at', ascending: false });
    P.qs('#side-ws-name').textContent = ws.name;
    P.qs('#side-role').textContent = P.state.role === 'owner' ? '空间所有者 · 可管理成员' :
      P.state.role === 'editor' ? '编辑成员 · 可设计模块' : '只读成员 · 可查看数据';
    const sel = P.qs('#workspace-select');
    if (sel) sel.value = String(ws.id);
    await Promise.allSettled([
      window.PAM2 && window.PAM2.loadHistory(),
      window.PAM3 && window.PAM3.loadDashboards(),
      window.PAM4 && window.PAM4.load()
    ]);
    App.refreshModuleIndicators();
    const mod = MODULES()[P.state.activeModule];
    if (mod && mod.refresh) mod.refresh();
  }

  function bindShell() {
    P.qsa('#module-nav .nav-item').forEach((b) => b.onclick = () => App.activateModule(b.dataset.module));
    P.qs('#workspace-select').onchange = async (e) => { await switchWorkspace(e.target.value); await App.activateModule(P.state.activeModule); };
    P.qs('#workspace-new').onclick = openWorkspaceModal;
    P.qs('#workspace-members').onclick = openMembersModal;
  }

  function openWorkspaceModal() {
    const m = P.openModal('新建协作空间',
      '<p class="tiny-text muted">每个空间拥有独立的数据集、看板、问数历史与推送规则；成员可在空间内协作。</p>' +
      '<label class="field-label">空间名称</label><input class="field" id="ws-name" placeholder="例如：华东经营分析组" />' +
      '<label class="field-label" style="margin-top:12px">说明</label><input class="field" id="ws-desc" placeholder="选填" />' +
      '<div class="row end"><button class="btn" data-close>取消</button><button class="btn primary" id="ws-save">创建</button></div>', 440);
    P.qs('#ws-save', m.root).onclick = async () => {
      const name = P.qs('#ws-name', m.root).value.trim();
      if (!name) { P.toast('请填写空间名称', 'error'); return; }
      try {
        const created = await P.dbInsert(P.TABLES.workspaces, {
          name, description: P.qs('#ws-desc', m.root).value.trim() || null, owner_name: P.state.user.name || null
        });
        m.close();
        await loadWorkspaces();
        P.qs('#workspace-select').innerHTML = P.state.workspaces.map((w) => '<option value="' + w.id + '">' + P.h(w.name) + '</option>').join('');
        await switchWorkspace(created.id);
        P.toast('协作空间已创建', 'ok');
        await App.activateModule('m1');
      } catch (e) { P.toast('创建失败：' + e.message, 'error'); }
    };
  }

  function openMembersModal() {
    const ws = P.state.workspace;
    const isOwner = P.state.role === 'owner';
    const rows = (P.state.members || []).filter((m) => ws.owner_id === P.state.user.id || m.user_id === P.state.user.id || m.owner_id === P.state.user.id);
    const html = '<div class="alert info tiny-text">把你的用户 ID（右上角「复制我的 ID」）发给同事；同事登录后，由空间所有者在此邀请。编辑成员可设计 M1-M4，只读成员仅查看。</div>' +
      '<div id="member-list">' + rows.map((m) => '<div class="member-row"><div class="avatar">' + P.h((m.display_name || '成').slice(0, 1)) + '</div>' +
        '<div class="spacer"><b>' + P.h(m.display_name || '协作成员') + '</b><div class="tiny-text mono muted">' + P.h(m.user_id) + '</div></div>' +
        '<span class="badge ' + (m.role === 'editor' ? 'blue' : '') + '">' + (m.role === 'editor' ? '编辑' : '只读') + '</span>' +
        (isOwner ? '<button class="btn tiny danger" data-uninvite="' + m.id + '">移除</button>' : '') + '</div>').join('') +
      (rows.length ? '' : '<div class="empty">尚未邀请成员</div>') + '</div>' +
      (isOwner ? '<div class="form-grid" style="margin-top:16px"><div><label class="field-label">成员用户 ID</label><input class="field" id="invite-id" placeholder="粘贴对方复制的用户 ID" /></div>' +
        '<div><label class="field-label">显示名称</label><input class="field" id="invite-name" placeholder="例如：张经理" /></div>' +
        '<div class="full"><label class="field-label">权限</label><select class="form-select" id="invite-role"><option value="editor">编辑成员（可共同设计模块）</option><option value="viewer">只读成员（仅查看）</option></select></div></div>' +
        '<div class="row end"><button class="btn" data-close>关闭</button><button class="btn primary" id="do-invite">邀请加入</button></div>' :
        '<div class="row end"><button class="btn" data-close>关闭</button></div>');
    const m = P.openModal('成员协作 · ' + ws.name, html, 560);
    P.qsa('[data-uninvite]', m.root).forEach((b) => b.onclick = async () => {
      if (!(await P.confirm('移除后该成员将失去本空间访问权限。确认移除？', '移除成员'))) return;
      try { await P.dbDelete(P.TABLES.members, Number(b.dataset.uninvite)); await switchWorkspace(ws.id); m.close(); openMembersModal(); P.toast('成员已移除', 'ok'); }
      catch (e) { P.toast(e.message, 'error'); }
    });
    const invite = P.qs('#do-invite', m.root);
    if (invite) invite.onclick = async () => {
      const uid = P.qs('#invite-id', m.root).value.trim();
      if (!uid) { P.toast('请填写成员用户 ID', 'error'); return; }
      if (uid === P.state.user.id) { P.toast('不能邀请自己', 'error'); return; }
      try {
        await P.dbInsert(P.TABLES.members, {
          workspace_id: ws.id, user_id: uid,
          display_name: P.qs('#invite-name', m.root).value.trim() || '协作成员',
          role: P.qs('#invite-role', m.root).value
        });
        await switchWorkspace(ws.id); m.close(); openMembersModal(); P.toast('邀请已发送，对方刷新后即可看到空间', 'ok');
      } catch (e) { P.toast('邀请失败：' + e.message, 'error'); }
    };
  }

  (async function bootstrap() {
    const session = await P.restoreAuth();
    if (session) await P.enterApp(session);
  })();
})();
