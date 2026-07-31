document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('projectOverlay');
  const overlayClose = document.getElementById('overlayClose');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayCategory = document.getElementById('overlayCategory');
  const overlayDescription = document.getElementById('overlayDescription');
  const overlayImage = document.getElementById('overlayImage');

  const projects = [
    {
      title: 'Neon Portraits',
      category: 'Photography',
      description: 'A vivid portrait series with strong contrasts, neon lighting, and sculptural composition.',
      image: 'https://via.placeholder.com/900x1000/1f1f1f/ffffff?text=Neon+Portraits'
    },
    {
      title: 'Studio Frames',
      category: 'Editorial',
      description: 'Minimal editorial images with a refined color palette and clean visual hierarchy.',
      image: 'https://via.placeholder.com/900x1000/292929/ffffff?text=Studio+Frames'
    },
    {
      title: 'Urban Motion',
      category: '3D',
      description: 'A 3D study of city forms and dynamic lighting, rendered in a stark monochrome style.',
      image: 'https://via.placeholder.com/900x1000/242424/ffffff?text=Urban+Motion'
    },
    {
      title: 'Quiet Geometry',
      category: 'Photography',
      description: 'A calm, structured series focused on shapes, textures, and quiet moments.',
      image: 'https://via.placeholder.com/900x1000/2b2b2b/ffffff?text=Quiet+Geometry'
    },
    {
      title: 'Texture Grid',
      category: 'Editorial',
      description: 'Photo-driven editorial frames that explore texture, material, and contrast.',
      image: 'https://via.placeholder.com/900x1000/202020/ffffff?text=Texture+Grid'
    },
    {
      title: 'Abstract Light',
      category: 'Photography',
      description: 'Experimental light study photos with rich shadow detail and atmospheric tone.',
      image: 'https://via.placeholder.com/900x1000/262626/ffffff?text=Abstract+Light'
    },
    {
      title: 'Monochrome Shift',
      category: 'Editorial',
      description: 'A moody monochrome series that highlights form and facial expression.',
      image: 'https://via.placeholder.com/900x1000/1a1a1a/ffffff?text=Monochrome+Shift'
    },
    {
      title: 'Layered Scale',
      category: '3D',
      description: 'A layered visual study of scale and depth using high-contrast 3D elements.',
      image: 'https://via.placeholder.com/900x1000/2d2d2d/ffffff?text=Layered+Scale'
    },
    {
      title: 'Frame Study',
      category: 'Portrait',
      description: 'A portrait-focused exploration of mood, composition, and subtle emotion.',
      image: 'https://via.placeholder.com/900x1000/212121/ffffff?text=Frame+Study'
    }
  ];

  const cards = document.querySelectorAll('.gallery-card');

  cards.forEach((card, index) => {
    card.addEventListener('click', () => {
      const project = projects[index];
      overlayTitle.textContent = project.title;
      overlayCategory.textContent = project.category;
      overlayDescription.textContent = project.description;
      overlayImage.src = project.image;
      overlayImage.alt = project.title;
      overlay.classList.remove('hidden');
    });
  });

  overlayClose.addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      overlay.classList.add('hidden');
    }
  });
});
