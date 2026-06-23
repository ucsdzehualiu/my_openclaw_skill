# My OpenClaw Skills

精选 Claude 技能集合，涵盖 Web 搜索、金融分析、提示词优化、云产品对比、照片地理标记等实用场景。全部开源，即装即用。

[![CI Tests](https://github.com/ucsdzehualiu/my_openclaw_skill/actions/workflows/test.yml/badge.svg)](https://github.com/ucsdzehualiu/my_openclaw_skill/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue.svg)](LICENSE)
[![ClawHub](https://img.shields.io/badge/ClawHub-Published-green.svg)](https://clawhub.com)
[![Skills](https://img.shields.io/badge/skills-8-brightgreen.svg)](#-技能列表)

---

## 📦 技能列表

| 技能 | 版本 | 描述 | 类型 |
|---|---|---|---|
| [**prompt-optimizer-cn**](./prompt-optimizer-cn) | 2.1.0 | 提示词优化工具 — 检测原提示词缺失要素（角色/步骤/格式/约束），智能补全后输出清晰易懂的优化版 | Markdown |
| [**free-finance-analysis**](./free-finance-analysis) | 1.1.0 | 股票、ETF、指数、财报分析 — 基于公开数据源，综合行情/技术指标/市场情绪，附风险提示与免责声明 | Markdown |
| [**free-web-search**](./free-web-search) | 8.1.0 | 轻量级 Python Web 搜索 — 基于 Playwright，IP 智能路由（国内 Bing CN / 国外 DDG），无 API key | Python |
| [**free-web-search-js**](./free-web-search-js) | 29.1.0 | Node/Playwright Web 搜索 — 浏览器渲染反反爬，纯搜索无改写过滤，噪音交给 AI 处理 | Node.js |
| [**smart-web-search**](./smart-web-search) | 3.2.2 | 智能 Web 搜索 — IP 检测 + 跨引擎兜底（Bing CN ↔ DDG），优雅降级容错 | Node.js |
| [**hardworker**](./hardworker) | 1.1.0 | Striver 模式 — 当任务失败、停滞或用户受挫时，强制使用突破方法持续解决问题 | Markdown |
| [**cloud-product-analysis**](./cloud-product-analysis) | 1.1.0 | 云产品技术文档对比 — 自动抓取阿里云、华为云、AWS、腾讯云官方文档，生成结构化对比 | Python |
| [**geo-tag-photos**](./geo-tag-photos) | 1.0.1 | 照片地理标记恢复 — AI 视觉识别地标，Nominatim 地理编码，写回 GPS EXIF，默认干运行 + 强制备份 | Python |

---

## 🚀 快速开始

### 前提条件

- **Claude Code CLI** 或 **其他支持 ClawHub 的 Claude 客户端**
- **Python 3.8+**（Python 技能）
- **Node.js 18+**（Node 技能）

### 安装技能

```bash
# 从 ClawHub 安装（推荐）
clawhub install prompt-optimizer-cn@latest
clawhub install free-web-search@latest
clawhub install geo-tag-photos@latest
clawhub install @ucsdzehualiu/smart-web-search@latest  # 注意：需要 @owner/ 前缀（有同名 skill）
# ... 其他技能同理

# 或从本地安装（开发/测试）
git clone https://github.com/ucsdzehualiu/my_openclaw_skill.git
cd my_openclaw_skill
clawhub install ./prompt-optimizer-cn
```

### 使用示例

安装后，在 Claude 会话中直接用自然语言触发：

```
# prompt-optimizer-cn
"帮我优化一下这个提示词：写一份会议纪要"

# free-finance-analysis
"特斯拉股票现在怎么样？TSLA"

# free-web-search
"搜索一下：深圳明天天气"

# geo-tag-photos
"用 geo-tag-photos 给我这个文件夹的照片加 GPS"
```

---

## 📚 技能详细说明

### 1. prompt-optimizer-cn

**适用场景**：提示词不够具体、AI 理解偏差、想让输出更符合预期

**工作流程**（RTCF 框架）：
1. 诊断原提示词缺失的要素（角色 Role / 任务 Task / 上下文 Context / 输出格式 Format）
2. 智能补全
3. 输出优化后的清晰版本（代码块包裹，方便复制）

**触发词**：优化提示词 / 改进 prompt / 优化一下 / optimize prompt

---

### 2. free-finance-analysis

**适用场景**：股票估值、财报分析、技术指标查询、市场情绪判断

**数据源**：
- 美股：CNBC、CurrentMarketValuation、VIX
- A 股 / 港股：雪球、东方财富（部分支持）
- 大宗商品：黄金、白银、原油

**风险提示**：
- ⚠️ 仅供参考，不构成投资建议
- 数据可能延迟或错误
- 用户自负风险，本技能不执行交易

---

### 3. free-web-search / free-web-search-js / smart-web-search

**三者区别**：

| 技能 | 引擎 | 依赖 | 适用场景 |
|---|---|---|---|
| free-web-search | Bing CN / DDG | Python + Playwright | 轻量快速，国内网络友好 |
| free-web-search-js | Bing CN / DDG | Node + Playwright | 浏览器完整渲染，反爬能力强 |
| smart-web-search | Bing CN / DDG | Node + Playwright | IP 检测智能路由 + 跨引擎兜底 |

**安装依赖**（Playwright 需手动设置）：

**方式一：从 ClawHub 安装后配置依赖**

```bash
# Claude Code 的 skill 默认安装在 ~/.claude/skills/ 下
# Python 版
cd ~/.claude/skills/@ucsdzehualiu/free-web-search/
pip install -r requirements.txt
python -m playwright install chromium

# Node 版
cd ~/.claude/skills/@ucsdzehualiu/free-web-search-js/  # 或 smart-web-search
npm install
npx playwright install chromium
```

**方式二：本地 git clone 后配置**

```bash
# 从项目根目录进入 skill 目录
git clone https://github.com/ucsdzehualiu/my_openclaw_skill.git
cd my_openclaw_skill

# Python 版
cd free-web-search/
pip install -r requirements.txt
python -m playwright install chromium

# Node 版
cd free-web-search-js/  # 或 smart-web-search/
npm install
npx playwright install chromium
```

---

### 4. hardworker

**适用场景**：任务失败、进展停滞、用户表达挫败感时自动触发

**核心方法**：
- 三个阶段：拆解（拆到能动手）→ 尝试（记录每次失败）→ 迭代（换条路再试）
- 八项注意：不放弃、不猜测、不跳步骤...
- 突破清单：换工具/换路径/降级需求/找替代...

**触发**：自动（当检测到失败、停滞、用户挫败情绪时）

---

### 5. cloud-product-analysis

**适用场景**：技术选型、学习云计算产品知识、快速对比不同云厂商能力

**支持的云厂商**：
- 阿里云（Aliyun）
- 华为云（Huawei）
- AWS
- 腾讯云（Tencent）

**支持的产品**（15 个）：
对象存储、CDN、数据库（RDS/PostgreSQL/Redis）、负载均衡、VPC、WAF、API 网关等

**使用方式**：

```bash
# 列出支持的产品
python scripts/cloud_doc_scraper.py --list

# 对比阿里云和 AWS 的对象存储
python scripts/cloud_doc_scraper.py \
  --products oss \
  --providers aliyun,aws \
  --output oss_comparison.md
```

---

### 6. geo-tag-photos

**适用场景**：老照片丢失了 GPS 信息，想通过 AI 视觉识别地标恢复位置

**工作流程**（5 阶段）：
1. **scan** — 读 EXIF，标记已有 GPS 的照片为 SKIP
2. **AI vision** — Claude 用 Read tool 查看每张图，识别地标并输出结构化 JSON
3. **geocode** — Nominatim API 将"地标+城市+国家"转为坐标（本地缓存）
4. **report** — 生成 CSV 报告供人工审核
5. **write** — 默认 dry-run，需 `--write` + `--backup-dir` 才真正写入

**安全门控**：
- 仅支持 JPG/JPEG
- 强制备份（`--backup-dir` 必须指定且不能存在或为空）
- 批量上限 500 张/次
- Nominatim 自动限速 ≥1.1s/请求

**伦理边界**：
- ⚠️ 仅用于自己的照片
- 禁止用于追踪他人、监控、去匿名化、法律取证

---

## 🛠️ 开发 & 贡献

### 项目结构

```
my_openclaw_skill/
├── prompt-optimizer-cn/       # 纯 markdown 技能
│   ├── SKILL.md
│   └── LICENSE
├── free-web-search/           # Python 技能
│   ├── SKILL.md
│   ├── scripts/
│   │   └── web_search.py
│   └── requirements.txt
├── geo-tag-photos/            # Python 技能（带测试）
│   ├── SKILL.md
│   ├── scripts/
│   │   └── photo_geolocator.py
│   ├── tests/
│   └── e2e/
└── ... 其他技能
```

### 测试

```bash
# Python 技能
cd <skill>/
pip install -r requirements.txt
pytest tests/ -v

# Node 技能
cd <skill>/
npm install
npm test  # 或 bash tests/test.sh
```

### 发布到 ClawHub

```bash
clawhub publish ./<skill>/ --version x.y.z --tags latest
```

---

## 📄 许可证

- **Markdown 技能**（prompt-optimizer-cn, free-finance-analysis, hardworker）：MIT
- **Python/Node 技能**：
  - geo-tag-photos: MIT-0（完全公共领域）
  - cloud-product-analysis: Apache-2.0
  - free-web-search, free-web-search-js, smart-web-search: MIT

详见各技能目录下的 LICENSE 文件。

---

## 🤝 贡献指南

欢迎贡献！提交 PR 前请：

1. 确保所有测试通过
2. 遵循现有代码风格
3. 更新相关文档（SKILL.md / README.md）
4. 在 PR 描述中说明改动原因和测试结果

Bug 报告和功能建议请提交到 [Issues](https://github.com/ucsdzehualiu/my_openclaw_skill/issues)。

---

## 📧 联系方式

- **作者**: ucsdzehualiu
- **ClawHub**: [@ucsdzehualiu](https://clawhub.com/ucsdzehualiu)
- **GitHub**: [ucsdzehualiu/my_openclaw_skill](https://github.com/ucsdzehualiu/my_openclaw_skill)

---

## 🙏 致谢

- [Claude Code](https://claude.ai/code) — AI 开发环境
- [ClawHub](https://clawhub.com) — 技能分发平台
- [Playwright](https://playwright.dev) — Web 自动化框架
- [Nominatim](https://nominatim.org) — OpenStreetMap 地理编码 API

---

<p align="center">Made with ❤️ by ucsdzehualiu | Powered by Claude</p>
