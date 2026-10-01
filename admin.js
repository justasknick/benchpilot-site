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
(function () {
  'use strict';

  var L = window.BPAdminLib;
  var SUPABASE_URL = 'https://uhgtlyxarozzdgdizoaz.supabase.co';
  var ANON_KEY = 'sb_publishable_pV2FThlwZ8OnVXEQqVXDJg_9mDrC2q4'; // public by design
  var STORE_KEY = 'bp_admin_session';

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

  // ---------- status banner ----------
  function setStatus(msg, kind) {
    var s = $('status');
    if (!msg) { s.hidden = true; s.textContent = ''; return; }
    s.textContent = msg;
    s.className = 'adm-status' + (kind === 'ok' ? ' adm-ok' : kind === 'err' ? ' adm-err' : '');
    s.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    s.hidden = false;
  }

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
    seq++; // drop in-flight responses
    currentUser = null; lastQuery = '';
    $('results').hidden = true; $('detail').hidden = true;
    clear($('tbl-results').tBodies[0]);
    $('in-query').value = '';
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

  // The authenticator-code step. Off for now (founder decision 2026-10-01); turn it back on together with
  // the server secret ADMIN_REQUIRE_MFA=true.
  var REQUIRE_MFA = false;

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

  // ---------- 3. console ----------
  var seq = 0;           // latest-request-wins counter
  var currentUser = null; // {id, email} of the user shown in the detail panel
  var lastQuery = '';

  function enterConsole() {
    showView('view-console');
    setStatus('');
    $('in-query').focus();
  }

  /** Common handling for admin function failures. Returns true if the caller should stop. */
  function adminFailed(r) {
    if (r.status === -1) return true; // already redirected to sign-in
    if (r.status === 200 && r.body) return false;
    if (r.status === 401) { toSignin('Your session expired. Please sign in again.'); return true; }
    setStatus(L.adminErrorMessage(r.status, r.body), 'err');
    return true;
  }

  $('form-search').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = L.validateSearchQuery($('in-query').value);
    if (!v.ok) { setStatus(v.error, 'err'); return; }
    guarded('search', [$('btn-search')], function () { return runSearch(v.query, true); });
  });

  async function runSearch(query, announce) {
    var mine = ++seq;
    lastQuery = query;
    if (announce) setStatus('Searching...');
    var r = await callAdmin(L.searchBody(query));
    if (mine !== seq) return;
    if (adminFailed(r)) return;
    if (announce) setStatus('');
    renderResults(r.body.users || [], query);
  }

  function renderResults(users, query) {
    var tb = $('tbl-results').tBodies[0];
    clear(tb);
    $('results').hidden = false;
    $('tbl-results').hidden = users.length === 0;
    $('results-note').textContent = users.length
      ? users.length + (users.length === 1 ? ' user' : ' users') + ' matching "' + query + '"' + (users.length >= 25 ? ' (first 25; narrow the search)' : '')
      : 'No users match "' + query + '".';
    users.forEach(function (u) {
      var eff = u.effective || { plan: 'free' };
      var viewBtn = el('button', { type: 'button', 'class': 'adm-btn adm-btn-ghost adm-btn-sm', text: 'Open' });
      viewBtn.addEventListener('click', function () {
        guarded('detail', [viewBtn], function () { return loadUser(u.id, true); });
      });
      tb.appendChild(el('tr', null, [
        td(u.email, 'adm-mono'),
        td(L.formatDate(u.created_at)),
        td(L.formatDateTime(u.last_sign_in_at)),
        td(planCell(eff.plan, eff.until, eff.source === 'grant' ? '(grant)' : '')),
        td(u.paid ? planCell(u.paid.tier, u.paid.until, u.paid.active ? '' : '(expired)') : '-'),
        td(u.activeGrant ? planCell(u.activeGrant.tier, u.activeGrant.ends_on) : '-'),
        td(viewBtn)
      ]));
    });
  }

  async function loadUser(userId, announce) {
    var mine = ++seq;
    if (announce) setStatus('Loading user...');
    var r = await callAdmin(L.getUserBody(userId));
    if (mine !== seq) return;
    if (adminFailed(r)) return;
    if (announce) setStatus('');
    renderDetail(r.body);
    $('detail').scrollIntoView({ block: 'start' });
  }

  function renderDetail(d) {
    var u = d.user;
    currentUser = { id: u.id, email: u.email };
    $('detail').hidden = false;
    $('h-detail').textContent = u.email;
    $('g-error').hidden = true;

    var eff = u.effective || { plan: 'free' };
    var dl = $('detail-summary');
    clear(dl);
    function row(k, v) { dl.appendChild(el('dt', { text: k })); var dd = el('dd'); if (v && v.nodeType) dd.appendChild(v); else dd.textContent = v == null ? '-' : String(v); dl.appendChild(dd); }
    row('Email', u.email);
    row('User ID', el('span', { 'class': 'adm-mono', text: u.id }));
    row('Created', L.formatDateTime(u.created_at));
    row('Email confirmed', u.email_confirmed_at ? L.formatDateTime(u.email_confirmed_at) : 'No');
    row('Last sign-in', L.formatDateTime(u.last_sign_in_at));
    row('Effective plan', planCell(eff.plan, eff.until, eff.source ? '(' + eff.source + ')' : ''));
    row('Paid plan', u.paid ? planCell(u.paid.tier, u.paid.until, u.paid.active ? '' : '(expired)') : 'None');
    row('Active grant', u.activeGrant ? planCell(u.activeGrant.tier, u.activeGrant.ends_on, '- ' + u.activeGrant.reason) : 'None');

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
  }

  // ---------- dialog (confirm, optionally with a required reason) ----------
  var dlg = $('dlg');
  var dlgDone = null;
  function ask(o) {
    return new Promise(function (resolve) {
      $('dlg-title').textContent = o.title;
      $('dlg-msg').textContent = o.message;
      $('dlg-reason-wrap').hidden = !o.reason;
      $('dlg-reason').value = '';
      $('dlg-error').hidden = true;
      $('dlg-ok').textContent = o.okText || 'Confirm';
      dlgDone = function (val) { dlgDone = null; if (dlg.open) dlg.close(); resolve(val); };
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      (o.reason ? $('dlg-reason') : $('dlg-ok')).focus();
    });
  }
  $('dlg-cancel').addEventListener('click', function () { if (dlgDone) dlgDone(null); });
  dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); if (dlgDone) dlgDone(null); }); // Esc
  $('dlg-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!dlgDone) return;
    if (!$('dlg-reason-wrap').hidden) {
      var v = L.validateReason($('dlg-reason').value);
      if (!v.ok) { $('dlg-error').textContent = v.error; $('dlg-error').hidden = false; return; }
      dlgDone({ reason: v.reason });
    } else dlgDone({});
  });

  // ---------- grant ----------
  Array.prototype.forEach.call(document.querySelectorAll('.adm-preset'), function (b) {
    b.addEventListener('click', function () { $('g-days').value = b.getAttribute('data-days'); });
  });
  $('g-reason').addEventListener('input', function () { $('g-count').textContent = String($('g-reason').value.length); });

  $('form-grant').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!currentUser) return;
    var target = currentUser;
    var v = L.validateGrantForm({ tier: $('g-tier').value, days: $('g-days').value, reason: $('g-reason').value });
    var ge = $('g-error');
    if (!v.ok) { ge.textContent = Object.keys(v.errors).map(function (k) { return v.errors[k]; }).join(' '); ge.hidden = false; return; }
    ge.hidden = true;
    guarded('grant', [$('btn-grant')], async function () {
      var ok = await ask({ title: 'Confirm grant', message: L.grantConfirmText(target.email, v.value), okText: 'Give plan' });
      if (!ok) return;
      setStatus('Granting...');
      var r = await callAdmin(L.grantBody(target.id, v.value));
      if (adminFailed(r)) return;
      var e = r.body.effective || {};
      setStatus('Done. ' + target.email + ' now has ' + L.tierLabel(e.plan) + (e.until ? ' until ' + L.formatDate(e.until) : '') + '.', 'ok');
      $('g-reason').value = ''; $('g-count').textContent = '0';
      await refreshAfterChange(target.id);
    });
  });

  // ---------- revoke ----------
  function onRevoke(g, btn) {
    if (!currentUser) return;
    var target = currentUser;
    guarded('revoke', [btn], async function () {
      var res = await ask({
        title: 'Revoke grant', reason: true, okText: 'Revoke',
        message: 'Revoke the ' + L.tierLabel(g.tier) + ' grant for ' + target.email + ' (until ' + L.formatDate(g.ends_on) + ')? Any paid plan stays.'
      });
      if (!res) return;
      setStatus('Revoking...');
      var r = await callAdmin(L.revokeBody(g.id, res.reason));
      if (adminFailed(r)) return;
      var e = r.body.effective || {};
      setStatus('Revoked. ' + target.email + ' is now on ' + L.tierLabel(e.plan) + (e.until ? ' until ' + L.formatDate(e.until) : '') + '.', 'ok');
      await refreshAfterChange(target.id);
    });
  }

  async function refreshAfterChange(userId) {
    await loadUser(userId, false);
    if (lastQuery) await runSearch(lastQuery, false);
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
