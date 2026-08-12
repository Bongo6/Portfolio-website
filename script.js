document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');

  if (!WORK_GRID) return;

  const cards = Array.from(WORK_GRID.querySelectorAll('.portfolio-card'));

  const applyCircularLayout = () => {
    const rootStyles = getComputedStyle(document.documentElement);
    const radius = parseFloat(rootStyles.getPropertyValue('--ring-radius')) || 300;
    const startAngle = ((parseFloat(rootStyles.getPropertyValue('--ring-start-angle')) || -90) * Math.PI) / 180;
    const ringGap = ((parseFloat(rootStyles.getPropertyValue('--ring-gap')) || 0) * Math.PI) / 180;
    const tilt = ((parseFloat(rootStyles.getPropertyValue('--ring-tilt')) || 0) * Math.PI) / 180;
    const horizontalShift = parseFloat(rootStyles.getPropertyValue('--ring-horizontal-shift')) || 0;
    const verticalShift = parseFloat(rootStyles.getPropertyValue('--ring-vertical-shift')) || 0;
    const step = (Math.PI * 2) / cards.length + ringGap;

    cards.forEach((card, index) => {
      const angle = startAngle + index * step + tilt;
      const x = Math.cos(angle) * radius + horizontalShift;
      const y = Math.sin(angle) * radius + verticalShift;

      card.style.setProperty('--x', `${x}px`);
      card.style.setProperty('--y', `${y}px`);
      card.style.zIndex = String(Math.round(10 + Math.sin(angle) * 10));
    });
  };

  applyCircularLayout();
  window.addEventListener('resize', applyCircularLayout);
});
