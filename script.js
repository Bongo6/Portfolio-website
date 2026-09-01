document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');

  if (!WORK_GRID) return;

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
      const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
      return res.ok;
    } catch (err) {
      return false;
    }
  };

  const loadManifest = async (folder) => {
    try {
      const res = await fetch(`${folder}/manifest.json`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch (err) {
      return null;
    }
  };

  // Fallback discovery for a folder with no manifest.json: probes every
  // number up to MAX_INDEX_SCAN and keeps whatever it finds, gaps included.
  const discoverMediaFallback = async (folder) => {
    const items = [];
    for (let index = 1; index <= MAX_INDEX_SCAN; index += 1) {
      let matchedExt = null;
      for (const ext of MEDIA_EXTENSIONS) {
        // eslint-disable-next-line no-await-in-loop
        if (await fileExists(`${folder}/${index}.${ext}`)) {
          matchedExt = ext;
          break;
        }
      }
      if (!matchedExt) continue;
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
    const manifest = await loadManifest(folder);
    if (manifest) {
      return manifest
        .filter((m) => m.preview)
        .map((m) => ({ index: m.index, src: `${folder}/${m.preview}`, type: 'image' }));
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

    setTimeout(() => {
      show(current);
      if (elements.length > 1) {
        setInterval(() => {
          current = (current + 1) % elements.length;
          show(current);
        }, CYCLE_INTERVAL_MS);
      }
    }, startDelay);
  };

  cards.forEach((card, i) => {
    const folder = card.dataset.media;
    if (!folder) return;

    // Grid view: cheap previews only. Full-res media is fetched lazily the
    // first time this card's detail panel is opened (see openDetail below).
    discoverPreviewMedia(folder).then((items) => {
      if (!items.length) return; // no files found in this card's folder yet
      const elements = buildMediaLayer(card, items);
      startCycle(elements, i * CARD_STAGGER_MS);
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
  const detailPanel = document.getElementById('work-detail');
  const detailTitle = document.getElementById('work-detail-title');
  const detailTag = document.getElementById('work-detail-tag');
  const detailDescription = document.getElementById('work-detail-description');
  const detailGallery = document.getElementById('work-detail-gallery');
  const detailClose = document.getElementById('work-detail-close');

  let descriptions = {};
  fetch('content.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => { descriptions = data; })
    .catch(() => {}); // fine if content.json doesn't exist yet

  let activeCard = null;

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // Title/tag/description for a card — read synchronously from its own DOM
  // text and the already-loaded content.json. Shared by the flip's back
  // face and the real detail panel so both show identical content.
  const getCardMeta = (card) => {
    const folder = card.dataset.media;
    const number = (folder || '').split('/').pop();
    const title = card.querySelector('.portfolio-title')?.textContent.trim() || '';
    const tag = card.querySelector('.portfolio-tag')?.textContent.trim() || '';
    const description = descriptions[number] || '';
    return { folder, title, tag, description };
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
        ${meta.tag ? `<div class="work-detail-tag">${escapeHtml(meta.tag)}</div>` : ''}
        <p class="work-detail-description">${escapeHtml(meta.description || 'Description coming soon.')}</p>
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
        ${meta.tag ? `<div class="work-detail-tag">${escapeHtml(meta.tag)}</div>` : ''}
        <p class="work-detail-description">${escapeHtml(meta.description || 'Description coming soon.')}</p>
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

    let el;
    if (item.type === 'video') {
      el = document.createElement('video');
      el.className = 'gallery-item-media';
      el.src = item.src;
      el.muted = true;
      el.loop = true;
      el.autoplay = true;
      el.playsInline = true;
      el.addEventListener('loadeddata', markLoaded, { once: true });
      el.addEventListener('error', markLoaded, { once: true });
    } else {
      el = document.createElement('img');
      el.className = 'gallery-item-media';
      el.src = item.src;
      el.alt = '';
      el.addEventListener('load', markLoaded, { once: true });
      el.addEventListener('error', markLoaded, { once: true });
      if (el.complete && el.naturalWidth) markLoaded(); // already cached
    }
    wrap.appendChild(el);

    const controls = document.createElement('div');
    controls.className = 'gallery-item-controls';

    if (item.type === 'video') {
      const playPauseBtn = document.createElement('button');
      playPauseBtn.type = 'button';
      playPauseBtn.className = 'gallery-btn';
      playPauseBtn.setAttribute('aria-label', 'Pause');
      playPauseBtn.innerHTML = PAUSE_ICON; // autoplay starts it playing
      playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.paused) el.play().catch(() => {});
        else el.pause();
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

    const { folder, title, tag, description } = meta || getCardMeta(card);

    detailTitle.textContent = title;
    detailTag.textContent = tag;
    detailDescription.textContent = description || 'Description coming soon.';
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
  };

  const closeDetail = () => {
    const card = activeCard;
    if (!card) return;
    activeCard = null; // treat the panel as closed right away for input purposes

    const meta = getCardMeta(card);
    // Drop the highlight now so it matches the overlay's plain front face —
    // otherwise the card would visibly "pop" an accent border on reveal.
    card.classList.remove('is-active');

    playCardFlipReverse(card, meta).then(() => {
      // Only resume the ring once the card is fully back in view, so it
      // can't drift away from the position the overlay is landing on.
      rotationPaused = false;
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
  // Circular ring layout (unchanged from original)
  // ---------------------------------------------------------------
  const applyCircularLayout = (angleOffset = 0) => {
    const rootStyles = getComputedStyle(document.documentElement);
    const baseRadius = parseFloat(rootStyles.getPropertyValue('--ring-radius')) || 300;
    let radius = baseRadius;

    // The ring's radius is a fixed pixel value, but the viewport isn't —
    // on a shorter window (e.g. a 1080p-height browser vs. a taller 1440p
    // one) the full-size ring reaches up far enough to collide with the
    // nav bar. Shrink it just enough to clear the nav; tall-enough
    // viewports (where the full radius already fits) are left untouched.
    // Card height is read from computed (untransformed) CSS, not the live
    // bounding rect — the cards themselves get scaled down below, and
    // reading a transform-scaled height back in would feed the shrink into
    // itself every frame.
    if (cards.length) {
      const cardHeight = parseFloat(getComputedStyle(cards[0]).height) || 240;
      const maxRadiusForHeight = window.innerHeight / 2 - cardHeight / 2 - 70;
      radius = Math.max(140, Math.min(radius, maxRadiusForHeight));
    }

    // Cards themselves shrink proportionally to how much the radius had to
    // shrink, so a short (1080p-style) viewport doesn't end up with
    // full-size cards packed onto a squeezed ring.
    const cardScale = Math.max(0.68, Math.min(1, radius / baseRadius));

    const startAngle = ((parseFloat(rootStyles.getPropertyValue('--ring-start-angle')) || -90) * Math.PI) / 180;
    const ringGap = ((parseFloat(rootStyles.getPropertyValue('--ring-gap')) || 0) * Math.PI) / 180;
    const tilt = ((parseFloat(rootStyles.getPropertyValue('--ring-tilt')) || 0) * Math.PI) / 180;
    const horizontalShift = parseFloat(rootStyles.getPropertyValue('--ring-horizontal-shift')) || 0;
    const verticalShift = parseFloat(rootStyles.getPropertyValue('--ring-vertical-shift')) || 0;
    const gridRect = WORK_GRID.getBoundingClientRect();
    const step = (Math.PI * 2) / cards.length + ringGap;

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

    const centerXVar = rootStyles.getPropertyValue('--ring-center-x') || '';
    const centerYVar = rootStyles.getPropertyValue('--ring-center-y') || '';
    const parsedCenterX = parseLength(centerXVar, gridRect.width);
    const parsedCenterY = parseLength(centerYVar, gridRect.height);
    const centerOffsetX = Number.isFinite(parsedCenterX)
      ? parsedCenterX - gridRect.width / 2
      : (parseLength(rootStyles.getPropertyValue('--ring-horizontal-shift'), gridRect.width) || horizontalShift);
    const centerOffsetY = Number.isFinite(parsedCenterY)
      ? parsedCenterY - gridRect.height / 2
      : (parseLength(rootStyles.getPropertyValue('--ring-vertical-shift'), gridRect.height) || verticalShift);

    cards.forEach((card, index) => {
      const angle = startAngle + index * step + tilt + angleOffset;
      const x = Math.cos(angle) * radius + centerOffsetX;
      const y = Math.sin(angle) * radius + centerOffsetY;

      card.style.setProperty('--x', `${x}px`);
      card.style.setProperty('--y', `${y}px`);
      card.style.setProperty('--card-scale', cardScale.toFixed(3));
      card.style.zIndex = String(Math.round(10 + Math.sin(angle) * 10));
    });
  };

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
      applyCircularLayout(angleOffset);
    }
    requestAnimationFrame(tick);
  };

  applyCircularLayout();
  window.addEventListener('resize', () => applyCircularLayout(angleOffset));
  requestAnimationFrame(tick);
});
