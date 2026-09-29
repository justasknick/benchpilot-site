(function () {
  'use strict';
  var SUPABASE_URL = 'https://uhgtlyxarozzdgdizoaz.supabase.co';
  var ANON_KEY = 'sb_publishable_pV2FThlwZ8OnVXEQqVXDJg_9mDrC2q4'; // public by design
  var $ = function (id) { return document.getElementById(id); };
  function show(id) {
    ['state-form', 'state-success', 'state-pkce', 'state-invalid'].forEach(function (s) { $(s).hidden = s !== id; });
  }

  var hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  var query = new URLSearchParams(location.search);
  var accessToken = hash.get('access_token');
  var type = hash.get('type');
  var errDesc = hash.get('error_description') || query.get('error_description');
  var hasCode = query.has('code');

  // Clear the token from the address bar and history as soon as it has been read.
  try { if (location.hash || location.search) history.replaceState(null, '', location.pathname); } catch (e) {}

  if (errDesc) {
    $('invalid-msg').textContent = errDesc.replace(/\+/g, ' ').slice(0, 200) + ' Request a new reset link from BenchPilot (Forgot password).';
    show('state-invalid');
  } else if (accessToken && (!type || type === 'recovery')) {
    show('state-form');
  } else if (hasCode) {
    show('state-pkce');
  } else {
    show('state-invalid');
  }

  function showError(msg) { var e = $('rp-error'); e.textContent = msg; e.hidden = false; }

  $('rp-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('rp-error').hidden = true;
    var p1 = $('pw1').value, p2 = $('pw2').value;
    if (p1.length < 8) return showError('Use at least 8 characters.');
    if (p1 !== p2) return showError('The two passwords do not match.');
    var btn = $('rp-submit');
    btn.disabled = true;
    fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: p1 })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, body: body || {} }; });
    }).then(function (res) {
      if (res.ok) { accessToken = null; $('pw1').value = ''; $('pw2').value = ''; show('state-success'); return; }
      var code = res.body.error_code || res.body.code;
      var msg = res.body.msg || res.body.message;
      if (code === 'same_password') showError('Choose a password different from your old one.');
      else if (code === 'weak_password') showError(msg || 'That password is too weak. Try a longer one.');
      else if (code === 'bad_jwt' || code === 'session_not_found' || code === 'session_expired' || res.body.error === 'invalid_token') show('state-invalid');
      else showError(msg || 'Could not update the password. Request a new reset link and try again.');
      btn.disabled = false;
    }).catch(function () {
      showError('Cannot reach the server. Check your internet connection and try again.');
      btn.disabled = false;
    });
  });
})();
