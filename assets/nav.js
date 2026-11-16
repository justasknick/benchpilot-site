// assets/nav.js - the site header on small screens: the menu button opens and closes the link sheet.
// Without this script the links simply wrap under the logo, so nothing is hidden from a visitor without JavaScript.
(function () {
  'use strict';
  var nav = document.getElementById('nav');
  if (!nav) return;
  var btn = nav.querySelector('.nav-toggle');
  var menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;
  nav.classList.add('has-toggle');

  function set(open) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  btn.addEventListener('click', function () { set(!nav.classList.contains('open')); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); }
  });
  // A link in the sheet that stays on this page (#how) should close the sheet.
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  // Mark the current page (or section) in the main nav, from the link's full resolved path: help/index.html is current on
  // every help/ page. Matching on the bare file name never marked Help (its page is an index.html). Links into a page
  // section (index.html#how) are anchors, never the current page.
  var dir = function (p) { return p.replace(/index\.html$/, ''); };
  var here = dir(location.pathname);
  var links = nav.querySelectorAll('.nav-links a');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href') || '';
    if (href.indexOf('#') >= 0) continue;
    var target = dir(new URL(href, location.href).pathname);
    var section = /\/$/.test(target) && here.indexOf(target) === 0;
    if (target === here || section) links[i].setAttribute('aria-current', 'page');
  }
  // A thin shadow once the page scrolls under the header.
  var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 4); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
