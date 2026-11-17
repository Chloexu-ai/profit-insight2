/* ===================================================================
 * 管报月度计算引擎（js/report/engine.js）
 * ---------------------------------------------------------------
 * 纯函数模块：不依赖 DOM / 网络 / 第三方库，浏览器直接 <script> 引入，
 * Node 下可用 require 复用（文件末尾有 CommonJS 兼容导出）。
 *
 * 归集口径（与 docs/管报主数据口径.md 一致）：
 *  1. 金额一律按「科目编码 × 期间 × 数据类型」直接汇总（rules.subjectRule='direct'），
 *     不做任何父子科目汇总：父级与子级同时有数据时各算各的，避免重复计入。
 *  2. 没有年份的「1月」单独成列（LEGACY-Mxx），绝不并入任何年份；
 *     完全无法解析的期间单独标记，不进列。
 *  3. 归集失败（未知编码 / 同名歧义 / 名称不存在）不静默变 0，全部进 diagnostics。
 *  4. 金额按「分」整数累加（Math.round(v*100)），最后 /100，消除 0.1+0.2 浮点误差。
 *  5. 负数保留原符号，不取绝对值、不二次取负。
 * =================================================================== */
(function () {
  const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  const R = (root.PAReport = root.PAReport || {});

  /* ---------------- 常量 ---------------- */

  /* 维度键集合：对应 js/config.js 的 PA_DICT.dimensions（含旧口径 region/product） */
  const DIM_KEYS = ['month', 'data_type', 'site', 'platform', 'channel', 'material',
    'brand', 'category', 'report_product', 'subject', 'subject_code', 'region', 'product'];

  /* 数据类型固定展示顺序：实际数 → 预算数 → 预测数，其余类型排在后面 */
  const DATA_TYPE_ORDER = ['实际数', '预算数', '预测数'];

  const LEGACY_SORT_BASE = 900000;      // 无年份数据的排序基准，保证排在所有真实年份之后
  const KEY_UNKNOWN = 'LEGACY-UNKNOWN'; // 期间完全无法解析
  const TYPE_UNKNOWN = '未分类';        // 数据类型缺失时的兜底列

  /* ---------------- 小工具 ---------------- */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function str(v) {
    return v == null ? '' : String(v).trim();
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /* 诊断收集器：同级别 + 同错误码 + 同说明 合并为一条，count 累加，避免刷屏 */
  function diagBag() {
    const list = [];
    const index = {};
    return {
      add: function (level, code, message, count) {
        const c = count == null ? 1 : count;
        if (!(c > 0)) return;
        const k = level + '|' + code + '|' + message;
        if (hasOwn(index, k)) { index[k].count += c; return; }
        const item = { level: level, code: code, message: message, count: c };
        index[k] = item;
        list.push(item);
      },
      list: function () { return list; }
    };
  }

  /* ---------------- 期间解析 ---------------- */

  /**
   * 解析单个期间写法。
   * 支持 '2026-01' / '2026/1' / '2026.1' / '2026年1月' / '2026-01-01' / '202601' / '1月' / 数字 1–12。
   * 返回 { year, month }（无年份时 year=null），无法解析返回 null。
   */
  function parsePeriodValue(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') {
      if (!isFinite(raw)) return null;
      if (raw >= 1 && raw <= 12) return { year: null, month: Math.floor(raw) };
      return parsePeriodValue(String(raw));
    }
    let s = str(raw);
    if (!s) return null;

    /* 带年份：2026-01、2026/1、2026.01、2026年1月、2026-1月、2026-01-01 */
    let m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*(?:[-/.月]\s*(\d{1,2})\s*日?)?\s*月?$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12) return { year: y, month: mo };
      return null;
    }

    /* 紧凑写法：202601 */
    m = s.match(/^(\d{4})(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12) return { year: y, month: mo };
      return null;
    }

    /* 只有月份：1月 / 01月 */
    m = s.match(/^(\d{1,2})\s*月$/);
    if (m) {
      const mo = Number(m[1]);
      if (mo >= 1 && mo <= 12) return { year: null, month: mo };
      return null;
    }

    /* 纯数字 1–12 视为无年份月份 */
    m = s.match(/^(\d{1,2})$/);
    if (m) {
      const mo = Number(m[1]);
      if (mo >= 1 && mo <= 12) return { year: null, month: mo };
      return null;
    }

    return null;
  }

  function makePeriod(year, month) {
    if (year != null && month != null) {
      const y = Number(year);
      const mo = Number(month);
      if (isFinite(y) && isFinite(mo) && y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12) {
        return {
          key: y + '-' + pad2(mo), label: y + '-' + pad2(mo),
          year: y, month: mo, sortKey: y * 100 + mo, isLegacy: false
        };
      }
    }
    if (month != null) {
      const mo = Number(month);
      if (isFinite(mo) && mo >= 1 && mo <= 12) {
        return {
          key: 'LEGACY-M' + pad2(mo), label: mo + '月（未标年份）',
          year: null, month: mo, sortKey: LEGACY_SORT_BASE + mo, isLegacy: true
        };
      }
    }
    return {
      key: KEY_UNKNOWN, label: '期间未知',
      year: null, month: null, sortKey: LEGACY_SORT_BASE + 99, isLegacy: true
    };
  }

  /* 由期间 key 还原期间对象：'2026-03' / 'LEGACY-M03'，用于保留「已选但无数据」的月份列 */
  function periodFromKey(key) {
    const s = str(key);
    let m = s.match(/^(\d{4})-(\d{2})$/);
    if (m) return makePeriod(Number(m[1]), Number(m[2]));
    m = s.match(/^LEGACY-M(\d{2})$/);
    if (m) return makePeriod(null, Number(m[1]));
    return null;
  }

  /**
   * 归一化期间：优先取带年份的写法（month 只有「1月」而 period 有年份时，用 period 补年份）。
   * 绝不把无年份数据归入任何年份。
   */
  R.normalizePeriod = function (row) {
    const candidates = [];
    if (row && typeof row === 'object') {
      if (str(row.month) !== '') candidates.push(row.month);
      if (str(row.period) !== '') candidates.push(row.period);
    } else if (typeof row === 'string' || typeof row === 'number') {
      candidates.push(row);
    }

    let first = null;
    for (let i = 0; i < candidates.length; i++) {
      const p = parsePeriodValue(candidates[i]);
      if (!p) continue;
      if (!first) first = p;
      if (p.year != null) return makePeriod(p.year, p.month); // 带年份的一律优先
    }
    if (first) return makePeriod(null, first.month);
    return makePeriod(null, null);
  };

  /* ---------------- 筛选条件归一化 ---------------- */

  function toArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /* 去空、去重、统一转字符串，保持用户选择顺序 */
  function cleanValues(arr) {
    const out = [];
    const seen = {};
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null) continue;
      if (typeof v === 'object') continue;
      const s = str(v);
      if (s === '') continue;
      if (hasOwn(seen, s)) continue;
      seen[s] = 1;
      out.push(s);
    }
    return out;
  }

  /**
   * 归一化筛选条件，兼容旧格式（字符串）与新格式（数组）。
   *  - 旧字符串 'ID' → ['ID']；旧空串 '' / null → 该维度不限制（删除键）
   *  - 新格式空数组 [] → 明确「全不选」，必须保留
   *  - 旧 period 键合并进 month；month 有值时以 month 为准
   */
  R.normalizeFilters = function (saved) {
    const s = (saved && typeof saved === 'object') ? saved : {};
    const src = (s.dimensions && typeof s.dimensions === 'object') ? s.dimensions : s;

    const dims = {};
    const monthRaw = src.month;
    const periodRaw = src.period;
    const monthGiven = monthRaw !== undefined && monthRaw !== null && !(typeof monthRaw === 'string' && monthRaw.trim() === '');

    for (let i = 0; i < DIM_KEYS.length; i++) {
      const key = DIM_KEYS[i];
      let raw;
      if (key === 'month') {
        if (monthGiven) raw = monthRaw;
        else if (periodRaw !== undefined && periodRaw !== null) raw = periodRaw;
        else raw = undefined;
      } else {
        raw = src[key];
      }
      if (raw === undefined || raw === null) continue;
      /* 旧格式空字符串代表「该维度全部」 */
      if (typeof raw === 'string' && raw.trim() === '') continue;
      /* 数组保留（含空数组：明确全不选） */
      dims[key] = cleanValues(toArray(raw));
    }

    /* 数据来源 */
    let source = { mode: 'all', datasetId: null };
    const srcObj = s.source;
    if (srcObj && typeof srcObj === 'object') {
      const id = srcObj.datasetId == null || srcObj.datasetId === '' ? null : Number(srcObj.datasetId);
      const okId = id != null && isFinite(id) ? id : null;
      source = { mode: (srcObj.mode === 'dataset' && okId != null) ? 'dataset' : 'all', datasetId: okId };
    } else if (s.datasetId != null && s.datasetId !== '') {
      const id = Number(s.datasetId);
      if (isFinite(id)) source = { mode: 'dataset', datasetId: id };
    }

    return {
      version: 2,
      source: source,
      dimensions: dims,
      periodMode: 'monthly',
      reportTemplateVersion: 'management-v1'
    };
  };

  /* ---------------- 明细行筛选 ---------------- */

  function rowCode(row) {
    if (!row) return '';
    const v = row.subject_code != null ? row.subject_code : row.subjectCode;
    return str(v);
  }

  function rowSubjectName(row) {
    if (!row) return '';
    const v = row.subject != null ? row.subject : row.subject_name;
    return str(v);
  }

  /* 取某个维度在明细行上的取值（product 兼容旧字段） */
  function rowDimValue(row, key) {
    if (!row) return '';
    if (key === 'product') {
      if (str(row.product) !== '') return str(row.product);
      return str(row.report_product);
    }
    return str(row[key]);
  }

  /* 月份选中值 → 可匹配的 key 集合（同时容纳 '1月' 与 'LEGACY-M01' 两种写法） */
  function monthKeySet(values) {
    const set = {};
    for (let i = 0; i < values.length; i++) {
      const raw = str(values[i]);
      if (raw === '') continue;
      set[raw] = 1;
      const p = parsePeriodValue(raw);
      if (p) set[makePeriod(p.year, p.month).key] = 1;
    }
    return set;
  }

  /**
   * 按筛选条件过滤明细行。
   * 同维度多选取 OR，不同维度取 AND；返回新数组，不修改传入的 rows。
   */
  R.filterFacts = function (rows, state) {
    const list = Array.isArray(rows) ? rows : [];
    const filters = (state && typeof state === 'object' && state.dimensions) ? state : R.normalizeFilters(state);
    const dims = filters.dimensions || {};
    const bag = diagBag();

    const keys = [];
    for (let i = 0; i < DIM_KEYS.length; i++) {
      if (hasOwn(dims, DIM_KEYS[i])) keys.push(DIM_KEYS[i]);
    }

    /* 任一维度「全不选」= 没有任何匹配，直接返回空结果（不能退回全部） */
    for (let i = 0; i < keys.length; i++) {
      const v = dims[keys[i]];
      if (Array.isArray(v) && v.length === 0) {
        return { facts: [], dropped: list.length, diagnostics: [] };
      }
    }

    const matchers = keys.map(function (key) {
      const vals = dims[key];
      if (key === 'month') {
        const set = monthKeySet(vals);
        return function (row) { return set[R.normalizePeriod(row).key] === 1; };
      }
      if (key === 'subject') {
        return function (row) {
          const code = rowCode(row);
          if (code !== '' && vals.indexOf(code) >= 0) return true;
          const name = rowSubjectName(row);
          return name !== '' && vals.indexOf(name) >= 0;
        };
      }
      if (key === 'subject_code') {
        return function (row) {
          const code = rowCode(row);
          return code !== '' && vals.indexOf(code) >= 0;
        };
      }
      return function (row) {
        const v = rowDimValue(row, key);
        return v !== '' && vals.indexOf(v) >= 0;
      };
    });

    const facts = [];
    let invalidAmount = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      let keep = true;
      for (let j = 0; j < matchers.length; j++) {
        if (!matchers[j](row)) { keep = false; break; }
      }
      if (!keep) continue;
      facts.push(row);

      /* 金额型异常在这里先记一笔，供调用方在筛选阶段就能提示 */
      const raw = row ? row.amount : null;
      if (raw != null && raw !== '' && !isFinite(Number(raw))) invalidAmount++;
    }

    if (invalidAmount > 0) {
      bag.add('error', 'invalid_amount', '存在金额不是有效数字的明细行，计算时将被跳过。', invalidAmount);
    }

    return {
      facts: facts,
      dropped: list.length - facts.length,
      diagnostics: bag.list()
    };
  };

  /* ---------------- 科目解析 ---------------- */

  function buildRegistry(items) {
    const byCode = {};
    const byName = {};
    const list = [];
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s || typeof s !== 'object') continue;
      const code = str(s.code);
      const name = str(s.name);
      if (code === '' && name === '') continue;
      list.push(s);
      if (code !== '') byCode[code] = s;
      if (name !== '') {
        if (!hasOwn(byName, name)) byName[name] = [];
        byName[name].push(s);
      }
    }
    return { byCode: byCode, byName: byName, list: list };
  }

  function normalizeRegistry(registry) {
    if (registry && typeof registry === 'object' && (registry.byCode || registry.byName)) {
      const byCode = registry.byCode && typeof registry.byCode === 'object' ? registry.byCode : {};
      const byName = registry.byName && typeof registry.byName === 'object' ? registry.byName : {};
      return { byCode: byCode, byName: byName, list: Array.isArray(registry.list) ? registry.list : [] };
    }
    const items = Array.isArray(registry) ? registry
      : (registry && Array.isArray(registry.list)) ? registry.list : [];
    return buildRegistry(items);
  }

  /**
   * 把一条明细行解析到具体科目。
   * 有编码时只认编码（编码存在但查不到 → unknown_code，绝不降级按名称猜）；
   * 无编码时按名称匹配，同名多条 → ambiguous_name，不任选其一。
   */
  R.resolveSubject = function (row, registry) {
    const reg = normalizeRegistry(registry);

    const code = rowCode(row);
    if (code !== '') {
      if (hasOwn(reg.byCode, code)) {
        const hit = reg.byCode[code];
        return { code: str(hit.code), name: str(hit.name), match: 'code', error: null };
      }
      return { code: null, name: null, match: null, error: 'unknown_code' };
    }

    const name = rowSubjectName(row);
    if (name !== '' && hasOwn(reg.byName, name)) {
      const hits = reg.byName[name];
      if (hits && hits.length === 1) {
        return { code: str(hits[0].code), name: str(hits[0].name), match: 'name', error: null };
      }
      if (hits && hits.length > 1) {
        return { code: null, name: null, match: null, error: 'ambiguous_name' };
      }
    }
    return { code: null, name: null, match: null, error: 'unknown_name' };
  };

  /* ---------------- 月度矩阵 ---------------- */

  function itemKey(subject) {
    const code = str(subject && subject.code);
    if (code !== '') return 'C:' + code;
    return 'N:' + str(subject && subject.name);
  }

  function dataTypeOf(row) {
    const t = str(row && row.data_type);
    return t === '' ? TYPE_UNKNOWN : t;
  }

  /**
   * 生成月度矩阵。
   * @param {Object} opts { facts, template, filters, rules }
   *   template 为科目数组（已由调用方按数据权限过滤），顺序即输出行顺序。
   */
  R.buildMonthlyMatrix = function (opts) {
    const o = opts || {};
    const rawFacts = Array.isArray(o.facts) ? o.facts : [];
    const template = Array.isArray(o.template) ? o.template : [];
    const filters = (o.filters && typeof o.filters === 'object' && o.filters.dimensions)
      ? o.filters : R.normalizeFilters(o.filters);
    const rules = (o.rules && typeof o.rules === 'object') ? o.rules : {};
    const bag = diagBag();

    /* 归集规则：当前只支持 direct（按行自身编码汇总），绝不内置毛利/利润公式 */
    const rule = rules.subjectRule == null ? 'direct' : String(rules.subjectRule);
    const ruleIgnored = rule !== 'direct';
    if (ruleIgnored) {
      bag.add('error', 'unsupported_rule',
        '不支持的科目归集规则「' + rule + '」，已回退为 direct（仅按科目自身编码汇总）。', 1);
    }

    /* 模板科目注册表：编码优先，名称做兜底匹配 */
    const tplItems = template.filter(function (s) {
      return s && typeof s === 'object' && (str(s.code) !== '' || str(s.name) !== '');
    });
    const registry = buildRegistry(tplItems);
    const rowIndex = {};
    for (let i = 0; i < tplItems.length; i++) {
      rowIndex[itemKey(tplItems[i])] = i;
    }

    /* 内部按筛选条件再过一遍：保证「全不选」维度一定得到空结果（幂等，不影响已筛选数据） */
    const filtered = R.filterFacts(rawFacts, filters);
    const facts = filtered.facts;
    for (let i = 0; i < filtered.diagnostics.length; i++) {
      const d = filtered.diagnostics[i];
      bag.add(d.level, d.code, d.message, d.count);
    }

    /* 预处理每条明细：期间 + 数据类型 */
    const prepared = facts.map(function (row) {
      return { row: row, period: R.normalizePeriod(row), type: dataTypeOf(row) };
    });

    /* 期间集合：只取明细里真实出现的期间，绝不凭空生成月份 */
    const periodMap = {};
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i].period;
      if (p.key === KEY_UNKNOWN) continue;
      if (!hasOwn(periodMap, p.key)) periodMap[p.key] = p;
    }
    /* 但「用户明确选中的月份」必须保留列——即使该月没有任何明细，也要显示 0 */
    const selMonths = (filters.dimensions && Array.isArray(filters.dimensions.month)) ? filters.dimensions.month : null;
    if (selMonths && selMonths.length) {
      for (let i = 0; i < selMonths.length; i++) {
        const k = str(selMonths[i]);
        if (hasOwn(periodMap, k)) continue;
        const p = periodFromKey(k);
        if (p) periodMap[p.key] = p;
      }
    }
    const periods = Object.keys(periodMap).map(function (k) { return periodMap[k]; })
      .sort(function (a, b) { return a.sortKey - b.sortKey || (a.key < b.key ? -1 : 1); });

    /* 数据类型集合：固定顺序「实际数、预算数、预测数」；明确选中的类型即使无数据也出列 */
    const typeSeen = {};
    const typeOrder = [];
    const selTypes = (filters.dimensions && Array.isArray(filters.dimensions.data_type)) ? filters.dimensions.data_type : [];
    for (let i = 0; i < selTypes.length; i++) {
      const t = str(selTypes[i]);
      if (!t || hasOwn(typeSeen, t)) continue;
      typeSeen[t] = 1;
      typeOrder.push(t);
    }
    for (let i = 0; i < prepared.length; i++) {
      const t = prepared[i].type;
      if (hasOwn(typeSeen, t)) continue;
      typeSeen[t] = 1;
      typeOrder.push(t);
    }
    typeOrder.sort(function (a, b) {
      const ia = DATA_TYPE_ORDER.indexOf(a);
      const ib = DATA_TYPE_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return 0;
    });

    /* 列：期间（升序）× 数据类型（固定顺序） */
    const columns = [];
    const colMap = {};
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      for (let j = 0; j < typeOrder.length; j++) {
        const t = typeOrder[j];
        const key = p.key + '|' + t;
        if (hasOwn(colMap, key)) continue;
        const col = { key: key, period: p.key, periodLabel: p.label, data_type: t, label: p.label + ' ' + t };
        colMap[key] = col;
        columns.push(col);
      }
    }

    /* 汇总：科目 × 期间 × 数据类型，按分累加 */
    const cellCents = {};
    const rowHasData = {};
    let usedFactCount = 0;
    let skippedSubject = 0;
    let unknownPeriod = 0;
    let legacyPeriod = 0;

    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      const row = item.row;
      const rawAmount = row ? row.amount : null;

      /* 金额校验：空值按 0 处理，非数字进诊断 */
      let amount = Number(rawAmount);
      if (rawAmount == null || rawAmount === '') amount = 0;
      if (!isFinite(amount)) {
        bag.add('error', 'invalid_amount', '金额不是有效数字，该行未计入矩阵（示例：' + str(rawAmount).slice(0, 20) + '）。', 1);
        continue;
      }

      /* 期间无法解析：不进任何列 */
      if (item.period.key === KEY_UNKNOWN) { unknownPeriod++; continue; }

      const colKey = item.period.key + '|' + item.type;
      if (!hasOwn(colMap, colKey)) continue;

      const subj = R.resolveSubject(row, registry);
      if (subj.error) {
        skippedSubject++;
        if (subj.error === 'unknown_code') {
          bag.add('error', 'unknown_code',
            '科目编码不在当前模板/数据权限范围内，该行未计入（示例：' + rowCode(row) + '）。', 1);
        } else if (subj.error === 'ambiguous_name') {
          bag.add('error', 'ambiguous_name',
            '科目名称对应多个编码，无法确定归属，该行未计入（示例：' + rowSubjectName(row) + '）。', 1);
        } else {
          bag.add('error', 'unknown_name',
            '科目名称无法匹配到模板科目，该行未计入（示例：' + rowSubjectName(row) + '）。', 1);
        }
        continue;
      }

      const internal = itemKey(subj);
      if (!hasOwn(rowIndex, internal)) {
        /* 理论上不会发生（注册表即模板），留作防御 */
        skippedSubject++;
        bag.add('error', 'unknown_code', '科目未出现在模板中，该行未计入。', 1);
        continue;
      }

      const ck = internal + '|' + colKey;
      cellCents[ck] = (cellCents[ck] || 0) + Math.round(amount * 100);
      rowHasData[internal] = true;
      if (item.period.isLegacy) legacyPeriod++;
      usedFactCount++;
    }

    if (unknownPeriod > 0) {
      bag.add('warn', 'no_year', '部分明细期间的年份或月份无法解析，未计入任何列。', unknownPeriod);
    }
    if (legacyPeriod > 0) {
      bag.add('warn', 'no_year', '部分明细的月份没有年份（如「1月」），已单列为「未标年份」期间，未并入任何年份。', legacyPeriod);
    }

    /* 输出行：顺序严格等于 template 顺序 */
    const rows = tplItems.map(function (s) {
      const key = itemKey(s);
      const cells = {};
      for (let i = 0; i < columns.length; i++) {
        const c = columns[i];
        const cents = cellCents[key + '|' + c.key] || 0;
        const v = cents / 100;
        cells[c.key] = v === 0 ? 0 : v;
      }
      return {
        code: str(s.code) === '' ? null : str(s.code),
        name: str(s.name),
        level: s.level == null ? (Array.isArray(s.path) ? s.path.length : 0) : Number(s.level),
        path: Array.isArray(s.path) ? s.path.slice() : [],
        order: s.order == null ? 0 : Number(s.order),
        /* 单位随行输出：数量/人数不得与金额同轴或混加 */
        unit: str(s.unit) || 'money',
        cells: cells,
        hasData: !!rowHasData[key]
      };
    });

    /* 说明文案 */
    const notes = [];
    if (rawFacts.length === 0) {
      notes.push('无匹配数据：当前筛选条件下没有任何明细行，矩阵全部为 0。');
    } else if (usedFactCount === 0) {
      notes.push('无匹配数据：明细行无法归集到任何科目列，矩阵全部为 0。');
    } else {
      notes.push('共 ' + rawFacts.length + ' 行明细，已归集 ' + usedFactCount + ' 行，生成 ' + columns.length +
        ' 列（' + periods.length + ' 个期间 × ' + typeOrder.length + ' 类数据），' + rows.length + ' 个科目行。');
    }
    if (legacyPeriod > 0) notes.push(legacyPeriod + ' 行月份未标年份，已单列展示，未并入任何年份。');
    if (unknownPeriod > 0) notes.push(unknownPeriod + ' 行期间无法解析，未计入任何列。');
    if (skippedSubject > 0) notes.push(skippedSubject + ' 行科目无法归集被跳过，详见 diagnostics。');
    if (ruleIgnored) notes.push('不支持的归集规则已回退为 direct。');

    return {
      columns: columns,
      rows: rows,
      diagnostics: bag.list(),
      meta: {
        factCount: rawFacts.length,
        usedFactCount: usedFactCount,
        columnsCount: columns.length,
        subjectCount: rows.length,
        dataTypes: typeOrder.slice(),
        periods: periods.map(function (p) { return p.key; }),
        source: filters.source,
        periodMode: filters.periodMode || 'monthly',
        note: notes.join(' ')
      }
    };
  };

  /* ---------------- 趋势数据 ---------------- */

  /**
   * 从矩阵中抽取指定数据类型的时间序列。
   * labels 按列顺序（即时间升序），无数据的点补 0。
   */
  R.buildTrend = function (opts) {
    const o = opts || {};
    const matrix = (o.matrix && typeof o.matrix === 'object') ? o.matrix : {};
    const type = str(o.data_type) === '' ? '实际数' : str(o.data_type);
    const allCols = Array.isArray(matrix.columns) ? matrix.columns : [];
    const cols = allCols.filter(function (c) { return c.data_type === type; });
    const labels = cols.map(function (c) { return c.label; });
    const allRows = Array.isArray(matrix.rows) ? matrix.rows : [];

    let picked = allRows;
    if (Array.isArray(o.codes) && o.codes.length) {
      const byCode = {};
      allRows.forEach(function (r) {
        const c = str(r.code);
        if (c !== '' && !hasOwn(byCode, c)) byCode[c] = r;
      });
      picked = o.codes.map(function (c) { return byCode[str(c)]; })
        .filter(function (r) { return !!r; });
    }

    const series = picked.map(function (r) {
      const values = cols.map(function (c) {
        const v = r.cells ? r.cells[c.key] : 0;
        return typeof v === 'number' && isFinite(v) ? v : 0;
      });
      return { code: r.code, name: r.name, values: values };
    });

    return {
      labels: labels,
      series: series,
      meta: { data_type: type, columnsCount: cols.length, seriesCount: series.length }
    };
  };

  /* ---------------- 金额格式化 ---------------- */

  /* 千分位、两位小数；-0 归零，非数字按 0 处理 */
  R.fmtAmount = function (n) {
    const v = Number(n);
    if (!isFinite(v)) return '0.00';
    const neg = v < 0;
    const parts = Math.abs(v).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  };

  /* 供报表层复用的维度顺序常量（只读副本） */
  R.DIM_KEYS = DIM_KEYS.slice();
  R.DATA_TYPE_ORDER = DATA_TYPE_ORDER.slice();
})();

/* Node 测试兼容：require('./engine.js') 后直接得到 window.PAReport 的内容 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' && window.PAReport)
    ? window.PAReport
    : (typeof globalThis !== 'undefined' ? globalThis.PAReport : null);
}
