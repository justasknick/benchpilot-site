// assets/currency.js - which currency to show prices in, and the website's one price table (home teaser and pricing page).
// India visitors see rupees; everyone else sees US dollars. Solo checkout is in rupees for now (Razorpay).
// The same rule is mirrored in BenchPilot-Extension/lib/shared.js (BP.detectCurrency) for the Upgrade page.
// The amounts mirror the server's plan table (supabase/functions/_shared/plans.js PLANS and TEAM_PLANS); test/currency.test.js
// checks every one of them against it, so a price change on the server fails the site's tests until this table follows.
(function (root) {
  'use strict';

  var INDIA_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];

  // Pure: 'INR' for an India time zone (or, when the zone is unknown, an "-IN" language tag), else 'USD'.
  function detectCurrency(timeZone, language) {
    if (timeZone && INDIA_ZONES.indexOf(String(timeZone)) !== -1) return 'INR';
    if (!timeZone && /-IN$/i.test(String(language || ''))) return 'INR';
    return 'USD';
  }

  // Display prices. m = a month, y = a year, ym = a year's price per month.
  // Solo is the one individual paid plan (final plan §8b, Nov 2026); Basic and Pro are no longer sold.
  // The Team plan comes in three sizes (server tiers starter / team / agency), monthly, before GST. Yearly team plans are built but not on
  // sale (TEAM_ANNUAL_ENABLED), so they have no yearly price here.
  var PRICES = {
    INR: { free: { m: '₹0' }, solo: { m: '₹499', y: '₹3,999', ym: '₹333' },
      starter: { m: '₹3,999' }, team: { m: '₹7,999' }, agency: { m: '₹14,999' } },
    USD: { free: { m: '$0' }, solo: { m: '$12', y: '$99', ym: '$8.25' },
      starter: { m: '$49' }, team: { m: '$99' }, agency: { m: '$179' } }
  };
  // The most people each Team size allows (TEAM_PLANS seats: active members plus pending invites).
  var SEATS = { starter: 5, team: 15, agency: 40 };
  var TEAM_SIZES = ['starter', 'team', 'agency'];

  function priceFor(currency, tier, cycle) {
    var t = PRICES[currency === 'INR' ? 'INR' : 'USD'][tier];
    return t ? t[cycle] || '' : '';
  }

  function amountOf(text) { return Number(String(text || '').replace(/[^0-9.]/g, '')) || 0; }

  // Pure: the yearly saving against 12 monthly payments, in whole percent, rounded down (never claim more than the real saving).
  // Computed from PRICES, so the "save N%" tag follows any price change.
  function savePercent(currency, tier) {
    var m = amountOf(priceFor(currency, tier, 'm')), y = amountOf(priceFor(currency, tier, 'y'));
    if (!m || !y || y >= m * 12) return 0;
    return Math.floor(((m * 12 - y) / (m * 12)) * 100);
  }

  // Pure: a Team size's monthly price per person when every seat is used ("≈ ₹533"), so it compares with Solo. Rupees round to the
  // nearest rupee; dollars to the cent. '' for a tier that is not a Team size.
  function perPerson(currency, tier) {
    var seats = SEATS[tier], m = amountOf(priceFor(currency, tier, 'm'));
    if (!seats || !m) return '';
    if (currency === 'INR') return '₹' + Math.round(m / seats).toLocaleString('en-IN');
    return '$' + (Math.round((m * 100) / seats) / 100).toFixed(2);
  }

  // The currency to show: the visitor's earlier choice (localStorage 'bp-currency') or the time-zone rule.
  function preferredCurrency() {
    try { var v = root.localStorage && root.localStorage.getItem('bp-currency'); if (v === 'INR' || v === 'USD') return v; } catch (e) { /* private mode */ }
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { tz = ''; }
    return detectCurrency(tz, root.navigator && root.navigator.language);
  }
  function rememberCurrency(v) {
    try { root.localStorage.setItem('bp-currency', v); } catch (e) { /* private mode: the choice just is not remembered */ }
  }

  var api = { detectCurrency: detectCurrency, priceFor: priceFor, savePercent: savePercent, perPerson: perPerson,
    preferredCurrency: preferredCurrency, rememberCurrency: rememberCurrency, PRICES: PRICES, SEATS: SEATS, TEAM_SIZES: TEAM_SIZES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPCurrency = api;
})(typeof self !== 'undefined' ? self : this);
