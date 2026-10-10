#!/usr/bin/env python3
"""
Turns an Instagram data export into works/ folders. Run it by dragging the
export .zip (or the unzipped folder) onto import_instagram.bat.

Get the export in Instagram: Settings > Accounts Center > Your information
and permissions > Download your information > pick your Instagram account >
Some of your information > only "Posts" (reels come with it) > Download to
device > Format: JSON, Media quality: High.

Each post becomes works/<title>/ with its photos/videos (1.jpg, 2.mp4, ...),
description.txt (the caption, hashtags removed), date.txt (when it was
posted, so the newest is first on the site) and programs.txt when the caption
mentions a program like Blender or Photoshop. The title is the caption's
first line — rename the folder to change it.

Already-imported posts are remembered in works/_instagram_imported.json, so
running it again with a newer export only adds the new posts (and a post
whose folder you deleted won't come back).
"""
import datetime
import json
import os
import re
import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
WORKS_DIR = ROOT / "works"
LOG_FILE = WORKS_DIR / "_instagram_imported.json"

POST_FILES = re.compile(r"(^|/)(posts_\d+|reels|igtv_videos)\.json$", re.IGNORECASE)
MEDIA_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".mp4", ".mov", ".webm", ".m4v"}

PROGRAMS = [
    ("Blender", r"blender|b3d"),
    ("Photoshop", r"photoshop"),
    ("Illustrator", r"illustrator"),
    ("After Effects", r"after\s*effects|\bae\b"),
    ("Premiere Pro", r"premiere"),
    ("Lightroom", r"lightroom"),
    ("InDesign", r"indesign"),
    ("Substance Painter", r"substance"),
    ("ZBrush", r"zbrush"),
    ("Maya", r"\bmaya\b"),
    ("Cinema 4D", r"cinema\s*4d|\bc4d\b"),
    ("Houdini", r"houdini"),
    ("Unreal Engine", r"unreal|\bue5\b"),
    ("Unity", r"unity3d|unity\s*engine|#unity\b"),
    ("Figma", r"figma"),
    ("Procreate", r"procreate"),
    ("DaVinci Resolve", r"davinci"),
    ("Affinity", r"affinity"),
    ("Krita", r"krita"),
    ("Marvelous Designer", r"marvelous"),
]

try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass


class ZipSource:
    def __init__(self, path):
        self.zf = zipfile.ZipFile(path)
        self.names = [n for n in self.zf.namelist() if not n.endswith("/")]

    def read(self, name):
        return self.zf.read(name)

    def copy(self, name, dest):
        with self.zf.open(name) as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out)


class FolderSource:
    def __init__(self, path):
        self.root = Path(path)
        self.names = [p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()]

    def read(self, name):
        return (self.root / name).read_bytes()

    def copy(self, name, dest):
        shutil.copyfile(self.root / name, dest)


def fix_text(text):
    """Instagram exports store UTF-8 as mangled latin-1 ('Ã©' instead of 'é')."""
    if not text:
        return ""
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def strip_hashtags(text):
    return re.sub(r"(?<!\w)#[\wÀ-￿]+", "", text)


def clean_line(line):
    line = "".join(ch for ch in line if unicodedata.category(ch)[0] in "LNPZ" or ch in "&+'")
    return re.sub(r"\s+", " ", line).strip(" -–—:|.,")


def make_title(caption, date):
    for line in strip_hashtags(caption).splitlines():
        line = re.sub(r"(?<!\w)@[\w.]+", "", line)
        line = clean_line(line)
        if len(line) >= 2:
            if len(line) > 50:
                line = line[:50].rsplit(" ", 1)[0]
            break
    else:
        line = ""
    line = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", line).strip(" .")
    return line or f"Post {date:%Y-%m-%d}"


def make_description(caption):
    lines = [re.sub(r"\s+", " ", l).strip() for l in strip_hashtags(caption).splitlines()]
    return "\n".join(l for l in lines if l.strip(" .-–—"))


def guess_programs(caption):
    low = caption.lower()
    return [name for name, pattern in PROGRAMS if re.search(pattern, low)]


def load_posts(source):
    posts = []
    for name in source.names:
        if not POST_FILES.search(name):
            continue
        try:
            data = json.loads(source.read(name).decode("utf-8"))
        except Exception:
            print(f"  ! couldn't read {name}")
            continue
        if isinstance(data, dict):  # reels.json etc. wrap the list in a key
            data = next((v for v in data.values() if isinstance(v, list)), [])
        posts.extend(p for p in data if isinstance(p, dict) and p.get("media"))
    return posts


def resolve(source, uri, by_suffix):
    uri = uri.lstrip("/")
    if uri in by_suffix:
        return by_suffix[uri]
    for name in source.names:
        if name.endswith("/" + uri):
            by_suffix[uri] = name
            return name
    return None


def unique_dir(title):
    candidate = WORKS_DIR / title
    n = 2
    while candidate.exists():
        candidate = WORKS_DIR / f"{title} ({n})"
        n += 1
    return candidate


def main():
    if len(sys.argv) < 2:
        print("\nDrag your Instagram export (.zip or unzipped folder) onto import_instagram.bat.")
        return 1
    src_path = Path(sys.argv[1].strip('"'))
    if not src_path.exists():
        print(f"\nCan't find {src_path}")
        return 1

    source = ZipSource(src_path) if zipfile.is_zipfile(src_path) else FolderSource(src_path)
    posts = load_posts(source)
    if not posts:
        print("\nNo posts found in that export. Make sure it's the JSON format (not HTML)")
        print("and that 'Posts' was selected when you requested it.")
        return 1

    WORKS_DIR.mkdir(exist_ok=True)
    try:
        imported = json.loads(LOG_FILE.read_text(encoding="utf-8"))
    except Exception:
        imported = {}

    posts.sort(key=lambda p: p.get("creation_timestamp") or p["media"][0].get("creation_timestamp") or 0)
    by_suffix = {}
    added = skipped = 0
    seen_times = set()
    print()
    for post in posts:
        media = post["media"]
        key = media[0].get("uri", "")
        stamp = post.get("creation_timestamp") or media[0].get("creation_timestamp") or 0
        if key in imported or not key or stamp in seen_times:
            skipped += 1
            continue
        seen_times.add(stamp)

        caption = fix_text(post.get("title") or media[0].get("title") or "")
        date = datetime.datetime.fromtimestamp(stamp) if stamp else datetime.datetime.now()

        files = []
        for m in media:
            name = resolve(source, m.get("uri", ""), by_suffix)
            if name and PurePosixPath(name).suffix.lower() in MEDIA_EXT:
                files.append(name)
        if not files:
            print(f"  ! post from {date:%Y-%m-%d} has no media files in the export — skipped")
            imported[key] = None
            continue

        work_dir = unique_dir(make_title(caption, date))
        work_dir.mkdir()
        for i, name in enumerate(files, 1):
            dest = work_dir / f"{i}{PurePosixPath(name).suffix.lower()}"
            source.copy(name, dest)
            if stamp:
                os.utime(dest, (stamp, stamp))

        (work_dir / "description.txt").write_text(make_description(caption), encoding="utf-8")
        (work_dir / "date.txt").write_text(f"{date:%Y-%m-%d}", encoding="utf-8")
        programs = guess_programs(caption)
        if programs:
            (work_dir / "programs.txt").write_text(", ".join(programs), encoding="utf-8")

        imported[key] = work_dir.name
        added += 1
        print(f"  + {work_dir.name}  ({len(files)} file{'s' if len(files) != 1 else ''})")

    LOG_FILE.write_text(json.dumps(imported, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nImported {added} new post(s)" + (f", skipped {skipped} already imported." if skipped else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
