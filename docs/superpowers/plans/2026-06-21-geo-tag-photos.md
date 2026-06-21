# geo-tag-photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `geo-tag-photos` Claude skill — a CLI + SKILL.md that recovers lost GPS metadata for JPG photos via Claude's vision + Nominatim geocoding, then publish to GitHub and ClawHub.

**Architecture:** Single Python CLI script (`photo_geolocator.py`) with subcommands `scan / geocode / report / write / cache`. AI vision happens in the host Claude session via the Read tool, not in the script. The script does only mechanical work: EXIF read/write, HTTP geocoding, caching, safety enforcement. Default `write` is dry-run; real writes require both `--write` and `--backup-dir`.

**Tech Stack:** Python 3.10+, `piexif` (EXIF I/O), `Pillow` (JPG handling), `requests` (Nominatim HTTP), `pytest` (tests). No additional services, no API keys.

**Reference spec:** `docs/superpowers/specs/2026-06-21-geo-tag-photos-design.md`

## Global Constraints

- **Skill folder:** `my_openclaw_skill/geo-tag-photos/`
- **Skill name (frontmatter):** `geo-tag-photos`
- **Skill version:** `1.0.0`
- **License:** MIT
- **Author:** `ucsdzehualiu`
- **Python:** 3.10+ (uses `from __future__ import annotations`-style type hints freely)
- **Dependencies pinned in `requirements.txt`:** `piexif>=1.1.3`, `Pillow>=10.4.0`, `requests>=2.31.0`
- **No automatic dependency installation** — script detects missing deps and prints `pip install -r requirements.txt` hint, then exits non-zero
- **JPG-only** — `.jpg` and `.jpeg` (case-insensitive). Reject everything else.
- **EXIF fields written:** only `GPSLatitude`, `GPSLatitudeRef`, `GPSLongitude`, `GPSLongitudeRef`, `ImageDescription`, `UserComment`. Nothing else.
- **`UserComment` encoding:** UTF-16LE bytes prefixed with `b"UNICODE\x00"` (8 bytes), per EXIF spec.
- **Nominatim User-Agent:** `geo-tag-photos/1.0.0 (https://github.com/ucsdzehualiu/my_openclaw_skill)` — never empty.
- **Nominatim rate limit:** ≥ 1.1 s between successive cache-miss requests (sleep before each HTTP call, not after cache hits).
- **Cache path:** `~/.cache/geo-tag-photos/cache.json` on POSIX, `%LOCALAPPDATA%\geo-tag-photos\cache.json` on Windows.
- **Cache key:** lowercased, whitespace-collapsed `"landmark|city|country"`.
- **Write batch cap:** 500 photos per `write --write` invocation; over the limit → exit code 2.
- **Backup safety:** `write --write` without `--backup-dir` → exit 2. Backup dir must not exist or must be empty. Backup dir must not be inside source dir.
- **Low confidence:** rows with `confidence: low` skipped by default; `--include-low` opts in.
- **Existing GPS:** preserved by default; `--overwrite-existing` opts in (with stderr warning).
- **Repo layout convention:** matches sibling skills (e.g. `free-web-search/`) — `SKILL.md` at root, `scripts/` subfolder, frontmatter style consistent.

---

### Task 1: Skeleton — folder, requirements, license, gitignore

**Files:**
- Create: `geo-tag-photos/requirements.txt`
- Create: `geo-tag-photos/LICENSE`
- Create: `geo-tag-photos/.gitignore`
- Create: `geo-tag-photos/scripts/__init__.py` (empty)
- Create: `geo-tag-photos/tests/__init__.py` (empty)

**Interfaces:**
- Consumes: nothing
- Produces: working folder layout that all later tasks build into

- [ ] **Step 1: Create the folder skeleton**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
mkdir -p geo-tag-photos/scripts geo-tag-photos/tests geo-tag-photos/e2e
touch geo-tag-photos/scripts/__init__.py geo-tag-photos/tests/__init__.py
```

- [ ] **Step 2: Write `requirements.txt`**

File: `geo-tag-photos/requirements.txt`

```
piexif>=1.1.3
Pillow>=10.4.0
requests>=2.31.0
pytest>=8.0.0
```

- [ ] **Step 3: Write `LICENSE` (MIT)**

File: `geo-tag-photos/LICENSE`

```
MIT License

Copyright (c) 2026 ucsdzehualiu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Write `.gitignore`**

File: `geo-tag-photos/.gitignore`

```
__pycache__/
*.pyc
.pytest_cache/
e2e/landmarks/
e2e/landmarks.bak/
e2e/exif_status.csv
e2e/ai_results.json
e2e/geocoded.csv
e2e/report.csv
clawhub_scan.txt
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/
git commit -m "geo-tag-photos: skeleton (requirements, LICENSE, gitignore)"
```

---

### Task 2: Test fixtures (`conftest.py`) — `make_jpg` and `mock_nominatim`

**Files:**
- Create: `geo-tag-photos/tests/conftest.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `make_jpg(tmp_path: Path, name: str = "test.jpg", gps: tuple[float, float] | None = None) -> Path` — creates a 100×100 white JPG, optionally injects GPS via piexif. Returns absolute path.
  - `mock_nominatim` pytest fixture — monkeypatches `requests.get` to return canned JSON. Test sets `mock_nominatim.responses = {"<query>": {"lat": "...", "lon": "..."}}` (or empty list for "not found"). Records calls in `mock_nominatim.calls: list[dict]` (each entry has `url`, `params`, `headers`).

- [ ] **Step 1: Write `conftest.py`**

File: `geo-tag-photos/tests/conftest.py`

```python
"""Shared pytest fixtures for geo-tag-photos tests."""
from __future__ import annotations

import io
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import piexif
import pytest
from PIL import Image


def _deg_to_dms_rational(deg: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    """Convert decimal degrees to ((d,1),(m,1),(s*10000,10000)) rationals."""
    abs_deg = abs(deg)
    d = int(abs_deg)
    m_full = (abs_deg - d) * 60
    m = int(m_full)
    s = (m_full - m) * 60
    return ((d, 1), (m, 1), (int(round(s * 10000)), 10000))


def _build_gps_ifd(lat: float, lon: float) -> dict:
    return {
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: _deg_to_dms_rational(lat),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: _deg_to_dms_rational(lon),
    }


@pytest.fixture
def make_jpg():
    """Factory that writes a small JPG with optional embedded GPS."""

    def _make(tmp_path: Path, name: str = "test.jpg", gps: tuple[float, float] | None = None) -> Path:
        path = tmp_path / name
        img = Image.new("RGB", (100, 100), color=(255, 255, 255))

        if gps is None:
            img.save(path, "JPEG")
            return path

        lat, lon = gps
        exif_dict = {"0th": {}, "Exif": {}, "GPS": _build_gps_ifd(lat, lon), "1st": {}, "thumbnail": None}
        exif_bytes = piexif.dump(exif_dict)
        img.save(path, "JPEG", exif=exif_bytes)
        return path

    return _make


@pytest.fixture
def mock_nominatim(monkeypatch):
    """Stub requests.get used by the geocoder. Test populates `.responses`."""
    state = SimpleNamespace(responses={}, calls=[])

    def fake_get(url: str, params: dict | None = None, headers: dict | None = None, timeout: float | None = None) -> Any:
        state.calls.append({"url": url, "params": params or {}, "headers": headers or {}})
        query = (params or {}).get("q", "")
        payload = state.responses.get(query, [])
        if isinstance(payload, dict) and payload.get("__status__"):
            status = payload["__status__"]
            return SimpleNamespace(
                status_code=status,
                ok=False,
                json=lambda: [],
                text=payload.get("text", ""),
            )
        # success: payload is a list (possibly empty) of result dicts
        results = payload if isinstance(payload, list) else [payload]
        return SimpleNamespace(status_code=200, ok=True, json=lambda: results, text="")

    monkeypatch.setattr("requests.get", fake_get)
    return state
```

- [ ] **Step 2: Verify fixtures import cleanly**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pip install -r requirements.txt
python -c "import piexif, PIL, requests, pytest; print('ok')"
pytest tests/ --collect-only
```

Expected: `ok` printed; pytest reports "no tests ran" (just collection works).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/tests/conftest.py
git commit -m "geo-tag-photos: test fixtures (make_jpg, mock_nominatim)"
```

---

### Task 3: EXIF read/write module (TDD)

**Files:**
- Create: `geo-tag-photos/scripts/exif_io.py`
- Create: `geo-tag-photos/tests/test_exif.py`

**Interfaces:**
- Consumes: nothing (only uses third-party `piexif`)
- Produces (functions all live in `scripts.exif_io`):
  - `read_gps(path: Path) -> tuple[float, float] | None` — returns decimal `(lat, lon)` if both GPSLatitude and GPSLongitude exist and are non-zero; otherwise `None`.
  - `write_location(path: Path, *, lat: float, lon: float, description: str, user_comment: str) -> None` — writes the four GPS fields, ImageDescription (ASCII, replacing non-ASCII with `?`), UserComment (UTF-16LE with `b"UNICODE\x00"` 8-byte prefix). Preserves all other EXIF.
  - `read_user_comment(path: Path) -> str | None` — decodes UserComment back to a string (used by tests and the `scan` subcommand for verification).
  - `is_jpg(path: Path) -> bool` — true iff suffix is `.jpg` or `.jpeg` (case-insensitive).
  - `EXIFError(Exception)` — raised for non-JPG input or corrupted EXIF.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_exif.py`

```python
"""Tests for EXIF read/write."""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts.exif_io import EXIFError, is_jpg, read_gps, read_user_comment, write_location


def test_is_jpg_accepts_jpg_and_jpeg(tmp_path):
    assert is_jpg(tmp_path / "a.jpg")
    assert is_jpg(tmp_path / "b.JPG")
    assert is_jpg(tmp_path / "c.jpeg")
    assert is_jpg(tmp_path / "d.JPEG")


def test_is_jpg_rejects_other_formats(tmp_path):
    assert not is_jpg(tmp_path / "a.png")
    assert not is_jpg(tmp_path / "b.heic")
    assert not is_jpg(tmp_path / "c.tiff")
    assert not is_jpg(tmp_path / "d.txt")


def test_read_gps_returns_none_for_no_gps(make_jpg, tmp_path):
    p = make_jpg(tmp_path, gps=None)
    assert read_gps(p) is None


def test_read_gps_returns_coordinates_when_present(make_jpg, tmp_path):
    p = make_jpg(tmp_path, gps=(48.8584, 2.2945))
    result = read_gps(p)
    assert result is not None
    lat, lon = result
    assert abs(lat - 48.8584) < 1e-3
    assert abs(lon - 2.2945) < 1e-3


def test_read_gps_handles_southern_western_hemispheres(make_jpg, tmp_path):
    p = make_jpg(tmp_path, gps=(-22.9519, -43.2105))  # Christ the Redeemer
    lat, lon = read_gps(p)
    assert abs(lat + 22.9519) < 1e-3
    assert abs(lon + 43.2105) < 1e-3


def test_write_location_roundtrip(make_jpg, tmp_path):
    p = make_jpg(tmp_path, gps=None)
    write_location(p, lat=40.6892, lon=-74.0445,
                   description="New York, USA",
                   user_comment="confidence=high; landmark=Statue of Liberty")
    lat, lon = read_gps(p)
    assert abs(lat - 40.6892) < 1e-3
    assert abs(lon + 74.0445) < 1e-3
    assert read_user_comment(p) == "confidence=high; landmark=Statue of Liberty"


def test_write_location_preserves_chinese_in_user_comment(make_jpg, tmp_path):
    p = make_jpg(tmp_path, gps=None)
    write_location(p, lat=39.9, lon=116.4,
                   description="Beijing, China",
                   user_comment="confidence=high; landmark=长城")
    assert read_user_comment(p) == "confidence=high; landmark=长城"


def test_write_location_rejects_non_jpg(tmp_path):
    p = tmp_path / "not.png"
    p.write_bytes(b"\x89PNG\r\n\x1a\n")
    with pytest.raises(EXIFError, match="JPG"):
        write_location(p, lat=0, lon=0, description="x", user_comment="y")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_exif.py -v
```

Expected: All tests fail with `ModuleNotFoundError: No module named 'scripts.exif_io'`.

- [ ] **Step 3: Implement `exif_io.py`**

File: `geo-tag-photos/scripts/exif_io.py`

```python
"""EXIF read/write for JPG photos. Only touches GPS + ImageDescription + UserComment."""
from __future__ import annotations

from pathlib import Path

import piexif


class EXIFError(Exception):
    """Raised for non-JPG input or unrecoverable EXIF problems."""


_USER_COMMENT_PREFIX = b"UNICODE\x00"


def is_jpg(path: Path) -> bool:
    return path.suffix.lower() in (".jpg", ".jpeg")


def _rational_to_float(rat: tuple[int, int]) -> float:
    num, den = rat
    return num / den if den else 0.0


def _dms_to_decimal(dms: tuple, ref: bytes) -> float:
    d = _rational_to_float(dms[0])
    m = _rational_to_float(dms[1])
    s = _rational_to_float(dms[2])
    val = d + m / 60.0 + s / 3600.0
    if ref in (b"S", b"W"):
        val = -val
    return val


def _decimal_to_dms_rational(deg: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    abs_deg = abs(deg)
    d = int(abs_deg)
    m_full = (abs_deg - d) * 60
    m = int(m_full)
    s = (m_full - m) * 60
    return ((d, 1), (m, 1), (int(round(s * 10000)), 10000))


def read_gps(path: Path) -> tuple[float, float] | None:
    if not is_jpg(path):
        return None
    try:
        exif = piexif.load(str(path))
    except Exception:
        return None
    gps = exif.get("GPS") or {}
    lat_dms = gps.get(piexif.GPSIFD.GPSLatitude)
    lon_dms = gps.get(piexif.GPSIFD.GPSLongitude)
    lat_ref = gps.get(piexif.GPSIFD.GPSLatitudeRef)
    lon_ref = gps.get(piexif.GPSIFD.GPSLongitudeRef)
    if not (lat_dms and lon_dms and lat_ref and lon_ref):
        return None
    lat = _dms_to_decimal(lat_dms, lat_ref)
    lon = _dms_to_decimal(lon_dms, lon_ref)
    if lat == 0.0 and lon == 0.0:
        return None
    return (lat, lon)


def write_location(
    path: Path,
    *,
    lat: float,
    lon: float,
    description: str,
    user_comment: str,
) -> None:
    if not is_jpg(path):
        raise EXIFError(f"not a JPG: {path}")
    try:
        exif = piexif.load(str(path))
    except Exception as e:
        raise EXIFError(f"cannot read EXIF from {path}: {e}") from e

    gps = exif.get("GPS") or {}
    gps[piexif.GPSIFD.GPSLatitudeRef] = b"N" if lat >= 0 else b"S"
    gps[piexif.GPSIFD.GPSLatitude] = _decimal_to_dms_rational(lat)
    gps[piexif.GPSIFD.GPSLongitudeRef] = b"E" if lon >= 0 else b"W"
    gps[piexif.GPSIFD.GPSLongitude] = _decimal_to_dms_rational(lon)
    exif["GPS"] = gps

    zeroth = exif.get("0th") or {}
    zeroth[piexif.ImageIFD.ImageDescription] = description.encode("ascii", errors="replace")
    exif["0th"] = zeroth

    exif_section = exif.get("Exif") or {}
    exif_section[piexif.ExifIFD.UserComment] = (
        _USER_COMMENT_PREFIX + user_comment.encode("utf-16-le")
    )
    exif["Exif"] = exif_section

    exif_bytes = piexif.dump(exif)
    piexif.insert(exif_bytes, str(path))


def read_user_comment(path: Path) -> str | None:
    if not is_jpg(path):
        return None
    try:
        exif = piexif.load(str(path))
    except Exception:
        return None
    raw = (exif.get("Exif") or {}).get(piexif.ExifIFD.UserComment)
    if not raw:
        return None
    if raw.startswith(_USER_COMMENT_PREFIX):
        return raw[len(_USER_COMMENT_PREFIX):].decode("utf-16-le", errors="replace")
    return raw.decode("utf-8", errors="replace")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_exif.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/scripts/exif_io.py geo-tag-photos/tests/test_exif.py
git commit -m "geo-tag-photos: EXIF read/write with TDD coverage"
```

---

### Task 4: Geocoder module with cache + rate limit (TDD)

**Files:**
- Create: `geo-tag-photos/scripts/geocoder.py`
- Create: `geo-tag-photos/tests/test_geocode.py`

**Interfaces:**
- Consumes: nothing (uses `requests`)
- Produces (in `scripts.geocoder`):
  - `USER_AGENT: str` — module constant `"geo-tag-photos/1.0.0 (https://github.com/ucsdzehualiu/my_openclaw_skill)"`.
  - `MIN_REQUEST_INTERVAL: float = 1.1` — seconds between cache-miss HTTP calls.
  - `GeocodeError(Exception)` — raised after all retries fail.
  - `class Geocoder` with constructor `Geocoder(cache_path: Path, *, session: requests.Session | None = None, sleep_fn=time.sleep, monotonic_fn=time.monotonic)` (the two `*_fn` params let tests stub timing without sleeping).
  - `Geocoder.geocode(landmark: str, city: str, country: str) -> tuple[float, float] | None` — cached lookup; `None` means "no result"; exception means "network failed after retries".
  - `Geocoder.cache` — `dict[str, list[float] | None]` exposed for tests/CLI.
  - `Geocoder.save_cache() -> None` — write to disk atomically (temp file + rename).
  - Cache key built by `_canonical_key(landmark, city, country) -> str`: lowercased, internal whitespace collapsed to single spaces, joined with `"|"`.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_geocode.py`

```python
"""Tests for the Nominatim geocoder + cache + rate limit."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.geocoder import (
    USER_AGENT,
    Geocoder,
    GeocodeError,
    MIN_REQUEST_INTERVAL,
    _canonical_key,
)


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.sleeps: list[float] = []

    def sleep(self, sec: float) -> None:
        self.sleeps.append(sec)
        self.t += sec

    def monotonic(self) -> float:
        return self.t


def _new_geocoder(tmp_path, clock=None):
    clock = clock or FakeClock()
    g = Geocoder(
        tmp_path / "cache.json",
        sleep_fn=clock.sleep,
        monotonic_fn=clock.monotonic,
    )
    return g, clock


def test_canonical_key_lowercases_and_collapses_whitespace():
    assert _canonical_key("Eiffel  Tower", "PARIS", " France ") == "eiffel tower|paris|france"


def test_geocode_cache_miss_writes_cache(tmp_path, mock_nominatim):
    mock_nominatim.responses = {
        "Eiffel Tower, Paris, France": [{"lat": "48.8584", "lon": "2.2945"}]
    }
    g, _ = _new_geocoder(tmp_path)
    result = g.geocode("Eiffel Tower", "Paris", "France")
    assert result == (48.8584, 2.2945)
    g.save_cache()
    saved = json.loads((tmp_path / "cache.json").read_text())
    assert saved["eiffel tower|paris|france"] == [48.8584, 2.2945]


def test_geocode_cache_hit_skips_network(tmp_path, mock_nominatim):
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps({"eiffel tower|paris|france": [48.8584, 2.2945]}))
    g, _ = _new_geocoder(tmp_path)
    result = g.geocode("Eiffel Tower", "Paris", "France")
    assert result == (48.8584, 2.2945)
    assert mock_nominatim.calls == []


def test_geocode_returns_none_when_no_result(tmp_path, mock_nominatim):
    mock_nominatim.responses = {"Nowhere, Nowhere, Nowhere": []}
    g, _ = _new_geocoder(tmp_path)
    assert g.geocode("Nowhere", "Nowhere", "Nowhere") is None


def test_geocode_caches_negative_results(tmp_path, mock_nominatim):
    mock_nominatim.responses = {"Nowhere, Nowhere, Nowhere": []}
    g, _ = _new_geocoder(tmp_path)
    g.geocode("Nowhere", "Nowhere", "Nowhere")
    assert g.geocode("Nowhere", "Nowhere", "Nowhere") is None
    assert len(mock_nominatim.calls) == 1


def test_geocode_rate_limits_between_misses(tmp_path, mock_nominatim):
    mock_nominatim.responses = {
        "A, A, A": [{"lat": "1", "lon": "2"}],
        "B, B, B": [{"lat": "3", "lon": "4"}],
        "C, C, C": [{"lat": "5", "lon": "6"}],
    }
    g, clock = _new_geocoder(tmp_path)
    g.geocode("A", "A", "A")
    g.geocode("B", "B", "B")
    g.geocode("C", "C", "C")
    # First call: no prior request, may sleep 0; later calls must each sleep >= MIN_REQUEST_INTERVAL.
    assert sum(clock.sleeps) >= 2 * MIN_REQUEST_INTERVAL


def test_geocode_user_agent_is_set(tmp_path, mock_nominatim):
    mock_nominatim.responses = {"X, X, X": [{"lat": "0", "lon": "0"}]}
    g, _ = _new_geocoder(tmp_path)
    g.geocode("X", "X", "X")
    assert mock_nominatim.calls[0]["headers"]["User-Agent"] == USER_AGENT


def test_geocode_retries_on_5xx_then_raises(tmp_path, mock_nominatim):
    mock_nominatim.responses = {"X, X, X": {"__status__": 503, "text": "down"}}
    g, _ = _new_geocoder(tmp_path)
    with pytest.raises(GeocodeError):
        g.geocode("X", "X", "X")
    assert len(mock_nominatim.calls) == 3  # exactly 3 attempts
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_geocode.py -v
```

Expected: all fail with `ModuleNotFoundError: No module named 'scripts.geocoder'`.

- [ ] **Step 3: Implement `geocoder.py`**

File: `geo-tag-photos/scripts/geocoder.py`

```python
"""Nominatim-backed geocoder with on-disk cache and OSM-compliant rate limiting."""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Callable

import requests


USER_AGENT = "geo-tag-photos/1.0.0 (https://github.com/ucsdzehualiu/my_openclaw_skill)"
MIN_REQUEST_INTERVAL = 1.1
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
MAX_RETRIES = 3
RETRY_BACKOFF = (2.0, 4.0)  # seconds; sleeps before retry attempts 2 and 3


class GeocodeError(Exception):
    """Raised when Nominatim consistently fails after retries."""


_WS = re.compile(r"\s+")


def _canonical_key(landmark: str, city: str, country: str) -> str:
    parts = [_WS.sub(" ", x.strip().lower()) for x in (landmark, city, country)]
    return "|".join(parts)


class Geocoder:
    def __init__(
        self,
        cache_path: Path,
        *,
        session: requests.Session | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        monotonic_fn: Callable[[], float] = time.monotonic,
    ):
        self.cache_path = Path(cache_path)
        self.session = session
        self._sleep = sleep_fn
        self._monotonic = monotonic_fn
        self._last_request_t: float | None = None
        self.cache: dict[str, list[float] | None] = {}
        self._load_cache()

    def _load_cache(self) -> None:
        if self.cache_path.exists():
            try:
                self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except Exception:
                self.cache = {}

    def save_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.cache_path)

    def _wait_for_slot(self) -> None:
        if self._last_request_t is None:
            self._last_request_t = self._monotonic()
            return
        elapsed = self._monotonic() - self._last_request_t
        remaining = MIN_REQUEST_INTERVAL - elapsed
        if remaining > 0:
            self._sleep(remaining)
        self._last_request_t = self._monotonic()

    def _query_nominatim(self, q: str) -> list[float] | None:
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES):
            self._wait_for_slot()
            try:
                getter = (self.session.get if self.session else requests.get)
                resp = getter(
                    NOMINATIM_URL,
                    params={"q": q, "format": "json", "limit": 1},
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                    timeout=20,
                )
            except requests.RequestException as e:
                last_err = e
            else:
                status = getattr(resp, "status_code", 0)
                if 200 <= status < 300:
                    data = resp.json()
                    if not data:
                        return None
                    item = data[0]
                    return [float(item["lat"]), float(item["lon"])]
                if 400 <= status < 500 and status != 429:
                    raise GeocodeError(f"client error {status} from Nominatim")
                last_err = GeocodeError(f"server status {status}")
            # backoff before retry (only on attempts that aren't the last)
            if attempt < MAX_RETRIES - 1:
                self._sleep(RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1])
        raise GeocodeError(f"failed after {MAX_RETRIES} attempts: {last_err}")

    def geocode(self, landmark: str, city: str, country: str) -> tuple[float, float] | None:
        key = _canonical_key(landmark, city, country)
        if key in self.cache:
            cached = self.cache[key]
            return tuple(cached) if cached else None
        q = f"{landmark.strip()}, {city.strip()}, {country.strip()}"
        result = self._query_nominatim(q)
        self.cache[key] = result
        return tuple(result) if result else None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_geocode.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/scripts/geocoder.py geo-tag-photos/tests/test_geocode.py
git commit -m "geo-tag-photos: Nominatim geocoder with cache + rate limit"
```

---

### Task 5: CLI skeleton + `scan` subcommand (TDD)

**Files:**
- Create: `geo-tag-photos/scripts/photo_geolocator.py`
- Create: `geo-tag-photos/tests/test_cli_scan.py`

**Interfaces:**
- Consumes: `scripts.exif_io.read_gps`, `is_jpg`
- Produces:
  - `main(argv: list[str] | None = None) -> int` — entrypoint, returns exit code (0 ok, 2 user error).
  - Subcommand `scan --dir <path> --out <csv>` — writes CSV with columns `filename,has_gps,lat,lon,note`. `note` is `OK` or `NO_GPS` or `NOT_JPG`. Lists every file in the directory (non-JPG included for visibility, but with `note=NOT_JPG` and empty coords).
  - `_check_dependencies() -> None` — at module import or main() entry, verify `piexif`, `PIL`, `requests` are importable; else print install hint to stderr and `sys.exit(2)`.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_cli_scan.py`

```python
"""Tests for the `scan` CLI subcommand."""
from __future__ import annotations

import csv
from pathlib import Path

from scripts.photo_geolocator import main


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_scan_marks_no_gps_jpg(make_jpg, tmp_path):
    photos = tmp_path / "photos"
    photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    out = tmp_path / "out.csv"
    code = main(["scan", "--dir", str(photos), "--out", str(out)])
    assert code == 0
    rows = _read_csv(out)
    assert len(rows) == 1
    assert rows[0]["filename"] == "a.jpg"
    assert rows[0]["has_gps"] == "no"
    assert rows[0]["note"] == "NO_GPS"


def test_scan_reports_existing_gps(make_jpg, tmp_path):
    photos = tmp_path / "photos"
    photos.mkdir()
    make_jpg(photos, name="b.jpg", gps=(48.8584, 2.2945))
    out = tmp_path / "out.csv"
    main(["scan", "--dir", str(photos), "--out", str(out)])
    row = _read_csv(out)[0]
    assert row["has_gps"] == "yes"
    assert abs(float(row["lat"]) - 48.8584) < 1e-3
    assert abs(float(row["lon"]) - 2.2945) < 1e-3
    assert row["note"] == "OK"


def test_scan_flags_non_jpg(tmp_path):
    photos = tmp_path / "photos"
    photos.mkdir()
    (photos / "weird.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    out = tmp_path / "out.csv"
    main(["scan", "--dir", str(photos), "--out", str(out)])
    row = _read_csv(out)[0]
    assert row["filename"] == "weird.png"
    assert row["note"] == "NOT_JPG"


def test_scan_returns_2_for_missing_dir(tmp_path):
    out = tmp_path / "out.csv"
    code = main(["scan", "--dir", str(tmp_path / "nope"), "--out", str(out)])
    assert code == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_cli_scan.py -v
```

Expected: import error (`photo_geolocator` doesn't exist yet).

- [ ] **Step 3: Implement the CLI skeleton + scan**

File: `geo-tag-photos/scripts/photo_geolocator.py`

```python
"""geo-tag-photos CLI. Subcommands: scan / geocode / report / write / cache."""
from __future__ import annotations

import argparse
import csv
import importlib
import sys
from pathlib import Path

REQUIRED = [("piexif", "piexif"), ("PIL", "Pillow"), ("requests", "requests")]


def _check_dependencies() -> None:
    missing = [pip for mod, pip in REQUIRED if not importlib.util.find_spec(mod)]
    if missing:
        print(
            "[geo-tag-photos] Missing dependencies: "
            + ", ".join(missing)
            + "\nInstall with: pip install -r requirements.txt",
            file=sys.stderr,
        )
        sys.exit(2)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="photo_geolocator", description="Recover GPS for JPG photos.")
    sub = p.add_subparsers(dest="cmd", required=True)

    scan = sub.add_parser("scan", help="Read EXIF for every file in a directory")
    scan.add_argument("--dir", required=True)
    scan.add_argument("--out", required=True)

    return p


def _cmd_scan(args) -> int:
    from scripts.exif_io import is_jpg, read_gps  # noqa: E402

    photo_dir = Path(args.dir)
    if not photo_dir.is_dir():
        print(f"[scan] not a directory: {photo_dir}", file=sys.stderr)
        return 2

    rows: list[dict] = []
    for entry in sorted(photo_dir.iterdir()):
        if not entry.is_file():
            continue
        if not is_jpg(entry):
            rows.append({"filename": entry.name, "has_gps": "no", "lat": "", "lon": "", "note": "NOT_JPG"})
            continue
        gps = read_gps(entry)
        if gps:
            rows.append({"filename": entry.name, "has_gps": "yes", "lat": gps[0], "lon": gps[1], "note": "OK"})
        else:
            rows.append({"filename": entry.name, "has_gps": "no", "lat": "", "lon": "", "note": "NO_GPS"})

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["filename", "has_gps", "lat", "lon", "note"])
        w.writeheader()
        w.writerows(rows)
    print(f"[scan] wrote {len(rows)} rows to {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    _check_dependencies()
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.cmd == "scan":
        return _cmd_scan(args)
    parser.error(f"unknown command: {args.cmd}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/test_cli_scan.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests from Tasks 3, 4, 5 pass (20 passed).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/scripts/photo_geolocator.py geo-tag-photos/tests/test_cli_scan.py
git commit -m "geo-tag-photos: CLI skeleton + scan subcommand"
```

---

### Task 6: `geocode` subcommand (TDD)

**Files:**
- Modify: `geo-tag-photos/scripts/photo_geolocator.py` (add `_cmd_geocode`, register subparser)
- Create: `geo-tag-photos/tests/test_cli_geocode.py`

**Interfaces:**
- Consumes: `scripts.geocoder.Geocoder`
- Produces:
  - Subcommand `geocode --input <ai.json> --out <csv> [--cache <path>]`.
  - Input JSON schema: `[{"filename": "...", "landmark": "...", "city": "...", "country": "...", "confidence": "high|medium|low", "evidence": "..."}, ...]`. Missing `evidence` is allowed (defaults to `""`).
  - Output CSV columns: `filename,landmark,city,country,confidence,evidence,lat,lon,geocode_status`. `geocode_status` is `OK` or `GEOCODE_FAILED` or `NETWORK_ERROR`.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_cli_geocode.py`

```python
"""Tests for the `geocode` CLI subcommand."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from scripts.photo_geolocator import main


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_geocode_writes_coordinates(tmp_path, mock_nominatim):
    mock_nominatim.responses = {
        "Eiffel Tower, Paris, France": [{"lat": "48.8584", "lon": "2.2945"}]
    }
    ai = tmp_path / "ai.json"
    ai.write_text(json.dumps([{
        "filename": "p1.jpg", "landmark": "Eiffel Tower",
        "city": "Paris", "country": "France",
        "confidence": "high", "evidence": "Eiffel tower visible",
    }]), encoding="utf-8")
    out = tmp_path / "geo.csv"
    code = main(["geocode", "--input", str(ai), "--out", str(out),
                 "--cache", str(tmp_path / "cache.json")])
    assert code == 0
    rows = _read_csv(out)
    assert rows[0]["filename"] == "p1.jpg"
    assert abs(float(rows[0]["lat"]) - 48.8584) < 1e-3
    assert rows[0]["geocode_status"] == "OK"


def test_geocode_marks_not_found(tmp_path, mock_nominatim):
    mock_nominatim.responses = {"Atlantis, Atlantis, Atlantis": []}
    ai = tmp_path / "ai.json"
    ai.write_text(json.dumps([{
        "filename": "p2.jpg", "landmark": "Atlantis",
        "city": "Atlantis", "country": "Atlantis",
        "confidence": "low", "evidence": "??",
    }]), encoding="utf-8")
    out = tmp_path / "geo.csv"
    main(["geocode", "--input", str(ai), "--out", str(out),
          "--cache", str(tmp_path / "cache.json")])
    rows = _read_csv(out)
    assert rows[0]["geocode_status"] == "GEOCODE_FAILED"
    assert rows[0]["lat"] == ""


def test_geocode_continues_after_network_error(tmp_path, mock_nominatim, monkeypatch):
    # First entry: server error all the way; second entry: success.
    mock_nominatim.responses = {
        "Bad, Bad, Bad": {"__status__": 503},
        "Eiffel Tower, Paris, France": [{"lat": "48.8584", "lon": "2.2945"}],
    }
    # Speed up: stub time.sleep inside the geocoder
    monkeypatch.setattr("time.sleep", lambda s: None)

    ai = tmp_path / "ai.json"
    ai.write_text(json.dumps([
        {"filename": "p1.jpg", "landmark": "Bad", "city": "Bad", "country": "Bad", "confidence": "high"},
        {"filename": "p2.jpg", "landmark": "Eiffel Tower", "city": "Paris", "country": "France", "confidence": "high"},
    ]), encoding="utf-8")
    out = tmp_path / "geo.csv"
    main(["geocode", "--input", str(ai), "--out", str(out),
          "--cache", str(tmp_path / "cache.json")])
    rows = _read_csv(out)
    assert rows[0]["geocode_status"] == "NETWORK_ERROR"
    assert rows[1]["geocode_status"] == "OK"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli_geocode.py -v
```

Expected: 3 tests fail (subcommand not registered).

- [ ] **Step 3: Add the geocode subparser + handler**

In `geo-tag-photos/scripts/photo_geolocator.py`, add to `_build_parser` after the `scan` subparser:

```python
    geo = sub.add_parser("geocode", help="Resolve landmarks to coordinates")
    geo.add_argument("--input", required=True, help="ai_results.json")
    geo.add_argument("--out", required=True, help="output CSV")
    geo.add_argument("--cache", default=None, help="override default cache path")
```

Add the handler:

```python
def _default_cache_path() -> Path:
    import os
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local")))
        return base / "geo-tag-photos" / "cache.json"
    return Path.home() / ".cache" / "geo-tag-photos" / "cache.json"


def _cmd_geocode(args) -> int:
    import json as _json
    from scripts.geocoder import Geocoder, GeocodeError

    in_path = Path(args.input)
    if not in_path.is_file():
        print(f"[geocode] missing input file: {in_path}", file=sys.stderr)
        return 2
    entries = _json.loads(in_path.read_text(encoding="utf-8"))
    cache_path = Path(args.cache) if args.cache else _default_cache_path()
    g = Geocoder(cache_path)

    rows = []
    for e in entries:
        landmark = e.get("landmark", "").strip()
        city = e.get("city", "").strip()
        country = e.get("country", "").strip()
        row = {
            "filename": e.get("filename", ""),
            "landmark": landmark, "city": city, "country": country,
            "confidence": e.get("confidence", "low"),
            "evidence": e.get("evidence", ""),
            "lat": "", "lon": "", "geocode_status": "",
        }
        if not (landmark and city and country):
            row["geocode_status"] = "GEOCODE_FAILED"
            rows.append(row)
            continue
        try:
            result = g.geocode(landmark, city, country)
        except GeocodeError as err:
            print(f"[geocode] network error for {row['filename']}: {err}", file=sys.stderr)
            row["geocode_status"] = "NETWORK_ERROR"
            rows.append(row)
            continue
        if result is None:
            row["geocode_status"] = "GEOCODE_FAILED"
        else:
            row["lat"], row["lon"] = result
            row["geocode_status"] = "OK"
        rows.append(row)

    g.save_cache()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["filename", "landmark", "city", "country",
                                          "confidence", "evidence", "lat", "lon", "geocode_status"])
        w.writeheader()
        w.writerows(rows)
    print(f"[geocode] wrote {len(rows)} rows to {out}")
    return 0
```

In `main`, add dispatch:

```python
    if args.cmd == "geocode":
        return _cmd_geocode(args)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli_geocode.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add geo-tag-photos/scripts/photo_geolocator.py geo-tag-photos/tests/test_cli_geocode.py
git commit -m "geo-tag-photos: geocode subcommand"
```

---

### Task 7: `report` subcommand (TDD)

**Files:**
- Modify: `geo-tag-photos/scripts/photo_geolocator.py`
- Create: `geo-tag-photos/tests/test_cli_report.py`

**Interfaces:**
- Consumes: outputs of `scan` and `geocode`
- Produces:
  - Subcommand `report --dir <photos> --geocoded <csv> --out <csv>`.
  - Output CSV columns: `filename,existing_lat,existing_lon,landmark,city,country,confidence,evidence,inferred_lat,inferred_lon,action`. `action` is one of:
    - `SKIP_HAS_GPS` — file already has GPS in EXIF
    - `SKIP_NOT_JPG` — file isn't a JPG
    - `SKIP_LOW_CONFIDENCE` — `confidence == "low"`
    - `SKIP_NO_GEOCODE` — geocode_status was GEOCODE_FAILED or NETWORK_ERROR
    - `SKIP_AI_UNKNOWN` — no entry for this filename in geocoded CSV
    - `WRITE` — will be written by the `write` subcommand

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_cli_report.py`

```python
"""Tests for the `report` CLI subcommand."""
from __future__ import annotations

import csv
from pathlib import Path

from scripts.photo_geolocator import main


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _make_geo_csv(path: Path, entries: list[dict]) -> None:
    fields = ["filename", "landmark", "city", "country", "confidence", "evidence",
              "lat", "lon", "geocode_status"]
    _write_csv(path, fields, entries)


def test_report_marks_write_action_for_clean_inference(make_jpg, tmp_path):
    photos = tmp_path / "p"
    photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    geo = tmp_path / "geo.csv"
    _make_geo_csv(geo, [{
        "filename": "a.jpg", "landmark": "Eiffel Tower", "city": "Paris", "country": "France",
        "confidence": "high", "evidence": "tower visible",
        "lat": "48.8584", "lon": "2.2945", "geocode_status": "OK",
    }])
    out = tmp_path / "rep.csv"
    main(["report", "--dir", str(photos), "--geocoded", str(geo), "--out", str(out)])
    row = _read_csv(out)[0]
    assert row["action"] == "WRITE"
    assert row["inferred_lat"] == "48.8584"


def test_report_skips_existing_gps(make_jpg, tmp_path):
    photos = tmp_path / "p"
    photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=(1.0, 2.0))
    geo = tmp_path / "geo.csv"
    _make_geo_csv(geo, [{
        "filename": "a.jpg", "landmark": "X", "city": "X", "country": "X",
        "confidence": "high", "evidence": "", "lat": "1", "lon": "2", "geocode_status": "OK",
    }])
    out = tmp_path / "rep.csv"
    main(["report", "--dir", str(photos), "--geocoded", str(geo), "--out", str(out)])
    assert _read_csv(out)[0]["action"] == "SKIP_HAS_GPS"


def test_report_skips_low_confidence(make_jpg, tmp_path):
    photos = tmp_path / "p"
    photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    geo = tmp_path / "geo.csv"
    _make_geo_csv(geo, [{
        "filename": "a.jpg", "landmark": "X", "city": "X", "country": "X",
        "confidence": "low", "evidence": "", "lat": "1", "lon": "2", "geocode_status": "OK",
    }])
    out = tmp_path / "rep.csv"
    main(["report", "--dir", str(photos), "--geocoded", str(geo), "--out", str(out)])
    assert _read_csv(out)[0]["action"] == "SKIP_LOW_CONFIDENCE"


def test_report_skips_geocode_failed(make_jpg, tmp_path):
    photos = tmp_path / "p"
    photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    geo = tmp_path / "geo.csv"
    _make_geo_csv(geo, [{
        "filename": "a.jpg", "landmark": "X", "city": "X", "country": "X",
        "confidence": "high", "evidence": "", "lat": "", "lon": "", "geocode_status": "GEOCODE_FAILED",
    }])
    out = tmp_path / "rep.csv"
    main(["report", "--dir", str(photos), "--geocoded", str(geo), "--out", str(out)])
    assert _read_csv(out)[0]["action"] == "SKIP_NO_GEOCODE"


def test_report_marks_unknown_for_missing_ai_entry(make_jpg, tmp_path):
    photos = tmp_path / "p"
    photos.mkdir()
    make_jpg(photos, name="orphan.jpg", gps=None)
    geo = tmp_path / "geo.csv"
    _make_geo_csv(geo, [])
    out = tmp_path / "rep.csv"
    main(["report", "--dir", str(photos), "--geocoded", str(geo), "--out", str(out)])
    assert _read_csv(out)[0]["action"] == "SKIP_AI_UNKNOWN"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli_report.py -v
```

Expected: 5 failures (subcommand not registered).

- [ ] **Step 3: Implement the report subcommand**

In `_build_parser`, add after `geocode`:

```python
    rep = sub.add_parser("report", help="Merge scan + geocode into reviewable CSV")
    rep.add_argument("--dir", required=True)
    rep.add_argument("--geocoded", required=True)
    rep.add_argument("--out", required=True)
```

Add the handler:

```python
def _cmd_report(args) -> int:
    from scripts.exif_io import is_jpg, read_gps

    photo_dir = Path(args.dir)
    if not photo_dir.is_dir():
        print(f"[report] not a directory: {photo_dir}", file=sys.stderr)
        return 2
    geo_path = Path(args.geocoded)
    if not geo_path.is_file():
        print(f"[report] missing geocoded CSV: {geo_path}", file=sys.stderr)
        return 2

    geo_by_name: dict[str, dict] = {}
    with geo_path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            geo_by_name[r["filename"]] = r

    rows = []
    for entry in sorted(photo_dir.iterdir()):
        if not entry.is_file():
            continue
        row = {
            "filename": entry.name,
            "existing_lat": "", "existing_lon": "",
            "landmark": "", "city": "", "country": "",
            "confidence": "", "evidence": "",
            "inferred_lat": "", "inferred_lon": "",
            "action": "",
        }
        if not is_jpg(entry):
            row["action"] = "SKIP_NOT_JPG"
            rows.append(row)
            continue
        gps = read_gps(entry)
        if gps:
            row["existing_lat"], row["existing_lon"] = gps
            row["action"] = "SKIP_HAS_GPS"
            rows.append(row)
            continue
        g = geo_by_name.get(entry.name)
        if not g:
            row["action"] = "SKIP_AI_UNKNOWN"
            rows.append(row)
            continue
        row.update({
            "landmark": g["landmark"], "city": g["city"], "country": g["country"],
            "confidence": g["confidence"], "evidence": g.get("evidence", ""),
            "inferred_lat": g["lat"], "inferred_lon": g["lon"],
        })
        if g.get("confidence", "").lower() == "low":
            row["action"] = "SKIP_LOW_CONFIDENCE"
        elif g.get("geocode_status") != "OK":
            row["action"] = "SKIP_NO_GEOCODE"
        else:
            row["action"] = "WRITE"
        rows.append(row)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [
            "filename", "existing_lat", "existing_lon", "landmark", "city", "country",
            "confidence", "evidence", "inferred_lat", "inferred_lon", "action",
        ])
        w.writeheader()
        w.writerows(rows)
    write_count = sum(1 for r in rows if r["action"] == "WRITE")
    print(f"[report] {len(rows)} rows; {write_count} marked WRITE -> {out}")
    return 0
```

In `main`, add dispatch:

```python
    if args.cmd == "report":
        return _cmd_report(args)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli_report.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add geo-tag-photos/scripts/photo_geolocator.py geo-tag-photos/tests/test_cli_report.py
git commit -m "geo-tag-photos: report subcommand"
```

---

### Task 8: `write` subcommand — dry-run + safety gates (TDD)

**Files:**
- Modify: `geo-tag-photos/scripts/photo_geolocator.py`
- Create: `geo-tag-photos/tests/test_cli_write.py`

**Interfaces:**
- Consumes: report CSV from Task 7; `scripts.exif_io.write_location`
- Produces:
  - Subcommand `write --dir <photos> --csv <report> [--write] [--backup-dir <path>] [--include-low] [--overwrite-existing]`.
  - Default behavior: dry-run (prints what would happen, exits 0, files untouched).
  - With `--write`: requires `--backup-dir` (else exits 2). Backup dir must be empty or non-existent (else exits 2). Backup dir must not be inside source (else exits 2). Throws if more than 500 rows have action `WRITE` (else exits 2). Copies each photo to backup before writing (preserves mtime). Writes via `exif_io.write_location`. After all writes, runs an internal verify pass and reports any photos whose written GPS doesn't roundtrip within 1e-3 degrees.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_cli_write.py`

```python
"""Tests for the `write` CLI subcommand: dry-run, safety, write+verify."""
from __future__ import annotations

import csv
from pathlib import Path

from scripts.exif_io import read_gps
from scripts.photo_geolocator import main


def _make_report(path: Path, rows: list[dict]) -> None:
    fields = ["filename", "existing_lat", "existing_lon", "landmark", "city", "country",
              "confidence", "evidence", "inferred_lat", "inferred_lon", "action"]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def _row(filename, lat, lon, action="WRITE", confidence="high", landmark="X", city="Y", country="Z"):
    return {
        "filename": filename, "existing_lat": "", "existing_lon": "",
        "landmark": landmark, "city": city, "country": country,
        "confidence": confidence, "evidence": "",
        "inferred_lat": str(lat), "inferred_lon": str(lon),
        "action": action,
    }


def test_write_default_is_dry_run(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    p = make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 48.8584, 2.2945)])
    mtime = p.stat().st_mtime
    code = main(["write", "--dir", str(photos), "--csv", str(rep)])
    assert code == 0
    assert p.stat().st_mtime == mtime
    assert read_gps(p) is None


def test_write_requires_backup_dir(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 1.0, 2.0)])
    code = main(["write", "--dir", str(photos), "--csv", str(rep), "--write"])
    assert code == 2


def test_write_rejects_non_empty_backup_dir(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 1.0, 2.0)])
    backup = tmp_path / "bak"; backup.mkdir()
    (backup / "junk.txt").write_text("x")
    code = main(["write", "--dir", str(photos), "--csv", str(rep),
                 "--write", "--backup-dir", str(backup)])
    assert code == 2


def test_write_rejects_backup_inside_source(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 1.0, 2.0)])
    code = main(["write", "--dir", str(photos), "--csv", str(rep),
                 "--write", "--backup-dir", str(photos / "inside")])
    assert code == 2


def test_write_rejects_over_500_writes(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    rows = []
    for i in range(501):
        name = f"f{i}.jpg"
        make_jpg(photos, name=name, gps=None)
        rows.append(_row(name, 1.0, 2.0))
    rep = tmp_path / "rep.csv"
    _make_report(rep, rows)
    code = main(["write", "--dir", str(photos), "--csv", str(rep),
                 "--write", "--backup-dir", str(tmp_path / "bak")])
    assert code == 2


def test_write_performs_backup_and_writes(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    p = make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 48.8584, 2.2945)])
    backup = tmp_path / "bak"
    code = main(["write", "--dir", str(photos), "--csv", str(rep),
                 "--write", "--backup-dir", str(backup)])
    assert code == 0
    # original is now tagged
    lat, lon = read_gps(p)
    assert abs(lat - 48.8584) < 1e-3
    # backup copy exists and is untagged (matches the input we made earlier)
    assert (backup / "a.jpg").is_file()
    assert read_gps(backup / "a.jpg") is None


def test_write_skips_non_write_actions(make_jpg, tmp_path):
    photos = tmp_path / "p"; photos.mkdir()
    p = make_jpg(photos, name="a.jpg", gps=None)
    rep = tmp_path / "rep.csv"
    _make_report(rep, [_row("a.jpg", 1.0, 2.0, action="SKIP_LOW_CONFIDENCE", confidence="low")])
    backup = tmp_path / "bak"
    code = main(["write", "--dir", str(photos), "--csv", str(rep),
                 "--write", "--backup-dir", str(backup)])
    assert code == 0
    assert read_gps(p) is None
    # No backup created when there's nothing to write
    assert not backup.exists() or not any(backup.iterdir())
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli_write.py -v
```

Expected: 7 failures (write subcommand not registered).

- [ ] **Step 3: Implement the write subcommand**

In `_build_parser`, add:

```python
    wr = sub.add_parser("write", help="Write GPS into EXIF (default dry-run)")
    wr.add_argument("--dir", required=True)
    wr.add_argument("--csv", required=True)
    wr.add_argument("--write", action="store_true",
                    help="Actually modify files (otherwise dry-run)")
    wr.add_argument("--backup-dir", default=None,
                    help="Required with --write; must be empty or non-existent")
    wr.add_argument("--include-low", action="store_true",
                    help="Also write rows with confidence=low")
    wr.add_argument("--overwrite-existing", action="store_true",
                    help="Override existing GPS in EXIF (default: keep)")
```

Add the handler:

```python
import shutil


WRITE_BATCH_CAP = 500


def _is_path_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _cmd_write(args) -> int:
    from scripts.exif_io import is_jpg, read_gps, write_location

    photo_dir = Path(args.dir)
    if not photo_dir.is_dir():
        print(f"[write] not a directory: {photo_dir}", file=sys.stderr)
        return 2
    csv_path = Path(args.csv)
    if not csv_path.is_file():
        print(f"[write] missing report CSV: {csv_path}", file=sys.stderr)
        return 2

    with csv_path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    actionable: list[dict] = []
    for r in rows:
        if r["action"] == "WRITE":
            actionable.append(r)
        elif r["action"] == "SKIP_LOW_CONFIDENCE" and args.include_low:
            actionable.append(r)
        elif r["action"] == "SKIP_HAS_GPS" and args.overwrite_existing:
            actionable.append(r)

    print(f"[write] {len(actionable)} rows would be written; total rows in report: {len(rows)}")

    if not args.write:
        for r in actionable:
            print(f"  DRY-RUN: {r['filename']} -> ({r['inferred_lat']}, {r['inferred_lon']})")
        print("[write] dry-run only. Pass --write --backup-dir <path> to apply.")
        return 0

    if not args.backup_dir:
        print("[write] --write requires --backup-dir <path>", file=sys.stderr)
        return 2

    backup = Path(args.backup_dir)
    if _is_path_inside(backup, photo_dir):
        print(f"[write] backup dir cannot be inside source dir", file=sys.stderr)
        return 2
    if backup.exists() and any(backup.iterdir()):
        print(f"[write] backup dir is not empty: {backup}", file=sys.stderr)
        return 2

    if len(actionable) > WRITE_BATCH_CAP:
        print(f"[write] {len(actionable)} > {WRITE_BATCH_CAP} cap. Split into batches.",
              file=sys.stderr)
        return 2

    if not actionable:
        return 0

    backup.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    for r in actionable:
        src = photo_dir / r["filename"]
        if not src.is_file() or not is_jpg(src):
            failures.append(f"missing or non-JPG: {r['filename']}")
            continue
        shutil.copy2(src, backup / r["filename"])
        try:
            lat = float(r["inferred_lat"])
            lon = float(r["inferred_lon"])
        except ValueError:
            failures.append(f"bad coords for {r['filename']}")
            continue
        description = f"{r['city']}, {r['country']}"
        user_comment = (
            f"confidence={r['confidence']}; landmark={r['landmark']}; source=geo-tag-photos"
        )
        try:
            write_location(src, lat=lat, lon=lon,
                           description=description, user_comment=user_comment)
        except Exception as e:
            failures.append(f"write failed for {r['filename']}: {e}")
            continue
        # verify
        rb = read_gps(src)
        if rb is None or abs(rb[0] - lat) > 1e-3 or abs(rb[1] - lon) > 1e-3:
            failures.append(f"verify failed for {r['filename']}")

    if failures:
        print("[write] some operations had problems:", file=sys.stderr)
        for line in failures:
            print(f"  - {line}", file=sys.stderr)
        return 1

    print(f"[write] wrote and verified {len(actionable)} photos. Backups in {backup}.")
    return 0
```

In `main`, add dispatch:

```python
    if args.cmd == "write":
        return _cmd_write(args)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli_write.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Run full suite as a smoke check**

```bash
pytest tests/ -v
```

Expected: all tests across Tasks 3-8 pass.

- [ ] **Step 6: Commit**

```bash
git add geo-tag-photos/scripts/photo_geolocator.py geo-tag-photos/tests/test_cli_write.py
git commit -m "geo-tag-photos: write subcommand with dry-run + safety gates"
```

---

### Task 9: `cache` subcommand (TDD)

**Files:**
- Modify: `geo-tag-photos/scripts/photo_geolocator.py`
- Create: `geo-tag-photos/tests/test_cli_cache.py`

**Interfaces:**
- Subcommand `cache --show [--cache <path>]` — prints all entries as JSON to stdout, exits 0.
- Subcommand `cache --clear [--cache <path>]` — deletes the cache file (no error if missing), exits 0.
- Mutually exclusive flags: exactly one of `--show` / `--clear` must be given.

- [ ] **Step 1: Write the failing tests**

File: `geo-tag-photos/tests/test_cli_cache.py`

```python
"""Tests for the `cache` subcommand."""
from __future__ import annotations

import json
from pathlib import Path

from scripts.photo_geolocator import main


def test_cache_show_prints_entries(tmp_path, capsys):
    cache = tmp_path / "cache.json"
    cache.write_text(json.dumps({"a|b|c": [1.0, 2.0]}), encoding="utf-8")
    code = main(["cache", "--show", "--cache", str(cache)])
    assert code == 0
    out = capsys.readouterr().out
    assert '"a|b|c"' in out


def test_cache_show_with_missing_file_prints_empty(tmp_path, capsys):
    code = main(["cache", "--show", "--cache", str(tmp_path / "nope.json")])
    assert code == 0
    out = capsys.readouterr().out
    assert "{}" in out


def test_cache_clear_removes_file(tmp_path):
    cache = tmp_path / "cache.json"
    cache.write_text("{}", encoding="utf-8")
    code = main(["cache", "--clear", "--cache", str(cache)])
    assert code == 0
    assert not cache.exists()


def test_cache_clear_missing_file_is_ok(tmp_path):
    code = main(["cache", "--clear", "--cache", str(tmp_path / "nope.json")])
    assert code == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli_cache.py -v
```

- [ ] **Step 3: Implement the cache subcommand**

In `_build_parser`, add:

```python
    ca = sub.add_parser("cache", help="Inspect or clear the geocode cache")
    grp = ca.add_mutually_exclusive_group(required=True)
    grp.add_argument("--show", action="store_true")
    grp.add_argument("--clear", action="store_true")
    ca.add_argument("--cache", default=None)
```

Add the handler:

```python
def _cmd_cache(args) -> int:
    import json as _json
    cache_path = Path(args.cache) if args.cache else _default_cache_path()
    if args.show:
        if cache_path.exists():
            print(cache_path.read_text(encoding="utf-8"))
        else:
            print("{}")
        return 0
    if args.clear:
        if cache_path.exists():
            cache_path.unlink()
        print(f"[cache] cleared {cache_path}")
        return 0
    return 2
```

In `main`, add dispatch:

```python
    if args.cmd == "cache":
        return _cmd_cache(args)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli_cache.py -v
```

- [ ] **Step 5: Commit**

```bash
git add geo-tag-photos/scripts/photo_geolocator.py geo-tag-photos/tests/test_cli_cache.py
git commit -m "geo-tag-photos: cache inspect/clear subcommand"
```

---

### Task 10: SKILL.md (Claude-facing entry point)

**Files:**
- Create: `geo-tag-photos/SKILL.md`

**Interfaces:**
- Consumes: nothing
- Produces: SKILL.md that triggers correctly, encodes the limits, and walks Claude through the 5-phase workflow with explicit user-confirmation gates.

- [ ] **Step 1: Write SKILL.md**

File: `geo-tag-photos/SKILL.md`

```markdown
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

# geo-tag-photos

Recover GPS metadata for JPG photos. The model identifies landmarks visually,
the script geocodes those landmarks via Nominatim (OpenStreetMap) and writes
the coordinates back into EXIF.

## Use only on your own photos

This skill infers location from visual content. **Do not** use it to track
other people, surveil private individuals, or de-anonymize photos that were
intentionally stripped of location data. Inferred coordinates are best-guess
estimates and **must not** be used for legal, forensic, evidentiary, or
law-enforcement purposes.

## What it can and cannot do

| Can | Cannot |
|---|---|
| Identify global public landmarks (Eiffel, Opera House, Taj Mahal …) | Identify ordinary streets, residences, interiors, plain portraits, generic nature |
| Reach city- / landmark-level precision | Provide street- or building-level precision |
| Process JPG / JPEG | Process HEIC / PNG / TIFF / RAW (convert first) |
| Write GPS + ImageDescription + UserComment | Modify any other EXIF field |
| Handle a few hundred photos at a time | Reliably batch thousands (rate limits + cache hit-rate degrade) |

## Setup

```bash
cd <skill-folder>
pip install -r requirements.txt
```

The script will refuse to run if any of `piexif`, `Pillow`, `requests` is
missing.

## Workflow (5 phases)

You must walk the user through these phases in order. Each phase has a clear
output the user can inspect.

### Phase 1: scan

Identify which photos already have GPS (skip them) and which need inference.

```bash
python scripts/photo_geolocator.py scan --dir <photos> --out exif_status.csv
```

Read the CSV: any row with `note=NO_GPS` is a candidate for inference.
Anything with `note=NOT_JPG` must be skipped (or converted by the user first).

### Phase 2: AI vision (you do this directly)

For every JPG with `NO_GPS`, use the `Read` tool to view the image and extract:

- `landmark` — the landmark name (e.g. "Eiffel Tower"). If no recognizable
  landmark, leave empty.
- `city` — best-guess city, or empty.
- `country` — best-guess country, or empty.
- `confidence` — `high` / `medium` / `low`. Be honest. `low` rows will be
  skipped on write by default.
- `evidence` — short text: visual cues you used (architecture style, signage
  language, flags, geography).

Aggregate into a JSON file `ai_results.json`:

```json
[
  {"filename": "p1.jpg", "landmark": "Eiffel Tower", "city": "Paris",
   "country": "France", "confidence": "high", "evidence": "Iron lattice tower visible"},
  {"filename": "p2.jpg", "landmark": "", "city": "", "country": "",
   "confidence": "low", "evidence": "interior, no landmarks"}
]
```

Photos with no recognizable landmark: set `confidence: low` and empty
strings. The pipeline will skip them on write.

### Phase 3: geocode

```bash
python scripts/photo_geolocator.py geocode --input ai_results.json --out geocoded.csv
```

This calls Nominatim (rate-limited to 1 req / 1.1 s) and caches results
locally. Failures are recorded in the CSV — they do not stop the run.

### Phase 4: report

```bash
python scripts/photo_geolocator.py report \
  --dir <photos> --geocoded geocoded.csv --out report.csv
```

The report shows every photo and what action will be taken: `WRITE`,
`SKIP_HAS_GPS`, `SKIP_NOT_JPG`, `SKIP_LOW_CONFIDENCE`, `SKIP_NO_GEOCODE`,
`SKIP_AI_UNKNOWN`.

**Show the report path to the user. Tell them to review it. Wait for explicit
confirmation before phase 5.**

### Phase 5: write (only after user confirms)

First, dry-run to print the planned changes (no files modified):

```bash
python scripts/photo_geolocator.py write --dir <photos> --csv report.csv
```

Then, after user confirmation, the real write:

```bash
python scripts/photo_geolocator.py write --dir <photos> --csv report.csv \
  --write --backup-dir <photos>.bak
```

`--backup-dir` is mandatory and the script refuses if it's non-empty or
inside the source directory. Maximum 500 photos per invocation.

After writing, run `scan` again and compare to the report. The script also
verifies internally and reports any roundtrip mismatches.

## Hard limits enforced by the script

- JPG-only — non-JPG files are listed in scan but never written
- `--write` without `--backup-dir` → exit code 2
- Backup dir must be empty or non-existent → exit code 2
- Backup dir cannot be inside source dir → exit code 2
- Maximum 500 photos per `write` invocation → exit code 2
- `confidence: low` rows skipped unless `--include-low`
- Photos that already have GPS skipped unless `--overwrite-existing` (with
  warning)

## Privacy

The script sends only text (`landmark, city, country`) to Nominatim.
**Photos never leave your machine via the script.** The AI vision step
happens inside your Claude session; whether the photos leave the machine for
that step is governed by your Claude setup, not by this skill.

## Troubleshooting

- **Geocoding returns wrong coordinates.** Nominatim is fuzzy with ambiguous
  names (e.g. "Springfield"). Refine the AI step: include city + country
  with the landmark.
- **Cache holds bad entries.** `python scripts/photo_geolocator.py cache --clear`
- **`exif_io.EXIFError: not a JPG`.** Convert your HEIC / PNG / TIFF / RAW to
  JPG first (e.g. `magick mogrify -format jpg *.heic`).
- **Many photos report SKIP_AI_UNKNOWN.** Phase 2 didn't emit entries for
  every photo — re-run vision for the missing ones.
```

- [ ] **Step 2: Verify SKILL.md frontmatter is parseable**

```bash
python -c "
import re, pathlib
text = pathlib.Path('geo-tag-photos/SKILL.md').read_text(encoding='utf-8')
m = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
assert m, 'no frontmatter delimiters'
fm = m.group(1)
# minimal sanity: must have name, description, version
for key in ('name:', 'description:', 'version:'):
    assert key in fm, f'missing {key}'
print('frontmatter ok')
"
```

Expected: `frontmatter ok`.

- [ ] **Step 3: Commit**

```bash
git add geo-tag-photos/SKILL.md
git commit -m "geo-tag-photos: SKILL.md with limits and 5-phase workflow"
```

---

### Task 11: README.md (human-facing)

**Files:**
- Create: `geo-tag-photos/README.md`

**Interfaces:** none new; restates SKILL.md material in human-facing tone with installation, quickstart, and a real example transcript.

- [ ] **Step 1: Write README**

File: `geo-tag-photos/README.md`

```markdown
# geo-tag-photos

> Recover lost GPS metadata for JPG photos by recognizing landmarks via
> vision, then writing GPS coordinates back into EXIF.

This is a [ClawHub](https://clawhub.app) Claude skill, mirrored on GitHub.
Use it when you have a directory of JPGs whose GPS got stripped by
backups / phone exports / cloud sync, and the photos contain recognizable
landmarks.

## Use only on your own photos

This skill infers location from visual content. Do not use it to track
people, surveil others, or de-anonymize photos that were intentionally
stripped of location data. Inferred coordinates are best-guess estimates
and **must not** be used for legal, forensic, or evidentiary purposes.

## Install

```bash
git clone https://github.com/ucsdzehualiu/my_openclaw_skill.git
cd my_openclaw_skill/geo-tag-photos
pip install -r requirements.txt
```

Or via ClawHub CLI:

```bash
clawhub install geo-tag-photos
```

## Quickstart

The skill drives Claude through a 5-phase workflow. From a Claude Code
session in a folder containing JPG photos:

```
> use geo-tag-photos to add GPS to my photos in ~/photos
```

Claude will:

1. Scan the directory.
2. Look at each photo and propose `landmark / city / country / confidence`.
3. Geocode the inferences via Nominatim.
4. Build a `report.csv`. **It will pause here and ask you to review.**
5. After your confirmation, write GPS into EXIF (with mandatory backup).

## What it can do

- Recognize global public landmarks (Eiffel Tower, Sydney Opera House, Taj
  Mahal, etc.)
- City- / landmark-level GPS precision
- Process JPG / JPEG (HEIC / PNG / TIFF / RAW: convert first)

## What it cannot do

- Identify ordinary streets, residences, interiors, plain portraits, generic
  nature
- Provide street- or building-level precision
- Modify any EXIF field other than the four we explicitly write
  (`GPSLatitude`, `GPSLongitude`, `ImageDescription`, `UserComment`)

## Safety: dry-run by default

The `write` subcommand is dry-run by default. Real writes require **both**
`--write` **and** `--backup-dir`. The script refuses if:

- `--backup-dir` is missing
- the backup directory is non-empty
- the backup directory is inside the source directory
- more than 500 photos would be written in one go
- the photo isn't a JPG

After every successful write, the script reads the GPS back and reports any
roundtrip mismatches.

## Privacy

The script sends only text (`landmark, city, country`) to Nominatim. **It
never uploads photos.** The AI vision step happens inside your Claude
session; whether photos leave the machine in that step is governed by your
Claude setup, not by this skill.

## Manual CLI

If you want to drive the script outside a Claude session:

```bash
# 1. Scan
python scripts/photo_geolocator.py scan --dir ~/photos --out exif_status.csv

# 2. Build ai_results.json yourself (or by hand-editing — schema in SKILL.md)

# 3. Geocode
python scripts/photo_geolocator.py geocode \
  --input ai_results.json --out geocoded.csv

# 4. Build report
python scripts/photo_geolocator.py report \
  --dir ~/photos --geocoded geocoded.csv --out report.csv

# 5. Dry-run
python scripts/photo_geolocator.py write --dir ~/photos --csv report.csv

# 6. Real write (after reviewing report)
python scripts/photo_geolocator.py write --dir ~/photos --csv report.csv \
  --write --backup-dir ~/photos.bak

# Cache maintenance
python scripts/photo_geolocator.py cache --show
python scripts/photo_geolocator.py cache --clear
```

## Tests

```bash
pip install -r requirements.txt
pytest tests/ -v
```

End-to-end test on real public landmark photos:

```bash
python e2e/fetch_landmarks.py        # downloads 8 public-domain landmarks
# follow e2e/README.md for the rest
```

## License

MIT — see `LICENSE`.
```

- [ ] **Step 2: Commit**

```bash
git add geo-tag-photos/README.md
git commit -m "geo-tag-photos: README"
```

---

### Task 12: End-to-end harness — `fetch_landmarks.py` + e2e README

**Files:**
- Create: `geo-tag-photos/e2e/fetch_landmarks.py`
- Create: `geo-tag-photos/e2e/README.md`
- Create: `geo-tag-photos/e2e/canonical_coords.json` (truth values for the verify step)

**Interfaces:**
- `fetch_landmarks.py` is run once: downloads 8 public-domain Wikimedia images, strips ALL EXIF (so they look like "GPS lost" inputs), saves to `e2e/landmarks/`. The directory is `.gitignore`d.
- `canonical_coords.json` carries the ground-truth `(lat, lon)` for each landmark so the verifier in Task 13 can check the written GPS is within 5 km.

- [ ] **Step 1: Write `fetch_landmarks.py`**

File: `geo-tag-photos/e2e/fetch_landmarks.py`

```python
"""Download 8 public-domain landmark photos from Wikimedia and strip EXIF.

Run once before executing the end-to-end test.

The exact Wikimedia thumbnail URLs are pinned to keep the test reproducible.
If Wikimedia rotates the underlying file, update the URL here and bump the
filename mapping below.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path
from urllib.request import Request, urlopen

import piexif
from PIL import Image


# (filename in e2e/landmarks/, source URL on Wikimedia thumbnails)
LANDMARKS = [
    ("01_eiffel.jpg",   "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/640px-Tour_Eiffel_Wikimedia_Commons.jpg"),
    ("02_liberty.jpg",  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Statue_of_Liberty_7.jpg/640px-Statue_of_Liberty_7.jpg"),
    ("03_opera.jpg",    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Sydney_Opera_House_-_Dec_2008.jpg/640px-Sydney_Opera_House_-_Dec_2008.jpg"),
    ("04_greatwall.jpg","https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/The_Great_Wall_of_China_at_Jinshanling-edit.jpg/640px-The_Great_Wall_of_China_at_Jinshanling-edit.jpg"),
    ("05_tajmahal.jpg", "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/640px-Taj_Mahal_%28Edited%29.jpeg"),
    ("06_colosseum.jpg","https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/640px-Colosseo_2020.jpg"),
    ("07_christ.jpg",   "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Christ_the_Redeemer_-_Cristo_Redentor.jpg/640px-Christ_the_Redeemer_-_Cristo_Redentor.jpg"),
    ("08_bigben.jpg",   "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/London_Parliament_2007-1.jpg/640px-London_Parliament_2007-1.jpg"),
]

USER_AGENT = "geo-tag-photos-e2e/1.0 (https://github.com/ucsdzehualiu/my_openclaw_skill)"


def _download(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=60) as resp:
        return resp.read()


def _strip_exif_to_jpg(blob: bytes, dest: Path) -> None:
    img = Image.open(io.BytesIO(blob)).convert("RGB")
    # Strip everything by saving without exif=, then verify with piexif.
    img.save(dest, "JPEG", quality=88)
    # Belt and braces: explicitly remove any residual EXIF.
    try:
        piexif.remove(str(dest))
    except Exception:
        pass


def main() -> int:
    out_dir = Path(__file__).parent / "landmarks"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, url in LANDMARKS:
        target = out_dir / name
        if target.exists():
            print(f"[skip] {name} (already exists)")
            continue
        print(f"[get ] {name}")
        try:
            blob = _download(url)
        except Exception as e:
            print(f"[fail] {name}: {e}", file=sys.stderr)
            return 1
        _strip_exif_to_jpg(blob, target)
        print(f"[ok  ] {target}")
    print(f"\nDone. Landmarks at: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Write the canonical coordinates file**

File: `geo-tag-photos/e2e/canonical_coords.json`

```json
{
  "01_eiffel.jpg":    {"lat": 48.8584, "lon":   2.2945, "name": "Eiffel Tower",          "city": "Paris",          "country": "France"},
  "02_liberty.jpg":   {"lat": 40.6892, "lon": -74.0445, "name": "Statue of Liberty",     "city": "New York",       "country": "USA"},
  "03_opera.jpg":     {"lat":-33.8568, "lon": 151.2153, "name": "Sydney Opera House",    "city": "Sydney",         "country": "Australia"},
  "04_greatwall.jpg": {"lat": 40.6800, "lon": 117.2326, "name": "Great Wall of China",   "city": "Beijing",        "country": "China"},
  "05_tajmahal.jpg":  {"lat": 27.1751, "lon":  78.0421, "name": "Taj Mahal",             "city": "Agra",           "country": "India"},
  "06_colosseum.jpg": {"lat": 41.8902, "lon":  12.4922, "name": "Colosseum",             "city": "Rome",           "country": "Italy"},
  "07_christ.jpg":    {"lat":-22.9519, "lon": -43.2105, "name": "Christ the Redeemer",   "city": "Rio de Janeiro", "country": "Brazil"},
  "08_bigben.jpg":    {"lat": 51.5007, "lon":  -0.1246, "name": "Elizabeth Tower",       "city": "London",         "country": "UK"}
}
```

- [ ] **Step 3: Write the e2e README**

File: `geo-tag-photos/e2e/README.md`

```markdown
# End-to-end test

This harness validates the full pipeline against 8 real public-domain
landmark photos.

## Setup

```bash
cd geo-tag-photos
pip install -r requirements.txt
python e2e/fetch_landmarks.py
```

That downloads 8 photos to `e2e/landmarks/` and strips their EXIF (so the
pipeline sees the same "GPS-lost" input a real user has).

`e2e/landmarks/` and `e2e/landmarks.bak/` are gitignored.

## Run the pipeline

```bash
# Phase 1: scan — all 8 should report NO_GPS
python scripts/photo_geolocator.py scan \
  --dir e2e/landmarks --out e2e/exif_status.csv

# Phase 2: AI vision — done in a Claude session.
# Build e2e/ai_results.json by hand or via Claude. Or: copy
# e2e/canonical_coords.json into ai_results.json and add confidence=high.

# Phase 3: geocode (real Nominatim call — be patient, ~10 s)
python scripts/photo_geolocator.py geocode \
  --input e2e/ai_results.json --out e2e/geocoded.csv

# Phase 4: report
python scripts/photo_geolocator.py report \
  --dir e2e/landmarks --geocoded e2e/geocoded.csv --out e2e/report.csv

# Phase 5a: dry-run
python scripts/photo_geolocator.py write \
  --dir e2e/landmarks --csv e2e/report.csv

# Phase 5b: real write (with backup)
python scripts/photo_geolocator.py write \
  --dir e2e/landmarks --csv e2e/report.csv \
  --write --backup-dir e2e/landmarks.bak
```

## Verify the result

```bash
python e2e/verify.py
```

Pass criteria: each of the 8 photos has GPS within 5 km of
`canonical_coords.json`, and `e2e/landmarks.bak/` contains 8 untagged copies.
```

- [ ] **Step 4: Commit**

```bash
git add geo-tag-photos/e2e/fetch_landmarks.py geo-tag-photos/e2e/canonical_coords.json geo-tag-photos/e2e/README.md
git commit -m "geo-tag-photos: e2e harness (fetch, canonical coords, README)"
```

---

### Task 13: End-to-end verifier + run

**Files:**
- Create: `geo-tag-photos/e2e/verify.py`

**Interfaces:**
- `verify.py` reads `canonical_coords.json`, walks `e2e/landmarks/`, reads each photo's GPS via `scripts.exif_io.read_gps`, computes great-circle distance to canonical, prints a table, and exits 0 iff every photo is within 5 km AND the backup directory holds 8 untagged copies.

- [ ] **Step 1: Write `verify.py`**

File: `geo-tag-photos/e2e/verify.py`

```python
"""Verify the end-to-end pipeline result.

Reports the geographic distance between each photo's written GPS and the
canonical coordinate. Pass criteria: all 8 within 5 km, backup intact.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# Allow running from skill root or e2e/
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from scripts.exif_io import read_gps  # noqa: E402


THRESHOLD_KM = 5.0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    d_lat = lat2 - lat1
    d_lon = lon2 - lon1
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def main() -> int:
    canonical = json.loads((HERE / "canonical_coords.json").read_text(encoding="utf-8"))
    landmarks = HERE / "landmarks"
    backup = HERE / "landmarks.bak"

    if not landmarks.is_dir():
        print(f"[fail] missing {landmarks}; run fetch_landmarks.py first", file=sys.stderr)
        return 2

    print(f"{'file':<22} {'expected':<22} {'got':<22} {'dist_km':>8}  status")
    fail = 0
    for name, ref in canonical.items():
        photo = landmarks / name
        if not photo.exists():
            print(f"{name:<22} {'-':<22} {'MISSING':<22} {'-':>8}  FAIL")
            fail += 1
            continue
        got = read_gps(photo)
        if got is None:
            print(f"{name:<22} ({ref['lat']:.4f}, {ref['lon']:.4f}) {'NO_GPS':<22} {'-':>8}  FAIL")
            fail += 1
            continue
        d = haversine_km((ref["lat"], ref["lon"]), got)
        ok = d <= THRESHOLD_KM
        status = "OK" if ok else "FAIL"
        print(f"{name:<22} ({ref['lat']:7.4f}, {ref['lon']:8.4f}) ({got[0]:7.4f}, {got[1]:8.4f}) {d:8.2f}  {status}")
        if not ok:
            fail += 1

    # backup integrity
    if backup.is_dir():
        backup_files = sorted(p.name for p in backup.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
        bad_backup = [n for n in backup_files if read_gps(backup / n) is not None]
        if bad_backup:
            print(f"[fail] backup files unexpectedly have GPS: {bad_backup}")
            fail += len(bad_backup)
        if len(backup_files) != len(canonical):
            print(f"[fail] backup count {len(backup_files)} != expected {len(canonical)}")
            fail += 1
    else:
        print("[warn] no backup dir to verify (skip if you only ran dry-run)")

    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Execute the end-to-end pipeline**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
python e2e/fetch_landmarks.py
python scripts/photo_geolocator.py scan \
  --dir e2e/landmarks --out e2e/exif_status.csv
```

The implementing agent (Claude) now performs Phase 2 by viewing each photo
in `e2e/landmarks/` with the `Read` tool and writing `e2e/ai_results.json`.
For deterministic verification, the implementing agent may instead derive
`ai_results.json` directly from `canonical_coords.json`, marking every entry
as `confidence: high`. Use the canonical-derived path for the automated
end-to-end run; reserve the vision-derived path for manual demos.

```bash
python -c "
import json, pathlib
ref = json.loads(pathlib.Path('e2e/canonical_coords.json').read_text(encoding='utf-8'))
out = [
    {'filename': k, 'landmark': v['name'], 'city': v['city'],
     'country': v['country'], 'confidence': 'high', 'evidence': 'canonical (E2E)'}
    for k, v in ref.items()
]
pathlib.Path('e2e/ai_results.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print('wrote ai_results.json')
"

python scripts/photo_geolocator.py geocode \
  --input e2e/ai_results.json --out e2e/geocoded.csv
python scripts/photo_geolocator.py report \
  --dir e2e/landmarks --geocoded e2e/geocoded.csv --out e2e/report.csv
python scripts/photo_geolocator.py write \
  --dir e2e/landmarks --csv e2e/report.csv
python scripts/photo_geolocator.py write \
  --dir e2e/landmarks --csv e2e/report.csv \
  --write --backup-dir e2e/landmarks.bak
python e2e/verify.py
```

- [ ] **Step 3: Confirm verifier exits 0**

Expected: `verify.py` prints a table where every row's `dist_km` ≤ 5.0 and
status is `OK`, then exits 0.

If the verifier reports a row > 5 km: investigate. Common causes:
- Nominatim returned a different point for an ambiguous landmark name. Add
  more specifics in the canonical entry (e.g. "Great Wall — Jinshanling" if
  Nominatim resolved the wrong section).
- A photo failed to roundtrip — re-run write and check stderr for the
  failure message.

Iterate until verify.py returns 0.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git add geo-tag-photos/e2e/verify.py
git commit -m "geo-tag-photos: e2e verifier"
```

---

### Task 14: ClawHub scan + remediation

**Files:** none (scan-driven changes go into the appropriate scripts/SKILL.md if findings come up)

- [ ] **Step 1: Run the scanner**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
clawhub scan ./geo-tag-photos > geo-tag-photos/clawhub_scan.txt
cat geo-tag-photos/clawhub_scan.txt
```

- [ ] **Step 2: Review and fix actionable findings**

For each finding, decide:

- **Fix it** if it's a real concern (auto-install, hardcoded credentials,
  unrestricted file deletion, network exfiltration). Make the change.
- **Document the trade-off** if the finding is a false positive or
  intentional (e.g. the script does write to user-specified paths — that's
  the point). Add a comment in the affected file plus a one-line entry in a
  new section "Known scan findings" at the bottom of `SKILL.md`.

- [ ] **Step 3: Re-run scan after fixes**

```bash
clawhub scan ./geo-tag-photos
```

The deliverable does **not** require a fully green scan, but every red /
yellow finding must either be fixed or have a documented justification.

- [ ] **Step 4: Commit any fixes**

```bash
git add geo-tag-photos/
git commit -m "geo-tag-photos: address ClawHub scan findings"
```

(If no changes were needed, skip this commit.)

---

### Task 15: Publish to GitHub and ClawHub

**Files:** none new

- [ ] **Step 1: Verify clean state and full test run**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill/geo-tag-photos"
pytest tests/ -v
python e2e/verify.py
```

Expected: pytest all green; verify.py exits 0.

- [ ] **Step 2: Push to GitHub**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
git status               # confirm only intended changes
git log --oneline -10    # confirm commit history is sensible
git push origin main
```

- [ ] **Step 3: Authenticate to ClawHub if needed**

```bash
clawhub whoami
```

Expected: prints `ucsdzehualiu`. If it instead prints "no token", run
`clawhub login` and follow prompts.

- [ ] **Step 4: Publish to ClawHub**

```bash
cd "C:/Users/57030/Desktop/我的项目/my_openclaw_skill"
clawhub publish ./geo-tag-photos
```

- [ ] **Step 5: Confirm registry entry**

```bash
clawhub inspect geo-tag-photos
```

Expected: shows `version: 1.0.0`, the description from SKILL.md, and the
file list.

- [ ] **Step 6: Final commit (if any post-publish metadata changed)**

```bash
git status
# If anything was modified by publish (e.g. a generated manifest), commit it.
git add -A
git diff --cached  # review before committing
git commit -m "geo-tag-photos: post-publish metadata" || true
git push origin main
```

---

## Self-Review

This section was completed during plan authoring; it's left here so
implementing agents can reference it.

**Spec coverage** (each spec section → task that implements it):

| Spec | Task |
|---|---|
| § 3.1 Directory layout | 1 (skeleton), then files materialize in 3-13 |
| § 3.2 Workflow | SKILL.md (10) + scripts created in 3-9 |
| § 3.3 CLI surface | scan (5), geocode (6), report (7), write (8), cache (9) |
| § 3.4 EXIF fields written | 3 (exif_io) + 8 (write subcommand) |
| § 4.1 Ethical limits | SKILL.md (10) + README (11) |
| § 4.2 Capability boundaries | SKILL.md (10) + README (11) |
| § 4.3 Runtime hard limits | 8 (write safety tests) |
| § 4.4 Privacy / network | SKILL.md (10) + README (11); enforced by 4 (sends only text) |
| § 4.5 Failure modes | 6 (NETWORK_ERROR), 7 (report SKIP_*), 8 (write verify) |
| § 5 Dependencies | 1 (requirements.txt) + 5 (`_check_dependencies`) |
| § 6.1 Unit tests | 3, 4, 5, 6, 7, 8, 9 |
| § 6.2 End-to-end test | 12 (harness) + 13 (verifier + run) |
| § 6.3 ClawHub scan | 14 |
| § 7 Publish workflow | 15 |
| § 8 SKILL.md frontmatter | 10 |

**Placeholder scan:** no TBDs, every step has concrete code or commands.
**Type consistency:** `Geocoder.geocode` returns `tuple[float, float] | None`
across Tasks 4, 6; `read_gps` signature matches across Tasks 3, 5, 7, 8, 13;
`write_location` keyword args match across Tasks 3, 8.

