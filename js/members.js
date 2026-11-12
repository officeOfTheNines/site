// Member home (members/index.html).
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) {
    window.NinesPageLoadFailed();
    return;
  }

  N.guardMembersPage().then(async function (access) {
    if (!access) return;
    N.showState('ready');

    // A gentle prompt for members who have not saved a profile yet.
    if (!access.member) return;
    var result = await N.client
      .from('profiles')
      .select('member_id')
      .eq('member_id', access.member.id)
      .maybeSingle();
    if (!result.error && !result.data) {
      document.getElementById('profile-prompt').hidden = false;
    }
  });
})();
