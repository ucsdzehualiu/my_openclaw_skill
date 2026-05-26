---
name: free-web-search-js
description: Playwright/HTTP 联网搜索与网页正文抓取，零 API Key。用于实时搜索、查资料、新闻、教程、网页内容读取；支持国内 Bing、海外 DDG、自动抓取正文。
version: 28.0.0
trigger_keywords:
  - 搜索
  - 查一下
  - 找一下
  - 最新消息
  - 新闻
  - 教程
  - 是什么
  - search
  - find
tools:
  - name: search
    description: 搜索+自动抓取，国内Bing Playwright，海外DDG HTTP
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
        description: "区域: auto/cn/intl，默认auto按IP检测"
        required: false
  - name: fetch
    description: 给定URL抓取正文，HTTP优先失败自动headed兜底
    script: scripts/fetch.js
    parameters:
      urls:
        type: string
        description: "要抓取的URL，多个用空格分隔"
        required: true
      max-len:
        type: integer
        description: "单页最大字符数，默认12000"
        required: false
---

# free-web-search-js

一步式：**search** → 搜索 → 自动抓内容 → 返回。优先 HTTP，必要时 Playwright 兜底；在无桌面/服务器环境默认 headless，避免 GUI 依赖。

## 架构

```
国内：
  Playwright headless 打开 Bing → 首页拿 cookie → 搜索框提交
  → 结果为空时自动兜底 DDG HTTP
  → 自动抓取 top 3 页面内容

海外：
  纯 HTTP → DDG HTML 解析
  → fetch 失败时用 Playwright request 兜底
  → 自动抓取 top 3 页面内容
```

## 搜索引擎

| 引擎 | 协议 | 区域 | 说明 |
|------|------|------|------|
| Bing CN | Playwright 搜索框提交 | 国内 | 先访问首页拿 cookie，再搜索框输入提交 |
| 搜狗 | 纯 HTTP | 国内 | `--engine=sogou` 可选，⚠ 无 cookie 易被反爬拦截，结果不稳定 |
| DDG HTML Lite | 纯 HTTP | 海外 | html.duckduckgo.com |

### 策略

| 区域 | 搜索 | 抓取 |
|------|------|------|
| 国内 | Bing CN (Playwright headless)，空结果兜底 DDG | 自动抓前 3 条 |
| 海外 | DDG HTML，fetch 失败兜底 Playwright request；DDG 为空再兜底 Bing | 自动抓前 3 条 |

### IP 怎么判断

每次搜索时自动检测，三轮探测并行，谁先成功用谁：

| 轮次 | 探测服务 | 逻辑 |
|------|---------|------|
| 第1轮 | `myip.ipip.net` / `cip.cc` | 国内可达优先 |
| 第2轮 | `ipinfo.io` / `ipapi.co` | 国际探测 |
| 第3轮 | 试连 `cn.bing.com` | 能通大概率国内 |
| 兜底 | — | 默认国内 |

出口 IP 走代理时可能误判，用 `--region=cn` 或 `--region=intl` 手动指定。

## 去重

智能去重：域名 + 路径主干（忽略 www/m 子域、tracking 参数、尾部斜杠、.html 后缀）。

Bing 跳转 URL（`bing.com/ck/`）自动解码为直链。

## 抓取模式

搜索后自动抓取 top N 条 URL 内容（默认 3 条）。

| 层级 | 方式 | 速度 | 说明 |
|------|------|------|------|
| 第1层 | 轻量 HTTP + cheerio | ⚡ 秒出 | 不启动浏览器 |
| 第2层 | Playwright headed | 🟡 慢 | 完整浏览器，支持 JS 渲染 |

第1层增强：
- **JSON API 响应**：自动检测 Content-Type 并提取结构化内容
- **JSON-LD**：提取 `<script type="application/ld+json">` 中的 articleBody/description
- **__NEXT_DATA__**：提取 Next.js 嵌入数据
- **meta 标签**：og:description / description 兜底
- **GBK 编码**：自动检测并转换

## 可靠性设计

- `SKILL.md` 必须以 YAML frontmatter 开头；不要在 `---` 前加标题，否则 OpenClaw 可能无法发现技能。
- `scripts/check-env.js` 检查的是**可执行浏览器文件**，不是只看 `~/.cache/ms-playwright` 目录，避免“缓存目录存在但浏览器缺文件”的假阳性。
- Playwright 默认 `headless: true`，并带 `--no-sandbox` / `--disable-dev-shm-usage`，适配 Linux 服务器、Docker、无桌面环境。
- 如果 Playwright 新版本要求 `chrome-headless-shell` 但下载慢/中断，脚本会优先复用已存在的 Chromium 可执行文件；也可设置 `CHROMIUM_EXECUTABLE_PATH=/path/to/chrome`。
- DDG 的 Node `fetch` 在部分网络会 `fetch failed`，已内置 Playwright request 兜底；如果仍为空，会再用 Bing Playwright 兜底，保证海外策略在国内网络也尽量有结果。

## 安装

**前置依赖（全部必装）：**

| 依赖 | 说明 | 大小/耗时 |
|------|------|----------|
| Node.js >= 18 | 运行时 | — |
| cheerio | HTML 解析 | 小，秒装 |
| commander | CLI 参数解析 | 小，秒装 |
| iconv-lite | GBK 编码转换 | 小，秒装 |
| playwright | 浏览器自动化（Bing 搜索 + 抓取兜底） | ~50MB |
| Chromium | Playwright 专用浏览器 | **~150MB，需几分钟下载** |

安装脚本自动检测网络区域，国内使用镜像源加速：

```bash
# Windows
powershell -File scripts/setup.ps1

# Linux/macOS
bash scripts/setup.sh
```

国内镜像：
- npm: `https://registry.npmmirror.com`
- Playwright/Chromium: `https://npmmirror.com/mirrors/playwright`

手动安装：
```bash
cd skills/free-web-search-js
npm install
npx playwright install chromium    # ~150MB，需几分钟
# 如果下载慢/中断，可重试，或设置国内镜像：
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright npx playwright install chromium
# 如果系统已有 Chrome/Chromium：
export CHROMIUM_EXECUTABLE_PATH=/path/to/chrome
```

验证环境：`node scripts/check-env.js`

卸载：`node scripts/uninstall.js`

## 验证与故障排查

```bash
cd skills/free-web-search-js
node scripts/check-env.js
node scripts/search.js "OpenClaw" --max 2 --region cn --fetch 0
node scripts/search.js "OpenClaw" --max 2 --region intl --fetch 0
```

常见问题：

- `node_modules not found`：运行 `npm install`。
- `Executable doesn't exist ... chrome-headless-shell`：运行 `bash scripts/setup.sh`，或设置 `CHROMIUM_EXECUTABLE_PATH` 指向已有 Chrome/Chromium。
- `browserType.launch ... closed`：通常是无桌面/沙箱/缺浏览器文件；当前脚本默认 headless + no-sandbox，如仍失败，先跑 `node scripts/check-env.js`。
- 搜索 0 条：换 `--region=cn`/`--region=intl`，或 `--fetch 0` 先只测搜索。

## 性能优化：浏览器守护进程

搜索和抓取可复用浏览器守护进程，**提速约 70%**：

```bash
node scripts/browser-daemon.js &       # 启动
node scripts/browser-daemon.js --status # 状态
node scripts/browser-daemon.js --stop   # 停止
```

守护进程空闲 10 分钟自动退出。

## 用法

```bash
# 搜索（搜 + 自动抓前3条内容）
node scripts/search.js "白银价格"
node scripts/search.js "how to deploy docker" --max=5
node scripts/search.js "xxx" --region=cn
node scripts/search.js "xxx" --fetch=5          # 抓前5条
node scripts/search.js "xxx" --no-fetch         # 只搜不抓

# 单独抓取（给定 URL）
node scripts/fetch.js "https://example.com/page1" "https://example.com/page2"
```

## 已知限制

- **国内首次搜索较慢**：需启动 Chromium（3~6s），后续复用更快
- **Bing CN 即时答案不返回**：天气、计算器等即时卡片不走 `li.b_algo`，搜索结果为 0
- **搜狗 HTTP 不稳定**：无 cookie 纯请求易被反爬拦截，结果可能为空（`--engine=sogou` 慎用）
- **部分站点 HTTP 抓不到**：需要 JS 渲染的页面——HTTP 失败会自动 headed 重试
- **部分站点海外不可达**：国内专属站点从海外访问可能超时
- **代理干扰 IP 检测**：出口 IP 走代理时可能误判区域，用 `--region=cn/intl` 手动指定
- **海外引擎国内不可达**：DDG 在国内被墙，国内策略不使用
