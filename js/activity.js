// Home page activity (members/index.html):
//   "Recent activity": recos and comments by others, from activity_feed(scope), with the shared
//                      "My clubs | All clubs" toggle;
//   "My activity":     the member's own recos and comments, from my_reco_activity().
// The database decides what each member may see; this file only shows it. Each card opens the reco on
// the Recos map (recos.html?place=<id>), centred with its card open.
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed || !window.NinesScope) return;

  var el = N.el;
  var PAGE = 20;
  var fr = N.lang === 'fr';
  var dayMonth = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
  var dayMonthYear = new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // "just now", "5m ago", "2h ago", "3d ago", then the date
  function ago(iso) {
    var t = new Date(iso);
    var s = Math.max(0, (Date.now() - t.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
    return (t.getFullYear() === new Date().getFullYear() ? dayMonth : dayMonthYear).format(t);
  }

  function stars(n) { return n > 0 ? '★'.repeat(Math.min(n, 5)) : null; }
  function price(n) { return n > 0 ? (fr ? '€' : '£').repeat(Math.min(n, 4)) : null; }

  // One compact card. mine = the member's own activity ("You added ...").
  function card(ev, mine) {
    var verb = mine
      ? (ev.event_type === 'reco_added' ? 'You added' : 'You commented on')
      : (ev.event_type === 'reco_added' ? 'added' : 'commented on');
    var line = el('p', { className: 'activity-line' });
    if (!mine) line.appendChild(el('span', { className: 'activity-author', 'data-no-i18n': true, text: ev.author_label + ', ' + ev.club_name }));
    if (!mine) line.appendChild(document.createTextNode(' '));
    line.appendChild(el('span', { text: verb }));
    line.appendChild(document.createTextNode(' '));
    line.appendChild(el('strong', { 'data-no-i18n': true, text: ev.place_name }));

    var meta = el('p', { className: 'activity-meta' });
    [ev.area, stars(ev.stars), price(ev.price_level)].filter(Boolean).forEach(function (part) {
      meta.appendChild(el('span', { 'data-no-i18n': true, text: part }));
    });
    if (mine && ev.visibility && ev.visibility !== 'everyone') {
      meta.appendChild(el('span', { text: ev.visibility === 'club' ? 'My club' : 'Only me' }));
    }
    meta.appendChild(el('time', { datetime: ev.created_at, title: dayMonthYear.format(new Date(ev.created_at)), text: ago(ev.created_at) }));

    // thumbnail slot, kept for photos: hidden while there is no image
    var thumb = el('span', { className: 'activity-thumb', hidden: !ev.image_path });

    return el('li', null, [
      el('a', { className: 'activity-card', href: 'recos.html?place=' + encodeURIComponent(ev.place_id) }, [
        thumb,
        el('span', { className: 'activity-body' }, [
          line,
          meta,
          ev.snippet ? el('p', { className: 'activity-snippet', 'data-no-i18n': true, text: ev.snippet }) : null
        ])
      ])
    ]);
  }

  // A list that loads PAGE items at a time ("Load more" asks for items older than the last one).
  function feedList(opts) {
    var list = document.getElementById(opts.list);
    var more = document.getElementById(opts.more);
    var loading = document.getElementById(opts.loading);
    var empty = document.getElementById(opts.empty);
    var error = document.getElementById(opts.error);
    var last = null;
    var seq = 0;

    async function load(reset) {
      var mySeq = ++seq;
      if (reset) { list.replaceChildren(); last = null; empty.hidden = true; }
      error.textContent = '';
      more.hidden = true;
      loading.hidden = false;
      try {
        var result = await opts.fetch(PAGE, last);
        if (mySeq !== seq) return; // a newer request (for example the toggle) took over
        if (result.error) throw result.error;
        var rows = result.data || [];
        rows.forEach(function (ev) { list.appendChild(card(ev, opts.mine)); });
        if (rows.length) last = rows[rows.length - 1].created_at;
        empty.hidden = list.children.length > 0;
        more.hidden = rows.length < PAGE;
      } catch (e) {
        if (mySeq !== seq) return;
        error.textContent = 'Could not load the activity. ' + N.friendlyError(e);
        more.hidden = !last;
      } finally {
        if (mySeq === seq) loading.hidden = true;
      }
    }
    more.addEventListener('click', function () { load(false); });
    return { load: load };
  }

  function start(access) {
    var section = document.getElementById('activity-section');
    if (!section) return;
    section.hidden = false;
    var userId = access.session && access.session.user && access.session.user.id;
    var scope = window.NinesScope.get(userId);

    var feed = feedList({
      list: 'activity-list', more: 'activity-more', loading: 'activity-loading', empty: 'activity-empty', error: 'activity-error',
      mine: false,
      fetch: function (limit, before) {
        return N.client.rpc('activity_feed', { p_scope: scope, p_limit: limit, p_before: before });
      }
    });
    window.NinesScope.toggle(document.getElementById('activity-scope'), userId, function (value) {
      scope = value;
      feed.load(true);
    });
    feed.load(true);

    var mineSection = document.getElementById('my-activity-section');
    if (access.profile && mineSection) {
      mineSection.hidden = false;
      feedList({
        list: 'my-activity-list', more: 'my-activity-more', loading: 'my-activity-loading', empty: 'my-activity-empty', error: 'my-activity-error',
        mine: true,
        fetch: function (limit, before) {
          return N.client.rpc('my_reco_activity', { p_limit: limit, p_before: before });
        }
      }).load(true);
    }
  }

  window.NinesActivity = { start: start, ago: ago };
})();
