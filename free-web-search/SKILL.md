---
name: free-web-search
description: 基于 Bing 国内版 / DuckDuckGo 的联网搜索工具，中文环境优化，可按需抓取目标网页正文，返回结构化结果。仅在用户明确请求联网搜索时调用。
version: 8.0.0
author: free-web-search
license: MIT
trigger_keywords:
  - free-web-search
  - 联网搜索
  - 网页搜索
  - web search
tools:
  - name: web_search
    description: 联网搜索并返回结构化结果，中文环境优化，可选抓取网页正文（默认不抓取）
    script: scripts/web_search.py
    parameters:
      query:
        type: string
        description: 【必填】搜索关键词/短句，简洁精准（2-5 个核心词），禁止长句/反问句
        required: true
      max:
        type: integer
        description: 最大返回的搜索结果条数，默认 10，最大 20
        required: false
      full:
        type: integer
        description: 抓取前 N 条结果的网页全文内容，默认 0（不抓取），最大 5
        required: false
      engine:
        type: string
        description: 搜索引擎选择，bing/duckduckgo/auto（默认 bing）
        required: false
      filter:
        type: boolean
        description: 过滤低质量域名（如知乎、百度知道），默认 false（不过滤）
        required: false
---

# free-web-search 联网搜索工具

基于 Playwright 的 Bing 国内版 / DuckDuckGo 搜索工具。专注于**搜索 + 可选正文抓取**两件事，无副作用。

## 触发方式

仅在用户**明确请求联网搜索**时调用，例如：

- "用 free-web-search 查一下 Python 异步教程"
- "联网搜索 2026 年中国大型邮轮"
- "web search: latest LLM benchmarks"

trigger_keywords 已经收窄到只识别 `free-web-search`、`联网搜索`、`网页搜索`、`web search`，不会因为消息里出现"新闻"、"最新消息"这些常见词就把对话内容发到外部搜索引擎。

## 核心能力

- **中文环境优化**：默认 `mkt=zh-CN`，结果以中文为主
- **可选全文抓取**：通过 `--full=N` 抓取前 N 条结果正文（默认 0 不抓取）
- **质量评分**：低质量域名命中、单域名集中时自动重试
- **意图改写**：搜索质量差时按预定义规则改写 query（可用 `--no-rewrite` 禁用）
- **Headless 浏览器**：服务器/容器可用，仅开 `--no-sandbox`、`--disable-gpu`、`--disable-dev-shm-usage` 三个标准稳定性参数

## 安装

**所有依赖必须在使用前手动安装。脚本运行时不会自动安装任何 npm/pip 包，也不会修改宿主环境。**

### 前置依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| Python 3.8+ | 运行时 | — |
| playwright | 浏览器自动化 | `pip install playwright` |
| Chromium | Playwright 浏览器引擎 | `playwright install chromium`（约 150 MB） |

### 一键安装

```bash
# Linux / macOS
bash scripts/setup.sh

# Windows
powershell -File scripts/setup.ps1
```

### 手动安装

```bash
pip install playwright
playwright install chromium
```

## 使用示例

```bash
# 基础搜索（不抓正文）
python scripts/web_search.py "Python 异步编程 最佳实践 2026" --max=10

# 搜索 + 抓前 3 条全文
python scripts/web_search.py "中国大型邮轮 花城号 出坞" --full=3

# auto 模式：Bing 结果不足时切换 DuckDuckGo
python scripts/web_search.py "技术教程" --engine=auto

# 过滤知乎/百度知道等低质量域名
python scripts/web_search.py "某话题" --filter

# 禁用 query 改写（调试用）
python scripts/web_search.py "今日金价" --no-rewrite
```

## 搜索 Query 优化建议

搜索效果取决于 Query 是否合理：

1. **简洁精准**：2-5 个核心词组合，避免长句、反问句
2. **限定明确**：需要时效性/地区内容时加上对应限定词
3. **格式正确**：中文关键词 + 数字/英文限定词

| 场景 | 推荐 | 不推荐 |
|---|---|---|
| 时效新闻 | `2026年04月 美伊局势` | `最近美伊之间发生了什么` |
| 技术教程 | `Python 异步编程 2026` | `我想学 Python 异步编程` |
| 本地内容 | `广东东莞 今日天气` | `东莞今天天气怎么样啊` |
| 官方信息 | `华为云 ModelArts 文档` | `华为云那个 ModelArts 怎么看` |

## 参数说明

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `query` | 字符串 | — | 必填 | 搜索关键词 |
| `--max` | 整数 | 10 | 1-20 | 最多返回条数 |
| `--full` | 整数 | 0 | 0-5 | 抓取前 N 条全文 |
| `--engine` | 字符串 | bing | bing/duckduckgo/auto | 搜索引擎 |
| `--filter` | 布尔 | false | — | 过滤低质量域名 |
| `--no-rewrite` | 布尔 | false | — | 禁用 query 改写 |

## 隐私与网络说明

启用此工具会产生以下出站请求，使用前请确认你的环境允许：

| 目的 | 端点 | 数据 |
|---|---|---|
| Bing 搜索（默认引擎） | `cn.bing.com` | 你的 query 文本、IP、UA |
| DuckDuckGo 搜索（备用） | `duckduckgo.com` | 同上 |
| 抓取目标页（仅当 `--full > 0`） | 各搜索结果对应的站点 | 你的 IP、UA、Referer |

工具本身：

- 不收集 telemetry、不写日志到第三方
- 不在运行时安装 pip 包、不修改宿主目录之外的文件
- 浏览器 cookie 仅在当前 Playwright 上下文内使用，进程退出即销毁

如果你不希望抓取目标页，把 `--full` 留在默认值 `0` 即可，工具只会访问搜索引擎。

## 常见问题

### 搜索返回空结果
- 检查网络（Bing 国内版偶发限流，工具已内置 3s 节流和指数退避）
- 试 `--engine=duckduckgo`（前提是网络可达）
- 检查 query 是否过于冗长

### 浏览器启动失败
脚本不会自动安装。手动跑：
```bash
pip install playwright
playwright install chromium
```

### 全文抓取失败
- 部分站点 JS 渲染较重或返回非 HTML，工具不会做特殊处理
- 黑名单/低质量域名（百度知道、知乎等）在 `--filter` 启用时跳过

### 单域名集中
- 工具自动检测并打印 `[WARN] 单域名集中: xxx`
- 触发时会自动用 `-site:xxx` 排除该域名重试一次（最多 2 轮）

## 已知限制

- **VPN/代理**：可能影响 Bing 国内版的可达性
- **headless**：默认 `headless=True`，无 GUI 依赖
- **DDG 国内不可达**：DuckDuckGo 在中国大陆需要科学上网，超时单次 10s 快速失败
- **抓取上限**：`--full` 最多 5 条，单页正文截断到 8000 字
