// assets/signin-notice.js - When a BenchPilot sign-in ends on this website by mistake, say so instead of looking like nothing happened.
// Google sign-in from the extension should return to the extension (https://<extension-id>.chromiumapp.org/). If Supabase
// does not accept that address it falls back to this site with ?code=… or #error=…, and the user is stuck
// (incident 2026-10-14). This shows a clear next step and removes the one-time code from the address bar.
(function (root) {
  'use strict';

  // Pure: what to tell the visitor for a given location. Returns '' when there is nothing to say.
  function signinNoticeFor(search, hash) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    var h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    var err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
    if (err) {
      return 'Sign-in did not finish: ' + String(err).replace(/\+/g, ' ').slice(0, 160) +
        '. Go back to BenchPilot in Chrome and try again. If it keeps happening, email us a screenshot.';
    }
    if (q.get('code') || h.get('access_token')) {
      return 'Your sign-in finished here on the website instead of in the BenchPilot extension. ' +
        'Go back to BenchPilot in Chrome and click "Continue with Google" again. ' +
        'If you land here again, email us a screenshot and we will fix it quickly.';
    }
    return '';
  }

  function show(doc, win) {
    var text = signinNoticeFor(win.location.search, win.location.hash);
    if (!text) return;
    var box = doc.createElement('div');
    box.className = 'signin-notice';
    box.setAttribute('role', 'alert');
    var p = doc.createElement('p');
    p.textContent = text;
    var a = doc.createElement('a');
    a.href = 'mailto:nicklennox30@gmail.com?subject=' + encodeURIComponent('BenchPilot sign-in problem');
    a.textContent = 'Email support';
    box.appendChild(p);
    box.appendChild(a);
    var main = doc.getElementById('main') || doc.body;
    main.insertBefore(box, main.firstChild);
    // Never leave a one-time sign-in code in the address bar (screenshots, shared links).
    try { win.history.replaceState(null, '', win.location.pathname); } catch (_) { /* ignore */ }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { signinNoticeFor: signinNoticeFor };
  if (root && root.document) show(root.document, root);
})(typeof window !== 'undefined' ? window : null);
