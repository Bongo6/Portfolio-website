document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');

  if (!WORK_GRID) return;

  const cards = Array.from(WORK_GRID.querySelectorAll('.portfolio-card'));

  // Wrap existing card contents in a `.card-inner` so we can counter-rotate
  // the inner content and keep cards visually upright while the grid rotates.
  cards.forEach(card => {
    if (!card.querySelector('.card-inner')) {
      const inner = document.createElement('div');
      inner.className = 'card-inner';
      while (card.firstChild) inner.appendChild(card.firstChild);
      card.appendChild(inner);
    }
  });

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

    // helper to parse unit values for center/shift vars
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

    // Allow specifying ring center inside the grid via CSS vars `--ring-center-x`/`--ring-center-y`.
    // These default to 50% if not provided. If provided, they override the raw horizontal/vertical shifts.
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

  // Animate by updating the angle offset over time. This changes card positions
  // without rotating the card elements themselves, so they remain upright.
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
    // advance angle so one full rotation equals `duration` seconds
    angleOffset += (dt * 2 * Math.PI) / Math.max(duration, 0.001);
    applyCircularLayout(angleOffset);
    requestAnimationFrame(tick);
  };

  applyCircularLayout();
  window.addEventListener('resize', () => applyCircularLayout(angleOffset));
  requestAnimationFrame(tick);
});
