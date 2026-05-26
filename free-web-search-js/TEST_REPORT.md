# free-web-search-js v24.0 测试报告

日期: 2026-04-24

## 搜索测试

| 查询 | 引擎 | 结果数 | 质量 | 问题 |
|------|------|--------|------|------|
| 今日金价 | Bing CN + 百度 | 15→5 | ⚠️ 中 | 混了百度经验教程，AI需自行筛选 |
| docker compose deploy production | Bing CN + 百度 | 13→5 | ⚠️ 差 | 全是Docker官网首页/下载页，没compose生产部署内容 |
| 俄乌冲突 2026年4月 | Bing CN + 百度 | 13→5 | ✅ 好 | 知乎讨论+snippet，1条噪音（俄的来源） |
| python asyncio tutorial | Bing CN + 百度 | 15→5 | ❌ 差 | 全是Python泛文，asyncio完全没命中 |
| 新能源汽车补贴政策 2026 | Bing CN + 百度 | 14→5 | ✅ 很好 | 搜狐/知乎/新浪/光明网/发改委，全精准 |
| openclaw AI assistant setup | Bing CN + 百度 | 15→5 | ✅ 好 | 官网/中文站/腾讯云/知乎全命中 |
| 霍尔木兹海峡 今日 | Bing CN + 百度 | 15→5 | ⚠️ 中 | 混了"霍尔效应"噪音，AI需自行筛 |

## Fetch测试

| URL | 模式 | 结果 | 问题 |
|-----|------|------|------|
| quote.cngold.org (金投网) | http-only | ⚠️ 结构拿到，价格全---- | JS动态加载，HTTP拿不到实时价格 |
| docs.docker.com | http-only | ❌ fetch failed | 国内不通 |
| docs.docker.com | headed | ✅ 完整内容 | Playwright兜底有效 |
| economy.gmw.cn (光明网) | http-only | ⚠️ 拿到侧边栏不是正文 | 正文选择器没命中 |

## 核心发现

1. **中文query效果好** — Bing CN + 百度对中文新闻/政策/时事类query效果很好
2. **英文query效果差** — Bing CN把英文技术词按中文分词切碎，返回泛泛结果
3. **海外引擎国内全挂** — DDG/Brave/秘迹从国内全部timeout/fetch failed
4. **JS动态内容HTTP拿不到** — 金投网等价格页面需要headed模式
5. **知乎403** — HTTP直接抓知乎被拒，需headed
6. **百度跳转URL解析** — 大部分能解析为直链，少数失败
7. **删掉改写/过滤后** — skill更纯粹，噪音交给AI处理，符合设计原则

## 待改进（不过度优化）

- 英文query可尝试给Bing CN加 `&setlang=en-US` 参数，可能改善英文结果质量
- fetch正文提取对部分站点命中率不够，但这是泛用难题，不宜针对特定站硬编码
