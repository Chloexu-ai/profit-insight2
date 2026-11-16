(function () {
  const P = (window.PA = window.PA || {});

  P.state = {
    session: null, user: null, workspaces: [], workspace: null,
    members: [], role: 'viewer', datasets: [], models: [], activeModule: 'm1'
  };

  P.TABLES = {
    workspaces: 'pa_workspaces', members: 'pa_members', datasets: 'pa_datasets',
    queries: 'pa_queries', dashboards: 'pa_dashboards',
    pushRules: 'pa_push_rules', pushLogs: 'pa_push_logs'
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
  const allFields = [
    ...P_DICT_FIX().dimensions, ...P_DICT_FIX().metrics
  ];

  function P_DICT_FIX() { return window.PA_DICT; }

  P.inferField = function (header) {
    const h = norm(header);
    for (const f of allFields) {
      if (f.aliases.some((a) => norm(a) === h)) return f.key;
    }
    for (const f of allFields) {
      if (f.aliases.some((a) => h && (h.includes(norm(a)) || norm(a).includes(h)))) return f.key;
    }
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

  const numKeys = allFields.filter((f) => ['revenue', 'cost', 'budget', 'budget_cost'].includes(f.key)).map((f) => f.key);
  const dimKeys = allFields.filter((f) => ['period', 'region', 'product', 'channel'].includes(f.key)).map((f) => f.key);
  const ALL_KEYS = [...dimKeys, ...numKeys];
  P.ALL_KEYS = ALL_KEYS;
  P.DIM_KEYS = dimKeys;
  P.NUM_KEYS = numKeys;

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
    if (![...numKeys].some((k) => found.has(k))) issues.push('未识别到任何金额字段（收入/成本/预算）');
    const unmapped = headers.filter((h) => !mapping[h]);
    if (unmapped.length) issues.push('未映射列：' + unmapped.join('、'));

    const rows = [];
    const seen = new Set();
    let bad = 0;
    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw || raw.every((v) => v == null || String(v).trim() === '')) continue;
      const row = { period: '未指定期间', region: '未分类', product: '未分类', channel: '未分类', revenue: 0, cost: 0, budget: 0, budget_cost: 0 };
      headers.forEach((h, idx) => {
        const key = mapping[h];
        if (!key) return;
        const val = raw[idx];
        if (numKeys.includes(key)) {
          const n = P.parseNumber(val);
          if (val !== '' && val != null && !isFinite(Number(String(val).replace(/[,¥￥\s]/g, '')))) bad += 1;
          row[key] = n;
        } else if (key === 'period') row[key] = P.parsePeriod(val);
        else row[key] = val == null || String(val).trim() === '' ? '未分类' : String(val).trim();
      });
      const sig = ALL_KEYS.map((k) => row[k]).join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      rows.push(row);
    }
    if (bad) issues.push(bad + ' 个金额单元格无法解析，已按 0 处理');
    return { rows, mapping, issues, columns: ALL_KEYS.filter((k) => found.has(k) || k === 'period') };
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
    const s = { revenue: 0, cost: 0, budget: 0, budget_cost: 0 };
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
