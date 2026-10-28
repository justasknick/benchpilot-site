// website/goodbye.html: the page Chrome opens after BenchPilot is removed (chrome.runtime.setUninstallURL, 26 Oct 2026).
// Sends one anonymous "idea" report to the feedback function: the chosen reason, the optional text and the source.
// Only the version number from the link (?v=1.13.0) goes with it. No cookies, no ids, no email.
(function () {
  'use strict';
  var URL_ = 'https://uhgtlyxarozzdgdizoaz.supabase.co/functions/v1/feedback';
  var KEY = 'sb_publishable_pV2FThlwZ8OnVXEQqVXDJg_9mDrC2q4';   // the public (publishable) key, the same one the extension ships
  var $ = function (id) { return document.getElementById(id); };
  function messageOf(why, keep, heard) {
    var parts = ['Uninstall: ' + why];
    if (keep) parts.push('Would have kept it if: ' + keep);
    if (heard) parts.push('Heard from: ' + heard);
    return parts.join(' | ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 1900);
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { messageOf: messageOf }; return; }

  var v = (new URLSearchParams(location.search).get('v') || '').trim();
  var version = /^\d+(?:\.\d+){1,3}$/.test(v) ? v : '';

  $('bye').addEventListener('submit', function (e) {
    e.preventDefault();
    var picked = document.querySelector('input[name="why"]:checked');
    if (!picked) { $('bye-msg').textContent = 'Please pick a reason first.'; return; }
    $('bye-send').disabled = true;
    $('bye-msg').textContent = 'Sending…';
    var body = { kind: 'idea', message: messageOf(picked.value, $('keep').value.trim(), $('heard').value), context: version ? { surface: 'uninstall', version: version } : { surface: 'uninstall' } };
    fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        $('bye').hidden = true;
        $('bye-done').hidden = false;
      })
      .catch(function () {
        $('bye-send').disabled = false;
        $('bye-msg').textContent = 'Could not send just now. Please try again in a minute.';
      });
  });
})();
