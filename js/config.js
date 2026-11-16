/* 云环境公开配置：来自 workbuddy_cloud_service 返回的 publicConfig */
window.PA_CONFIG = {
  endpoint: 'https://wbapp-msvv81jsijnwq06xe62oxe.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_MsvV81jsIjNwq06Xe62oxE_8uMXsqVce2rNnbKWYxyvbb7VF7tGGJlV'
};

/* 全局唯一客户端，Auth / Database / Storage / LLM 共用 */
window.cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: window.PA_CONFIG.endpoint,
  oauthRelayBaseUrl: window.PA_CONFIG.oauthRelayBaseUrl,
  publishableKey: window.PA_CONFIG.publishableKey
});

/* 业务字段字典：M1 清洗、M2 问数、M3 看板共用同一套契约 */
window.PA_DICT = {
  dimensions: [
    { key: 'period', label: '期间', aliases: ['期间', '月份', '年月', '季度', '日期', '时间', 'period', 'month', 'date', 'quarter'] },
    { key: 'region', label: '区域', aliases: ['区域', '地区', '大区', '战区', '城市', 'region', 'area', 'zone'] },
    { key: 'product', label: '产品线', aliases: ['产品线', '产品', '品类', '业务线', '产品线名称', 'product', 'category', 'line'] },
    { key: 'channel', label: '渠道', aliases: ['渠道', '通路', '销售渠道', 'channel'] }
  ],
  metrics: [
    { key: 'revenue', label: '实际收入', aliases: ['实际收入', '收入', '营业收入', '销售收入', '实际销售额', 'revenue', 'actual_revenue', 'sales'] },
    { key: 'cost', label: '实际成本', aliases: ['实际成本', '成本', '总成本', '营业成本', 'cost', 'actual_cost'] },
    { key: 'budget', label: '预算收入', aliases: ['预算收入', '预算', '目标收入', '收入预算', 'budget', 'target', 'budget_revenue'] },
    { key: 'budget_cost', label: '预算成本', aliases: ['预算成本', '成本预算', 'budget_cost', 'target_cost'] }
  ],
  derived: {
    actual_profit: { label: '实际利润', expr: 'revenue - cost' },
    budget_profit: { label: '预算利润', expr: 'budget - budget_cost' },
    profit_variance: { label: '利润差异', expr: 'actual_profit - budget_profit' },
    revenue_variance: { label: '收入差异', expr: 'revenue - budget' },
    margin: { label: '利润率', expr: 'actual_profit / revenue' }
  }
};

window.PA_MEASURES = [
  { key: 'revenue', label: '实际收入', unit: 'money' },
  { key: 'cost', label: '实际成本', unit: 'money' },
  { key: 'budget', label: '预算收入', unit: 'money' },
  { key: 'budget_cost', label: '预算成本', unit: 'money' },
  { key: 'actual_profit', label: '实际利润', unit: 'money' },
  { key: 'budget_profit', label: '预算利润', unit: 'money' },
  { key: 'profit_variance', label: '利润差异', unit: 'money' },
  { key: 'revenue_variance', label: '收入差异', unit: 'money' },
  { key: 'margin', label: '利润率', unit: 'percent' }
];

window.PA_SAMPLE_ROWS = [
  { period: '2026-01', region: '华东', product: '企业服务', channel: '直销', revenue: 1280000, cost: 842000, budget: 1200000, budget_cost: 810000 },
  { period: '2026-01', region: '华南', product: '企业服务', channel: '渠道', revenue: 960000, cost: 672000, budget: 1000000, budget_cost: 680000 },
  { period: '2026-01', region: '华北', product: '零售云', channel: '直销', revenue: 1450000, cost: 1015000, budget: 1320000, budget_cost: 950000 },
  { period: '2026-02', region: '华东', product: '企业服务', channel: '直销', revenue: 1360000, cost: 870000, budget: 1260000, budget_cost: 840000 },
  { period: '2026-02', region: '华南', product: '零售云', channel: '渠道', revenue: 1120000, cost: 806000, budget: 1080000, budget_cost: 790000 },
  { period: '2026-02', region: '华北', product: '企业服务', channel: '直销', revenue: 1180000, cost: 760000, budget: 1220000, budget_cost: 800000 },
  { period: '2026-03', region: '华东', product: '零售云', channel: '渠道', revenue: 1520000, cost: 1094000, budget: 1400000, budget_cost: 1020000 },
  { period: '2026-03', region: '华南', product: '企业服务', channel: '直销', revenue: 1080000, cost: 702000, budget: 1100000, budget_cost: 730000 },
  { period: '2026-03', region: '华北', product: '零售云', channel: '渠道', revenue: 1310000, cost: 983000, budget: 1250000, budget_cost: 940000 }
];
