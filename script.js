const TOP_CONTAINER = document.getElementById('top-words');
const WORDS = [
  'photography', 'godot', 'touchdesigner', 'visual design', '3d animator',
  'game assets', 'game design', 'motion design', 'interactive installations',
  'graphic design', 'blender'
];

function createTopWord(text) {
  const el = document.createElement('div');
  el.className = 'word';
  el.textContent = text;
  el.style.pointerEvents = 'none';
  TOP_CONTAINER.appendChild(el);
}

function initTopWords() {
  TOP_CONTAINER.innerHTML = '';
  WORDS.forEach((w) => createTopWord(w));
}

window.addEventListener('resize', () => {
  // nothing dynamic needed for static top words, but keep handler for future tweaks
});

const WORK_GRID = document.getElementById('work-grid');
const NEXT_TAB = document.getElementById('next-tab');
const PREV_TAB = document.getElementById('prev-tab');

if (WORK_GRID) {
  const scrollAmount = () => {
    const cardWidth = WORK_GRID.querySelector('.work-card')?.offsetWidth || 0;
    return cardWidth + 24;
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
}

initTopWords();
