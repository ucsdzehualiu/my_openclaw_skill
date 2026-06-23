# meeting-quality-scorer — Design Spec

**Date:** 2026-06-23
**Author:** Claude (with user direction)
**Status:** Ready for implementation

## 1. Goal

A Claude skill that **objectively scores meeting quality** from a transcript text. Detects ineffective meetings via three quantitative dimensions (decision clarity / time efficiency / participation balance) and produces an actionable Markdown report plus a shareable HTML visualization.

Designed to chain after `meeting_whisper` (existing tool that converts audio → transcript via Whisper + LLM-based minutes), forming a complete "transcribe → score → report" pipeline.

## 2. Non-goals

- Recording, transcribing, or interpreting audio. Input is text only.
- Multi-meeting trend analysis or historical tracking ("did last meeting's decisions get done?"). MVP is single-meeting only.
- Real-time / streaming evaluation. Batch only.
- Action item execution tracking. Out of scope.
- Sentiment analysis ("this meeting was tense"). Out of scope; we score *structure*, not *emotion*.
- Replacing meeting facilitation. Output is diagnostic only.

## 3. Architecture

### 3.1 Directory layout

```
my_openclaw_skill/meeting-quality-scorer/
├── SKILL.md                    # Claude-facing entry point
├── README.md                   # Human-facing GitHub README
├── LICENSE                     # MIT
├── requirements.txt            # openai, pyyaml, jinja2
├── config.example.yaml         # Sample config file
├── scripts/
│   ├── __init__.py
│   ├── parser.py               # Detect labeled vs plain; extract speakers/utterances
│   ├── scorer.py               # 3-dimension scoring algorithms
│   ├── llm_adapter.py          # OpenAI-compatible client (works for Ollama/DeepSeek/etc.)
│   ├── reporter.py             # Markdown + HTML rendering
│   └── score_meeting.py        # CLI entry: ties parser → scorer → reporter
├── templates/
│   ├── report.md.j2            # Markdown report template
│   └── report.html.j2          # HTML visualization (Chart.js radar + bar charts)
├── tests/
│   ├── conftest.py             # Fixtures: mock LLM, sample transcripts
│   ├── test_parser.py
│   ├── test_scorer.py
│   ├── test_llm_adapter.py
│   └── test_e2e.py
└── fixtures/
    ├── high_quality.txt        # Generated "good meeting" transcript
    ├── low_quality.txt         # Generated "bad meeting" transcript
    ├── no_decisions.txt        # Talk-but-don't-decide pattern
    ├── one_man_show.txt        # Single dominant speaker
    ├── plain_no_speakers.txt   # No speaker labels (degraded mode)
    └── expected.json           # Expected score ranges for each fixture
```

### 3.2 Workflow

```
[ user provides transcript text file ]
        │
        ▼
  ┌──────────────┐    Detect format (labeled / plain)
  │  1. parse    │    Extract speakers, utterances, timestamps if present
  └──────────────┘
        │
        ▼
  ┌──────────────┐    Score 3 dimensions:
  │  2. score    │    - Decision clarity (LLM)
  │              │    - Time efficiency (rules + LLM verify)
  │              │    - Participation balance (Gini coefficient)
  └──────────────┘
        │
        ▼
  ┌──────────────┐    Render Markdown report (always)
  │  3. report   │    + HTML report (Chart.js radar + bar charts)
  └──────────────┘
```

### 3.3 CLI surface

Single entry point: `scripts/score_meeting.py`

```bash
# Score one transcript
python scripts/score_meeting.py \
  --input meeting.txt \
  --out-md report.md \
  --out-html report.html

# Use config file
python scripts/score_meeting.py --input meeting.txt --config ~/.config/meeting-quality-scorer/config.yaml

# Override LLM via env vars
MQS_BASE_URL=http://localhost:11434/v1 \
MQS_API_KEY=ollama \
MQS_MODEL=qwen2.5:72b \
python scripts/score_meeting.py --input meeting.txt
```

### 3.4 Three scoring dimensions

#### Decision clarity (0–100, LLM-driven)

For each "discussion topic" identified, check whether it ended with: a clear decision + an owner + (optional) deadline.

- LLM is prompted with the full transcript and returns a structured list:
  ```json
  [
    {"topic": "Q3 budget increase", "decided": true, "owner": "Alice", "deadline": "Aug 15"},
    {"topic": "new PM hires", "decided": false, "owner": null, "deadline": null}
  ]
  ```
- Score = `100 * (decided_topics_with_owner / total_topics)`. If 0 topics: score = N/A.

#### Time efficiency (0–100, rules + LLM verify)

Estimates "% of meeting spent on off-topic / filler".

- **Rule pass**: split transcript into 30-second windows (if timestamps), or fixed-token windows otherwise. Count windows where any of these patterns appear: weather, weekend, food, "by the way", "off-topic", greetings beyond intro.
- **LLM pass**: for windows flagged by rules, ask LLM to confirm "is this filler/off-topic relative to the meeting subject?".
- Score = `100 * (1 - confirmed_filler_windows / total_windows)`.

#### Participation balance (0–100, Gini coefficient)

Only available when transcript has speaker labels (otherwise reported as `N/A` with upgrade hint).

- Compute character count per speaker. Sort ascending.
- Gini coefficient `G ∈ [0, 1]`: 0 = perfectly equal, 1 = one speaker says everything.
- Score = `100 * (1 - G)`.

### 3.5 Total score

Weighted average:
- Decision clarity: 40%
- Time efficiency: 30%
- Participation balance: 30%

If participation balance is `N/A` (plain transcript, degraded mode), redistribute to: decision 60%, time 40%.

### 3.6 LLM adapter (OpenAI-compatible)

`scripts/llm_adapter.py` defines:

```python
class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: int = 60): ...
    def chat(self, messages: list[dict], schema: dict | None = None) -> dict: ...
```

Internally uses `openai` Python SDK with `base_url` override — this same client works for: OpenAI, DeepSeek, Moonshot, 智谱 GLM (with `/v1` endpoint), 通义 (DashScope OpenAI-compatible mode), Ollama (`http://localhost:11434/v1`), self-hosted vLLM.

Connection priority:
1. Explicit kwargs in code.
2. Environment vars: `MQS_BASE_URL`, `MQS_API_KEY`, `MQS_MODEL`.
3. Config file at path from `--config` arg, else `~/.config/meeting-quality-scorer/config.yaml`.
4. If none provided: hard exit with error (no silent fallback to a paid endpoint).

### 3.7 Transcript format detection

`scripts/parser.py:detect_format(text)`:

- A line "matches" if it conforms to any of these patterns:
  - `^(\[\d+:\d+(:\d+)?\]\s*)?(SPEAKER_\d+|Speaker\s+[A-Za-z0-9]+)\s*[:：]`
  - `^[A-Za-z一-鿿][A-Za-z0-9一-鿿\s]{0,15}[:：]\s+\S` (e.g. `张三:`, `Alice:`)
  - WhisperX format: `[00:00:15.34 --> 00:00:18.12] SPEAKER_01: hello`
- Returns `'labeled'` if **at least 30% of non-empty lines match** any of the above (avoids false positives from a stray `Note:` prefix).
- Otherwise `'plain'`.

### 3.8 Degraded mode (plain transcripts)

When `format == 'plain'`:
- Skip participation-balance scoring; report `N/A`.
- Total score uses 2-dimension weights (60% decision + 40% time).
- Report includes a banner: *"参与均衡度未评估 — 输入转录无说话人标签。要获得完整评分，请用 WhisperX 或带 diarization 的转录工具重新转录: [link to upgrade docs]"*

## 4. Limits and boundaries

### 4.1 Capability boundaries

| Can do | Cannot do |
|---|---|
| Score structural quality (decisions, time, balance) | Score content quality ("was the strategy correct?") |
| Detect filler / off-topic via rules + LLM | Detect emotional tone, sarcasm, conflict |
| Highlight under-utilized participants | Identify why someone is silent (could be just listening) |
| Run on transcripts in any major language (English / 中文 / mixed) | Audio input — use a separate transcription tool first |
| Process meetings up to ~3 hours | Multi-day workshops or summits |

### 4.2 Runtime hard limits

- **Max transcript size**: 200,000 characters (~50k tokens). Beyond this, hard exit with hint to chunk and average.
- **LLM timeout**: 60 s per call. Up to 2 calls per scoring run (one for decisions, one batched for filler verification).
- **No automatic dependency installation**. Missing deps → friendly error pointing to `pip install -r requirements.txt`.
- **Required config**: must have `base_url + api_key + model` resolved from somewhere. If unset, exit code 2.

### 4.3 Privacy / network

- Transcript content is sent **only** to the user-configured LLM endpoint (and to the host Claude session if invoked via Claude Code). No telemetry, no third-party services, no cloud upload.
- HTML report bundles Chart.js via CDN by default (`<script src="https://cdn.jsdelivr.net/...">`). Add a `--offline` flag to inline the JS for air-gapped environments. (V1 may skip `--offline` if scope creeps; document as future work.)
- Cache: none. Stateless single-shot scoring.

### 4.4 Failure modes

| Situation | Behavior |
|---|---|
| Transcript empty or < 100 chars | Exit 2 with "transcript too short to score" |
| LLM API unreachable (timeout, 5xx after 3 retries) | Exit 1 with the error, save partial scores (rule-based dimensions) to a `partial-report.md` |
| LLM returns malformed JSON | Retry once with stricter prompt; if still bad, mark that dimension as "evaluation failed" in report |
| Transcript has 0 detected discussion topics | Decision clarity = `N/A`; report banner explains |
| Transcript has 1 speaker only | Participation balance = `N/A` (single-speaker meeting / monologue) |
| Config completely missing | Exit 2 with help text showing env vars + config file path |

## 5. Dependencies

`requirements.txt`:
```
openai>=1.30.0
pyyaml>=6.0
jinja2>=3.1.0
pytest>=8.0.0
```

No native deps. No browser. No models. Total install size < 30 MB.

## 6. Testing

### 6.1 Unit tests (`tests/`, pytest)

Self-contained, no real LLM calls (uses `monkeypatch` to stub `LLMClient.chat`).

- **`test_parser.py`** — labeled detection (positive & negative), plain detection, edge cases (mixed CJK / English, timestamps, WhisperX format).
- **`test_scorer.py`** — Gini coefficient on hand-crafted speaker distributions; weight redistribution when participation = N/A; total score math.
- **`test_llm_adapter.py`** — config resolution priority (env > file > error); response parsing; retry on 5xx; malformed JSON handling.

### 6.2 End-to-end (`tests/test_e2e.py` + `fixtures/`)

5 fixture transcripts, each 800–1500 chars, **generated by Claude during MVP setup**:

| Fixture | Designed pattern | Expected score range |
|---|---|---|
| `high_quality.txt` | All topics decided + balanced + on-topic | ≥ 80 total |
| `low_quality.txt` | No decisions + boss dominates + 30% filler | ≤ 40 total |
| `no_decisions.txt` | Balanced + on-topic but no decisions made | decision ≤ 30, total 30–50 |
| `one_man_show.txt` | Decisions made, on-topic, but 90% one speaker | balance ≤ 25, total 50–70 |
| `plain_no_speakers.txt` | Mid-quality, no speaker labels | total uses 2-dim weights |

`expected.json` documents the score range per fixture. E2E test asserts each fixture lands in its band.

E2E uses a **deterministic stub LLM**: a fixture-aware mock that returns canned responses for each transcript. This lets us run the full pipeline without paying for API calls or depending on a live endpoint, while still exercising the parser → scorer → reporter chain.

A separate **integration test** (gated behind `MQS_INTEGRATION_TEST=1`) runs the same E2E flow against a real LLM endpoint, for manual smoke verification before each release.

### 6.3 Pass criteria

- All unit tests green.
- All 5 fixtures land in expected score bands (with stub LLM).
- Both `report.md` and `report.html` generate without errors.
- Generated HTML opens in a browser and renders 2 charts (radar + bar) without console errors.

## 7. SKILL.md frontmatter (final)

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

## 8. Open questions

None. All decisions settled in the brainstorming dialogue (Q1–Q9).
