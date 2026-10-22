/* BenchPilot home page: live clocks, the docked drawer that follows the section you read, entrances, and the
   "Paste a post" reader. The reader uses BenchPilot's own library files (assets/bp/*.js, copies of
   BenchPilot-Extension/lib; website/test/bp-libs.test.js keeps them identical) and runs only in this page. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Clocks: Hyderabad and New York, right now ──
  function paintClocks() {
    var els = document.querySelectorAll('[data-clock]');
    for (var i = 0; i < els.length; i++) {
      try {
        els[i].textContent = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: els[i].getAttribute('data-clock') })
          .format(new Date()).replace('AM', 'am').replace('PM', 'pm');
      } catch (_) { /* keep the written time */ }
    }
    var ny = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var h = ny.getHours(), day = ny.getDay();
    var tail = document.querySelector('#clocks');
    if (tail) {
      var open = day > 0 && day < 6 && h >= 8 && h < 18;
      var last = tail.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = open ? ', and recruiters are posting.' : '. US recruiters are offline; matches wait in the drawer.';
    }
  }
  paintClocks();
  setInterval(paintClocks, 30000);

  // ── Entrances: each part of a section rises in turn, once ──
  var items = document.querySelectorAll('[data-in]');
  function stagger(root) {
    var parts = root.querySelectorAll('[data-in]');
    for (var i = 0; i < parts.length; i++) parts[i].style.setProperty('--d', (Math.min(i, 4) * 80) + 'ms');
  }
  var groups = document.querySelectorAll('section, .mod');
  for (var g = 0; g < groups.length; g++) stagger(groups[g]);
  // The first screen arrives on load (settled well inside 1.2 s); everything below waits for its section.
  var heroParts = document.querySelectorAll('.hero [data-in]');
  requestAnimationFrame(function () { for (var hp = 0; hp < heroParts.length; hp++) heroParts[hp].classList.add('in'); });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { entries[i].target.classList.add('in'); io.unobserve(entries[i].target); }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    for (var k = 0; k < items.length; k++) io.observe(items[k]);
  } else {
    for (var j = 0; j < items.length; j++) items[j].classList.add('in');
  }

  // ── The docked drawer shows the screen of the module you are reading ──
  var shots = {};
  var stageImgs = document.querySelectorAll('.stage img');
  for (var s = 0; s < stageImgs.length; s++) shots[stageImgs[s].getAttribute('data-shot')] = stageImgs[s];
  var current = 'matches';
  function show(name) {
    if (!shots[name] || name === current) return;
    shots[current].classList.remove('on');
    shots[name].classList.add('on');
    current = name;
  }
  if ('IntersectionObserver' in window) {
    var mods = document.querySelectorAll('[data-stage]');
    var so = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) show(entries[i].target.getAttribute('data-stage'));
    }, { rootMargin: '-45% 0px -45% 0px' });
    for (var m = 0; m < mods.length; m++) so.observe(mods[m]);
    var hero = document.querySelector('.hero');
    if (hero) new IntersectionObserver(function (e) { if (e[0].isIntersecting) show('matches'); }, { rootMargin: '-45% 0px -45% 0px' }).observe(hero);
  }

  // ── Autosave choice in the closing dialog ──
  var seg = document.querySelectorAll('.seg [role="radio"]');
  for (var r = 0; r < seg.length; r++) {
    seg[r].addEventListener('click', function () {
      for (var q = 0; q < seg.length; q++) seg[q].setAttribute('aria-checked', seg[q] === this ? 'true' : 'false');
    });
  }

  // ── Paste a post: BenchPilot's reader in the page ──
  var SAMPLES = {
    ai: document.getElementById('post') ? document.getElementById('post').value : '',
    java: 'Hiring: Sr. Java Developer\nLocation: Dallas, TX (Hybrid, 3 days onsite)\nDuration: 12+ months contract, C2C\nVisa: H1B, GC, USC\nSkills: Java 17, Spring Boot, Microservices, Kafka, AWS\n\nPlease share resumes to asha.menon@example.com',
    hot: 'Hotlist of available consultants\n\nRavi - Java Developer - H1B - 10 yrs - Plano, TX\nPriya - .NET Full Stack - GC - 8 yrs\nArjun - DevOps / AWS - H1B - 9 yrs\n\nShare your C2C requirements to bench@northgate.example.com'
  };
  // Same rules as extractRequirement in BenchPilot-Extension/content/content.js (label first, then a title-like first line).
  function roleOf(text) {
    var label = text.match(/\b(?:Job\s+Title|Position\s+Title|Job\s+Role|Title|Role|Position|Requirement)\b\s*[:\-–]\s*([^\n\r•|;,()]+)|\bHiring(?:\s+for\b\s*[:\-–]?|\s*:)\s*([^\n\r•|;,()]+)/i);
    var clean = function (raw) {
      return raw.replace(/^(?:an?\s+|urgent\s+|immediate\s+|hiring\s+for\s+|hiring\s*:\s*)/i, '')
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
  var $ = function (id) { return document.getElementById(id); };
  function setRow(id, value) {
    var el = $(id);
    if (!el) return;
    el.textContent = value || 'Not stated in the post';
    el.className = value ? '' : 'none';
  }
  function readPost() {
    var BP = window.BP;
    var text = $('post').value;
    if (!BP || !BP.classifyPost) return;
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
