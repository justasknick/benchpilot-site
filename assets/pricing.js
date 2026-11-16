/* pricing.html: monthly or yearly (default yearly), rupees or dollars, and the Team plan's size (5, 15 or 40 people).
   Every amount comes from assets/currency.js (checked against the server's plan table by test/currency.test.js); nothing is hard-coded here. */
(function () {
  'use strict';
  var C = window.BPCurrency;
  var $ = function (id) { return document.getElementById(id); };
  var grid = $('plan-grid');
  if (!grid || !C) return;
  var state = { p: 'y', c: C.preferredCurrency(), size: 'team' };
  var checked = document.querySelector('#team-size input:checked');
  if (checked) state.size = checked.value;

  function pressed(group, attr, val) {
    var b = group.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', b[i].getAttribute(attr) === val ? 'true' : 'false');
  }
  function each(sel, fn) { var n = document.querySelectorAll(sel); for (var i = 0; i < n.length; i++) fn(n[i]); }

  function render() {
    var c = state.c, p = state.p;
    grid.setAttribute('data-p', p);
    grid.setAttribute('data-c', c);
    // Free and Solo
    grid.querySelector('[data-free]').textContent = C.priceFor(c, 'free', 'm');
    grid.querySelector('[data-tier="solo"]').textContent = C.priceFor(c, 'solo', p);
    grid.querySelector('[data-per]').textContent = p === 'm' ? '/month' : '/year';
    grid.querySelector('[data-sub="solo"]').textContent = p === 'm'
      ? 'Or ' + C.priceFor(c, 'solo', 'y') + ' a year. No auto-renewal.'
      : 'About ' + C.priceFor(c, 'solo', 'ym') + ' a month. No auto-renewal.';
    var founding = grid.querySelector('[data-inr-only]');
    if (founding) founding.hidden = c !== 'INR';
    // Team: the chosen size, always monthly (yearly team plans are not on sale)
    grid.querySelector('[data-team-price]').textContent = C.priceFor(c, state.size, 'm');
    grid.querySelector('[data-team-per]').textContent = 'About ' + C.perPerson(c, state.size) + ' per person a month';
    grid.querySelector('[data-team-yearly]').hidden = p !== 'y';
    each('[data-size-price]', function (el) { el.textContent = C.priceFor(c, el.getAttribute('data-size-price'), 'm'); });
    each('[data-size-per]', function (el) { el.textContent = C.perPerson(c, el.getAttribute('data-size-per')); });
    // The comparison table's column heads
    var cmpFree = document.querySelector('[data-cmp="free"]');
    if (cmpFree) cmpFree.textContent = C.priceFor(c, 'free', 'm');
    var cmpSolo = document.querySelector('[data-cmp="solo"]');
    if (cmpSolo) cmpSolo.textContent = p === 'm' ? C.priceFor(c, 'solo', 'm') + ' a month' : C.priceFor(c, 'solo', 'y') + ' a year';
    var cmpTeam = document.querySelector('[data-cmp="team"]');
    if (cmpTeam) cmpTeam.textContent = 'from ' + C.priceFor(c, C.TEAM_SIZES[0], 'm') + ' a month';
    $('usd-note').hidden = c !== 'USD';
    var pct = C.savePercent(c, 'solo');
    $('save-tag').textContent = pct ? 'save ' + pct + '%' : '';
    pressed($('period'), 'data-p', p);
    pressed($('currency'), 'data-c', c);
  }

  $('period').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.p = b.getAttribute('data-p'); render();
  });
  $('currency').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.c = b.getAttribute('data-c'); C.rememberCurrency(state.c); render();
  });
  $('team-size').addEventListener('change', function (e) {
    if (e.target && e.target.name === 'size') { state.size = e.target.value; render(); }
  });
  render();
})();
