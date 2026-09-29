(function () {
  'use strict';
  // Supabase reports problems as error_description in the URL hash or query string.
  var params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  new URLSearchParams(location.search).forEach(function (v, k) { if (!params.has(k)) params.set(k, v); });
  var desc = params.get('error_description') || params.get('error');
  if (desc) {
    document.getElementById('ok').hidden = true;
    document.getElementById('err').hidden = false;
    document.getElementById('errmsg').textContent = desc.replace(/\+/g, ' ').slice(0, 200);
  }
  // Never leave tokens in the address bar.
  try { if (location.hash || location.search) history.replaceState(null, '', location.pathname); } catch (e) {}
})();
