// Dinners admin page (members/dinners.html): the club's calendar and each dinner's replies.
// Club admins only; every action is a database function that checks the caller is an admin of that
// club (admin_club_events, admin_save_event, admin_set_rsvp_status, admin_set_rsvp_deadline,
// admin_event_answers, admin_set_answer, admin_venue_options, admin_brigadier_group_options).
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) {
    window.NinesPageLoadFailed();
    return;
  }

  var client = N.client;
  var el = N.el;
  var fr = N.lang === 'fr';
  var dayFormat = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  var stampFormat = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  var STATUS = [
    { value: 'not_open', label: 'Not open' },   // hidden from members
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' }
  ];

  var club = null;
  var events = [];
  var groups = [];
  var editing = null;        // the event being edited, or null when adding
  var chosenVenue = null;    // { id, name }
  var replies = { event: null, rows: [] };

  var errorBox = document.getElementById('dinners-error');
  var statusBox = document.getElementById('dinners-status');
  var form = document.getElementById('event-form');
  var dateInput = document.getElementById('event-date');
  var groupSelect = document.getElementById('event-group');
  var venueQuery = document.getElementById('venue-query');
  var venueChoice = document.getElementById('venue-choice');
  var saveButton = document.getElementById('event-save');
  var cancelEdit = document.getElementById('event-cancel');
  var showPast = document.getElementById('show-past');

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }
  function fail(prefix, error) { showError(prefix + ' ' + ((error && error.message) || N.friendlyError(error))); }

  function dayText(iso) {
    var p = String(iso).split('-').map(Number);
    return dayFormat.format(new Date(p[0], p[1] - 1, p[2]));
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // timestamptz -> value for <input type="datetime-local"> in the browser's time
  function toLocalInput(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function names(list) { return (list || []).join(', '); }

  // ---- Calendar form ----

  function groupLabel(g) { return 'Group ' + g.id + (g.names && g.names.length ? ': ' + names(g.names) : ''); }

  function fillGroups() {
    groupSelect.replaceChildren(el('option', { value: '', text: 'Not chosen yet' }));
    groups.forEach(function (g) { groupSelect.appendChild(el('option', { value: String(g.id), 'data-no-i18n': true, text: groupLabel(g) })); });
  }

  function resetForm() {
    editing = null;
    chosenVenue = null;
    form.reset();
    venueChoice.hidden = true;
    venueChoice.replaceChildren();
    document.getElementById('event-form-heading').textContent = 'Add a dinner';
    saveButton.textContent = 'Add dinner';
    cancelEdit.hidden = true;
  }

  function editEvent(ev) {
    editing = ev;
    dateInput.value = ev.event_date || '';
    groupSelect.value = ev.brigadier_group_id ? String(ev.brigadier_group_id) : '';
    chosenVenue = ev.venue_id ? { id: ev.venue_id, name: ev.venue_name } : null;
    venueQuery.value = ev.venue_name || '';
    venueChoice.hidden = true;
    document.getElementById('event-form-heading').textContent = 'Edit the dinner of ' + dayText(ev.event_date);
    saveButton.textContent = 'Save dinner';
    cancelEdit.hidden = false;
    form.scrollIntoView({ block: 'start' });
    dateInput.focus();
  }

  var venueTimer = null;
  venueQuery.addEventListener('input', function () {
    chosenVenue = null;
    clearTimeout(venueTimer);
    var q = venueQuery.value.trim();
    if (!q) { venueChoice.hidden = true; return; }
    venueTimer = setTimeout(async function () {
      var result = await client.rpc('admin_venue_options', { p_query: q });
      if (result.error) { fail('Could not search venues.', result.error); return; }
      venueChoice.replaceChildren(el('option', { value: '', text: result.data.length ? 'Choose a venue…' : 'No venue found' }));
      result.data.forEach(function (v) {
        venueChoice.appendChild(el('option', { value: v.id, 'data-no-i18n': true, text: v.name + (v.address ? ' · ' + v.address : '') }));
      });
      venueChoice.hidden = false;
    }, 300);
  });
  venueChoice.addEventListener('change', function () {
    var opt = venueChoice.selectedOptions[0];
    chosenVenue = venueChoice.value ? { id: venueChoice.value, name: opt.textContent.split(' · ')[0] } : null;
    if (chosenVenue) venueQuery.value = chosenVenue.name;
  });
  cancelEdit.addEventListener('click', resetForm);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!dateInput.value) { showError('Please choose a date.'); dateInput.focus(); return; }
    if (venueQuery.value.trim() && !chosenVenue) { showError('Choose the venue from the list, or clear the venue box.'); venueQuery.focus(); return; }
    saveButton.disabled = true;
    var result = await client.rpc('admin_save_event', {
      p_club: club.id,
      p_event_date: dateInput.value,
      p_venue_id: chosenVenue ? chosenVenue.id : null,
      p_brigadier_group_id: groupSelect.value ? Number(groupSelect.value) : null,
      p_event: editing ? editing.event_id : null
    });
    saveButton.disabled = false;
    if (result.error) { fail('Could not save the dinner.', result.error); return; }
    showStatus(editing ? 'Dinner saved.' : 'Dinner added. Open it for replies when you are ready.');
    resetForm();
    await loadEvents();
  });

  // ---- Dinners list ----

  async function loadEvents() {
    var result = await client.rpc('admin_club_events', { p_club: club.id });
    document.getElementById('events-loading').hidden = true;
    if (result.error) { fail('Could not load the dinners.', result.error); return; }
    events = result.data || [];
    renderEvents();
  }

  function renderEvents() {
    var today = todayIso();
    var upcoming = events.filter(function (e) { return e.event_date >= today; }).reverse(); // soonest first
    var past = events.filter(function (e) { return e.event_date < today; });
    var shown = upcoming.concat(showPast.checked ? past : past.slice(0, 3));
    var body = document.getElementById('events-body');
    body.replaceChildren();
    shown.forEach(function (ev) { body.appendChild(eventRow(ev, ev.event_date >= today)); });
    document.getElementById('events-table').hidden = shown.length === 0;
  }
  showPast.addEventListener('change', renderEvents);

  function eventRow(ev, upcoming) {
    var status = el('select', { 'aria-label': 'Replies for ' + dayText(ev.event_date) });
    STATUS.forEach(function (s) { status.appendChild(el('option', { value: s.value, text: s.label })); });
    status.value = ev.rsvp_status;
    status.addEventListener('change', async function () {
      var result = await client.rpc('admin_set_rsvp_status', { p_event: ev.event_id, p_status: status.value });
      if (result.error) { fail('Could not change the replies status.', result.error); status.value = ev.rsvp_status; return; }
      ev.rsvp_status = status.value;
      showStatus('Replies status saved.');
    });

    var deadline = el('input', { type: 'datetime-local', value: toLocalInput(ev.rsvp_deadline), 'aria-label': 'Reply deadline for ' + dayText(ev.event_date) });
    deadline.addEventListener('change', async function () {
      var value = deadline.value ? new Date(deadline.value).toISOString() : null;
      var result = await client.rpc('admin_set_rsvp_deadline', { p_event: ev.event_id, p_deadline: value });
      if (result.error) { fail('Could not save the deadline.', result.error); return; }
      ev.rsvp_deadline = value;
      showStatus(value ? 'Deadline saved.' : 'Deadline removed.');
    });

    var repliesButton = el('button', { type: 'button', className: 'button secondary', text: 'Replies' });
    repliesButton.addEventListener('click', function () { openReplies(ev); });
    var editButton = el('button', { type: 'button', className: 'button link', text: 'Edit' });
    editButton.addEventListener('click', function () { editEvent(ev); });

    return el('tr', { className: upcoming ? '' : 'past-row' }, [
      el('td', { 'data-label': 'Date', 'data-no-i18n': true, text: dayText(ev.event_date) }),
      el('td', { 'data-label': 'Venue', 'data-no-i18n': true, text: ev.venue_name || '' }),
      el('td', { 'data-label': 'Brigadiers', 'data-no-i18n': true, text: names(ev.brigadiers) }),
      el('td', { 'data-label': 'Replies' }, [status]),
      el('td', { 'data-label': 'Deadline' }, [deadline]),
      el('td', { 'data-label': 'Answers', text: ev.attending + ' attending · ' + ev.not_attending + ' not attending' }),
      el('td', { className: 'actions-cell' }, [el('div', { className: 'row-actions' }, [repliesButton, editButton])])
    ]);
  }

  // ---- Replies for one dinner ----

  async function openReplies(ev) {
    replies.event = ev;
    var section = document.getElementById('replies');
    section.hidden = false;
    document.getElementById('replies-dinner').textContent = dayText(ev.event_date) + (ev.venue_name ? ' · ' + ev.venue_name : '');
    await loadReplies();
    section.scrollIntoView({ block: 'start' });
  }

  async function loadReplies() {
    var result = await client.rpc('admin_event_answers', { p_event: replies.event.event_id });
    if (result.error) { fail('Could not load the replies.', result.error); return; }
    replies.rows = result.data || [];
    renderReplies();
  }

  function answerLabel(a) { return a === 'attending' ? 'Attending' : a === 'not_attending' ? 'Not attending' : 'No answer yet'; }

  function renderReplies() {
    var rows = replies.rows;
    var yes = rows.filter(function (r) { return r.answer === 'attending'; }).length;
    var no = rows.filter(function (r) { return r.answer === 'not_attending'; }).length;
    var none = rows.filter(function (r) { return !r.answer; }).length;
    document.getElementById('replies-totals').textContent = yes + ' attending · ' + no + ' not attending · ' + none + ' no answer yet';
    var onlyUnanswered = document.getElementById('replies-unanswered').checked;
    var body = document.getElementById('replies-body');
    body.replaceChildren();
    rows.filter(function (r) { return !onlyUnanswered || !r.answer; }).forEach(function (r) {
      var actions = el('div', { className: 'row-actions' });
      [['attending', 'Force attending'], ['not_attending', 'Force not attending']].forEach(function (pair) {
        if (r.answer === pair[0] && r.set_by === 'admin') return;
        var b = el('button', { type: 'button', className: 'button link', text: pair[1] });
        b.addEventListener('click', function () { force(r, pair[0]); });
        actions.appendChild(b);
      });
      if (r.answer) {
        var clear = el('button', { type: 'button', className: 'button link danger-link', text: 'Clear' });
        clear.addEventListener('click', function () { force(r, null); });
        actions.appendChild(clear);
      }
      body.appendChild(el('tr', null, [
        el('td', { 'data-label': 'Member' }, [
          el('span', { 'data-no-i18n': true, text: r.display_name }),
          r.is_member ? null : el('span', { className: 'muted small', text: ' (no longer a member)' })
        ]),
        el('td', { 'data-label': 'Answer', text: answerLabel(r.answer) }),
        el('td', { 'data-label': 'Answered', 'data-no-i18n': true, text: r.last_changed_at ? stampFormat.format(new Date(r.last_changed_at)) : '' }),
        el('td', { 'data-label': 'Set by', text: r.set_by === 'admin' ? 'Admin (locked)' : r.set_by === 'member' ? 'Member' : '' }),
        el('td', { className: 'actions-cell' }, [actions])
      ]));
    });
  }
  document.getElementById('replies-unanswered').addEventListener('change', renderReplies);

  async function force(r, answer) {
    var result = await client.rpc('admin_set_answer', { p_event: replies.event.event_id, p_profile: r.profile_id, p_answer: answer });
    if (result.error) { fail('Could not set the reply.', result.error); return; }
    showStatus(answer ? 'Reply set for ' + r.display_name + '. They can no longer change it.' : 'Reply cleared for ' + r.display_name + '.');
    await loadReplies();
    await loadEvents();
  }

  // CSV of the replies, built in the browser (nothing leaves the page)
  document.getElementById('replies-csv').addEventListener('click', function () {
    var cell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['member', 'answer', 'answered_at', 'set_by', 'still_member'].join(',')];
    replies.rows.forEach(function (r) {
      lines.push([r.display_name, r.answer || '', r.last_changed_at || '', r.set_by || '', r.is_member ? 'yes' : 'no'].map(cell).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'replies-' + replies.event.event_date + '.csv' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  // ---- Start ----

  N.guardMembersPage().then(async function (access) {
    if (!access) return;
    club = N.pickClub(access, true);
    if (club.role !== 'admin') {
      var firstAdminClub = (access.clubs || []).find(function (c) { return c.role === 'admin'; });
      if (!firstAdminClub) { N.showState('not-admin'); return; }
      window.location.replace('dinners.html?club=' + encodeURIComponent(firstAdminClub.club_id));
      return;
    }
    N.setText('[data-slot="club-name"]', club.name);
    N.renderClubPicker(document.getElementById('club-picker'), club);
    N.showState('ready');
    var g = await client.rpc('admin_brigadier_group_options', { p_club: club.id });
    if (!g.error) { groups = g.data || []; fillGroups(); }
    await loadEvents();
  });
})();
