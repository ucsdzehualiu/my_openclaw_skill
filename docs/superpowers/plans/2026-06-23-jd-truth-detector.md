# Implementation Plan — jd-truth-detector

**Goal:** A Claude skill that reverse-engineers job descriptions across four dimensions (jargon translation, company culture inference, resume match, negotiation signals) and outputs a shareable Markdown + HTML report.

**Architecture:** `input → pre-scan → analyze → report` pipeline. Input parser handles text/URL/file (.txt/.md/.docx/.pdf); pre-scanner does rule-based keyword + structure stats; analyzer makes 4 structured LLM calls; reporter renders Jinja2 templates with word cloud + radar chart.

**Tech Stack:** Python 3.10+, openai SDK, pyyaml, jinja2, python-docx, pdfplumber, beautifulsoup4, httpx, pytest.

**Spec Reference:** `docs/superpowers/specs/2026-06-23-jd-truth-detector-design.md`

**Global Constraints:**
- Env vars: `JTD_BASE_URL`, `JTD_API_KEY`, `JTD_MODEL` (prefix `JTD_`)
- Config path: `~/.config/jd-truth-detector/config.yaml`
- Max JD: 50,000 chars — hard exit beyond
- Max resume: 20,000 chars — hard exit beyond
- LLM timeout: 60s per call
- Max LLM calls per run: 4 (jargon, culture, resume_match optional, negotiation)
- URL fetch timeout: 15s
- Supported sites: `zhipin.com`, `lagou.com`, `linkedin.com/jobs`
- Resume formats: `.txt`, `.md`, `.docx`, `.pdf` (best-effort); `.doc` not supported

---

## Task 1 — Skeleton

- [ ] **Files to create:**
  - `my_openclaw_skill/jd-truth-detector/` (directory)
  - `requirements.txt`
  - `LICENSE`
  - `.gitignore`
  - `config.example.yaml`
  - `scripts/__init__.py`
  - `templates/` (empty directory placeholder)
  - `tests/` (empty directory placeholder)
  - `fixtures/` (empty directory placeholder)

- [ ] **Interfaces:** Produces a runnable project skeleton.

- [ ] **Steps:**
  - [ ] Create the directory tree per spec §3.1.
  - [ ] Write `requirements.txt`:
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
  - [ ] Write MIT `LICENSE` with year 2026 and author `ucsdzehualiu`.
  - [ ] Write `.gitignore` covering `__pycache__/`, `*.pyc`, `.env`, `*.yaml` (except `config.example.yaml`), `htmlcov/`, `.pytest_cache/`.
  - [ ] Write `config.example.yaml`:
    ```yaml
    base_url: "https://api.openai.com/v1"
    api_key: "sk-..."
    model: "gpt-4o-mini"
    timeout: 60
    ```
  - [ ] Create `scripts/__init__.py` (empty).
  - [ ] Verify `pip install -r requirements.txt` succeeds in a clean venv.

- [ ] **Commit:** `feat: scaffold jd-truth-detector project skeleton`

---

## Task 2 — conftest.py

- [ ] **Files to create:**
  - `tests/conftest.py`

- [ ] **Interfaces:**
  - Produces: `stub_llm_dispatcher` fixture, `jd_red_flag_sample`, `jd_clean_sample`, `jd_polished_sample`, `resume_match_sample`, `resume_mismatch_sample`.
  - Consumed by: all test files.

- [ ] **Steps:**
  - [ ] Write `tests/conftest.py` with sample text fixtures (each 600–1200 chars):
    - `jd_red_flag_sample`: contains "抗压" × 5, "狼性" × 2, "能加班" × 2, vague tech requirements ("精通各类前端框架"), no salary, no level.
    - `jd_clean_sample`: specific tech stack ("React 18 + TypeScript 5"), salary "20-35K×15薪", level "T5", no red-flag keywords.
    - `jd_polished_sample`: "改变世界", "扁平化", "early equity" without %.
    - `resume_match_sample`: 5 years React, microservices experience, matches `jd_red_flag_sample` + `jd_clean_sample` requirements.
    - `resume_mismatch_sample`: backend Java only, no frontend, no React.
  - [ ] Write `stub_llm_dispatcher` fixture (monkeypatches `LLMClient.chat`):
    - Routes by message content keyword to canned responses for each of the 4 dimensions.
    - Default jargon response: list of `{jd_text, real_requirement}` items.
    - Default culture response: `{pace, red_flags, tech_maturity, business_clarity, candidate_questions}`.
    - Default resume_match response: `{match_score, hard_met, hard_unmet, soft_met, soft_unmet, recommendation}`.
    - Default negotiation response: `{salary_transparency, level_specified, equity_water, urgency, leverage_summary}`.

- [ ] **Commit:** `test: add conftest with stub LLM dispatcher and JD/resume samples`

---

## Task 3 — input_parser.py (TDD)

- [ ] **Files to create:**
  - `tests/test_input_parser.py`
  - `scripts/input_parser.py`

- [ ] **Interfaces:**
  - `detect_input_type(value: str) -> Literal['text', 'url', 'file']`
  - `fetch_url(url: str, timeout: int = 15) -> str` — returns extracted JD text
  - `parse_file(path: str) -> str` — dispatcher for .txt/.md
  - `parse_resume(path: str) -> str` — handles .txt/.md/.docx/.pdf
  - `validate_jd(text: str) -> None` — raises `SystemExit(2)` if too short or too long
  - Module-level constant: `SITE_SELECTORS = {'zhipin.com': '.job-sec .text', 'lagou.com': '.job_detail', 'linkedin.com': '.description__text'}`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_detect_input_text`: plain string → `'text'`
  - [ ] `test_detect_input_url_zhipin`: `https://www.zhipin.com/job_detail/abc.html` → `'url'`
  - [ ] `test_detect_input_url_lagou`: `https://www.lagou.com/jobs/123.html` → `'url'`
  - [ ] `test_detect_input_url_linkedin`: `https://linkedin.com/jobs/view/456` → `'url'`
  - [ ] `test_detect_input_file_path`: `./jd.txt` (existing file) → `'file'`
  - [ ] `test_fetch_url_zhipin_success`: monkeypatch httpx to return HTML with `.job-sec .text` containing JD text → returns extracted text
  - [ ] `test_fetch_url_unsupported_site`: URL not matching any selector key → raises `SystemExit(1)` with hint
  - [ ] `test_fetch_url_4xx`: stubbed 404 → raises `SystemExit(1)`
  - [ ] `test_fetch_url_timeout`: stubbed timeout → raises `SystemExit(1)`
  - [ ] `test_parse_file_txt`: write temp .txt → returns content
  - [ ] `test_parse_file_md`: write temp .md → returns content
  - [ ] `test_parse_resume_docx`: stub `docx.Document` → returns concatenated paragraphs
  - [ ] `test_parse_resume_pdf`: stub `pdfplumber.open` → returns extracted text
  - [ ] `test_parse_resume_doc_unsupported`: `.doc` extension → raises `SystemExit(1)`
  - [ ] `test_parse_resume_corrupted`: stub raises → raises `SystemExit(1)` with hint to use plain text
  - [ ] `test_validate_jd_too_short`: 100 chars → raises `SystemExit(2)` with "JD 过短"
  - [ ] `test_validate_jd_too_long`: 50001 chars → raises `SystemExit(2)` with "JD 过长"
  - [ ] `test_validate_jd_ok`: 1000 chars → no error
  - [ ] Run `pytest tests/test_input_parser.py` → all RED.

  **Implement (GREEN):**
  - [ ] `detect_input_type(value)`: if starts with `http://` or `https://` → `'url'`; if `os.path.isfile(value)` → `'file'`; else `'text'`.
  - [ ] `fetch_url(url, timeout=15)`: parse domain, look up `SITE_SELECTORS`, raise if not supported. `httpx.get(url, timeout=timeout, headers={'User-Agent': 'jd-truth-detector/1.0'})`. Parse with BeautifulSoup using selector. Raise `SystemExit(1)` on any failure with the spec §3.6 error message.
  - [ ] `parse_file(path)`: read .txt/.md as utf-8.
  - [ ] `parse_resume(path)`: dispatch by extension. `.txt`/`.md` pass through. `.docx`: `docx.Document(path)` → join paragraphs. `.pdf`: `pdfplumber.open(path)` → join page text + emit banner to stderr. `.doc`: `SystemExit(1)`.
  - [ ] `validate_jd(text)`: enforce `200 <= len(text) <= 50000`, exit 2 otherwise.
  - [ ] Run `pytest tests/test_input_parser.py` → all GREEN.

- [ ] **Commit:** `feat(input_parser): URL/file/text detection + .docx/.pdf resume parsing, TDD`

---

## Task 4 — pre_scanner.py (TDD)

- [ ] **Files to create:**
  - `tests/test_pre_scanner.py`
  - `scripts/pre_scanner.py`

- [ ] **Interfaces:**
  - `scan(jd_text: str) -> dict`:
    ```python
    {
      "red_flag_keywords": {"抗压": 5, "狼性": 2, "996": 0, "加班": 3, "学习能力": 4, "使命感": 2, "owner": 1, "拼搏": 0},
      "structure": {
        "sections": int,
        "tech_stack_listed": bool,
        "tech_stack_detail": "具体到版本号" | "只有buzzword" | "未列出",
        "salary_mentioned": bool,
        "equity_mentioned": bool,
        "level_specified": bool
      },
      "length": int
    }
    ```
  - Module-level: `RED_FLAG_KEYWORDS = ["抗压", "狼性", "996", "加班", "学习能力", "使命感", "owner", "拼搏"]`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_scan_red_flag_counts`: text with "抗压" appearing 5 times → `red_flag_keywords["抗压"] == 5`
  - [ ] `test_scan_red_flag_zero_for_absent`: text without "996" → `red_flag_keywords["996"] == 0`
  - [ ] `test_scan_sections_by_headers`: text with 7 markdown headers (`# `, `## `) → `sections == 7`
  - [ ] `test_scan_tech_stack_with_versions`: text mentioning "React 18", "Python 3.11" → `tech_stack_detail == "具体到版本号"`
  - [ ] `test_scan_tech_stack_buzzword_only`: text mentioning "前端框架" without versions → `tech_stack_detail == "只有buzzword"`
  - [ ] `test_scan_salary_mentioned`: text "薪资 20-35K" → `salary_mentioned == True`
  - [ ] `test_scan_salary_面议`: text "薪资面议" → `salary_mentioned == True` (but separate flag could capture it)
  - [ ] `test_scan_salary_absent`: text without salary keywords → `salary_mentioned == False`
  - [ ] `test_scan_equity_mentioned`: text "期权" → `equity_mentioned == True`
  - [ ] `test_scan_level_specified`: text "T5/P6" → `level_specified == True`
  - [ ] `test_scan_length`: arbitrary text → `length == len(text)`
  - [ ] Run `pytest tests/test_pre_scanner.py` → all RED.

  **Implement (GREEN):**
  - [ ] `scan(jd_text)`:
    - Iterate `RED_FLAG_KEYWORDS`; count occurrences via `text.count(kw)`.
    - Sections: count lines starting with `#` (markdown) OR `第\d+条`/`一、二、` patterns.
    - Tech stack: regex search for `(React|Vue|Python|Java|Go|TypeScript|Webpack)\s+\d+(\.\d+)?` → "具体到版本号"; if buzzword regex (`前端框架|后端框架|主流技术`) → "只有buzzword"; else "未列出".
    - Salary: regex `\d+K|\d+万|薪资|面议`.
    - Equity: regex `期权|股票|equity|RSU`.
    - Level: regex `[TPp]\d+|高级|资深|Senior|Staff`.
    - Length: `len(jd_text)`.
  - [ ] Run `pytest tests/test_pre_scanner.py` → all GREEN.

- [ ] **Commit:** `feat(pre_scanner): rule-based red-flag + structure stats, TDD`

---

## Task 5 — llm_adapter.py (TDD)

- [ ] **Files to create:**
  - `tests/test_llm_adapter.py`
  - `scripts/llm_adapter.py`

- [ ] **Interfaces:**
  - `resolve_config(env_prefix='JTD_', config_path=None) -> dict`
  - `class LLMClient`:
    - `__init__(self, base_url, api_key, model, timeout=60)`
    - `chat(self, messages: list[dict], schema: dict | None = None) -> dict`

  Same interface as meeting-quality-scorer's adapter — only the env-var prefix differs (`JTD_` vs `MQS_`).

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_resolve_from_env`: set `JTD_BASE_URL/JTD_API_KEY/JTD_MODEL` → resolved dict matches
  - [ ] `test_resolve_from_file`: write temp yaml at `~/.config/jd-truth-detector/config.yaml` (or use `--config` arg) → resolved correctly
  - [ ] `test_resolve_env_overrides_file`: env wins over file
  - [ ] `test_resolve_missing_all`: nothing set → `SystemExit(2)` with help text
  - [ ] `test_chat_success`: monkeypatch `openai.OpenAI` → returns parsed dict
  - [ ] `test_chat_retry_5xx`: stub raises 5xx twice then succeeds → returns result
  - [ ] `test_chat_malformed_json_retries_with_stricter_prompt`: first call returns garbage, retry with stricter system message → on second failure raises `ValueError`
  - [ ] Run `pytest tests/test_llm_adapter.py` → all RED.

  **Implement (GREEN):**
  - [ ] `resolve_config(env_prefix='JTD_', config_path=None)`:
    - Read `os.environ.get(f'{env_prefix}BASE_URL')` etc.
    - If any missing, fall back to yaml at `config_path or expanduser('~/.config/jd-truth-detector/config.yaml')`.
    - If still missing → `sys.exit(2)` with help text listing env vars + config path + example.
  - [ ] `LLMClient.__init__`: store params, instantiate `openai.OpenAI(base_url=..., api_key=...)`.
  - [ ] `LLMClient.chat(messages, schema=None)`:
    - Call `self.client.chat.completions.create(model=..., messages=..., timeout=self.timeout, response_format={'type': 'json_object'})` if `schema` provided.
    - Parse `response.choices[0].message.content` as JSON.
    - Retry up to 3 times on `httpx.HTTPStatusError(5xx)` or timeout.
    - On JSON parse failure: retry once with stricter system prompt ("You MUST return valid JSON only"); raise `ValueError` if still bad.
  - [ ] Run `pytest tests/test_llm_adapter.py` → all GREEN.

- [ ] **Commit:** `feat(llm_adapter): LLMClient + resolve_config with JTD_ prefix, TDD`

---

## Task 6 — analyzer.py (TDD)

- [ ] **Files to create:**
  - `tests/test_analyzer.py`
  - `scripts/analyzer.py`

- [ ] **Interfaces:**
  - `analyze_jargon(jd_text: str, pre_scan: dict, client: LLMClient) -> list[dict]` — returns `[{jd_text, real_requirement}, ...]`
  - `analyze_culture(jd_text: str, pre_scan: dict, client: LLMClient) -> dict` — returns `{pace, red_flags, tech_maturity, business_clarity, candidate_questions}`
  - `analyze_resume_match(jd_text: str, resume_text: str, client: LLMClient) -> dict` — returns `{match_score, hard_met, hard_unmet, soft_met, soft_unmet, recommendation}`
  - `analyze_negotiation(jd_text: str, pre_scan: dict, client: LLMClient) -> dict` — returns `{salary_transparency, level_specified, equity_water, urgency, leverage_summary}`
  - `run_all(jd_text: str, pre_scan: dict, client: LLMClient, resume_text: str | None = None) -> dict` — orchestrator returning `{jargon, culture, resume_match | None, negotiation}`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_analyze_jargon_returns_list`: stub LLM returns array → returns list of dicts with required keys
  - [ ] `test_analyze_jargon_schema_validation`: stub returns dict without `jd_text` field → raises `ValueError` (schema enforcement)
  - [ ] `test_analyze_culture_returns_dict`: stub LLM → returns dict with all 5 expected keys
  - [ ] `test_analyze_culture_red_flags_count_in_prompt`: assert pre_scan red-flag counts are included in prompt sent to LLM
  - [ ] `test_analyze_resume_match_returns_dict`: stub LLM → returns dict with all 6 keys; `match_score` is int 0–100
  - [ ] `test_analyze_negotiation_returns_dict`: stub LLM → all 5 keys present
  - [ ] `test_run_all_without_resume`: `resume_text=None` → result has `resume_match: None`, only 3 LLM calls invoked
  - [ ] `test_run_all_with_resume`: `resume_text` provided → 4 LLM calls invoked, result has `resume_match` populated
  - [ ] `test_run_all_dimension_failure`: one analyzer raises → that dimension is `{"error": "分析失败"}`, others succeed
  - [ ] Run `pytest tests/test_analyzer.py` → all RED.

  **Implement (GREEN):**
  - [ ] `analyze_jargon`: build prompt per spec §3.4 dim 1 (system + user with JD + pre-scan stats). Call `client.chat`. Validate each item has `jd_text` and `real_requirement` keys.
  - [ ] `analyze_culture`: build prompt per spec §3.4 dim 2, including pre-scan red-flag counts (e.g. "抗压 appears 5 times"). Validate response keys.
  - [ ] `analyze_resume_match`: build prompt per spec §3.4 dim 3 (JD + resume). Validate keys; coerce `match_score` to int.
  - [ ] `analyze_negotiation`: build prompt per spec §3.4 dim 4 (with critical instruction "do NOT estimate salary numbers"). Validate keys.
  - [ ] `run_all`: call all 4 (or 3 if no resume). Wrap each in try/except → on failure store `{"error": "分析失败", "exception": str(e)}` for that dimension.
  - [ ] Run `pytest tests/test_analyzer.py` → all GREEN.

- [ ] **Commit:** `feat(analyzer): 4 structured LLM calls (jargon/culture/resume/negotiation), TDD`

---

## Task 7 — reporter.py + templates (TDD)

- [ ] **Files to create:**
  - `templates/report.md.j2`
  - `templates/report.html.j2`
  - `tests/test_reporter.py`
  - `scripts/reporter.py`

- [ ] **Interfaces:**
  - `render_markdown(data: dict) -> str` — data: `{pre_scan, analysis: {jargon, culture, resume_match | None, negotiation}}`
  - `render_html(data: dict) -> str`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_render_markdown_jargon_table`: rendered MD contains a markdown table with columns `JD 原文 | 真实门槛`
  - [ ] `test_render_markdown_culture_section`: contains "公司体感" section with red/yellow/green emoji flags
  - [ ] `test_render_markdown_resume_match_present`: when `resume_match` provided → MD contains "简历匹配" section with score
  - [ ] `test_render_markdown_resume_match_absent`: when `resume_match is None` → MD contains banner "要获得简历匹配分析,请用 --resume-file 提供简历"
  - [ ] `test_render_markdown_negotiation_section`: contains "议价信号" section with leverage_summary
  - [ ] `test_render_html_contains_chartjs`: rendered HTML contains `cdn.jsdelivr.net/npm/chart.js`
  - [ ] `test_render_html_contains_wordcloud`: rendered HTML contains `wordcloud2.js` reference
  - [ ] `test_render_html_red_flag_styling`: HTML contains class or color marking red-flag entries (e.g. red text)
  - [ ] `test_render_html_radar_chart`: HTML contains `radar` chart type config
  - [ ] Run `pytest tests/test_reporter.py` → all RED.

  **Implement (GREEN):**
  - [ ] Write `templates/report.md.j2`:
    - Header: skill name, timestamp, JD source.
    - Section "黑话翻译": markdown table from `analysis.jargon`.
    - Section "公司体感": pace + red flags (🔴) + yellow flags (🟡) + tech_maturity + business_clarity + candidate_questions list.
    - Section "简历匹配": if `resume_match` populated, score + hard_met + hard_unmet + recommendation. Else banner about missing `--resume-file`.
    - Section "议价信号": all 5 fields from negotiation analysis.
    - Footer: pre-scan summary (red-flag keyword counts table).
  - [ ] Write `templates/report.html.j2`:
    - Include `<script src="https://cdn.jsdelivr.net/npm/chart.js">` and `<script src="https://cdn.jsdelivr.net/npm/wordcloud@1.2.2/src/wordcloud2.min.js">`.
    - Word cloud: feed all red-flag keywords from `pre_scan.red_flag_keywords` (count > 0) into wordcloud2.
    - Radar chart: 4 axes — `tech_maturity`, `business_clarity`, `salary_transparency`, `level_specified` (mapped to numeric 0–100 scale).
    - Flag list: vertical list of red flags (red), yellow flags (orange), green signals (green).
    - Inline screenshot-friendly CSS (max-width 800px, white background, large fonts).
  - [ ] `render_markdown(data)`: load template via Jinja2, render.
  - [ ] `render_html(data)`: load template, render with chart data injected as inline JSON.
  - [ ] Run `pytest tests/test_reporter.py` → all GREEN.

- [ ] **Commit:** `feat(reporter): Markdown + HTML rendering with wordcloud2 + Chart.js radar, TDD`

---

## Task 8 — jd_analyze.py CLI (TDD)

- [ ] **Files to create:**
  - `tests/test_cli.py`
  - `scripts/jd_analyze.py`

- [ ] **Interfaces:**
  - CLI: `python scripts/jd_analyze.py [--jd-text <str> | --jd-file <path> | --jd-url <url>] [--resume-text <str> | --resume-file <path>] [--out-md <file>] [--out-html <file>] [--config <file>]`
  - Exit codes: 0 = success, 1 = LLM/URL error, 2 = config/input error

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_cli_exit2_no_input`: invoke without any `--jd-*` flag → exit 2
  - [ ] `test_cli_exit2_multiple_inputs`: invoke with both `--jd-text` and `--jd-file` → exit 2
  - [ ] `test_cli_exit2_jd_too_short`: JD < 200 chars → exit 2
  - [ ] `test_cli_exit2_jd_too_long`: JD > 50000 chars → exit 2
  - [ ] `test_cli_text_input_writes_outputs`: valid `--jd-text` + stub LLM → `--out-md` and `--out-html` files created
  - [ ] `test_cli_file_input`: valid `--jd-file` → outputs created
  - [ ] `test_cli_url_input_success`: `--jd-url https://www.zhipin.com/...` + stub httpx → outputs created
  - [ ] `test_cli_url_failure_exit1`: stubbed httpx 404 → exit 1 with hint to use `--jd-text`
  - [ ] `test_cli_with_resume_file_runs_4_calls`: `--jd-file` + `--resume-file` → 4 LLM calls invoked, `resume_match` section present in output
  - [ ] `test_cli_without_resume_runs_3_calls`: `--jd-file` only → 3 LLM calls, banner present
  - [ ] `test_cli_resume_too_long`: resume > 20000 chars → exit 2
  - [ ] `test_cli_llm_unreachable_saves_partial`: all LLM calls fail → exit 1 + `partial-report.md` saved with pre-scan stats
  - [ ] `test_cli_config_missing_exit2`: no env, no config file → exit 2 with help text
  - [ ] Run `pytest tests/test_cli.py` → all RED.

  **Implement (GREEN):**
  - [ ] Parse args with `argparse`. Mutually exclusive group for JD source.
  - [ ] Resolve JD: dispatch on which flag is set → call `input_parser.fetch_url` / `parse_file` / pass-through.
  - [ ] `validate_jd(jd_text)` (200–50000 chars).
  - [ ] If `--resume-*` provided: parse + validate (≤20000 chars).
  - [ ] Call `pre_scanner.scan(jd_text)`.
  - [ ] Call `resolve_config(env_prefix='JTD_')`; instantiate `LLMClient`.
  - [ ] Call `analyzer.run_all(jd_text, pre_scan, client, resume_text)`.
  - [ ] Call `reporter.render_markdown` + `reporter.render_html`; write outputs.
  - [ ] On total LLM failure: write `partial-report.md` from `pre_scan` data only; exit 1.
  - [ ] Run `pytest tests/test_cli.py` → all GREEN.

- [ ] **Commit:** `feat(cli): jd_analyze.py entry point with full pipeline, TDD`

---

## Task 9 — SKILL.md

- [ ] **Files to create:**
  - `jd-truth-detector/SKILL.md`

- [ ] **Steps:**
  - [ ] Copy frontmatter exactly from spec §7:
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
  - [ ] After frontmatter, write the usage section: how to invoke (env vars, config file, CLI flags), supported input formats, output file locations, dependency notes (.docx via python-docx, .pdf via pdfplumber).

- [ ] **Commit:** `docs: add SKILL.md with frontmatter from spec §7`

---

## Task 10 — README.md

- [ ] **Files to create:**
  - `jd-truth-detector/README.md`

- [ ] **Steps:**
  - [ ] Write sections: Overview ("拆穿 JD" hook), Installation, Configuration (env vars + config file), Usage (5 CLI examples from spec §3.3), Four Dimensions (table summarizing each), Supported Sites (table: zhipin/lagou/linkedin with one-line descriptions + extension instructions), Resume Format Support, Failure Modes table, Limitations (from spec §4.1), Contributing (note about adding selectors to `SITE_SELECTORS`).
  - [ ] Do NOT duplicate SKILL.md frontmatter.

- [ ] **Commit:** `docs: add README.md with installation, usage, dimensions, contributing`

---

## Task 11 — E2E fixtures

- [ ] **Files to create:**
  - `fixtures/jd_red_flag_factory.txt`
  - `fixtures/jd_polished_startup.txt`
  - `fixtures/jd_clean_tech.txt`
  - `fixtures/jd_with_resume_match.txt`
  - `fixtures/jd_with_resume_mismatch.txt`
  - `fixtures/resume_match.md`
  - `fixtures/resume_mismatch.md`
  - `fixtures/expected.json`

- [ ] **Specifications per fixture (synthetic content, 800–1500 chars each):**

  - `jd_red_flag_factory.txt`: contains "抗压" × 6, "狼性" × 3, "能加班" × 2, "使命感" × 2; vague tech ("精通各类前端框架"); no salary; no level. Pre-scan should detect ≥3 red flags. LLM analysis should return `pace: "high-pressure"`, `equity_water: "high"`.
  - `jd_polished_startup.txt`: "改变世界", "扁平化管理", "early equity"; mentions equity but no %; no specific tech versions; vague salary "竞争力薪酬". Pre-scan detects equity mentioned but no % visible.
  - `jd_clean_tech.txt`: specific tech "React 18 + TypeScript 5 + Webpack 5", salary "20-35K×15薪", level "T5", no red-flag keywords, clear product description. Should produce ≥2 green signals in report.
  - `jd_with_resume_match.txt`: requires "5 年以上 React 经验", "微服务架构", "TypeScript".
  - `resume_match.md`: candidate has "6 years React production", "microservices at company X", TypeScript daily use. Expected `match_score >= 80`.
  - `jd_with_resume_mismatch.txt`: requires "微信小程序经验" + "Vue 3" + "Node.js 后端".
  - `resume_mismatch.md`: candidate is Java backend, no frontend experience, no 小程序. Expected `match_score <= 50`, `hard_unmet` includes "微信小程序".

  - `expected.json`:
    ```json
    {
      "jd_red_flag_factory": {
        "pre_scan_red_flags_min": 3,
        "culture_pace": "high-pressure",
        "report_red_flag_count_min": 3
      },
      "jd_polished_startup": {
        "equity_water": "high",
        "leverage_signal": "中等议价空间"
      },
      "jd_clean_tech": {
        "report_green_signal_count_min": 2,
        "salary_transparency": "explicit"
      },
      "jd_with_resume_match": {
        "match_score_min": 80,
        "recommendation_tier": ["strong fit", "moderate fit"]
      },
      "jd_with_resume_mismatch": {
        "match_score_max": 50,
        "hard_unmet_contains": "小程序"
      }
    }
    ```

- [ ] **Commit:** `test: add 7 E2E fixtures (3 JDs + 2 JD/resume pairs) + expected.json`

---

## Task 12 — E2E run and verify

- [ ] **Files to create/modify:**
  - `tests/test_e2e.py`

- [ ] **Steps:**
  - [ ] Write `test_e2e.py` using fixture-aware `stub_llm_dispatcher`:
    - For `jd_red_flag_factory`: culture stub returns `pace: "high-pressure"`, `red_flags: ["抗压 x6", "狼性 x3", "能加班 x2"]`. Negotiation: `equity_water: "high"`, `leverage_summary: "中等议价空间"`.
    - For `jd_polished_startup`: culture moderate, negotiation `equity_water: "high"`.
    - For `jd_clean_tech`: culture `pace: "normal"`, negotiation `salary_transparency: "explicit"`.
    - For `jd_with_resume_match` + `resume_match`: resume_match stub returns `match_score: 85`, `hard_met: [...]`, `recommendation: "strong fit"`.
    - For `jd_with_resume_mismatch` + `resume_mismatch`: resume_match stub returns `match_score: 35`, `hard_unmet: ["微信小程序经验"]`, `recommendation: "weak fit"`.
  - [ ] Each test case:
    - [ ] Load fixture JD (and resume if applicable).
    - [ ] Run full pipeline (input → pre-scan → analyze stub → report).
    - [ ] Assert pre_scan red-flag counts match `expected.json`.
    - [ ] Assert culture/negotiation/resume_match values match `expected.json`.
    - [ ] Assert `report.md` and `report.html` are generated without error.
    - [ ] Assert HTML contains word cloud + radar chart references.
    - [ ] For mismatch fixture: assert `match_score <= 50` and `hard_unmet` mentions "小程序".
  - [ ] Run `pytest tests/test_e2e.py` → all GREEN.
  - [ ] Run full pytest suite → all GREEN.

- [ ] **Commit:** `test: E2E test suite — all 7 fixtures pass expected band assertions`

---

## Task 13 — ClawHub scan and publish

- [ ] **Steps:**
  - [ ] Run `clawhub scan` from `jd-truth-detector/` directory; verify SKILL.md format, required fields, trigger keywords.
  - [ ] Fix any lint errors reported.
  - [ ] Run `clawhub publish --dry-run`; review preview.
  - [ ] If dry-run passes, run `clawhub publish`.
  - [ ] Confirm skill appears in ClawHub registry.

- [ ] **Commit:** `chore: clawhub publish jd-truth-detector v1.0.0`

---

## Self-Review — Spec Coverage Checklist

| Spec Section | Covered in Plan | Task # |
|---|---|---|
| §3.1 Directory layout | All files/dirs listed | Task 1 |
| §3.3 CLI surface (5 invocation examples) | jd_analyze.py with mutually-exclusive args | Task 8 |
| §3.4 dim 1: Jargon translation prompt | analyzer.analyze_jargon | Task 6 |
| §3.4 dim 2: Culture inference prompt + emoji flags | analyzer.analyze_culture + reporter | Tasks 6, 7 |
| §3.4 dim 3: Resume match (optional) | analyzer.analyze_resume_match (None if absent) | Task 6 |
| §3.4 dim 3: Banner if no resume | reporter.render_markdown | Task 7 |
| §3.4 dim 4: Negotiation signals (no salary numbers) | analyzer.analyze_negotiation with explicit instruction | Task 6 |
| §3.5 Pre-scan keyword counts + structure | pre_scanner.scan | Task 4 |
| §3.5 Pre-scan fed to all 4 LLM calls | analyzer functions accept pre_scan param | Task 6 |
| §3.6 URL scraping for BOSS/拉勾/LinkedIn | input_parser.fetch_url + SITE_SELECTORS | Task 3 |
| §3.6 Failure → exit with `--jd-text` hint | input_parser.fetch_url error message | Task 3 |
| §3.7 LLMClient interface + JTD_ prefix | llm_adapter.resolve_config | Task 5 |
| §3.7 Config priority: env > file > exit | resolve_config | Task 5 |
| §3.8 Resume parsing (.txt/.md/.docx/.pdf) | input_parser.parse_resume | Task 3 |
| §3.8 .doc unsupported | parse_resume raises | Task 3 |
| §4.2 Max JD 50k, max resume 20k | validate_jd + CLI validation | Tasks 3, 8 |
| §4.2 LLM timeout 60s | LLMClient.__init__ | Task 5 |
| §4.2 4 LLM calls per run | analyzer.run_all | Task 6 |
| §4.2 URL fetch timeout 15s | fetch_url default | Task 3 |
| §4.4 LLM unreachable → partial-report.md | jd_analyze.py error handler | Task 8 |
| §4.4 Malformed JSON → retry + mark failed | LLMClient.chat + analyzer wraps | Tasks 5, 6 |
| §4.4 Resume corrupted → exit 1 with hint | parse_resume | Task 3 |
| §6.1 Unit tests (no real LLM) | conftest stub_llm_dispatcher, Tasks 3–8 | Tasks 2–8 |
| §6.2 7 E2E fixtures + expected.json | fixtures/ + test_e2e.py | Tasks 11–12 |
| §6.3 Pass criteria (≥3 red flags, ≥2 green signals, score bands) | test_e2e.py assertions | Task 12 |
| §7 SKILL.md frontmatter (exact copy) | SKILL.md | Task 9 |
| Word cloud (wordcloud2.js CDN) + radar (Chart.js CDN) | report.html.j2 | Task 7 |
| JTD_ env var prefix | resolve_config | Task 5 |
