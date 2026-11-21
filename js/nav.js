// Shared top bar for every page under members/.
//
// Usage: put <header class="site-header" data-nav="home"></header> at the top of the page
// (data-nav = the key of the current page) and load this script before the page script.
// To add a link in a later step, add an entry to LINKS below.
(function () {
  'use strict';

  var LINKS = [
    { key: 'home', label: 'Home', href: 'index.html' },
    { key: 'directory', label: 'Directory', href: 'directory.html' },
    { key: 'recos', label: 'Recos', href: 'recos.html' },
    { key: 'map', label: 'Map', href: (window.NINES_CLUB && window.NINES_CLUB.MAP_URL) || 'https://map.thenines.club', external: true },
    { key: 'dinners', label: 'Dinners', href: 'dinners.html', adminOnly: true },
    { key: 'admin', label: 'Admin', href: 'admin.html', adminOnly: true }
  ];

  // Pages where the links make sense: a member who is allowed in, or an admin-only page turning a member away.
  var LINK_STATES = 'ready not-admin not-found no-card';

  var header = document.querySelector('header[data-nav]');
  if (!header) return;
  var current = header.getAttribute('data-nav');

  function make(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (attrs[key] === true) node.setAttribute(key, '');
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    if (text) node.textContent = text;
    return node;
  }

  var inner = make('div', { class: 'site-header-inner' });

  var brand = make('a', { class: 'brand', href: 'index.html' });
  var logo = make('img', { 'data-logo': true, src: '../favicon.png', alt: '', width: '36', height: '36' });
  logo.addEventListener('error', function () { logo.hidden = true; });
  brand.appendChild(logo);
  var clubConfig = window.NINES_CLUB || { NAME: 'The Nines', MAP_URL: 'https://map.thenines.club' };
  brand.appendChild(make('span', null, clubConfig.NAME));
  inner.appendChild(brand);

  var nav = make('nav', { class: 'site-nav', 'aria-label': 'Members', 'data-state': LINK_STATES, hidden: true });

  var toggle = make('button', {
    type: 'button',
    class: 'button secondary nav-toggle',
    'aria-expanded': 'false',
    'aria-controls': 'nav-menu'
  });
  toggle.appendChild(make('span', { 'aria-hidden': 'true', class: 'nav-toggle-icon' }));
  toggle.appendChild(make('span', null, 'Menu'));
  nav.appendChild(toggle);

  var list = make('ul', { id: 'nav-menu', class: 'nav-menu' });
  LINKS.forEach(function (link) {
    var item = make('li', link.adminOnly ? { 'data-admin-only': true, hidden: true } : (link.key === 'map' ? { id: 'nav-map-item' } : null));
    var attrs = { class: 'nav-link', href: link.href };
    if (link.external) {
      attrs.target = '_blank';
      attrs.rel = 'noopener';
    }
    if (link.key === current) attrs['aria-current'] = 'page';
    var a = make('a', attrs, link.label);
    if (link.external) a.appendChild(make('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));
    item.appendChild(a);
    list.appendChild(item);
  });
  var signOutItem = make('li');
  signOutItem.appendChild(make('button', { type: 'button', class: 'nav-link nav-signout', 'data-action': 'sign-out' }, 'Sign out'));
  list.appendChild(signOutItem);
  nav.appendChild(list);
  inner.appendChild(nav);

  header.replaceChildren(inner);

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  }
  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', function (event) {
    if (nav.classList.contains('is-open') && !nav.contains(event.target)) setOpen(false);
  });

  // For people in several clubs, "Map" becomes a small menu with each club's map (all public).
  // Called by auth.js once it knows the person's clubs.
  function setClubs(clubs) {
    var withMaps = (clubs || []).filter(function (c) { return c.map_url && /^https:\/\//.test(c.map_url); });
    var mapItem = document.getElementById('nav-map-item');
    if (!mapItem || withMaps.length < 2) return;

    var button = make('button', { type: 'button', class: 'nav-link nav-menu-button', 'aria-expanded': 'false', 'aria-controls': 'nav-map-menu' });
    button.appendChild(make('span', null, 'Map'));
    button.appendChild(make('span', { class: 'nav-caret', 'aria-hidden': 'true' }, '▾'));
    var sub = make('ul', { id: 'nav-map-menu', class: 'nav-submenu', hidden: true });
    withMaps.forEach(function (c) {
      var li = make('li');
      var a = make('a', { class: 'nav-link', href: c.map_url, target: '_blank', rel: 'noopener' }, c.name + ' map');
      a.appendChild(make('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));
      li.appendChild(a);
      sub.appendChild(li);
    });
    mapItem.classList.add('has-submenu');
    mapItem.replaceChildren(button, sub);

    function openSub(open) {
      button.setAttribute('aria-expanded', String(open));
      sub.hidden = !open;
    }
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      openSub(sub.hidden);
    });
    document.addEventListener('click', function (event) {
      if (!sub.hidden && !mapItem.contains(event.target)) openSub(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !sub.hidden) { openSub(false); button.focus(); }
    });
  }

  window.NinesNav = { setClubs: setClubs };
})();
