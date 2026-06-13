# 中文新闻汇 (cn-news-hub)

自动化中文新闻聚合站点。基于 **Astro**（静态站点生成）+ **GitHub Pages**（托管）+
**GitHub Actions**（每 2 小时定时抓取与构建）+ **Notion**（RSS 新闻源管理）。

- 前端文案：纯中文
- 代码 / 注释 / 文件名：纯英文
- 背景色：纯白（按设计要求固定）
- 全部品牌色、分类、广告位、分页大小等配置集中在根目录 **`site.config.json`**，
  无任何硬编码。

---

## 一、首次部署所需配置（你需要做的部分）

### 1. 创建 Notion Integration 并授权数据库

1. 打开 https://www.notion.so/my-integrations ，点击 **New integration**。
2. 名称随意（如 `cn-news-hub`），关联到你的 workspace，类型选择 **Internal**。
3. 创建后复制 **Internal Integration Secret**（以 `ntn_` 或 `secret_` 开头）——这就是
   `NOTION_API_KEY`。
4. 打开「News Sources」数据库：
   https://app.notion.com/p/8db019d499444e7c9a6bc7ef4424be21
5. 右上角 `...` → **Connections** → 添加上一步创建的 Integration，授予访问权限。

### 2. 在 GitHub 仓库添加 Secrets

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Secret 名称 | 值 |
|---|---|
| `NOTION_API_KEY` | 第 1 步复制的 Integration Secret |
| `NOTION_DATABASE_ID` | `8db019d499444e7c9a6bc7ef4424be21` |

### 3. 开启 GitHub Pages

仓库 → **Settings → Pages** → **Source** 选择 **GitHub Actions**。

### 4. 配置站点域名 / 路径（编辑 `site.config.json` → `site` 字段）

根据你的部署方式二选一：

**方式 A：使用自定义域名（推荐）**
```json
"url": "https://news.yourdomain.com",
"base": "/"
```
并新建 `public/CNAME` 文件，内容为你的域名本身，同时在 DNS 服务商处将该域名
CNAME 指向 `enxpower.github.io`。

**方式 B：使用 GitHub Pages 默认地址（无自定义域名）**
```json
"url": "https://enxpower.github.io/cn-news-hub",
"base": "/cn-news-hub"
```

### 5. 触发首次运行

仓库 → **Actions** → **Fetch news and deploy** → **Run workflow**（手动触发一次），
等待运行完成后即可通过 GitHub Pages 访问站点。后续每 2 小时自动运行一次。

---

## 二、网站结构与设计说明

### 品牌 / VI 配置（`site.config.json`）

所有视觉变量集中在 `theme` 字段，背景色 `backgroundColor` 按要求固定为
`#FFFFFF`（纯白），其余颜色（主色、强调色、文字色等）可自由调整，全站自动生效：

```json
"theme": {
  "backgroundColor": "#FFFFFF",
  "primaryColor": "#1B4F8A",
  "primaryColorDark": "#0B2545",
  "accentColor": "#D4840A",
  ...
}
```

> 注意：`public/favicon.svg`、`public/logo.svg`、`public/og-default.jpg` 这三个
> 图片资源中的颜色是写死在图片本身里的，对应当前默认配色。如果你修改了
> `theme` 中的主色/强调色，建议同步重新生成这三个图片，否则 logo 与页面配色会不一致。

### 字段说明（`site.config.json`）

- `site`：站点名称、标语、描述、URL、语言、部署路径（见上文）
- `branding`：logo、favicon、默认 OG 分享图路径
- `theme`：全站配色（背景必须保持纯白）
- `fonts`：中文标题字体（Noto Serif SC）与正文字体（Noto Sans SC），通过 Google Fonts CDN 加载
- `categories`：分类列表（`id` 用于 URL 与 Markdown frontmatter，`label` 为中文显示名，
  **必须与 Notion 数据库「Category」选项的中文标签完全一致**，否则抓取脚本会把
  无法匹配的分类归入第一个分类）
- `pagination.pageSize`：每页文章数
- `content`：内容保留天数（`retentionDays`，默认 30 天自动清理）、摘要长度
  （`summaryLength`）、抓取超时（`fetchTimeoutMs`）
- `ads`：Google AdSense 配置。`enabled` 为总开关；`positions.listInFeed`
  控制信息流广告（每隔 `everyNItems` 篇文章插入一个广告位）；
  `positions.articleBottom` 控制文章详情页底部广告。**填入你的 AdSense
  客户 ID 与广告位 ID 后，将对应 `enabled` 设为 `true` 即可生效**，未填写时
  不会渲染任何广告相关代码。
- `footer`：页脚链接与版权/免责声明文案

### Notion「News Sources」数据库字段

| 字段 | 类型 | 说明 |
|---|---|---|
| Name | 标题 | 新闻源名称，将作为文章「来源」显示 |
| RSS URL | URL | RSS/Atom 订阅地址 |
| Category | 单选 | 必须与 `site.config.json` 中 `categories[].label` 一致 |
| Enabled | 复选框 | 取消勾选可暂停某个源，不会被抓取 |
| Status | 单选 | 由抓取脚本自动写回（🆕 New / ✅ OK / ⚠️ Failed / ⏸ Paused） |
| Last Fetched | 日期 | 由抓取脚本自动写回 |
| Last Error | 文本 | 抓取失败时的错误信息，自动写回 |
| Notes | 文本 | 人工备注，不参与抓取逻辑 |

目前已预填 5 条示例数据，其中：
- **美国之音中文网** 的 RSS 地址看起来不完整/可能失效（`...api/zq$omet`），建议核实后替换。
- **联合早报** 已设为 `Enabled = 否`（暂停），地址待你验证后再开启。

你可以随时在 Notion 中增删/暂停新闻源，下一次抓取（最多 2 小时内）会自动生效，
无需改动代码或重新部署。

---

## 三、本地开发

```bash
npm install
npm run dev        # 本地预览，http://localhost:4321
npm run build      # 生成静态文件到 dist/
npm run fetch-news # 手动执行一次抓取（需设置 NOTION_API_KEY / NOTION_DATABASE_ID 环境变量）
```

---

## 四、目录结构

```
site.config.json          # 全站唯一配置文件（VI、分类、广告、分页等）
src/
  content/articles/        # 抓取生成的 Markdown 文章（自动管理）
  content/config.ts         # 文章内容的 schema 定义
  components/                # Header / Footer / ArticleCard / AdSlot / Pagination / NewsList
  layouts/BaseLayout.astro   # 全局 HTML 结构、主题变量注入、SEO、全局脚本
  pages/                      # 首页、分页、分类、文章详情、关于、状态页、404
  styles/global.css          # 全站样式
  lib/articles.ts             # 文章读取 / 分页工具函数
scripts/
  fetch-news.mjs              # 主抓取脚本（Notion -> RSS -> Markdown）
  notion.mjs                  # Notion API 客户端
  utils.mjs                   # 通用工具函数
data/
  seen-urls.json              # 已处理文章去重记录（自动维护）
  sources-status.json         # 最近一次抓取状态（供 /admin/status 展示）
.github/workflows/build-deploy.yml  # 定时抓取 + 构建 + 部署
```

---

## 五、设计要点

- **纯白背景** + 藏蓝（主色）/ 暖橙（强调色）配色，Noto Serif SC 标题 + Noto Sans SC
  正文，编辑部风格的卡片网格布局。
- **已读状态**：文章卡片点击进入详情页后，会在 `localStorage` 中记录，返回列表时
  该卡片标题变为灰色、配图轻微去色，便于区分已读/未读。
- **字号调节**：页头 `A- / A / A+` 按钮，调整全站正文字号并记忆用户选择。
- **禁用右键菜单与横向滑动手势**：全站脚本禁用 `contextmenu`，且页面级
  `touch-action: pan-y` 阻止横向滑动触发浏览器前进/后退；分类导航栏内部允许
  横向滚动（`touch-action: pan-x`，作用范围仅限导航条本身）。
- **分页**：固定每页文章数（`pagination.pageSize`），上一页/下一页 + 页码，
  无无限滚动。
- **来源标注**：每篇文章详情页顶部均有醒目的来源信息框，包含来源名称与
  「查看原文」外链（`rel="noopener noreferrer nofollow"`）。
- **容错抓取**：任意单个 RSS 源抓取失败（超时、404、格式错误等）都会被捕获并
  记录，不影响其他源或本次构建。
