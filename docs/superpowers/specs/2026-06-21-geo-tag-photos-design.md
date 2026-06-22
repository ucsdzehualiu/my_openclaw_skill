# geo-tag-photos — Design Spec

**Date:** 2026-06-21
**Author:** Claude (with user direction)
**Status:** Ready for implementation
**Replaces:** `photo-geolocator-skill` (private prototype on user's desktop, narrowly scoped to Huawei phones + Europe trips)

## 1. Goal

Ship a general-purpose Claude skill that recovers lost GPS metadata for photos by combining the host model's vision with online geocoding. Publish to both the user's GitHub repo (`ucsdzehualiu/my_openclaw_skill`) and ClawHub.

The existing prototype works for one specific case (Huawei phone exports of European trips). This spec generalizes it: any user, any region, any landmark-bearing JPG.

## 2. Non-goals

- HEIC / PNG / TIFF / RAW input. Users convert to JPG first.
- Itinerary parsing (Word / PDF). Removed entirely — the prototype's `itinerary_parser.py` does not carry over.
- Photos without recognizable landmarks (interiors, plain portraits, generic nature). Reported as `UNKNOWN`, not guessed.
- Street- or building-level precision. Output is landmark- / city-level.
- Modifying any EXIF field other than the four we explicitly write.
- Tracking other people, surveillance, forensic / legal use. Explicitly disallowed in the skill's stated limits.

## 3. Architecture

### 3.1 Directory layout

```
my_openclaw_skill/geo-tag-photos/
├── SKILL.md                    # Claude-facing entry point
├── README.md                   # Human-facing GitHub README
├── LICENSE                     # MIT
├── requirements.txt            # piexif, pillow, requests
├── scripts/
│   └── photo_geolocator.py     # Single CLI, multiple subcommands
├── tests/
│   ├── conftest.py
│   ├── test_exif.py
│   ├── test_geocode.py
│   ├── test_dry_run.py
│   └── test_write_safety.py
└── e2e/
    ├── fetch_landmarks.py      # Downloads public landmark photos for E2E
    └── README.md
```

### 3.2 Workflow (5 phases — phase 2 happens in Claude, the other four are CLI subcommands)

```
[ user provides directory of JPGs ]
        │
        ▼
  ┌──────────────┐    EXIF read; mark photos that already have GPS as SKIP
  │   1. scan    │
  └──────────────┘
        │
        ▼
  ┌──────────────┐    Claude uses its native Read tool to view each image
  │ 2. AI vision │    and emits {filename, landmark, city, country,
  │  (in Claude) │      confidence, evidence} per photo into ai_results.json
  └──────────────┘
        │
        ▼
  ┌──────────────┐    For each AI result, query Nominatim (cached locally)
  │  3. geocode  │    to convert "landmark, city, country" → (lat, lon)
  └──────────────┘
        │
        ▼
  ┌──────────────┐    Merge scan + geocode → report.csv with everything
  │  4. report   │    the user needs to review before any write happens
  └──────────────┘
        │
        ▼
  [ user reviews report.csv ]
        │
        ▼
  ┌──────────────┐    Default = dry-run. Real writes require BOTH
  │  5. write    │    --write AND --backup-dir. Auto-verifies after write.
  └──────────────┘
```

The clean split: **AI vision happens in the host Claude session** (using its native multimodal Read tool); **the script does only mechanical work** (EXIF read/write, HTTP geocoding, caching, safety enforcement).

### 3.3 CLI surface

All subcommands live in `scripts/photo_geolocator.py`:

| Subcommand | Purpose |
|---|---|
| `scan --dir <photos> --out <csv>` | Read EXIF; report which photos already have GPS |
| `geocode --input <ai.json> --out <csv>` | Resolve landmark/city/country → coordinates via Nominatim + cache |
| `report --dir <photos> --geocoded <csv> --out <csv>` | Merge scan + geocode into a single human-reviewable report |
| `write --dir <photos> --csv <report>` | Default dry-run; `--write` + `--backup-dir` writes EXIF |
| `cache --show` / `cache --clear` | Maintenance for the local geocode cache |

Cache lives at `~/.cache/geo-tag-photos/cache.json` (or `%LOCALAPPDATA%\geo-tag-photos\cache.json` on Windows). Key = canonicalized `"landmark|city|country"` (lower-cased, whitespace-normalized).

### 3.4 EXIF fields written

Only these four fields are touched. Everything else (capture time, camera, ISO, etc.) is preserved verbatim.

| Field | Content |
|---|---|
| `GPSLatitude` + `GPSLatitudeRef` | Geocoded latitude in DMS rationals + N/S |
| `GPSLongitude` + `GPSLongitudeRef` | Geocoded longitude in DMS rationals + E/W |
| `ImageDescription` (ASCII) | `"<city>, <country>"` |
| `UserComment` (UTF-16LE w/ UNICODE prefix) | `"confidence=<level>; landmark=<name>; source=geo-tag-photos"` |

## 4. Limits and boundaries (surfaced to users)

### 4.1 Ethical / scope limits (in SKILL.md and README)

> Use only on your own photos. This skill infers location from visual content. Do not use it to track other people, surveil private individuals, or de-anonymize photos that were intentionally stripped of location data. Inferred coordinates are best-guess estimates and **must not be used for legal, forensic, evidentiary, or law-enforcement purposes**. If a photo's GPS was deliberately removed, respect that intent.

### 4.2 Capability boundaries

| Can do | Cannot do |
|---|---|
| Recognize global public landmarks | Recognize streets, residences, interiors, generic portraits, generic nature |
| City- / landmark-level precision | Street- / building- / room-level |
| JPG / JPEG | HEIC / PNG / TIFF / RAW (convert first) |
| Write GPS + ImageDescription + UserComment | Modify any other EXIF field |
| A few hundred photos at a time | Thousands (rate limits + cache hit rate degrade) |

### 4.3 Runtime hard limits (enforced by the script)

- **JPG-only.** Non-JPG input is rejected with a list of offending filenames.
- **Backup is mandatory.** `write --write` without `--backup-dir` exits with code 2 and changes nothing.
- **Backup directory must not exist or must be empty.** Existing non-empty backup dir → exit 2.
- **Backup must not be inside the source directory** (prevents recursive copies).
- **Nominatim rate limit:** ≥ 1.1 s between successive cache-miss requests, hard-wired (sleep is enforced just before each HTTP call, not after cache hits).
- **User-Agent identifies the skill:** `geo-tag-photos/<version> (https://github.com/ucsdzehualiu/my_openclaw_skill)` — required by OSM policy.
- **Low-confidence rows are skipped** by default (override with `--include-low`).
- **Write batch cap:** 500 photos per invocation. Bigger batches must be split.
- **Existing GPS is preserved** by default (override with `--overwrite-existing`, which prints a warning).

### 4.4 Privacy / network

- The script sends only text (`landmark, city, country`) to Nominatim. **Photos never leave the machine via the script.**
- AI vision happens inside the host Claude session; whether the photos leave the machine for that step is governed by the user's Claude setup, not by this skill.
- No telemetry, no analytics, no calls home.
- Cache stores only text → coordinate mappings.

### 4.5 Failure modes

| Situation | Behavior |
|---|---|
| AI cannot identify a landmark | Row marked `UNKNOWN` in report; not written |
| Nominatim returns no result | Row marked `GEOCODE_FAILED`; landmark text preserved for manual review |
| Nominatim network error | Retry 3× with backoff, then skip that row and continue |
| Photo already has GPS | `SKIP` (default) unless `--overwrite-existing` |
| Non-JPG file present | Listed as `SKIP_NOT_JPG` in the report; written-to set excludes them. The run continues for any valid JPGs. |

## 5. Dependencies

`requirements.txt`:
```
piexif>=1.1.3
Pillow>=10.4.0
requests>=2.31.0
```

The script also detects missing deps at startup and prints a `pip install -r requirements.txt` hint instead of silently installing. No automatic package installation (ClawHub scan flags that as a risk).

## 6. Testing

### 6.1 Unit tests (`tests/`, pytest)

Self-contained, no network, no external photos. Two key fixtures in `conftest.py`:

- `make_jpg(tmp_path, gps=None)` — produces a 100×100 JPG with optional GPS injected via piexif.
- `mock_nominatim(monkeypatch)` — intercepts `requests.get` so geocode tests never hit OSM.

Coverage:

- **`test_exif.py`** — read GPS / read no-GPS / write+roundtrip / UTF-16LE Chinese comment roundtrip / reject non-JPG.
- **`test_geocode.py`** — cache hit skips network; cache miss writes cache; rate-limit ≥ 1.1 s between misses; `User-Agent` header present; 5xx triggers exactly 3 retries.
- **`test_dry_run.py`** — default `write` leaves files unmodified; report CSV has expected schema.
- **`test_write_safety.py`** — missing `--backup-dir` exits 2; non-empty backup dir exits 2; backup inside source exits 2; > 500 photos exits 2; low-confidence rows skipped by default.

### 6.2 End-to-end test (`e2e/`)

**Test set:** `e2e/fetch_landmarks.py` downloads 8 public-domain / CC-BY landmark photos from Wikimedia Commons, strips all EXIF, saves to `e2e/landmarks/`. The directory is `.gitignore`d — testers regenerate it on demand.

Landmarks (one per continent / region for breadth):
1. Eiffel Tower (Paris)
2. Statue of Liberty (New York)
3. Sydney Opera House
4. Great Wall — Badaling (Beijing)
5. Taj Mahal (Agra)
6. Colosseum (Rome)
7. Christ the Redeemer (Rio de Janeiro)
8. Big Ben / Elizabeth Tower (London)

**Run-through (executed by Claude during implementation):**
1. `fetch_landmarks.py` → 8 stripped JPGs.
2. `scan` → all `NO_GPS`.
3. Claude uses Read tool on each photo, emits `ai_results.json`.
4. `geocode` (real Nominatim call) → 8 coordinates.
5. `report` → human-readable CSV.
6. `write --dry-run` → files unchanged.
7. `write --write --backup-dir e2e/landmarks.bak` → writes EXIF.
8. `scan` → all 8 now have GPS within 5 km of canonical coordinates.
9. Backup directory still contains the 8 stripped originals.

**Pass criteria:** unit tests all green; E2E 8/8 written correctly within 5 km of truth; backup intact.

### 6.3 ClawHub scan

`clawhub scan ./geo-tag-photos` runs before publish. Findings are addressed where reasonable; the final scan report is included in the deliverable. Not a hard publish gate — but anything red gets a written justification.

## 7. Publish workflow

1. Implement skill at `my_openclaw_skill/geo-tag-photos/`.
2. Unit tests green.
3. E2E pass.
4. `clawhub scan` — fix what's fixable.
5. `git add geo-tag-photos/ docs/superpowers/specs/` → commit → push to GitHub.
6. `clawhub publish ./geo-tag-photos` to ClawHub.
7. `clawhub inspect geo-tag-photos` to confirm registry shows the new version.

## 8. SKILL.md frontmatter (final)

```yaml
---
name: geo-tag-photos
description: >
  Recover lost GPS metadata for JPG photos by recognizing landmarks via vision
  and writing GPS coordinates back into EXIF. Default dry-run; explicit --write
  with --backup-dir is required to modify files. Global coverage via Nominatim
  (OpenStreetMap), no API keys.
version: 1.0.0
author: ucsdzehualiu
license: MIT
trigger_keywords:
  - geo-tag-photos
  - photo geolocation
  - 照片定位
  - 推断拍摄地点
  - EXIF GPS 写入
  - geotag photos
  - recover photo location
---
```

## 9. Open questions

None. All design decisions are settled in the brainstorming dialogue (Q1–Q11) above.
