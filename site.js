/* BenchPilot home page: the plan teaser in rupees (India) or dollars (elsewhere), the hero drawer's dock-in is CSS only.
   Prices come from assets/currency.js (the one website price table, checked against the server's plan table by test/currency.test.js). */
(function () {
  'use strict';
  var C = window.BPCurrency;

  // ── Plan teaser: ₹ for India, $ elsewhere; a choice made on the pricing page is remembered ──
  var teaser = document.getElementById('teaser');
  if (teaser && C) {
    var cur = C.preferredCurrency();
    teaser.setAttribute('data-c', cur);
    var cells = teaser.querySelectorAll('[data-price]');
    for (var i = 0; i < cells.length; i++) {
      var t = cells[i].getAttribute('data-price');
      cells[i].textContent = t === 'free' ? C.priceFor(cur, 'free', 'm') : C.priceFor(cur, t, 'm');
    }
  }

})();
