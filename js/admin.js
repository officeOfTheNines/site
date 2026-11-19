// Admin page (members/admin.html).
//   Add a member  -> admin_add_member(): access + directory card in one step
//   Access        -> the allowlist; Remove asks whether to hide the card too (admin_remove_access())
//   Cards         -> every profile: edit, hide/show, delete (with confirmation)
// The database enforces all of this too (admins only, not yourself, never zero admins).
(function () {
  'use strict';

  var N = window.Nines;
  var P = window.NinesPeople;
  if (!N || N.loadFailed || !P) {
    window.NinesPageLoadFailed();
    return;
  }

  var client = N.client;
  var el = N.el;
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var dateFormat = new Intl.DateTimeFormat(N.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  var collator = new Intl.Collator('en-GB', { sensitivity: 'base' });

  var errorBox = document.getElementById('admin-error');
  var statusBox = document.getElementById('admin-status');

  var addForm = document.getElementById('add-form');
  var addEmail = document.getElementById('add-email');
  var addName = document.getElementById('add-name');
  var addRole = document.getElementById('add-role');
  var addListed = document.getElementById('add-listed');
  var addForeign = document.getElementById('add-foreign');
  var addNoCard = document.getElementById('add-nocard');
  var addSubmit = document.getElementById('add-submit');

  var accessLoading = document.getElementById('access-loading');
  var accessTable = document.getElementById('access-table');
  var accessBody = document.getElementById('access-body');
  var accessCaption = document.getElementById('access-caption');

  var cardsLoading = document.getElementById('cards-loading');
  var cardsEmpty = document.getElementById('cards-empty');
  var cardsTable = document.getElementById('cards-table');
  var cardsBody = document.getElementById('cards-body');
  var cardsCaption = document.getElementById('cards-caption');

  var removeDialog = document.getElementById('remove-dialog');
  var removeEmailNode = document.getElementById('remove-email');
  var removeHide = document.getElementById('remove-hide');
  var removeHideRow = document.getElementById('remove-hide-row');
  var deleteDialog = document.getElementById('delete-dialog');
  var deleteNameNode = document.getElementById('delete-name');
  var deleteNotes = document.getElementById('delete-notes');
  var club = null;   // the club this page manages: this site's, or one chosen in the picker
  var clubId = null;

  var groupsLoading = document.getElementById('groups-loading');
  var groupsEmpty = document.getElementById('groups-empty');
  var groupsList = document.getElementById('groups-list');
  var groupForm = document.getElementById('group-form');
  var groupFormTitle = document.getElementById('group-form-title');
  var groupSelects = Array.prototype.slice.call(document.querySelectorAll('.group-member'));
  var groupSubmit = document.getElementById('group-submit');
  var groupCancel = document.getElementById('group-cancel');
  var groupDeleteDialog = document.getElementById('group-delete-dialog');
  var groupDeleteName = document.getElementById('group-delete-name');

  var emailDialog = document.getElementById('email-dialog');
  var emailOld = document.getElementById('email-old');
  var emailNew = document.getElementById('email-new');
  var emailError = document.getElementById('email-error');
  var emailConfirm = document.getElementById('email-confirm');

  var myEmail = '';
  var groups = [];   // [{ id, memberIds: [profile ids] }]
  var editingGroupId = null;
  var access = [];   // this club's club_access rows
  var cards = [];    // profiles rows

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }

  function dbError(error) {
    if (!error) return N.friendlyError(error);
    var msg = String(error.message || '');
    if (error.code === '23505') return 'That email already exists.';
    if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
      return 'You do not have permission to do that. Only admins can change members.';
    }
    if (error.code === '23514' || /check constraint/i.test(msg)) {
      if (/display_name/.test(msg)) return 'Please enter a display name of 1 to 80 characters.';
      return 'That email address does not look right.';
    }
    return N.friendlyError(error);
  }

  function formatDate(value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d) ? '' : dateFormat.format(d);
  }

  // Opens a <dialog> and resolves true when the admin confirms.
  function confirmDialog(dialog) {
    return new Promise(function (resolve) {
      function done() {
        dialog.removeEventListener('close', done);
        resolve(dialog.returnValue === 'confirm');
      }
      dialog.returnValue = '';
      dialog.addEventListener('close', done);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.returnValue = window.confirm(dialog.textContent.replace(/\s+/g, ' ').trim()) ? 'confirm' : 'cancel';
        done();
      }
    });
  }

  // ---- Loading ----

  async function loadAll() {
    // everything below is for this site's club only
    var a = await client.from('club_access').select('email, role, added_by, added_on, needs_profile')
      .eq('club_id', clubId)
      .order('role', { ascending: true }).order('email', { ascending: true });
    if (a.error) throw a.error;
    var c = await client.from('club_profiles')
      .select('listed, foreign_member, override_photo_path, profiles(id, email, member_id, display_name, photo_path)')
      .eq('club_id', clubId);
    if (c.error) throw c.error;
    var m = await client.from('members').select('id, last_login');
    if (m.error) throw m.error;
    var g = await client.from('brigadier_groups').select('id').eq('club_id', clubId).order('id', { ascending: true });
    if (g.error) throw g.error;
    var groupIds = (g.data || []).map(function (row) { return row.id; });
    var gm = groupIds.length
      ? await client.from('brigadier_group_members').select('group_id, profile_id').in('group_id', groupIds)
      : { data: [], error: null };
    if (gm.error) throw gm.error;
    groups = (g.data || []).map(function (row) {
      return {
        id: row.id,
        memberIds: (gm.data || []).filter(function (x) { return x.group_id === row.id; }).map(function (x) { return x.profile_id; })
      };
    });

    var lastLogin = {};
    (m.data || []).forEach(function (row) { lastLogin[row.id] = row.last_login; });
    access = a.data || [];
    cards = (c.data || []).filter(function (row) { return row.profiles; }).map(function (row) {
      var p = row.profiles;
      return {
        id: p.id, email: p.email, member_id: p.member_id, display_name: p.display_name, photo_path: p.photo_path,
        override_photo_path: row.override_photo_path,
        listed: row.listed, foreign_member: row.foreign_member,
        last_login: p.member_id ? lastLogin[p.member_id] : null
      };
    }).sort(function (x, y) { return collator.compare(x.display_name || '', y.display_name || ''); });

    renderAccess();
    renderCards();
    renderGroups();
  }

  function refresh() {
    return loadAll().catch(function (error) {
      accessLoading.hidden = true;
      cardsLoading.hidden = true;
      groupsLoading.hidden = true;
      showError('Could not load members. ' + dbError(error));
    });
  }

  function accessRow(email) {
    return access.find(function (r) { return r.email === email; }) || null;
  }

  function roleOf(email) {
    var row = access.find(function (r) { return r.email === email; });
    return row ? row.role : null;
  }

  // ---- Access table ----

  function renderAccess() {
    var admins = access.filter(function (r) { return r.role === 'admin'; }).length;
    var cardByEmail = {};
    cards.forEach(function (c) { cardByEmail[c.email] = c; });
    accessBody.replaceChildren();

    access.forEach(function (row) {
      var isMe = row.email === myEmail;
      var isLastAdmin = row.role === 'admin' && admins <= 1;
      var reason = isMe ? 'You cannot remove yourself.' : (isLastAdmin ? 'The last admin cannot be removed.' : '');

      var remove = el('button', {
        type: 'button',
        className: 'button danger',
        'aria-label': 'Remove access for ' + row.email,
        'aria-disabled': reason ? 'true' : null,
        title: reason || null,
        text: 'Remove'
      });
      remove.addEventListener('click', function () {
        if (reason) { showError(reason); return; }
        removeAccess(row.email, remove);
      });
      var changeEmail = makeChangeEmailButton(row.email, isMe);

      var card = cardByEmail[row.email];
      var cardCell;
      if (card) {
        cardCell = el('td', { 'data-label': 'Card', text: card.listed ? 'Listed' : 'Hidden' });
      } else {
        var create = el('button', { type: 'button', className: 'button secondary', 'aria-label': 'Create a card for ' + row.email, text: 'Create card' });
        create.addEventListener('click', function () {
          addEmail.value = row.email;
          addRole.value = row.role;
          addName.value = '';
          addNoCard.checked = false;
          syncNoCard();
          addName.focus();
          showStatus('Type a display name for ' + row.email + ' and press "Add member" to create their card.');
        });
        var cellChildren = [];
        if (row.needs_profile === false) {
          cellChildren.push(el('span', { className: 'muted', text: 'No card (office/staff) ' }));
          cellChildren.push(create);
        } else {
          var noCard = el('button', { type: 'button', className: 'button secondary', 'aria-label': 'No card needed for ' + row.email, text: 'No card' });
          noCard.addEventListener('click', function () { setNeedsProfile(row.email, false, noCard); });
          cellChildren.push(el('div', { className: 'row-actions' }, [create, noCard]));
        }
        cardCell = el('td', { 'data-label': 'Card' }, cellChildren);
      }

      var emailCell = el('td', { className: 'email', 'data-label': 'Email' }, [row.email]);
      if (isMe) emailCell.appendChild(el('span', { className: 'muted', text: ' (you)' }));

      accessBody.appendChild(el('tr', null, [
        emailCell,
        el('td', { 'data-label': 'Role', text: row.role === 'admin' ? 'Admin' : 'Member' }),
        el('td', { 'data-label': 'Added by', text: row.added_by || '—' }),
        el('td', { 'data-label': 'Added on', text: formatDate(row.added_on) || '—' }),
        cardCell,
        el('td', { className: 'actions-cell' }, [el('div', { className: 'row-actions' }, [changeEmail, remove])])
      ]));
    });

    accessCaption.textContent = access.length + (access.length === 1 ? ' email' : ' emails') +
      ' (' + admins + (admins === 1 ? ' admin' : ' admins') + ')';
    accessLoading.hidden = true;
    accessTable.hidden = false;
  }

  async function removeAccess(email, button) {
    var card = cards.find(function (c) { return c.email === email; });
    removeEmailNode.textContent = email;
    removeHide.checked = true;
    removeHideRow.hidden = !card || !card.listed;
    if (!(await confirmDialog(removeDialog))) return;

    button.disabled = true;
    showError('');
    var hide = !!card && card.listed && removeHide.checked;
    var result = await client.rpc('admin_remove_access', { p_club: clubId, p_email: email, p_hide: hide });
    button.disabled = false;
    if (result.error) { showError(dbError(result.error)); await refresh(); return; }
    var note = '';
    if (card && hide) note = ' Their card is hidden.';
    else if (card && card.listed) note = ' Their card is still listed, marked "Former member".';
    showStatus(email + ' can no longer sign in.' + note);
    await refresh();
  }

  async function setNeedsProfile(email, value, button) {
    button.disabled = true;
    showError('');
    var result = await client.from('club_access').update({ needs_profile: value })
      .eq('club_id', clubId).eq('email', email).select('email');
    button.disabled = false;
    if (result.error || !result.data || result.data.length !== 1) {
      showError('Could not update ' + email + '. ' + (result.error ? dbError(result.error) : 'Please reload and try again.'));
    } else {
      showStatus(value ? email + ' will get a card when they next sign in.' : email + ' is marked as an office/staff account: no card will be created for it.');
    }
    await refresh();
  }

  // ---- Add a member ----

  // "No directory card" turns the card fields off.
  function syncNoCard() {
    var off = addNoCard.checked;
    [addName, addListed, addForeign].forEach(function (input) { input.disabled = off; });
    addName.required = !off;
  }
  addNoCard.addEventListener('change', syncNoCard);

  addForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var email = addEmail.value.trim().toLowerCase();
    var name = addName.value.trim();
    var noCard = addNoCard.checked;
    var existingCard = cards.find(function (c) { return c.email === email; });

    if (!EMAIL_RE.test(email)) { showError('Please enter a valid email address, like name@example.com.'); addEmail.focus(); return; }
    if (!noCard && !name && !existingCard) { showError('Please enter a display name.'); addName.focus(); return; }
    if (name.length > 80) { showError('Please keep the display name to 80 characters or fewer.'); addName.focus(); return; }
    if (existingCard && roleOf(email)) {
      showError(email + ' already has access and a card. Use "Edit" in the cards list to change it.');
      return;
    }
    if (noCard && roleOf(email)) {
      showError(email + ' already has access. Use "No card" in the Access table instead.');
      return;
    }

    addSubmit.disabled = true;
    showError('');
    var result = await client.rpc('admin_add_member', {
      p_club: clubId,
      p_email: email,
      p_display_name: name || (existingCard && existingCard.display_name) || email.split('@')[0],
      p_role: addRole.value === 'admin' ? 'admin' : 'member',
      p_listed: addListed.checked,
      p_foreign: addForeign.checked,
      p_needs_profile: !noCard
    });
    addSubmit.disabled = false;
    if (result.error) { showError('Could not add ' + email + '. ' + dbError(result.error)); await refresh(); return; }

    if (noCard) {
      showStatus(email + ' now has access as ' + (addRole.value === 'admin' ? 'an admin' : 'a member') +
        ', with no directory card.' + (existingCard ? ' Their existing card was kept; delete it below if it is not wanted.' : ''));
      addForm.reset();
      addListed.checked = true;
      syncNoCard();
      await refresh();
      return;
    }

    if (existingCard) {
      showStatus('Access restored for ' + email + '. Their existing card was kept' + (addListed.checked ? ' and is listed.' : ' and is hidden.'));
      addForm.reset();
      addListed.checked = true;
      syncNoCard();
      await refresh();
      return;
    }
    window.location.href = N.withClub('profile.html?profile=' + encodeURIComponent(result.data) + '&new=1', club);
  });

  // ---- Directory cards ----

  function renderCards() {
    cardsBody.replaceChildren();
    var hidden = 0;
    var noAccess = 0;

    cards.forEach(function (card) {
      var role = roleOf(card.email);
      if (!card.listed) hidden += 1;
      if (!role) noAccess += 1;
      var name = card.display_name || card.email;

      var edit = el('a', {
        className: 'button secondary',
        href: N.withClub('profile.html?profile=' + encodeURIComponent(card.id), club),
        'aria-label': 'Edit the card of ' + name,
        text: 'Edit'
      });
      var toggle = el('button', {
        type: 'button',
        className: 'button secondary',
        'aria-label': (card.listed ? 'Hide ' : 'Show ') + name + (card.listed ? ' from' : ' in') + ' the directory',
        text: card.listed ? 'Hide' : 'Show'
      });
      toggle.addEventListener('click', function () { setListed(card, !card.listed, toggle); });
      var del = el('button', { type: 'button', className: 'button danger', 'aria-label': 'Remove ' + name + ' from the club', text: 'Remove from club' });
      if (card.email === myEmail) {
        del.setAttribute('aria-disabled', 'true');
        del.title = 'You cannot remove yourself.';
      }
      del.addEventListener('click', function () {
        if (card.email === myEmail) { showError('You cannot remove yourself. Ask another admin.'); return; }
        removeFromClub(card, del);
      });
      var rowButtons = [edit, toggle, del];
      // people without access are not in the Access table, so offer it here
      if (!role) rowButtons.splice(1, 0, makeChangeEmailButton(card.email, false));

      var directory = card.listed ? 'Listed' : 'Hidden';
      if (card.foreign_member) directory += ', foreign';

      cardsBody.appendChild(el('tr', null, [
        el('td', { 'data-label': 'Name', text: name }),
        el('td', { className: 'email', 'data-label': 'Email', text: card.email }),
        el('td', { 'data-label': 'Access', text: role === 'admin' ? 'Admin' : (role ? 'Member' : 'No access') }),
        el('td', { 'data-label': 'Signed in', text: card.member_id ? (formatDate(card.last_login) || 'Yes') : 'Not yet' }),
        el('td', { 'data-label': 'Directory', text: directory }),
        el('td', { className: 'actions-cell' }, [el('div', { className: 'row-actions' }, rowButtons)])
      ]));
    });

    var notes = [];
    if (hidden) notes.push(hidden + ' hidden');
    if (noAccess) notes.push(noAccess + ' without access');
    cardsCaption.textContent = cards.length + (cards.length === 1 ? ' card' : ' cards') + (notes.length ? ' (' + notes.join(', ') + ')' : '');
    cardsLoading.hidden = true;
    cardsEmpty.hidden = cards.length > 0;
    cardsTable.hidden = cards.length === 0;
  }

  async function setListed(card, value, button) {
    button.disabled = true;
    showError('');
    var result = await client.from('club_profiles').update({ listed: value })
      .eq('club_id', clubId).eq('profile_id', card.id).select('profile_id');
    button.disabled = false;
    var name = card.display_name || card.email;
    if (result.error || !result.data || result.data.length !== 1) {
      showError('Could not update ' + name + '. ' + (result.error ? dbError(result.error) : 'Please reload and try again.'));
    } else {
      showStatus(name + (value ? ' is now listed in the directory.' : ' is now hidden from the directory.'));
    }
    await refresh();
  }

  // "Remove from club": deletes this club's access, card and brigadier places for the person.
  // The database says first what else would happen, so the admin confirms it knowingly:
  // groups left with fewer than two members, and whether the person then belongs to no club.
  async function removeFromClub(card, button) {
    var name = card.display_name || card.email;
    button.disabled = true;
    showError('');
    var preview = await client.rpc('admin_remove_from_club_preview', { p_club: clubId, p_email: card.email });
    button.disabled = false;
    if (preview.error) { showError('Could not check ' + name + '. ' + dbError(preview.error)); return; }
    var info = (preview.data && preview.data[0]) || { small_group_ids: [], deletes_profile: false, photo_path: null };
    var small = info.small_group_ids || [];

    deleteNameNode.textContent = name + ' (' + card.email + ')';
    deleteNotes.replaceChildren();
    if (small.length) {
      deleteNotes.appendChild(el('li', { text: 'Brigadier group ' + small.join(', ') + ' would be left with fewer than two members, so ' + (small.length === 1 ? 'it' : 'they') + ' will be deleted too.' }));
    }
    if (info.deletes_profile) {
      deleteNotes.appendChild(el('li', { text: 'They are in no other club, so their profile, photo and sign-in record are deleted as well.' }));
    } else {
      deleteNotes.appendChild(el('li', { text: 'They stay in their other club(s), with their profile and photo.' }));
    }
    if (!(await confirmDialog(deleteDialog))) return;

    button.disabled = true;
    try {
      // photos first: once the card is gone, the admin may no longer be allowed to delete them
      if (card.override_photo_path) await P.removeClubPhoto(card.id, clubId);
      if (info.deletes_profile && info.photo_path) await P.removePhoto(card.id);
      var result = await client.rpc('admin_remove_from_club', { p_club: clubId, p_email: card.email, p_delete_small_groups: small.length > 0 });
      if (result.error) throw result.error;
      showStatus(name + ' was removed from ' + club.name + '.' + (small.length ? ' Brigadier group ' + small.join(', ') + ' was deleted.' : ''));
    } catch (error) {
      showError('Could not remove ' + name + '. ' + (error.message || dbError(error)));
    } finally {
      button.disabled = false;
      await refresh();
    }
  }

  // ---- Change email ----

  function makeChangeEmailButton(email, isMe) {
    var button = el('button', {
      type: 'button',
      className: 'button secondary',
      'aria-label': 'Change email ' + email,
      'aria-disabled': isMe ? 'true' : null,
      title: isMe ? 'Ask another admin to change your own email.' : null,
      text: 'Change email'
    });
    button.addEventListener('click', function () {
      if (isMe) { showError('You cannot change your own email here. Ask another admin.'); return; }
      changeEmail(email, button);
    });
    return button;
  }

  // Keeps the dialog open until the new email is valid (or the admin cancels).
  emailDialog.addEventListener('close', function () { emailError.textContent = ''; });
  emailConfirm.addEventListener('click', function (event) {
    var value = emailNew.value.trim().toLowerCase();
    var problem = !EMAIL_RE.test(value) ? 'Please enter a valid email address.'
      : (value === emailOld.textContent ? 'That is the same email.'
      : (access.some(function (r) { return r.email === value; }) || cards.some(function (c) { return c.email === value; })
        ? 'That email is already used by someone else.' : ''));
    if (problem) {
      event.preventDefault();
      emailError.textContent = problem;
      emailNew.focus();
    }
  });

  async function changeEmail(oldEmail, button) {
    emailOld.textContent = oldEmail;
    emailNew.value = '';
    emailError.textContent = '';
    var opened = confirmDialog(emailDialog);
    emailNew.focus();
    if (!(await opened)) return;
    var newEmail = emailNew.value.trim().toLowerCase();

    button.disabled = true;
    showError('');
    var result = await client.rpc('admin_change_email', { p_old_email: oldEmail, p_new_email: newEmail });
    button.disabled = false;
    if (result.error) {
      showError('Could not change ' + oldEmail + '. ' + (result.error.code === '23505'
        ? 'The new email is already used by someone else.' : (result.error.message || dbError(result.error))));
    } else {
      showStatus(oldEmail + ' is now ' + newEmail + '. Ask them to sign in with the new email; their card links to them automatically.');
    }
    await refresh();
  }

  // ---- Brigadier groups ----

  function cardName(id) {
    var card = cards.find(function (c) { return c.id === id; });
    return card ? (card.display_name || card.email) : 'Deleted card';
  }

  function groupsOf(profileId) {
    return groups.filter(function (g) { return g.memberIds.indexOf(profileId) !== -1; }).map(function (g) { return g.id; });
  }

  function groupLabel(group) {
    var names = group.memberIds.map(cardName).sort(function (a, b) { return collator.compare(a, b); });
    return names.length ? P.joinNames(names) : '(no members)';
  }

  function renderGroups() {
    groupsList.replaceChildren();
    groups.forEach(function (group) {
      var label = groupLabel(group);
      var edit = el('button', { type: 'button', className: 'button secondary', 'aria-label': 'Edit group ' + group.id + ': ' + label, text: 'Edit' });
      edit.addEventListener('click', function () { startEditGroup(group); });
      var del = el('button', { type: 'button', className: 'button danger', 'aria-label': 'Delete group ' + group.id + ': ' + label, text: 'Delete' });
      del.addEventListener('click', function () { deleteGroup(group, label, del); });
      groupsList.appendChild(el('li', null, [
        el('span', null, [el('span', { className: 'group-number', text: 'Group ' + group.id }), label]),
        el('span', { className: 'row-actions' }, [edit, del])
      ]));
    });
    groupsLoading.hidden = true;
    groupsEmpty.hidden = groups.length > 0;
    groupsList.hidden = groups.length === 0;
    fillGroupSelects();
  }

  // Each select lists every card; people already in another group are marked, not blocked.
  function fillGroupSelects() {
    var chosen = groupSelects.map(function (s) { return s.value; });
    groupSelects.forEach(function (select, index) {
      select.replaceChildren(el('option', { value: '', text: index === 2 ? 'No third member' : 'Choose a member' }));
      cards.forEach(function (card) {
        var others = groupsOf(card.id).filter(function (id) { return id !== editingGroupId; });
        var text = (card.display_name || card.email) + (others.length ? ' (in group ' + others.join(', ') + ')' : '');
        select.appendChild(el('option', { value: card.id, text: text }));
      });
      select.value = chosen[index] || '';
    });
  }

  function resetGroupForm() {
    editingGroupId = null;
    groupSelects.forEach(function (s) { s.value = ''; });
    groupFormTitle.textContent = 'New brigadier group';
    groupSubmit.textContent = 'Create group';
    groupCancel.hidden = true;
    fillGroupSelects();
  }

  function startEditGroup(group) {
    editingGroupId = group.id;
    fillGroupSelects();
    groupSelects.forEach(function (s, i) { s.value = group.memberIds[i] || ''; });
    groupFormTitle.textContent = 'Edit group ' + group.id;
    groupSubmit.textContent = 'Save group';
    groupCancel.hidden = false;
    if (group.memberIds.length > groupSelects.length) {
      showError('This group has more than three members. Saving here keeps only the three shown.');
    }
    groupSelects[0].focus();
  }

  groupCancel.addEventListener('click', function () { resetGroupForm(); showStatus(''); });

  groupForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var ids = groupSelects.map(function (s) { return s.value; }).filter(Boolean);
    var unique = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    if (unique.length !== ids.length) { showError('The same person is chosen twice.'); return; }
    if (unique.length < 2) { showError('Choose at least two members for a brigadier group.'); groupSelects[0].focus(); return; }

    groupSubmit.disabled = true;
    showError('');
    var wasEditing = editingGroupId;
    var result = await client.rpc('admin_save_brigadier_group', { p_club: clubId, p_group_id: editingGroupId, p_profile_ids: unique });
    groupSubmit.disabled = false;
    if (result.error) { showError('Could not save the group. ' + dbError(result.error)); await refresh(); return; }
    showStatus((wasEditing ? 'Group ' + wasEditing + ' saved: ' : 'Group ' + result.data + ' created: ') + P.joinNames(unique.map(cardName)) + '.');
    resetGroupForm();
    await refresh();
  });

  async function deleteGroup(group, label, button) {
    groupDeleteName.textContent = group.id + ' (' + label + ')';
    if (!(await confirmDialog(groupDeleteDialog))) return;
    button.disabled = true;
    showError('');
    var result = await client.rpc('admin_delete_brigadier_group', { p_club: clubId, p_group_id: group.id });
    button.disabled = false;
    if (result.error) { showError('Could not delete the group. ' + dbError(result.error)); }
    else { showStatus('Group ' + group.id + ' was deleted.'); }
    if (editingGroupId === group.id) resetGroupForm();
    await refresh();
  }

  // Super admins see who the other super admins are (the database returns nothing to anyone else).
  async function loadSuperAdmins() {
    var result = await client.from('super_admins').select('email').order('email', { ascending: true });
    if (result.error || !result.data || !result.data.length) return;
    var list = document.getElementById('super-admins-list');
    var section = document.getElementById('super-admins');
    if (!list || !section) return; // an older cached page without this section
    list.replaceChildren();
    result.data.forEach(function (row) { list.appendChild(el('li', { text: row.email })); });
    section.hidden = false;
  }

  N.guardMembersPage().then(function (accessInfo) {
    if (!accessInfo) return;
    // the clubs this person administers (super admins: every club)
    club = N.pickClub(accessInfo, true);
    if (club.role !== 'admin') {
      var firstAdminClub = (accessInfo.clubs || []).find(function (c) { return c.role === 'admin'; });
      if (!firstAdminClub) { N.showState('not-admin'); return; }
      window.location.replace('admin.html?club=' + encodeURIComponent(firstAdminClub.club_id));
      return;
    }
    clubId = club.id;
    myEmail = (accessInfo.session.user.email || '').toLowerCase();
    N.setText('[data-slot="club-name"]', club.name);
    if (!club.isHome) document.title = 'Admin: ' + club.name + ' · The Nines';
    N.renderClubPicker(document.getElementById('club-picker'), club);
    N.showState('ready');
    refresh();
    loadSuperAdmins();
  });
})();
