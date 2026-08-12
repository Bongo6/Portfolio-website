document.addEventListener('DOMContentLoaded', () => {
  const WORK_GRID = document.getElementById('work-grid');
  const NEXT_TAB = document.getElementById('next-tab');
  const PREV_TAB = document.getElementById('prev-tab');

  if (!WORK_GRID) return;

  const cards = Array.from(WORK_GRID.querySelectorAll('.portfolio-card'));
  const cardWidth = () => cards[0]?.getBoundingClientRect().width || 0;
  const gap = () => {
    const style = window.getComputedStyle(WORK_GRID);
    return parseFloat(style.columnGap || style.gap || '0') || 0;
  };

  const scrollByOne = (direction) => {
    const step = cardWidth() + gap();
    const maxScroll = WORK_GRID.scrollWidth - WORK_GRID.clientWidth;

    if (direction > 0 && WORK_GRID.scrollLeft >= maxScroll - 1) {
      WORK_GRID.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }

    if (direction < 0 && WORK_GRID.scrollLeft <= 1) {
      WORK_GRID.scrollTo({ left: maxScroll, behavior: 'smooth' });
      return;
    }

    WORK_GRID.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  if (NEXT_TAB) {
    NEXT_TAB.addEventListener('click', () => scrollByOne(1));
  }

  if (PREV_TAB) {
    PREV_TAB.addEventListener('click', () => scrollByOne(-1));
  }

  WORK_GRID.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    scrollByOne(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
});
