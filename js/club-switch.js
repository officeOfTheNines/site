// The "current club" for members of more than one club, with a small switch in the top bar of every
// members page ([data-club-switch] slots). One shared choice, remembered per member in this browser
// (localStorage, failures ignored), defaulting to the club of this site. Members of a single club see
// nothing and nothing changes for them.
//   NinesClubSwitch.mount(access)  called by auth.js once the member's clubs are known
//   NinesClubSwitch.get()          the current club: { club_id, name, site_url, role, ... }
//   NinesClubSwitch.onChange(fn)   pages that follow the current club in place (home, Recos map);
//                                  on other pages, switching opens the same page for that club.
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) return;

  var access = null;
  var current = null;
  var handlers = [];

  function myClubs() { return ((access && access.clubs) || []).filter(function (c) { return c.role; }); }
  function key() {
    var id = access && access.session && access.session.user && access.session.user.id;
    return 'nines.currentClub.' + (id || 'anyone');
  }
  function stored() {
    try { return Number(window.localStorage.getItem(key())) || null; } catch (e) { return null; }
  }
  function store(id) {
    try { window.localStorage.setItem(key(), String(id)); } catch (e) { /* not remembered */ }
  }
  function fallback() { return { club_id: N.clubId, name: N.clubName }; }

  function compute() {
    var list = myClubs();
    var want = stored();
    return list.find(function (c) { return c.club_id === want; }) ||
      list.find(function (c) { return c.club_id === N.clubId; }) || list[0] || fallback();
  }

  function get() { return current || fallback(); }
  function onChange(fn) { handlers.push(fn); }

  function choose(club) {
    if (!club || club.club_id === get().club_id) return;
    current = club;
    store(club.club_id);
    paint();
    if (handlers.length) handlers.forEach(function (fn) { fn(club); });
    else window.location.assign(N.clubPageUrl(club));
  }

  var slots = [];
  function paint() {
    slots.forEach(function (s) {
      s.label.textContent = get().name;
      s.button.setAttribute('aria-label', 'Current club: ' + get().name + '. Change club');
      s.items.forEach(function (b) { b.setAttribute('aria-checked', String(Number(b.dataset.club) === get().club_id)); });
    });
  }

  function render(slot) {
    var el = N.el;
    var label = el('span', { className: 'club-switch-name', 'data-no-i18n': true, text: get().name });
    var button = el('button', { type: 'button', className: 'club-switch-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
                                'aria-label': 'Current club: ' + get().name + '. Change club' }, [label, el('span', { className: 'club-switch-caret', 'aria-hidden': 'true', text: '▾' })]);
    var menu = el('ul', { className: 'club-switch-menu', role: 'menu', hidden: true });
    var items = myClubs().map(function (c) {
      var b = el('button', { type: 'button', role: 'menuitemradio', className: 'club-switch-item', 'data-club': String(c.club_id),
                             'aria-checked': String(c.club_id === get().club_id), 'data-no-i18n': true, text: c.name });
      b.addEventListener('click', function () { open(false); button.focus(); choose(c); });
      menu.appendChild(el('li', { role: 'none' }, [b]));
      return b;
    });
    function open(on) {
      menu.hidden = !on;
      button.setAttribute('aria-expanded', String(on));
      if (on) (items.find(function (b) { return b.getAttribute('aria-checked') === 'true'; }) || items[0]).focus();
    }
    button.addEventListener('click', function (e) { e.stopPropagation(); open(menu.hidden); });
    menu.addEventListener('keydown', function (e) {
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { open(false); button.focus(); }
    });
    document.addEventListener('click', function (e) { if (!menu.hidden && !slot.contains(e.target)) open(false); });
    slot.replaceChildren(button, menu);
    slot.hidden = false;
    if (slot.parentElement) slot.parentElement.classList.add('has-club-switch');
    slots.push({ label: label, items: items, button: button });
  }

  function mount(a) {
    access = a;
    current = compute();
    if (myClubs().length < 2) return;   // one club: no switch, nothing changes
    document.querySelectorAll('[data-club-switch]').forEach(render);
  }

  window.NinesClubSwitch = { mount: mount, get: get, onChange: onChange };
})();
