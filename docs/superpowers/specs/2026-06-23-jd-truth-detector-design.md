# jd-truth-detector — Design Spec

**Date:** 2026-06-23
**Author:** Claude (with user direction)
**Status:** Ready for implementation

## 1. Goal

A Claude skill that **reverse-engineers job descriptions** to surface hidden realities behind recruiter language. Four full-stack dimensions: jargon translation ("5 years" → actually 3), company culture inference (red flags, vibes), resume fit analysis (when user provides resume), and negotiation signal detection (salary wiggle room, equity water content).

Designed for **viral spread**: output is a shareable HTML report screenshot-friendly enough to trend on 掘金/知乎/V2EX with headlines like "我用 AI 拆穿了 1000 份 JD".

## 2. Non-goals

- Auto-applying to jobs. Read-only analysis.
- Salary/equity valuation in absolute numbers. We only flag *signals*, not estimates.
- Real-time scraping of every job site. Support 3 major sites (BOSS/拉勾/LinkedIn); text paste is the primary path.
- Tracking historical JDs or market trends. Single-shot analysis only (MVP).
- Interview coaching / offer negotiation tactics. Out of scope.
- Replacing human judgment. Output is diagnostic input for *your* decision.

## 3. Architecture

### 3.1 Directory layout

```
my_openclaw_skill/jd-truth-detector/
├── SKILL.md                    # Claude-facing entry point
├── README.md                   # Human-facing GitHub README
├── LICENSE                     # MIT
├── requirements.txt            # openai, pyyaml, jinja2, python-docx, pdfplumber, beautifulsoup4, httpx
├── config.example.yaml         # Sample config file
├── scripts/
│   ├── __init__.py
│   ├── input_parser.py         # Detect input type (text/url/file), fetch if URL, parse docx/pdf
│   ├── pre_scanner.py          # Rule-based stats (keyword counts, structure)
│   ├── llm_adapter.py          # OpenAI-compatible client (same as meeting-quality-scorer)
│   ├── analyzer.py             # 4 LLM calls: jargon / culture / resume_match / negotiation
│   ├── reporter.py             # Markdown + HTML rendering
│   └── jd_analyze.py           # CLI entry: ties input → pre-scan → analyze → report
├── templates/
│   ├── report.md.j2            # Markdown report template
│   └── report.html.j2          # HTML visualization (word cloud, radar chart, flag list)
├── tests/
│   ├── conftest.py             # Fixtures: stub LLM, sample JDs + resumes
│   ├── test_input_parser.py
│   ├── test_pre_scanner.py
│   ├── test_analyzer.py
│   ├── test_llm_adapter.py
│   └── test_e2e.py
└── fixtures/
    ├── jd_red_flag_factory.txt        # 血汗工厂型 JD（抗压/狼性/能加班）
    ├── jd_polished_startup.txt        # 包装精美初创型（改变世界/扁平化/early equity）
    ├── jd_clean_tech.txt              # 正经大厂型（技术栈具体/薪资明确/无加班语言）
    ├── jd_with_resume_match.txt       # 配合匹配简历
    ├── resume_match.md                # 高度匹配的简历
    ├── jd_with_resume_mismatch.txt    # 配合不匹配简历
    ├── resume_mismatch.md             # 明显不匹配的简历
    └── expected.json                  # 预期标记（哪些 fixture 应该有红旗）
```

### 3.2 Workflow

```
[ user provides JD text / URL / file ]
        │
        ▼
  ┌──────────────┐    If URL → scrape (BOSS/拉勾/LinkedIn)
  │  1. input    │    If file → parse (.txt/.md/.docx/.pdf)
  └──────────────┘    If text → pass through
        │
        ▼
  ┌──────────────┐    Keyword stats: 抗压/996/狼性/学习能力/...
  │  2. pre-scan │    Structure: # sections, tech stack present?, salary mentioned?
  └──────────────┘    Length: char count
        │
        ▼
  ┌──────────────┐    4 structured LLM calls (each returns JSON):
  │  3. analyze  │    - Jargon translation
  │              │    - Company culture inference
  │              │    - Resume match (if resume provided)
  │              │    - Negotiation signals
  └──────────────┘
        │
        ▼
  ┌──────────────┐    Markdown report (always)
  │  4. report   │    + HTML report (word cloud, radar, flag list)
  └──────────────┘
```

### 3.3 CLI surface

Single entry point: `scripts/jd_analyze.py`

```bash
# Paste text (primary path)
python scripts/jd_analyze.py \
  --jd-text "<paste JD here>" \
  --out-md report.md \
  --out-html report.html

# From file
python scripts/jd_analyze.py --jd-file jd.txt

# From URL (experimental)
python scripts/jd_analyze.py --jd-url "https://www.zhipin.com/job_detail/..." 

# With resume (full mode)
python scripts/jd_analyze.py --jd-file jd.txt --resume-file resume.md

# Resume from docx/pdf
python scripts/jd_analyze.py --jd-file jd.txt --resume-file resume.docx

# Override LLM via env
JTD_BASE_URL=http://localhost:11434/v1 \
JTD_API_KEY=ollama \
JTD_MODEL=qwen2.5:72b \
python scripts/jd_analyze.py --jd-text "..."
```

### 3.4 Four analysis dimensions

#### Dimension 1: Jargon translation (黑话翻译)

LLM prompt (input: JD text + pre-scan stats):
```
You are a job market analyst. The following JD contains recruiter jargon. For each vague/inflated requirement, output the *real* threshold:

JD excerpt: "5 年以上前端经验"
Real threshold: 3 years + one mid-sized project

JD: "精通 React/Vue"
Real: At least one framework used in production

Return JSON array:
[
  {"jd_text": "5 年以上前端经验", "real_requirement": "3 年 + 中型项目即可"},
  {"jd_text": "精通 React/Vue", "real_requirement": "至少一个框架写过生产项目"},
  ...
]
```

LLM returns structured JSON. We render this as a table in the report.

#### Dimension 2: Company culture inference (公司体感)

LLM prompt (input: JD text + pre-scan stats showing e.g. "抗压" appears 5 times):
```
Based on this JD's phrasing, infer company culture signals:

- Pace: (relaxed / normal / high-pressure)
- Work-life balance red flags: list occurrences of "抗压/加班/使命感/owner/拼搏"
- Technical maturity: does the JD list specific versions/tools or just buzzwords?
- Business clarity: is the product/team scope clear?

Return JSON:
{
  "pace": "high-pressure",
  "red_flags": ["抗压 x5", "使命感 x2"],
  "tech_maturity": "high — lists React 18, Webpack 5",
  "business_clarity": "medium — mentions '社交产品' but no specifics",
  "candidate_questions": ["问加班频率", "问 on-call 机制", "..."]
}
```

Report renders this with color-coded flags (🔴 red flags / 🟡 yellow flags / 🟢 green flags).

#### Dimension 3: Resume match (简历匹配, optional)

Only runs if user provides `--resume-file` or `--resume-text`.

LLM prompt (input: JD text + resume text):
```
Compare this JD to the candidate's resume. Output:

- Match score: 0-100
- Hard requirements met: list which JD requirements the resume satisfies
- Hard requirements unmet: list gaps (dealbreakers)
- Soft requirements met/unmet
- Recommendation: (strong fit / moderate fit / weak fit / dealbreaker gaps)

Return JSON:
{
  "match_score": 72,
  "hard_met": ["5 years exp", "React production use"],
  "hard_unmet": ["微信小程序经验 (JD required, resume has none)"],
  "soft_met": ["team lead experience"],
  "soft_unmet": ["cross-department collaboration not mentioned"],
  "recommendation": "moderate fit — address 小程序 gap in interview"
}
```

If no resume provided, this section shows `N/A` with a banner: *"要获得简历匹配分析,请用 --resume-file 提供简历"*.

#### Dimension 4: Negotiation signals (议价信息)

**Critical boundary**: We do NOT output "this job is worth ¥X-Y". We only identify *signals* exposed by the JD that affect negotiation leverage.

LLM prompt (input: JD text + pre-scan stats):
```
Analyze this JD for negotiation leverage signals. Do NOT estimate salary numbers. Instead:

- Salary range transparency: (explicit range / "面议" / not mentioned)
- Level ambiguity: does the JD specify 职级 (P6/T3/Senior/...)?
- Equity signals: does it mention specific equity %, or just "丰厚回报"?
- Urgency signals: "急招/立即到岗/HC 紧急" suggests more leverage
- Comp structure clarity: is bonus/equity/base split mentioned?

Return JSON:
{
  "salary_transparency": "面议 — high negotiation room",
  "level_specified": false,  # no 职级 → leverage
  "equity_water": "high — only says '丰厚期权', no %, likely noise",
  "urgency": false,
  "leverage_summary": "中等议价空间 — 薪资面议但无急招信号"
}
```

Report renders this as actionable insight (e.g. "该岗位薪资为'面议'且未标明职级 → 议价空间较大,建议先了解内部薪资带再报价").

### 3.5 Pre-scan (rule-based, no LLM)

`scripts/pre_scanner.py:scan(jd_text)` returns:

```python
{
  "red_flag_keywords": {
    "抗压": 5,    # count
    "狼性": 2,
    "996": 0,
    "加班": 3,
    "学习能力": 4,
    "使命感": 2,
    "owner": 1,
    ...
  },
  "structure": {
    "sections": 7,           # by headers
    "tech_stack_listed": True,
    "tech_stack_detail": "具体到版本号",  # or "只有buzzword"
    "salary_mentioned": False,
    "equity_mentioned": True,
    "level_specified": False
  },
  "length": 1832  # char count
}
```

This goes to all 4 LLM calls as context. The rule pass makes LLM analysis more grounded (e.g. LLM sees "抗压 appears 5 times" and can call that out explicitly).

### 3.6 URL scraping (experimental, best-effort)

`scripts/input_parser.py:fetch_url(url)`:

Supported sites (via `httpx` + `beautifulsoup4`):
1. **BOSS 直聘** (`zhipin.com`): selector `.job-sec .text` (common JD wrapper)
2. **拉勾** (`lagou.com`): selector `.job_detail`
3. **LinkedIn** (`linkedin.com/jobs`): selector `.description__text`

Each site has one hardcoded selector. If scraping fails (4xx/5xx/changed selector):
- Exit with error: *"URL 抓取失败 (站点可能反爬或改版),请复制 JD 文本后用 --jd-text 重新运行"*
- Log the failure reason to stderr for debugging

If user wants more sites: README documents "如何扩展:添加 selector 到 `input_parser.py:SITE_SELECTORS` dict,欢迎 PR".

### 3.7 LLM adapter (OpenAI-compatible)

Identical to meeting-quality-scorer:

```python
class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: int = 60): ...
    def chat(self, messages: list[dict], schema: dict | None = None) -> dict: ...
```

Works with: OpenAI, DeepSeek, Moonshot, 智谱 GLM, 通义, Ollama, vLLM.

Connection priority:
1. Explicit kwargs.
2. Environment vars: `JTD_BASE_URL`, `JTD_API_KEY`, `JTD_MODEL`.
3. Config file: `~/.config/jd-truth-detector/config.yaml` (or path from `--config`).
4. If none: hard exit.

### 3.8 Resume parsing

`scripts/input_parser.py:parse_resume(path_or_text)`:

- **Text / .txt / .md**: pass through
- **.docx**: `python-docx` to extract paragraphs
- **.pdf**: `pdfplumber` to extract text (with banner: *"PDF 解析可能丢失格式,效果不佳时请改用文本粘贴"*)
- **.doc** (old Word): not supported, exit with error

All resume parsers output plain text. If parsing fails (corrupted file / unsupported encoding): exit with hint.

## 4. Limits and boundaries

### 4.1 Capability boundaries

| Can do | Cannot do |
|---|---|
| Infer culture signals from JD phrasing | Know the company's actual culture (only JD text is input) |
| Detect equity water content *signals* | Estimate equity value in RMB |
| Identify negotiation leverage signals | Tell you what salary number to ask for |
| Match JD to resume structurally | Replace human judgment on "do I want this job?" |
| Scrape 3 major job sites (best-effort) | Work reliably on all sites forever (anti-scraping evolves) |
| Support English and 中文 JDs | Mixed-language JDs (e.g. half English half 中文) may confuse LLM |

### 4.2 Runtime hard limits

- **Max JD size**: 50,000 chars. Beyond this: exit with "JD 过长,请提取核心部分后重试".
- **Max resume size**: 20,000 chars.
- **LLM timeout**: 60 s per call. 4 calls = max 4 minutes end-to-end.
- **URL fetch timeout**: 15 s.
- **Required config**: must have `base_url + api_key + model` resolved. If unset: exit code 2.

### 4.3 Privacy / network

- **JD + resume content** sent **only** to user-configured LLM endpoint. No telemetry, no cloud upload.
- URL scraping: one HTTP GET to the job site, user-agent identifies this tool.
- HTML report: bundles Chart.js + wordcloud2.js via CDN. (Future: add `--offline` flag to inline JS.)
- Cache: none. Stateless single-shot.

### 4.4 Failure modes

| Situation | Behavior |
|---|---|---|
| JD < 200 chars | Exit 2: "JD 过短,无法分析" |
| URL scraping fails | Exit 1 with hint to use --jd-text |
| LLM API unreachable (timeout, 5xx after 3 retries) | Exit 1 with error, save pre-scan stats to `partial-report.md` |
| LLM returns malformed JSON | Retry once; if still bad, mark that dimension as "分析失败" in report |
| Resume file unreadable (corrupted docx/pdf) | Exit 1 with hint to use plain text |
| Config completely missing | Exit 2 with help text |

## 5. Dependencies

`requirements.txt`:
```
openai>=1.30.0
pyyaml>=6.0
jinja2>=3.1.0
python-docx>=1.1.0
pdfplumber>=0.11.0
beautifulsoup4>=4.12.0
httpx>=0.27.0
pytest>=8.0.0
```

Install size: ~50 MB (pdfplumber brings in Pillow).

## 6. Testing

### 6.1 Unit tests (`tests/`, pytest)

Mock LLM calls via `monkeypatch`.

- **`test_input_parser.py`** — URL detection (BOSS/拉勾/LinkedIn patterns), docx parsing (mock file), PDF parsing (stub), text pass-through.
- **`test_pre_scanner.py`** — Keyword counting (红旗词), structure detection (tech stack presence, salary mention).
- **`test_analyzer.py`** — 4 dimension calls with stub LLM, JSON schema validation.
- **`test_llm_adapter.py`** — Config resolution, retry logic, malformed JSON handling.

### 6.2 End-to-end (`tests/test_e2e.py` + `fixtures/`)

7 fixture files (**generated by Claude during MVP setup**, not real JDs):

| Fixture | Pattern | Expected output |
|---|---|---|
| `jd_red_flag_factory.txt` | "抗压" × 6, "狼性" × 3, "能加班" × 2 | 红旗多, culture = "high-pressure", 建议谨慎 |
| `jd_polished_startup.txt` | "改变世界", "扁平化", "early equity" (no %) | equity_water = high, 议价空间中等 |
| `jd_clean_tech.txt` | 技术栈具体, 薪资 "20-35K×15薪", 无加班措辞 | 报告偏绿, 议价空间明确 |
| `jd_with_resume_match.txt` + `resume_match.md` | JD 要求都在简历里 | match_score ≥ 80 |
| `jd_with_resume_mismatch.txt` + `resume_mismatch.md` | JD 要求 "微信小程序" 简历无 | hard_unmet 有该项, match_score ≤ 50 |

`expected.json` documents which fixtures should trigger which flags.

E2E uses **deterministic stub LLM** (fixture-aware mock) for CI. A gated **integration test** (`JTD_INTEGRATION_TEST=1`) runs against real LLM for manual smoke.

### 6.3 Pass criteria

- All unit tests green.
- All 7 fixtures generate Markdown + HTML reports without crashing.
- Red-flag fixture report contains ≥ 3 red flags.
- Clean-tech fixture report has ≥ 2 green signals.
- Match/mismatch fixtures land in expected score bands.
- HTML opens in browser and renders word cloud + radar chart without console errors.

## 7. SKILL.md frontmatter (final)

```yaml
---
name: jd-truth-detector
description: >
  Reverse-engineer job descriptions: translate jargon ("5 years" → 3),
  infer company culture (red flags, vibes), match to your resume,
  detect negotiation signals. Outputs Markdown + shareable HTML report.
  Works with any OpenAI-compatible LLM (Ollama, DeepSeek, OpenAI, etc.).
  Supports text paste (primary), URL scraping (BOSS/拉勾/LinkedIn), and
  file input (.txt/.md/.docx/.pdf).
version: 1.0.0
author: ucsdzehualiu
license: MIT
trigger_keywords:
  - jd-truth-detector
  - JD 分析
  - 招聘分析
  - job description analysis
  - analyze this JD
  - 拆穿 JD
  - 解读 JD
  - JD 黑话
---
```

## 8. Open questions

None. All decisions settled in the brainstorming dialogue (Q1–Q6).
