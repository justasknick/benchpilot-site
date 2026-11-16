(function () {
  'use strict';
  // The paid function (Razorpay's callback) redirects here and passes on only ?kind=team for a team plan payment.
  if (new URLSearchParams(location.search).get('kind') === 'team') {
    document.getElementById('solo').hidden = true;
    document.getElementById('team').hidden = false;
  }
})();
