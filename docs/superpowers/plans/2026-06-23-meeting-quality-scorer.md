# Implementation Plan — meeting-quality-scorer

**Goal:** A Claude skill that scores meeting quality from a transcript across three dimensions (decision clarity, time efficiency, participation balance) and outputs Markdown + HTML reports.

**Architecture:** `parse → score → report` pipeline. Parser detects transcript format; scorer computes Gini + rules + 2 LLM calls; reporter renders Jinja2 templates.

**Tech Stack:** Python 3.10+, openai SDK, pyyaml, jinja2, pytest. No native deps.

**Spec Reference:** `docs/superpowers/specs/2026-06-23-meeting-quality-scorer-design.md`

**Global Constraints:**
- Env vars: `MQS_BASE_URL`, `MQS_API_KEY`, `MQS_MODEL` (prefix `MQS_`)
- Config path: `~/.config/meeting-quality-scorer/config.yaml`
- Max transcript: 200,000 chars — hard exit beyond this
- LLM timeout: 60s per call
- Max LLM calls per run: 2 (one for decisions, one for filler verification)
- Weights: Decision 40% / Time 30% / Participation 30%
- Degraded mode weights: Decision 60% / Time 40%
- Format detection threshold: ≥30% of non-empty lines must match labeled pattern

---

## Task 1 — Skeleton

- [ ] **Files to create:**
  - `my_openclaw_skill/meeting-quality-scorer/` (directory)
  - `requirements.txt`
  - `LICENSE`
  - `.gitignore`
  - `config.example.yaml`
  - `scripts/__init__.py`
  - `templates/` (empty directory placeholder)
  - `tests/` (empty directory placeholder)
  - `fixtures/` (empty directory placeholder)

- [ ] **Interfaces:** Produces a runnable project skeleton. No inputs consumed yet.

- [ ] **Steps:**
  - [ ] Create the directory tree as per spec §3.1.
  - [ ] Write `requirements.txt`:
    ```
    openai>=1.30.0
    pyyaml>=6.0
    jinja2>=3.1.0
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

- [ ] **Commit:** `feat: scaffold meeting-quality-scorer project skeleton`

---

## Task 2 — conftest.py

- [ ] **Files to create:**
  - `tests/conftest.py`

- [ ] **Interfaces:**
  - Produces: `mock_llm` fixture (monkeypatches `LLMClient.chat`), `transcript_labeled` fixture, `transcript_plain` fixture, `transcript_whisperx` fixture.
  - Consumed by: all test files.

- [ ] **Steps:**
  - [ ] Write `tests/conftest.py` with three transcript sample fixtures:
    - `transcript_labeled`: 15+ lines using `Alice: ...` / `Bob: ...` format, covering a meeting with decisions and some filler. Ensure ≥30% of non-empty lines match labeled pattern.
    - `transcript_plain`: 15+ lines of plain prose discussion, no speaker labels.
    - `transcript_whisperx`: Lines in `[HH:MM:SS.ss --> HH:MM:SS.ss] SPEAKER_01: ...` format.
  - [ ] Write `mock_llm` fixture using `pytest.fixture` + `monkeypatch`:
    - Default return for decision call: `[{"topic": "budget", "decided": True, "owner": "Alice", "deadline": "Aug 15"}]`
    - Default return for filler call: `{"filler_windows": [0], "total_windows": 5}`
  - [ ] Keep transcripts between 800–1500 chars as per spec §6.2.

- [ ] **Commit:** `test: add conftest fixtures (mock LLM + 3 transcript samples)`

---

## Task 3 — parser.py (TDD)

- [ ] **Files to create:**
  - `tests/test_parser.py`
  - `scripts/parser.py`

- [ ] **Interfaces:**
  - `detect_format(text: str) -> Literal['labeled', 'plain']`
  - `parse(text: str) -> dict`:
    ```python
    {
      "format": "labeled" | "plain",
      "speakers": {"Alice": 320, "Bob": 215},  # char count per speaker; empty if plain
      "utterances": [{"speaker": "Alice", "text": "...", "timestamp": None}],
      "total_chars": 1200
    }
    ```

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_detect_labeled_alice_bob`: feed `transcript_labeled` fixture → assert `'labeled'`
  - [ ] `test_detect_labeled_whisperx`: feed `transcript_whisperx` fixture → assert `'labeled'`
  - [ ] `test_detect_plain`: feed `transcript_plain` fixture → assert `'plain'`
  - [ ] `test_detect_threshold_edge`: craft text where exactly 29% of lines match → assert `'plain'`; 30% → assert `'labeled'`
  - [ ] `test_detect_cjk_speaker`: text like `张三: 今天讨论...` → assert `'labeled'`
  - [ ] `test_parse_labeled_counts`: parse `transcript_labeled` → `speakers` keys == expected names, values > 0
  - [ ] `test_parse_plain_no_speakers`: parse `transcript_plain` → `speakers == {}`
  - [ ] `test_parse_total_chars`: parse any transcript → `total_chars == len(text.strip())`
  - [ ] Run `pytest tests/test_parser.py` → all RED.

  **Implement (GREEN):**
  - [ ] `detect_format(text)`:
    - Split into non-empty lines.
    - For each line, test against the three regex patterns from spec §3.7.
    - Return `'labeled'` if `matched / total_non_empty >= 0.30`, else `'plain'`.
  - [ ] `parse(text)`:
    - Call `detect_format`.
    - If `'labeled'`: iterate lines, extract speaker via regex, accumulate char counts per speaker, build utterances list.
    - If `'plain'`: return empty `speakers`, flat utterances list with `speaker=None`.
    - Always populate `total_chars`.
  - [ ] Run `pytest tests/test_parser.py` → all GREEN.

- [ ] **Commit:** `feat(parser): detect_format and parse with TDD (labeled/plain/whisperx)`

---

## Task 4 — scorer.py (TDD)

- [ ] **Files to create:**
  - `tests/test_scorer.py`
  - `scripts/scorer.py`

- [ ] **Interfaces:**
  - `gini(counts: list[int]) -> float` — returns Gini coefficient in [0, 1]
  - `participation_score(speakers: dict[str, int]) -> float | None` — returns 0–100 or None if <2 speakers
  - `compute_total(decision: float | None, time_eff: float | None, participation: float | None) -> dict`:
    ```python
    {"total": 72.5, "weights_used": {"decision": 0.4, "time": 0.3, "participation": 0.3}, "degraded": False}
    ```

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_gini_equal`: `gini([10, 10, 10])` → `0.0`
  - [ ] `test_gini_unequal`: `gini([0, 0, 100])` → close to `0.667` (within 0.01)
  - [ ] `test_gini_single`: `gini([100])` → `0.0`
  - [ ] `test_participation_balanced`: `participation_score({"A": 100, "B": 100})` → `100.0`
  - [ ] `test_participation_dominant`: `participation_score({"A": 900, "B": 100})` → ≤ 40.0
  - [ ] `test_participation_single_speaker`: `participation_score({"A": 500})` → `None`
  - [ ] `test_participation_empty`: `participation_score({})` → `None`
  - [ ] `test_compute_total_full`: all three scores present → weights 40/30/30, `degraded=False`
  - [ ] `test_compute_total_degraded`: `participation=None` → weights 60/40, `degraded=True`
  - [ ] `test_compute_total_both_none`: decision and time both None → total is None (or error)
  - [ ] Run `pytest tests/test_scorer.py` → all RED.

  **Implement (GREEN):**
  - [ ] `gini(counts)`: standard Gini formula — sort ascending, compute cumulative sum, derive coefficient.
  - [ ] `participation_score(speakers)`: if len < 2 return None; compute gini on `list(speakers.values())`; return `100 * (1 - G)`.
  - [ ] `compute_total(decision, time_eff, participation)`: apply weights per spec §3.5; if participation is None use degraded weights.
  - [ ] Run `pytest tests/test_scorer.py` → all GREEN.

- [ ] **Commit:** `feat(scorer): gini, participation_score, compute_total with TDD`

---

## Task 5 — llm_adapter.py (TDD)

- [ ] **Files to create:**
  - `tests/test_llm_adapter.py`
  - `scripts/llm_adapter.py`

- [ ] **Interfaces:**
  - `resolve_config(env_prefix='MQS_', config_path=None) -> dict` — returns `{base_url, api_key, model, timeout}`
  - `class LLMClient`:
    - `__init__(self, base_url, api_key, model, timeout=60)`
    - `chat(self, messages: list[dict], schema: dict | None = None) -> dict` — returns parsed JSON dict

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_resolve_from_env`: set `MQS_BASE_URL/MQS_API_KEY/MQS_MODEL` → assert returned dict matches
  - [ ] `test_resolve_from_file`: write a temp yaml with keys → assert resolved correctly
  - [ ] `test_resolve_env_overrides_file`: set env vars AND write config file → env wins
  - [ ] `test_resolve_missing_all`: no env, no file → raises `SystemExit(2)`
  - [ ] `test_chat_success`: monkeypatch `openai.OpenAI` → `chat()` returns parsed dict
  - [ ] `test_chat_retry_5xx`: first two calls raise 5xx, third succeeds → returns result after 3 attempts
  - [ ] `test_chat_malformed_json`: LLM returns non-JSON string → raises `ValueError`
  - [ ] Run `pytest tests/test_llm_adapter.py` → all RED.

  **Implement (GREEN):**
  - [ ] `resolve_config`: check `MQS_BASE_URL/MQS_API_KEY/MQS_MODEL` in `os.environ`; if any missing, try loading yaml from `config_path` or `~/.config/meeting-quality-scorer/config.yaml`; if still incomplete, `sys.exit(2)` with help text listing env vars and config path.
  - [ ] `LLMClient.__init__`: store params, create `openai.OpenAI(base_url=..., api_key=...)`.
  - [ ] `LLMClient.chat`: call `client.chat.completions.create(model=..., messages=..., timeout=self.timeout)`; parse `response.choices[0].message.content` as JSON; retry up to 3 times on 5xx; raise `ValueError` on malformed JSON after one retry with stricter prompt.
  - [ ] Run `pytest tests/test_llm_adapter.py` → all GREEN.

- [ ] **Commit:** `feat(llm_adapter): LLMClient + resolve_config with MQS_ prefix, TDD`

---

## Task 6 — analyzer.py (TDD)

- [ ] **Files to create:**
  - `tests/test_analyzer.py`
  - `scripts/analyzer.py`

- [ ] **Interfaces:**
  - `analyze_decisions(parsed: dict, client: LLMClient) -> list[dict]` — returns list of `{topic, decided, owner, deadline}`
  - `analyze_filler(parsed: dict, client: LLMClient) -> dict` — returns `{filler_windows: int, total_windows: int}`
  - `compute_decision_score(topics: list[dict]) -> float | None`
  - `compute_time_score(filler_result: dict) -> float`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_analyze_decisions_returns_list`: stub LLM → returns list of topic dicts
  - [ ] `test_analyze_decisions_empty_topics`: stub returns `[]` → `compute_decision_score([])` returns `None`
  - [ ] `test_analyze_filler_returns_dict`: stub LLM → returns `{filler_windows, total_windows}`
  - [ ] `test_compute_decision_score_all_decided`: all topics decided with owner → 100.0
  - [ ] `test_compute_decision_score_half_decided`: half decided → 50.0
  - [ ] `test_compute_time_score_no_filler`: `{filler_windows: 0, total_windows: 10}` → 100.0
  - [ ] `test_compute_time_score_30pct_filler`: `{filler_windows: 3, total_windows: 10}` → 70.0
  - [ ] Run `pytest tests/test_analyzer.py` → all RED.

  **Implement (GREEN):**
  - [ ] `analyze_decisions`: build system + user prompt (full transcript text + instruction to return JSON array per spec §3.4). Call `client.chat(messages, schema=decision_schema)`.
  - [ ] `analyze_filler`: split transcript into fixed-token windows (approx 200 chars each if no timestamps). Rule pass: flag windows containing spec §3.4 filler patterns. LLM pass: send only flagged windows for confirmation. Return `{filler_windows, total_windows}`. This constitutes the 2nd LLM call.
  - [ ] `compute_decision_score`: `100 * decided_with_owner / total`; `None` if empty.
  - [ ] `compute_time_score`: `100 * (1 - filler_windows / total_windows)`.
  - [ ] Run `pytest tests/test_analyzer.py` → all GREEN.

- [ ] **Commit:** `feat(analyzer): 2-LLM-call decision_clarity + time_efficiency with TDD`

---

## Task 7 — reporter.py + templates (TDD)

- [ ] **Files to create:**
  - `templates/report.md.j2`
  - `templates/report.html.j2`
  - `tests/test_reporter.py`
  - `scripts/reporter.py`

- [ ] **Interfaces:**
  - `render_markdown(data: dict) -> str` — data shape: `{scores, topics, filler_result, parsed, degraded}`
  - `render_html(data: dict) -> str`

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_render_markdown_contains_total_score`: rendered MD contains `## Total Score`
  - [ ] `test_render_markdown_degraded_banner`: degraded=True → rendered MD contains the banner text about missing speaker labels
  - [ ] `test_render_html_contains_chartjs`: rendered HTML contains `cdn.jsdelivr.net` Chart.js script tag
  - [ ] `test_render_html_contains_radar`: rendered HTML contains `radar` chart type reference
  - [ ] `test_render_html_contains_bar`: rendered HTML contains `bar` chart type reference
  - [ ] Run `pytest tests/test_reporter.py` → all RED.

  **Implement (GREEN):**
  - [ ] Write `templates/report.md.j2`:
    - Header: skill name, timestamp, total score.
    - Section: Decision Clarity — topic table (topic / decided / owner / deadline).
    - Section: Time Efficiency — filler %.
    - Section: Participation Balance — speaker table or N/A banner.
    - Footer: weights used, degraded mode note if applicable.
  - [ ] Write `templates/report.html.j2`:
    - Include Chart.js from `https://cdn.jsdelivr.net/npm/chart.js`.
    - Radar chart: 3 dimensions (or 2 if degraded).
    - Bar chart: per-speaker word count (hidden if plain transcript).
    - Degraded mode banner styled in yellow if applicable.
  - [ ] `render_markdown(data)`: load `report.md.j2`, render with Jinja2.
  - [ ] `render_html(data)`: load `report.html.j2`, render with Jinja2, inject chart data as inline JSON.
  - [ ] Run `pytest tests/test_reporter.py` → all GREEN.

- [ ] **Commit:** `feat(reporter): Markdown + HTML rendering with Chart.js radar/bar, TDD`

---

## Task 8 — score_meeting.py CLI (TDD)

- [ ] **Files to create:**
  - `tests/test_cli.py`
  - `scripts/score_meeting.py`

- [ ] **Interfaces:**
  - CLI: `python scripts/score_meeting.py --input <file> [--out-md <file>] [--out-html <file>] [--config <file>]`
  - Exit codes: 0 = success, 1 = LLM error, 2 = config/input error

- [ ] **TDD flow:**

  **Write tests first (RED):**
  - [ ] `test_cli_exit2_no_input`: invoke without `--input` → exit 2
  - [ ] `test_cli_exit2_transcript_too_short`: transcript < 100 chars → exit 2 with "transcript too short"
  - [ ] `test_cli_exit2_transcript_too_long`: transcript > 200000 chars → exit 2 with "transcript too long"
  - [ ] `test_cli_success_writes_md`: valid transcript + stub LLM → `--out-md` file is created and non-empty
  - [ ] `test_cli_success_writes_html`: valid transcript + stub LLM → `--out-html` file is created and non-empty
  - [ ] `test_cli_llm_unreachable_saves_partial`: LLM raises on both calls → exit 1 + `partial-report.md` saved
  - [ ] Run `pytest tests/test_cli.py` → all RED.

  **Implement (GREEN):**
  - [ ] Parse args with `argparse`.
  - [ ] Read transcript file; validate length (100 ≤ chars ≤ 200000).
  - [ ] Call `resolve_config()` with `MQS_` prefix; instantiate `LLMClient`.
  - [ ] Call `parser.parse()` → `scorer.participation_score()`.
  - [ ] Call `analyzer.analyze_decisions()` + `analyzer.analyze_filler()`.
  - [ ] Call `scorer.compute_total()`.
  - [ ] Call `reporter.render_markdown()` + `reporter.render_html()`; write output files.
  - [ ] On LLM error: save rule-based partial results to `partial-report.md`; exit 1.
  - [ ] Run `pytest tests/test_cli.py` → all GREEN.

- [ ] **Commit:** `feat(cli): score_meeting.py entry point with full pipeline, TDD`

---

## Task 9 — SKILL.md

- [ ] **Files to create:**
  - `meeting-quality-scorer/SKILL.md`

- [ ] **Steps:**
  - [ ] Copy frontmatter exactly from spec §7:
    ```yaml
    ---
    name: meeting-quality-scorer
    description: >
      Objectively score meeting quality from a transcript. Three dimensions:
      decision clarity, time efficiency, participation balance. Outputs a
      Markdown report and an HTML visualization. Works with any
      OpenAI-compatible LLM endpoint (Ollama, DeepSeek, OpenAI, etc.).
      Pairs with meeting_whisper for a transcribe-then-score pipeline.
    version: 1.0.0
    author: ucsdzehualiu
    license: MIT
    trigger_keywords:
      - meeting-quality-scorer
      - meeting score
      - 会议评分
      - 会议质量
      - 会议有效性
      - score this meeting
      - rate the meeting
    ---
    ```
  - [ ] After frontmatter, write the usage section: how to invoke (env vars, config file, CLI flags), input format requirements, output file locations.

- [ ] **Commit:** `docs: add SKILL.md with frontmatter from spec §7`

---

## Task 10 — README.md

- [ ] **Files to create:**
  - `meeting-quality-scorer/README.md`

- [ ] **Steps:**
  - [ ] Write sections: Overview, Installation (`pip install -r requirements.txt`), Configuration (env vars table + config file), Usage (3 CLI examples from spec §3.3), Scoring Dimensions (table of 3 dimensions with formulas), Degraded Mode, Failure Modes table, Limitations (from spec §4.1).
  - [ ] Do NOT duplicate SKILL.md frontmatter — README is human-facing.

- [ ] **Commit:** `docs: add README.md with installation, config, usage, limitations`

---

## Task 11 — E2E fixtures

- [ ] **Files to create:**
  - `fixtures/high_quality.txt`
  - `fixtures/low_quality.txt`
  - `fixtures/no_decisions.txt`
  - `fixtures/one_man_show.txt`
  - `fixtures/plain_no_speakers.txt`
  - `fixtures/expected.json`

- [ ] **Specifications per fixture (all 800–1500 chars, labeled unless noted):**

  - `high_quality.txt`: 4 speakers (Alice, Bob, Carol, Dave), 3 discussion topics, each ending with clear decision + owner + deadline, <10% filler, balanced speaking time (Gini < 0.2). Expected: total ≥ 80.
  - `low_quality.txt`: 2 speakers (Boss, Employee), Boss speaks 85%, topics raised but never resolved, 30%+ filler lines (weather/weekend chat). Expected: total ≤ 40.
  - `no_decisions.txt`: 3 balanced speakers, 3 topics discussed thoroughly but no decisions made (no owner assigned), on-topic throughout. Expected: decision ≤ 30, total 30–50.
  - `one_man_show.txt`: Manager speaks 90%, one clear decision with owner, on-topic. Expected: balance ≤ 25, total 50–70.
  - `plain_no_speakers.txt`: plain prose, mid-quality content (some decisions, moderate filler), no speaker labels. Expected: degraded mode active, total computed from 2 dimensions.

  - `expected.json`:
    ```json
    {
      "high_quality": {"total_min": 80, "degraded": false},
      "low_quality": {"total_max": 40, "degraded": false},
      "no_decisions": {"decision_max": 30, "total_min": 30, "total_max": 50},
      "one_man_show": {"participation_max": 25, "total_min": 50, "total_max": 70},
      "plain_no_speakers": {"degraded": true}
    }
    ```

- [ ] **Commit:** `test: add 5 E2E fixtures + expected.json score bands`

---

## Task 12 — E2E run and verify

- [ ] **Files to create/modify:**
  - `tests/test_e2e.py`

- [ ] **Steps:**
  - [ ] Write `test_e2e.py` using a `stub_llm` fixture that:
    - For `high_quality.txt`: returns 3 decided topics with owners; 0 filler windows out of 6.
    - For `low_quality.txt`: returns 0 decided topics; 4 filler windows out of 12.
    - For `no_decisions.txt`: returns 3 topics all `decided=False`; 0 filler.
    - For `one_man_show.txt`: returns 2 decided topics with owners; 0 filler.
    - For `plain_no_speakers.txt`: returns 1 decided topic; 1 filler window out of 5.
  - [ ] Each test case:
    - [ ] Load fixture text.
    - [ ] Run full pipeline (parse → score → analyze stub → total).
    - [ ] Assert total score lands in expected band from `expected.json`.
    - [ ] Assert `report.md` and `report.html` are generated without error.
    - [ ] Assert degraded mode is active only for `plain_no_speakers`.
  - [ ] Run `pytest tests/test_e2e.py` → all GREEN.
  - [ ] Run full pytest suite → all GREEN.

- [ ] **Commit:** `test: E2E test suite — all 5 fixtures pass score band assertions`

---

## Task 13 — ClawHub scan and publish

- [ ] **Steps:**
  - [ ] Run `clawhub scan` from the `meeting-quality-scorer/` directory to verify SKILL.md format, required fields, and trigger keywords.
  - [ ] Fix any lint errors reported by scanner.
  - [ ] Run `clawhub publish` (dry-run first: `clawhub publish --dry-run`).
  - [ ] If dry-run passes, run `clawhub publish`.
  - [ ] Confirm skill appears in ClawHub registry.

- [ ] **Commit:** `chore: clawhub publish meeting-quality-scorer v1.0.0`

---

## Self-Review — Spec Coverage Checklist

| Spec Section | Covered in Plan | Task # |
|---|---|---|
| §3.1 Directory layout | All files/dirs listed | Task 1 |
| §3.3 CLI surface (3 invocation examples) | score_meeting.py with argparse | Task 8 |
| §3.4 Decision clarity LLM prompt | analyzer.py analyze_decisions | Task 6 |
| §3.4 Time efficiency rules + LLM verify | analyzer.py analyze_filler | Task 6 |
| §3.4 Participation balance Gini | scorer.py gini + participation_score | Task 4 |
| §3.5 Weights 40/30/30 + degraded 60/40 | scorer.py compute_total | Task 4 |
| §3.6 LLMClient interface | llm_adapter.py | Task 5 |
| §3.6 Config priority: env > file > exit | resolve_config with MQS_ prefix | Task 5 |
| §3.7 Format detection threshold ≥30% | parser.py detect_format | Task 3 |
| §3.7 Three regex patterns (labeled/whisperx/cjk) | parser.py detect_format | Task 3 |
| §3.8 Degraded mode banner text | reporter.py + templates | Task 7 |
| §4.2 Max 200k chars hard exit | score_meeting.py validation | Task 8 |
| §4.2 LLM timeout 60s | LLMClient.__init__ | Task 5 |
| §4.2 Max 2 LLM calls | analyzer.py (2 calls only) | Task 6 |
| §4.4 LLM unreachable → partial-report.md | score_meeting.py error handler | Task 8 |
| §4.4 Malformed JSON → retry + mark failed | LLMClient.chat retry logic | Task 5 |
| §6.1 Unit tests (no real LLM) | conftest mock_llm, Tasks 3–8 | Tasks 2–8 |
| §6.2 5 E2E fixtures + expected.json | fixtures/ + test_e2e.py | Tasks 11–12 |
| §6.3 Pass criteria (both reports, no errors) | test_e2e.py assertions | Task 12 |
| §7 SKILL.md frontmatter (exact copy) | SKILL.md | Task 9 |
| Chart.js CDN radar + bar charts | report.html.j2 | Task 7 |
| MQS_ env var prefix | resolve_config | Task 5 |
