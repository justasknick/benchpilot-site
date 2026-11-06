/* BenchPilot home page: billing period, currency (rupees for India, dollars elsewhere) and the film.
   No product screens are built in code; the hero film is a rendered video (assets/five-apps.mp4). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var C = window.BPCurrency;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Film: autoplays muted and loops; with reduced motion it shows the still poster instead ──
  var film = $('film');
  if (film && reduce) {
    var still = document.createElement('img');
    still.src = film.getAttribute('poster');
    still.alt = film.getAttribute('aria-label') || '';
    still.width = 720; still.height = 900;
    film.pause();
    film.parentNode.replaceChild(still, film);
  }

  // ── Plans: monthly or yearly, rupees or dollars ──
  var grid = $('plan-grid');
  if (!grid || !C) return;
  var state = { p: 'm', c: C.detectCurrency(tz(), navigator.language) };
  var saved = readSaved();
  if (saved) state.c = saved;

  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } }
  function readSaved() { try { var v = localStorage.getItem('bp-currency'); return v === 'INR' || v === 'USD' ? v : ''; } catch (e) { return ''; } }
  function save(v) { try { localStorage.setItem('bp-currency', v); } catch (e) { /* private mode: the choice just is not remembered */ } }
  function pressed(group, attr, val) {
    var b = group.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', b[i].getAttribute(attr) === val ? 'true' : 'false');
  }

  function render() {
    grid.setAttribute('data-p', state.p);
    grid.setAttribute('data-c', state.c);
    var tiers = ['basic', 'pro'];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      grid.querySelector('[data-tier="' + t + '"]').textContent = C.priceFor(state.c, t, state.p);
      var sub = grid.querySelector('[data-sub="' + t + '"]');
      sub.textContent = state.p === 'm'
        ? 'Or ' + C.priceFor(state.c, t, 'y') + ' a year. No auto-renewal.'
        : 'About ' + C.priceFor(state.c, t, 'ym') + ' a month. No auto-renewal.';
    }
    var pers = grid.querySelectorAll('[data-per]');
    for (var j = 0; j < pers.length; j++) pers[j].textContent = state.p === 'm' ? '/month' : '/year';
    grid.querySelector('[data-free]').textContent = state.c === 'INR' ? '₹0' : '$0';
    var founding = grid.querySelector('[data-inr-only]');
    if (founding) founding.hidden = state.c !== 'INR';
    $('usd-note').hidden = state.c !== 'USD';
    $('save-tag').textContent = state.c === 'INR' ? 'save up to 30%' : 'save up to 18%';
    pressed($('period'), 'data-p', state.p);
    pressed($('currency'), 'data-c', state.c);
  }

  $('period').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.p = b.getAttribute('data-p'); render();
  });
  $('currency').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.c = b.getAttribute('data-c'); save(state.c); render();
  });
  render();
})();
