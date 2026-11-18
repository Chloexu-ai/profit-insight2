(function () {
  const P = (window.PA = window.PA || {});

  P.state = {
    session: null, user: null, workspaces: [], workspace: null,
    members: [], role: 'viewer', dataView: null, masterdata: null,
    datasets: [], models: [], activeModule: 'm1'
  };
  try { const sv = sessionStorage.getItem('pa_data_view'); if (sv) P.state.dataView = sv; } catch (e) {}

  P.TABLES = {
    workspaces: 'pa_workspaces', members: 'pa_members', datasets: 'pa_datasets',
    queries: 'pa_queries', dashboards: 'pa_dashboards',
    pushRules: 'pa_push_rules', pushLogs: 'pa_push_logs',
    masterdata: 'pa_masterdata'
  };

  /* ---------------- base helpers ---------------- */
  P.qs = (sel, root) => (root || document).querySelector(sel);
  P.qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  P.h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P.uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  P.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  P.unwrap = function (res, label) {
    if (res && res.error) {
      const e = new Error(res.error.message || (label || '请求失败'));
      e.code = res.error.code;
      throw e;
    }
    return res ? res.data : null;
  };

  P.fmtMoney = function (n, digits) {
    const v = Number(n) || 0;
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits == null ? 0 : digits });
  };
  P.fmtCompact = function (n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1e8) return '¥' + (v / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return '¥' + (v / 1e4).toFixed(1) + '万';
    return P.fmtMoney(v);
  };
  P.fmtPercent = function (n, digits) {
    if (n == null || !isFinite(Number(n))) return '—';
    return (Number(n) * 100).toFixed(digits == null ? 1 : digits) + '%';
  };
  P.fmtDelta = function (n) {
    const v = Number(n) || 0;
    return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  };
  /* 中国区经营看数习惯：增长/正向差异红色，下降/负向差异绿色 */
  P.deltaClass = (n) => (Number(n) > 0 ? 'up' : Number(n) < 0 ? 'down' : 'muted');
  P.deltaArrow = (n) => (Number(n) > 0 ? '↑' : Number(n) < 0 ? '↓' : '→');

  P.toast = function (msg, type) {
    const wrap = P.qs('#toast-wrap');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, 3200);
  };

  P.openModal = function (title, html, width) {
    const root = P.qs('#modal-root');
    root.innerHTML = '<div class="modal" style="width:' + (width || 520) + 'px">' +
      '<div class="card-title"><h3>' + P.h(title) + '</h3><button class="btn tiny ghost" data-close>✕</button></div>' +
      '<div class="modal-body">' + html + '</div></div>';
    root.classList.remove('hidden');
    const close = () => { root.classList.add('hidden'); root.innerHTML = ''; };
    P.qsa('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    root.onclick = (e) => { if (e.target === root) close(); };
    return { root, close };
  };

  P.confirm = function (message, title) {
    return new Promise((resolve) => {
      const m = P.openModal(title || '请确认',
        '<p>' + P.h(message) + '</p><div class="row end"><button class="btn ghost" data-no>取消</button><button class="btn danger" data-yes>确认</button></div>', 420);
      P.qs('[data-no]', m.root).onclick = () => { m.close(); resolve(false); };
      P.qs('[data-yes]', m.root).onclick = () => { m.close(); resolve(true); };
    });
  };

  /* ---------------- database ---------------- */
  P.dbList = async function (table, options) {
    options = options || {};
    let q = cloud.database.from(table).select('*');
    Object.entries(options.eq || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) q = q.eq(k, v); });
    if (options.order) q = q.order(options.order, { ascending: options.ascending !== false });
    if (options.limit) q = q.limit(options.limit);
    return P.unwrap(await q, '读取' + table + '失败');
  };
  P.dbInsert = async function (table, row) {
    return P.unwrap(await cloud.database.from(table).insert(row).select(), '写入' + table + '失败');
  };
  P.dbUpdate = async function (table, id, patch) {
    const data = P.unwrap(await cloud.database.from(table).update(patch).eq('id', id).select(), '更新失败');
    if (!Array.isArray(data) || data.length === 0) throw new Error('没有可更新的记录，可能不属于当前用户或权限不足');
    return data[0];
  };
  P.dbDelete = async function (table, id) {
    return P.unwrap(await cloud.database.from(table).delete().eq('id', id).select(), '删除失败');
  };

  /* ---------------- auth ---------------- */
  let pendingOtp = null;
  let sendTimer = null;

  P.showLoginError = function (msg) {
    const box = P.qs('#login-error');
    if (box) { box.textContent = msg || ''; box.classList.toggle('hidden', !msg); }
  };
  P.showPhoneError = function (msg) {
    const box = P.qs('#phone-error');
    if (box) box.textContent = msg || '';
  };

  P.restoreAuth = async function () {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      return P.unwrap(await cloud.auth.getSession(), '恢复登录状态失败');
    }
    const provider = url.searchParams.get('provider');
    if (provider !== 'workbuddy' && provider !== 'wechat') {
      P.showLoginError('授权回调缺少有效的登录方式，请重新登录。');
      return null;
    }
    const handler = provider === 'workbuddy' ? cloud.auth.handleWorkBuddyCallback : cloud.auth.handleWechatWebCallback;
    if (typeof handler !== 'function') {
      P.showLoginError('当前 SDK 不支持此登录方式，请更新后重试。');
      return null;
    }
    const res = await handler.call(cloud.auth);
    if (res.error) { P.showLoginError(res.error.message || '登录失败'); return null; }
    if (res.data) {
      ['code', 'state', 'provider'].forEach((k) => url.searchParams.delete(k));
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      return res.data;
    }
    return P.unwrap(await cloud.auth.getSession(), '恢复登录状态失败');
  };

  P.enterApp = async function (session) {
    P.state.session = session;
    P.state.user = session.user || {};
    P.qs('#login-view').classList.add('hidden');
    P.qs('#app-view').classList.remove('hidden');
    const name = P.state.user.name || P.state.user.phone || P.state.user.email || '成员';
    P.qs('#user-name').textContent = name;
    if (window.PAApp) await window.PAApp.onSession(session);
  };

  function wireLogin() {
    P.qsa('.login-tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        P.qsa('.login-tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        P.qsa('.tab-panel').forEach((p) => p.classList.add('hidden'));
        P.qs('#tab-' + tab.dataset.tab).classList.remove('hidden');
        P.showLoginError('');
      });
    });

    const phoneInput = P.qs('#phone');
    phoneInput.addEventListener('input', () => P.showPhoneError(''));

    P.qs('#send-code').addEventListener('click', async () => {
      const phone = phoneInput.value.trim();
      if (!/^1\d{10}$/.test(phone)) { P.showPhoneError('请输入正确的 11 位手机号'); return; }
      if (sendTimer) return;
      P.showPhoneError('');
      const btn = P.qs('#send-code');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        const sent = await cloud.auth.sendOtp({ phone });
        if (sent.error) throw new Error(sent.error.message || '验证码发送失败');
        pendingOtp = { phone, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
        P.toast('验证码已发送', 'ok');
        let n = 60;
        btn.textContent = n + 's 后重发';
        sendTimer = setInterval(() => {
          n -= 1;
          if (n <= 0) { clearInterval(sendTimer); sendTimer = null; btn.disabled = false; btn.textContent = '重新获取'; }
          else btn.textContent = n + 's 后重发';
        }, 1000);
      } catch (err) {
        btn.disabled = false; btn.textContent = '获取验证码';
        P.showPhoneError(err.message || '验证码发送失败');
      }
    });

    P.qs('#phone-login').addEventListener('click', async () => {
      const phone = phoneInput.value.trim();
      const token = P.qs('#phone-code').value.trim();
      if (!/^1\d{10}$/.test(phone)) { P.showPhoneError('请输入正确的 11 位手机号'); return; }
      if (!pendingOtp || pendingOtp.phone !== phone) { P.showPhoneError('请先获取当前手机号的验证码'); return; }
      if (!token) { P.showPhoneError('请输入验证码'); return; }
      const btn = P.qs('#phone-login');
      btn.disabled = true; btn.textContent = '登录中…';
      try {
        const res = await cloud.auth.verifyOtp({
          phone: pendingOtp.phone, verificationId: pendingOtp.verificationId,
          isExistingUser: pendingOtp.isExistingUser, token
        });
        if (res.error) throw new Error(res.error.message || '验证码错误');
        pendingOtp = null;
        P.showLoginError('');
        await P.enterApp(res.data);
      } catch (err) {
        P.showLoginError(err.message || '登录失败，请重试');
      } finally { btn.disabled = false; btn.textContent = '登录 / 注册'; }
    });

    P.qs('#wechat-login').addEventListener('click', async () => {
      const btn = P.qs('#wechat-login');
      btn.disabled = true; btn.textContent = '跳转中…';
      try {
        const res = await cloud.auth.signInWithOAuth({ provider: 'wechat', redirectTo: location.origin });
        if (res.error) throw new Error(res.error.message || '微信登录未启用');
        location.assign(res.data.url);
      } catch (err) {
        P.showLoginError(err.message || '微信登录失败');
        btn.disabled = false; btn.textContent = '微信授权登录';
      }
    });

    P.qs('#logout').addEventListener('click', async () => {
      await cloud.auth.signOut();
      P.state.session = null; P.state.user = null;
      P.qs('#app-view').classList.add('hidden');
      P.qs('#login-view').classList.remove('hidden');
    });

    P.qs('#copy-uid').addEventListener('click', async () => {
      const uid = P.state.user && P.state.user.id;
      if (!uid) return;
      try { await navigator.clipboard.writeText(uid); P.toast('已复制你的用户 ID，发给空间管理员即可邀请你', 'ok'); }
      catch (e) { P.openModal('你的用户 ID', '<p class="mono">' + P.h(uid) + '</p><p class="tiny-text muted">请复制该 ID 发给空间管理员。</p>'); }
    });
  }

  /* ---------------- data contract helpers ---------------- */
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s_\-—()（）\/\\.]/g, '');

  function P_DICT_FIX() { return window.PA_DICT; }

  P.inferField = function (header) {
    const h = norm(header);
    const fields = P._allFields || [];
    for (const f of fields) {
      if ((f.aliases || []).some((a) => norm(a) === h)) return f.key;
    }
    for (const f of fields) {
      if ((f.aliases || []).some((a) => h && (h.includes(norm(a)) || norm(a).includes(h)))) return f.key;
    }
    return null;
  };

  /* 按主数据字典规范化维度值（编码/别名/大小写 → 标准值） */
  P.normalizeDim = function (key, value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const def = (window.PA_DICT.dimensions || []).find((d) => d.key === key);
    if (!def) return raw;
    if (def.aliasesMap) {
      const direct = def.aliasesMap[raw];
      if (direct) return direct;
      const lower = def.aliasesMap[raw.toLowerCase()];
      if (lower) return lower;
    }
    const n = norm(raw);
    if (def.aliasesMap) {
      for (const k of Object.keys(def.aliasesMap)) {
        if (norm(k) === n) return def.aliasesMap[k];
      }
    }
    const hit = (def.values || []).find((v) => norm(v) === n);
    return hit || raw;
  };

  /* ---------------- 科目编码 ---------------- */
  function subjectDef() { return (window.PA_DICT.dimensions || []).find((d) => d.key === 'subject') || {}; }
  P.subjectNameToCode = function (name) {
    const def = subjectDef();
    const idx = (def.values || []).indexOf(String(name == null ? '' : name).trim());
    return idx >= 0 && def.codes ? def.codes[idx] : null;
  };
  P.subjectCodeToName = function (code) {
    const def = subjectDef();
    const s = String(code == null ? '' : code).trim();
    const idx = def.codes ? def.codes.indexOf(s) : -1;
    return idx >= 0 && def.values ? def.values[idx] : null;
  };
  /* 科目显示名：存储始终是标准汉字，编码仅用于上传录入 */
  P.subjectDisplay = function (value) {
    const s = String(value == null ? '' : value).trim();
    const def = subjectDef();
    /* 编码 → 名称：先查统计 codes，再查全量别名映射（覆盖四级明细编码） */
    const name = P.subjectCodeToName(s) || (def.aliasesMap && (def.aliasesMap[s] || def.aliasesMap[s.toLowerCase()])) || s;
    if (name && name !== s) return String(name);
    /* 旧映射失败时兜底查 201 条管报注册表（新编码如 6602030101 → 平台佣金） */
    const reg = P.reportRegistry();
    if (reg && s && reg.byCode[s]) return reg.byCode[s].name;
    return name == null ? '' : String(name);
  };

  /* ---------------- 管报科目模板（management-v1，201 条） ----------------
   * 注册表由 js/report/subjects.js 挂载到 window.PA_REPORT_SUBJECTS。
   * 模板里 40+ 个名称重名（如「平台佣金」「业务招待费」），必须按编码区分，
   * 任何场景都不允许按名称合并。注册表未加载时所有接口安全降级。
   * ------------------------------------------------------------------ */
  P.reportRegistry = function () {
    return window.PA_REPORT_SUBJECTS || null;
  };

  /* 名称归一化索引（去掉空格/括号/连字符等），仅作精确匹配失败后的兜底 */
  let subjectNameIndex = null;
  let subjectNameIndexFor = null;
  function normalizedSubjectIndex(reg) {
    if (subjectNameIndexFor === reg) return subjectNameIndex;
    const idx = {};
    (reg.list || []).forEach((s) => {
      [s.name].concat(s.alt || []).forEach((n) => {
        const k = norm(n);
        if (!k) return;
        if (!idx[k]) idx[k] = [];
        if (idx[k].indexOf(s) < 0) idx[k].push(s);
      });
    });
    subjectNameIndex = idx;
    subjectNameIndexFor = reg;
    return idx;
  }

  function resolveSubjectByName(name, fromCode) {
    const out = { code: '', name: String(name == null ? '' : name), match: null, error: null, candidates: [] };
    const reg = P.reportRegistry();
    if (!reg) { out.error = 'unknown_name'; return out; }
    let hits = (reg.byName && reg.byName[name]) || [];
    if (!hits.length) hits = normalizedSubjectIndex(reg)[norm(name)] || [];
    if (!hits.length) { out.error = 'unknown_name'; return out; }
    if (hits.length === 1) {
      out.code = hits[0].code;
      out.name = hits[0].name;
      out.match = fromCode ? 'code' : 'name';
      return out;
    }
    out.error = 'ambiguous_name';
    out.candidates = hits.map((s) => s.code);
    return out;
  }

  /* 解析科目录入值：编码（含旧 4 位编码）或中文名称 → 唯一注册表科目 */
  P.resolveSubjectValue = function (raw) {
    const s = String(raw == null ? '' : raw).trim();
    const out = { code: '', name: '', match: null, error: null, candidates: [] };
    if (!s) return out;
    if (/^\d+$/.test(s)) {
      const reg = P.reportRegistry();
      if (reg && reg.byCode[s]) {
        out.code = s;
        out.name = reg.byCode[s].name;
        out.match = 'code';
        return out;
      }
      /* 旧 43 个简化编码（1101/2101…）：先转旧名称，再查新注册表 */
      const oldName = P.subjectCodeToName(s);
      if (oldName) {
        const byOld = resolveSubjectByName(oldName, true);
        if (byOld.match) return byOld;
        byOld.name = oldName;
        return byOld;
      }
      out.error = 'unknown_code';
      return out;
    }
    return resolveSubjectByName(s, false);
  };

  /* 按完整路径精确匹配唯一科目：['销售费用','Tiktok市场营销费用','平台费用','平台佣金'] 或 'a|b|c|d' */
  P.resolveSubjectPath = function (pathArr) {
    const reg = P.reportRegistry();
    if (!reg) return null;
    let parts;
    if (Array.isArray(pathArr)) parts = pathArr;
    else parts = String(pathArr == null ? '' : pathArr).split('|');
    const key = parts.map((p) => String(p == null ? '' : p).trim()).filter(Boolean).join('|');
    if (!key) return null;
    const list = reg.list || [];
    for (let i = 0; i < list.length; i++) {
      if ((list[i].path || []).join('|') === key) return list[i];
    }
    return null;
  };
  /* 从科目树重建 subject 字典（用户导入科目主数据时调用）。
     tree: [{c:编码, n:末级名, p:[路径...], l:一级科目}]
     - values/codes：取一级科目（l1，去重保序）作为统计口径锚点，保持权限区间可判定
     - aliasesMap：全部编码→末级名（真实编码优先）+ 汉字名→自身 + 旧编码兼容 */
  P.buildSubjectDictFromTree = function (tree) {
    if (!Array.isArray(tree) || !tree.length) return null;
    const l1 = [], seen = new Set();
    tree.forEach((o) => {
      const name = String(o.l || (o.p && o.p[0]) || o.n || '').trim();
      if (name && !seen.has(name)) { seen.add(name); l1.push(name); }
    });
    const values = l1.length ? l1 : tree.map((o) => String(o.n));
    const amap = {};
    const realCodes = new Set();
    tree.forEach((o) => {
      const code = String(o.c == null ? '' : o.c).trim();
      const name = String(o.n == null ? '' : o.n).trim();
      if (code) { realCodes.add(code); amap[code] = name; }
      if (name) amap[name] = name;
      (o.p || []).forEach((seg) => { const s = String(seg).trim(); if (s) amap[s] = s; });
    });
    /* 旧预设编码兼容：仅在不与真实编码冲突时加入（用默认 codes↔values 对应关系） */
    const defaultSub = (P.defaultDict().dimensions || []).find((d) => d.key === 'subject') || {};
    const defValues = defaultSub.values || [];
    const defCodes = defaultSub.codes || [];
    defCodes.forEach((c, i) => { if (c && !realCodes.has(c) && defValues[i] && !amap[c]) amap[c] = defValues[i]; });
    return { values: values, codes: values.map((v) => {
      /* 一级科目对应的真实编码：取树中 l==v 且层级最短的编码 */
      const hits = tree.filter((o) => String(o.l || (o.p && o.p[0]) || '') === v);
      hits.sort((a, b) => (a.p || []).length - (b.p || []).length);
      return hits.length ? String(hits[0].c) : '';
    }), aliasesMap: amap, tree: tree };
  };

  /* ---------------- 数据视图权限（科目级可见范围） ---------------- */
  P.dataViews = function () { return window.PA_DATA_VIEWS || {}; };
  P.currentViewKey = function () {
    return P.state.dataView || (window.PA_ROLE_VIEW && window.PA_ROLE_VIEW[P.state.role]) || 'management';
  };
  P.currentView = function () {
    const views = P.dataViews();
    return views[P.currentViewKey()] || views.management || { key: 'management', subjectMode: 'all', label: '管理' };
  };
  P.setCurrentView = function (key) {
    const views = P.dataViews();
    if (!views[key]) return false;
    P.state.dataView = key;
    try { sessionStorage.setItem('pa_data_view', key); } catch (e) {}
    return true;
  };
  /* 当前视图可见的科目标准名数组；null 表示全部可见
   * 两种授权口径：
   * - range：按科目名称区间截取（依赖 PA_DICT 的值顺序，模板换版后顺序会变，慎用）
   * - list ：显式名称白名单（模板换版也不会因为顺序变化而放宽范围，推荐） */
  P.visibleSubjects = function () {
    const v = P.currentView();
    if (!v || v.subjectMode === 'all') return null;
    if (v.subjectMode === 'list') {
      const allow = Array.isArray(v.subjectList) ? v.subjectList : [];
      if (!allow.length) return [];
      const values = subjectDef().values || [];
      /* 只保留确实存在于当前模板的名称，避免白名单里残留已删除科目 */
      return allow.filter(function (n) { return values.indexOf(n) >= 0; });
    }
    if (!v.subjectRange) return null;
    const values = subjectDef().values || [];
    const [a, b] = v.subjectRange;
    const i = values.indexOf(a), j = values.indexOf(b);
    if (i < 0 || j < 0) return values.slice();
    return values.slice(Math.min(i, j), Math.max(i, j) + 1);
  };
  P.canSeeSubject = function (subject) {
    const allowed = P.visibleSubjects();
    if (!allowed) return true;
    const name = P.subjectDisplay(subject);
    return allowed.indexOf(name) >= 0;
  };
  /* 按当前视图过滤明细行：敏感科目行直接剔除，使问数/看板/预览一致受控 */
  P.applyDataView = function (rows) {
    const allowed = P.visibleSubjects();
    if (!allowed) return rows || [];
    return (rows || []).filter((r) => !r || !r.subject || r.subject === '未分类' || allowed.indexOf(P.subjectDisplay(r.subject)) >= 0);
  };
  /* 当前视图是否处于受限模式 */
  P.isRestrictedView = function () { return !!P.visibleSubjects(); };

  /* 当前视图可见的科目编码数组（注册表编码）；全部可见返回 null
   * 判定规则：只看科目名称是否命中旧白名单。**不按一级科目名向下放开**——
   * 「销售费用」可见不代表其下 100+ 个明细科目可见，否则等于放宽数据权限。
   * 注册表未加载时返回 null，由调用方回退到旧名称口径（P.canSeeSubject）。
   * 原则：只做「收窄」，拿不准一律判不可见。 */
  P.visibleSubjectCodes = function () {
    const allowed = P.visibleSubjects();
    if (!allowed) return null;
    const reg = P.reportRegistry();
    if (!reg) return null;
    const set = {};
    allowed.forEach((n) => { set[n] = true; });
    return (reg.list || []).filter((s) => set[s.name]).map((s) => s.code);
  };

  /* 单条科目编码是否可见：支持新 6~10 位编码，也兼容旧 4 位编码 */
  P.canSeeSubjectCode = function (code) {
    const c = String(code == null ? '' : code).trim();
    if (!c) return false;
    const allowed = P.visibleSubjects();
    if (!allowed) return true;
    const reg = P.reportRegistry();
    if (!reg) return P.canSeeSubject(c); /* 注册表未加载：沿用旧名称比对，行为与改造前一致 */
    let subject = reg.byCode[c];
    if (!subject) {
      /* 旧编码或别名：先解析再判定；解析不出则认为不可见（保守） */
      const res = P.resolveSubjectValue(c);
      subject = res.match && reg.byCode[res.code] ? reg.byCode[res.code] : null;
    }
    if (!subject) return false;
    return allowed.indexOf(subject.name) >= 0;
  };

  /* ---------------- 主数据在线维护 ---------------- */
  P.defaultDict = function () {
    if (!P._defaultDict) P._defaultDict = JSON.parse(JSON.stringify(window.PA_DICT));
    return P._defaultDict;
  };
  /* 首次加载即缓存默认科目树，确保恢复默认不受自定义导入影响 */
  if (P._defaultSubjectTree == null) P._defaultSubjectTree = JSON.parse(JSON.stringify(window.PA_SUBJECT_TREE || []));
  /* 用云端配置覆盖字典：只覆盖 dimensions 的 values/codes/aliasesMap 与 derived/labels/meta */
  P.applyMasterdata = function (cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    const d = JSON.parse(JSON.stringify(P.defaultDict()));
    if (Array.isArray(cfg.dimensions)) {
      cfg.dimensions.forEach((cd) => {
        const target = d.dimensions.find((x) => x.key === cd.key);
        if (!target) return;
        if (Array.isArray(cd.values)) target.values = cd.values;
        if (Array.isArray(cd.codes)) target.codes = cd.codes;
        if (cd.aliasesMap && typeof cd.aliasesMap === 'object') target.aliasesMap = cd.aliasesMap;
      });
    }
    if (cfg.derived && typeof cfg.derived === 'object') d.derived = cfg.derived;
    if (Array.isArray(cfg.subjectTree)) window.PA_SUBJECT_TREE = cfg.subjectTree;
    window.PA_DICT = d;
    P.state.masterdata = cfg;
    rebuildFields();
    return true;
  };
  P.restoreDefaultDict = function () {
    window.PA_DICT = JSON.parse(JSON.stringify(P.defaultDict()));
    if (P._defaultSubjectTree == null) P._defaultSubjectTree = JSON.parse(JSON.stringify(window.PA_SUBJECT_TREE || []));
    window.PA_SUBJECT_TREE = JSON.parse(JSON.stringify(P._defaultSubjectTree));
    P.state.masterdata = null;
    rebuildFields();
  };
  P.loadMasterdata = async function (workspaceId) {
    try {
      const rows = await P.dbList(P.TABLES.masterdata, { eq: { workspace_id: workspaceId }, limit: 1 });
      if (rows && rows.length && rows[0].dict_json) { P.applyMasterdata(rows[0].dict_json); return rows[0]; }
    } catch (e) {}
    return null;
  };

  P.parseNumber = function (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/[¥￥,，\s]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    let mult = 1;
    if (/万$/.test(s)) { mult = 1e4; s = s.slice(0, -1); }
    else if (/亿$/.test(s)) { mult = 1e8; s = s.slice(0, -1); }
    const pct = /%$/.test(s);
    if (pct) s = s.slice(0, -1);
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    let out = n * mult * (neg ? -1 : 1);
    return pct ? out / 100 : out;
  };

  P.parsePeriod = function (v) {
    if (v == null || v === '') return '未指定期间';
    if (v instanceof Date) return v.toISOString().slice(0, 7);
    let s = String(v).trim();
    let m = s.match(/^(\d{4})[年\/-](\d{1,2})/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
    m = s.match(/^(\d{4})\s*Q([1-4])/i);
    if (m) return m[1] + '-Q' + m[2];
    return s;
  };

  const numKeys = ['amount', 'revenue', 'cost', 'budget', 'budget_cost'];
  const dimKeys = ['month', 'data_type', 'site', 'platform', 'channel', 'material', 'brand', 'category', 'report_product', 'subject', 'period', 'region', 'product'];

  function rebuildFields() {
    const dict = window.PA_DICT || {};
    P._allFields = [...(dict.dimensions || []), ...(dict.metrics || [])];
    /* subject_code 只作为科目编码载体，不进入 DIM_KEYS，避免筛选栏出现无意义维度 */
    P.ALL_KEYS = [...dimKeys, ...numKeys, 'subject_code'];
    P.DIM_KEYS = dimKeys;
    P.NUM_KEYS = numKeys;
    P.TEMPLATE_KEYS = ['month', 'data_type', 'site', 'platform', 'channel', 'material', 'brand', 'category', 'report_product', 'subject', 'amount'];
  }
  rebuildFields();

  function blankRow() {
    const row = {};
    dimKeys.forEach((k) => { row[k] = '未分类'; });
    numKeys.forEach((k) => { row[k] = 0; });
    row.month = '未指定月份';
    row.data_type = '实际数';
    row.subject_code = '';
    return row;
  }

  /* 依据「科目 + 数据类型」把金额归集到收入/成本/预算，兼容旧指标口径 */
  function deriveLegacyMeasures(row, found) {
    const amount = P.parseNumber(row.amount);
    if (!found.has('amount') || !amount) return;
    const subj = String(row.subject || '');
    const role = (window.PA_DICT.dataTypeRole || {})[row.data_type] || 'actual';
    const dic = window.PA_DICT.subjectRole || {};
    const isRevenue = (dic.revenue || []).some((s) => subj.indexOf(s) >= 0);
    const isCost = (dic.cost || []).some((s) => subj.indexOf(s) >= 0);
    if (role === 'actual' && isRevenue && !found.has('revenue')) row.revenue += amount;
    if (role === 'actual' && isCost && !found.has('cost')) row.cost += amount;
    if (role === 'budget' && isRevenue && !found.has('budget')) row.budget += amount;
    if (role === 'budget' && isCost && !found.has('budget_cost')) row.budget_cost += amount;
  }

  /* 科目单元格清洗：编码/旧编码/名称 → row.subject（标准名称）+ row.subject_code（注册表编码）
   * bucket 收集歧义/未知/旧编码未映射三类情况，循环结束后统一生成中文提示。 */
  function cleanSubjectCell(row, val, bucket) {
    const s = val == null ? '' : String(val).trim();
    if (!s) { row.subject = '未分类'; row.subject_code = ''; return; }
    /* 注册表未加载：完全沿用改造前的旧口径，不产生新提示，避免误报 */
    if (!P.reportRegistry()) { row.subject = P.normalizeDim('subject', s) || s; row.subject_code = ''; return; }
    const res = P.resolveSubjectValue(s);
    if (res.match) {
      row.subject = res.name;
      row.subject_code = res.code;
      /* 编码在旧 43 条与新模板中含义不同（4101/4102/4103）：按新模板解释，但必须提示核对 */
      const oldName = /^\d+$/.test(s) ? P.subjectCodeToName(s) : null;
      if (oldName && oldName !== res.name) bucket.clash[s] = { newName: res.name, oldName: oldName };
      return;
    }
    /* 解析失败：保留原值（旧编码转旧名称），绝不任选一个候选，也绝不静默丢弃 */
    const legacyName = P.subjectCodeToName(s);
    const fallback = legacyName || P.normalizeDim('subject', s) || s;
    row.subject = fallback;
    row.subject_code = '';
    if (res.error === 'ambiguous_name') {
      bucket.ambiguous[s] = { name: fallback, count: (res.candidates || []).length };
    } else if (legacyName) {
      bucket.legacy[s] = legacyName;
    } else {
      bucket.unknown[s] = s;
    }
  }

  /* ---------------- 宽表（科目横排）识别与展开 ----------------
   * 长表：科目占一列、每个科目一行（维度 × 科目 交叉，行数膨胀）。
   * 宽表：科目编码作列头、每个维度组合一行（行数不含科目维度，显著变小）。
   * 上传时自动识别宽表并「逆透视」展开为内部长表，M2/M3/M4 完全无感知。 */
  const WIDE_NUM_KEYS = ['amount', 'revenue', 'cost', 'budget', 'budget_cost'];

  /* 列头能否对应到一个科目（编码优先，科目标准名兼容）；返回科目标准名或 null */
  P.subjectHeaderName = function (header) {
    const s = String(header == null ? '' : header).trim();
    if (!s) return null;
    const def = subjectDef();
    const codeToName = (code) => {
      if (!code) return null;
      if (def.aliasesMap) { const v = def.aliasesMap[code] || def.aliasesMap[code.toLowerCase()]; if (v) return v; }
      const idx = (def.codes || []).indexOf(code);
      return idx >= 0 ? (def.values || [])[idx] : null;
    };
    /* 1) 纯编码（如 6001）或 编码+名称（如 6001(销售收入)）：以编码为准 */
    let name = codeToName(s);
    if (!name) {
      const m = s.match(/^(\d{4,10})\s*[（(\s]/);
      if (m) name = codeToName(m[1]);
    }
    if (name) return name;
    /* 2) 纯科目名：科目主数据里存在的标准名才当作科目列。
          长表一定有明确的「科目/科目编码」列（detectWide 已提前排除），故此处不会误判。 */
    const known = P.inferField(header);
    if (known === 'subject') return null;
    if ((def.values || []).some((v) => String(v).trim() === s)) return s;
    return null;
  };

  /* 检测宽表：存在科目列头，且不存在明确的「科目」字段列 */
  P.detectWide = function (rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length < 2) return null;
    const headers = rawRows[0].map((h, i) => String(h == null ? '' : h).trim() || ('未命名列' + (i + 1)));
    if (headers.some((h) => P.inferField(h) === 'subject')) return null;
    const subjectCols = [];
    headers.forEach((h, i) => {
      const name = P.subjectHeaderName(h);
      if (name) subjectCols.push({ index: i, header: h, subject: name });
    });
    if (!subjectCols.length) return null;
    return { headers: headers, subjectCols: subjectCols };
  };

  /* 宽表 → 内部长表二维数组：保留维度列，追加「科目」「金额」两列 */
  P.expandWideRows = function (rawRows, wide) {
    const headers = wide.headers, subjectCols = wide.subjectCols;
    const colSet = new Set(subjectCols.map((c) => c.index));
    const isNumCol = (h) => { const k = P.inferField(h); return k && WIDE_NUM_KEYS.includes(k); };
    const keepIdx = headers.map((h, i) => i).filter((i) => !colSet.has(i) && !isNumCol(headers[i]));
    const out = [keepIdx.map((i) => headers[i]).concat(['科目', '金额'])];
    const expanded = [];
    for (let r = 1; r < rawRows.length; r++) {
      const raw = rawRows[r];
      if (!raw || raw.every((v) => v == null || String(v).trim() === '')) continue;
      subjectCols.forEach((c) => {
        const val = raw[c.index];
        if (val == null || String(val).trim() === '') return;
        if (!P.parseNumber(val)) return; /* 空值与 0 不生成行，控制行数膨胀 */
        expanded.push(keepIdx.map((i) => raw[i]).concat([c.subject, val]));
      });
    }
    return { rows: out.concat(expanded), count: expanded.length, subjects: subjectCols.map((c) => c.subject) };
  };

  P.cleanRows = function (rawRows, override) {
    const issues = [];
    if (!Array.isArray(rawRows) || rawRows.length < 2) return { rows: [], mapping: {}, issues: ['文件至少需要表头和一行数据'] };
    const headers = rawRows[0].map((h, i) => String(h == null ? '' : h).trim() || ('未命名列' + (i + 1)));
    let mapping = {};
    const used = new Set();
    headers.forEach((h) => {
      const key = P.inferField(h);
      if (key && !used.has(key)) { mapping[h] = key; used.add(key); }
      else if (key && used.has(key)) issues.push('列「' + h + '」与已有字段重复，已忽略');
    });
    if (override) {
      mapping = {};
      Object.entries(override).forEach(([key, header]) => { if (header && headers.includes(header)) mapping[header] = key; });
    }
    const found = new Set(Object.values(mapping));
    if (![...numKeys].some((k) => found.has(k))) issues.push('未识别到任何金额字段（金额/收入/成本/预算）');

    const hasHeader = (key) => headers.some((h) => mapping[h] === key);
    const legacyPlan = hasHeader('amount') && !hasHeader('revenue') && !hasHeader('cost');
    if (legacyPlan) issues.push('已按管报口径导入：使用「金额 + 科目 + 数据类型」，收入/成本/预算将自动归集');
    if (!hasHeader('month') && !hasHeader('period')) issues.push('未识别到月份列');
    if (!hasHeader('data_type')) issues.push('未识别到数据类型列，默认按「实际数」处理');
    if (!hasHeader('subject')) issues.push('未识别到科目列，无法进行科目维度分析');
    const unmapped = headers.filter((h) => !mapping[h]);
    if (unmapped.length) issues.push('未映射列：' + unmapped.join('、'));

    const rows = [];
    const seen = new Set();
    const subjectIssues = { ambiguous: {}, unknown: {}, legacy: {}, clash: {} };
    let bad = 0;
    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw || raw.every((v) => v == null || String(v).trim() === '')) continue;
      const row = blankRow();
      headers.forEach((h, idx) => {
        const key = mapping[h];
        if (!key) return;
        const val = raw[idx];
        if (numKeys.includes(key)) {
          const n = P.parseNumber(val);
          if (val !== '' && val != null && !isFinite(Number(String(val).replace(/[,¥￥\s]/g, '')))) bad += 1;
          row[key] = n;
        } else if (key === 'month' || key === 'period') {
          row[key] = P.parsePeriod(val);
        } else if (key === 'subject') {
          cleanSubjectCell(row, val, subjectIssues);
        } else {
          const s = val == null || String(val).trim() === '' ? '' : String(val).trim();
          row[key] = s ? P.normalizeDim(key, s) : (key === 'data_type' ? '实际数' : '未分类');
        }
      });
      /* 期间向后兼容：month 与 period 同步，保证旧看板「按期间趋势」可用 */
      if (row.month && row.month !== '未指定月份') row.period = row.month;
      deriveLegacyMeasures(row, found);
      const sig = P.ALL_KEYS.map((k) => row[k]).join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      rows.push(row);
    }
    if (bad) issues.push(bad + ' 个金额单元格无法解析，已按 0 处理');
    const ambKeys = Object.keys(subjectIssues.ambiguous);
    if (ambKeys.length) {
      const sample = ambKeys.slice(0, 3).map((k) => {
        const it = subjectIssues.ambiguous[k];
        return '「' + it.name + '」(' + it.count + ' 个同名编码)';
      }).join('、');
      issues.push('科目同名多编码，已保留名称但未写入编码：' + sample +
        (ambKeys.length > 3 ? ' 等 ' + ambKeys.length + ' 种' : '') + '；请在「科目编码」列填写编码以便区分');
    }
    const unkKeys = Object.keys(subjectIssues.unknown);
    if (unkKeys.length) {
      issues.push(unkKeys.length + ' 个科目无法匹配科目编码表，已按原值保留：' +
        unkKeys.slice(0, 5).join('、') + (unkKeys.length > 5 ? ' 等' : ''));
    }
    const legacyKeys = Object.keys(subjectIssues.legacy);
    if (legacyKeys.length) {
      issues.push('旧版科目编码（' + legacyKeys.slice(0, 5).join('、') + (legacyKeys.length > 5 ? ' 等' : '') +
        '）已按原名称保留，新模板中无同名科目');
    }
    const clashKeys = Object.keys(subjectIssues.clash);
    if (clashKeys.length) {
      issues.push('以下编码新旧模板含义不同，已按新模板（201 条）解释，请核对数据口径：' +
        clashKeys.slice(0, 5).map((k) => {
          const it = subjectIssues.clash[k];
          return k + '（新：' + it.newName + ' / 旧：' + it.oldName + '）';
        }).join('、'));
    }
    return { rows, mapping, issues, columns: P.ALL_KEYS.filter((k) => found.has(k) || k === 'month') };
  };

  P.metricValue = function (row, key) {
    const r = row || {};
    switch (key) {
      case 'actual_profit': return P.parseNumber(r.revenue) - P.parseNumber(r.cost);
      case 'budget_profit': return P.parseNumber(r.budget) - P.parseNumber(r.budget_cost);
      case 'profit_variance': return P.metricValue(r, 'actual_profit') - P.metricValue(r, 'budget_profit');
      case 'revenue_variance': return P.parseNumber(r.revenue) - P.parseNumber(r.budget);
      case 'margin': { const rev = P.parseNumber(r.revenue); return rev ? P.metricValue(r, 'actual_profit') / rev : 0; }
      default: return P.parseNumber(r[key]);
    }
  };

  P.summary = function (rows) {
    const s = { amount: 0, revenue: 0, cost: 0, budget: 0, budget_cost: 0 };
    (rows || []).forEach((r) => numKeys.forEach((k) => { s[k] += P.parseNumber(r[k]); }));
    s.actual_profit = s.revenue - s.cost;
    s.budget_profit = s.budget - s.budget_cost;
    s.profit_variance = s.actual_profit - s.budget_profit;
    s.revenue_variance = s.revenue - s.budget;
    s.margin = s.revenue ? s.actual_profit / s.revenue : 0;
    s.budget_margin = s.budget ? s.budget_profit / s.budget : 0;
    s.variance_rate = s.budget_profit ? s.profit_variance / Math.abs(s.budget_profit) : 0;
    return s;
  };

  P.matchFilter = function (row, filter) {
    const field = filter.field;
    const actual = P.DIM_KEYS.includes(field) ? String(row[field] == null ? '' : row[field]) : P.metricValue(row, field);
    const expect = filter.value;
    switch (filter.op) {
      case '=': case '==': return String(actual) === String(expect);
      case '!=': return String(actual) !== String(expect);
      case '>': return Number(actual) > Number(expect);
      case '>=': return Number(actual) >= Number(expect);
      case '<': return Number(actual) < Number(expect);
      case '<=': return Number(actual) <= Number(expect);
      case 'contains': return String(actual).toLowerCase().includes(String(expect).toLowerCase());
      default: return true;
    }
  };

  P.aggregate = function (rows, opts) {
    opts = opts || {};
    const dims = (opts.dimensions || []).filter((d) => P.DIM_KEYS.includes(d) || P.ALL_KEYS.includes(d));
    const measure = opts.measure || 'actual_profit';
    const agg = opts.agg || 'sum';
    let list = (rows || []).filter((r) => (opts.filters || []).every((f) => P.matchFilter(r, f)));
    const groups = new Map();
    list.forEach((r) => {
      const key = dims.length ? dims.map((d) => String(r[d] == null ? '' : r[d])).join('||') : '__all__';
      if (!groups.has(key)) groups.set(key, { dims: dims.map((d) => String(r[d] == null ? '' : r[d])), values: [], count: 0 });
      const g = groups.get(key);
      g.values.push(P.metricValue(r, measure));
      g.count += 1;
    });
    let out = Array.from(groups.values()).map((g) => {
      const o = {};
      dims.forEach((d, i) => { o[d] = g.dims[i]; });
      const vals = g.values;
      let v;
      if (agg === 'count') v = g.count;
      else if (agg === 'avg') v = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      else if (agg === 'max') v = Math.max.apply(null, vals.concat([0]));
      else if (agg === 'min') v = Math.min.apply(null, vals.concat([0]));
      else v = vals.reduce((a, b) => a + b, 0);
      o.value = v;
      o.count = g.count;
      return o;
    });
    if (opts.orderBy && opts.orderBy.field) {
      const f = opts.orderBy.field;
      const dir = opts.orderBy.direction === 'asc' ? 1 : -1;
      out.sort((a, b) => {
        const av = f === 'value' ? a.value : a[f];
        const bv = f === 'value' ? b.value : b[f];
        const an = Number(av), bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') return (an - bn) * dir;
        return String(av).localeCompare(String(bv), 'zh-CN') * dir;
      });
    } else out.sort((a, b) => b.value - a.value);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  };

  P.dimensionValues = function (rows, key) {
    return Array.from(new Set((rows || []).map((r) => String(r[key] || '未分类')))).filter(Boolean).sort();
  };

  P.detectPeriodChange = function (rows) {
    const periods = P.dimensionValues(rows, 'period').filter((p) => p !== '未分类').sort();
    if (periods.length < 2) return null;
    const a = periods[periods.length - 2], b = periods[periods.length - 1];
    const sa = P.summary((rows || []).filter((r) => r.period === a));
    const sb = P.summary((rows || []).filter((r) => r.period === b));
    const rate = (v, base) => base ? (v - base) / Math.abs(base) : 0;
    return {
      from: a, to: b,
      revenueRate: rate(sb.revenue, sa.revenue),
      profitRate: rate(sb.actual_profit, sa.actual_profit),
      marginDelta: sb.margin - sa.margin,
      current: sb, previous: sa
    };
  };

  P.measureLabel = function (key) {
    const m = window.PA_MEASURES.find((x) => x.key === key);
    return m ? m.label : key;
  };
  P.measureUnit = function (key) {
    const m = window.PA_MEASURES.find((x) => x.key === key);
    return m ? m.unit : 'money';
  };
  P.formatMeasure = function (key, v) {
    return P.measureUnit(key) === 'percent' ? P.fmtPercent(v) : P.fmtMoney(v);
  };

  /* ---------------- LLM ---------------- */
  P.pickModel = async function () {
    if (P.state.models.length) return P.state.models.find((m) => !m.disabled) || null;
    try {
      const models = await cloud.llm.models.list();
      P.state.models = Array.isArray(models) ? models : [];
    } catch (e) { P.state.models = []; }
    return P.state.models.find((m) => !m.disabled) || null;
  };

  P.llmText = async function (system, user, options) {
    options = options || {};
    const model = await P.pickModel();
    if (!model) throw new Error('当前应用暂未配置可用模型');
    const messages = [{ role: 'system', content: system }];
    if (options.history) messages.push(...options.history.slice(-4));
    messages.push({ role: 'user', content: user });
    let text = '';
    const params = {
      model: model.id, messages, stream: true,
      temperature: options.temperature == null ? 0.2 : options.temperature
    };
    if (options.json) params.response_format = { type: 'json_object' };
    if (options.signal) params.signal = options.signal;
    for await (const chunk of cloud.llm.chat.completions.create(params)) {
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) text += delta.content;
    }
    return text;
  };

  P.stripJson = function (text) {
    let s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return s;
  };

  wireLogin();
})();
