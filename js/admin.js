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

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    if (access.role !== 'admin') { N.showState('not-admin'); return; }
    myEmail = (access.session.user.email || '').toLowerCase();
    N.showState('ready');
    loadList();
  });
})();
