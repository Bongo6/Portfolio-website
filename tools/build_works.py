#!/usr/bin/env python3
"""
Builds the site's works from the works/ folder. Run it by double-clicking
update.bat in the site folder (or: py -3 tools/build_works.py).

Every folder inside works/ is one work on the site:

    works/
      Reload animation M1 Garand/     <- folder name = the title on the site
        1.mp4                         <- photos/videos, shown in name order
        2.jpg
        description.txt               <- one bullet per line
        programs.txt                  <- optional, e.g. "Blender, Photoshop"
        date.txt                      <- optional, YYYY-MM-DD (newest first)
        title.txt                     <- optional, overrides the folder name
        category.txt                  <- optional, which category wheel it's on

Folders starting with "_" are skipped, so renaming a folder to
"_Something" hides it from the site without deleting anything.

For each photo/video this makes a small preview (works/<work>/_previews/)
for the spinning ring, and a lighter web copy (works/<work>/_web/) for
huge photos and for videos browsers can't play (.mov etc.). Originals are
never touched. Everything is cached, so re-running only does new work.
Finally it writes works.json, which script.js reads to build the cards.
"""
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
WORKS_DIR = ROOT / "works"
OUT_FILE = ROOT / "works.json"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".m4v", ".mov", ".mkv", ".avi"}
BROWSER_VIDEO_EXT = {".mp4", ".webm", ".m4v"}  # anything else gets an .mp4 web copy

PREVIEW_WIDTH = 480          # ring card previews
WEB_IMAGE_MAX = 2560         # longest side of web copies of huge photos
WEB_IMAGE_MIN_BYTES = 3 * 1024 * 1024  # photos smaller than this are used as-is
WEB_VIDEO_MAX_WIDTH = 1920

try:
    sys.stdout.reconfigure(errors="replace")
except Exception:  # very old Python — printing still works, just less safely
    pass

FFMPEG = shutil.which("ffmpeg")


def natural_key(name):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def read_text(path):
    """Reads a .txt whether Notepad saved it as UTF-8 or as old 'ANSI'."""
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc).replace("\r\n", "\n").replace("\r", "\n").strip()
        except UnicodeDecodeError:
            continue
    return ""


def url(*segments):
    """Builds a site-relative URL, escaping spaces/accents in folder names."""
    return "/".join(quote(seg, safe="") for seg in segments)


def is_fresh(out_path, src_path):
    return out_path.exists() and out_path.stat().st_mtime >= src_path.stat().st_mtime


def run_ffmpeg(args):
    result = subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return result.returncode == 0


def make_preview(src, out, is_video):
    if is_fresh(out, src):
        return True
    out.parent.mkdir(exist_ok=True)
    scale = f"scale='min({PREVIEW_WIDTH},iw)':-2"
    if is_video:
        # A frame 1s in is usually more representative than the very first
        # (often black) frame; fall back to the start for very short clips.
        for seek in ("1", "0"):
            if run_ffmpeg(["-ss", seek, "-i", str(src), "-frames:v", "1", "-vf", scale, "-q:v", "4", str(out)]) and out.exists():
                return True
        return False
    return run_ffmpeg(["-i", str(src), "-frames:v", "1", "-vf", scale, "-q:v", "4", str(out)]) and out.exists()


def make_web_copy(src, work_dir, is_video):
    """Returns the path of a lighter copy to serve instead of src, or None."""
    ext = src.suffix.lower()
    if is_video:
        if ext in BROWSER_VIDEO_EXT:
            return None
        out = work_dir / "_web" / (src.name + ".mp4")
        if is_fresh(out, src):
            return out
        out.parent.mkdir(exist_ok=True)
        print(f"    converting {src.name} to .mp4 (can take a minute)...")
        ok = run_ffmpeg([
            "-i", str(src),
            "-vf", f"scale='trunc(min({WEB_VIDEO_MAX_WIDTH},iw)/2)*2':-2",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            str(out),
        ])
        return out if ok and out.exists() else None
    if ext == ".gif" or src.stat().st_size < WEB_IMAGE_MIN_BYTES:
        return None
    out = work_dir / "_web" / (src.stem + ".jpg")
    if is_fresh(out, src):
        return out
    out.parent.mkdir(exist_ok=True)
    ok = run_ffmpeg([
        "-i", str(src), "-frames:v", "1",
        "-vf", f"scale=w='min({WEB_IMAGE_MAX},iw)':h='min({WEB_IMAGE_MAX},ih)':force_original_aspect_ratio=decrease",
        "-q:v", "3", str(out),
    ])
    return out if ok and out.exists() else None


def folder_created(path):
    st = path.stat()
    created = getattr(st, "st_birthtime", None)
    if created is None:
        created = st.st_ctime if os.name == "nt" else st.st_mtime
    return datetime.datetime.fromtimestamp(created)


def parse_date(text):
    match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", text or "")
    if not match:
        return None
    try:
        return datetime.datetime(*(int(g) for g in match.groups()))
    except ValueError:
        return None


def load_previous():
    try:
        data = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        return {w.get("dir"): w for w in data if isinstance(w, dict)}
    except Exception:
        return {}


def build_work(work_dir, previous):
    media = sorted(
        (p for p in work_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXT | VIDEO_EXT),
        key=lambda p: natural_key(p.name),
    )
    if not media:
        return None

    items = []
    for src in media:
        is_video = src.suffix.lower() in VIDEO_EXT
        preview = None
        served = src
        if FFMPEG:
            web = make_web_copy(src, work_dir, is_video)
            if web:
                served = web
            preview_path = work_dir / "_previews" / (src.name + ".jpg")
            if make_preview(served, preview_path, is_video):
                preview = url("works", work_dir.name, "_previews", preview_path.name)
            else:
                print(f"    ! couldn't make a preview for {src.name}")
        rel = served.relative_to(work_dir).parts
        items.append({
            "src": url("works", work_dir.name, *rel),
            "type": "video" if is_video else "image",
            "preview": preview,
        })

    title_file = work_dir / "title.txt"
    title = read_text(title_file) if title_file.exists() else ""
    title = title.splitlines()[0].strip() if title else work_dir.name

    desc_file = work_dir / "description.txt"
    description = read_text(desc_file) if desc_file.exists() else ""

    programs = []
    prog_file = work_dir / "programs.txt"
    if prog_file.exists():
        for name in re.split(r"[,\n;]+", read_text(prog_file)):
            name = name.strip()
            if name and name.lower() not in (p.lower() for p in programs):
                programs.append(name)

    date_file = work_dir / "date.txt"
    date = parse_date(read_text(date_file)) if date_file.exists() else None
    if date is None and work_dir.name in previous:
        # Keep the date it got the first time it was built, so a work doesn't
        # jump around the ring every time update.bat runs.
        try:
            date = datetime.datetime.fromisoformat(previous[work_dir.name].get("date", ""))
        except (TypeError, ValueError):
            date = None
    if date is None:
        date = folder_created(work_dir)

    return {
        "dir": work_dir.name,
        "folder": url("works", work_dir.name),
        "title": title,
        "description": description,
        "programs": programs,
        "category": (read_text(work_dir / "category.txt").splitlines() or [""])[0].strip()
        if (work_dir / "category.txt").exists() else "",
        "date": date.isoformat(timespec="seconds"),
        "items": items,
    }


def main():
    print()
    if not WORKS_DIR.exists():
        WORKS_DIR.mkdir()
        print("Made an empty works/ folder — put one folder per work in it.")
    if not FFMPEG:
        print("! ffmpeg isn't installed, so no previews or web copies can be made.")
        print("  The site will still work, just heavier. update.bat installs it for you.\n")

    previous = load_previous()
    works = []
    for work_dir in sorted(WORKS_DIR.iterdir(), key=lambda p: natural_key(p.name)):
        if not work_dir.is_dir() or work_dir.name.startswith(("_", ".")):
            continue
        if (work_dir / "skip folder.txt").exists():
            print(f"  {work_dir.name}  (skipped - has 'skip folder.txt')")
            continue
        print(f"  {work_dir.name}")
        work = build_work(work_dir, previous)
        if work is None:
            print("    ! no photos or videos in here — skipped")
            continue
        works.append(work)

    works.sort(key=lambda w: w["date"], reverse=True)  # newest first
    OUT_FILE.write_text(json.dumps(works, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDone: {len(works)} work(s) written to works.json. Refresh the site to see them.")


if __name__ == "__main__":
    main()
