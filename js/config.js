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

/* ===================================================================
 * 管报主数据字典（来自《管报主数据及定义.xlsx》）
 * M1 清洗、M2 问数、M3 看板共用同一套契约。
 * 维度 key 保持稳定；aliases 覆盖主数据里的中英文/大小写/编码写法。
 * =================================================================== */
window.PA_DICT = {
  dimensions: [
    { key: 'month', label: '月份', aliases: ['月份', '月', '期间', '年月', 'month', 'period', '季度', 'quarter'],
      values: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'] },
    { key: 'data_type', label: '数据类型', aliases: ['数据类型', '编码', 'data_type', 'type', '类别'],
      values: ['实际数','预算数','预测数'],
      aliasesMap: { 'T01':'实际数', 'T02':'预算数', 'T03':'预测数', '实际':'实际数', '预算':'预算数', '预测':'预测数', 'actual':'实际数', 'budget':'预算数', 'forecast':'预测数' } },
    { key: 'site', label: '站点/国家', aliases: ['站点', '国家', '站点/国家', '站点国家', 'site', 'country', '国家编码', '缩写'],
      values: ['ID','MY','PH','TH','VN','SG','US','MX','BR','GE','FR'],
      aliasesMap: { 'DE':'GE', 'C01':'ID','C02':'MY','C03':'TH','C04':'PH','C05':'VN','C06':'SG','C07':'US','C08':'MX','C09':'BR','C10':'GE','C11':'FR',
        '印尼':'ID','马来西亚':'MY','泰国':'TH','菲律宾':'PH','越南':'VN','新加坡':'SG','美国':'US','墨西哥':'MX','巴西':'BR','德国':'GE','法国':'FR',
        'indonesia':'ID','malaysia':'MY','thailand':'TH','philippines':'PH','vietnam':'VN','singapore':'SG','usa':'US','mexico':'MX','brazil':'BR','germany':'GE','france':'FR' } },
    { key: 'platform', label: '平台', aliases: ['平台', '平台名称', '平台编码', '一级渠道', 'platform'],
      values: ['Tiktok','Shopee','Lazada','Amazon','线下'],
      aliasesMap: { 'A01':'Tiktok','A02':'Shopee','A03':'Lazada','A04':'Amazon', 'tiktok':'Tiktok','抖音':'Tiktok','shopee':'Shopee','虾皮':'Shopee','lazada':'Lazada','速卖通':'Lazada','amazon':'Amazon','亚马逊':'Amazon','offline':'线下' } },
    { key: 'channel', label: '渠道', aliases: ['渠道', '渠道编号', '二级渠道', 'channel'],
      values: ['tt自播','tt代播','tt达播','tt网红短视频','tt自营个人号销售','tt自制','tt自制-厦门','tt官媒','其它溢出销售',
        'Shopee货架销售','Lazada货架销售','Amazon货架销售','Aeon'],
      aliasesMap: { 'S01':'tt自播','S02':'tt自播','S03':'tt自播','S04':'tt自播','S05':'tt自播','S06':'tt代播','S07':'tt代播','S08':'tt代播','S09':'tt代播','S10':'tt代播','S11':'tt达播','S12':'tt达播','S13':'tt网红短视频','S14':'tt网红短视频','S15':'tt网红短视频','S16':'tt自营个人号销售','S17':'tt自制','S18':'tt自制','S19':'tt自制-厦门','S20':'tt官媒','S21':'其它溢出销售','S22':'Shopee货架销售','S23':'Shopee货架销售','S24':'Shopee货架销售','S25':'Shopee货架销售','S26':'Shopee货架销售','S27':'Lazada货架销售','S28':'Lazada货架销售','S29':'Lazada货架销售','S30':'Lazada货架销售','S31':'Lazada货架销售','S32':'Amazon货架销售','S33':'Aeon' } },
    { key: 'material', label: '素材来源', aliases: ['素材来源', '素材', 'material', 'source'],
      values: ['自制','剧情','XM自制','官媒','直投','付费头达','纯佣达播','KOL','KOC','不挂车','1组','2组','自播','INS图文','站内','Aeon'] },
    { key: 'brand', label: '品牌', aliases: ['品牌', 'brand'],
      values: ['GMEELAN','GLOSTAR','HAIRTIFIC','YOUNJOY','TOOTHGEEK','非自营品牌'],
      aliasesMap: { 'Gmeelan':'GMEELAN','gmeelan':'GMEELAN','Glostar':'GLOSTAR','glostar':'GLOSTAR','Hairtific':'HAIRTIFIC','Younjoy':'YOUNJOY','Toothgeek':'TOOTHGEEK' } },
    { key: 'category', label: '品类', aliases: ['品类', 'category', '产品品类'],
      values: ['底妆','美白祛斑','清洁'] },
    { key: 'report_product', label: '报表产品', aliases: ['报表产品', '产品', '产品线', 'product', 'spu', 'sku', '商品'],
      values: ['黑气垫','去角质啫喱','黑气垫替换装','粉气垫','粉底棒','粉气垫替换装','懒人霜','除臭喷雾','定妆喷雾','粉底液','极地懒人霜','蓝气垫','油橄榄洁面','防晒银管','飞机盒套组','香皂','有色懒人霜','唇部精华','大号粉扑','防晒粉底棒','海茴香面霜','黑口红','黑泥','积雪草面膜','美白精华','美白面霜','三层气垫','散粉','刷酸精华','刷酸面霜','刷酸爽肤水','腋下美白霜','白泥','卸妆膏','卸妆水','卸妆油','眼霜','洁颜泥','控油洁面','祛痘水粉','水杨酸面膜','香体露','熊果防晒霜','熊果苷防晒喷雾','斋月礼盒','虾青素（赠品）','除臭小样','痘痘贴','卸妆啫喱'] },
    { key: 'subject', label: '科目', aliases: ['科目', '一级科目', '二级科目', '三级科目', '四级科目', '科目编码', 'subject', '会计科目'],
      values: ['订单量','销量','销售收入','发货GMV','退货GMV','买家实付运费收入','物流补贴收入','产品成本-内核法','采购成本','中台结算成本','综合头程成本','空运成本','赠品成本','产品毛利-内核法','销售费用','线上货架站内推广费用','线上货架站外推广费用','Tiktok市场营销费用','售后费用','线下MT费用','线下代理商费用','品牌费用','物流费用','库存减值','综合税负','销售毛利-内核法','前台毛利-内核法','管理费用','财务费用','营业利润','营业税金及附加','企业所得税','净利润-内核法','营业外收支','平台费用','站内广告费用','资源坑位费用','联盟佣金','自播直播间费用','网红固定费','站外广告费用','素材采买费'],
      /* 科目编码：与 values 顺序一一对应，数字编码比汉字更不易输错。1xxx 收入/规模 / 2xxx 成本 / 3xxx 毛利 / 4xxx 费用税金 / 5xxx 利润 / 9xxx 其他 */
      codes: ['1001','1002','1101','1102','1103','1104','1105','2101','2102','2103','2104','2105','2106','3101','4101','4102','4103','4104','4105','4106','4107','4108','4109','4110','4111','3102','3103','4201','4202','5101','4203','4204','5102','5103','9301','9302','9303','9304','9305','9306','9307','9308'],
      aliasesMap: { '1001':'订单量','1002':'销量','1101':'销售收入','1102':'发货GMV','1103':'退货GMV','1104':'买家实付运费收入','1105':'物流补贴收入',
        '2101':'产品成本-内核法','2102':'采购成本','2103':'中台结算成本','2104':'综合头程成本','2105':'空运成本','2106':'赠品成本',
        '3101':'产品毛利-内核法','3102':'销售毛利-内核法','3103':'前台毛利-内核法',
        '4101':'销售费用','4102':'线上货架站内推广费用','4103':'线上货架站外推广费用','4104':'Tiktok市场营销费用','4105':'售后费用','4106':'线下MT费用','4107':'线下代理商费用','4108':'品牌费用','4109':'物流费用','4110':'库存减值','4111':'综合税负',
        '4201':'管理费用','4202':'财务费用','4203':'营业税金及附加','4204':'企业所得税',
        '5101':'营业利润','5102':'净利润-内核法','5103':'营业外收支',
        '9301':'平台费用','9302':'站内广告费用','9303':'资源坑位费用','9304':'联盟佣金','9305':'自播直播间费用','9306':'网红固定费','9307':'站外广告费用','9308':'素材采买费' } },
    /* 旧口径兼容键：历史数据集仍可查询与展示 */
    { key: 'region', label: '区域（旧）', aliases: ['区域', '地区', '大区', 'region', 'area'] }
  ],
  metrics: [
    { key: 'amount', label: '金额', aliases: ['金额', '发生额', '本期金额', 'amount', '数值', 'value'] },
    /* 兼容旧口径：收入/成本/预算，可由金额 + 科目 + 数据类型归集得到 */
    { key: 'revenue', label: '实际收入', aliases: ['实际收入', '收入', '营业收入', '销售收入', 'revenue'] },
    { key: 'cost', label: '实际成本', aliases: ['实际成本', '成本', '总成本', 'cost'] },
    { key: 'budget', label: '预算收入', aliases: ['预算收入', '预算', 'budget'] },
    { key: 'budget_cost', label: '预算成本', aliases: ['预算成本', 'budget_cost'] }
  ],
  derived: {
    actual_profit: { label: '实际利润', expr: '实际收入 - 实际成本' },
    budget_profit: { label: '预算利润', expr: '预算收入 - 预算成本' },
    profit_variance: { label: '利润差异', expr: '实际利润 - 预算利润' },
    revenue_variance: { label: '收入差异', expr: '实际收入 - 预算收入' },
    margin: { label: '利润率', expr: '实际利润 / 实际收入' }
  },
  /* 数据类型 → 预算/实际归集口径 */
  dataTypeRole: { '实际数': 'actual', '预算数': 'budget', '预测数': 'forecast' },
  /* 科目 → 收入/成本角色（用于 amount 归集到 revenue/cost） */
  subjectRole: {
    'revenue': ['销售收入','发货GMV','买家实付运费收入','物流补贴收入','订单量','销量'],
    'cost': ['产品成本-内核法','采购成本','中台结算成本','综合头程成本','空运成本','赠品成本','综合税负','销售费用','管理费用','财务费用','营业税金及附加','企业所得税']
  }
};

window.PA_MEASURES = [
  { key: 'amount', label: '金额', unit: 'money' },
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

/* 管报看板维度标签（M3 用） */
window.PA_DIM_LABELS = {
  month: '月份', data_type: '数据类型', site: '站点/国家', platform: '平台',
  channel: '渠道', material: '素材来源', brand: '品牌', category: '品类',
  report_product: '报表产品', subject: '科目'
};

/* ===================================================================
 * 数据视图权限（控制科目级可见范围）
 * - management 管理层：可见全部科目（含真实产品成本、费用到净利润）
 * - business 业务端：仅可见「产品成本-内核法」到「销售毛利-内核法」区间
 * 约定：subjectRange 为闭区间，按 PA_DICT 科目 values 顺序截取。
 * =================================================================== */
window.PA_DATA_VIEWS = {
  management: {
    key: 'management', label: '管理层视图', badge: '全量',
    desc: '可见全部科目：含真实产品成本、各项费用直至营业利润、净利润。',
    subjectMode: 'all', subjectRange: null
  },
  business: {
    key: 'business', label: '业务端视图', badge: '受限',
    desc: '仅可见「产品成本-内核法」至「销售毛利-内核法」区间的科目，隐藏净利润等敏感科目。',
    subjectMode: 'range', subjectRange: ['产品成本-内核法', '销售毛利-内核法']
  }
};
/* 默认角色 → 视图映射（成员未单独指定时按协作角色套用） */
window.PA_ROLE_VIEW = { owner: 'management', editor: 'business', viewer: 'business' };

/* 管报导入标准模板表头（M1 下载用）：科目列使用编码，避免汉字错别字 */
window.PA_TEMPLATE_HEADERS = ['月份','数据类型','站点/国家','平台','渠道','素材来源','品牌','品类','报表产品','科目编码','金额'];

window.PA_SAMPLE_ROWS = [
  { month:'1月', data_type:'实际数', site:'ID', platform:'Tiktok', channel:'tt自播', material:'自制', brand:'GMEELAN', category:'底妆', report_product:'黑气垫', subject:'销售收入', amount:1280000, revenue:1280000, cost:0, budget:0, budget_cost:0 },
  { month:'1月', data_type:'实际数', site:'ID', platform:'Tiktok', channel:'tt自播', material:'自制', brand:'GMEELAN', category:'底妆', report_product:'黑气垫', subject:'产品成本-内核法', amount:842000, revenue:0, cost:842000, budget:0, budget_cost:0 },
  { month:'1月', data_type:'预算数', site:'ID', platform:'Tiktok', channel:'tt自播', material:'自制', brand:'GMEELAN', category:'底妆', report_product:'黑气垫', subject:'销售收入', amount:1200000, revenue:0, cost:0, budget:1200000, budget_cost:0 },
  { month:'1月', data_type:'预算数', site:'ID', platform:'Tiktok', channel:'tt自播', material:'自制', brand:'GMEELAN', category:'底妆', report_product:'黑气垫', subject:'产品成本-内核法', amount:810000, revenue:0, cost:0, budget:0, budget_cost:810000 },
  { month:'2月', data_type:'实际数', site:'MY', platform:'Shopee', channel:'Shopee货架销售', material:'自播', brand:'GMEELAN', category:'清洁', report_product:'去角质啫喱', subject:'销售收入', amount:960000, revenue:960000, cost:0, budget:0, budget_cost:0 },
  { month:'2月', data_type:'实际数', site:'MY', platform:'Shopee', channel:'Shopee货架销售', material:'自播', brand:'GMEELAN', category:'清洁', report_product:'去角质啫喱', subject:'产品成本-内核法', amount:672000, revenue:0, cost:672000, budget:0, budget_cost:0 },
  { month:'2月', data_type:'预算数', site:'MY', platform:'Shopee', channel:'Shopee货架销售', material:'自播', brand:'GMEELAN', category:'清洁', report_product:'去角质啫喱', subject:'销售收入', amount:1000000, revenue:0, cost:0, budget:1000000, budget_cost:0 },
  { month:'2月', data_type:'预算数', site:'MY', platform:'Shopee', channel:'Shopee货架销售', material:'自播', brand:'GMEELAN', category:'清洁', report_product:'去角质啫喱', subject:'产品成本-内核法', amount:680000, revenue:0, cost:0, budget:0, budget_cost:680000 },
  { month:'3月', data_type:'实际数', site:'US', platform:'Amazon', channel:'Amazon货架销售', material:'', brand:'GLOSTAR', category:'美白祛斑', report_product:'美白精华', subject:'销售收入', amount:1450000, revenue:1450000, cost:0, budget:0, budget_cost:0 },
  { month:'3月', data_type:'实际数', site:'US', platform:'Amazon', channel:'Amazon货架销售', material:'', brand:'GLOSTAR', category:'美白祛斑', report_product:'美白精华', subject:'产品成本-内核法', amount:1015000, revenue:0, cost:1015000, budget:0, budget_cost:0 },
  { month:'3月', data_type:'预算数', site:'US', platform:'Amazon', channel:'Amazon货架销售', material:'', brand:'GLOSTAR', category:'美白祛斑', report_product:'美白精华', subject:'销售收入', amount:1320000, revenue:0, cost:0, budget:1320000, budget_cost:0 },
  { month:'3月', data_type:'预算数', site:'US', platform:'Amazon', channel:'Amazon货架销售', material:'', brand:'GLOSTAR', category:'美白祛斑', report_product:'美白精华', subject:'产品成本-内核法', amount:950000, revenue:0, cost:0, budget:0, budget_cost:950000 }
];

/* ===================================================================
 * 管报科目模板元信息（management-v1）
 * 完整 201 条科目注册表见 js/report/subjects.js（window.PA_REPORT_SUBJECTS），
 * 这里只登记模板级元信息，供 M1 导入说明与 M3 管报页脚展示。
 * =================================================================== */
window.PA_REPORT_TEMPLATE = {
  version: 'management-v1',
  source: '《管报格式.xlsx》Sheet1',
  rowCount: 201,
  periods: 'monthly',
  note: '四级科目按编码长度定级（4/6/8/10 位 → 1/2/3/4 级），同名科目必须按编码区分；金额(money)、数量(quantity)、人数(headcount) 三类单位不得混合汇总。'
};

