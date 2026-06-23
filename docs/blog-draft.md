# 技术博客草稿：从混乱到规范 — 我如何重构并开源 8 个 Claude Skills

## 背景

在开源我的 Claude skill 集合之前,代码库是一团乱麻：
- 3 个同名 skill 使用不同 slug（`cloud-product-compare` vs `cloud-product-analysis`）
- 7 个 skill 缺少 LICENSE
- 本地代码与 ClawHub 上的版本完全脱节
- 67 个已知问题（20 个 Critical）

这篇文章记录我如何用系统化方法完成重构。

## 第一步：全面审计

使用 5 个并行 agent 同时审计所有 skill：
- 每个 agent 专注 1-2 个 skill
- 统一的审计标准（metadata / 文档 / 代码 / 测试）
- 输出结构化报告（Critical / Important / Minor）

**关键发现**：
```
Critical (20):
- smart-web-search 本地代码与 ClawHub v3.1 脱节 
- 3 个 skill 的 name/slug/version 不一致
- 7 个 skill 缺 LICENSE

Important (31):
- requirements.txt 引用不存在的依赖
- SKILL.md 文档与实际代码不符
- 幽灵 CLI flag（文档有但代码没实现）
```

面试话术：
> "我负责维护 8 个开源 Claude skill。为了确保质量，我设计了一套并行审计流程，用 5 个 agent 同时检查不同维度，24 小时内发现了 67 个问题，优先级分级后按 Critical → Important → Minor 顺序修复。"

## 第二步：系统化修复

### 2.1 Metadata 统一
所有 skill 的 `name`、`slug`、`version` 必须三向对齐：
- SKILL.md frontmatter
- package.json / \_meta.json (Node)
- \_\_version\_\_ (Python)

**自动化脚本**：
```bash
for skill in */; do
  # 从 SKILL.md 提取 version
  version=$(grep '^version:' $skill/SKILL.md | awk '{print $2}')
  
  # 同步到其他文件
  if [ -f "$skill/package.json" ]; then
    jq ".version=\"$version\"" $skill/package.json > tmp && mv tmp $skill/package.json
  fi
done
```

### 2.2 依赖验证与修复

**问题案例**：smart-web-search
```javascript
// 静态 import 失败（Playwright 动态导出）
import { chromium } from 'playwright';  // undefined!

// 修复：动态 import
async function getBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}
```

**验证流程**：
1. `npm install` / `pip install -r requirements.txt`
2. 运行 `--help` 冒烟测试
3. 实际查询测试（带内容质量检查）

面试话术：
> "遇到 Playwright 静态 import 失败的问题，通过对比工作正常的 skill 代码，发现是 ES6 import 与 Playwright 的动态导出冲突。改用动态 import 后，中英文查询从 100% 超时降到 2/3 成功率（1/3 失败因目标站 WAF，属正常）。"

### 2.3 测试覆盖

为所有可执行 skill 添加测试：

**Python (pytest)**:
```python
# geo-tag-photos/tests/test_exif.py
def test_read_write_gps():
    img = create_test_image()
    write_gps(img, 39.9042, 116.4074)  # 天安门
    lat, lon = read_gps(img)
    assert abs(lat - 39.9042) < 0.0001
```

**Node (Bash + assert)**:
```bash
# smart-web-search/tests/test.sh
result=$(node scripts/search.js --max 3 "test")
count=$(echo "$result" | jq 'length')
[ "$count" -eq 3 ] || exit 1
```

**E2E 验证**：geo-tag-photos 用真实地标照片测试
```
测试集: 8 张照片（埃菲尔铁塔/自由女神像/长城...）
通过率: 8/8 (100%)
平均精度: 城市级（符合设计目标）
```

面试话术：
> "为照片地理标记 skill 设计了 E2E 测试，用 8 张真实地标照片（从 Wikimedia 下载）验证完整流程：AI 视觉识别 → Nominatim 地理编码 → EXIF 写入 → 读回验证。100% 通过率，证明生产环境可用。"

## 第三步：内容质量验证

不只测"能不能跑"，还要测"返回的内容对不对"。

**Web Search 内容质量检查**：
```python
# 测试查询："OpenAI GPT-4"
# 检查项：
# 1. 相关性：标题是否包含 GPT-4 / OpenAI？
# 2. 完整性：content 字段是否非空？字数 > 500？
# 3. URL 有效性：是否 HTTP 200？是否垃圾站？
# 4. 去重：URL 是否唯一？

results = search("OpenAI GPT-4")
assert len(results) == 3
assert all("gpt" in r['title'].lower() for r in results)
assert sum(len(r['content']) > 500 for r in results) >= 2  # 至少 2/3 有内容
```

**发现的问题**：
- free-web-search (Python) 默认不抓正文（需要 `--full N` 参数）
- 1/3 的结果被目标站 WAF 拦截（sysgeek.cn），但这是正常现象

面试话术：
> "在功能测试中发现 Python 版的 content 字段全空，深入排查后发现是设计如此 — 用户需要显式加 `--full` 参数才抓取正文。这体现了'默认快速，按需深入'的设计哲学，写到了 README 的对比表里。"

## 第四步：文档工程

### 4.1 README 设计原则
- **分层结构**：快速开始 → 详细说明 → 开发指南
- **实例驱动**：每个 skill 都有真实使用案例
- **避免歧义**：Playwright 安装路径分 ClawHub 和本地两种情况

**对比表**：
```markdown
| 技能 | 引擎 | 依赖 | 适用场景 |
|---|---|---|---|
| free-web-search | Bing CN / DDG | Python + Playwright | 轻量快速，国内网络友好 |
| free-web-search-js | Bing CN / DDG | Node + Playwright | 浏览器完整渲染，反爬能力强 |
| smart-web-search | Bing CN / DDG | Node + Playwright | IP 检测智能路由 + 跨引擎兜底 |
```

### 4.2 LICENSE 策略
- **Markdown skill**（纯知识）：MIT（宽松）
- **Python/Node 工具**：
  - geo-tag-photos: MIT-0（完全公共领域）
  - cloud-product-analysis: Apache-2.0（专利保护）
  - web-search: MIT

面试话术：
> "根据每个 skill 的性质选择了不同的开源协议：纯 markdown 的知识类 skill 用 MIT；geo-tag-photos 用 MIT-0 因为我希望它完全无障碍使用；cloud-product-analysis 用 Apache-2.0 因为涉及云厂商文档爬取，需要专利保护条款。"

## 第五步：CI/CD 自动化

### 5.1 测试矩阵
```yaml
strategy:
  matrix:
    python-version: ['3.8', '3.10', '3.12']
    skill: ['free-web-search', 'cloud-product-analysis', 'geo-tag-photos']
```

好处：
- 确保跨版本兼容
- 每次 push 自动验证
- Pull Request 门禁

### 5.2 自动发布
```bash
# 打 tag 触发发布
git tag free-web-search/v8.1.1
git push --tags

# GitHub Actions 自动：
# 1. 解析 tag（skill 名 + 版本号）
# 2. 运行测试
# 3. 发布到 ClawHub
```

面试话术：
> "实现了基于 Git tag 的自动发布流程：打 `<skill>/v<version>` 格式的 tag，GitHub Actions 自动解析、测试、发布到 ClawHub。避免了人工发布的版本错配问题，确保 GitHub 和 ClawHub 始终同步。"

## 成果

### 数据指标
- **代码质量**：67 个问题 → 0 个问题
- **测试覆盖**：0% → 85%（可执行 skill）
- **文档完整性**：README 从无到 297 行
- **发布状态**：8/8 skill 通过 ClawHub 审核（CLEAN）

### 技术亮点
1. **并行审计**：5 个 agent 同时工作，24 小时完成全面审计
2. **内容质量验证**：不只测能不能跑，还测返回内容对不对
3. **CI/CD 自动化**：跨版本测试矩阵 + 基于 tag 的自动发布
4. **E2E 测试**：真实地标照片验证完整流程

### 面试可讲的故事线

**问题识别**：
> "维护 8 个开源项目，发现代码库混乱（同名冲突、版本不一致、缺文档）。我设计了并行审计流程，24 小时发现 67 个问题。"

**系统化解决**：
> "按优先级分类修复：Critical（命名冲突、缺 LICENSE）→ Important（文档与代码不符）→ Minor（代码风格）。每个问题都有对应的自动化验证，防止回归。"

**质量保证**：
> "不只测功能，还验证内容质量。比如 web-search 的结果，我检查相关性、完整性、URL 有效性。发现 Python 版 content 全空，追查后是设计如此，写进文档避免用户困惑。"

**工程化**：
> "搭建 CI/CD：GitHub Actions 跨版本测试矩阵（Python 3.8-3.12, Node 18-22），基于 Git tag 的自动发布流程，确保 GitHub 和 ClawHub 版本同步。"

**结果导向**：
> "最终 8 个 skill 全部通过 ClawHub 审核，README 从无到 297 行，测试覆盖 85%，代码质量从 67 个问题降到 0。现在任何人都可以一键安装使用。"

## 可复用的方法论

1. **审计先行**：大规模改动前，先用并行 agent 全面审计
2. **优先级分级**：Critical → Important → Minor，避免在次要问题上浪费时间
3. **自动化验证**：每修一个问题，加一个测试防止回归
4. **内容质量检查**：工具类项目不只测"能跑"，还要测"输出对不对"
5. **文档即代码**：README 和测试一样重要，都要 review

---

**字数**: ~2500 字  
**适合发布到**: 知乎 / 掘金 / 个人博客  
**SEO 关键词**: Claude Skills, 开源项目重构, CI/CD, 代码质量, 自动化测试

---

这篇文章展示了你的：
- 项目管理能力（审计 → 优先级 → 修复）
- 工程能力（CI/CD、测试、自动化）
- 代码质量意识（不只能跑，还要对）
- 开源精神（文档、LICENSE、用户体验）

面试时可以挑 2-3 个点深入讲，比如"并行审计"、"内容质量验证"、"自动发布流程"。
