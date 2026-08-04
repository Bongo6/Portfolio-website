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

initTopWords();
