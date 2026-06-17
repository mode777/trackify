import './app.css';
import './app.js';

function bindSidebarNavActiveState() {
    const navItems = document.querySelectorAll('.sidebar-nav a');
    navItems.forEach((item) => {
        item.addEventListener('click', () => {
            const href = item.getAttribute('href');
            if (!href || href === '#') return;
            navItems.forEach((other) => other.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSidebarNavActiveState);
} else {
    bindSidebarNavActiveState();
}
