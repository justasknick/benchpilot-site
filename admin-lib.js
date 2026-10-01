// admin-lib.js - pure helpers for admin.html. No DOM, no network, no storage, so it loads in the browser
// (as window.BPAdminLib) and in Node (module.exports) for tests. The server stays the authority: everything
// validated here is validated again by supabase/functions/_shared/adminHandlers.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BPAdminLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_REASON = 300;
  var MIN_DAYS = 1;
  var MAX_DAYS = 366;
  var DAY_PRESETS = [7, 30, 90];
  var TIERS = { basic: 'Basic', pro: 'Pro', free: 'Free' };
  var IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var CONTROL_RE = /[\u0000-\u001f\u007f]/;

  function tierLabel(t) { return TIERS[t] || (t ? String(t) : 'Free'); }

  // ---- dates (IST calendar dates, YYYY-MM-DD, same as the server) ----
  function istToday(nowMs) {
    return new Date((nowMs === undefined ? Date.now() : nowMs) + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  function addDays(ymd, n) {
    var p = String(ymd).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  /** The server sets ends_on = IST today + days (bp_grant_plan). */
  function grantEndDate(nowMs, days) { return addDays(istToday(nowMs), days); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** '2026-10-01' or an ISO timestamp -> '1 Oct 2026'. Anything unusable -> '-'. */
  function formatDate(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '');
    if (!m) return '-';
    var mon = MONTHS[Number(m[2]) - 1];
    return mon ? Number(m[3]) + ' ' + mon + ' ' + m[1] : '-';
  }
  /** ISO timestamp -> '1 Oct 2026, 14:05 IST'. */
  function formatDateTime(v) {
    var t = typeof v === 'string' ? Date.parse(v) : NaN;
    if (isNaN(t)) return '-';
    var ist = new Date(t + IST_OFFSET_MS).toISOString();
    return formatDate(ist) + ', ' + ist.slice(11, 16) + ' IST';
  }

  // ---- money ----
  /** payments.amount is stored in the smallest currency unit (paise for INR; plans.js: 59900 = Rs 599). */
  function formatMoney(amount, currency) {
    if (!Number.isFinite(amount)) return '-';
    var cur = (currency || 'INR').toUpperCase();
    var neg = amount < 0 ? '-' : '';
    var abs = Math.abs(Math.round(amount));
    var major = Math.floor(abs / 100);
    var minor = String(abs % 100).padStart(2, '0');
    var s = String(major);
    if (cur === 'INR') { // Indian digit grouping: 1,23,456
      s = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3) : s;
      return neg + '₹' + s + '.' + minor;
    }
    return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + minor + ' ' + cur;
  }

  // ---- forms ----
  function normaliseReason(r) { return typeof r === 'string' ? r.trim() : ''; }

  /** @returns {{ok:boolean, errors:Object, value?:{tier:string,days:number,reason:string}}} */
  function validateGrantForm(f) {
    f = f || {};
    var errors = {};
    if (f.tier !== 'basic' && f.tier !== 'pro') errors.tier = 'Choose Basic or Pro.';
    var days = typeof f.days === 'number' ? f.days : (/^\d+$/.test(String(f.days == null ? '' : f.days).trim()) ? Number(String(f.days).trim()) : NaN);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) errors.days = 'Days must be a whole number from ' + MIN_DAYS + ' to ' + MAX_DAYS + '.';
    var reason = normaliseReason(f.reason);
    if (!reason) errors.reason = 'A reason is required.';
    else if (reason.length > MAX_REASON) errors.reason = 'Reason must be ' + MAX_REASON + ' characters or fewer.';
    else if (CONTROL_RE.test(reason)) errors.reason = 'Reason has invalid characters (no line breaks).';
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, errors: {}, value: { tier: f.tier, days: days, reason: reason } };
  }

  function validateReason(r) {
    var reason = normaliseReason(r);
    if (!reason) return { ok: false, error: 'A reason is required.' };
    if (reason.length > MAX_REASON) return { ok: false, error: 'Reason must be ' + MAX_REASON + ' characters or fewer.' };
    if (CONTROL_RE.test(reason)) return { ok: false, error: 'Reason has invalid characters (no line breaks).' };
    return { ok: true, reason: reason };
  }

  function validateSearchQuery(q) {
    var s = typeof q === 'string' ? q.trim() : '';
    if (!s) return { ok: false, error: 'Type part of an email address.' };
    if (s.length > 100) return { ok: false, error: 'Search text is too long.' };
    if (CONTROL_RE.test(s)) return { ok: false, error: 'Search text has invalid characters.' };
    return { ok: true, query: s };
  }

  /** Authenticator codes: 6 digits; spaces are tolerated because apps display "123 456". */
  function validateTotpCode(c) {
    var s = typeof c === 'string' ? c.replace(/\s+/g, '') : '';
    return /^\d{6}$/.test(s) ? { ok: true, code: s } : { ok: false, error: 'Enter the 6-digit code from your authenticator app.' };
  }

  function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

  // ---- request bodies for POST /functions/v1/admin ----
  function searchBody(query) { return { action: 'search_users', query: query }; }
  function getUserBody(userId) { return { action: 'get_user', user_id: userId }; }
  function grantBody(userId, v) { return { action: 'grant', user_id: userId, tier: v.tier, days: v.days, reason: v.reason }; }
  function revokeBody(grantId, reason) { return { action: 'revoke', grant_id: grantId, reason: reason }; }

  /** "Give a@b.com Pro until 31 Oct 2026 (30 days from today)?" */
  function grantConfirmText(email, v, nowMs) {
    return 'Give ' + email + ' ' + tierLabel(v.tier) + ' until ' + formatDate(grantEndDate(nowMs, v.days)) +
      ' (' + v.days + (v.days === 1 ? ' day' : ' days') + ' from today)?';
  }

  // ---- auth session (GoTrue) ----
  function decodeJwtClaims(token) {
    try {
      var p = String(token).split('.')[1];
      if (!p) return null;
      p = p.replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var bin = atob(p);
      var bytes = '';
      for (var i = 0; i < bin.length; i++) bytes += '%' + ('00' + bin.charCodeAt(i).toString(16)).slice(-2);
      return JSON.parse(decodeURIComponent(bytes));
    } catch (e) { return null; }
  }
  /** 'aal1' | 'aal2' | null. UI gating only; the server re-checks the token on every call. */
  function tokenAal(token) {
    var c = decodeJwtClaims(token);
    return c && (c.aal === 'aal1' || c.aal === 'aal2') ? c.aal : null;
  }

  /** GoTrue token response -> the small object kept in sessionStorage. */
  function normaliseSession(r, nowMs) {
    if (!r || typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string') return null;
    var now = nowMs === undefined ? Date.now() : nowMs;
    var exp = Number.isFinite(r.expires_at) ? r.expires_at * 1000 : now + (Number(r.expires_in) || 0) * 1000;
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: exp,
      email: (r.user && r.user.email) || null
    };
  }
  function needsRefresh(session, nowMs, skewMs) {
    if (!session) return false;
    return (nowMs === undefined ? Date.now() : nowMs) >= session.expires_at - (skewMs === undefined ? 60000 : skewMs);
  }

  /** From GET /auth/v1/user: the verified TOTP factor (if any) and leftover unverified TOTP factors. */
  function pickFactors(user) {
    var all = (user && Array.isArray(user.factors)) ? user.factors : [];
    var totp = all.filter(function (f) { return f && f.factor_type === 'totp'; });
    return {
      verified: totp.find(function (f) { return f.status === 'verified'; }) || null,
      unverified: totp.filter(function (f) { return f.status !== 'verified'; })
    };
  }

  /** Readable, non-leaking message for a failed GoTrue call. */
  function authErrorMessage(status, body) {
    var code = body && (body.error_code || body.code);
    var msg = (body && (body.msg || body.message || body.error_description)) || '';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Email or password is wrong.';
    if (code === 'mfa_verification_failed' || /invalid totp|mfa.*fail/i.test(msg)) return 'That code was not accepted. Wait for a fresh code and try again.';
    if (code === 'over_request_rate_limit' || status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (code === 'mfa_factor_name_conflict') return 'An old enrolment is in the way. Reload the page and try again.';
    if (status === 0) return 'Network problem. Check your connection and try again.';
    return 'Sign-in failed (' + status + '). Try again.';
  }

  /** Readable message for a failed admin function call. 403 is deliberately uninformative (server gives no detail). */
  function adminErrorMessage(status, body) {
    if (status === 403) return 'Not authorised. You must be an admin and signed in with your authenticator code.';
    if (status === 0) return 'Network problem. Check your connection and try again.';
    if (status === 429) return 'Too many requests. Wait a moment and try again.';
    var e = body && body.error;
    if (e && ['user_not_found', 'grant_not_found', 'already_revoked', 'invalid_input'].indexOf(e.code) >= 0 && typeof e.message === 'string') return e.message;
    return 'Something went wrong (' + status + '). Try again.';
  }

  return {
    MAX_REASON: MAX_REASON, MIN_DAYS: MIN_DAYS, MAX_DAYS: MAX_DAYS, DAY_PRESETS: DAY_PRESETS,
    tierLabel: tierLabel, istToday: istToday, addDays: addDays, grantEndDate: grantEndDate,
    formatDate: formatDate, formatDateTime: formatDateTime, formatMoney: formatMoney,
    validateGrantForm: validateGrantForm, validateReason: validateReason, validateSearchQuery: validateSearchQuery,
    validateTotpCode: validateTotpCode, isUuid: isUuid,
    searchBody: searchBody, getUserBody: getUserBody, grantBody: grantBody, revokeBody: revokeBody,
    grantConfirmText: grantConfirmText,
    decodeJwtClaims: decodeJwtClaims, tokenAal: tokenAal, normaliseSession: normaliseSession,
    needsRefresh: needsRefresh, pickFactors: pickFactors,
    authErrorMessage: authErrorMessage, adminErrorMessage: adminErrorMessage
  };
});
