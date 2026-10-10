document.addEventListener('DOMContentLoaded', async () => {
  const WORK_GRID = document.getElementById('work-grid');

  if (!WORK_GRID) return;

  const fetchJson = async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      return res.ok ? await res.json() : null;
    } catch (err) {
      return null;
    }
  };

  const makeCard = (folder, title) => {
    const card = document.createElement('article');
    card.className = 'portfolio-card';
    card.dataset.media = folder;
    card.innerHTML = '<div class="card-inner"><div class="portfolio-number"></div><div class="portfolio-title"></div><div class="portfolio-tag"></div></div>';
    card.querySelector('.portfolio-title').textContent = title || '';
    return card;
  };

  // All three lists are made by update.bat (tools/build_site.py):
  // media/index.json — one entry per media/NN folder (title/description/
  //   programs from that folder's .txt files; skipped folders left out)
  // works.json — the works/<title>/ folders
  // icons/index.json — which program logos exist in icons/
  const [mediaIndex, worksList, iconIndex, wheelGroupsText] = await Promise.all([
    fetchJson('media/index.json'),
    fetchJson('works.json'),
    fetchJson('icons/index.json'),
    fetch('media/wheels.txt', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.text() : ''))
      .catch(() => ''),
  ]);

  // media/wheels.txt (optional) bundles several categories onto one wheel:
  //   3D & animation: Modeling, Shading, Animation, Character design
  // Every category listed after the colon goes on the wheel named before it,
  // and the lines' order is the wheels' order. category.txt files are left
  // as they are, so deleting/renaming wheels.txt brings back one wheel per
  // category. Categories not listed anywhere still get their own wheel.
  const wheelOfCategory = {};
  const wheelOrder = [];
  (wheelGroupsText || '').split(/\r?\n/).forEach((line) => {
    const clean = line.replace(/^\uFEFF/, '').trim();
    if (!clean || clean.startsWith('#') || !clean.includes(':')) return;
    let wheel = clean.slice(0, clean.indexOf(':')).trim();
    if (!wheel) return;
    // "(none)" = these categories don't get a wheel while grouped (the work
    // still shows on the wheels of its other categories).
    if (wheel.toLowerCase() === '(none)') wheel = null;
    else wheelOrder.push(wheel.toLowerCase());
    clean.slice(clean.indexOf(':') + 1).split(/[,;]+/).map((c) => c.trim()).filter(Boolean)
      .forEach((category) => { wheelOfCategory[category.toLowerCase()] = wheel; });
  });

  // Every media/NN folder in media/index.json gets a card, so a new folder
  // shows up after running update.bat without touching index.html. The
  // cards written in index.html are only a fallback for when that list
  // doesn't exist yet.
  const mediaByFolder = {};
  if (Array.isArray(mediaIndex) && mediaIndex.length) {
    WORK_GRID.querySelectorAll('.portfolio-card').forEach((card) => card.remove());
    mediaIndex.forEach((entry) => {
      if (!entry || !entry.folder) return;
      mediaByFolder[entry.folder] = entry;
      WORK_GRID.appendChild(makeCard(entry.folder, entry.title));
    });
  }

  // works/<title>/ folders, newest first, ahead of the media cards.
  const worksByFolder = {};
  const firstMediaCard = WORK_GRID.querySelector('.portfolio-card');
  (Array.isArray(worksList) ? worksList : []).forEach((work) => {
    if (!work || !work.folder || !Array.isArray(work.items) || !work.items.length) return;
    worksByFolder[work.folder] = work;
    WORK_GRID.insertBefore(makeCard(work.folder, work.title), firstMediaCard);
  });

  const programIcons = iconIndex && typeof iconIndex === 'object' ? iconIndex : {};

  const cards = Array.from(WORK_GRID.querySelectorAll('.portfolio-card'));

  // Wrap existing card contents in a `.card-inner` so we can counter-rotate
  // the inner content and keep cards visually upright while the grid rotates.
  // (index.html already includes .card-inner for each card, so this is a no-op
  // fallback in case a card is missing it.)
  cards.forEach(card => {
    if (!card.querySelector('.card-inner')) {
      const inner = document.createElement('div');
      inner.className = 'card-inner';
      while (card.firstChild) inner.appendChild(card.firstChild);
      card.appendChild(inner);
    }
  });

  // ---------------------------------------------------------------
  // Per-card media (images/video) — manifest-driven, gap-tolerant.
  //
  // A tiny compressed preview (always a static JPEG, even for videos)
  // cycles on the grid card. Full-resolution originals are only ever
  // fetched when that specific card's detail panel is opened, so the
  // page never has to load every photo/video for every card at once.
  //
  // media/<NN>/manifest.json lists exactly which numbered files exist
  // in that folder (and their preview path) — regenerate it whenever
  // media is added to or removed from a folder. If a folder has no
  // manifest yet, we fall back to probing 1.<ext>, 2.<ext>, ... which
  // (unlike the old version) no longer stops at the first missing
  // number, so folders with gaps in their numbering still show
  // everything that's actually there.
  // ---------------------------------------------------------------
  const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'];
  const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];
  const CYCLE_INTERVAL_MS = 3500;
  const CARD_STAGGER_MS = 220;
  const MAX_INDEX_SCAN = 80; // fallback only, used when manifest.json is missing

  const fileExists = async (path) => {
    try {
      const res = await fetch(path, { method: 'HEAD' });
      return res.ok;
    } catch (err) {
      return false;
    }
  };

  const loadManifest = async (folder) => {
    try {
      const res = await fetch(`${folder}/manifest.json`);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch (err) {
      return null;
    }
  };

  // Fallback discovery for a folder with no manifest.json: probes every
  // number up to MAX_INDEX_SCAN and keeps whatever it finds, gaps included.
  // A card whose media/<NN> folder doesn't exist at all (e.g. a placeholder
  // card with nothing added yet) has no manifest.json either, so it used to
  // fall all the way through to here and scan every one of the 80 indexes
  // one at a time, checking every extension in sequence before moving on —
  // up to 560 sequential network round trips for a single empty folder.
  // With several placeholder cards on the page, that was the single biggest
  // cause of slow loads. Now each index checks all extensions in parallel
  // (one round trip instead of up to 7), and a short run of consecutive
  // misses ends the scan early instead of grinding all the way to 80.
  const discoverMediaFallback = async (folder) => {
    const items = [];
    let consecutiveMisses = 0;
    for (let index = 1; index <= MAX_INDEX_SCAN; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(
        MEDIA_EXTENSIONS.map((ext) => fileExists(`${folder}/${index}.${ext}`).then((ok) => (ok ? ext : null)))
      );
      const matchedExt = results.find((ext) => ext !== null);
      if (!matchedExt) {
        consecutiveMisses += 1;
        if (consecutiveMisses >= 5) break;
        continue;
      }
      consecutiveMisses = 0;
      items.push({
        index,
        src: `${folder}/${index}.${matchedExt}`,
        type: VIDEO_EXTENSIONS.includes(matchedExt) ? 'video' : 'image',
      });
    }
    return items;
  };

  // Full-resolution items for a folder — used only by the detail-panel
  // gallery, fetched on demand rather than up front for every card.
  const discoverFullMedia = async (folder) => {
    const work = worksByFolder[folder];
    if (work) return work.items.map((m, i) => ({ index: i + 1, src: m.src, type: m.type }));
    const manifest = await loadManifest(folder);
    if (manifest) {
      return manifest.map((m) => ({
        index: m.index,
        src: `${folder}/${m.src}`,
        type: m.type,
      }));
    }
    return discoverMediaFallback(folder);
  };

  // Lightweight preview items for the grid cards — always static images
  // (a representative frame stands in for video), so a card never has to
  // decode a multi-megabyte photo or buffer a video just to sit in the ring.
  const discoverPreviewMedia = async (folder) => {
    const work = worksByFolder[folder];
    if (work) {
      // A work built without ffmpeg has no previews — use the real file then.
      return work.items.map((m, i) => (m.preview
        ? { index: i + 1, src: m.preview, type: 'image' }
        : { index: i + 1, src: m.src, type: m.type }));
    }
    const manifest = await loadManifest(folder);
    if (manifest) {
      const withPreview = manifest.filter((m) => m.preview);
      if (withPreview.length) {
        return withPreview.map((m) => ({ index: m.index, src: `${folder}/${m.preview}`, type: 'image' }));
      }
      // Built without ffmpeg, so no previews yet — use the real files.
      return manifest.map((m) => ({ index: m.index, src: `${folder}/${m.src}`, type: m.type }));
    }
    // No manifest and no preview files to point to — fall back to the
    // real media so the grid isn't empty (heavier, but better than blank).
    return discoverMediaFallback(folder);
  };

  const buildMediaLayer = (card, items) => {
    const layer = document.createElement('div');
    layer.className = 'card-media';

    const elements = items.map((item) => {
      let el;
      if (item.type === 'video') {
        el = document.createElement('video');
        el.src = item.src;
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.preload = 'metadata';
      } else {
        el = document.createElement('img');
        el.src = item.src;
        el.loading = 'lazy';
        el.alt = '';
      }
      layer.appendChild(el);
      return el;
    });

    // Insert as the first child so it sits behind the number/title/tag text.
    card.insertBefore(layer, card.firstChild);
    return elements;
  };

  const startCycle = (elements, startDelay = 0) => {
    if (!elements.length) return;
    let current = 0;

    const show = (i) => {
      elements.forEach((el, idx) => {
        if (idx === i) {
          el.classList.add('active');
          if (el.tagName === 'VIDEO') {
            el.currentTime = 0;
            el.play().catch(() => {});
          }
        } else {
          el.classList.remove('active');
          if (el.tagName === 'VIDEO') el.pause();
        }
      });
    };

    // First image shows straight away (a card can fly in at any moment now
    // that categories swap); only the cycling to the next one is staggered.
    show(current);
    if (elements.length > 1) {
      setTimeout(() => {
        setInterval(() => {
          current = (current + 1) % elements.length;
          show(current);
        }, CYCLE_INTERVAL_MS);
      }, startDelay);
    }
  };

  // Hand-made cards (media/NN) take their title from media/NN/title.txt,
  // so renaming a work is just editing that one file — the title written
  // in index.html is only a fallback for a folder without one.
  // The same goes for description.txt and programs.txt: they're read live
  // here, so editing any of the three .txt files only needs a page refresh
  // (update.bat is only needed when photos/videos or folders change).
  const fetchText = async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      return res.ok ? (await res.text()).replace(/^﻿/, '') : null;
    } catch (err) {
      return null;
    }
  };

  const loadFolderTitle = async (card) => {
    const folder = card.dataset.media;
    if (!folder) return;
    if (worksByFolder[folder]) { // works/ cards get theirs from works.json
      card._category = (worksByFolder[folder].category || '').trim();
      return;
    }
    const [titleText, descriptionText, programsText, categoryText] = await Promise.all([
      fetchText(`${folder}/title.txt`),
      fetchText(`${folder}/description.txt`),
      fetchText(`${folder}/programs.txt`),
      fetchText(`${folder}/category.txt`),
    ]);
    // Which wheel the card sits on — category.txt, else media/index.json.
    card._category = ((categoryText || '').split(/\r?\n/)[0] || '').trim()
      || ((mediaByFolder[folder] || {}).category || '').trim();
    const title = (titleText || '').split(/\r?\n/)[0].trim();
    const titleEl = card.querySelector('.portfolio-title');
    if (title && titleEl) titleEl.textContent = title;
    if (descriptionText !== null) card._description = descriptionText.trim();
    if (programsText !== null) {
      card._programs = programsText.split(/[,;\r\n]+/).map((p) => p.trim()).filter(Boolean);
    }
  };

  // A "skip folder.txt" file in a media/NN folder hides that card from the
  // site until the file is deleted again (works/ folders handle this in
  // update.bat instead, so their cards never reach works.json at all).
  const isSkipped = async (card) => {
    const folder = card.dataset.media;
    if (!folder || worksByFolder[folder]) return false;
    try {
      const res = await fetch(`${folder}/skip%20folder.txt`, { method: 'HEAD', cache: 'no-cache' });
      return res.ok;
    } catch (err) {
      return false;
    }
  };

  // Figure out up front which cards actually have any preview media —
  // a card whose folder is missing or empty (or skipped) gets pulled out
  // of the ring entirely rather than sitting there as an empty box. This
  // runs before the ring is first laid out below, so nothing empty ever
  // flashes on screen to begin with. Titles from title.txt load alongside.
  const cardMedia = await Promise.all(cards.map(async (card) => {
    const folder = card.dataset.media;
    const [items, , skipped] = await Promise.all([
      folder ? discoverPreviewMedia(folder) : [],
      loadFolderTitle(card),
      isSkipped(card),
    ]);
    return { card, items: skipped ? [] : items };
  }));

  cardMedia.forEach(({ card, items }) => {
    if (items.length) return;
    card.remove();
    const idx = cards.indexOf(card);
    if (idx !== -1) cards.splice(idx, 1);
  });

  cardMedia.forEach(({ card, items }, i) => {
    if (!items.length) return; // removed above
    // Grid view: cheap previews only. Full-res media is fetched lazily the
    // first time this card's detail panel is opened (see openDetail below).
    const elements = buildMediaLayer(card, items);
    startCycle(elements, i * CARD_STAGGER_MS);
  });

  // A work can sit on more than one wheel: category.txt can list several
  // names separated by commas ("Glitch art, Experiments"). The first name is
  // the card itself; every extra wheel gets its own copy of the card.
  cards.slice().forEach((card) => {
    const names = [];
    (card._category || '').split(/[,;\r\n]+/).map((n) => n.trim()).filter(Boolean).forEach((n) => {
      const key = n.toLowerCase();
      const wheel = key in wheelOfCategory ? wheelOfCategory[key] : n;
      if (wheel === null) return;
      if (!names.some((existing) => existing.toLowerCase() === wheel.toLowerCase())) names.push(wheel);
    });
    card._wheel = names[0] || '';
    let after = card;
    names.slice(1).forEach((name) => {
      const copy = card.cloneNode(true);
      copy._description = card._description;
      copy._programs = card._programs;
      copy._category = card._category;
      copy._wheel = name;
      copy._isCopy = true;
      WORK_GRID.insertBefore(copy, after.nextSibling);
      cards.splice(cards.indexOf(after) + 1, 0, copy);
      after = copy;
      startCycle(Array.from(copy.querySelectorAll('.card-media img, .card-media video')), 0);
    });
  });

  // ---------------------------------------------------------------
  // Work detail panel — click a card to open it, ring shifts left.
  // Title/tag come from the card's own text; description comes from
  // content.json (edit that one file to fill in write-ups); the gallery
  // loads full-resolution media on demand the first time a card opens,
  // then caches it on the card so reopening doesn't re-fetch it.
  // ---------------------------------------------------------------
  const shell = document.querySelector('.portfolio-shell');
  const ringCenterTitle = document.getElementById('ring-center-title');
  const ringCenterPrograms = document.getElementById('ring-center-programs');
  const detailPanel = document.getElementById('work-detail');
  const detailTitle = document.getElementById('work-detail-title');
  const detailPrograms = document.getElementById('work-detail-programs');
  const detailTag = document.getElementById('work-detail-tag');
  const detailDescription = document.getElementById('work-detail-description');
  const detailGallery = document.getElementById('work-detail-gallery');
  const detailClose = document.getElementById('work-detail-close');
  const galleryZoomControls = document.getElementById('gallery-zoom-controls');
  const galleryZoomIn = document.getElementById('gallery-zoom-in');
  const galleryZoomOut = document.getElementById('gallery-zoom-out');
  const galleryLayoutToggle = document.getElementById('gallery-layout-toggle');

  // content.json entries can be a plain description string (old format) or
  // an object { description, programs } — programs is the list of chips
  // (e.g. "Photoshop", "Blender") shown under the title on hover.
  let descriptions = {};
  let programsByNumber = {};
  fetch('content.json')
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => {
      Object.entries(data || {}).forEach(([number, entry]) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          descriptions[number] = entry.description || '';
          programsByNumber[number] = Array.isArray(entry.programs) ? entry.programs : [];
        } else {
          descriptions[number] = entry || '';
          programsByNumber[number] = [];
        }
      });
    })
    .catch(() => {}); // fine if content.json doesn't exist yet

  let activeCard = null;

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // Renders a description as one bulleted line per sentence/line (each gets
  // its own little accent-colored dot) instead of one plain block of text.
  // Shared by the real panel and the flip's back face so neither one "pops"
  // into a different look when the overlay swaps out for the real thing.
  const renderDescriptionHTML = (description) => {
    const text = description || 'Description coming soon.';
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return `<p class="work-detail-description-line">${escapeHtml(text)}</p>`;
    return lines.map((line) => `<p class="work-detail-description-line">${escapeHtml(line)}</p>`).join('');
  };

  // Title/tag/description/programs for a card — read synchronously from its
  // own DOM text and the already-loaded content.json. Shared by the flip's
  // back face, the real detail panel, and the ring-center hover label, so
  // they all show identical content.
  const getCardMeta = (card) => {
    const folder = card.dataset.media;
    const number = (folder || '').split('/').pop();
    const title = card.querySelector('.portfolio-title')?.textContent.trim() || '';
    const tag = card.querySelector('.portfolio-tag')?.textContent.trim() || '';
    const work = worksByFolder[folder];
    const entry = mediaByFolder[folder] || {};
    // Live .txt contents first, then media/index.json, then old content.json.
    const description = work
      ? (work.description || '')
      : (card._description ?? entry.description ?? descriptions[number] ?? '');
    const programs = work
      ? (work.programs || [])
      : (card._programs ?? entry.programs ?? programsByNumber[number] ?? []);
    return { folder, title, tag, description, programs };
  };

  // Each chip shows that program's logo from icons/ (found by update.bat —
  // see icons/index.json) and falls back to a plain colored square when
  // there's no logo for it yet.
  const PROGRAM_CHIP_COLORS = ['#ff5a1f', '#2dd4bf', '#f472b6', '#facc15', '#60a5fa', '#a78bfa', '#34d399'];
  const colorForProgram = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return PROGRAM_CHIP_COLORS[hash % PROGRAM_CHIP_COLORS.length];
  };
  const programKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  const renderProgramChipsHTML = (programs) => (programs || []).map((name) => {
    const iconFile = programIcons[programKey(name)];
    const icon = iconFile
      ? `<img class="program-chip-icon is-logo" src="icons/${escapeHtml(iconFile)}" alt="">`
      : `<span class="program-chip-icon" style="background:${colorForProgram(name)}"></span>`;
    return `<span class="program-chip">${icon}${escapeHtml(name)}</span>`;
  }).join('');

  const renderProgramChips = (container, programs) => {
    container.innerHTML = renderProgramChipsHTML(programs);
  };

  // ---------------------------------------------------------------
  // Card-flip transition: the card's current look flips over in 3D
  // and grows to cover the screen — and its back face shows the
  // *real* title/tag/description (not a placeholder), styled and
  // positioned exactly like the real detail panel underneath. So
  // when the overlay is removed at the end, nothing pops or snaps —
  // the back of the card already looked like the description page.
  // ---------------------------------------------------------------
  const playCardFlip = (card, meta) => {
    const rect = card.getBoundingClientRect();
    const activeMedia = card.querySelector('.card-media img.active');
    const cardBg = getComputedStyle(card).backgroundColor;

    const overlay = document.createElement('div');
    overlay.className = 'card-flip-overlay';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const inner = document.createElement('div');
    inner.className = 'card-flip-inner';

    const front = document.createElement('div');
    front.className = 'card-flip-face front';
    front.style.backgroundColor = cardBg;
    if (activeMedia) front.style.backgroundImage = `url("${activeMedia.src}")`;

    const back = document.createElement('div');
    back.className = 'card-flip-face back';
    back.innerHTML = `
      <div class="card-flip-back-inner">
        <h2 class="work-detail-title">${escapeHtml(meta.title)}</h2>
        <div class="work-detail-programs">${renderProgramChipsHTML(meta.programs)}</div>
        ${meta.tag ? `<div class="work-detail-tag">${escapeHtml(meta.tag)}</div>` : ''}
        <div class="work-detail-description">${renderDescriptionHTML(meta.description)}</div>
      </div>
    `;

    inner.appendChild(front);
    inner.appendChild(back);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    // Force layout so the starting position/size is committed before we
    // animate to the expanded, flipped state on the next frame.
    // eslint-disable-next-line no-unused-expressions
    overlay.getBoundingClientRect();

    // Resolves once the overlay has fully expanded and flipped — i.e. the
    // moment the screen is completely covered by the (already correct-
    // looking) back face. Callers should wait for this before revealing
    // anything underneath, so nothing shows through mid-flip.
    const covered = new Promise((resolve) => {
      requestAnimationFrame(() => {
        overlay.style.top = '0px';
        overlay.style.left = '0px';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        inner.style.transform = 'rotateY(180deg)';
        setTimeout(resolve, 520);
      });
    });

    // Hold fully covered for a beat (letting whatever's underneath finish
    // settling into place while hidden), then fade the overlay away.
    covered.then(() => {
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 220);
      }, 80);
    });

    return covered;
  };

  // ---------------------------------------------------------------
  // Reverse card-flip: the mirror image of playCardFlip. Starts as a
  // full-screen overlay showing the *same* title/tag/description as
  // the real panel (so swapping it in for the real panel is invisible),
  // then shrinks and flips back down into the card's own spot in the
  // grid, ending on the card's normal look. Returns a promise that
  // resolves once the overlay is gone and the card is fully revealed.
  // ---------------------------------------------------------------
  const playCardFlipReverse = (card, meta) => {
    const activeMedia = card.querySelector('.card-media img.active');
    const cardBg = getComputedStyle(card).backgroundColor;

    const overlay = document.createElement('div');
    overlay.className = 'card-flip-overlay';
    overlay.style.top = '0px';
    overlay.style.left = '0px';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';

    const inner = document.createElement('div');
    inner.className = 'card-flip-inner';
    inner.style.transform = 'rotateY(180deg)'; // starts on the back (description) face

    const front = document.createElement('div');
    front.className = 'card-flip-face front';
    front.style.backgroundColor = cardBg;
    if (activeMedia) front.style.backgroundImage = `url("${activeMedia.src}")`;

    const back = document.createElement('div');
    back.className = 'card-flip-face back';
    back.innerHTML = `
      <div class="card-flip-back-inner">
        <h2 class="work-detail-title">${escapeHtml(meta.title)}</h2>
        <div class="work-detail-programs">${renderProgramChipsHTML(meta.programs)}</div>
        ${meta.tag ? `<div class="work-detail-tag">${escapeHtml(meta.tag)}</div>` : ''}
        <div class="work-detail-description">${renderDescriptionHTML(meta.description)}</div>
      </div>
    `;

    inner.appendChild(front);
    inner.appendChild(back);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    // Committed while the overlay still exactly matches the real panel
    // (full-screen, back face forward) — so hiding the real panel and
    // un-shifting the grid right now is completely invisible.
    // eslint-disable-next-line no-unused-expressions
    overlay.getBoundingClientRect();
    shell.classList.remove('detail-open');
    detailPanel.classList.remove('open');
    detailPanel.setAttribute('aria-hidden', 'true');

    // While detail-open, the grid is shifted way off (and faded) via CSS —
    // jump that shift off immediately (still hidden behind the overlay) so
    // we can measure the card's real resting position, not its shifted-
    // and-faded detail-open position.
    const prevGridTransition = WORK_GRID.style.transition;
    WORK_GRID.style.transition = 'none';
    // eslint-disable-next-line no-unused-expressions
    WORK_GRID.getBoundingClientRect(); // force the un-shift to apply now
    const rect = card.getBoundingClientRect();
    // eslint-disable-next-line no-unused-expressions
    WORK_GRID.offsetHeight; // force layout before restoring the transition
    WORK_GRID.style.transition = prevGridTransition;

    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        overlay.style.top = `${rect.top}px`;
        overlay.style.left = `${rect.left}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        inner.style.transform = 'rotateY(0deg)';
      });

      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 560);
    });
  };

  // ---------------------------------------------------------------
  // Gallery item hover controls: a fullscreen button on every item,
  // plus a play/pause button on videos.
  // ---------------------------------------------------------------
  const FULLSCREEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4"/></svg>';
  const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  const requestFullscreenOn = (el) => {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) req.call(el);
  };

  // ---------------------------------------------------------------
  // Gallery layout: "horizontal" is a justified single row — every item
  // keeps its own aspect ratio, and --gallery-item-height (read by
  // .gallery-item / .gallery-item-media in styles.css) is solved so the
  // whole row fills the panel's width edge to edge. "vertical" stacks items
  // full-width, one per row, each at its own natural height — like a
  // case-study page you scroll down through. The same zoom buttons work in
  // both: in horizontal mode they scale the row's fitted height, and in
  // vertical mode they scale how wide each stacked item sits instead.
  // ---------------------------------------------------------------
  const GALLERY_GAP_PX = 18; // keep in sync with .work-detail-gallery's gap
  const GALLERY_MIN_ITEM_HEIGHT = 90;
  const GALLERY_MAX_ITEM_HEIGHT = 640;
  const GALLERY_DEFAULT_ASPECT = 1.5; // guess used until an item's real size loads
  const GALLERY_ZOOM_STEP = 0.2;
  const GALLERY_ZOOM_MIN = 0.5;
  const GALLERY_ZOOM_MAX = 2.5;
  const GALLERY_VERTICAL_MIN_WIDTH_PCT = 35;
  const GALLERY_VERTICAL_MAX_WIDTH_PCT = 100;
  // Icons show the mode a click would switch TO.
  const STACK_HORIZONTAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></svg>';
  const STACK_VERTICAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="5" rx="1"/><rect x="4" y="10" width="16" height="5" rx="1"/><rect x="4" y="17" width="16" height="4" rx="1"/></svg>';
  let galleryZoom = 1;
  let galleryLayoutMode = 'vertical'; // default layout when a gallery opens

  const recomputeGalleryFit = () => {
    if (galleryLayoutMode !== 'horizontal') return;
    const items = Array.from(detailGallery.children);
    if (items.length <= 1) return; // solo gallery sizes itself via its own CSS rule
    const containerWidth = detailGallery.clientWidth;
    if (!containerWidth) return;
    const sumAspect = items.reduce((sum, el) => sum + (el._aspect || GALLERY_DEFAULT_ASPECT), 0);
    const totalGap = GALLERY_GAP_PX * (items.length - 1);
    const fitHeight = (containerWidth - totalGap) / sumAspect;
    const clamped = Math.max(GALLERY_MIN_ITEM_HEIGHT, Math.min(GALLERY_MAX_ITEM_HEIGHT, fitHeight));
    detailGallery.style.setProperty('--gallery-item-height', `${(clamped * galleryZoom).toFixed(1)}px`);
  };

  // Maps the same 0.5–2.5 zoom range onto a 35%–100% item width, so zooming
  // out narrows the vertical stack into a smaller centered column and
  // zooming in widens it back up to the full panel width.
  const applyVerticalZoom = () => {
    if (galleryLayoutMode !== 'vertical') return;
    const t = (galleryZoom - GALLERY_ZOOM_MIN) / (GALLERY_ZOOM_MAX - GALLERY_ZOOM_MIN);
    const widthPct = GALLERY_VERTICAL_MIN_WIDTH_PCT + t * (GALLERY_VERTICAL_MAX_WIDTH_PCT - GALLERY_VERTICAL_MIN_WIDTH_PCT);
    detailGallery.style.setProperty('--gallery-item-width-pct', `${widthPct.toFixed(1)}%`);
  };

  const setGalleryZoom = (next) => {
    galleryZoom = Math.max(GALLERY_ZOOM_MIN, Math.min(GALLERY_ZOOM_MAX, next));
    if (galleryLayoutMode === 'vertical') applyVerticalZoom();
    else recomputeGalleryFit();
  };

  const updateGalleryLayoutUI = () => {
    const isVertical = galleryLayoutMode === 'vertical';
    if (galleryLayoutToggle) {
      galleryLayoutToggle.innerHTML = isVertical ? STACK_HORIZONTAL_ICON : STACK_VERTICAL_ICON;
      galleryLayoutToggle.setAttribute('aria-label', isVertical ? 'Stack horizontally' : 'Stack vertically');
    }
  };

  const setGalleryLayoutMode = (mode) => {
    galleryLayoutMode = mode;
    detailGallery.classList.toggle('stack-vertical', mode === 'vertical');
    detailPanel.classList.toggle('vertical-gallery', mode === 'vertical');
    if (mode === 'vertical') {
      detailGallery.style.removeProperty('--gallery-item-height');
      applyVerticalZoom();
    } else {
      detailGallery.style.removeProperty('--gallery-item-width-pct');
      recomputeGalleryFit();
    }
    updateGalleryLayoutUI();
  };

  if (galleryZoomIn) galleryZoomIn.addEventListener('click', () => setGalleryZoom(galleryZoom + GALLERY_ZOOM_STEP));
  if (galleryZoomOut) galleryZoomOut.addEventListener('click', () => setGalleryZoom(galleryZoom - GALLERY_ZOOM_STEP));
  if (galleryLayoutToggle) {
    galleryLayoutToggle.addEventListener('click', () => {
      setGalleryLayoutMode(galleryLayoutMode === 'vertical' ? 'horizontal' : 'vertical');
    });
  }

  const buildGalleryItem = (item) => {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-item';

    // Full-res photos/videos can be tens of megabytes — until this item's
    // file has actually finished downloading, show the site logo in its
    // place so the gallery isn't just empty space while it loads.
    const placeholder = document.createElement('img');
    placeholder.className = 'gallery-item-placeholder';
    placeholder.src = 'logo.png';
    placeholder.alt = '';
    wrap.appendChild(placeholder);

    const markLoaded = () => wrap.classList.add('is-loaded');

    // Once this item's real dimensions are known, store its aspect ratio
    // on the wrapper and re-fit the whole row — a placeholder guess is
    // used for every item until this fires.
    const updateAspect = () => {
      let ratio = null;
      if (item.type === 'video') {
        if (el.videoWidth && el.videoHeight) ratio = el.videoWidth / el.videoHeight;
      } else if (el.naturalWidth && el.naturalHeight) {
        ratio = el.naturalWidth / el.naturalHeight;
      }
      if (ratio) {
        wrap._aspect = ratio;
        recomputeGalleryFit();
      }
    };

    let el;
    if (item.type === 'video') {
      el = document.createElement('video');
      el.className = 'gallery-item-media';
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = 'none'; // don't buffer anything until it's actually visible
      el.addEventListener('loadeddata', markLoaded, { once: true });
      el.addEventListener('error', markLoaded, { once: true });
      el.addEventListener('loadedmetadata', updateAspect, { once: true });
    } else {
      el = document.createElement('img');
      el.className = 'gallery-item-media';
      el.loading = 'lazy';
      el.decoding = 'async';
      el.alt = '';
      el.addEventListener('load', markLoaded, { once: true });
      el.addEventListener('error', markLoaded, { once: true });
      el.addEventListener('load', updateAspect, { once: true });
    }
    wrap.appendChild(el);

    // Only set the real src (and start decoding/buffering it) once this
    // item has actually scrolled into view. A gallery with a dozen photos
    // and videos used to fetch and decode all of them the moment the panel
    // opened — a big chunk of the site's RAM use — this way only what's
    // actually on screen ever gets loaded.
    let started = false;
    const startLoading = () => {
      if (started) return;
      started = true;
      el.src = item.src;
      if (item.type === 'video') el.load();
      if (item.type === 'image' && el.complete && el.naturalWidth) markLoaded(); // already cached
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            startLoading();
            if (item.type === 'video') el.play().catch(() => {});
          } else if (item.type === 'video' && started) {
            // Scrolled away — free the decoded frames/audio buffer rather
            // than leaving it playing off-screen.
            el.pause();
          }
        });
        // detailPanel works as root for both layout modes: whichever of it
        // or detailGallery actually clips/scrolls (the panel's own vertical
        // scroll in vertical-stack mode, the gallery's horizontal scroll in
        // horizontal mode) still applies — any scrolling ancestor between
        // the item and root keeps clipping regardless of which element is
        // named root.
      }, { root: detailPanel, rootMargin: '200px' });
      io.observe(wrap);
    } else {
      // No IntersectionObserver support — fall back to loading immediately.
      startLoading();
      if (item.type === 'video') el.play().catch(() => {});
    }

    const controls = document.createElement('div');
    controls.className = 'gallery-item-controls';

    if (item.type === 'video') {
      const playPauseBtn = document.createElement('button');
      playPauseBtn.type = 'button';
      playPauseBtn.className = 'gallery-btn';
      playPauseBtn.setAttribute('aria-label', 'Play');
      playPauseBtn.innerHTML = PLAY_ICON;
      playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.paused) {
          startLoading();
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      });
      el.addEventListener('play', () => {
        playPauseBtn.innerHTML = PAUSE_ICON;
        playPauseBtn.setAttribute('aria-label', 'Pause');
      });
      el.addEventListener('pause', () => {
        playPauseBtn.innerHTML = PLAY_ICON;
        playPauseBtn.setAttribute('aria-label', 'Play');
      });
      controls.appendChild(playPauseBtn);
    } else {
      controls.appendChild(document.createElement('span')); // pins fullscreen to the right
    }

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.className = 'gallery-btn';
    fullscreenBtn.setAttribute('aria-label', 'Fullscreen');
    fullscreenBtn.innerHTML = FULLSCREEN_ICON;
    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startLoading();
      requestFullscreenOn(el);
    });
    controls.appendChild(fullscreenBtn);

    wrap.appendChild(controls);
    return wrap;
  };

  // `revealAfter` is the flip's "covered" promise (see playCardFlip) — the
  // real panel only becomes visible once the flip overlay has fully grown
  // to cover the screen, so it never shows through mid-animation.
  const openDetail = async (card, meta, revealAfter) => {
    if (activeCard) activeCard.classList.remove('is-active');
    activeCard = card;
    card.classList.add('is-active');
    rotationPaused = true;

    const { folder, title, tag, description, programs } = meta || getCardMeta(card);

    detailTitle.textContent = title;
    if (detailPrograms) renderProgramChips(detailPrograms, programs);
    detailTag.textContent = tag;
    detailDescription.innerHTML = renderDescriptionHTML(description);
    detailGallery.innerHTML = '';

    // Full-res media starts loading right away, in parallel with the flip
    // animation, so it's ready (or close to it) by the time we reveal.
    const mediaPromise = card._mediaItems
      ? Promise.resolve(card._mediaItems)
      : discoverFullMedia(folder);

    if (revealAfter) await revealAfter;

    // The user may have closed the panel or clicked another card while we
    // were waiting on the flip — don't reveal or populate a stale panel.
    if (activeCard !== card) return;

    shell.classList.add('detail-open');
    detailPanel.classList.add('open');
    detailPanel.setAttribute('aria-hidden', 'false');

    card._mediaItems = await mediaPromise;
    if (activeCard !== card) return;

    detailGallery.innerHTML = '';
    // A project with just one photo/video has nothing else to show next to
    // it, so let it fill the gallery big instead of sitting in a small box.
    const solo = card._mediaItems.length === 1;
    card._mediaItems.forEach((item) => {
      const galleryItem = buildGalleryItem(item);
      if (solo) galleryItem.classList.add('solo');
      detailGallery.appendChild(galleryItem);
    });

    galleryZoom = 1;
    detailGallery.style.removeProperty('--gallery-item-height');
    detailGallery.style.removeProperty('--gallery-item-width-pct');
    if (galleryZoomControls) {
      galleryZoomControls.setAttribute('aria-hidden', solo ? 'true' : 'false');
    }
    setGalleryLayoutMode('vertical'); // default layout each time a gallery opens
  };

  const closeDetail = () => {
    const card = activeCard;
    if (!card) return;
    activeCard = null; // treat the panel as closed right away for input purposes

    const meta = getCardMeta(card);
    // Drop the highlight now so it matches the overlay's plain front face —
    // otherwise the card would visibly "pop" an accent border on reveal.
    card.classList.remove('is-active');
    // gallery-zoom-controls lives outside .work-detail (see index.html) so
    // its position:fixed anchors to the real viewport, not that panel's own
    // transform — which means it no longer slides off-screen for free with
    // the panel, and has to be hidden explicitly here.
    if (galleryZoomControls) galleryZoomControls.setAttribute('aria-hidden', 'true');

    playCardFlipReverse(card, meta).then(() => {
      // Only resume the ring once the card is fully back in view, so it
      // can't drift away from the position the overlay is landing on.
      rotationPaused = false;
      // The gallery is fully hidden now — tear it down so any playing/
      // buffered videos are released instead of decoding away off-screen
      // until the next card is opened.
      detailGallery.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
      detailGallery.innerHTML = '';
    });
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      if (activeCard === card) {
        closeDetail();
      } else {
        const meta = getCardMeta(card);
        const flipCovered = playCardFlip(card, meta);
        openDetail(card, meta, flipCovered);
      }
    });

    // Show that card's title (and program chips) in the ring's center (in
    // place of the logo) while it's hovered.
    if (ringCenterTitle) {
      card.addEventListener('mouseenter', () => {
        const meta = getCardMeta(card);
        ringCenterTitle.textContent = meta.title;
        if (ringCenterPrograms) renderProgramChips(ringCenterPrograms, meta.programs);
        shell.classList.add('card-hovering');
      });
      card.addEventListener('mouseleave', () => {
        shell.classList.remove('card-hovering');
      });
    }
  });

  detailClose.addEventListener('click', closeDetail);
  detailPanel.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });

  shell.addEventListener('click', (e) => {
    if (activeCard && e.target === shell) closeDetail();
  });

  // ---------------------------------------------------------------
  // Category wheels. Every work belongs to a category (category.txt in its
  // folder) and each category gets its own ring — only one is on screen at
  // a time. Scrolling, swiping, the arrow keys or clicking a name in the
  // list on the right swaps it: the current cards sweep outward and fade
  // away while the next ring unfolds out of the centre, both drifting in
  // the direction you scrolled, with the big category name behind the ring
  // sliding along with them.
  // ---------------------------------------------------------------
  const OTHER_CATEGORY = 'Other';
  const categories = [];
  const addToWheel = (card) => {
    const name = (card._wheel || '').trim() || OTHER_CATEGORY;
    let cat = categories.find((c) => c.key === name.toLowerCase());
    if (!cat) {
      cat = { key: name.toLowerCase(), name, cards: [] };
      categories.push(cat);
    }
    cat.cards.push(card);
  };
  // Wheel order follows each work's main (first) category; copies on extra
  // wheels join after, so listing a second category never reorders wheels.
  cards.filter((card) => !card._isCopy).forEach(addToWheel);
  cards.filter((card) => card._isCopy).forEach(addToWheel);
  // Works without a category.txt always come last.
  // With media/wheels.txt, wheels follow the order of its lines.
  const wheelRank = (cat) => {
    if (cat.name === OTHER_CATEGORY) return Infinity;
    const i = wheelOrder.indexOf(cat.key);
    return i === -1 ? wheelOrder.length : i;
  };
  categories.forEach((cat, i) => { cat.firstSeen = i; });
  categories.sort((a, b) => (wheelRank(a) - wheelRank(b)) || (a.firstSeen - b.firstSeen));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IN_MS = reducedMotion ? 250 : 950;
  const OUT_MS = reducedMotion ? 200 : 560;
  const IN_DELAY_MS = reducedMotion ? 0 : 240;
  const IN_STAGGER_MS = reducedMotion ? 0 : 45;
  const OUT_STAGGER_MS = reducedMotion ? 0 : 22;
  const NUDGE_MS = 520;

  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;
  const easeOutBack = (t) => {
    const c1 = 1.35;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  let activeCategory = 0;
  let switching = false;
  let nudgeStart = -Infinity;
  let nudgeDir = 0;

  cards.forEach((card) => {
    card._phase = 'off';
    card.classList.add('is-off-ring');
  });

  const parseLength = (str, ref) => {
    if (!str) return NaN;
    const s = String(str).trim();
    if (s.endsWith('%')) return (parseFloat(s) / 100) * ref;
    if (s.endsWith('vw')) return (parseFloat(s) / 100) * window.innerWidth;
    if (s.endsWith('vh')) return (parseFloat(s) / 100) * window.innerHeight;
    if (s.endsWith('px')) return parseFloat(s);
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  };

  // Ring geometry for a ring of `count` cards — same rules as the original
  // single ring (shrink to clear the nav on short screens), plus: rings with
  // only a few cards pull in a little so they don't look empty, and rings
  // with lots of cards shrink the cards so they don't pile up.
  const ringGeometry = (count) => {
    const rootStyles = getComputedStyle(document.documentElement);
    const baseRadius = parseFloat(rootStyles.getPropertyValue('--ring-radius')) || 300;
    let radius = baseRadius;
    let cardWidth = 200;
    if (cards.length) {
      const cardStyle = getComputedStyle(cards[0]);
      const cardHeight = parseFloat(cardStyle.height) || 240;
      cardWidth = parseFloat(cardStyle.width) || 200;
      const maxRadiusForHeight = window.innerHeight / 2 - cardHeight / 2 - 70;
      // ...and on a narrow (phone) screen, keep the ring inside the width.
      const maxRadiusForWidth = window.innerWidth / 2 - cardWidth / 2 - 12;
      radius = Math.max(110, Math.min(radius, maxRadiusForHeight, maxRadiusForWidth));
    }
    const sizeScale = Math.max(0.68, Math.min(1, radius / baseRadius));
    radius *= Math.min(1, 0.62 + count * 0.04);

    const RING_DESIGN_CARD_COUNT = 18;
    const crowdScale = Math.max(0.6, Math.min(1, Math.sqrt(RING_DESIGN_CARD_COUNT / Math.max(count, 1))));
    // Never let neighbouring cards overlap into one solid blob: cap the card
    // width at a bit more than the space each one gets on the ring.
    const roomScale = ((Math.PI * 2 * radius) / Math.max(count, 1)) * 1.25 / cardWidth;

    const ringGap = ((parseFloat(rootStyles.getPropertyValue('--ring-gap')) || 0) * Math.PI) / 180;
    const gridRect = WORK_GRID.getBoundingClientRect();
    const parsedCenterX = parseLength(rootStyles.getPropertyValue('--ring-center-x') || '', gridRect.width);
    const parsedCenterY = parseLength(rootStyles.getPropertyValue('--ring-center-y') || '', gridRect.height);
    return {
      radius,
      cardScale: Math.max(0.42, Math.min(sizeScale * crowdScale, roomScale)),
      startAngle: ((parseFloat(rootStyles.getPropertyValue('--ring-start-angle')) || -90) * Math.PI) / 180,
      tilt: ((parseFloat(rootStyles.getPropertyValue('--ring-tilt')) || 0) * Math.PI) / 180,
      step: (Math.PI * 2) / Math.max(count, 1) + ringGap,
      cx: Number.isFinite(parsedCenterX) ? parsedCenterX - gridRect.width / 2 : 0,
      cy: Number.isFinite(parsedCenterY) ? parsedCenterY - gridRect.height / 2 : 0,
    };
  };

  // Positions every card that's on screen (or on its way in/out) for this
  // frame. Cards entering start bunched up small in the centre, slightly
  // rotated back and offset in the scroll direction, then spring out onto
  // the ring; cards leaving swing further round, fly outward and fade.
  const applyCircularLayout = (angleOffset = 0, now = performance.now()) => {
    const geometryBySize = {};
    const nudgeT = clamp01((now - nudgeStart) / NUDGE_MS);
    const nudgeY = nudgeT < 1 ? Math.sin(nudgeT * Math.PI) * (1 - nudgeT) * nudgeDir * -36 : 0;

    cards.forEach((card) => {
      if (card._phase === 'off') return;
      const size = card._ringSize || 1;
      const geo = geometryBySize[size] || (geometryBySize[size] = ringGeometry(size));

      let angle = geo.startAngle + card._ringIndex * geo.step + geo.tilt + angleOffset;
      let r = geo.radius;
      let dy = nudgeY;
      let scale = geo.cardScale;
      let opacity = 1;
      let blur = 0;

      if (card._phase === 'in') {
        const p = clamp01((now - card._t0) / IN_MS);
        const spring = easeOutBack(p);
        const smooth = easeOutCubic(p);
        angle -= (1 - smooth) * card._dir * 0.9;
        r *= 0.1 + 0.9 * spring;
        dy += (1 - smooth) * card._dir * 170;
        scale *= 0.3 + 0.7 * smooth;
        opacity = clamp01(p * 2.4);
        blur = (1 - smooth) * 9;
        if (p >= 1) card._phase = 'idle';
      } else if (card._phase === 'out') {
        const p = clamp01((now - card._t0) / OUT_MS);
        const e = easeInCubic(p);
        angle += e * card._dir * 0.65;
        r *= 1 + 0.55 * e;
        dy -= e * card._dir * 240;
        scale *= 1 - 0.35 * e;
        opacity = 1 - clamp01(p * 1.15);
        blur = e * 12;
        if (p >= 1) {
          card._phase = 'off';
          card.classList.add('is-off-ring');
          card.classList.remove('is-leaving');
          return;
        }
      }

      const x = Math.cos(angle) * r + geo.cx;
      const y = Math.sin(angle) * r + geo.cy + dy;
      card.style.setProperty('--x', `${x}px`);
      card.style.setProperty('--y', `${y}px`);
      card.style.setProperty('--card-scale', scale.toFixed(3));
      card.style.opacity = opacity.toFixed(3);
      card.style.filter = blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : '';
      card.style.zIndex = String(Math.round(10 + Math.sin(angle) * 10));
    });
  };

  // ---- Category list (right side), big ghost title, scroll hint ----------
  const rail = document.getElementById('category-rail');
  const ghost = document.getElementById('category-ghost');
  const hint = document.getElementById('scroll-hint');
  const hintText = hint ? hint.querySelector('.scroll-hint-text') : null;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (hintText) hintText.textContent = isTouch ? 'Swipe up or down to switch category' : 'Scroll to switch category';
  if (categories.length < 2) shell.classList.add('single-category');

  const pad2 = (n) => String(n).padStart(2, '0');
  const railItems = categories.map((cat, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-rail-item';
    btn.innerHTML = `<span class="category-rail-num">${pad2(i + 1)}</span><span class="category-rail-name">${escapeHtml(cat.name)}</span><span class="category-rail-count">${cat.cards.length}</span>`;
    btn.addEventListener('click', () => goToCategory(i));
    if (rail) rail.appendChild(btn);
    return btn;
  });

  const showGhost = (name, dir) => {
    if (!ghost) return;
    ghost.querySelectorAll('.category-ghost-text').forEach((old) => {
      old.style.setProperty('--dir', dir);
      old.classList.remove('is-entering');
      old.classList.add('is-leaving');
      setTimeout(() => old.remove(), 900);
    });
    const text = document.createElement('span');
    text.className = 'category-ghost-text is-entering';
    text.style.setProperty('--dir', dir);
    text.textContent = name;
    ghost.appendChild(text);
  };

  const updateCategoryUI = (dir) => {
    railItems.forEach((btn, i) => {
      const active = i === activeCategory;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
    if (rail) {
      rail.style.setProperty('--active-index', activeCategory);
      // With lots of categories the list is taller (or, on phones, wider)
      // than the screen — glide it so the active name stays in view.
      const btn = railItems[activeCategory];
      if (btn && rail.scrollHeight > rail.clientHeight + 1) {
        rail.scrollTo({ top: btn.offsetTop - rail.clientHeight / 2 + btn.offsetHeight / 2, behavior: 'smooth' });
      }
      if (btn && rail.scrollWidth > rail.clientWidth + 1) {
        rail.scrollTo({ left: btn.offsetLeft - rail.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
      }
    }
    showGhost(categories[activeCategory] ? categories[activeCategory].name : '', dir);
  };

  const enterCategory = (index, dir, t0) => {
    const ring = categories[index] ? categories[index].cards : [];
    ring.forEach((card, i) => {
      card._phase = 'in';
      card._dir = dir;
      card._t0 = t0 + i * IN_STAGGER_MS;
      card._ringIndex = i;
      card._ringSize = ring.length;
      card.style.opacity = '0';
      card.classList.remove('is-off-ring', 'is-leaving');
    });
    return IN_DELAY_MS + ring.length * IN_STAGGER_MS + IN_MS;
  };

  const switchCategory = (target, dir) => {
    if (switching || activeCard || target === activeCategory) return;
    if (target < 0 || target >= categories.length) return;
    const now = performance.now();
    switching = true;
    WORK_GRID.classList.add('is-switching');
    shell.classList.remove('card-hovering');
    categories[activeCategory].cards.forEach((card, i) => {
      if (card._phase === 'off') return;
      card._phase = 'out';
      card._dir = dir;
      card._t0 = now + i * OUT_STAGGER_MS;
      card.classList.add('is-leaving');
    });
    activeCategory = target;
    const total = enterCategory(target, dir, now + IN_DELAY_MS);
    updateCategoryUI(dir);
    shell.classList.add('has-switched');
    setTimeout(() => {
      switching = false;
      WORK_GRID.classList.remove('is-switching');
    }, total);
  };

  // At the first/last category: a little bounce instead of nothing happening,
  // so it's clear there's no more in that direction.
  const nudge = (dir) => {
    nudgeStart = performance.now();
    nudgeDir = dir;
    const btn = railItems[activeCategory];
    if (btn) {
      btn.classList.remove('is-bumped');
      // eslint-disable-next-line no-unused-expressions
      btn.offsetWidth;
      btn.classList.add('is-bumped');
    }
  };

  const goRelative = (dir) => {
    const target = activeCategory + dir;
    if (target < 0 || target >= categories.length) nudge(dir);
    else switchCategory(target, dir);
  };

  function goToCategory(index) {
    if (index === activeCategory) return;
    switchCategory(index, index > activeCategory ? 1 : -1);
  }

  // Mouse wheel / trackpad: one category per scroll gesture. Small scrolls
  // add up until they pass a threshold; after a switch, further scroll
  // events (including a trackpad's momentum) are ignored until the wheel
  // has been still for a moment, so one flick never skips two categories.
  let wheelAccum = 0;
  let lastWheelAt = 0;
  let wheelLockedUntil = 0;
  window.addEventListener('wheel', (e) => {
    if (activeCard || shell.classList.contains('detail-open')) return;
    const now = performance.now();
    const quiet = now - lastWheelAt > 200;
    lastWheelAt = now;
    if (now < wheelLockedUntil) {
      wheelLockedUntil = Math.max(wheelLockedUntil, now + 160);
      return;
    }
    if (quiet) wheelAccum = 0;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    wheelAccum += delta * unit;
    if (Math.abs(wheelAccum) >= 40) {
      goRelative(Math.sign(wheelAccum));
      wheelAccum = 0;
      wheelLockedUntil = now + Math.min(IN_DELAY_MS + IN_MS, 900);
    }
  }, { passive: true });

  // Touch: swipe up = next category, swipe down = previous.
  let touchStartY = null;
  let touchStartX = null;
  window.addEventListener('touchstart', (e) => {
    if (activeCard || e.touches.length !== 1) { touchStartY = null; return; }
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (touchStartY === null || activeCard) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - touchStartY;
    const dx = t.clientX - touchStartX;
    touchStartY = null;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) goRelative(dy < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (activeCard) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goRelative(1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goRelative(-1); }
  });

  let angleOffset = 0;
  let last = performance.now();
  let rotationPaused = false;

  const parseDuration = (s) => {
    if (!s) return 60;
    const str = s.trim();
    if (str.endsWith('ms')) return parseFloat(str) / 1000;
    if (str.endsWith('s')) return parseFloat(str);
    return parseFloat(str) || 60;
  };

  const rootStyles = getComputedStyle(document.documentElement);
  const duration = parseDuration(rootStyles.getPropertyValue('--ring-rotation-duration')) || 60;

  const tick = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    if (!rotationPaused) {
      angleOffset += (dt * 2 * Math.PI) / Math.max(duration, 0.001);
      applyCircularLayout(angleOffset, now);
    }
    requestAnimationFrame(tick);
  };

  // First load: the logo stops pulsing and the first ring unfolds out of
  // the centre the same way a newly chosen category does.
  WORK_GRID.classList.remove('is-loading');
  if (categories.length) {
    WORK_GRID.classList.add('is-switching');
    switching = true;
    const total = enterCategory(0, 1, performance.now() + 120);
    updateCategoryUI(1);
    setTimeout(() => {
      switching = false;
      WORK_GRID.classList.remove('is-switching');
    }, total + 120);
  }
  applyCircularLayout(angleOffset);
  window.addEventListener('resize', () => applyCircularLayout(angleOffset));
  window.addEventListener('resize', () => {
    if (activeCard) recomputeGalleryFit();
  });
  requestAnimationFrame(tick);
});
