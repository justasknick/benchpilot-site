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
  var TIERS = { solo: 'Solo', basic: 'Basic', pro: 'Pro', free: 'Free' };
  // Paid tiers an admin may grant, best first (mirrors PAID_TIERS in supabase/functions/_shared/plans.js).
  var GRANT_TIERS = ['solo', 'pro', 'basic'];
  // Plan ids the payments filter accepts (mirrors PLANS in plans.js; the server rejects anything else).
  var PLAN_IDS = ['solo_monthly', 'solo_yearly', 'solo_founding', 'basic_monthly', 'basic_yearly', 'pro_monthly', 'pro_yearly', 'founding',
    'team_starter', 'team_team', 'team_agency', 'team_starter_yearly', 'team_team_yearly', 'team_agency_yearly'];
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
    if (GRANT_TIERS.indexOf(f.tier) < 0) errors.tier = 'Choose Solo, Pro or Basic.';
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
    checkout_mismatch: 'Checkout is for another user or plan',
    founding_over_cap: 'Founding offer was full (paid, plan granted; a team also kept its founding price lock)',
    lower_tier_paid: 'Paid an older, lower plan while a higher one was active (granted; offer a refund)',
    partial_refund: 'Partial refund (plan unchanged)',
    referral_refunded: 'Team payment refunded: the referrer\'s 3 free Solo months were taken back (re-grant by hand if fair)'
  };
  /** Machine reason -> short words; an unknown reason is shown as-is. */
  function issueReasonLabel(reason) {
    return Object.prototype.hasOwnProperty.call(ISSUE_REASONS, reason) ? ISSUE_REASONS[reason] : (reason ? String(reason) : '-');
  }
  function issueCountText(n) {
    var c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return c === 0 ? 'No open payment issues' : c + (c === 1 ? ' open payment issue' : ' open payment issues');
  }
  // ---- team referrals (0021): one row of the user detail's "Team referrals" table ----
  var REFERRAL_STATES = { open: 'Link not used yet', joined: 'Pilot started', rewarded: 'Rewarded (90 days Solo)', refunded: 'Reward taken back (payment refunded)', void: 'No reward' };
  function referralStatus(r) {
    var x = r || {};
    var label = Object.prototype.hasOwnProperty.call(REFERRAL_STATES, x.state) ? REFERRAL_STATES[x.state] : '-';
    if (x.state === 'open' && x.expires_at && Date.parse(x.expires_at) < Date.now()) label = 'Expired, not used';
    if (x.state === 'void' && x.void_reason === 'self') label = 'No reward (own team)';
    return label;
  }
  function paymentIssuesBody() { return { action: 'list_payment_issues' }; }
  function resolveIssueBody(issueId, note) { return { action: 'resolve_payment_issue', issue_id: issueId, note: note }; }

  // ---- feedback (bug reports and ideas from the extension, migration 0006) ----
  var FEEDBACK_STATUSES = ['new', 'seen', 'fixed', 'wont_fix'];
  var FEEDBACK_STATUS_LABELS = { new: 'New', seen: 'Seen', fixed: 'Fixed', wont_fix: "Won't fix" };
  var FEEDBACK_KINDS = { bug: 'Bug', idea: 'Idea', error: 'Error' };
  var MAX_FEEDBACK_NOTE = 500;
  var FEEDBACK_FILTERS = { kind: ['bug', 'idea', 'error'], status: FEEDBACK_STATUSES, version: 'text' };
  var SCREENSHOT_URL_PREFIX = 'https://uhgtlyxarozzdgdizoaz.supabase.co/storage/v1/';

  function feedbackStatusLabel(s) { return Object.prototype.hasOwnProperty.call(FEEDBACK_STATUS_LABELS, s) ? FEEDBACK_STATUS_LABELS[s] : (s ? String(s) : '-'); }
  function feedbackKindLabel(k) { return Object.prototype.hasOwnProperty.call(FEEDBACK_KINDS, k) ? FEEDBACK_KINDS[k] : (k ? String(k) : '-'); }
  function feedbackFilter(raw) {
    var f = cleanFilter(raw, FEEDBACK_FILTERS);
    if (f.version && f.version.length > 20) delete f.version;
    return f;
  }
  function feedbackBody(filter, limit, offset) { return listBody('list_feedback', filter, limit, offset); }
  /** Note is optional (max 500); returns null when it is too long or has control characters. */
  function feedbackUpdateBody(id, status, note) {
    var n = typeof note === 'string' ? note.trim() : '';
    if (!(id > 0) || Math.floor(id) !== id || FEEDBACK_STATUSES.indexOf(status) < 0) return null;
    if (n.length > MAX_FEEDBACK_NOTE || CONTROL_RE.test(n)) return null;
    return { action: 'update_feedback', id: id, status: status, note: n };
  }
  function feedbackScreenshotBody(id) { return { action: 'feedback_screenshot_url', id: id }; }
  function purgeFeedbackBody() { return { action: 'purge_feedback' }; }
  /** A signed URL is only used as an image source when it points at this project's Storage over https. */
  function safeScreenshotUrl(u) {
    return typeof u === 'string' && u.indexOf(SCREENSHOT_URL_PREFIX) === 0 && !/[\s"'<>]/.test(u) ? u : '';
  }
  /** One line: "drawer on /feed/ - v1.6.0 - pro - Chrome 130 / Windows - en-IN". */
  function feedbackContextSummary(ctx) {
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var parts = [];
    if (c.surface) parts.push(String(c.surface) + (c.page ? ' on ' + c.page : ''));
    else if (c.page) parts.push(String(c.page));
    if (c.version) parts.push('v' + c.version);
    if (c.plan) parts.push(String(c.plan));
    if (c.ua) parts.push(String(c.ua));
    if (c.lang) parts.push(String(c.lang));
    return parts.join(' - ');
  }
  /**
   * Plain text for pasting into Claude: message and context only, never the screenshot or any file reference.
   * "#12 BUG (new) 2026-10-06 10:00 UTC
   *  From: a@b.com (or anonymous)
   *  <message>
   *  Context: ..."
   */
  function feedbackToText(r) {
    r = r || {};
    var when = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) + ' UTC' : '';
    var lines = ['#' + r.id + ' ' + String(r.kind || '').toUpperCase() + ' (' + (r.status || 'new') + ')' + (when ? ' ' + when : '')];
    lines.push('From: ' + (r.email || 'anonymous'));
    lines.push(String(r.message == null ? '' : r.message));
    var ctx = r.context && typeof r.context === 'object' ? r.context : {};
    var keys = Object.keys(ctx);
    if (keys.length) lines.push('Context: ' + keys.map(function (k) { return k + '=' + ctx[k]; }).join(', '));
    if (r.admin_note) lines.push('Admin note: ' + r.admin_note);
    return lines.join('\n');
  }
  function feedbackBatchText(list) {
    return (list || []).map(feedbackToText).join('\n\n---\n\n');
  }

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
    q: 'text', plan: ['free'].concat(GRANT_TIERS), source: ['paid', 'grant'], status: ['active', 'suspended', 'unconfirmed'],
    signed_up_after: 'date', signed_up_before: 'date', sort: ['created_desc', 'created_asc', 'last_sign_in_desc', 'email_asc']
  };
  var PAYMENT_FILTERS = { status: ['captured', 'refunded', 'failed'], plan: PLAN_IDS, from: 'date', to: 'date', q: 'text' };
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
      { key: 'granted_pro', label: 'Pro (granted)', value: t.granted_pro | 0 },
      { key: 'paid_solo', label: 'Solo (paid)', value: t.paid_solo | 0 },
      { key: 'granted_solo', label: 'Solo (granted)', value: t.granted_solo | 0 }
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

  // ---------- growth view ----------
  var GOAL_USERS = 1000, GOAL_DATE = '2026-11-08', GROWTH_DAYS = 30, MAX_INSTALLS = 10000000;
  function growthBody(days) {
    var d = Math.floor(Number(days));
    return { action: 'growth', days: d >= 1 && d <= 90 ? d : GROWTH_DAYS };
  }
  /** Whole days from ymd a to ymd b (negative if b is earlier); NaN if either is not a date. */
  function daysBetween(a, b) {
    if (!validYmd(a) || !validYmd(b)) return NaN;
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  /** Manual Chrome Web Store installs: digits only, 0..10,000,000. Anything else is null (treated as not set). */
  function parseInstalls(v) {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') return null;
    v = v.trim().replace(/,/g, '');
    if (!/^[0-9]{1,8}$/.test(v)) return null;
    var n = Number(v);
    return n <= MAX_INSTALLS ? n : null;
  }
  // ---------- funnel card (plan 4.2) ----------
  // The server sends counts per ISO week (accounts, returned, checkouts, payments, heard channels). Installs and weekly users come from the
  // Chrome Web Store CSV the admin picks in this browser: it is parsed here, kept in memory only, and never sent anywhere.
  var FUNNEL_WEEKS = 8, MAX_CSV_CHARS = 2000000;
  function funnelBody(weeks) {
    var w = Math.floor(Number(weeks));
    return { action: 'funnel', weeks: w >= 1 && w <= 26 ? w : FUNNEL_WEEKS };
  }
  /** Monday (YYYY-MM-DD) of the ISO week holding ymd; null if ymd is not a date. */
  function weekStartYmd(ymd) {
    if (!validYmd(ymd)) return null;
    var p = ymd.split('-').map(Number);
    var dow = (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7;
    return addDays(ymd, -dow);
  }
  var MON_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function ymdOf(y, m, d) {
    if (y < 100) y += 2000;
    var s = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    return validYmd(s) ? s : null;
  }
  /** One cell -> YYYY-MM-DD or null. Reads 2026-11-09, 2026/11/09, 9 Nov 2026, Nov 9, 2026 and 9/11/2026 or 11/9/2026 (dayFirst picks which). */
  function parseDateCell(cell, dayFirst) {
    var s = String(cell == null ? '' : cell).trim().replace(/^"|"$/g, '');
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/.exec(s);
    if (m) return ymdOf(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:[ T].*)?$/.exec(s);
    if (m) return dayFirst ? ymdOf(+m[3], +m[2], +m[1]) : ymdOf(+m[3], +m[1], +m[2]);
    m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*\.?,?[ -](\d{4})$/.exec(s);
    if (m && MON_NAMES[m[2].toLowerCase()]) return ymdOf(+m[3], MON_NAMES[m[2].toLowerCase()], +m[1]);
    m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s);
    if (m && MON_NAMES[m[1].toLowerCase()]) return ymdOf(+m[3], MON_NAMES[m[1].toLowerCase()], +m[2]);
    return null;
  }
  function splitCsv(text) {
    var first = text.split(/\r?\n/, 1)[0];
    var delim = ',', best = (first.match(/,/g) || []).length;
    [';', '\t'].forEach(function (d) { var c = first.split(d).length - 1; if (c > best) { best = c; delim = d; } });
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function numCell(c) {
    var s = String(c == null ? '' : c).trim().replace(/[,\s]/g, '');
    if (!/^[0-9]{1,9}$/.test(s)) return null;
    return Number(s);
  }
  var CSV_HELP = 'Could not read this file. Download the CSV from the Chrome Web Store dashboard (Analytics) and choose it again. It needs a date column and number columns such as Installs and Weekly users.';
  /**
   * Tolerant store-CSV reader. Needs a date column and numeric columns. Daily or weekly rows both work: installs are summed per ISO week
   * (Monday start), weekly users is the latest value in the week. Header names are matched loosely ("Installs", "Weekly users", "Users");
   * with no usable header the first number column is read as installs and the second as weekly users (guessed: true).
   * Returns { ok: true, weeks: { 'YYYY-MM-DD': { installs, users } }, rows, guessed, first, last } or { ok: false, error }.
   */
  function parseStoreCsv(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
    if (text.length > MAX_CSV_CHARS) return { ok: false, error: 'This file is too large to be a store export.' };
    text = text.replace(/^﻿/, '');
    var rows = splitCsv(text);
    if (rows.length < 2) return { ok: false, error: CSV_HELP };
    var ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    // Day-first only when some slashed date proves it (first part above 12); otherwise month-first, as the store's own export.
    var dayFirst = rows.some(function (r) { return r.some(function (c) { var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}$/.exec(String(c).trim()); return m && +m[1] > 12; }); });
    var isDateRow = function (r) { return r.some(function (c) { return parseDateCell(c, dayFirst) != null; }); };
    var hasHeader = !isDateRow(rows[0]);
    var header = hasHeader ? rows[0].map(function (h) { return String(h).trim().toLowerCase(); }) : [];
    var body = hasHeader ? rows.slice(1) : rows;
    var dateCol = -1, bestHits = 0, c, hits;
    for (c = 0; c < ncol; c++) {
      hits = body.filter(function (r) { return parseDateCell(r[c], dayFirst) != null; }).length;
      var named = hasHeader && /date|day|week|period/.test(header[c] || '');
      if (hits > bestHits || (named && hits > 0 && hits >= bestHits)) { bestHits = hits; dateCol = c; }
    }
    if (dateCol < 0 || bestHits < 1) return { ok: false, error: 'No date column found. ' + CSV_HELP };
    var instCol = -1, userCol = -1;
    header.forEach(function (h, i) {
      if (i === dateCol) return;
      if (instCol < 0 && /install/.test(h) && !/uninstall/.test(h)) instCol = i;
      if (/user/.test(h) && (userCol < 0 || /weekly/.test(h))) userCol = i;
    });
    var guessed = false;
    if (instCol < 0 && userCol < 0) {
      var numeric = [];
      for (c = 0; c < ncol; c++) {
        if (c === dateCol) continue;
        if (body.some(function (r) { return numCell(r[c]) != null; })) numeric.push(c);
      }
      if (!numeric.length) return { ok: false, error: 'Found dates but no number columns. ' + CSV_HELP };
      instCol = numeric[0]; userCol = numeric.length > 1 ? numeric[1] : -1; guessed = true;
    }
    var weeks = {}, lastDay = {}, first = null, last = null, count = 0;
    body.forEach(function (r) {
      var day = parseDateCell(r[dateCol], dayFirst);
      if (!day) return; // totals and blank lines
      var wk = weekStartYmd(day);
      var w = weeks[wk] || (weeks[wk] = { installs: null, users: null });
      var inst = instCol >= 0 ? numCell(r[instCol]) : null;
      if (inst != null) w.installs = (w.installs || 0) + inst;
      var usr = userCol >= 0 ? numCell(r[userCol]) : null;
      if (usr != null && (lastDay[wk] == null || day >= lastDay[wk])) { w.users = usr; lastDay[wk] = day; }
      count++;
      if (!first || day < first) first = day;
      if (!last || day > last) last = day;
    });
    if (!count) return { ok: false, error: CSV_HELP };
    return { ok: true, weeks: weeks, rows: count, guessed: guessed, first: first, last: last, hasInstalls: instCol >= 0, hasUsers: userCol >= 0 };
  }
  var HEARD_FALLBACK = [];
  function cnt(v) { return Number.isFinite(v) ? formatCount(v) : '-'; }
  /** Table rows (display strings, counts only) for the funnel: server rows merged with the store numbers by week. Only known fields are read. */
  function funnelTableRows(rows, store) {
    var sw = store && store.ok ? store.weeks : null;
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      var s = sw && sw[r.week];
      return [
        formatDate(r.week),
        s && s.installs != null ? cnt(s.installs) : '-',
        s && s.users != null ? cnt(s.users) : '-',
        cnt(r.accounts), cnt(r.returned), cnt(r.checkouts), cnt(r.payments)
      ];
    });
  }
  var FUNNEL_HEAD = ['Week of (Mon)', 'Installs', 'Weekly users', 'Accounts created', 'Signed in after week 1', 'Checkouts started', 'Payments'];
  function heardTable(rows, channels) {
    var ch = Array.isArray(channels) && channels.length ? channels : HEARD_FALLBACK;
    var head = ['Week of (Mon)'].concat(ch.map(function (c) { return String(c.label); }), ['Total']);
    var body = (Array.isArray(rows) ? rows : []).map(function (r) {
      var total = 0;
      var cells = ch.map(function (c) { var n = r.heard && Number(r.heard[c.id]); n = Number.isFinite(n) ? n : 0; total += n; return cnt(n); });
      return [formatDate(r.week)].concat(cells, [cnt(total)]);
    });
    return { head: head, rows: body };
  }
  /** Goal progress. current = whichever is higher: registered users or manual store installs. */
  function growthPace(users, installs, nowMs, goal, deadline) {
    goal = goal || GOAL_USERS; deadline = deadline || GOAL_DATE;
    var u = Math.max(0, Math.floor(Number(users)) || 0);
    var i = parseInstalls(installs);
    var current = Math.max(u, i == null ? 0 : i);
    var left = daysBetween(istToday(nowMs), deadline);
    var remaining = Math.max(0, goal - current);
    var reached = current >= goal;
    var perDay = reached ? 0 : Math.ceil((remaining / Math.max(left, 1)) * 10) / 10;
    return {
      current: current, goal: goal, source: i != null && i > u ? 'installs' : 'users', remaining: remaining, reached: reached,
      daysLeft: left, overdue: left < 0 && !reached, perDay: perDay, pctNum: Math.min(100, Math.round((current / goal) * 1000) / 10)
    };
  }
  /** Sign-ups in the last 7 days vs the 7 before. hasPrev is false when fewer than 14 days are available. */
  function weekCompare(daily) {
    var s = (Array.isArray(daily) ? daily : []).map(function (d) { return (d && d.signups) | 0; });
    var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    var cur = sum(s.slice(-7));
    var hasPrev = s.length >= 14;
    var prev = hasPrev ? sum(s.slice(-14, -7)) : 0;
    var delta = cur - prev;
    var text = !hasPrev ? 'No earlier week to compare' : prev === 0 ? (cur === 0 ? 'No change' : 'Up from 0') : (delta >= 0 ? '+' : '-') + Math.abs(Math.round((delta / prev) * 100)) + '%';
    return { cur: cur, prev: prev, delta: delta, hasPrev: hasPrev, text: text, dir: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
  }

  // Global caps (server hardening, migration 0030): metrics.rate_limits -> one dashboard row per cap.
  // null (migration 0030 not applied yet) -> no rows. warn = refused at least once in 24 h, or at 80 % of the cap this hour.
  var RATE_LIMIT_ROWS = [
    { key: 'checkout_links', scope: 'checkout_global', cap: 'checkout_per_hour', label: 'Checkout links, last hour' },
    { key: 'feedback_anon', scope: 'feedback_anon', cap: 'feedback_anon_per_hour', label: 'Anonymous reports, last hour' },
    { key: 'feedback_error', scope: 'feedback_error', cap: 'feedback_error_per_hour', label: 'Error reports, last hour' },
    { key: 'feedback_screenshot', scope: 'feedback_screenshot', cap: 'feedback_screenshot_per_hour', label: 'Screenshots, last hour' }
  ];
  function rateLimitRows(rl) {
    if (!rl || typeof rl !== 'object') return [];
    var last = rl.last_hour || {}, r24 = rl.refused_24h || {}, r7 = rl.refused_7d || {}, caps = rl.caps || {};
    return RATE_LIMIT_ROWS.map(function (row) {
      var n = Number(last[row.key]) || 0, cap = Number(caps[row.cap]) || 0, day = Number(r24[row.scope]) || 0, week = Number(r7[row.scope]) || 0;
      return {
        label: row.label,
        value: formatCount(n) + (cap ? ' of ' + formatCount(cap) : ''),
        sub: day ? formatCount(day) + ' refused in the last 24 hours (' + formatCount(week) + ' in 7 days)' : (week ? formatCount(week) + ' refused in 7 days' : 'None refused'),
        warn: day > 0 || (cap > 0 && n >= cap * 0.8)
      };
    });
  }

  // ---------- team scorecard (S6, migration 0035) ----------
  // Columns of the Teams table. type: 'text' sorts A-Z, 'num' and 'date' sort biggest / newest first on the first click.
  var SCORECARD_COLUMNS = [
    { key: 'name', label: 'Team', type: 'text' },
    { key: 'tier', label: 'Plan', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
    { key: 'days_left', label: 'Days left', type: 'num' },
    { key: 'members', label: 'Members', type: 'num' },
    { key: 'weekly_active', label: 'Active 7d', type: 'num' },
    { key: 'requirements_week', label: 'Reqs 7d', type: 'num' },
    { key: 'submissions_week', label: 'Subs 7d', type: 'num' },
    { key: 'guard_warned_week', label: 'Guard warnings 7d', type: 'num' },
    { key: 'guard_overrides_week', label: 'Overrides 7d', type: 'num' },
    { key: 'inbox_received_week', label: 'Inbox 7d', type: 'num' },
    { key: 'last_report_on', label: 'Last report', type: 'date' }
  ];
  function scorecardBody() { return { action: 'team_scorecard' }; }
  /** Sorted copy. Missing values always go last; ties keep the team name order. */
  function sortScorecard(rows, key, dir) {
    var col = SCORECARD_COLUMNS.filter(function (c) { return c.key === key; })[0] || SCORECARD_COLUMNS[0];
    var sign = dir === 'asc' ? 1 : -1;
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      var x = a[col.key], y = b[col.key];
      var xn = x == null || x === '', yn = y == null || y === '';
      if (xn || yn) return xn && yn ? String(a.name || '').localeCompare(String(b.name || '')) : xn ? 1 : -1;
      var c = col.type === 'num' ? Number(x) - Number(y) : String(x).localeCompare(String(y));
      return c !== 0 ? c * sign : String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  /** First click on a column: text A-Z, numbers and dates biggest first. Same column again: flip. */
  function nextSort(cur, key) {
    if (cur && cur.key === key) return { key: key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
    var col = SCORECARD_COLUMNS.filter(function (c) { return c.key === key; })[0];
    return { key: key, dir: col && col.type === 'text' ? 'asc' : 'desc' };
  }
  function scorecardTotals(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var sum = function (k) { return list.reduce(function (t, r) { return t + (Number(r[k]) || 0); }, 0); };
    return {
      teams: list.length,
      active_teams: list.filter(function (r) { return (Number(r.weekly_active) || 0) > 0; }).length,
      pilots: list.filter(function (r) { return r.tier === 'pilot'; }).length,
      guard_warned_week: sum('guard_warned_week'), submissions_week: sum('submissions_week')
    };
  }

  // ---------- remote config (S7, migration 0035) ----------
  // Mirrors supabase/functions/_shared/remote-config.js; the server checks everything again.
  var REMOTE_FEATURES = ['sync', 'team', 'coach']; // the build's FEATURES (BenchPilot-Extension/lib/config.js)
  var SITE_PREFIX = 'https://justasknick.github.io/benchpilot-site/';
  var SEVERITIES = ['info', 'warning', 'critical'];
  var MAX_ANNOUNCEMENTS = 5;
  var MAX_ANN_TEXT = 280;
  var VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  function remoteConfigBody() { return { action: 'get_remote_config' }; }
  function setRemoteBody(key, value, reason) { return { action: 'set_remote_config', key: key, value: value, reason: normaliseReason(reason) }; }
  /** rows from get_remote_config -> { features, announcements, min_version, meta: { key: { updated_at, updated_by_email } } } */
  function remoteState(rows) {
    var out = { features: {}, announcements: [], min_version: {}, meta: {} };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || ['features', 'announcements', 'min_version'].indexOf(r.key) < 0) return;
      out[r.key] = r.value;
      out.meta[r.key] = { updated_at: r.updated_at || null, updated_by_email: r.updated_by_email || null };
    });
    if (!out.features || typeof out.features !== 'object' || Array.isArray(out.features)) out.features = {};
    if (!Array.isArray(out.announcements)) out.announcements = [];
    if (!out.min_version || typeof out.min_version !== 'object') out.min_version = {};
    return out;
  }
  /** Checked boxes ("switch off") -> { name: false }. Only OFF switches exist. */
  function featuresValue(offNames) {
    var v = {};
    (offNames || []).forEach(function (n) { if (REMOTE_FEATURES.indexOf(n) >= 0) v[n] = false; });
    return v;
  }
  function newAnnouncementId(nowMs) { return 'a-' + Math.floor(Number(nowMs) || 0).toString(36); }
  /** Form fields -> { ok, value | error }. Plain text only, links only to the website. */
  function validateAnnouncement(f) {
    var text = typeof f.text === 'string' ? f.text.trim() : '';
    if (!text) return { ok: false, error: 'Write the announcement text.' };
    if (text.length > MAX_ANN_TEXT) return { ok: false, error: 'Keep the text to ' + MAX_ANN_TEXT + ' characters.' };
    if (CONTROL_RE.test(text) || /[<>]/.test(text)) return { ok: false, error: 'Plain text only (no line breaks, < or >).' };
    var link = typeof f.link === 'string' ? f.link.trim() : '';
    if (link && (link.indexOf(SITE_PREFIX) !== 0 || /[\s"'<>\\`]/.test(link) || link.length > 300)) return { ok: false, error: 'The link must be a page on ' + SITE_PREFIX };
    if (SEVERITIES.indexOf(f.severity) < 0) return { ok: false, error: 'Choose a severity.' };
    if (!validYmd(f.starts_on) || !validYmd(f.ends_on)) return { ok: false, error: 'Choose a start and an end date.' };
    if (f.ends_on < f.starts_on) return { ok: false, error: 'The end date is before the start date.' };
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(f.id || ''))) return { ok: false, error: 'Invalid id.' };
    var v = { id: f.id, text: text, severity: f.severity, starts_on: f.starts_on, ends_on: f.ends_on, dismissible: f.dismissible !== false };
    if (link) v.link = link;
    return { ok: true, value: v };
  }
  function validateMinVersion(v) {
    var s = typeof v === 'string' ? v.trim() : '';
    if (!s) return { ok: true, value: {} };
    return VERSION_RE.test(s) ? { ok: true, value: { version: s } } : { ok: false, error: 'Write a version like 1.19.0.' };
  }
  function announcementStatus(a, today) {
    if (a.ends_on < today) return 'Ended';
    if (a.starts_on > today) return 'Scheduled';
    return 'Live';
  }

  return {
    SCORECARD_COLUMNS: SCORECARD_COLUMNS, scorecardBody: scorecardBody, sortScorecard: sortScorecard, nextSort: nextSort, scorecardTotals: scorecardTotals,
    REMOTE_FEATURES: REMOTE_FEATURES, SITE_PREFIX: SITE_PREFIX, SEVERITIES: SEVERITIES, MAX_ANNOUNCEMENTS: MAX_ANNOUNCEMENTS, MAX_ANN_TEXT: MAX_ANN_TEXT,
    normaliseReason: normaliseReason, remoteConfigBody: remoteConfigBody, setRemoteBody: setRemoteBody, remoteState: remoteState, featuresValue: featuresValue,
    newAnnouncementId: newAnnouncementId, validateAnnouncement: validateAnnouncement, validateMinVersion: validateMinVersion, announcementStatus: announcementStatus,
    rateLimitRows: rateLimitRows,
    GOAL_USERS: GOAL_USERS, GOAL_DATE: GOAL_DATE, GROWTH_DAYS: GROWTH_DAYS, growthBody: growthBody, daysBetween: daysBetween,
    FUNNEL_WEEKS: FUNNEL_WEEKS, FUNNEL_HEAD: FUNNEL_HEAD, funnelBody: funnelBody, weekStartYmd: weekStartYmd, parseDateCell: parseDateCell,
    parseStoreCsv: parseStoreCsv, funnelTableRows: funnelTableRows, heardTable: heardTable, MAX_CSV_CHARS: MAX_CSV_CHARS,
    parseInstalls: parseInstalls, growthPace: growthPace, weekCompare: weekCompare,
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
    FEEDBACK_STATUSES: FEEDBACK_STATUSES, MAX_FEEDBACK_NOTE: MAX_FEEDBACK_NOTE, feedbackStatusLabel: feedbackStatusLabel, feedbackKindLabel: feedbackKindLabel,
    feedbackFilter: feedbackFilter, feedbackBody: feedbackBody, feedbackUpdateBody: feedbackUpdateBody, feedbackScreenshotBody: feedbackScreenshotBody,
    purgeFeedbackBody: purgeFeedbackBody, safeScreenshotUrl: safeScreenshotUrl, feedbackContextSummary: feedbackContextSummary,
    feedbackToText: feedbackToText, feedbackBatchText: feedbackBatchText,
    issueReasonLabel: issueReasonLabel, referralStatus: referralStatus, issueCountText: issueCountText, paymentIssuesBody: paymentIssuesBody, resolveIssueBody: resolveIssueBody,
    decodeJwtClaims: decodeJwtClaims, tokenAal: tokenAal, normaliseSession: normaliseSession,
    needsRefresh: needsRefresh, pickFactors: pickFactors,
    authErrorMessage: authErrorMessage, adminErrorMessage: adminErrorMessage
  };
});
