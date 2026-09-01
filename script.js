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

  const buildGalleryItem = (item) => {
    let el;
    if (item.type === 'video') {
      el = document.createElement('video');
      el.src = item.src;
      el.muted = true;
      el.loop = true;
      el.autoplay = true;
      el.playsInline = true;
    } else {
      el = document.createElement('img');
      el.src = item.src;
      el.alt = '';
    }
    return el;
  };

  const openDetail = async (card) => {
    if (activeCard) activeCard.classList.remove('is-active');
    activeCard = card;
    card.classList.add('is-active');
    rotationPaused = true;

    const folder = card.dataset.media;
    const number = (folder || '').split('/').pop();
    const title = card.querySelector('.portfolio-title')?.textContent.trim() || '';
    const tag = card.querySelector('.portfolio-tag')?.textContent.trim() || '';
    const description = descriptions[number] || '';

    detailTitle.textContent = title;
    detailTag.textContent = tag;
    detailDescription.textContent = description || 'Description coming soon.';

    detailGallery.innerHTML = '';
    shell.classList.add('detail-open');
    detailPanel.classList.add('open');
    detailPanel.setAttribute('aria-hidden', 'false');

    // Full-res media loads only now, on demand — not for every card up front.
    if (!card._mediaItems) {
      card._mediaItems = await discoverFullMedia(folder);
    }

    // The user may have closed the panel or clicked another card while the
    // full-res media was still loading — don't populate a stale gallery.
    if (activeCard !== card) return;

    card._mediaItems.forEach((item) => detailGallery.appendChild(buildGalleryItem(item)));
  };

  const closeDetail = () => {
    if (activeCard) activeCard.classList.remove('is-active');
    activeCard = null;
    rotationPaused = false;
    shell.classList.remove('detail-open');
    detailPanel.classList.remove('open');
    detailPanel.setAttribute('aria-hidden', 'true');
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      if (activeCard === card) {
        closeDetail();
      } else {
        openDetail(card);
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
    const radius = parseFloat(rootStyles.getPropertyValue('--ring-radius')) || 300;
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
