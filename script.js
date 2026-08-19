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
  // Per-card media (images/video) — auto-discovery + slideshow cycle
  // ---------------------------------------------------------------
  const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'];
  const VIDEO_EXTENSIONS = ['mp4', 'webm'];
  const CYCLE_INTERVAL_MS = 3500;
  const CARD_STAGGER_MS = 220;

  const fileExists = async (path) => {
    try {
      const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
      return res.ok;
    } catch (err) {
      return false;
    }
  };

  // Tries 1.<ext>, 2.<ext>, ... in `folder`, stopping at the first missing
  // number. For each number it tries every extension in MEDIA_EXTENSIONS
  // until one exists, so you can freely mix jpg/png/mp4/etc.
  const discoverMedia = async (folder) => {
    const items = [];
    let index = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let matchedExt = null;
      for (const ext of MEDIA_EXTENSIONS) {
        const path = `${folder}/${index}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        if (await fileExists(path)) {
          matchedExt = ext;
          break;
        }
      }
      if (!matchedExt) break;

      items.push({
        src: `${folder}/${index}.${matchedExt}`,
        type: VIDEO_EXTENSIONS.includes(matchedExt) ? 'video' : 'image',
      });
      index += 1;
    }

    return items;
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

    discoverMedia(folder).then((items) => {
      if (!items.length) return; // no files found in this card's folder yet
      const elements = buildMediaLayer(card, items);
      startCycle(elements, i * CARD_STAGGER_MS);
    });
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
    angleOffset += (dt * 2 * Math.PI) / Math.max(duration, 0.001);
    applyCircularLayout(angleOffset);
    requestAnimationFrame(tick);
  };

  applyCircularLayout();
  window.addEventListener('resize', () => applyCircularLayout(angleOffset));
  requestAnimationFrame(tick);
});