/* BenchPilot website: load sequence, solid nav on scroll, the hero film (pause button, paused off screen and under
   reduced motion), entrances, the price period switch, and the "Paste a post" reader. The reader uses BenchPilot's
   own library files (assets/bp/*.js, copies of BenchPilot-Extension/lib; website/test/bp-libs.test.js keeps them
   identical) and runs only in this page. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };

  // ── Load sequence: the headline lines rise, then the film window (settled inside about 1.5 s) ──
  requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('ready'); }); });

  // ── Nav: transparent on the purple hero, solid after it ──
  var nav = $('nav');
  function paintNav() { if (nav) nav.classList.toggle('solid', window.scrollY > 40 || document.body.classList.contains('page')); }
  paintNav();
  window.addEventListener('scroll', paintNav, { passive: true });

  // ── The hero film ──
  var v = $('film-v'), fbtn = $('film-btn');
  if (v) {
    if (reduce) { v.removeAttribute('autoplay'); try { v.pause(); } catch (_) {} }
    var userPaused = reduce;
    var paint = function () {
      var paused = v.paused;
      fbtn.setAttribute('aria-label', paused ? 'Play the film' : 'Pause the film');
      fbtn.setAttribute('aria-pressed', String(paused));
      fbtn.innerHTML = paused
        ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>';
    };
    fbtn.addEventListener('click', function () {
      if (v.paused) { userPaused = false; v.play().catch(function () {}); } else { userPaused = true; v.pause(); }
    });
    v.addEventListener('play', paint); v.addEventListener('pause', paint); paint();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        if (e[0].isIntersecting) { if (!userPaused) v.play().catch(function () {}); } else v.pause();
      }, { threshold: 0.2 }).observe(v);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else if (!userPaused) v.play().catch(function () {}); });
  }

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

  // ── Paste a post: BenchPilot's reader in the page ──
  var SAMPLES = {
    ai: $('post') ? $('post').value : '',
    java: 'Hiring: Sr. Java Developer\nLocation: Dallas, TX (Hybrid, 3 days onsite)\nDuration: 12+ months contract, C2C\nVisa: H1B, GC, USC\nSkills: Java 17, Spring Boot, Microservices, Kafka, AWS\n\nPlease share resumes to asha.menon@example.com',
    hot: 'Hotlist of available consultants\n\nRavi - Java Developer - H1B - 10 yrs - Plano, TX\nPriya - .NET Full Stack - GC - 8 yrs\nArjun - DevOps / AWS - H1B - 9 yrs\n\nShare your C2C requirements to bench@northgate.example.com'
  };
  // Same rules as extractRequirement in BenchPilot-Extension/content/content.js (label first, then a title-like first line).
  function roleOf(text) {
    var label = text.match(/\b(?:Job\s+Title|Position\s+Title|Job\s+Role|Title|Role|Position|Requirement)\b\s*[:\-–]\s*([^\n\r•|;,()]+)|\bHiring(?:\s+for\b\s*[:\-–]?|\s*:)\s*([^\n\r•|;,()]+)/i);
    var clean = function (raw) {
      return raw.replace(/^(?:an?\s+|urgent\s+|immediate\s+|hiring\s+for\s+|hiring\s*:\s*|need\s+)/i, '')
        .replace(/\s+(?:remote|urgent|c2c|w2|contract|in\s+usa|fulltime).*$/i, '').replace(/[\s\-–—|:,/]+$/, '').trim();
    };
    if (label && (label[1] || label[2])) {
      var req = (label[1] || label[2]).trim().replace(/\s*(?:Location|Duration|Experience|Rate|Client|Must|Remote|Hybrid|Onsite|Contract).*$/i, '').trim();
      if (req.length >= 3 && req.length <= 50) return clean(req);
    }
    var first = (text.split(/\r?\n/).map(function (l) { return l.replace(/^[\s•*#\-–]+/, '').trim(); }).filter(Boolean)[0]) || '';
    if (first.length <= 70 && /\b(?:developer|engineer|architect|analyst|administrator|consultant|scientist|tester|lead|manager|specialist)\b/i.test(first) &&
        !/\b(?:hiring|looking|urgent|please|share|we are|i am|hotlist)\b/i.test(first)) return clean(first);
    return '';
  }
  function setRow(id, value) {
    var el = $(id);
    if (!el) return;
    el.textContent = value || 'Not stated in the post';
    el.className = value ? '' : 'none';
  }
  function readPost() {
    var BP = window.BP;
    if (!BP || !BP.classifyPost || !$('post')) return;
    var text = $('post').value;
    var t0 = performance.now();
    var kind = BP.classifyPost({ text: text, headline: '' });
    var fields = BP.parseRequirementFields(text) || {};
    var emails = BP.extractEmails(text) || [];
    var skills = (BP.extractSkills(text) || []).slice(0, 8);
    var role = roleOf(text);
    var tags = kind.tags || {};
    var hot = kind.type === 'hotlist';
    var type = $('r-type');
    type.textContent = hot ? 'Hotlist · not hiring' : kind.type === 'requirement' ? 'Requirement' : kind.type === 'recruiter-job' ? 'A recruiting job' : 'Not sure';
    type.className = 'rec-type' + (hot ? ' hot' : '');
    setRow('r-role', hot ? '' : role);
    setRow('r-group', hot ? '' : (BP.roleFamilyOfText ? BP.roleFamilyOfText((role || '') + ' ' + text) : ''));
    setRow('r-client', fields.endClient || '');
    var mode = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite' }[tags.workMode] || '';
    setRow('r-where', [tags.localState || '', mode].filter(Boolean).join(' · '));
    setRow('r-visa', (fields.visaAllowed || []).join(', '));
    setRow('r-rate', fields.rate ? fields.rate.text : '');
    setRow('r-email', emails[0] || '');
    var box = $('r-skills');
    box.textContent = '';
    for (var i = 0; i < skills.length; i++) { var sp = document.createElement('span'); sp.textContent = skills[i]; box.appendChild(sp); }
    var ms = Math.max(1, Math.round(performance.now() - t0));
    $('r-foot').textContent = hot
      ? 'A bench seller sharing consultants, so BenchPilot files it under Bench sellers, not requirements. Read in ' + ms + ' ms, nothing sent.'
      : 'Read in this page in ' + ms + ' ms. Nothing was sent.';
    var rec = $('record');
    if (!reduce) { rec.classList.remove('flash'); void rec.offsetWidth; rec.classList.add('flash'); }
  }
  var timer = 0;
  function boot() {
    var post = $('post');
    if (!post) return;
    post.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(readPost, 160); });
    var btns = document.querySelectorAll('[data-sample]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function () {
        post.value = SAMPLES[this.getAttribute('data-sample')] || '';
        for (var c = 0; c < btns.length; c++) btns[c].setAttribute('aria-pressed', btns[c] === this ? 'true' : 'false');
        readPost();
      });
    }
    readPost();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
