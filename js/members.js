// Member home (members/index.html).
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) {
    window.NinesPageLoadFailed();
    return;
  }

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    N.showState('ready');

    // A gentle prompt until the member has saved their profile themselves at least once.
    if (access.profile && !access.profile.member_updated_on) {
      document.getElementById('profile-prompt').hidden = false;
    }
  });
})();
