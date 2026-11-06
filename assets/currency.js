// assets/currency.js - which currency to show prices in, and the price table for the home page.
// India visitors see rupees; everyone else sees US dollars. Checkout is in rupees for now (Razorpay).
// The same rule is mirrored in BenchPilot-Extension/lib/shared.js (BP.detectCurrency) for the Upgrade page.
(function (root) {
  'use strict';

  var INDIA_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];

  // Pure: 'INR' for an India time zone (or, when the zone is unknown, an "-IN" language tag), else 'USD'.
  function detectCurrency(timeZone, language) {
    if (timeZone && INDIA_ZONES.indexOf(String(timeZone)) !== -1) return 'INR';
    if (!timeZone && /-IN$/i.test(String(language || ''))) return 'INR';
    return 'USD';
  }

  // Display prices. INR values mirror docs/PROJECT_DETAILS.md; USD values were set by Nick on 6 Nov 2026.
  var PRICES = {
    INR: { basic: { m: '₹299', y: '₹2,499', ym: '₹208' }, pro: { m: '₹599', y: '₹4,999', ym: '₹417' } },
    USD: { basic: { m: '$4.99', y: '$49', ym: '$4.08' }, pro: { m: '$9.99', y: '$99', ym: '$8.25' } }
  };

  function priceFor(currency, tier, cycle) {
    var t = PRICES[currency === 'INR' ? 'INR' : 'USD'][tier];
    return t ? t[cycle] || '' : '';
  }

  var api = { detectCurrency: detectCurrency, priceFor: priceFor, PRICES: PRICES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPCurrency = api;
})(typeof self !== 'undefined' ? self : this);
