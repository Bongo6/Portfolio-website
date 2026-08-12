document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');
  const NEXT_TAB = document.getElementById('next-tab');
  const PREV_TAB = document.getElementById('prev-tab');

  if (!WORK_GRID) return;

  const scrollAmount = () => {
    const cardWidth = WORK_GRID.querySelector('.portfolio-card')?.offsetWidth || 0;
    return cardWidth + 2;
  };

  if (NEXT_TAB) {
    NEXT_TAB.addEventListener('click', () => {
      WORK_GRID.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
    });
  }

  if (PREV_TAB) {
    PREV_TAB.addEventListener('click', () => {
      WORK_GRID.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
    });
  }

  WORK_GRID.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    WORK_GRID.scrollBy({
      left: event.deltaY,
      behavior: 'smooth'
    });
  }, { passive: false });
});
