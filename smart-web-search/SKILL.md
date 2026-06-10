---
name: smart-web-search
description: 智能联网搜索工具，国内外自动切换引擎，Query 意图优化，双层内容抓取，适合中文和英文查询
version: 1.0.0
author: smart-web-search
trigger_keywords:
  - 搜索
  - 查一下
  - 找一下
  - 最新消息
  - 新闻
  - 教程
  - search
  - find
tools:
  - name: search
    description: 智能搜索，自动切换 Bing/DuckDuckGo，Query 改写，正文抓取
    script: scripts/search.js
    parameters:
      query:
        type: string
        description: "搜索关键词"
        required: true
      max:
        type: integer
        description: "最大结果数，默认10，上限30"
        required: false
      region:
        type: string
        description: "区域: auto（自动检测）/cn（国内）/intl（国际），默认auto"
        required: false
      fetch:
        type: integer
        description: "抓取前N条正文内容，默认3，0为不抓取"
        required: false
      filter:
        type: boolean
        description: "过滤低质量域名，默认false"
        required: false
---

# smart-web-search

智能联网搜索工具，整合多项优化能力：

## 核心特性

### 1. 区域自动切换（纯 HTTP，极速稳定）
- **国内网络**: 自动使用 Bing 国内版（HTTP 直连，无 headless 检测问题）
- **国际网络**: 自动使用 DuckDuckGo HTML（纯 HTTP，速度快）
- **兜底策略**: 主引擎无结果时自动切换备用引擎
- **架构优势**: 完全基于 HTTP 请求，无需启动浏览器，速度快、资源占用低

### 2. Query 智能改写
基于搜索意图自动优化关键词，提升结果相关性：

| 输入示例 | 改写后 | 说明 |
|---------|--------|------|
| 深圳有什么好玩的 | 深圳 景点 | 城市游玩查询 |
| 深圳美食 | 深圳 美食推荐 | 城市美食查询 |
| 今日金价 | 金价 | 去掉模糊时间词 |
| Python 是什么 | Python 介绍 | 知识类查询 |
| Python 教程 | Python 教程 | 教程类（标准化） |
| 怎么做蛋糕 | 蛋糕 做法 | 方法类查询 |
| xxx 怎么样 | xxx 评价 | 评价类查询 |
| xxx 靠谱吗 | xxx 评价 | 评价类查询 |
| A和B哪个好 | A B 对比 | 对比类查询 |
| Python vs Java | Python Java 对比 | VS对比查询 |
| xxx 下载 | xxx 官方下载 | 下载类查询 |
| xxx 官网 | xxx 官网 | 官网查询 |
| 最新xxx消息 | xxx 最新 | 资讯类查询 |

可通过 `--no-rewrite` 跳过改写。

### 3. 双层内容抓取
搜索后自动抓取前 N 条 URL 的正文内容：
- **第 1 层**: 轻量 HTTP + cheerio（秒出，不启动浏览器）
  - 支持 JSON API、JSON-LD、Next.js 数据提取
  - 自动处理 GBK 编码
- **第 2 层**: Playwright headed 浏览器兜底（支持 JS 渲染页面）

### 4. 低质量域名过滤
可选参数 `--filter`，自动过滤：
- 百度经验/知道/贴吧/文库
- 知乎（可选）

## 使用示例

```bash
# 基础搜索（自动检测区域，抓取前3条正文）
node scripts/search.js "Claude Code 教程"

# 指定区域
node scripts/search.js "最新科技新闻" --region=cn

# 只搜索不抓正文
node scripts/search.js "React hooks" --no-fetch

# 过滤低质量域名
node scripts/search.js "编程入门" --filter

# 跳过 Query 改写
node scripts/search.js "今日金价" --no-rewrite

# 抓取前5条正文
node scripts/search.js "AI 发展趋势" --fetch=5

# 最多返回20条结果
node scripts/search.js "开源项目" --max=20
```

## 安装

### 自动安装（推荐）

```bash
cd smart-web-search
bash scripts/setup.sh   # Linux/macOS
```

Windows PowerShell：
```powershell
cd smart-web-search
npm install
npx playwright install chromium
```

### 依赖

| 依赖 | 用途 | 大小 | 必需 |
|------|------|------|------|
| Node.js >= 18 | 运行时 | - | ✅ |
| cheerio | HTML 解析 | 小 | ✅ |
| commander | CLI 参数 | 小 | ✅ |
| iconv-lite | GBK 编码 | 小 | ✅ |
| playwright | 正文抓取（仅 fetch.js 使用） | 50MB | ✅ |
| Chromium | Playwright 浏览器（仅正文抓取兜底） | 150MB | ✅ |

**说明**：
- **搜索功能**完全基于 HTTP，无需浏览器
- **正文抓取**优先用 HTTP，失败时 Playwright 兜底（需要 Chromium）
- 如果只使用 `--no-fetch`（不抓正文），可以不安装 Chromium

国内用户安装时自动使用镜像源加速。

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | - | 搜索关键词（必填） |
| `--max` | integer | 10 | 最大结果数（1-30） |
| `--region` | string | auto | 区域：auto/cn/intl |
| `--fetch` | integer | 3 | 抓取前N条正文（0=不抓） |
| `--max-len` | integer | 6000 | 单页最大字符数 |
| `--no-fetch` | flag | - | 禁用正文抓取 |
| `--filter` | flag | - | 过滤低质量域名 |
| `--no-rewrite` | flag | - | 跳过 Query 改写 |

## 性能优化

- 复用浏览器守护进程（提速约70%）
- 国内/海外引擎智能选择
- HTTP 优先，Playwright 兜底
- 并行抓取多个 URL

## 已知限制

- **Bing 即时答案卡片**（天气、计算器）不返回网页链接，会触发补词重试
- **DDG 国内访问**：DuckDuckGo 在国内被墙，国内策略不使用 DDG 主引擎
- **JS 渲染页面**：部分需要 JS 渲染的页面，HTTP 抓取失败时自动用 Playwright headed 重试
- **代理环境**：出口 IP 走代理可能影响区域检测，可手动指定 `--region=cn/intl`

## 技术架构

```
区域检测（三轮并行探测，3秒超时）
  ↓
Query 改写（意图识别规则，可选）
  ↓
搜索引擎（纯 HTTP，无浏览器）
  - 国内: Bing HTML (cn.bing.com)
  - 海外: DDG HTML (html.duckduckgo.com)
  ↓
去重（域名+路径主干） + 域名过滤（可选）
  ↓
正文抓取（默认前3条）
  - 第1层: HTTP + cheerio（秒出，JSON-LD/Next.js 数据提取）
  - 第2层: Playwright headed 兜底（处理 JS 渲染页面）
  ↓
返回 JSON 结果（title, url, snippet, content）
```

**性能优化**：
- 搜索阶段无浏览器启动，响应时间 < 3 秒
- 正文抓取并行执行，HTTP 优先保证速度
- 复用浏览器守护进程（如果启用），提速约 70%

## 与其他搜索工具的对比

| 特性 | smart-web-search | free-web-search-js | free-web-search (Python) |
|------|------------------|--------------------|--------------------|
| 运行时 | Node.js | Node.js | Python 3 |
| 搜索架构 | 纯 HTTP | Playwright headless | Playwright headless |
| 区域检测 | ✅ 三轮并行 | ✅ 三轮并行 | ❌ 固定国内 |
| Query 改写 | ✅ 7条规则 | ❌ 无 | ✅ 7条规则 |
| 域名过滤 | ✅ 可选 | ❌ 无 | ✅ 可选 |
| 正文抓取 | ✅ HTTP → PW 两层 | ✅ HTTP → PW 两层 | ❌ 单层 PW |
| headless 问题 | ✅ 无（搜索用 HTTP） | ⚠️ 有（Bing 可能检测） | ⚠️ 有 |
| 速度 | ⚡ 极快（<3s） | 🟡 慢（需启动浏览器） | 🟡 慢 |

**推荐使用场景**：
- **本工具 (smart-web-search)**: 需要快速稳定搜索，国内外环境都适用，OpenClaw 社区推荐
- **free-web-search-js**: 已在项目中使用且稳定运行
- **free-web-search (Python)**: Python 技术栈，无 Node.js 环境

**与 Claude Code 内置 WebFetch 的关系**：
- 本工具侧重 **搜索 + 批量抓取**，适合"查资料、找教程、搜新闻"场景
- WebFetch 侧重 **单 URL 精确抓取**，适合"读取已知网页内容"场景
- 两者互补，可配合使用

## 验证环境

```bash
cd smart-web-search
node scripts/search.js "测试搜索" --max=2 --no-fetch
```

成功返回 JSON 数组即可。
