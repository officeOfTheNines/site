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
    { key: 'map', label: 'Map', href: 'https://map.thenines.club', external: true },
    { key: 'admin', label: 'Admin', href: 'admin.html', adminOnly: true }
  ];

  // Pages where the links make sense: a member who is allowed in, or an admin-only page turning a member away.
  var LINK_STATES = 'ready not-admin not-found';

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
  brand.appendChild(make('span', null, 'The Nines'));
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
    var item = make('li', link.adminOnly ? { 'data-admin-only': true, hidden: true } : null);
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
})();
