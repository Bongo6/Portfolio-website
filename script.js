document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');

  if (!WORK_GRID) return;

  const cards = Array.from(WORK_GRID.querySelectorAll('.portfolio-card'));

  const applyCircularLayout = () => {
    const rootStyles = getComputedStyle(document.documentElement);
    const radius = parseFloat(rootStyles.getPropertyValue('--ring-radius')) || 300;
    const startAngle = ((parseFloat(rootStyles.getPropertyValue('--ring-start-angle')) || -90) * Math.PI) / 180;

    cards.forEach((card, index) => {
      const angle = startAngle + (index / cards.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      card.style.setProperty('--x', `${x}px`);
      card.style.setProperty('--y', `${y}px`);
      card.style.zIndex = String(Math.round(10 + Math.sin(angle) * 10));
    });
  };

  applyCircularLayout();
  window.addEventListener('resize', applyCircularLayout);
});
