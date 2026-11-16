(function () {
  const P = window.PA;
  const M = (window.PAM4 = {
    id: 'm4',
    title: 'M4 · 信息推送',
    desc: '按数据变化与节奏配置推送规则，定时检查并生成可追溯的推送记录。',
    init() {},
    mount(root) { render(root); },
    refresh() { if (currentRoot) render(currentRoot); },
    destroy() { if (timer) clearInterval(timer); currentRoot = null; }
  });

  let currentRoot = null;
  let rules = [];
  let logs = [];
  let timer = null;
  let checking = false;

  const OPS = [
    { key: '<', label: '低于阈值' }, { key: '>', label: '高于阈值' },
    { key: 'drop_pct', label: '环比下降超过 (%)' }, { key: 'rise_pct', label: '环比上升超过 (%)' },
    { key: 'variance_negative', label: '利润差异为负' }
  ];
  const CHANNELS = [{ key: 'inapp', label: '站内消息' }, { key: 'email', label: '邮件（待接入通道）' }, { key: 'wecom', label: '企业微信（待接入通道）' }];

  function header() {
    return '<div class="card"><div class="card-title"><h3>推送规则</h3>' +
      '<button class="btn primary tiny" id="rule-new">+ 新建规则</button></div>' +
      '<div id="rule-list">' + (rules.length ? rules.map(ruleHtml).join('') : '<div class="empty">暂无规则。可新建「利润率低于 40%」「收入环比下降超 5%」等条件。</div>') + '</div></div>';
  }
  function ruleHtml(r) {
    const c = r.conditions_json || {};
    const op = OPS.find((o) => o.key === c.op);
    return '<div class="rule-card"><button class="switch ' + (r.enabled ? 'on' : '') + '" data-toggle="' + r.id + '"></button>' +
      '<div class="rule-main"><b>' + P.h(r.name) + '</b><small>' +
      P.h(P.measureLabel(c.metric || r.metric)) + ' · ' + P.h(op ? op.label : c.op || '—') +
      (c.threshold != null ? ' ' + (String(c.op).includes('pct') ? c.threshold + '%' : P.formatMeasure(c.metric || r.metric, c.threshold)) : '') +
      (c.dimension && c.dimension !== 'all' ? ' · 按' + P.h(dimLabel(c.dimension)) : '') + '</small></div>' +
      '<span class="badge blue">' + P.h(scheduleLabel(r.schedule)) + '</span>' +
      '<span class="badge">' + P.h((CHANNELS.find((x) => x.key === r.channel) || {}).label || r.channel) + '</span>' +
      '<span class="tiny-text muted">' + (r.next_run_at ? '下次 ' + new Date(r.next_run_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '随时') + '</span>' +
      '<button class="btn tiny" data-edit="' + r.id + '">编辑</button><button class="btn tiny danger" data-del="' + r.id + '">删除</button></div>';
  }
  function feedHtml() {
    return '<div class="card"><div class="card-title"><h3>推送记录</h3><div class="row">' +
      '<span class="sub">' + logs.length + ' 条</span><button class="btn tiny" id="check-now">立即检查全部规则</button></div></div>' +
      '<div id="push-status" class="tiny-text muted" style="margin-bottom:10px">站内消息实时写入下方；邮件 / 企微通道需在服务端接入后生效。页面打开时每分钟自动检查一次到期规则。</div>' +
      (logs.length ? logs.slice(0, 30).map((l) => '<div class="feed-item"><b>' + P.h(l.title) + '</b><p>' + P.h(l.content) + '</p>' +
        '<time>' + new Date(l.created_at).toLocaleString('zh-CN') + ' · ' + P.h(l.channel) + ' · ' + P.h(l.status) + '</time></div>').join('') :
        '<div class="empty">暂无推送。数据触发条件后会自动生成记录。</div>') + '</div>';
  }

  function render(root) {
    currentRoot = root;
    root.innerHTML = header() + '<div style="margin-top:16px">' + feedHtml() + '</div>';
    wire(root);
    startTimer();
  }

  async function load() {
    const ws = P.state.workspace.id;
    rules = await P.dbList(P.TABLES.pushRules, { eq: { workspace_id: ws }, order: 'created_at', ascending: false });
    logs = await P.dbList(P.TABLES.pushLogs, { eq: { workspace_id: ws }, order: 'created_at', ascending: false, limit: 60 });
  }
  M.load = load;

  function wire(root) {
    P.qs('#rule-new', root).onclick = () => openRule();
    P.qs('#check-now', root).onclick = () => runChecks(true);
    P.qsa('[data-toggle]', root).forEach((b) => b.onclick = async () => {
      const r = rules.find((x) => x.id === Number(b.dataset.toggle));
      if (!r) return;
      try { await P.dbUpdate(P.TABLES.pushRules, r.id, { enabled: !r.enabled }); await load(); render(currentRoot); }
      catch (e) { P.toast(e.message, 'error'); }
    });
    P.qsa('[data-edit]', root).forEach((b) => b.onclick = () => openRule(rules.find((x) => x.id === Number(b.dataset.edit))));
    P.qsa('[data-del]', root).forEach((b) => b.onclick = async () => {
      if (!(await P.confirm('删除后历史推送记录仍会保留，确认删除规则？', '删除推送规则'))) return;
      try { await P.dbDelete(P.TABLES.pushRules, Number(b.dataset.del)); await load(); render(currentRoot); P.toast('规则已删除', 'ok'); }
      catch (e) { P.toast(e.message, 'error'); }
    });
  }

  function openRule(rule) {
    const c = rule ? (rule.conditions_json || {}) : {};
    const metricOpts = window.PA_MEASURES.map((m) => '<option value="' + m.key + '"' + ((c.metric || 'margin') === m.key ? ' selected' : '') + '>' + m.label + '</option>').join('');
    const dimOpts = ['<option value="all">整体（不分组）</option>'].concat(P.DIM_KEYS.map((d) =>
      '<option value="' + d + '"' + (c.dimension === d ? ' selected' : '') + '>' + dimLabel(d) + '</option>')).join('');
    const m = P.openModal(rule ? '编辑推送规则' : '新建推送规则',
      '<div class="form-grid"><div class="full"><label class="field-label">规则名称</label><input class="field" id="r-name" value="' + P.h(rule ? rule.name : '') + '" placeholder="例如：利润率预警" /></div>' +
      '<div><label class="field-label">监控指标</label><select class="form-select" id="r-metric">' + metricOpts + '</select></div>' +
      '<div><label class="field-label">触发条件</label><select class="form-select" id="r-op">' + OPS.map((o) =>
        '<option value="' + o.key + '"' + (c.op === o.key ? ' selected' : '') + '>' + o.label + '</option>').join('') + '</select></div>' +
      '<div><label class="field-label">阈值（百分比条件填数字，如 5）</label><input class="field" id="r-threshold" type="number" step="0.01" value="' + (c.threshold != null ? c.threshold : 40) + '" /></div>' +
      '<div><label class="field-label">分组维度</label><select class="form-select" id="r-dim">' + dimOpts + '</select></div>' +
      '<div><label class="field-label">推送频率</label><select class="form-select" id="r-schedule">' + [['daily', '每日'], ['weekly', '每周一'], ['monthly', '每月 1 日']].map(([k, l]) =>
        '<option value="' + k + '"' + ((rule && rule.schedule) === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
      '<div><label class="field-label">推送通道</label><select class="form-select" id="r-channel">' + CHANNELS.map((x) =>
        '<option value="' + x.key + '"' + ((rule && rule.channel) === x.key ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select></div>' +
      '<div class="full"><label class="field-label">接收目标（邮箱 / 群 ID，可留空）</label><input class="field" id="r-target" value="' + P.h(rule ? rule.target || '' : '') + '" /></div></div>' +
      '<div class="row end"><button class="btn" data-close>取消</button><button class="btn primary" id="r-save">保存规则</button></div>', 560);
    P.qs('#r-op', m.root).onchange = (e) => {
      const box = P.qs('#r-threshold', m.root);
      if (e.target.value === 'variance_negative') box.disabled = true; else box.disabled = false;
    };
    P.qs('#r-save', m.root).onclick = async () => {
      const name = P.qs('#r-name', m.root).value.trim();
      if (!name) { P.toast('请填写规则名称', 'error'); return; }
      const op = P.qs('#r-op', m.root).value;
      const conditions = {
        metric: P.qs('#r-metric', m.root).value, op,
        threshold: op === 'variance_negative' ? null : Number(P.qs('#r-threshold', m.root).value),
        dimension: P.qs('#r-dim', m.root).value
      };
      const payload = {
        workspace_id: P.state.workspace.id, owner_name: P.state.user.name || null,
        name, enabled: rule ? rule.enabled : true, metric: conditions.metric, op,
        threshold: conditions.threshold, conditions_json: conditions,
        channel: P.qs('#r-channel', m.root).value, target: P.qs('#r-target', m.root).value.trim() || null,
        schedule: P.qs('#r-schedule', m.root).value, next_run_at: nextRun(P.qs('#r-schedule', m.root).value)
      };
      try {
        if (rule) await P.dbUpdate(P.TABLES.pushRules, rule.id, payload);
        else await P.dbInsert(P.TABLES.pushRules, payload);
        m.close(); await load(); render(currentRoot); P.toast('规则已保存', 'ok');
      } catch (e) { P.toast('保存失败：' + e.message, 'error'); }
    };
  }

  function nextRun(schedule) {
    const d = new Date();
    if (schedule === 'daily') d.setDate(d.getDate() + 1);
    else if (schedule === 'weekly') d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    else d.setMonth(d.getMonth() + 1, 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  function scheduleLabel(s) { return { daily: '每日 09:00', weekly: '每周一 09:00', monthly: '每月 1 日 09:00' }[s] || s; }
  function dimLabel(k) { return { period: '期间', region: '区域', product: '产品线', channel: '渠道' }[k] || k; }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => runChecks(false), 60000);
  }

  async function runChecks(manual) {
    if (checking) return;
    checking = true;
    const status = P.qs('#push-status', currentRoot);
    if (status) status.textContent = '正在检查规则…';
    try {
      const rows = P.state.datasets.flatMap((d) => Array.isArray(d.rows_json) ? d.rows_json : []);
      let fired = 0;
      for (const r of rules) {
        if (!r.enabled) continue;
        if (!manual && r.next_run_at && new Date(r.next_run_at).getTime() > Date.now()) continue;
        const hit = evaluate(r, rows);
        if (hit) {
          await P.dbInsert(P.TABLES.pushLogs, {
            workspace_id: P.state.workspace.id, owner_name: P.state.user.name || null,
            rule_id: r.id, title: '【' + r.name + '】触发提醒', content: hit,
            payload_json: { rule_id: r.id, metric: r.metric, op: r.op, threshold: r.threshold },
            channel: r.channel, status: r.channel === 'inapp' ? 'sent' : 'queued'
          });
          fired += 1;
        }
        await P.dbUpdate(P.TABLES.pushRules, r.id, { last_run_at: new Date().toISOString(), next_run_at: nextRun(r.schedule) });
      }
      await load();
      if (currentRoot) render(currentRoot);
      P.toast(manual ? ('检查完成，触发 ' + fired + ' 条推送') : ('定时检查完成，触发 ' + fired + ' 条'), fired ? 'ok' : '');
    } catch (e) {
      if (status) status.textContent = '检查失败：' + e.message;
    } finally { checking = false; }
  }

  function evaluate(rule, rows) {
    if (!rows.length) return null;
    const c = rule.conditions_json || {};
    const metric = c.metric || rule.metric || 'margin';
    const op = c.op || rule.op;
    const threshold = c.threshold != null ? Number(c.threshold) : Number(rule.threshold || 0);
    const dim = c.dimension && c.dimension !== 'all' ? c.dimension : null;
    const groups = dim ? P.aggregate(rows, { dimensions: [dim], measure: metric, agg: 'sum' }) : [{ value: P.summary(rows)[metric], label: '整体' }];
    const offenders = [];
    groups.forEach((g) => {
      let value = g.value;
      if (op === 'drop_pct' || op === 'rise_pct') {
        const chg = P.detectPeriodChange(rows.filter((r) => !dim || String(r[dim]) === String(g[dim])));
        if (!chg) return;
        value = (op === 'drop_pct' ? -chg.revenueRate : chg.revenueRate) * 100;
        g.metricLabel = op === 'drop_pct' ? '收入环比下降' : '收入环比上升';
      } else g.metricLabel = P.measureLabel(metric);
      let hit = false;
      if (op === '<') hit = Number(value) < threshold;
      else if (op === '>') hit = Number(value) > threshold;
      else if (op === 'drop_pct' || op === 'rise_pct') hit = Number(value) > threshold;
      else if (op === 'variance_negative') hit = Number(P.summary(rows).profit_variance) < 0;
      if (hit) offenders.push({ label: dim ? g[dim] : '整体', value, unit: (op === 'drop_pct' || op === 'rise_pct' || metric === 'margin') ? '%' : 'money' });
    });
    if (!offenders.length) return null;
    offenders.sort((a, b) => a.value - b.value);
    const text = offenders.slice(0, 5).map((o) => o.label + ' ' + (o.unit === '%' ? o.value.toFixed(1) + '%' : P.fmtCompact(o.value))).join('；');
    return '触发条件：' + (OPS.find((x) => x.key === op) || {}).label + (op === 'variance_negative' ? '' : ' ' + threshold) +
      '。命中对象：' + text + '。建议核查相关区域的收入结构与成本投入。';
  }
})();
