/*
 * Trackify landing page enhancements. Everything here is optional: without
 * this file the page renders and reads completely (see index.html /
 * styles.css). Respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Mobile navigation toggle ---------- */

  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');

  if (toggle && links) {
    var closeNav = function () {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    // Close after choosing a destination (mobile menu stays otherwise open).
    links.addEventListener('click', function (event) {
      if (event.target instanceof Element && event.target.closest('a')) closeNav();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && links.classList.contains('open')) {
        closeNav();
        toggle.focus();
      }
    });
  }

  /* ---------- Scroll reveal (IntersectionObserver) ---------- */

  var revealables = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (revealables.length && 'IntersectionObserver' in window && !reducedMotion) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    );
    revealables.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    revealables.forEach(function (el) {
      el.classList.add('revealed');
    });
  }
})();
