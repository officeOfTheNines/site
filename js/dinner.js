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

  // The venue as a link to the member map's Dinners view, centred on this dinner with its card open.
  // The link carries the dinner's id and its club only (recos.html reads ?view=dinners&dinner=&club=).
  function venueLink(club, row) {
    return el('a', { className: 'dinner-venue-link', 'data-no-i18n': true, text: row.venue_name,
      href: 'recos.html?view=dinners&dinner=' + encodeURIComponent(row.event_id) + '&club=' + encodeURIComponent(club.club_id) });
  }

  async function renderPanel(club, row, showClub) {
    var section = el('section', { className: 'panel dinner-panel', 'aria-label': 'Next dinner' });
    if (showClub) section.appendChild(el('p', { className: 'dinner-club muted', 'data-no-i18n': true, text: club.name }));

    if (row.kind === 'last') {
      section.appendChild(el('p', { className: 'dinner-last' }, [
        el('span', { text: 'Our last dinner at' }),
        document.createTextNode(' '),
        el('strong', null, [row.event_id ? venueLink(club, row) : el('span', { 'data-no-i18n': true, text: row.venue_name })])
      ]));
      return section;
    }

    section.appendChild(el('h2', { className: 'dinner-heading', text: 'Next dinner' }));
    section.appendChild(el('p', { className: 'dinner-date', 'data-no-i18n': true, text: dayText(row.event_date) }));
    if (row.venue_name) section.appendChild(el('p', { className: 'dinner-venue' }, [row.event_id ? venueLink(club, row) : el('span', { 'data-no-i18n': true, text: row.venue_name })]));
    else section.appendChild(el('p', { className: 'dinner-venue muted', text: 'Venue to be announced' }));

    if (row.brigadiers && row.brigadiers.length) {
      section.appendChild(el('p', { className: 'dinner-label muted', text: 'Brigadiers' }));
      section.appendChild(await brigadierFaces(row.brigadiers));
    }

    // The member's own reply only (never anyone else's). Every rule comes from the database:
    //   can_answer        the reply button works now (replies open, before the deadline, not locked, and
    //                     either no answer yet or within the hour after the first one)
    //   can_change_until  end of that hour (shown in the club's time zone)
    var reply = el('div', { className: 'dinner-reply' });
    var note = el('p', { className: 'dinner-note', role: 'status' });
    var button = null;
    if (row.my_answer && row.can_answer) {
      // within the hour: today's behaviour, the answer can still be changed
      reply.appendChild(el('p', { className: 'dinner-answer' }, [
        el('span', { text: 'Your reply:' }), document.createTextNode(' '),
        el('strong', { text: answerText(row.my_answer) })
      ]));
      if (row.can_change_until) {
        reply.appendChild(el('p', { className: 'muted small', text: 'You can change this until ' + clubTime(row.can_change_until) }));
      }
      button = el('button', { type: 'button', className: 'button secondary', text: 'Change my reply' });
    } else if (row.my_answer) {
      // the hour has passed, replies are closed, the deadline has passed, or an admin set it: read only
      reply.appendChild(el('p', { className: 'dinner-answer' }, [
        el('strong', { text: row.my_answer === 'attending' ? 'You replied: Attending' : 'You replied: Not attending' })
      ]));
      reply.appendChild(el('p', { className: 'muted small', text: 'To change your answer, please contact us directly.' }));
    } else if (row.can_answer) {
      button = el('button', { type: 'button', className: 'button', text: 'Reply' });   // the hour starts at the first answer
    } else {
      reply.appendChild(el('p', { className: 'muted', text: 'No reply recorded. Please contact us directly.' }));
    }
    if (button) {
      button.addEventListener('click', async function () {
        note.textContent = '';
        var choice = await ask(dayText(row.event_date) + (row.venue_name ? ' · ' + row.venue_name : ''));
        if (!choice) return;
        button.disabled = true;
        var result = await N.client.rpc('rsvp_answer', { p_event: row.event_id, p_answer: choice });
        button.disabled = false;
        // refused (the hour just ended, replies closed meanwhile...): show the database's current state
        if (result.error || result.data !== 'ok') { await refreshClub(club); return; }
        refreshClub(club);
      });
    }
    if (button) reply.appendChild(button);
    reply.appendChild(note);
    section.appendChild(reply);
    return section;
  }

  // Asks the database for the club's panel. A failed request never removes a panel already shown: it is
  // kept and the request is tried again shortly. The panel is asked for again when the change hour ends and
  // whenever the page comes back into view, so its state always comes from the server, not the phone's clock.
  var refreshTimer = null;
  async function refreshClub(club, attempt) {
    var slot = box.querySelector('[data-club="' + club.club_id + '"]');
    if (!slot) return;
    var result = await N.client.rpc('home_dinner_panel', { p_club: club.club_id });
    if (result.error) {
      if ((attempt || 0) < 3) setTimeout(function () { refreshClub(club, (attempt || 0) + 1); }, 2000 * ((attempt || 0) + 1));
      return;   // keep whatever is shown
    }
    if (!result.data || !result.data.length) { slot.replaceChildren(); return; }   // really no dinner to show
    var row = result.data[0];
    slot.replaceChildren(await renderPanel(club, row, clubs.length > 1));
    clearTimeout(refreshTimer);
    if (row.can_change_until) {
      var wait = new Date(row.can_change_until).getTime() - Date.now();
      // ask again just after the hour ends (the server decides; at most once a minute if the clocks differ)
      refreshTimer = setTimeout(function () { refreshClub(club); }, Math.min(Math.max(wait + 5000, 60000), 2147483000));
    }
  }

  // "14:32" in the club's time zone, not the phone's
  var tzByClub = {};
  var currentTz = null;
  function clubTime(ts) {
    return new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { timeZone: currentTz || undefined, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
  }
  async function loadTimezone(clubId) {
    if (tzByClub[clubId] !== undefined) { currentTz = tzByClub[clubId]; return; }
    var r = await N.client.from('clubs').select('timezone').eq('id', clubId).maybeSingle();
    tzByClub[clubId] = (!r.error && r.data && r.data.timezone) || null;
    currentTz = tzByClub[clubId];
  }

  function start(access) {
    box = document.getElementById('dinner-panels');
    dialog = document.getElementById('rsvp-dialog');
    if (!box || !dialog) return; // an older cached page
    // the member's current club (js/club-switch.js; members of one club: their club)
    clubs = (access.clubs || []).filter(function (c) { return c.role; });
    var sw = window.NinesClubSwitch;
    var shown = null;   // the club whose panel is on the page
    function show() {
      var wanted = sw ? sw.get().club_id : N.pickClub(access, false).id;
      var club = clubs.find(function (c) { return c.club_id === wanted; }) || clubs[0];
      box.replaceChildren();
      if (!club) return;
      box.appendChild(el('div', { 'data-club': String(club.club_id) }));
      loadTimezone(club.club_id).then(function () { refreshClub(club); });
      shown = club;
    }
    show();
    if (sw) sw.onChange(show);
    // back to the page (another tab, the phone unlocked): ask the server again
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && shown) refreshClub(shown);
    });
  }

  window.NinesDinner = { start: start };
})();
