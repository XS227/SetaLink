const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.site-nav');

if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

const nodeContainer = document.getElementById('network-nodes');
if (nodeContainer) {
  const count = window.innerWidth < 700 ? 16 : 30;
  for (let i = 0; i < count; i += 1) {
    const node = document.createElement('span');
    node.className = 'node';
    node.style.left = `${Math.random() * 100}%`;
    node.style.top = `${Math.random() * 100}%`;
    node.style.animationDuration = `${10 + Math.random() * 14}s`;
    node.style.animationDelay = `${Math.random() * 5}s`;
    nodeContainer.appendChild(node);
  }
}
