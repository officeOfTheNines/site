// Admin page (members/admin.html): list, add and remove allowed emails.
// The database enforces the rules too (admins only, no removing yourself, never zero admins).
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) {
    window.NinesPageLoadFailed();
    return;
  }

  var client = N.client;
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  var errorBox = document.getElementById('admin-error');
  var statusBox = document.getElementById('admin-status');
  var form = document.getElementById('add-form');
  var emailInput = document.getElementById('add-email');
  var roleSelect = document.getElementById('add-role');
  var addButton = document.getElementById('add-submit');
  var table = document.getElementById('allowlist');
  var tbody = document.getElementById('allowlist-body');
  var caption = document.getElementById('list-caption');
  var listLoading = document.getElementById('list-loading');

  var myEmail = '';
  var rows = [];

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }

  function dbError(error) {
    if (!error) return N.friendlyError(error);
    if (error.code === '23505') return 'That email is already on the list.';
    if (error.code === '42501' || /row-level security/i.test(error.message || '')) {
      return 'You do not have permission to do that. Only admins can change the list.';
    }
    if (error.code === '23514') return 'That email address does not look right.';
    return N.friendlyError(error);
  }

  function formatDate(value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d) ? '' : dateFormat.format(d);
  }

  function render() {
    var el = N.el;
    var adminCount = rows.filter(function (r) { return r.role === 'admin'; }).length;
    tbody.replaceChildren();

    rows.forEach(function (row) {
      var isMe = row.email === myEmail;
      var isLastAdmin = row.role === 'admin' && adminCount <= 1;
      var reason = isMe ? 'You cannot remove yourself.' : (isLastAdmin ? 'The last admin cannot be removed.' : '');

      var removeButton = el('button', {
        type: 'button',
        className: 'button danger',
        'aria-label': 'Remove ' + row.email,
        'aria-disabled': reason ? 'true' : null,
        title: reason || null,
        text: 'Remove'
      });
      removeButton.addEventListener('click', function () {
        if (reason) { showError(reason); return; }
        removeEmail(row.email, removeButton);
      });

      var emailCell = el('td', { className: 'email', 'data-label': 'Email' }, [row.email]);
      if (isMe) emailCell.appendChild(el('span', { className: 'muted', text: ' (you)' }));

      tbody.appendChild(el('tr', null, [
        emailCell,
        el('td', { 'data-label': 'Role', text: row.role === 'admin' ? 'Admin' : 'Member' }),
        el('td', { 'data-label': 'Added by', text: row.added_by || '—' }),
        el('td', { 'data-label': 'Added on', text: formatDate(row.added_on) || '—' }),
        el('td', { className: 'actions-cell' }, [removeButton])
      ]));
    });

    var memberCount = rows.length - adminCount;
    caption.textContent = rows.length + (rows.length === 1 ? ' email' : ' emails') +
      ' (' + adminCount + (adminCount === 1 ? ' admin' : ' admins') + ', ' +
      memberCount + (memberCount === 1 ? ' member' : ' members') + ')';
    listLoading.hidden = true;
    table.hidden = false;
  }

  async function loadList() {
    var result = await client
      .from('allowed_emails')
      .select('email, role, added_by, added_on')
      .order('role', { ascending: true })
      .order('email', { ascending: true });
    if (result.error) { showError(dbError(result.error)); listLoading.textContent = 'Could not load the list.'; return; }
    rows = result.data || [];
    render();
  }

  async function removeEmail(email, button) {
    if (!window.confirm('Remove ' + email + ' from the member list? They will lose access straight away.')) return;
    button.disabled = true;
    showError('');
    var result = await client.from('allowed_emails').delete().eq('email', email).select('email');
    button.disabled = false;
    if (result.error) { showError(dbError(result.error)); await loadList(); return; }
    if (!result.data || result.data.length === 0) {
      showError('Could not remove ' + email + '. It may already have been removed.');
    } else {
      showStatus(email + ' was removed.');
    }
    await loadList();
    refreshProfiles();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var email = emailInput.value.trim().toLowerCase();
    var role = roleSelect.value === 'admin' ? 'admin' : 'member';

    if (!EMAIL_RE.test(email)) {
      showError('Please enter a valid email address, like name@example.com.');
      emailInput.focus();
      return;
    }
    if (rows.some(function (r) { return r.email === email; })) {
      showError('That email is already on the list.');
      emailInput.focus();
      return;
    }

    addButton.disabled = true;
    showError('');
    // added_by and added_on are filled in by the database.
    var result = await client.from('allowed_emails').insert({ email: email, role: role }).select('email');
    addButton.disabled = false;
    if (result.error) { showError(dbError(result.error)); return; }
    showStatus(email + ' was added as ' + (role === 'admin' ? 'an admin' : 'a member') + '.');
    emailInput.value = '';
    roleSelect.value = 'member';
    emailInput.focus();
    await loadList();
  });

  // ---- Member profiles: edit any profile, hide or show someone in the directory ----

  var profilesError = document.getElementById('profiles-error');
  var profilesStatus = document.getElementById('profiles-status');
  var profilesLoading = document.getElementById('profiles-loading');
  var profilesEmpty = document.getElementById('profiles-empty');
  var profilesTable = document.getElementById('profiles-table');
  var profilesBody = document.getElementById('profiles-body');
  var profilesCaption = document.getElementById('profiles-caption');
  var collator = new Intl.Collator('en-GB', { sensitivity: 'base' });

  function showProfilesError(text) { profilesStatus.textContent = ''; profilesError.textContent = text || ''; }
  function showProfilesStatus(text) { profilesError.textContent = ''; profilesStatus.textContent = text || ''; }

  async function loadProfiles() {
    var members = await client.from('members').select('id, display_name, email, user_id, last_login');
    if (members.error) throw members.error;
    var profiles = await client.from('profiles').select('member_id, listed, updated_on');
    if (profiles.error) throw profiles.error;

    var byId = {};
    (profiles.data || []).forEach(function (p) { byId[p.member_id] = p; });
    var list = (members.data || []).map(function (m) {
      return { member: m, profile: byId[m.id] || null };
    }).sort(function (a, b) {
      return collator.compare(a.member.display_name || a.member.email || '', b.member.display_name || b.member.email || '');
    });

    renderProfiles(list);
  }

  function renderProfiles(list) {
    var el = N.el;
    profilesBody.replaceChildren();
    var hidden = 0;

    list.forEach(function (entry) {
      var m = entry.member;
      var p = entry.profile;
      var isListed = !p || p.listed !== false;
      if (!isListed) hidden += 1;
      var name = m.display_name || m.email || 'Member';

      var edit = el('a', {
        className: 'button secondary',
        href: 'profile.html?member=' + encodeURIComponent(m.id),
        'aria-label': 'Edit profile of ' + name,
        text: 'Edit'
      });
      var toggle = el('button', {
        type: 'button',
        className: 'button secondary',
        'aria-label': (isListed ? 'Hide ' : 'Show ') + name + (isListed ? ' from' : ' in') + ' the directory',
        text: isListed ? 'Hide' : 'Show'
      });
      toggle.addEventListener('click', function () { setListed(m, p, !isListed, toggle); });

      profilesBody.appendChild(el('tr', null, [
        el('td', { 'data-label': 'Name', text: name }),
        el('td', { className: 'email', 'data-label': 'Email', text: m.email || '' }),
        el('td', { 'data-label': 'Signed in', text: m.user_id ? (formatDate(m.last_login) || 'Yes') : 'Not yet' }),
        el('td', { 'data-label': 'Profile', text: p ? 'Filled in' : 'Not yet' }),
        el('td', { 'data-label': 'Directory', text: isListed ? 'Listed' : 'Hidden' }),
        el('td', { className: 'actions-cell' }, [el('div', { className: 'row-actions' }, [edit, toggle])])
      ]));
    });

    var notSignedIn = list.filter(function (e) { return !e.member.user_id; }).length;
    var notes = [];
    if (notSignedIn) notes.push(notSignedIn + ' not signed in yet');
    if (hidden) notes.push(hidden + ' hidden from the directory');
    profilesCaption.textContent = list.length + (list.length === 1 ? ' directory entry' : ' directory entries') +
      (notes.length ? ' (' + notes.join(', ') + ')' : '');
    profilesLoading.hidden = true;
    profilesEmpty.hidden = list.length > 0;
    profilesTable.hidden = list.length === 0;
  }

  async function setListed(member, profile, value, button) {
    button.disabled = true;
    showProfilesError('');
    var result = profile
      ? await client.from('profiles').update({ listed: value }).eq('member_id', member.id).select('member_id')
      : await client.from('profiles').insert({ member_id: member.id, listed: value }).select('member_id');
    button.disabled = false;
    var name = member.display_name || member.email;
    if (result.error || !result.data || result.data.length !== 1) {
      showProfilesError('Could not update ' + name + '. ' + (result.error ? dbError(result.error) : 'Please reload and try again.'));
    } else {
      showProfilesStatus(name + (value ? ' is now listed in the directory.' : ' is now hidden from the directory.'));
    }
    refreshProfiles();
  }

  // ---- Add a member to the directory (before they have signed in) ----

  var newForm = document.getElementById('new-member-form');
  var newEmail = document.getElementById('new-member-email');
  var newName = document.getElementById('new-member-name');
  var newSubmit = document.getElementById('new-member-submit');

  newForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var email = newEmail.value.trim().toLowerCase();
    var name = newName.value.trim();
    if (!EMAIL_RE.test(email)) { showProfilesError('Please enter a valid email address.'); newEmail.focus(); return; }
    if (!name) { showProfilesError('Please enter a display name.'); newName.focus(); return; }
    if (name.length > 80) { showProfilesError('Please keep the display name to 80 characters or fewer.'); newName.focus(); return; }

    newSubmit.disabled = true;
    showProfilesError('');
    try {
      // 1. make sure the email is on the member list (as a member)
      if (!rows.some(function (r) { return r.email === email; })) {
        var allow = await client.from('allowed_emails').insert({ email: email, role: 'member' });
        if (allow.error && allow.error.code !== '23505') throw allow.error;
      }
      // 2. create the directory entry, then open it in the profile editor
      var created = await client.from('members').insert({ email: email, display_name: name }).select('id').single();
      if (created.error) {
        if (created.error.code === '23505') {
          var existing = await client.from('members').select('id').eq('email', email).maybeSingle();
          showProfilesError(email + ' already has a directory entry.');
          if (existing.data) {
            profilesError.appendChild(document.createTextNode(' '));
            profilesError.appendChild(N.el('a', { href: 'profile.html?member=' + encodeURIComponent(existing.data.id), text: 'Edit it' }));
          }
          await loadList();
          return;
        }
        throw created.error;
      }
      window.location.href = 'profile.html?member=' + encodeURIComponent(created.data.id) + '&new=1';
    } catch (error) {
      showProfilesError('Could not add ' + email + '. ' + dbError(error));
      await loadList();
    } finally {
      newSubmit.disabled = false;
    }
  });

  function refreshProfiles() {
    return loadProfiles().catch(function (error) {
      profilesLoading.hidden = true;
      showProfilesError('Could not load member profiles. ' + dbError(error));
    });
  }

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    if (access.role !== 'admin') { N.showState('not-admin'); return; }
    myEmail = (access.session.user.email || '').toLowerCase();
    N.showState('ready');
    loadList();
    refreshProfiles();
  });
})();
