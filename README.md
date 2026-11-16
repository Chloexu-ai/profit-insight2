# 利润分析平台 · Profit Insight

一个可供多人协作开发的纯前端利润分析平台，四个模块独立运作、共享同一套数据契约与云端协作空间。

## 模块结构

| 模块 | 文件 | 职责 |
|------|------|------|
| M1 数据导入工作台 | `js/modules/m1.js` | 模板下载、CSV/Excel 解析清洗、字段映射、校验入库 |
| M2 Text to SQL 智能问数 | `js/modules/m2.js` | 自然语言 → 只读 SQL 计划 → 执行 → 归因，含本地规则降级 |
| M3 数据看板 | `js/modules/m3.js` | 领导看数模板、KPI/柱/线/饼/表、筛选器、拖拽布局 |
| M4 信息推送 | `js/modules/m4.js` | 触发条件、定时规则、推送记录 |
| 共享底座 | `js/core.js` `js/config.js` `js/app.js` | 云 SDK 客户端、登录、模块注册表、数据清洗聚合、数据字典 |

每个模块通过 `window.PA{M1..M4}.mount(el)` / `destroy()` 独立挂载，互不干扰。

## 数据契约

`js/config.js` 里的 `PA_DICT` / `PA_MEASURES` 是 M1–M4 共用的字段字典，**新增指标或维度请先改这里**，保持四个模块口径一致。

派生指标：实际利润、预算利润、利润差异、收入差异、利润率。

## 本地运行

纯静态站点，无需构建、无本地依赖。任选一种：

- 直接双击 `index.html`（部分浏览器对本地文件有限制）；
- 推荐：`python -m http.server 8000`，浏览器打开 `http://localhost:8000`。

登录使用手机号验证码；微信登录需发布到 HTTPS 域名后可用。

## 云端环境

`js/config.js` 中的 `endpoint` / `oauthRelayBaseUrl` / `publishableKey` 指向本项目已开通的云服务（数据库、Auth、LLM）。这是**公开配置**（publishable key），可提交到仓库。数据存在云端，协作者共享同一后端。

## 协作开发流程（Git）

本项目采用「分支开发 + PR 合并」方式，避免互相覆盖。

```bash
# 1. 克隆仓库
git clone <仓库地址>
cd <项目目录>

# 2. 新建分支（按你的任务命名）
git checkout -b feature/m3-add-yoy-chart

# 3. 修改代码后提交
git add .
git commit -m "M3 增加同比柱图"

# 4. 推送分支
git push -u origin feature/m3-add-yoy-chart
```

然后在代码平台（CNB / GitHub / Gitee）上创建 Pull Request，由负责人 review 后合并到 `main`。

### 用 WorkBuddy 协作改代码

成员可在 WorkBuddy 新建任务时「选择工作空间」指向本仓库目录，然后用自然语言提需求，例如「给 M3 加一个环比折线图」「把主题改成深色」，WorkBuddy 会基于同一份代码修改。改完同样走分支 + PR 提交。

### 分工建议

- 负责人：main 分支合并、M1 数据口径、M4 推送规则、云端数据表与权限。
- 协作者：各自认领 M2 问数场景、M3 看板组件等，建独立分支。

## 注意事项

- 改页面**内容**（数据/看板/规则）不需要改代码：登录应用 → 同一协作空间 → 编辑成员直接操作即可。
- 改页面**代码**（布局/样式/新模块）才需要走上面的 Git 流程，且合并后需重新发布应用才会在线上生效。
- 新增模块：复制任一 `js/modules/mN.js`，在 `js/app.js` 注册导航，在 `index.html` 引入脚本即可，不影响现有模块。
- `.workbuddy/`（本地工作区数据）和 `*.genie`（本机应用卡片，含绝对路径）已在 `.gitignore` 中排除，不要提交。
