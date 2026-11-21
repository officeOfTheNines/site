// Next dinner panel on the member home (members/index.html), for the member's current club.
// Everything comes from home_dinner_panel(club) and every reply goes through rsvp_answer(): the
// database decides what a member may see and when they may still change their reply. This file only
// shows it. Dinners have no time: only their date is shown.
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) return;

  var el = N.el;
  var fr = N.lang === 'fr';
  var dateFormat = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var timeFormat = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  var CONTACT = 'Please contact us directly';

  var box = null;
  var dialog = null;
  var clubs = [];

  // '2026-12-03' -> "Thursday 3 December 2026", without moving the day across time zones
  function dayText(iso) {
    var p = String(iso).split('-').map(Number);
    return dateFormat.format(new Date(p[0], p[1] - 1, p[2]));
  }

  function answerText(answer) {
    return answer === 'attending' ? 'Attending' : 'Not attending';
  }

  // Asks attending / not attending in the pop-up; resolves the choice, or null when cancelled.
  function ask(label) {
    return new Promise(function (resolve) {
      document.getElementById('rsvp-dinner').textContent = label;
      function done() {
        dialog.removeEventListener('close', done);
        var v = dialog.returnValue;
        resolve(v === 'attending' || v === 'not_attending' ? v : null);
      }
      dialog.returnValue = '';
      dialog.addEventListener('close', done);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.removeEventListener('close', done); resolve(window.confirm('Attending?') ? 'attending' : 'not_attending'); }
    });
  }

  async function brigadierFaces(list) {
    var urls = {};
    try {
      if (window.NinesPeople) urls = await window.NinesPeople.signedPhotoUrls(list.map(function (b) { return b.photo_path; }));
    } catch (e) { urls = {}; }
    return el('ul', { className: 'brigadiers' }, list.map(function (b) {
      var url = b.photo_path && urls[b.photo_path];
      var face = url
        ? el('img', { className: 'avatar small', src: url, alt: '', width: '56', height: '56' })
        : el('span', { className: 'avatar small avatar-initials', 'aria-hidden': 'true',
                       text: window.NinesPeople ? window.NinesPeople.initials(b.short_name) : '' });
      return el('li', null, [face, el('span', { className: 'brigadier-name', 'data-no-i18n': true, text: b.short_name })]);
    }));
  }

  async function renderPanel(club, row, showClub) {
    var section = el('section', { className: 'panel dinner-panel', 'aria-label': 'Next dinner' });
    if (showClub) section.appendChild(el('p', { className: 'dinner-club muted', 'data-no-i18n': true, text: club.name }));

    if (row.kind === 'last') {
      section.appendChild(el('p', { className: 'dinner-last' }, [
        el('span', { text: 'Our last dinner at' }),
        document.createTextNode(' '),
        el('strong', { 'data-no-i18n': true, text: row.venue_name })
      ]));
      return section;
    }

    section.appendChild(el('h2', { className: 'dinner-heading', text: 'Next dinner' }));
    section.appendChild(el('p', { className: 'dinner-date', 'data-no-i18n': true, text: dayText(row.event_date) }));
    if (row.venue_name) section.appendChild(el('p', { className: 'dinner-venue', 'data-no-i18n': true, text: row.venue_name }));
    else section.appendChild(el('p', { className: 'dinner-venue muted', text: 'Venue to be announced' }));

    if (row.brigadiers && row.brigadiers.length) {
      section.appendChild(el('p', { className: 'dinner-label muted', text: 'Brigadiers' }));
      section.appendChild(await brigadierFaces(row.brigadiers));
    }

    var reply = el('div', { className: 'dinner-reply' });
    var note = el('p', { className: 'dinner-note', role: 'status' });
    if (row.my_answer) {
      reply.appendChild(el('p', { className: 'dinner-answer' }, [
        el('span', { text: 'Your reply:' }), document.createTextNode(' '),
        el('strong', { text: answerText(row.my_answer) })
      ]));
      if (row.can_change_until) {
        reply.appendChild(el('p', { className: 'muted small', text: 'You can change this until ' + timeFormat.format(new Date(row.can_change_until)) }));
      }
    } else if (row.rsvp_status === 'closed') {
      reply.appendChild(el('p', { className: 'muted', text: 'Replies are closed.' }));
    }
    var button = el('button', { type: 'button', className: row.my_answer ? 'button secondary' : 'button',
                                text: row.my_answer ? 'Change my reply' : 'Reply' });
    button.addEventListener('click', async function () {
      note.textContent = '';
      if (!row.can_answer) { note.textContent = CONTACT; return; }
      var choice = await ask(dayText(row.event_date) + (row.venue_name ? ' · ' + row.venue_name : ''));
      if (!choice) return;
      button.disabled = true;
      var result = await N.client.rpc('rsvp_answer', { p_event: row.event_id, p_answer: choice });
      button.disabled = false;
      if (result.error || result.data !== 'ok') { note.textContent = CONTACT; return; }
      refreshClub(club);
    });
    reply.appendChild(button);
    reply.appendChild(note);
    section.appendChild(reply);
    return section;
  }

  async function refreshClub(club) {
    var slot = box.querySelector('[data-club="' + club.club_id + '"]');
    if (!slot) return;
    var result = await N.client.rpc('home_dinner_panel', { p_club: club.club_id });
    if (result.error || !result.data || !result.data.length) { slot.replaceChildren(); return; }
    slot.replaceChildren(await renderPanel(club, result.data[0], clubs.length > 1));
  }

  function start(access) {
    box = document.getElementById('dinner-panels');
    dialog = document.getElementById('rsvp-dialog');
    if (!box || !dialog) return; // an older cached page
    // the member's current club (js/club-switch.js; members of one club: their club)
    clubs = (access.clubs || []).filter(function (c) { return c.role; });
    var sw = window.NinesClubSwitch;
    function show() {
      var wanted = sw ? sw.get().club_id : N.pickClub(access, false).id;
      var club = clubs.find(function (c) { return c.club_id === wanted; }) || clubs[0];
      box.replaceChildren();
      if (!club) return;
      box.appendChild(el('div', { 'data-club': String(club.club_id) }));
      refreshClub(club);
    }
    show();
    if (sw) sw.onChange(show);
  }

  window.NinesDinner = { start: start };
})();
