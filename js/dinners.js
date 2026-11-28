// Dinners admin screen (members/dinners.html): the club's dinners, adding / editing one, and its replies.
// Club admins of that club only (super admins: every club). Normal members never get here: the menu item
// is admin-only and this page sends anyone else straight back to the member home.
// Every action is an existing database function that checks the caller is an admin of the dinner's club:
//   list ............................ admin_club_events(club)
//   "No answer" counts, Replies ..... admin_event_answers(dinner)   (every active member and their answer)
//   add / edit (date, venue, group) . admin_save_event(club, date, venue, group, dinner)
//   status, "Close dinner" .......... admin_set_rsvp_status(dinner, status)
//   deadline ........................ admin_set_rsvp_deadline(dinner, deadline)   (entered in the club's time zone)
//   venue search .................... admin_venue_options(query)
//   brigadier groups ................ admin_brigadier_group_options(club); a new one: admin_save_brigadier_group
//   force / clear an answer ......... admin_set_answer(dinner, member, answer or null)
//   past dinners: who attended ...... admin_past_attendee_options(dinner); save: admin_save_past_attendees(dinner, ids)
// Nothing else is ever deleted from here (saving attendees takes the people left out off that dinner's list).
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
  var T = function (s) { return window.NinesI18n ? window.NinesI18n.translate(s) : s; };
  var STATUS_TEXT = { not_open: 'Not open', open: 'Open', closed: 'Closed' };
  var NEW_GROUP = 'new';

  var club = null;
  var tz = 'Europe/London';
  var events = [];
  var groups = [];
  var members = [];          // [{ id, name }] of the club, for a new brigadier group
  var editing = null;        // the dinner being edited, or null when adding
  var chosenVenue = null;    // { id, name } or null = venue to be announced
  var replies = { event: null, rows: [], filter: 'all' };
  var att = { event: null, people: [], chosen: {}, saved: '' };   // the past dinner whose attendees are edited

  var errorBox = document.getElementById('dinners-error');
  var statusBox = document.getElementById('dinners-status');
  var views = { list: document.getElementById('view-list'), form: document.getElementById('view-form'), replies: document.getElementById('view-replies'),
                attendees: document.getElementById('view-attendees') };
  var form = document.getElementById('event-form');
  var dateInput = document.getElementById('event-date');
  var dateWarning = document.getElementById('date-warning');
  var venueCurrent = document.getElementById('venue-current');
  var venueClear = document.getElementById('venue-clear');
  var venueQuery = document.getElementById('venue-query');
  var venueResults = document.getElementById('venue-results');
  var groupSelect = document.getElementById('event-group');
  var newGroup = document.getElementById('new-group');
  var newGroup1 = document.getElementById('new-group-1');
  var newGroup2 = document.getElementById('new-group-2');
  var statusSelect = document.getElementById('event-status');
  var openHint = document.getElementById('open-hint');
  var deadlineInput = document.getElementById('event-deadline');
  var saveButton = document.getElementById('event-save');
  var closeButton = document.getElementById('event-close');
  var addButton = document.getElementById('add-dinner');

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }
  function fail(prefix, error) { showError(prefix + ' ' + N.friendlyError(error)); }

  function show(view) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== view; });
    addButton.hidden = view !== 'list';
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () { showError(''); showStatus(''); show('list'); });
  });

  // ---- Dates and times (dinners have a date only; the deadline is a time in the club's time zone) ----

  var dayFormat = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function dayText(iso) {
    var p = String(iso).split('-').map(Number);
    return dayFormat.format(new Date(p[0], p[1] - 1, p[2]));
  }
  function zoneParts(date) {
    var out = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).forEach(function (x) { out[x.type] = x.value; });
    return out;
  }
  function clubToday() { var p = zoneParts(new Date()); return p.year + '-' + p.month + '-' + p.day; }
  // timestamptz -> "YYYY-MM-DDTHH:MM" in the club's time zone (for <input type="datetime-local">)
  function toClubInput(ts) {
    if (!ts) return '';
    var p = zoneParts(new Date(ts));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  // "YYYY-MM-DDTHH:MM" in the club's time zone -> ISO timestamp (handles summer time)
  function fromClubInput(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
    if (!m) return null;
    var wanted = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var guess = wanted;
    for (var i = 0; i < 3; i++) {
      var p = zoneParts(new Date(guess));
      guess += wanted - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    }
    return new Date(guess).toISOString();
  }
  function stampText(ts) {
    if (!ts) return '';
    return new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
  }
  function names(list) { return (list || []).join(' & '); }

  // ---- 1. List ----

  async function loadEvents() {
    var result = await client.rpc('admin_club_events', { p_club: club.id });
    document.getElementById('events-loading').hidden = true;
    if (result.error) { fail('Could not load the dinners.', result.error); return; }
    events = result.data || [];
    renderEvents();
    // "No answer": active members without an answer, for upcoming dinners
    var today = clubToday();
    events.filter(function (e) { return e.event_date >= today; }).forEach(async function (ev) {
      var r = await client.rpc('admin_event_answers', { p_event: ev.event_id });
      if (r.error) return;
      ev.no_answer = (r.data || []).filter(function (x) { return x.is_member && !x.answer; }).length;
      var slot = document.querySelector('[data-no-answer="' + ev.event_id + '"]');
      if (slot) slot.textContent = String(ev.no_answer);
    });
  }

  function renderEvents() {
    var today = clubToday();
    var upcoming = events.filter(function (e) { return e.event_date >= today; })
      .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0; });
    var past = events.filter(function (e) { return e.event_date < today; });   // newest first, from the database
    var upList = document.getElementById('upcoming-list'), pastList = document.getElementById('past-list');
    upList.replaceChildren.apply(upList, upcoming.map(function (ev) { return eventCard(ev, true); }));
    pastList.replaceChildren.apply(pastList, past.map(function (ev) { return eventCard(ev, false); }));
    document.getElementById('upcoming-heading').hidden = !upcoming.length;
    document.getElementById('past-heading').hidden = !past.length;
    document.getElementById('events-empty').hidden = events.length > 0;
  }

  function count(label, value, slot) {
    return el('li', null, [el('span', { className: 'count-label', text: label }), document.createTextNode(' '),
      el('strong', slot ? { 'data-no-answer': slot, text: value } : { text: value })]);
  }

  function eventCard(ev, upcoming) {
    var repliesButton = el('button', { type: 'button', className: 'button secondary', text: 'Replies' });
    repliesButton.addEventListener('click', function () { openReplies(ev); });
    var editButton = el('button', { type: 'button', className: 'button secondary', text: 'Edit' });
    editButton.addEventListener('click', function () { openForm(ev); });
    var attendeesButton = null;
    if (!upcoming) {
      attendeesButton = el('button', { type: 'button', className: 'button secondary', text: 'Attendees' });
      attendeesButton.addEventListener('click', function () { openAttendees(ev); });
    }
    return el('li', { className: 'admin-dinner' + (upcoming ? '' : ' is-past') }, [
      el('div', { className: 'admin-dinner-head' }, [
        el('p', { className: 'admin-dinner-date', 'data-no-i18n': true, text: dayText(ev.event_date) }),
        el('span', { className: 'status-badge status-' + ev.rsvp_status, text: STATUS_TEXT[ev.rsvp_status] || ev.rsvp_status })
      ]),
      ev.venue_name
        ? el('p', { className: 'admin-dinner-venue', 'data-no-i18n': true, text: ev.venue_name })
        : el('p', { className: 'admin-dinner-venue muted', text: 'Venue to be announced' }),
      ev.brigadiers && ev.brigadiers.length ? el('p', { className: 'admin-dinner-brigadiers muted', 'data-no-i18n': true, text: names(ev.brigadiers) }) : null,
      upcoming ? el('ul', { className: 'admin-dinner-counts' }, [
        count('Attending', String(ev.attending)),
        count('Not attending', String(ev.not_attending)),
        count('No answer', ev.no_answer === undefined ? '…' : String(ev.no_answer), ev.event_id)
      ]) : el('ul', { className: 'admin-dinner-counts' }, [count('Attendees', String(ev.attending || 0))]),
      el('div', { className: 'row-actions' }, [attendeesButton, repliesButton, editButton])
    ]);
  }

  addButton.addEventListener('click', function () { openForm(null); });

  // ---- 2. Add / edit ----

  function fillGroups(selected) {
    groupSelect.replaceChildren(el('option', { value: '', text: 'No brigadier group yet' }));
    groups.forEach(function (g) {
      groupSelect.appendChild(el('option', { value: String(g.id), 'data-no-i18n': true, text: names(g.names) || ('#' + g.id) }));
    });
    groupSelect.appendChild(el('option', { value: NEW_GROUP, text: 'New group from two members…' }));
    groupSelect.value = selected ? String(selected) : '';
    newGroup.hidden = groupSelect.value !== NEW_GROUP;
  }
  function fillMembers() {
    [newGroup1, newGroup2].forEach(function (s) {
      s.replaceChildren(el('option', { value: '', text: 'Choose a member' }));
      members.forEach(function (m) { s.appendChild(el('option', { value: m.id, 'data-no-i18n': true, text: m.name })); });
    });
  }
  groupSelect.addEventListener('change', function () { newGroup.hidden = groupSelect.value !== NEW_GROUP; });

  function setVenue(v) {
    chosenVenue = v;
    venueCurrent.textContent = v ? v.name : T('Venue to be announced');
    venueCurrent.classList.toggle('muted', !v);
    venueClear.hidden = !v;
    venueQuery.value = '';
    venueResults.hidden = true;
    venueResults.replaceChildren();
  }
  venueClear.addEventListener('click', function () { setVenue(null); venueQuery.focus(); });

  var venueTimer = null, venueSeq = 0;
  venueQuery.addEventListener('input', function () {
    clearTimeout(venueTimer);
    var q = venueQuery.value.trim();
    if (!q) { venueResults.hidden = true; return; }
    venueTimer = setTimeout(async function () {
      var seq = ++venueSeq;
      var result = await client.rpc('admin_venue_options', { p_query: q });
      if (seq !== venueSeq) return;
      if (result.error) { fail('Could not search the venues.', result.error); return; }
      venueResults.replaceChildren();
      (result.data || []).forEach(function (v) {
        var b = el('button', { type: 'button', className: 'venue-option' }, [
          el('span', { className: 'venue-option-name', 'data-no-i18n': true, text: v.name }),
          v.address ? el('span', { className: 'muted small', 'data-no-i18n': true, text: v.address }) : null
        ]);
        b.addEventListener('click', function () { setVenue({ id: v.id, name: v.name }); });
        venueResults.appendChild(el('li', null, [b]));
      });
      if (!result.data || !result.data.length) venueResults.appendChild(el('li', { className: 'muted small', text: 'No venue found.' }));
      venueResults.hidden = false;
    }, 250);
  });

  function sameDateDinner() {
    return events.find(function (e) { return e.event_date === dateInput.value && (!editing || e.event_id !== editing.event_id); });
  }
  function updateDateWarning() {
    var other = dateInput.value && sameDateDinner();
    dateWarning.hidden = !other;
    dateWarning.textContent = other ? T('Another dinner of this club is on the same date:') + ' ' + (other.venue_name || T('Venue to be announced')) : '';
  }
  dateInput.addEventListener('input', updateDateWarning);
  dateInput.addEventListener('change', updateDateWarning);

  function updateOpenHint() { openHint.hidden = statusSelect.value !== 'open'; }
  statusSelect.addEventListener('change', updateOpenHint);

  function openForm(ev) {
    editing = ev;
    showError(''); showStatus('');
    form.reset();
    dateInput.value = ev ? ev.event_date : '';
    setVenue(ev && ev.venue_id ? { id: ev.venue_id, name: ev.venue_name } : null);
    fillGroups(ev ? ev.brigadier_group_id : null);
    fillMembers();
    statusSelect.value = ev ? ev.rsvp_status : 'not_open';
    deadlineInput.value = ev ? toClubInput(ev.rsvp_deadline) : '';
    updateOpenHint();
    updateDateWarning();
    document.getElementById('form-heading').textContent = ev ? 'Edit the dinner' : 'Add a dinner';
    saveButton.textContent = ev ? 'Save dinner' : 'Add dinner';
    closeButton.hidden = !ev || ev.rsvp_status === 'closed';
    show('form');
    dateInput.focus();
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!dateInput.value) { showError('Please choose a date.'); dateInput.focus(); return; }
    var isPast = editing && editing.event_date < clubToday();
    if (isPast && !window.confirm(T('This dinner is in the past. Save your changes anyway?'))) return;
    var groupId = groupSelect.value && groupSelect.value !== NEW_GROUP ? Number(groupSelect.value) : null;
    if (groupSelect.value === NEW_GROUP) {
      if (!newGroup1.value || !newGroup2.value || newGroup1.value === newGroup2.value) {
        showError('Choose two different members for the new brigadier group.'); newGroup1.focus(); return;
      }
    }
    saveButton.disabled = true;
    try {
      if (groupSelect.value === NEW_GROUP) {
        var g = await client.rpc('admin_save_brigadier_group', { p_club: club.id, p_group_id: null, p_profile_ids: [newGroup1.value, newGroup2.value] });
        if (g.error) throw g.error;
        groupId = g.data;
        await loadGroups();
      }
      var saved = await client.rpc('admin_save_event', {
        p_club: club.id, p_event_date: dateInput.value, p_venue_id: chosenVenue ? chosenVenue.id : null,
        p_brigadier_group_id: groupId, p_event: editing ? editing.event_id : null
      });
      if (saved.error) throw saved.error;
      var id = saved.data;
      var wantStatus = statusSelect.value;
      if (wantStatus !== (editing ? editing.rsvp_status : 'not_open')) {
        var st = await client.rpc('admin_set_rsvp_status', { p_event: id, p_status: wantStatus });
        if (st.error) throw st.error;
      }
      var wantDeadline = deadlineInput.value ? fromClubInput(deadlineInput.value) : null;
      var hadDeadline = editing && editing.rsvp_deadline ? new Date(editing.rsvp_deadline).toISOString() : null;
      if (wantDeadline !== hadDeadline) {
        var dl = await client.rpc('admin_set_rsvp_deadline', { p_event: id, p_deadline: wantDeadline });
        if (dl.error) throw dl.error;
      }
      show('list');
      showStatus(editing ? 'Dinner saved.' : (wantStatus === 'open' ? 'Dinner added and open for replies.' : 'Dinner added. Open it for replies when you are ready.'));
      editing = null;
      await loadEvents();
    } catch (error) {
      fail('Could not save the dinner.', error);
    } finally {
      saveButton.disabled = false;
    }
  });

  // "Close dinner": replies closed (nothing is ever deleted)
  closeButton.addEventListener('click', async function () {
    if (!editing) return;
    if (!window.confirm(T('Close this dinner? Replies stop; nothing is deleted.'))) return;
    var r = await client.rpc('admin_set_rsvp_status', { p_event: editing.event_id, p_status: 'closed' });
    if (r.error) { fail('Could not close the dinner.', r.error); return; }
    show('list');
    showStatus('Dinner closed.');
    editing = null;
    await loadEvents();
  });

  // ---- 3. Replies ----

  function answerText(a) { return a === 'attending' ? 'Attending' : a === 'not_attending' ? 'Not attending' : 'No answer yet'; }

  async function openReplies(ev) {
    replies.event = ev;
    replies.filter = 'all';
    showError(''); showStatus('');
    document.getElementById('replies-dinner').textContent = dayText(ev.event_date) + ' · ' + (ev.venue_name || T('Venue to be announced'));
    paintFilter();
    show('replies');
    await loadReplies();
  }

  async function loadReplies() {
    var result = await client.rpc('admin_event_answers', { p_event: replies.event.event_id });
    if (result.error) { fail('Could not load the replies.', result.error); return; }
    replies.rows = result.data || [];
    renderReplies();
  }

  function paintFilter() {
    document.querySelectorAll('#replies-filter [data-filter]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.filter === replies.filter));
    });
  }
  document.querySelectorAll('#replies-filter [data-filter]').forEach(function (b) {
    b.addEventListener('click', function () { replies.filter = b.dataset.filter; paintFilter(); renderReplies(); });
  });

  function renderReplies() {
    var rows = replies.rows;
    var yes = rows.filter(function (r) { return r.answer === 'attending'; }).length;
    var no = rows.filter(function (r) { return r.answer === 'not_attending'; }).length;
    var none = rows.filter(function (r) { return r.is_member && !r.answer; }).length;
    var totals = document.getElementById('replies-totals');
    totals.replaceChildren(count('Attending', String(yes)), count('Not attending', String(no)), count('No answer', String(none)));
    var list = document.getElementById('replies-list');
    list.replaceChildren();
    rows.filter(function (r) {
      if (replies.filter === 'attending') return r.answer === 'attending';
      if (replies.filter === 'not_attending') return r.answer === 'not_attending';
      if (replies.filter === 'none') return !r.answer && r.is_member;
      return true;
    }).forEach(function (r) {
      var actions = el('div', { className: 'row-actions' });
      [['attending', 'Force attending'], ['not_attending', 'Force not attending']].forEach(function (pair) {
        if (r.answer === pair[0] && r.set_by === 'admin') return;
        var b = el('button', { type: 'button', className: 'button secondary small', text: pair[1] });
        b.addEventListener('click', function () { force(r, pair[0]); });
        actions.appendChild(b);
      });
      if (r.answer) {
        var clear = el('button', { type: 'button', className: 'button link danger-link', text: 'Clear' });
        clear.addEventListener('click', function () { force(r, null); });
        actions.appendChild(clear);
      }
      var meta = [];
      if (r.last_changed_at) meta.push(el('span', { 'data-no-i18n': true, text: stampText(r.last_changed_at) }));
      if (r.set_by) meta.push(el('span', { text: r.set_by === 'admin' ? 'Set by an admin (locked)' : 'Set by the member' }));
      list.appendChild(el('li', { className: 'reply-row' }, [
        el('div', { className: 'reply-who' }, [
          el('span', { className: 'reply-name', 'data-no-i18n': true, text: r.display_name }),
          r.is_member ? null : el('span', { className: 'muted small', text: '(no longer a member)' })
        ]),
        el('div', { className: 'reply-answer' }, [
          el('span', { className: 'answer-badge answer-' + (r.answer || 'none'), text: answerText(r.answer) }),
          meta.length ? el('span', { className: 'reply-meta muted small' }, meta.reduce(function (acc, n, i) { return acc.concat(i ? [document.createTextNode(' · '), n] : [n]); }, [])) : null
        ]),
        actions
      ]));
    });
  }

  async function force(r, answer) {
    var result = await client.rpc('admin_set_answer', { p_event: replies.event.event_id, p_profile: r.profile_id, p_answer: answer });
    if (result.error) { fail('Could not set the answer.', result.error); return; }
    showStatus(answer ? 'Answer set for ' + r.display_name + '. They can no longer change it.' : 'Answer cleared for ' + r.display_name + '.');
    await loadReplies();
    loadEvents();
  }

  // CSV of the replies, built in the browser (nothing leaves the page)
  document.getElementById('replies-csv').addEventListener('click', function () {
    var cell = function (v) {
      v = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[",;\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var head = ['Member', 'Answer', 'Answered', 'Set by', 'Still a member'].map(T);
    var lines = [head.map(cell).join(';')];
    replies.rows.forEach(function (r) {
      lines.push([r.display_name, r.answer ? T(answerText(r.answer)) : '', stampText(r.last_changed_at), r.set_by ? T(r.set_by === 'admin' ? 'Admin' : 'Member') : '', T(r.is_member ? 'Yes' : 'No')].map(cell).join(';'));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'replies-' + replies.event.event_date + '.csv' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  // ---- 4. Attendees of a past dinner ----
  // Pick from the club's people (current members first; former members can be added too, they were
  // there). Saved as one list: admin_save_past_attendees makes the dinner's attendees exactly these.

  var attChosen = document.getElementById('attendees-chosen');
  var attQuery = document.getElementById('attendees-query');
  var attResults = document.getElementById('attendees-results');
  var attCount = document.getElementById('attendees-count');
  var attSave = document.getElementById('attendees-save');
  var fold = function (t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };
  var byName = function (a, b) { return a.display_name.localeCompare(b.display_name, fr ? 'fr' : 'en-GB', { sensitivity: 'base' }); };
  function chosenIds() { return Object.keys(att.chosen).filter(function (k) { return att.chosen[k]; }).sort(); }

  async function openAttendees(ev) {
    att = { event: ev, people: [], chosen: {}, saved: '' };
    showError(''); showStatus('');
    document.getElementById('attendees-dinner').textContent = dayText(ev.event_date) + ' · ' + (ev.venue_name || T('Venue to be announced'));
    attQuery.value = '';
    attChosen.replaceChildren();
    attResults.replaceChildren();
    attCount.textContent = '';
    show('attendees');
    var result = await client.rpc('admin_past_attendee_options', { p_event: ev.event_id });
    if (result.error) { fail('Could not load the members.', result.error); return; }
    att.people = (result.data || []).slice().sort(byName);
    att.people.forEach(function (p) { if (p.attending) att.chosen[p.profile_id] = true; });
    att.saved = chosenIds().join();
    renderAttendees();
  }

  function renderAttendees() {
    var chosen = att.people.filter(function (p) { return att.chosen[p.profile_id]; });
    attCount.textContent = chosen.length === 1 ? '1 attendee' : chosen.length + ' attendees';
    attChosen.replaceChildren.apply(attChosen, chosen.map(function (p) {
      var remove = el('button', { type: 'button', className: 'chip-remove', 'aria-label': 'Remove ' + p.display_name, title: 'Remove ' + p.display_name, text: '×' });
      remove.addEventListener('click', function () { att.chosen[p.profile_id] = false; renderAttendees(); attQuery.focus(); });
      return el('li', { className: 'attendee-chip' }, [
        el('span', { 'data-no-i18n': true, text: p.display_name }),
        p.is_member ? null : el('span', { className: 'muted small', text: '(no longer a member)' }),
        remove
      ]);
    }));
    var changed = chosenIds().join() !== att.saved;
    attSave.disabled = !changed;
    renderAttendeeResults();
  }

  function renderAttendeeResults() {
    var q = fold(attQuery.value.trim());
    attResults.replaceChildren();
    if (!q) return;
    var found = att.people.filter(function (p) {
      return !att.chosen[p.profile_id] && fold(p.display_name).split(/\s+/).concat([fold(p.display_name)]).some(function (w) { return w.indexOf(q) === 0; });
    }).sort(function (a, b) { return (b.is_member - a.is_member) || byName(a, b); }).slice(0, 8);
    if (!found.length) { attResults.appendChild(el('li', { className: 'muted small', text: 'No member matches.' })); return; }
    found.forEach(function (p) {
      var b = el('button', { type: 'button', className: 'attendee-add' }, [
        el('span', { 'data-no-i18n': true, text: p.display_name }),
        p.is_member ? null : el('span', { className: 'muted small', text: '(no longer a member)' }),
        el('span', { className: 'attendee-add-plus', 'aria-hidden': 'true', text: '+' })
      ]);
      b.setAttribute('aria-label', T('Add') + ' ' + p.display_name);
      b.addEventListener('click', function () { att.chosen[p.profile_id] = true; attQuery.value = ''; renderAttendees(); attQuery.focus(); });
      attResults.appendChild(el('li', null, [b]));
    });
  }
  attQuery.addEventListener('input', renderAttendeeResults);
  attQuery.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var first = attResults.querySelector('.attendee-add');
    if (first) first.click();
  });

  attSave.addEventListener('click', async function () {
    attSave.disabled = true;
    var ids = chosenIds();
    var result = await client.rpc('admin_save_past_attendees', { p_event: att.event.event_id, p_profile_ids: ids });
    if (result.error) { attSave.disabled = false; fail('Could not save the attendees.', result.error); return; }
    att.saved = ids.join();
    att.event.attending = result.data;
    renderAttendees();
    showStatus(result.data === 1 ? 'Saved: 1 attendee.' : 'Saved: ' + result.data + ' attendees.');
    loadEvents();
  });

  // ---- Start ----

  async function loadGroups() {
    var g = await client.rpc('admin_brigadier_group_options', { p_club: club.id });
    groups = g.error ? [] : (g.data || []);
  }
  async function loadMembers() {
    var r = await client.from('club_profiles').select('profile_id, profiles(display_name)').eq('club_id', club.id);
    members = r.error ? [] : (r.data || []).filter(function (x) { return x.profiles; })
      .map(function (x) { return { id: x.profile_id, name: x.profiles.display_name }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  N.guardMembersPage().then(async function (access) {
    if (!access) return;
    club = N.pickClub(access, true);
    if (club.role !== 'admin') {
      var firstAdminClub = (access.clubs || []).find(function (c) { return c.role === 'admin'; });
      // normal members: nothing to see here, back to the member home
      if (!firstAdminClub) { window.location.replace('index.html'); return; }
      window.location.replace('dinners.html?club=' + encodeURIComponent(firstAdminClub.club_id));
      return;
    }
    var c = await client.from('clubs').select('timezone').eq('id', club.id).maybeSingle();
    if (!c.error && c.data && c.data.timezone) tz = c.data.timezone;
    document.getElementById('deadline-hint').textContent = T('Date and time in the club\'s time zone:') + ' ' + tz.replace('_', ' ') + '.';
    N.setText('[data-slot="club-name"]', club.name);
    N.renderClubPicker(document.getElementById('club-picker'), club);
    if (!club.isHome) document.title = 'Dinners: ' + club.name + ' · The Nines';
    N.showState('ready');
    show('list');
    await Promise.all([loadGroups(), loadMembers()]);
    await loadEvents();
  });
})();
