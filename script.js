const container = document.getElementById('words-container');
const WORDS = [
  'photography', 'godot', '3d animator', 'interactive installations',
  'visual design', 'touchdesigner', 'blender', 'graphic design',
  'game assets', 'game design', 'adobe creative cloud', 'motion design'
];
const items = [];
let attraction = 0.02;
let mouseX = 0;
let mouseY = 0;
let hasMouse = false;
let isHolding = false;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function createWord(text) {
  const el = document.createElement('div');
  el.className = 'word';
  el.textContent = text;
  container.appendChild(el);
  return el;
}

const centerName = document.querySelector('.center-name');

function initWords() {
  container.innerHTML = '';
  items.length = 0;
  const bounds = container.getBoundingClientRect();
  const centerRect = centerName.getBoundingClientRect();
  const centerX = centerRect.left + centerRect.width / 2 - bounds.left;
  const centerY = centerRect.top + centerRect.height / 2 - bounds.top;
  const centerRadius = Math.max(centerRect.width, centerRect.height) * 0.55;

  const baseAngles = WORDS.map((_, index) => (index / WORDS.length) * Math.PI * 2);
  WORDS.forEach((word, index) => {
    const el = createWord(word);
    const angle = baseAngles[index] + rand(-0.28, 0.28);
    const distance = rand(centerRadius + 45, centerRadius + 110);
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    const vx = rand(-240, 240);
    const vy = rand(-200, 200);
    const rot = rand(-38, 38);
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const radius = Math.max(width, height) * 0.56;
    items.push({ el, x, y, baseX: x, baseY: y, vx, vy, rot, angular: rand(-0.5, 0.5), radius, width, height });
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  });
}

let lastClick = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

let lastFrame = performance.now();
function animate(timestamp) {
  const dt = Math.min(0.032, (timestamp - lastFrame) / 1000);
  lastFrame = timestamp;
  const bounds = container.getBoundingClientRect();
  const idleTime = timestamp - lastClick;
  const returnStrength = Math.min(1, idleTime / 2200); // after ~2.2s idle, float drift fully returns

  items.forEach((item) => {
    const drift = 1 - returnStrength;
    item.vx += (Math.random() - 0.5) * 140 * dt * returnStrength;
    item.vy += (Math.random() - 0.5) * 140 * dt * returnStrength;
    item.vx += Math.sin(timestamp * 0.001 + item.x * 0.018) * 100 * dt * returnStrength;
    item.vy += Math.cos(timestamp * 0.001 + item.y * 0.018) * 100 * dt * returnStrength;
    item.vx += Math.sin((item.x + item.y) * 0.005 + timestamp * 0.001) * 50 * dt * returnStrength;

    if (hasMouse) {
      const dx = mouseX - item.x;
      const dy = mouseY - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
      const followRadius = Math.max(bounds.width, bounds.height) / 3;
      if (dist < followRadius) {
        const proximity = 1 - dist / followRadius;
        const baseFollow = 0.006 + 0.008 * proximity;
        const holdBoost = isHolding ? 1.6 : 1;
        const follow = baseFollow * (1 + 0.9 * holdBoost) * (0.45 + 0.55 * proximity);
        item.vx += (dx / dist) * follow * 2600;
        item.vy += (dy / dist) * follow * 2600;
      }
    }

    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.rot += item.angular * dt * 12;

    if (returnStrength > 0.15) {
      item.vx += (item.baseX - item.x) * 0.012 * returnStrength;
      item.vy += (item.baseY - item.y) * 0.012 * returnStrength;
    }

    const pad = 16;
    if (item.x < pad) { item.x = pad; item.vx *= -0.5; }
    if (item.y < pad) { item.y = pad; item.vy *= -0.5; }
    if (item.x > bounds.width - pad) { item.x = bounds.width - pad; item.vx *= -0.5; }
    if (item.y > bounds.height - pad) { item.y = bounds.height - pad; item.vy *= -0.5; }

    item.vx *= 0.6;
    item.vy *= 0.6;
  });

  const centerRect = centerName.getBoundingClientRect();
  const centerLeft = centerRect.left - bounds.left;
  const centerTop = centerRect.top - bounds.top;
  const centerRight = centerLeft + centerRect.width;
  const centerBottom = centerTop + centerRect.height;

  // collision bounce between words and center name (tight box around letters)
  items.forEach((item) => {
    const itemCenterX = item.x + item.width / 2;
    const itemCenterY = item.y + item.height / 2;
    const nearestX = clamp(itemCenterX, centerLeft, centerRight);
    const nearestY = clamp(itemCenterY, centerTop, centerBottom);
    const dx = itemCenterX - nearestX;
    const dy = itemCenterY - nearestY;
    const distSq = dx * dx + dy * dy;
    const radiusSq = item.radius * item.radius;
    if (distSq > 0 && distSq < radiusSq) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = item.radius - dist;
      item.x += nx * overlap;
      item.y += ny * overlap;
      const velAlong = item.vx * nx + item.vy * ny;
      item.vx -= (velAlong + 10) * nx * 0.45;
      item.vy -= (velAlong + 10) * ny * 0.45;
    }
  });

  // collision bounce between words
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const itemA = items[a];
      const itemB = items[b];
      const dx = itemB.x - itemA.x;
      const dy = itemB.y - itemA.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = itemA.radius + itemB.radius + 2;
      if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        itemA.x -= nx * overlap * 0.5;
        itemA.y -= ny * overlap * 0.5;
        itemB.x += nx * overlap * 0.5;
        itemB.y += ny * overlap * 0.5;

        const relVel = (itemB.vx - itemA.vx) * nx + (itemB.vy - itemA.vy) * ny;
        const impulse = -relVel * 0.76;
        itemA.vx -= impulse * nx * 0.5;
        itemA.vy -= impulse * ny * 0.5;
        itemB.vx += impulse * nx * 0.5;
        itemB.vy += impulse * ny * 0.5;
      }
    }
  }

  items.forEach((item) => {
    item.el.style.transform = `translate(${Math.round(item.x)}px, ${Math.round(item.y)}px) rotate(${item.rot.toFixed(1)}deg)`;
  });

  requestAnimationFrame(animate);
}

container.addEventListener('pointerdown', (event) => {
  lastClick = performance.now();
  isHolding = true;
  const rect = container.getBoundingClientRect();
  mouseX = event.clientX - rect.left;
  mouseY = event.clientY - rect.top;
  hasMouse = true;
});

container.addEventListener('pointermove', (event) => {
  const rect = container.getBoundingClientRect();
  mouseX = event.clientX - rect.left;
  mouseY = event.clientY - rect.top;
  hasMouse = true;
});

container.addEventListener('pointerup', () => {
  isHolding = false;
});

container.addEventListener('pointerleave', () => {
  hasMouse = false;
  isHolding = false;
});

window.addEventListener('resize', initWords);
initWords();
requestAnimationFrame(animate);
