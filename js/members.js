// Member home (members/index.html).
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) {
    window.NinesPageLoadFailed();
    return;
  }

  N.guardMembersPage().then(function (access) {
    if (access) N.showState('ready');
  });
})();
