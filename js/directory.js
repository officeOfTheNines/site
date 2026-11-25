// Member directory (members/directory.html).
// The list comes from the database function directory(), which only returns listed members and
// only includes email, phone and home address where that member chose to show them (all of them for
// the club's admins). Search covers name, occupation and other clubs. Admins can export a CSV.
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

  var club = null; // the club shown: this site's own, or the one chosen in the picker

  async function load() {
    var result = await N.client.rpc('directory', { p_club: club.id });
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
      return { person: row, card: card, key: fold([row.display_name, row.occupation].concat(row.other_clubs || []).join(' | ')) };
    });

    loadingNode.hidden = true;
    emptyNode.hidden = people.length > 0;
    applyFilter();
  }

  search.addEventListener('input', applyFilter);

  // ---- CSV export (admins only: the database gives them every field) ----
  var exportButton = document.getElementById('export-csv');
  var T = function (s) { return window.NinesI18n ? window.NinesI18n.translate(s) : s; };

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;          // keep spreadsheets from running it as a formula
    return /[",;\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function namesOf(row, relation) {
    var names = (row.relations || []).filter(function (r) { return (r.relation || 'co_brigadier') === relation; })
      .map(function (r) { return r.display_name; });
    return names.filter(function (n, i) { return names.indexOf(n) === i; }).join(', ');
  }

  function exportCsv() {
    var head = ['Number', 'Name', 'Club role', 'Occupation', 'Other clubs', 'Home address', 'Mobile', 'Email', 'Godfather', 'Godson', 'Co-brigadier'].map(T);
    var lines = [head.map(csvCell).join(';')];
    people.forEach(function (entry) {
      var r = entry.person;
      lines.push([r.member_number, r.display_name, r.club_role, r.occupation, (r.other_clubs || []).join(', '), r.address,
        r.phone ? P.formatPhone(r.phone) : '', r.email, namesOf(r, 'godfather'), namesOf(r, 'godson'), namesOf(r, 'co_brigadier')]
        .map(csvCell).join(';'));
    });
    // BOM so spreadsheet apps read accents correctly
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = N.el('a', { href: url, download: 'directory-club-' + club.id + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  if (exportButton) exportButton.addEventListener('click', exportCsv);

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    club = N.pickClub(access, false);
    N.renderClubPicker(document.getElementById('club-picker'), club);
    // (guarded: a browser can briefly pair this script with an older cached page)
    var editLink = document.getElementById('edit-profile-link');
    if (editLink) editLink.setAttribute('href', N.withClub('profile.html', club));
    if (exportButton) exportButton.hidden = club.role !== 'admin';
    if (!club.isHome) document.title = 'Directory: ' + club.name + ' · The Nines';
    N.showState('ready');
    load().catch(function (error) {
      loadingNode.hidden = true;
      errorNode.textContent = 'Could not load the directory. ' + N.friendlyError(error);
    });
  });
})();
