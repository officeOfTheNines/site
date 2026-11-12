// Member directory (members/directory.html).
// The list comes from the database function directory(), which only returns listed members and
// only includes email / phone where that member chose to show them.
(function () {
  'use strict';

  var N = window.Nines;
  var P = window.NinesPeople;
  if (!N || N.loadFailed || !P) {
    window.NinesPageLoadFailed();
    return;
  }

  var listNode = document.getElementById('directory-list');
  var loadingNode = document.getElementById('directory-loading');
  var errorNode = document.getElementById('directory-error');
  var emptyNode = document.getElementById('directory-empty');
  var noMatchNode = document.getElementById('no-matches');
  var countNode = document.getElementById('result-count');
  var search = document.getElementById('search');

  var people = []; // { person, card, key }
  var collator = new Intl.Collator('en-GB', { sensitivity: 'base' });

  // Lowercase and remove accents, so "zoe" finds "Zoë".
  function fold(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function applyFilter() {
    var q = fold(search.value.trim());
    var shown = 0;
    people.forEach(function (entry) {
      var match = !q || entry.key.indexOf(q) !== -1;
      entry.card.hidden = !match;
      if (match) shown += 1;
    });
    noMatchNode.hidden = !(people.length > 0 && shown === 0);
    countNode.textContent = q
      ? shown + (shown === 1 ? ' member matches' : ' members match')
      : people.length + (people.length === 1 ? ' member' : ' members');
  }

  async function load() {
    var result = await N.client.rpc('directory');
    if (result.error) throw result.error;
    var rows = (result.data || []).slice().sort(function (a, b) {
      return collator.compare(a.display_name || '', b.display_name || '');
    });

    var urls = {};
    try {
      urls = await P.signedPhotoUrls(rows.map(function (r) { return r.photo_path; }));
    } catch (e) {
      // Photos are optional: show initials if links cannot be made.
    }

    listNode.replaceChildren();
    people = rows.map(function (row) {
      var card = P.renderCard(row, urls[row.photo_path] || null);
      listNode.appendChild(card);
      return { person: row, card: card, key: fold(row.display_name) };
    });

    loadingNode.hidden = true;
    emptyNode.hidden = people.length > 0;
    applyFilter();
  }

  search.addEventListener('input', applyFilter);

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    N.showState('ready');
    load().catch(function (error) {
      loadingNode.hidden = true;
      errorNode.textContent = 'Could not load the directory. ' + N.friendlyError(error);
    });
  });
})();
