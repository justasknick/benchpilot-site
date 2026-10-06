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

  // ---- payment issues (payments that paid but failed a server check; migration 0005) ----
  var ISSUE_REASONS = {
    unknown_plan: 'Unknown plan',
    bad_uid: 'Invalid user id',
    not_captured: 'Not captured',
    currency_mismatch: 'Wrong currency',
    amount_mismatch: 'Wrong amount',
    checkout_missing: 'No checkout on record',
    checkout_mismatch: 'Checkout is for another user or plan'
  };
  /** Machine reason -> short words; an unknown reason is shown as-is. */
  function issueReasonLabel(reason) {
    return Object.prototype.hasOwnProperty.call(ISSUE_REASONS, reason) ? ISSUE_REASONS[reason] : (reason ? String(reason) : '-');
  }
  function issueCountText(n) {
    var c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return c === 0 ? 'No open payment issues' : c + (c === 1 ? ' open payment issue' : ' open payment issues');
  }
  function paymentIssuesBody() { return { action: 'list_payment_issues' }; }
  function resolveIssueBody(issueId, note) { return { action: 'resolve_payment_issue', issue_id: issueId, note: note }; }

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
    if (status === 502) return 'The sign-in service did not respond. Try again.';
    var e = body && body.error;
    if ((status === 400 || status === 404 || status === 409) && e && typeof e.message === 'string' && e.message && e.message.length <= 200) return e.message;
    return 'Something went wrong (' + status + '). Try again.';
  }

  // ======================= Admin v2 helpers =======================
  var MAX_BULK = 100;
  var PAGE_SIZE = 50;
  var EXPORT_PAGE = 100;     // server maximum per request
  var EXPORT_MAX_ROWS = 5000;
  var RANGES = [7, 30, 90];
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var USER_SORTS = { created_desc: 'Newest sign-up', created_asc: 'Oldest sign-up', last_sign_in_desc: 'Last sign-in', email_asc: 'Email A-Z' };

  // ---- numbers ----
  /** 12345 -> '12,345'; 1234567 -> '12,34,567' (Indian grouping). */
  function formatCount(n) {
    if (!Number.isFinite(n)) return '-';
    var neg = n < 0 ? '-' : '';
    var s = String(Math.abs(Math.round(n)));
    if (s.length > 3) s = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
    return neg + s;
  }
  /** Paise -> whole rupees, e.g. 5990000 -> '₹59,900' (dashboard cards). */
  function formatRupees(paise) {
    if (!Number.isFinite(paise)) return '-';
    var neg = paise < 0 ? '-' : '';
    return neg + '₹' + formatCount(Math.round(Math.abs(paise) / 100));
  }
  function trimZero(s) { return s.replace(/\.0$/, ''); }
  /** Compact rupees for axis ticks: 150000 paise -> '₹1.5k'. */
  function formatRupeesShort(paise) {
    if (!Number.isFinite(paise)) return '-';
    var r = paise / 100;
    if (r >= 100000) return '₹' + trimZero((r / 100000).toFixed(1)) + 'L';
    if (r >= 1000) return '₹' + trimZero((r / 1000).toFixed(1)) + 'k';
    return '₹' + Math.round(r);
  }
  /** part/whole as a whole-number percent string; 0 whole -> '0%'. */
  function pct(part, whole) {
    if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '0%';
    return Math.round((part / whole) * 100) + '%';
  }
  /** part/whole as a number 0-100 (one decimal), for bar widths. */
  function pctNum(part, whole) {
    if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((part / whole) * 1000) / 10));
  }

  // ---- CSV (spreadsheet formula injection guard) ----
  /** Strings starting with = + - @ (or tab / CR) get a leading ' so Excel and Sheets treat them as text. */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(headers, rows) {
    var out = [headers.map(csvCell).join(',')];
    rows.forEach(function (r) { out.push(r.map(csvCell).join(',')); });
    return out.join('\r\n') + '\r\n';
  }
  var USER_CSV_HEADERS = ['Email', 'User ID', 'Signed up (IST)', 'Last sign-in (IST)', 'Provider', 'Status', 'Plan', 'Plan source', 'Plan until', 'Paid tier', 'Paid until'];
  function userStatus(u) {
    if (u && u.suspended) return 'suspended';
    if (u && !u.email_confirmed_at) return 'unconfirmed';
    return 'active';
  }
  function userCsvRow(u) {
    var e = u.effective || {};
    return [u.email, u.id, formatDateTime(u.created_at), formatDateTime(u.last_sign_in_at), u.provider || '', userStatus(u),
      e.plan || 'free', e.source || '', e.until || '', u.paid ? u.paid.tier : '', u.paid ? u.paid.until : ''];
  }
  var PAYMENT_CSV_HEADERS = ['Date (IST)', 'Email', 'Razorpay payment', 'Plan', 'Amount', 'Currency', 'Status', 'Refunded on'];
  function paymentCsvRow(p) {
    return [formatDateTime(p.created_at), p.email || '', p.razorpay_payment_id || '', p.plan || '',
      Number.isFinite(p.amount) ? (p.amount / 100).toFixed(2) : '', p.currency || 'INR', p.status || '', p.refunded_at ? formatDate(p.refunded_at) : ''];
  }

  // ---- filters -> request bodies ----
  function validYmd(v) {
    if (typeof v !== 'string' || !YMD_RE.test(v)) return false;
    var d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  /** Keep only non-empty, well-formed filter values. allowed: {name: 'text'|'date'|[enum values]}. */
  function cleanFilter(raw, allowed) {
    var out = {};
    raw = raw || {};
    Object.keys(allowed).forEach(function (k) {
      var v = raw[k];
      if (typeof v !== 'string') return;
      v = v.trim();
      if (!v) return;
      var rule = allowed[k];
      if (rule === 'date') { if (validYmd(v)) out[k] = v; }
      else if (rule === 'text') { if (v.length <= 100 && !CONTROL_RE.test(v)) out[k] = v; }
      else if (Array.isArray(rule)) { if (rule.indexOf(v) >= 0) out[k] = v; }
    });
    return out;
  }
  var USER_FILTERS = {
    q: 'text', plan: ['free', 'basic', 'pro'], source: ['paid', 'grant'], status: ['active', 'suspended', 'unconfirmed'],
    signed_up_after: 'date', signed_up_before: 'date', sort: ['created_desc', 'created_asc', 'last_sign_in_desc', 'email_asc']
  };
  var PAYMENT_FILTERS = { status: ['captured', 'refunded', 'failed'], plan: ['basic', 'pro'], from: 'date', to: 'date', q: 'text' };
  var AUDIT_FILTERS = { action: 'text', from: 'date', to: 'date', target_user: 'text' };
  function userFilter(raw) { return cleanFilter(raw, USER_FILTERS); }
  function paymentFilter(raw) { return cleanFilter(raw, PAYMENT_FILTERS); }
  function auditFilter(raw) {
    var f = cleanFilter(raw, AUDIT_FILTERS);
    if (f.target_user && !isUuid(f.target_user)) delete f.target_user;
    return f;
  }
  /** '' when fine, else a message: bad date or "from" after "to". */
  function dateRangeError(from, to) {
    if (from && !validYmd(from)) return 'Use a valid "from" date.';
    if (to && !validYmd(to)) return 'Use a valid "to" date.';
    if (from && to && from > to) return '"From" date is after "To" date.';
    return '';
  }
  function listBody(action, filter, limit, offset) {
    var lim = Math.max(1, Math.min(EXPORT_PAGE, Math.floor(limit) || PAGE_SIZE));
    var off = Math.max(0, Math.floor(offset) || 0);
    return { action: action, filter: filter || {}, limit: lim, offset: off };
  }
  function metricsBody(days) { return { action: 'metrics', days: RANGES.indexOf(days) >= 0 ? days : 30 }; }
  /** 'Showing 51-100 of 120' and prev/next availability. */
  function pageInfo(total, offset, count) {
    total = Math.max(0, Number(total) || 0); offset = Math.max(0, Number(offset) || 0); count = Math.max(0, Number(count) || 0);
    return {
      from: count ? offset + 1 : 0, to: offset + count, total: total,
      hasPrev: offset > 0, hasNext: offset + count < total,
      text: count ? 'Showing ' + formatCount(offset + 1) + '-' + formatCount(offset + count) + ' of ' + formatCount(total) : 'No results'
    };
  }
  /** Number of page requests needed to export min(total, EXPORT_MAX_ROWS) rows. */
  function exportPages(total) { return Math.ceil(Math.min(Math.max(0, total || 0), EXPORT_MAX_ROWS) / EXPORT_PAGE); }

  // ---- action bodies (v2) ----
  function grantBulkBody(userIds, v) { return { action: 'grant_bulk', user_ids: userIds, tier: v.tier, days: v.days, reason: v.reason }; }
  function userActionBody(action, userId, reason) { return { action: action, user_id: userId, reason: reason }; }
  function deleteUserBody(userId, confirmEmail, reason) { return { action: 'delete_user', user_id: userId, confirm_email: confirmEmail, reason: reason }; }
  /** Delete needs the typed email to equal the user's email (case-insensitive, like the server). */
  function emailMatches(typed, email) {
    return typeof typed === 'string' && typeof email === 'string' && email !== '' && typed.trim().toLowerCase() === email.toLowerCase();
  }
  function validateBulkSelection(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'Select at least one user.' };
    if (ids.length > MAX_BULK) return { ok: false, error: 'Select at most ' + MAX_BULK + ' users at a time.' };
    if (!ids.every(isUuid)) return { ok: false, error: 'Selection contains an invalid user.' };
    return { ok: true };
  }
  var ACTION_TEXT = {
    suspend: function (e) { return 'Suspend ' + e + '? They will be signed out everywhere and cannot sign in until you unsuspend them.'; },
    unsuspend: function (e) { return 'Unsuspend ' + e + '? They will be able to sign in again.'; },
    sign_out_everywhere: function (e) { return 'Sign ' + e + ' out of every device? They can sign in again straight away.'; },
    send_password_reset: function (e) { return 'Email a password-reset link to ' + e + '?'; }
  };
  function actionConfirmText(action, email) { return ACTION_TEXT[action] ? ACTION_TEXT[action](email) : ''; }
  function deleteConfirmText(email) {
    return 'Permanently delete ' + email + '. Do this only when the user asked for it. Their account, sign-in and plan are removed and this cannot be undone. Payment records stay for tax purposes.';
  }
  function bulkConfirmText(n, v, nowMs) {
    return 'Give ' + n + (n === 1 ? ' user ' : ' users ') + tierLabel(v.tier) + ' until ' + formatDate(grantEndDate(nowMs, v.days)) +
      ' (' + v.days + (v.days === 1 ? ' day' : ' days') + ' from today)?';
  }

  // ---- charts ----
  /** Round a maximum up to a "nice" axis top (1, 2, 5 x 10^n) so ticks are tidy. */
  function niceMax(max) {
    if (!Number.isFinite(max) || max <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(max)));
    var f = max / exp;
    var nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * exp;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  /** Evenly spaced tick values from 0 to a nice top. Returns {max, ticks[]}. */
  function axisTicks(maxValue, count) {
    var n = Math.max(2, count || 4);
    var top = niceMax(maxValue);
    var ticks = [];
    for (var i = 0; i <= n; i++) ticks.push((top / n) * i);
    return { max: top, ticks: ticks };
  }
  /** Bar rectangles inside a plot of w x h: [{x, y, w, h, value, index}]. A zero value keeps height 0. */
  function barLayout(values, w, h, max) {
    var n = values.length;
    if (!n) return [];
    var slot = w / n;
    var bw = Math.max(1, slot * 0.7);
    var top = max > 0 ? max : 1;
    return values.map(function (v, i) {
      var bh = Math.max(0, Math.min(h, (Math.max(0, v) / top) * h));
      return { x: round1(i * slot + (slot - bw) / 2), y: round1(h - bh), w: round1(bw), h: round1(bh), value: v, index: i };
    });
  }
  /** Indexes of x labels to show so at most ~maxLabels appear (the latest day is always labelled). */
  function labelIndexes(n, maxLabels) {
    var step = Math.max(1, Math.ceil(n / Math.max(1, maxLabels)));
    var out = [];
    for (var i = n - 1; i >= 0; i -= step) out.unshift(i);
    return out;
  }
  /** Exactly one entry per IST day for the last `days` days (oldest first); missing days are zeros. */
  function fillDaily(daily, days, nowMs) {
    var byDay = {};
    (Array.isArray(daily) ? daily : []).forEach(function (d) { if (d && typeof d.day === 'string') byDay[d.day.slice(0, 10)] = d; });
    var today = istToday(nowMs);
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var day = addDays(today, -i);
      var d = byDay[day] || {};
      out.push({ day: day, signups: d.signups | 0, active: d.active | 0, payments: d.payments | 0, revenue_paise: Number(d.revenue_paise) || 0 });
    }
    return out;
  }
  /** '2026-10-12' -> '12 Oct'. */
  function shortDay(ymd) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? Number(m[2]) + ' ' + MONTHS[Number(m[1]) - 1] : ''; }
  /** Plan split segments from metrics.totals, with percentages and x offsets (0-100) for a stacked bar. */
  function planSegments(t) {
    t = t || {};
    var segs = [
      { key: 'free', label: 'Free', value: t.free | 0 },
      { key: 'paid_basic', label: 'Basic (paid)', value: t.paid_basic | 0 },
      { key: 'paid_pro', label: 'Pro (paid)', value: t.paid_pro | 0 },
      { key: 'granted_basic', label: 'Basic (granted)', value: t.granted_basic | 0 },
      { key: 'granted_pro', label: 'Pro (granted)', value: t.granted_pro | 0 }
    ];
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    var x = 0;
    segs.forEach(function (s) { s.pct = pctNum(s.value, total); s.x = round1(x); s.w = round1(s.pct); x += s.pct; s.pctText = pct(s.value, total); });
    return { total: total, segments: segs };
  }
  /** Funnel steps with % of the previous step and % of sign-ups. */
  function funnelSteps(f) {
    f = f || {};
    var a = f.signups | 0, b = f.checkouts_users | 0, c = f.paid_users | 0;
    return [
      { key: 'signups', label: 'Signed up', value: a, ofPrev: '', ofFirst: a ? '100%' : '0%', width: a ? 100 : 0 },
      { key: 'checkout', label: 'Started checkout', value: b, ofPrev: pct(b, a), ofFirst: pct(b, a), width: pctNum(b, a) },
      { key: 'paid', label: 'Paid', value: c, ofPrev: pct(c, b), ofFirst: pct(c, a), width: pctNum(c, a) }
    ];
  }

  return {
    MAX_BULK: MAX_BULK, PAGE_SIZE: PAGE_SIZE, EXPORT_PAGE: EXPORT_PAGE, EXPORT_MAX_ROWS: EXPORT_MAX_ROWS, RANGES: RANGES, USER_SORTS: USER_SORTS,
    formatCount: formatCount, formatRupees: formatRupees, formatRupeesShort: formatRupeesShort, pct: pct, pctNum: pctNum,
    csvCell: csvCell, buildCsv: buildCsv, USER_CSV_HEADERS: USER_CSV_HEADERS, userCsvRow: userCsvRow, userStatus: userStatus,
    PAYMENT_CSV_HEADERS: PAYMENT_CSV_HEADERS, paymentCsvRow: paymentCsvRow,
    validYmd: validYmd, cleanFilter: cleanFilter, userFilter: userFilter, paymentFilter: paymentFilter, auditFilter: auditFilter,
    dateRangeError: dateRangeError, listBody: listBody, metricsBody: metricsBody, pageInfo: pageInfo, exportPages: exportPages,
    grantBulkBody: grantBulkBody, userActionBody: userActionBody, deleteUserBody: deleteUserBody, emailMatches: emailMatches,
    validateBulkSelection: validateBulkSelection, actionConfirmText: actionConfirmText, deleteConfirmText: deleteConfirmText, bulkConfirmText: bulkConfirmText,
    niceMax: niceMax, axisTicks: axisTicks, barLayout: barLayout, labelIndexes: labelIndexes, fillDaily: fillDaily, shortDay: shortDay,
    planSegments: planSegments, funnelSteps: funnelSteps,
    MAX_REASON: MAX_REASON, MIN_DAYS: MIN_DAYS, MAX_DAYS: MAX_DAYS, DAY_PRESETS: DAY_PRESETS,
    tierLabel: tierLabel, istToday: istToday, addDays: addDays, grantEndDate: grantEndDate,
    formatDate: formatDate, formatDateTime: formatDateTime, formatMoney: formatMoney,
    validateGrantForm: validateGrantForm, validateReason: validateReason, validateSearchQuery: validateSearchQuery,
    validateTotpCode: validateTotpCode, isUuid: isUuid,
    searchBody: searchBody, getUserBody: getUserBody, grantBody: grantBody, revokeBody: revokeBody,
    grantConfirmText: grantConfirmText,
    issueReasonLabel: issueReasonLabel, issueCountText: issueCountText, paymentIssuesBody: paymentIssuesBody, resolveIssueBody: resolveIssueBody,
    decodeJwtClaims: decodeJwtClaims, tokenAal: tokenAal, normaliseSession: normaliseSession,
    needsRefresh: needsRefresh, pickFactors: pickFactors,
    authErrorMessage: authErrorMessage, adminErrorMessage: adminErrorMessage
  };
});
