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

    geo = sub.add_parser("geocode", help="Resolve landmarks to coordinates")
    geo.add_argument("--input", required=True, help="ai_results.json")
    geo.add_argument("--out", required=True, help="output CSV")
    geo.add_argument("--cache", default=None, help="override default cache path")

    rep = sub.add_parser("report", help="Merge scan + geocode into reviewable CSV")
    rep.add_argument("--dir", required=True)
    rep.add_argument("--geocoded", required=True)
    rep.add_argument("--out", required=True)

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


def main(argv: list[str] | None = None) -> int:
    _check_dependencies()
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.cmd == "scan":
        return _cmd_scan(args)
    if args.cmd == "geocode":
        return _cmd_geocode(args)
    if args.cmd == "report":
        return _cmd_report(args)
    parser.error(f"unknown command: {args.cmd}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
