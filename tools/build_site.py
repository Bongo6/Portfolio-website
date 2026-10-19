#!/usr/bin/env python3
"""
Everything update.bat does, in one go:

1. works/   — builds works.json from the works/<title>/ folders (build_works.py).
2. media/   — every media/NN folder becomes a card on the site, no HTML needed:
     * new files (SaveClip.App_..., IMG_..., anything not a plain number) are
       renamed to the next free number, in the order they were downloaded
     * videos browsers can't play (.mov etc.) get an .mp4 copy
     * huge photos get a lighter copy in _web/ (the original stays)
     * every item gets a small N.preview.jpg for the spinning ring
     * manifest.json is rewritten from what's actually in the folder
     * title.txt / description.txt / programs.txt are created if missing
       (filled from content.json where it has something), then read, along
       with category.txt (which category wheel the work goes on)
     * a folder with "skip folder.txt" in it is left off the site
   ...and the list of folders goes to media/index.json for script.js.
3. icons/   — for every program named in a programs.txt, a logo is looked up
   on Simple Icons (simpleicons.org) and saved as icons/<name>.svg. Drop your
   own icons/<name>.png or .svg in there to use that instead.
4. .gitignore — files the site never loads (originals that have a lighter
   copy, old .mov files, skipped folders, Claude outputs/) are listed so
   they don't get uploaded with the site.
"""
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_works as bw  # noqa: E402  (shares the ffmpeg/preview helpers)

ROOT = bw.ROOT
MEDIA_DIR = ROOT / "media"
MEDIA_INDEX = MEDIA_DIR / "index.json"
CONTENT_JSON = ROOT / "content.json"
ICONS_DIR = ROOT / "icons"
ICONS_INDEX = ICONS_DIR / "index.json"
GITIGNORE = ROOT / ".gitignore"

MEDIA_EXT = bw.IMAGE_EXT | bw.VIDEO_EXT
# For a number with several files (e.g. 7.mov + its converted 7.mp4), the
# first of these that exists is the one the site shows.
PREFERRED_EXT = [".mp4", ".webm", ".m4v", ".jpg", ".jpeg", ".png", ".webp", ".gif"]
ICON_EXT = [".svg", ".png", ".webp", ".jpg"]

# Simple Icons names for programs whose name isn't already the right one.
ICON_SLUGS = {
    "photoshop": "adobephotoshop",
    "illustrator": "adobeillustrator",
    "aftereffects": "adobeaftereffects",
    "premiere": "adobepremierepro",
    "premierepro": "adobepremierepro",
    "lightroom": "adobelightroom",
    "indesign": "adobeindesign",
    "substancepainter": "adobesubstance3dpainter",
    "substance": "adobesubstance3dpainter",
    "maya": "autodeskmaya",
    "davinci": "davinciresolve",
    "resolve": "davinciresolve",
    "ue5": "unrealengine",
    "unreal": "unrealengine",
    "c4d": "cinema4d",
    "godot": "godotengine",
}

SKIP_FILE = "skip folder.txt"


def write_if_changed(path, text):
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def program_key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def split_programs(text):
    out = []
    for name in re.split(r"[,\n;]+", text or ""):
        name = name.strip()
        if name and program_key(name) not in (program_key(p) for p in out):
            out.append(name)
    return out


def read_category(folder):
    """category.txt = which wheel on the site the work sits on."""
    path = folder / "category.txt"
    lines = bw.read_text(path).splitlines() if path.exists() else []
    return lines[0].strip() if lines else ""


def is_media(path):
    return path.is_file() and path.suffix.lower() in MEDIA_EXT and ".preview." not in path.name.lower()


# --------------------------------------------------------------------------
# media/NN folders
# --------------------------------------------------------------------------
def number_new_files(folder):
    files = [p for p in folder.iterdir() if is_media(p)]
    numbered = [p for p in files if p.stem.isdigit()]
    todo = sorted((p for p in files if not p.stem.isdigit()), key=lambda p: (p.stat().st_mtime, p.name.lower()))
    next_n = max((int(p.stem) for p in numbered), default=0) + 1
    for p in todo:
        new = folder / f"{next_n}{p.suffix.lower()}"
        p.rename(new)
        print(f"    renamed {p.name}  ->  {new.name}")
        next_n += 1


def build_media_folder(folder, content):
    """Returns (index entry or None, set of files the site doesn't need)."""
    unused = set()
    if (folder / SKIP_FILE).exists():
        print(f"  media/{folder.name}  (skipped - has '{SKIP_FILE}')")
        unused.update(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in MEDIA_EXT | {".jpg"})
        return None, unused

    if not any(is_media(p) for p in folder.iterdir()):
        return None, unused
    print(f"  media/{folder.name}")
    number_new_files(folder)

    groups = {}
    for p in folder.iterdir():
        if is_media(p) and p.stem.isdigit():
            groups.setdefault(int(p.stem), []).append(p)

    items = []
    for n in sorted(groups):
        files = groups[n]
        playable = sorted((p for p in files if p.suffix.lower() in PREFERRED_EXT),
                          key=lambda p: PREFERRED_EXT.index(p.suffix.lower()))
        if playable:
            src = playable[0]
        elif bw.FFMPEG:
            src = folder / f"{n}.mp4"
            print(f"    converting {files[0].name} to .mp4 (can take a minute)...")
            ok = bw.run_ffmpeg([
                "-i", str(files[0]),
                "-vf", f"scale='trunc(min({bw.WEB_VIDEO_MAX_WIDTH},iw)/2)*2':-2",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(src),
            ])
            if not (ok and src.exists()):
                print(f"    ! couldn't convert {files[0].name} - skipped")
                continue
        else:
            print(f"    ! {files[0].name} needs ffmpeg to play in browsers - skipped for now")
            continue
        unused.update(p for p in files if p != src)

        is_video = src.suffix.lower() in bw.VIDEO_EXT
        served = src
        if bw.FFMPEG and not is_video:
            web = bw.make_web_copy(src, folder, False)
            if web:
                served = web
                unused.add(src)

        preview = folder / f"{n}.preview.jpg"
        has_preview = preview.exists() and preview.stat().st_mtime >= served.stat().st_mtime
        if not has_preview and bw.FFMPEG:
            preview.unlink(missing_ok=True)
            has_preview = bw.make_preview(served, preview, is_video)
            if not has_preview:
                print(f"    ! couldn't make a preview for {src.name}")
        items.append({
            "index": n,
            "src": served.relative_to(folder).as_posix(),
            "type": "video" if is_video else "image",
            "preview": preview.name if has_preview or preview.exists() else None,
        })

    if not items:
        return None, unused

    # Keep the order the gallery already had: works listed in the old
    # manifest.json stay in that order (so a hand-arranged order, e.g. the
    # video first, survives), and anything new goes at the end by number.
    try:
        old_order = [m["index"] for m in json.loads((folder / "manifest.json").read_text(encoding="utf-8"))]
    except Exception:
        old_order = []
    items.sort(key=lambda it: (old_order.index(it["index"]) if it["index"] in old_order else len(old_order), it["index"]))

    manifest = [{k: v for k, v in item.items() if v is not None} for item in items]
    write_if_changed(folder / "manifest.json", json.dumps(manifest, indent=2) + "\n")

    # The text files that describe the work — made once so there's always an
    # obvious place to type, filled from content.json if it had something.
    old = content.get(folder.name) or {}
    if isinstance(old, str):
        old = {"description": old}
    defaults = {
        "title.txt": folder.name,
        "description.txt": old.get("description", ""),
        "programs.txt": ", ".join(old.get("programs", []) or []),
    }
    for name, text in defaults.items():
        path = folder / name
        if not path.exists():
            path.write_text(text.replace("\n", "\r\n") + ("\r\n" if text else ""), encoding="utf-8")

    title = bw.read_text(folder / "title.txt").splitlines()
    return {
        "folder": f"media/{folder.name}",
        "title": title[0].strip() if title else folder.name,
        "description": bw.read_text(folder / "description.txt"),
        "programs": split_programs(bw.read_text(folder / "programs.txt")),
        "category": read_category(folder),
    }, unused


def build_media():
    if not MEDIA_DIR.exists():
        return [], set()
    try:
        content = json.loads(CONTENT_JSON.read_text(encoding="utf-8"))
    except Exception:
        content = {}
    entries, unused = [], set()
    for folder in sorted((p for p in MEDIA_DIR.iterdir() if p.is_dir()), key=lambda p: bw.natural_key(p.name)):
        if folder.name.startswith(("_", ".")):
            continue
        entry, folder_unused = build_media_folder(folder, content)
        unused |= folder_unused
        if entry:
            entries.append(entry)
    write_if_changed(MEDIA_INDEX, json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
    return entries, unused


# --------------------------------------------------------------------------
# icons/
# --------------------------------------------------------------------------
def find_icon(key):
    for ext in ICON_EXT:
        if (ICONS_DIR / f"{key}{ext}").exists():
            return f"{key}{ext}"
    return None


def download_icon(key):
    slug = ICON_SLUGS.get(key, key)
    url = f"https://cdn.simpleicons.org/{slug}/white"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "portfolio-update-script"})
        with urllib.request.urlopen(req, timeout=10) as res:
            data = res.read()
        if b"<svg" not in data[:300]:
            return None
        (ICONS_DIR / f"{key}.svg").write_bytes(data)
        return f"{key}.svg"
    except Exception:
        return None


def build_icons(program_names):
    ICONS_DIR.mkdir(exist_ok=True)
    found = {}
    for name in sorted(set(program_names), key=str.lower):
        key = program_key(name)
        if not key or key in found:
            continue
        icon = find_icon(key)
        if not icon:
            icon = download_icon(key)
            if icon:
                print(f"  icon for {name}: downloaded icons/{icon}")
            else:
                print(f"  ! no icon found online for {name} - put your own in icons/{key}.png (or .svg)")
        if icon:
            found[key] = icon
    write_if_changed(ICONS_INDEX, json.dumps(found, indent=2) + "\n")


# --------------------------------------------------------------------------
# .gitignore
# --------------------------------------------------------------------------
GITIGNORE_START = "# >>> update.bat: files the site never loads (made automatically - edit outside this block) >>>"
GITIGNORE_END = "# <<< update.bat <<<"


def gitignore_pattern(path):
    rel = path.relative_to(ROOT).as_posix()
    rel = re.sub(r"([*?\[\]!#])", r"\\\1", rel)
    return "/" + rel


def update_gitignore(unused):
    lines = ["/Claude outputs/", "/works/_instagram_imported.json"]
    lines += sorted(gitignore_pattern(p) for p in unused)
    block = "\n".join([GITIGNORE_START, *lines, GITIGNORE_END])

    text = GITIGNORE.read_text(encoding="utf-8") if GITIGNORE.exists() else ""
    pattern = re.compile(re.escape(GITIGNORE_START) + r".*?" + re.escape(GITIGNORE_END), re.S)
    if pattern.search(text):
        text = pattern.sub(lambda _: block, text)
    else:
        text = (text.rstrip("\n") + "\n\n" if text.strip() else "") + block + "\n"
    write_if_changed(GITIGNORE, text)

    # .gitignore only stops NEW files from being added. Files git already
    # tracks have to be taken out of the repo too (they stay on your PC).
    git = bw.shutil.which("git")
    if not git or not (ROOT / ".git").exists():
        return
    try:
        tracked = subprocess.run(
            [git, "ls-files", "-ci", "--exclude-standard", "-z"],
            cwd=ROOT, capture_output=True, check=True,
        ).stdout.decode("utf-8", "replace").split("\0")
        tracked = [t for t in tracked if t]
        if tracked:
            subprocess.run([git, "rm", "--cached", "--quiet", "--", *tracked], cwd=ROOT, check=True)
            print(f"\n  Took {len(tracked)} unused file(s) out of git (they're still on your PC) - commit that in GitHub Desktop.")
    except Exception:
        pass


def main():
    bw.main()  # works/ folders -> works.json

    print("\nMedia folders:")
    entries, unused = build_media()

    try:
        works = json.loads(bw.OUT_FILE.read_text(encoding="utf-8"))
    except Exception:
        works = []
    for work_dir in bw.WORKS_DIR.iterdir() if bw.WORKS_DIR.exists() else []:
        if work_dir.is_dir():
            for p in work_dir.iterdir():
                if (work_dir / "_web").exists() and p.is_file() and p.suffix.lower() in bw.IMAGE_EXT:
                    if (work_dir / "_web" / (p.stem + ".jpg")).exists():
                        unused.add(p)
                if p.is_file() and p.suffix.lower() in bw.VIDEO_EXT - bw.BROWSER_VIDEO_EXT:
                    if (work_dir / "_web" / (p.name + ".mp4")).exists():
                        unused.add(p)

    print("\nProgram icons:")
    programs = [p for e in entries for p in e["programs"]] + [p for w in works for p in w.get("programs", [])]
    build_icons(programs)

    update_gitignore(unused)
    print(f"\nAll done: {len(entries)} media folder(s) and {len(works)} work(s) on the site. Refresh the page.")


if __name__ == "__main__":
    main()
