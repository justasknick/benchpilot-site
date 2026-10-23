/* BenchPilot website: load sequence, solid nav on scroll, entrances and the price period switch.
   The site shows no product screens or demos (Nick, 23 Oct 2026). */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };

  // ── Load sequence: the headline lines rise, then the word band fades in ──
  requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('ready'); }); });

  // ── Nav: transparent on the purple hero, solid after it ──
  var nav = $('nav');
  function paintNav() { if (nav) nav.classList.toggle('solid', window.scrollY > 40 || document.body.classList.contains('page')); }
  paintNav();
  window.addEventListener('scroll', paintNav, { passive: true });

  // ── Entrances: the parts of each section rise in turn, once ──
  var groups = document.querySelectorAll('section, .bento, .plans, .step-row, .promise-list, .faq-list');
  for (var g = 0; g < groups.length; g++) {
    var parts = groups[g].querySelectorAll(':scope > [data-in], :scope > * > [data-in]');
    for (var i = 0; i < parts.length; i++) parts[i].style.setProperty('--d', (Math.min(i, 5) * 70) + 'ms');
  }
  var items = document.querySelectorAll('[data-in]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) if (entries[k].isIntersecting) { entries[k].target.classList.add('in'); io.unobserve(entries[k].target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
    for (var n = 0; n < items.length; n++) io.observe(items[n]);
  } else {
    for (var j = 0; j < items.length; j++) items[j].classList.add('in');
  }

  // ── Price period: monthly or yearly ──
  var period = $('period'), plans = $('plans');
  if (period && plans) {
    var pb = period.querySelectorAll('button');
    for (var p = 0; p < pb.length; p++) pb[p].addEventListener('click', function () {
      plans.setAttribute('data-p', this.getAttribute('data-p'));
      for (var q = 0; q < pb.length; q++) pb[q].setAttribute('aria-pressed', pb[q] === this ? 'true' : 'false');
    });
  }
})();
