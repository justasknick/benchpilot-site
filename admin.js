// admin.js - founder admin console. Talks only to Supabase Auth (GoTrue REST) and the `admin` edge function.
// No third-party scripts. All server data is rendered with textContent / DOM building, never innerHTML.
//
// Supabase Auth (GoTrue) REST endpoints used, all on SUPABASE_URL with header `apikey: <publishable key>`:
//   POST   /auth/v1/token?grant_type=password        {email, password}                      -> session (aal1)
//   POST   /auth/v1/token?grant_type=refresh_token   {refresh_token}                        -> new session (keeps aal)
//   POST   /auth/v1/logout?scope=local               (Bearer access token)                  -> 204, ends this session only
//   GET    /auth/v1/user                             (Bearer)                               -> user incl. factors[]
//   POST   /auth/v1/factors                          {factor_type:'totp', friendly_name, issuer}
//                                                                                           -> {id, totp:{qr_code (SVG data URI), secret, uri}}
//   DELETE /auth/v1/factors/{id}                     (Bearer)                               -> removes a half-finished (unverified) factor
//   POST   /auth/v1/factors/{id}/challenge           {}                                     -> {id: challenge_id, expires_at}
//   POST   /auth/v1/factors/{id}/verify              {challenge_id, code}                   -> new session at aal2
// Admin function: POST /functions/v1/admin (Bearer access token, aal2 required by the server).
// Actions: metrics, list_users, get_user, grant, revoke, grant_bulk, suspend, unsuspend, sign_out_everywhere,
// send_password_reset, delete_user, list_payments, list_audit (contract: docs/ADMIN_V2_PLAN.md).
(function () {
  'use strict';

  var L = window.BPAdminLib;
  var SUPABASE_URL = 'https://uhgtlyxarozzdgdizoaz.supabase.co';
  var ANON_KEY = 'sb_publishable_pV2FThlwZ8OnVXEQqVXDJg_9mDrC2q4'; // public by design
  var STORE_KEY = 'bp_admin_session';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var $ = function (id) { return document.getElementById(id); };

  // ---------- DOM helpers ----------
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'class') n.className = props[k];
      else if (k === 'onclick') n.addEventListener('click', props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs, kids) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k === 'cls' ? 'class' : k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function td(content, cls) {
    var c = el('td', cls ? { 'class': cls } : null);
    if (content && content.nodeType) c.appendChild(content); else c.textContent = content == null ? '' : String(content);
    return c;
  }
  function badge(tier) {
    var t = tier === 'pro' || tier === 'basic' ? tier : 'free';
    return el('span', { 'class': 'adm-badge adm-badge-' + t, text: L.tierLabel(t) });
  }
  function planCell(plan, until, extra) {
    var box = el('span');
    box.appendChild(badge(plan));
    if (plan && plan !== 'free' && until) box.appendChild(document.createTextNode(' until ' + L.formatDate(until)));
    if (extra) box.appendChild(document.createTextNode(' ' + extra));
    return box;
  }
  function statusBadge(u) {
    var s = L.userStatus(u);
    return el('span', { 'class': 'adm-badge ' + (s === 'active' ? 'adm-badge-active' : s === 'suspended' ? 'adm-badge-bad' : 'adm-badge-off'), text: s.charAt(0).toUpperCase() + s.slice(1) });
  }
  function simpleTable(headers, rows) {
    var t = el('table', { 'class': 'adm-table' });
    t.appendChild(el('thead', null, [el('tr', null, headers.map(function (h) { return el('th', { scope: 'col', text: h }); }))]));
    var tb = el('tbody');
    rows.forEach(function (r) { tb.appendChild(el('tr', null, r.map(function (c) { return td(c); }))); });
    t.appendChild(tb);
    return t;
  }
  function debounce(fn, ms) {
    var t = null;
    return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }

  // ---------- status banner ----------
  function setStatus(msg, kind) {
    var s = $('status');
    if (!msg) { s.hidden = true; s.textContent = ''; return; }
    s.textContent = msg;
    s.className = 'adm-status' + (kind === 'ok' ? ' adm-ok' : kind === 'err' ? ' adm-err' : '');
    s.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    s.hidden = false;
  }
  function setPanelStatus(msg, kind) {
    var s = $('panel-status');
    if (!msg) { s.hidden = true; s.textContent = ''; return; }
    s.textContent = msg;
    s.className = 'adm-status' + (kind === 'ok' ? ' adm-ok' : kind === 'err' ? ' adm-err' : '');
    s.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    s.hidden = false;
  }
  function setErr(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

  // ---------- session (sessionStorage only: gone when the tab closes) ----------
  var memSession = null;
  function loadSession() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.access_token && s.refresh_token) return s; }
    } catch (e) { /* fall through to memory copy */ }
    return memSession;
  }
  function saveSession(s) {
    memSession = s;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* memory copy still works */ }
  }
  function clearSession() {
    memSession = null;
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- HTTP ----------
  async function http(url, opts) {
    var res;
    try { res = await fetch(url, opts); } catch (e) { return { status: 0, body: null }; }
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body: body };
  }
  function authCall(path, method, token, payload) {
    var headers = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return http(SUPABASE_URL + path, { method: method, headers: headers, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store', referrerPolicy: 'no-referrer' });
  }

  // One refresh at a time: refresh tokens rotate, so two parallel refreshes would invalidate each other.
  var refreshing = null;
  function refreshSession() {
    if (refreshing) return refreshing;
    var cur = loadSession();
    if (!cur) return Promise.resolve(null);
    refreshing = authCall('/auth/v1/token?grant_type=refresh_token', 'POST', null, { refresh_token: cur.refresh_token })
      .then(function (r) {
        var s = r.status === 200 ? L.normaliseSession(r.body) : null;
        if (s) { s.email = s.email || cur.email; saveSession(s); return s; }
        if (r.status === 0) return cur; // offline: keep what we have, the next call will tell the user
        return null;
      })
      .then(function (s) { refreshing = null; return s; }, function () { refreshing = null; return null; });
    return refreshing;
  }
  /** A usable access token, refreshing first when it is about to expire. null = signed out. */
  async function freshToken() {
    var s = loadSession();
    if (!s) return null;
    if (L.needsRefresh(s)) {
      s = await refreshSession();
      if (!s) { toSignin('Your session expired. Please sign in again.'); return null; }
    }
    return s.access_token;
  }

  var ADMIN_URL = SUPABASE_URL + '/functions/v1/admin';
  async function callAdmin(payload) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var token = await freshToken();
      if (!token) return { status: -1, body: null };
      var r = await http(ADMIN_URL, {
        method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload)
      });
      if (r.status === 401 && attempt === 0) { // token rejected: force one refresh and retry
        var cur = loadSession();
        if (cur) { cur.expires_at = 0; saveSession(cur); }
        continue;
      }
      return r;
    }
    return { status: 401, body: null };
  }

  // ---------- views ----------
  var VIEWS = ['view-signin', 'view-mfa', 'view-console'];
  function showView(id) {
    VIEWS.forEach(function (v) { $(v).hidden = v !== id; });
    if (id !== 'view-console') closePanel();
    var s = loadSession();
    $('who').hidden = !s || id === 'view-signin';
    $('who-email').textContent = (s && s.email) || '';
  }
  function toSignin(msg) {
    clearSession();
    resetConsole();
    $('in-password').value = '';
    showView('view-signin');
    setStatus(msg || '', msg ? 'err' : '');
    $('in-email').focus();
  }
  function resetConsole() {
    Object.keys(tokens).forEach(function (k) { tokens[k]++; }); // drop in-flight responses
    closePanel();
    currentUser = null;
    uState.offset = 0; uState.selected = {}; pState.offset = 0; aState.offset = 0;
    ['tbl-users', 'tbl-pay', 'tbl-audit'].forEach(function (id) { clear($(id).tBodies[0]); });
    ['kpis', 'chart-signups', 'chart-revenue', 'chart-plan', 'funnel', 'health', 'tbl-wrap-signups', 'tbl-wrap-revenue', 'set-account'].forEach(function (id) { clear($(id)); });
  }

  // ---------- busy / double-submit guard ----------
  var busy = {};
  async function guarded(key, buttons, fn) {
    if (busy[key]) return;
    busy[key] = true;
    buttons.forEach(function (b) { if (b) b.disabled = true; });
    try { return await fn(); } finally {
      busy[key] = false;
      buttons.forEach(function (b) { if (b) b.disabled = false; });
    }
  }
  // latest-request-wins counters, one per view
  var tokens = { dash: 0, users: 0, pay: 0, audit: 0, panel: 0, settings: 0 };
  function nextToken(k) { tokens[k]++; return tokens[k]; }

  // ---------- 1. sign in ----------
  $('form-signin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('in-email').value.trim();
    var password = $('in-password').value;
    if (!email || !password) { setStatus('Enter your email and password.', 'err'); return; }
    guarded('signin', [$('btn-signin')], async function () {
      setStatus('Signing in...');
      var r = await authCall('/auth/v1/token?grant_type=password', 'POST', null, { email: email, password: password });
      $('in-password').value = '';
      var s = r.status === 200 ? L.normaliseSession(r.body) : null;
      if (!s) { setStatus(L.authErrorMessage(r.status, r.body), 'err'); return; }
      saveSession(s);
      setStatus('');
      await route();
    });
  });

  $('btn-signout').addEventListener('click', function () {
    guarded('signout', [$('btn-signout')], async function () {
      var s = loadSession();
      if (s) await authCall('/auth/v1/logout?scope=local', 'POST', s.access_token); // best effort
      toSignin('');
      setStatus('Signed out.', 'ok');
    });
  });

  // The authenticator-code step. On again (admin v2): matches the server default ADMIN_REQUIRE_MFA (on unless "false").
  var REQUIRE_MFA = true;

  // Decide where a signed-in session belongs: console, or the MFA step when it is required.
  async function route() {
    var s = loadSession();
    if (!s) { toSignin(''); return; }
    if (!REQUIRE_MFA || L.tokenAal(s.access_token) === 'aal2') { enterConsole(); return; }
    await startMfa();
  }

  // ---------- 2. MFA ----------
  var mfa = { factorId: null, mode: null };

  async function startMfa() {
    showView('view-mfa');
    $('mfa-enrol').hidden = true; $('mfa-verify-intro').hidden = true; $('btn-mfa').disabled = true;
    $('in-code').value = '';
    setStatus('Checking your two-step verification...');
    var token = await freshToken();
    if (!token) return;
    var u = await authCall('/auth/v1/user', 'GET', token);
    if (u.status === 401 || u.status === 403) { toSignin('Your session expired. Please sign in again.'); return; }
    if (u.status !== 200 || !u.body) { setStatus(L.authErrorMessage(u.status, u.body), 'err'); return; }
    var f = L.pickFactors(u.body);

    if (f.verified) {
      mfa = { factorId: f.verified.id, mode: 'verify' };
      $('mfa-verify-intro').hidden = false;
      $('btn-mfa').disabled = false;
      setStatus('');
      $('in-code').focus();
      return;
    }
    // Clear half-finished enrolments first (a leftover unverified factor blocks re-enrolling with the same name).
    for (var i = 0; i < f.unverified.length; i++) await authCall('/auth/v1/factors/' + encodeURIComponent(f.unverified[i].id), 'DELETE', token);
    var e = await authCall('/auth/v1/factors', 'POST', token, { factor_type: 'totp', friendly_name: 'BenchPilot admin', issuer: 'BenchPilot' });
    var totp = e.body && e.body.totp;
    if (e.status !== 200 || !e.body || !e.body.id || !totp) { setStatus(L.authErrorMessage(e.status, e.body), 'err'); return; }
    mfa = { factorId: e.body.id, mode: 'enrol' };
    // qr_code is an SVG data URI generated by Supabase; only accept an image data URI.
    var qr = $('mfa-qr');
    if (typeof totp.qr_code === 'string' && /^data:image\//.test(totp.qr_code)) { qr.src = totp.qr_code; qr.hidden = false; } else qr.hidden = true;
    $('mfa-secret').textContent = totp.secret || '';
    $('mfa-enrol').hidden = false;
    $('btn-mfa').disabled = false;
    setStatus('');
    $('in-code').focus();
  }

  $('form-mfa').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = L.validateTotpCode($('in-code').value);
    if (!v.ok) { setStatus(v.error, 'err'); return; }
    if (!mfa.factorId) return;
    guarded('mfa', [$('btn-mfa')], async function () {
      setStatus('Verifying...');
      var token = await freshToken();
      if (!token) return;
      var path = '/auth/v1/factors/' + encodeURIComponent(mfa.factorId);
      var ch = await authCall(path + '/challenge', 'POST', token, {});
      if (ch.status !== 200 || !ch.body || !ch.body.id) { setStatus(L.authErrorMessage(ch.status, ch.body), 'err'); return; }
      var vr = await authCall(path + '/verify', 'POST', token, { challenge_id: ch.body.id, code: v.code });
      $('in-code').value = '';
      var s = vr.status === 200 ? L.normaliseSession(vr.body) : null;
      if (!s) { setStatus(L.authErrorMessage(vr.status, vr.body), 'err'); return; }
      s.email = s.email || (loadSession() || {}).email;
      if (L.tokenAal(s.access_token) !== 'aal2') { setStatus('Verification did not complete. Try again.', 'err'); return; }
      saveSession(s);
      setStatus('');
      enterConsole();
    });
  });

  // ---------- 3. console shell + routing ----------
  var ROUTES = ['dashboard', 'users', 'payments', 'audit', 'settings'];
  var currentUser = null; // {id, email} of the user shown in the panel

  function enterConsole() {
    showView('view-console');
    setStatus('');
    showRoute();
  }
  function currentRoute() {
    var h = (location.hash || '').replace(/^#/, '');
    return ROUTES.indexOf(h) >= 0 ? h : 'dashboard';
  }
  function showRoute() {
    if ($('view-console').hidden) return;
    var r = currentRoute();
    ROUTES.forEach(function (name) { $('page-' + name).hidden = name !== r; });
    Array.prototype.forEach.call(document.querySelectorAll('.adm-nav a'), function (a) {
      if (a.getAttribute('data-route') === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    closePanel();
    setStatus('');
    var h1 = $('page-' + r).querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    if (r === 'dashboard') loadDashboard();
    else if (r === 'users') loadUsers();
    else if (r === 'payments') loadPayments();
    else if (r === 'audit') loadAudit();
    else loadSettings();
  }
  window.addEventListener('hashchange', showRoute);

  /** Common handling for admin function failures. Returns true if the caller should stop. */
  function adminFailed(r, inline) {
    if (r.status === -1) return true; // already redirected to sign-in
    if (r.status === 200 && r.body) return false;
    if (r.status === 401) { toSignin('Your session expired. Please sign in again.'); return true; }
    var msg = L.adminErrorMessage(r.status, r.body);
    if (inline) setErr(inline, msg); else setStatus(msg, 'err');
    return true;
  }

  // ---------- dashboard ----------
  var dState = { days: 30 };

  Array.prototype.forEach.call(document.querySelectorAll('.adm-seg-btn'), function (b) {
    b.addEventListener('click', function () {
      dState.days = Number(b.getAttribute('data-range'));
      loadDashboard();
    });
  });
  function setupToggle(btnId, wrapId) {
    $(btnId).addEventListener('click', function () {
      var open = $(wrapId).hidden;
      $(wrapId).hidden = !open;
      $(btnId).setAttribute('aria-expanded', open ? 'true' : 'false');
      $(btnId).textContent = open ? 'Hide table' : 'View as table';
    });
  }
  setupToggle('tg-signups', 'tbl-wrap-signups');
  setupToggle('tg-revenue', 'tbl-wrap-revenue');

  async function loadDashboard() {
    var mine = nextToken('dash');
    Array.prototype.forEach.call(document.querySelectorAll('.adm-seg-btn'), function (b) {
      b.setAttribute('aria-pressed', Number(b.getAttribute('data-range')) === dState.days ? 'true' : 'false');
    });
    $('dash-note').textContent = 'Loading...';
    var r = await callAdmin(L.metricsBody(dState.days));
    if (mine !== tokens.dash) return;
    if (adminFailed(r)) { $('dash-note').textContent = ''; return; }
    $('dash-note').textContent = 'Last ' + dState.days + ' days, IST. Charts use server data only (no usage tracking).';
    renderDashboard(r.body.metrics || r.body);
  }

  function kpi(label, value, sub) {
    return el('div', { 'class': 'adm-kpi' }, [
      el('div', { 'class': 'adm-kpi-k', text: label }),
      el('div', { 'class': 'adm-kpi-v', text: value }),
      sub ? el('div', { 'class': 'adm-kpi-s', text: sub }) : null
    ]);
  }

  function renderDashboard(m) {
    var t = m.totals || {}, rev = m.revenue || {}, fnd = m.founding || {};
    var kp = $('kpis');
    clear(kp);
    var granted = (t.granted_basic | 0) + (t.granted_pro | 0);
    [
      kpi('Users', L.formatCount(t.users), L.formatCount(t.confirmed) + ' confirmed'),
      kpi('Active, 7 days', L.formatCount(t.active7), 'signed in'),
      kpi('Active, 30 days', L.formatCount(t.active30), 'signed in'),
      kpi('Paid Basic', L.formatCount(t.paid_basic)),
      kpi('Paid Pro', L.formatCount(t.paid_pro)),
      kpi('Granted plans', L.formatCount(granted), L.formatCount(t.granted_basic) + ' Basic, ' + L.formatCount(t.granted_pro) + ' Pro'),
      kpi('Revenue this month', L.formatRupees(rev.this_month_paise), 'Last month ' + L.formatRupees(rev.last_month_paise)),
      kpi('Revenue all time', L.formatRupees(rev.all_time_paise), L.formatCount(rev.payments_captured) + ' payments'),
      kpi('Founding slots', L.formatCount(fnd.used) + ' of ' + L.formatCount(fnd.limit == null ? 50 : fnd.limit), 'used'),
      kpi('Refunds', L.formatRupees(rev.refunded_paise), L.formatCount(rev.payments_refunded) + ' refunded'),
      kpi('Suspended', L.formatCount(t.suspended))
    ].forEach(function (k) { kp.appendChild(k); });

    var daily = L.fillDaily(m.daily, dState.days);
    barChart({
      host: $('chart-signups'), tableHost: $('tbl-wrap-signups'), cls: 'adm-bar-signups',
      title: 'Sign-ups per day', unit: 'sign-ups', days: daily,
      values: daily.map(function (d) { return d.signups; }),
      fmt: function (v) { return L.formatCount(v); }, tickFmt: function (v) { return L.formatCount(v); },
      tableHead: ['Date', 'Sign-ups', 'Signed in that day'],
      tableRow: function (d) { return [L.formatDate(d.day), L.formatCount(d.signups), L.formatCount(d.active)]; }
    });
    barChart({
      host: $('chart-revenue'), tableHost: $('tbl-wrap-revenue'), cls: 'adm-bar-revenue',
      title: 'Revenue per day', unit: 'revenue', days: daily,
      values: daily.map(function (d) { return d.revenue_paise; }),
      fmt: function (v) { return L.formatRupees(v); }, tickFmt: function (v) { return L.formatRupeesShort(v); },
      tableHead: ['Date', 'Revenue', 'Payments'],
      tableRow: function (d) { return [L.formatDate(d.day), L.formatRupees(d.revenue_paise), L.formatCount(d.payments)]; }
    });
    planChart($('chart-plan'), t);
    funnelChart($('funnel'), m.funnel_30d);
    healthPanel($('health'), m);
  }

  /** Bar chart: inline SVG, gridlines + y ticks, every bar has a <title> tooltip; text summary + table fallback. */
  function barChart(o) {
    var W = 640, H = 250, ML = 54, MR = 8, MT = 10, MB = 28;
    var pw = W - ML - MR, ph = H - MT - MB;
    var total = o.values.reduce(function (a, b) { return a + b; }, 0);
    var peakI = 0;
    o.values.forEach(function (v, i) { if (v > o.values[peakI]) peakI = i; });
    var summary = o.values.length && total > 0
      ? o.title + ', last ' + o.values.length + ' days: total ' + o.fmt(total) + ', busiest day ' + L.shortDay(o.days[peakI].day) + ' (' + o.fmt(o.values[peakI]) + ').'
      : o.title + ', last ' + o.values.length + ' days: no ' + o.unit + ' yet.';
    var ticks = L.axisTicks(Math.max.apply(null, o.values.concat([0])), 4);
    var root = svg('svg', { 'class': 'adm-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': summary, focusable: 'false' });
    var g = svg('g', { transform: 'translate(' + ML + ',' + MT + ')' });
    ticks.ticks.forEach(function (tv) {
      var y = ph - (tv / ticks.max) * ph;
      g.appendChild(svg('line', { x1: 0, x2: pw, y1: y, y2: y, cls: tv === 0 ? 'adm-axis-line' : 'adm-grid-line' }));
      g.appendChild(svg('text', { x: -8, y: y + 4, 'text-anchor': 'end', cls: 'adm-axis-text', text: o.tickFmt(tv) }));
    });
    L.barLayout(o.values, pw, ph, ticks.max).forEach(function (b, i) {
      var day = o.days[i].day;
      var rect = svg('rect', { x: b.x, y: b.h > 0 ? b.y : ph - 2, width: b.w, height: b.h > 0 ? b.h : 2, rx: 1.5, cls: b.h > 0 ? o.cls : 'adm-bar-zero' });
      rect.appendChild(svg('title', { text: L.shortDay(day) + ': ' + o.fmt(o.values[i]) }));
      g.appendChild(rect);
    });
    var slot = pw / o.values.length;
    L.labelIndexes(o.values.length, 7).forEach(function (i) {
      g.appendChild(svg('text', { x: i * slot + slot / 2, y: ph + 18, 'text-anchor': 'middle', cls: 'adm-axis-text', text: L.shortDay(o.days[i].day) }));
    });
    root.appendChild(g);
    clear(o.host);
    o.host.appendChild(root);
    o.host.appendChild(el('p', { 'class': 'adm-chart-sum', text: summary }));
    clear(o.tableHost);
    o.tableHost.appendChild(simpleTable(o.tableHead, o.days.slice().reverse().map(o.tableRow)));
  }

  /** Plan split: one horizontal stacked bar, legend with counts and percentages (never colour-only). */
  function planChart(host, totals) {
    var p = L.planSegments(totals);
    clear(host);
    var summary = 'Plan split of ' + L.formatCount(p.total) + ' users: ' + p.segments.map(function (s) { return s.label + ' ' + L.formatCount(s.value) + ' (' + s.pctText + ')'; }).join(', ') + '.';
    var root = svg('svg', { 'class': 'adm-stack', viewBox: '0 0 100 10', preserveAspectRatio: 'none', role: 'img', 'aria-label': summary, focusable: 'false' });
    if (p.total === 0) root.appendChild(svg('rect', { x: 0, y: 0, width: 100, height: 10, cls: 'adm-seg-free' }));
    p.segments.forEach(function (s) {
      if (s.w <= 0) return;
      var r = svg('rect', { x: s.x, y: 0, width: s.w, height: 10, cls: 'adm-seg-' + s.key, 'vector-effect': 'non-scaling-stroke' });
      r.appendChild(svg('title', { text: s.label + ': ' + L.formatCount(s.value) + ' (' + s.pctText + ')' }));
      root.appendChild(r);
    });
    host.appendChild(root);
    var ul = el('ul', { 'class': 'adm-legend' });
    p.segments.forEach(function (s) {
      ul.appendChild(el('li', null, [
        el('span', { 'class': 'adm-sw adm-sw-' + s.key, 'aria-hidden': 'true' }),
        el('span', { text: s.label }),
        el('span', { 'class': 'adm-lv', text: L.formatCount(s.value) + ' (' + s.pctText + ')' })
      ]));
    });
    host.appendChild(ul);
  }

  function funnelChart(host, f) {
    clear(host);
    var steps = L.funnelSteps(f);
    var box = el('div', { 'class': 'adm-funnel' });
    steps.forEach(function (s, i) {
      var fill = el('div', { 'class': 'adm-ffill' });
      fill.style.width = s.width + '%';
      var pctText = i === 0 ? '' : i === 1 ? s.ofFirst + ' of sign-ups' : s.ofPrev + ' of checkouts (' + s.ofFirst + ' of sign-ups)';
      box.appendChild(el('div', { role: 'group', 'aria-label': s.label + ': ' + L.formatCount(s.value) + (pctText ? ', ' + pctText : '') }, [
        el('div', { 'class': 'adm-fstep-top' }, [el('span', { text: s.label }), el('span', null, [el('b', { text: L.formatCount(s.value) }), pctText ? ' ' + pctText : ''])]),
        el('div', { 'class': 'adm-ftrack', 'aria-hidden': 'true' }, [fill])
      ]));
    });
    host.appendChild(box);
  }

  function healthPanel(host, m) {
    clear(host);
    var n = m.webhooks_24h | 0;
    var prov = m.providers || {};
    var wh = el('div', { 'class': 'adm-health-item' }, [
      el('div', { 'class': 'adm-kpi-k', text: 'Payment webhooks, last 24 hours' }),
      el('div', { 'class': 'adm-kpi-v', text: L.formatCount(n) }),
      el('div', { 'class': 'adm-kpi-s adm-flag' + (n === 0 ? ' adm-flag-warn' : ''), text: n === 0 ? 'None received. Normal if there were no sales; otherwise check Razorpay webhooks.' : 'Receiving normally.' })
    ]);
    var pv = el('div', { 'class': 'adm-health-item' }, [
      el('div', { 'class': 'adm-kpi-k', text: 'Sign-in method' }),
      el('div', { 'class': 'adm-kpi-v', text: L.formatCount(prov.email) + ' email, ' + L.formatCount(prov.google) + ' Google' })
    ]);
    var wrap = el('div', { 'class': 'adm-health' }, [wh, pv]);
    host.appendChild(wrap);
  }

  // ---------- CSV export ----------
  function downloadText(filename, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  /** Fetch pages (100 rows each) up to EXPORT_MAX_ROWS and download one CSV of the current filter. */
  async function exportCsv(o) {
    var rows = [], total = null, offset = 0;
    for (var page = 0; page < 60; page++) {
      setStatus('Exporting... ' + L.formatCount(rows.length) + (total == null ? '' : ' of ' + L.formatCount(Math.min(total, L.EXPORT_MAX_ROWS))) + ' rows');
      var r = await callAdmin(L.listBody(o.action, o.filter, L.EXPORT_PAGE, offset));
      if (adminFailed(r)) return;
      var list = r.body[o.key] || [];
      total = Number(r.body.total) || 0;
      list.forEach(function (x) { if (rows.length < L.EXPORT_MAX_ROWS) rows.push(o.row(x)); });
      offset += list.length;
      if (!list.length || offset >= total || rows.length >= L.EXPORT_MAX_ROWS) break;
    }
    var stamp = L.istToday();
    downloadText(o.file + '-' + stamp + '.csv', L.buildCsv(o.headers, rows));
    var capped = total > L.EXPORT_MAX_ROWS;
    setStatus('Exported ' + L.formatCount(rows.length) + ' rows to ' + o.file + '-' + stamp + '.csv' + (capped ? ' (first ' + L.formatCount(L.EXPORT_MAX_ROWS) + ' of ' + L.formatCount(total) + '; narrow the filter for the rest)' : '') + '.', 'ok');
  }

  // ---------- users ----------
  var uState = { offset: 0, selected: {}, rows: [], total: 0 };
  var USER_FIELDS = { q: 'u-q', plan: 'u-plan', source: 'u-source', status: 'u-status', signed_up_after: 'u-after', signed_up_before: 'u-before', sort: 'u-sort' };

  (function initUserSort() {
    Object.keys(L.USER_SORTS).forEach(function (k) { $('u-sort').appendChild(el('option', { value: k, text: L.USER_SORTS[k] })); });
  })();

  function readFilter(fields) {
    var raw = {};
    Object.keys(fields).forEach(function (k) { raw[k] = $(fields[k]).value; });
    return raw;
  }
  function userFilterNow() { return L.userFilter(readFilter(USER_FIELDS)); }
  function resetFields(fields) { Object.keys(fields).forEach(function (k) { $(fields[k]).value = ''; }); }

  function filtersChanged(load) { return function () { uState.offset = 0; if (load === 'users') loadUsers(); }; }
  $('u-q').addEventListener('input', debounce(function () { uState.offset = 0; loadUsers(); }, 300));
  ['u-plan', 'u-source', 'u-status', 'u-after', 'u-before', 'u-sort'].forEach(function (id) {
    $(id).addEventListener('change', filtersChanged('users'));
  });
  $('form-users').addEventListener('submit', function (ev) { ev.preventDefault(); uState.offset = 0; loadUsers(); });
  $('u-reset').addEventListener('click', function () { resetFields(USER_FIELDS); uState.offset = 0; uState.selected = {}; loadUsers(); });
  $('u-prev').addEventListener('click', function () { uState.offset = Math.max(0, uState.offset - L.PAGE_SIZE); loadUsers(); });
  $('u-next').addEventListener('click', function () { uState.offset += L.PAGE_SIZE; loadUsers(); });

  async function loadUsers() {
    var err = L.dateRangeError($('u-after').value, $('u-before').value);
    setErr('u-error', err);
    if (err) return;
    var mine = nextToken('users');
    $('u-count').textContent = 'Loading...';
    var r = await callAdmin(L.listBody('list_users', userFilterNow(), L.PAGE_SIZE, uState.offset));
    if (mine !== tokens.users) return;
    if (adminFailed(r)) { $('u-count').textContent = ''; return; }
    var users = r.body.users || [];
    if (!users.length && uState.offset > 0 && r.body.total > 0) { uState.offset = 0; loadUsers(); return; } // page vanished (e.g. after delete)
    uState.rows = users; uState.total = Number(r.body.total) || 0;
    renderUsers();
  }

  function selectedIds() { return Object.keys(uState.selected); }
  function updateBulk() {
    var n = selectedIds().length;
    $('u-bulk').textContent = 'Grant to selected (' + n + ')';
    $('u-bulk').disabled = n === 0;
    var ids = uState.rows.map(function (u) { return u.id; });
    var onPage = ids.filter(function (id) { return uState.selected[id]; }).length;
    $('u-all').checked = ids.length > 0 && onPage === ids.length;
    $('u-all').indeterminate = onPage > 0 && onPage < ids.length;
  }

  /** Effective plan, plus a muted "Paid until" line when a paid entitlement exists (greyed once expired). */
  function planCellWithPaid(u, eff) {
    var box = el('span');
    box.appendChild(planCell(eff.plan, eff.until, eff.plan !== 'free' && eff.source ? '(' + eff.source + ')' : ''));
    if (u.paid && u.paid.until) {
      var past = u.paid.until < L.istToday();
      box.appendChild(el('div', { 'class': 'adm-muted' + (past ? ' adm-expired' : ''), text: 'Paid until ' + L.formatDate(u.paid.until) + (past ? ' (expired)' : '') }));
    }
    return box;
  }

  function renderUsers() {
    var tb = $('tbl-users').tBodies[0];
    clear(tb);
    var pi = L.pageInfo(uState.total, uState.offset, uState.rows.length);
    $('u-count').textContent = L.formatCount(uState.total) + (uState.total === 1 ? ' user' : ' users');
    $('u-range').textContent = pi.text;
    $('u-prev').disabled = !pi.hasPrev;
    $('u-next').disabled = !pi.hasNext;
    if (!uState.rows.length) {
      tb.appendChild(el('tr', null, [el('td', { colspan: 7, 'class': 'adm-muted', text: 'No users match these filters.' })]));
    }
    uState.rows.forEach(function (u) {
      var eff = u.effective || { plan: 'free' };
      var cb = el('input', { type: 'checkbox', 'aria-label': 'Select ' + u.email });
      cb.checked = !!uState.selected[u.id];
      var tr = el('tr', cb.checked ? { 'class': 'adm-sel' } : null);
      cb.addEventListener('click', function (ev) { ev.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (selectedIds().length >= L.MAX_BULK) { cb.checked = false; setStatus('You can select at most ' + L.MAX_BULK + ' users at a time.', 'err'); return; }
          uState.selected[u.id] = u.email; tr.className = 'adm-sel';
        } else { delete uState.selected[u.id]; tr.className = ''; }
        updateBulk();
      });
      var open = el('button', { type: 'button', 'class': 'adm-link adm-mono', text: u.email });
      open.addEventListener('click', function (ev) { ev.stopPropagation(); openUser(u.id, open); });
      tr.addEventListener('click', function (ev) { if (ev.target.closest('button,input,a')) return; openUser(u.id, open); });
      tb.appendChild(tr);
      [td(cb, 'adm-chk'), td(open), td(L.formatDate(u.created_at)), td(L.formatDateTime(u.last_sign_in_at)),
        td(planCellWithPaid(u, eff)), td(statusBadge(u)),
        td(el('button', { type: 'button', 'class': 'adm-btn adm-btn-ghost adm-btn-sm', text: 'Open', 'aria-label': 'Open ' + u.email, onclick: function (ev) { ev.stopPropagation(); openUser(u.id, ev.currentTarget); } }))
      ].forEach(function (c) { tr.appendChild(c); });
    });
    updateBulk();
  }

  $('u-all').addEventListener('change', function () {
    var on = $('u-all').checked;
    for (var i = 0; i < uState.rows.length; i++) {
      var u = uState.rows[i];
      if (on) {
        if (!uState.selected[u.id] && selectedIds().length >= L.MAX_BULK) { setStatus('You can select at most ' + L.MAX_BULK + ' users at a time.', 'err'); break; }
        uState.selected[u.id] = u.email;
      } else delete uState.selected[u.id];
    }
    renderUsers();
  });

  $('u-export').addEventListener('click', function () {
    var err = L.dateRangeError($('u-after').value, $('u-before').value);
    if (err) { setErr('u-error', err); return; }
    guarded('export-users', [$('u-export')], function () {
      return exportCsv({ action: 'list_users', filter: userFilterNow(), key: 'users', headers: L.USER_CSV_HEADERS, row: L.userCsvRow, file: 'benchpilot-users' });
    });
  });

  $('u-bulk').addEventListener('click', function () {
    var ids = selectedIds();
    var v = L.validateBulkSelection(ids);
    if (!v.ok) { setStatus(v.error, 'err'); return; }
    guarded('bulk', [$('u-bulk')], async function () {
      var res = await ask({
        title: 'Grant plan to ' + ids.length + (ids.length === 1 ? ' user' : ' users'), grant: true, reason: true, okText: 'Grant plan',
        message: function (g) { return L.bulkConfirmText(ids.length, g); },
        run: function (vals) { return callAdmin(L.grantBulkBody(ids, vals)); }
      });
      if (!res) return;
      var n = res.body && res.body.granted != null ? res.body.granted : ids.length;
      uState.selected = {};
      setStatus('Done. Gave ' + L.tierLabel(res.vals.tier) + ' for ' + res.vals.days + ' days to ' + L.formatCount(n) + (n === 1 ? ' user.' : ' users.'), 'ok');
      await loadUsers();
    });
  });

  // ---------- user panel ----------
  var panelOpener = null;
  function openUser(userId, opener) {
    panelOpener = opener || document.activeElement;
    $('panel').hidden = false; $('panel-scrim').hidden = false;
    setPanelStatus('Loading user...');
    $('panel-title').textContent = 'User';
    $('panel-close').focus();
    loadUser(userId);
  }
  function closePanel() {
    if ($('panel').hidden) return;
    nextToken('panel');
    $('panel').hidden = true; $('panel-scrim').hidden = true;
    currentUser = null;
    setPanelStatus('');
    if (panelOpener && document.body.contains(panelOpener) && !$('view-console').hidden) panelOpener.focus();
    panelOpener = null;
  }
  $('panel-close').addEventListener('click', closePanel);
  $('panel-scrim').addEventListener('click', closePanel);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('panel').hidden && !$('dlg').open) closePanel(); });

  async function loadUser(userId, keepStatus) {
    var mine = nextToken('panel');
    var r = await callAdmin(L.getUserBody(userId));
    if (mine !== tokens.panel) return;
    if (r.status === -1) return;
    if (r.status === 401) { toSignin('Your session expired. Please sign in again.'); return; }
    if (r.status !== 200 || !r.body) { closePanel(); setStatus(L.adminErrorMessage(r.status, r.body), 'err'); return; }
    if (!keepStatus) setPanelStatus('');
    renderDetail(r.body);
  }

  function renderDetail(d) {
    var u = d.user;
    var suspended = !!(u.suspended || d.suspended);
    currentUser = { id: u.id, email: u.email, suspended: suspended };
    $('panel-title').textContent = u.email;

    var eff = u.effective || { plan: 'free' };
    var dl = $('detail-summary');
    clear(dl);
    function row(k, v) { dl.appendChild(el('dt', { text: k })); var dd = el('dd'); if (v && v.nodeType) dd.appendChild(v); else dd.textContent = v == null ? '-' : String(v); dl.appendChild(dd); }
    row('Email', u.email);
    row('User ID', el('span', { 'class': 'adm-mono', text: u.id }));
    row('Status', suspended ? el('span', { 'class': 'adm-badge adm-badge-bad', text: 'Suspended' }) : statusBadge(u));
    row('Sign-in method', u.provider || d.provider || '-');
    row('Created', L.formatDateTime(u.created_at));
    row('Email confirmed', u.email_confirmed_at ? L.formatDateTime(u.email_confirmed_at) : 'No');
    row('Last sign-in', L.formatDateTime(u.last_sign_in_at));
    row('Effective plan', planCell(eff.plan, eff.until, eff.source ? '(' + eff.source + ')' : ''));
    row('Paid plan', u.paid ? planCell(u.paid.tier, u.paid.until, u.paid.active ? '' : '(expired)') : 'None');
    row('Active grant', u.activeGrant ? planCell(u.activeGrant.tier, u.activeGrant.ends_on, '- ' + u.activeGrant.reason) : 'None');

    // actions
    var ac = $('detail-actions');
    clear(ac);
    var target = currentUser;
    function actBtn(text, cls, fn) { var b = el('button', { type: 'button', 'class': 'adm-btn adm-btn-sm ' + cls, text: text }); b.addEventListener('click', function () { guarded('act-' + text, [b], function () { return fn(target, b); }); }); ac.appendChild(b); return b; }
    actBtn('Grant plan', 'adm-btn-primary', onGrant);
    if (suspended) actBtn('Unsuspend', 'adm-btn-ghost', function (t) { return simpleAction('unsuspend', 'Unsuspend', t); });
    else actBtn('Suspend', 'adm-btn-ghost', function (t) { return simpleAction('suspend', 'Suspend', t); });
    actBtn('Sign out everywhere', 'adm-btn-ghost', function (t) { return simpleAction('sign_out_everywhere', 'Sign out everywhere', t); });
    actBtn('Send password reset', 'adm-btn-ghost', function (t) { return simpleAction('send_password_reset', 'Send password reset', t); });
    actBtn('Delete user', 'adm-btn-danger', onDelete);

    // grants
    var gb = $('tbl-grants').tBodies[0];
    clear(gb);
    var grants = d.grants || [];
    $('grants-empty').hidden = grants.length > 0;
    $('tbl-grants').hidden = grants.length === 0;
    grants.forEach(function (g) {
      var status = g.revoked_at ? 'Revoked ' + L.formatDate(g.revoked_at) : g.active ? 'Active' : 'Expired';
      var action = null;
      if (g.active && !g.revoked_at) {
        action = el('button', { type: 'button', 'class': 'adm-btn adm-btn-danger adm-btn-sm', text: 'Revoke' });
        action.addEventListener('click', function () { onRevoke(g, action); });
      }
      gb.appendChild(el('tr', null, [
        td(badge(g.tier)), td(L.formatDate(g.starts_on)), td(L.formatDate(g.ends_on)), td(g.reason),
        td(el('span', { 'class': 'adm-badge ' + (g.active && !g.revoked_at ? 'adm-badge-active' : 'adm-badge-off'), text: status })),
        td(action)
      ]));
    });

    // payments (amount is in paise)
    var pb = $('tbl-payments').tBodies[0];
    clear(pb);
    var pays = d.payments || [];
    $('payments-empty').hidden = pays.length > 0;
    $('tbl-payments').hidden = pays.length === 0;
    pays.forEach(function (p) {
      var st = p.refunded_at ? (p.status || '') + ' (refunded ' + L.formatDate(p.refunded_at) + ')' : (p.status || '');
      pb.appendChild(el('tr', null, [
        td(L.formatDateTime(p.created_at)), td(p.plan), td(L.formatMoney(p.amount, p.currency)), td(st), td(p.razorpay_payment_id, 'adm-mono')
      ]));
    });

    // checkouts
    var cb = $('tbl-checkouts').tBodies[0];
    clear(cb);
    var cos = d.checkouts || [];
    $('checkouts-empty').hidden = cos.length > 0;
    $('tbl-checkouts').hidden = cos.length === 0;
    cos.forEach(function (c) {
      cb.appendChild(el('tr', null, [td(L.formatDateTime(c.created_at)), td(c.plan), td(c.reference_id, 'adm-mono')]));
    });

    // this user's audit history (server key assumed `audit`; `audit_rows` / `history` tolerated)
    var ub = $('tbl-uaudit').tBodies[0];
    clear(ub);
    var hist = d.audit || d.audit_rows || d.history || [];
    $('uaudit-empty').hidden = hist.length > 0;
    $('tbl-uaudit').hidden = hist.length === 0;
    hist.forEach(function (a) {
      ub.appendChild(el('tr', null, [td(L.formatDateTime(a.at)), td(a.actor_email), td(a.action), td(a.reason)]));
    });
  }

  // ---------- dialog (confirm; optional plan fields, reason, type-the-email box; inline errors) ----------
  var dlg = $('dlg');
  var dlgDone = null;
  var dlgOpts = null;
  function dlgGrantValues() { return { tier: $('dg-tier').value, days: $('dg-days').value, reason: $('dlg-reason').value }; }
  function dlgMessage() {
    var o = dlgOpts;
    if (!o) return;
    if (typeof o.message === 'function') {
      var gv = L.validateGrantForm({ tier: $('dg-tier').value, days: $('dg-days').value, reason: 'x' });
      $('dlg-msg').textContent = gv.ok ? o.message(gv.value) : 'Choose a plan and a number of days (1 to 366).';
    } else $('dlg-msg').textContent = o.message;
  }
  function dlgSync() {
    dlgMessage();
    if (dlgOpts && dlgOpts.typeEmail) $('dlg-ok').disabled = !L.emailMatches($('dlg-type').value, dlgOpts.typeEmail);
  }
  /** Resolves null (cancelled) or {vals, body} after o.run succeeded; errors from o.run stay in the dialog. */
  function ask(o) {
    return new Promise(function (resolve) {
      dlgOpts = o;
      $('dlg-title').textContent = o.title;
      $('dlg-grant').hidden = !o.grant;
      $('dg-tier').value = 'pro'; $('dg-days').value = '30';
      $('dlg-reason-wrap').hidden = !o.reason;
      $('dlg-reason').value = '';
      $('dlg-type-wrap').hidden = !o.typeEmail;
      $('dlg-type').value = '';
      $('dlg-type-label').textContent = o.typeEmail ? 'Type ' + o.typeEmail + ' to confirm' : '';
      $('dlg-error').hidden = true;
      $('dlg-ok').textContent = o.okText || 'Confirm';
      $('dlg-ok').className = 'adm-btn ' + (o.danger ? 'adm-btn-danger' : 'adm-btn-primary');
      $('dlg-ok').disabled = false;
      $('dlg-cancel').disabled = false;
      dlgSync();
      dlgDone = function (val) { dlgDone = null; dlgOpts = null; if (dlg.open) dlg.close(); resolve(val); };
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      (o.typeEmail ? $('dlg-type') : o.reason ? $('dlg-reason') : $('dlg-ok')).focus();
    });
  }
  $('dlg-cancel').addEventListener('click', function () { if (dlgDone && !busy.dlg) dlgDone(null); });
  dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); if (dlgDone && !busy.dlg) dlgDone(null); }); // Esc
  Array.prototype.forEach.call(document.querySelectorAll('.adm-preset'), function (b) {
    b.addEventListener('click', function () { $('dg-days').value = b.getAttribute('data-days'); dlgSync(); });
  });
  $('dg-days').addEventListener('input', dlgSync);
  $('dg-tier').addEventListener('change', dlgSync);
  $('dlg-type').addEventListener('input', dlgSync);
  $('dlg-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var o = dlgOpts;
    if (!dlgDone || !o) return;
    function fail(msg) { $('dlg-error').textContent = msg; $('dlg-error').hidden = false; }
    var vals = {};
    if (o.grant) {
      var gv = L.validateGrantForm(dlgGrantValues());
      if (!gv.ok) { fail(Object.keys(gv.errors).map(function (k) { return gv.errors[k]; }).join(' ')); return; }
      vals = gv.value;
    } else if (o.reason) {
      var rv = L.validateReason($('dlg-reason').value);
      if (!rv.ok) { fail(rv.error); return; }
      vals = { reason: rv.reason };
    }
    if (o.typeEmail) {
      if (!L.emailMatches($('dlg-type').value, o.typeEmail)) { fail('Type the email exactly as shown.'); return; }
      vals.confirm_email = $('dlg-type').value.trim();
    }
    $('dlg-error').hidden = true;
    guarded('dlg', [$('dlg-ok'), $('dlg-cancel')], async function () {
      var r = await o.run(vals);
      if (r.status === -1) { if (dlgDone) dlgDone(null); return; }
      if (r.status === 401) { if (dlgDone) dlgDone(null); toSignin('Your session expired. Please sign in again.'); return; }
      if (r.status !== 200 || !r.body) { fail(L.adminErrorMessage(r.status, r.body)); return; }
      if (dlgDone) dlgDone({ vals: vals, body: r.body });
    });
  });

  // ---------- panel actions ----------
  function effText(body) {
    var e = (body && body.effective) || {};
    return L.tierLabel(e.plan) + (e.until ? ' until ' + L.formatDate(e.until) : '');
  }

  function onGrant(target) {
    return ask({
      title: 'Give plan to ' + target.email, grant: true, reason: true, okText: 'Give plan',
      message: function (g) { return L.grantConfirmText(target.email, g); },
      run: function (vals) { return callAdmin(L.grantBody(target.id, vals)); }
    }).then(function (res) {
      if (!res) return;
      setPanelStatus('Done. ' + target.email + ' now has ' + effText(res.body) + '.', 'ok');
      return refreshAfterChange(target.id);
    });
  }

  function onRevoke(g, btn) {
    if (!currentUser) return;
    var target = currentUser;
    guarded('revoke', [btn], async function () {
      var res = await ask({
        title: 'Revoke grant', reason: true, okText: 'Revoke', danger: true,
        message: 'Revoke the ' + L.tierLabel(g.tier) + ' grant for ' + target.email + ' (until ' + L.formatDate(g.ends_on) + ')? Any paid plan stays.',
        run: function (vals) { return callAdmin(L.revokeBody(g.id, vals.reason)); }
      });
      if (!res) return;
      setPanelStatus('Revoked. ' + target.email + ' is now on ' + effText(res.body) + '.', 'ok');
      await refreshAfterChange(target.id);
    });
  }

  function sessionsText(body) {
    var n = body && Number.isFinite(body.sessions_ended) ? body.sessions_ended : null;
    return n == null ? '' : ' (' + n + (n === 1 ? ' session' : ' sessions') + ' ended)';
  }
  var DONE_TEXT = {
    suspend: function (e, b) { return 'Suspended ' + e + '. They cannot sign in' + sessionsText(b) + '.'; },
    unsuspend: function (e) { return 'Unsuspended ' + e + '. They can sign in again.'; },
    sign_out_everywhere: function (e, b) { return 'Signed ' + e + ' out of every device' + sessionsText(b) + '.'; },
    send_password_reset: function (e) { return 'Password reset email sent to ' + e + '.'; }
  };
  function simpleAction(action, label, target) {
    return ask({
      title: label, reason: true, okText: label, danger: action === 'suspend',
      message: L.actionConfirmText(action, target.email),
      run: function (vals) { return callAdmin(L.userActionBody(action, target.id, vals.reason)); }
    }).then(function (res) {
      if (!res) return;
      setPanelStatus('Done. ' + DONE_TEXT[action](target.email, res.body), 'ok');
      return refreshAfterChange(target.id);
    });
  }

  function onDelete(target) {
    return ask({
      title: 'Delete user', reason: true, typeEmail: target.email, okText: 'Delete user', danger: true,
      message: L.deleteConfirmText(target.email),
      run: function (vals) { return callAdmin(L.deleteUserBody(target.id, vals.confirm_email, vals.reason)); }
    }).then(function (res) {
      if (!res) return;
      closePanel();
      setStatus('Deleted ' + target.email + '. The account is gone; payment records are kept.', 'ok');
      delete uState.selected[target.id];
      return loadUsers();
    });
  }

  async function refreshAfterChange(userId) {
    await loadUser(userId, true);
    if (currentRoute() === 'users') await loadUsers();
  }

  // ---------- payments ----------
  var pState = { offset: 0 };
  var PAY_FIELDS = { q: 'p-q', status: 'p-status', plan: 'p-plan', from: 'p-from', to: 'p-to' };
  function payFilterNow() { return L.paymentFilter(readFilter(PAY_FIELDS)); }
  $('p-q').addEventListener('input', debounce(function () { pState.offset = 0; loadPayments(); }, 300));
  ['p-status', 'p-plan', 'p-from', 'p-to'].forEach(function (id) { $(id).addEventListener('change', function () { pState.offset = 0; loadPayments(); }); });
  $('form-payments').addEventListener('submit', function (ev) { ev.preventDefault(); pState.offset = 0; loadPayments(); });
  $('p-reset').addEventListener('click', function () { resetFields(PAY_FIELDS); pState.offset = 0; loadPayments(); });
  $('p-prev').addEventListener('click', function () { pState.offset = Math.max(0, pState.offset - L.PAGE_SIZE); loadPayments(); });
  $('p-next').addEventListener('click', function () { pState.offset += L.PAGE_SIZE; loadPayments(); });

  async function loadPayments() {
    var err = L.dateRangeError($('p-from').value, $('p-to').value);
    setErr('p-error', err);
    if (err) return;
    var mine = nextToken('pay');
    $('p-count').textContent = 'Loading...';
    var r = await callAdmin(L.listBody('list_payments', payFilterNow(), L.PAGE_SIZE, pState.offset));
    if (mine !== tokens.pay) return;
    if (adminFailed(r)) { $('p-count').textContent = ''; return; }
    var list = r.body.payments || [];
    var total = Number(r.body.total) || 0;
    var pi = L.pageInfo(total, pState.offset, list.length);
    $('p-count').textContent = L.formatCount(total) + (total === 1 ? ' payment' : ' payments') + ', captured total ' + L.formatMoney(Number(r.body.sum_paise) || 0, 'INR');
    $('p-range').textContent = pi.text;
    $('p-prev').disabled = !pi.hasPrev; $('p-next').disabled = !pi.hasNext;
    var tb = $('tbl-pay').tBodies[0];
    clear(tb);
    if (!list.length) tb.appendChild(el('tr', null, [el('td', { colspan: 6, 'class': 'adm-muted', text: 'No payments match these filters.' })]));
    list.forEach(function (p) {
      var who;
      if (p.user_id) { who = el('button', { type: 'button', 'class': 'adm-link adm-mono', text: p.email || p.user_id }); who.addEventListener('click', function () { openUser(p.user_id, who); }); }
      else who = el('span', { 'class': 'adm-muted', text: (p.email || 'Deleted user') });
      var st = p.refunded_at ? 'refunded ' + L.formatDate(p.refunded_at) : (p.status || '');
      var sb = el('span', { 'class': 'adm-badge ' + (p.status === 'captured' && !p.refunded_at ? 'adm-badge-active' : p.refunded_at || p.status === 'failed' ? 'adm-badge-bad' : 'adm-badge-off'), text: st });
      tb.appendChild(el('tr', null, [td(L.formatDateTime(p.created_at)), td(who), td(badge(p.plan)), td(L.formatMoney(p.amount, p.currency), 'adm-num'), td(sb), td(p.razorpay_payment_id, 'adm-mono')]));
    });
  }
  $('p-export').addEventListener('click', function () {
    var err = L.dateRangeError($('p-from').value, $('p-to').value);
    if (err) { setErr('p-error', err); return; }
    guarded('export-pay', [$('p-export')], function () {
      return exportCsv({ action: 'list_payments', filter: payFilterNow(), key: 'payments', headers: L.PAYMENT_CSV_HEADERS, row: L.paymentCsvRow, file: 'benchpilot-payments' });
    });
  });

  // ---------- audit log ----------
  var aState = { offset: 0 };
  var AUD_FIELDS = { action: 'a-action', from: 'a-from', to: 'a-to' };
  function auditFilterNow() { return L.auditFilter(readFilter(AUD_FIELDS)); }
  $('a-action').addEventListener('input', debounce(function () { aState.offset = 0; loadAudit(); }, 300));
  ['a-from', 'a-to'].forEach(function (id) { $(id).addEventListener('change', function () { aState.offset = 0; loadAudit(); }); });
  $('form-audit').addEventListener('submit', function (ev) { ev.preventDefault(); aState.offset = 0; loadAudit(); });
  $('a-reset').addEventListener('click', function () { resetFields(AUD_FIELDS); aState.offset = 0; loadAudit(); });
  $('a-prev').addEventListener('click', function () { aState.offset = Math.max(0, aState.offset - L.PAGE_SIZE); loadAudit(); });
  $('a-next').addEventListener('click', function () { aState.offset += L.PAGE_SIZE; loadAudit(); });

  function jsonText(v) {
    if (v == null) return '(none)';
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  }

  async function loadAudit() {
    var err = L.dateRangeError($('a-from').value, $('a-to').value);
    setErr('a-error', err);
    if (err) return;
    var mine = nextToken('audit');
    $('a-count').textContent = 'Loading...';
    var r = await callAdmin(L.listBody('list_audit', auditFilterNow(), L.PAGE_SIZE, aState.offset));
    if (mine !== tokens.audit) return;
    if (adminFailed(r)) { $('a-count').textContent = ''; return; }
    var list = r.body.rows || [];
    var total = Number(r.body.total) || 0;
    var pi = L.pageInfo(total, aState.offset, list.length);
    $('a-count').textContent = L.formatCount(total) + (total === 1 ? ' action' : ' actions');
    $('a-range').textContent = pi.text;
    $('a-prev').disabled = !pi.hasPrev; $('a-next').disabled = !pi.hasNext;
    var tb = $('tbl-audit').tBodies[0];
    clear(tb);
    if (!list.length) tb.appendChild(el('tr', null, [el('td', { colspan: 6, 'class': 'adm-muted', text: 'No admin actions match these filters.' })]));
    list.forEach(function (a, i) {
      var detailId = 'aud-detail-' + i;
      var tr = el('tr');
      var detail = el('tr', { 'class': 'adm-detail-row', id: detailId, hidden: '' });
      var tog = el('button', { type: 'button', 'class': 'adm-btn adm-btn-ghost adm-btn-sm', text: 'Details', 'aria-expanded': 'false', 'aria-controls': detailId });
      tog.addEventListener('click', function () {
        var open = detail.hidden;
        detail.hidden = !open;
        tog.setAttribute('aria-expanded', open ? 'true' : 'false');
        tog.textContent = open ? 'Hide' : 'Details';
      });
      var target;
      if (a.target_user) { target = el('button', { type: 'button', 'class': 'adm-link adm-mono', text: a.target_email || a.target_user }); target.addEventListener('click', function () { openUser(a.target_user, target); }); }
      else target = a.target_email || '-';
      [td(L.formatDateTime(a.at)), td(a.actor_email), td(a.action, 'adm-mono'), td(target), td(a.reason), td(tog)].forEach(function (c) { tr.appendChild(c); });
      var grid = el('div', { 'class': 'adm-detail-grid' }, [
        el('div', null, [el('h4', { text: 'Before' }), el('pre', { 'class': 'adm-json', text: jsonText(a.before) })]),
        el('div', null, [el('h4', { text: 'After' }), el('pre', { 'class': 'adm-json', text: jsonText(a.after) })])
      ]);
      detail.appendChild(el('td', { colspan: 6 }, [grid]));
      tb.appendChild(tr);
      tb.appendChild(detail);
    });
  }

  // ---------- settings ----------
  async function loadSettings() {
    var mine = nextToken('settings');
    var dl = $('set-account');
    clear(dl);
    function row(k, v) { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
    var s = loadSession();
    row('Admin email', (s && s.email) || '-');
    row('Session level', s ? (L.tokenAal(s.access_token) === 'aal2' ? 'aal2 (signed in with authenticator code)' : 'aal1 (password only)') : '-');
    var token = await freshToken();
    if (!token) return;
    var u = await authCall('/auth/v1/user', 'GET', token);
    if (mine !== tokens.settings) return;
    if (u.status === 200 && u.body) {
      var f = L.pickFactors(u.body);
      row('Two-step verification', f.verified ? 'On: authenticator app verified' : 'Not set up');
      row('Server rule', REQUIRE_MFA ? 'Admin actions need the authenticator code (aal2)' : 'Authenticator code not enforced');
    } else row('Two-step verification', 'Could not check (' + L.authErrorMessage(u.status, u.body) + ')');
  }

  // ---------- startup ----------
  setInterval(function () { // keep the session alive while the page is open; drop to sign-in if it can't be renewed
    var s = loadSession();
    if (s && L.needsRefresh(s)) freshToken();
  }, 30000);

  (async function init() {
    if (!loadSession()) { showView('view-signin'); $('in-email').focus(); return; }
    var token = await freshToken();
    if (token) await route();
  })();
})();
