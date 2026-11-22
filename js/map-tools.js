// Map tools shared by every club map (members' Recos map and Events view, the public Nines and
// Les Ronds dinner maps). The SAME file is copied into each repo: change it in one, copy it to the others.
//
//   NinesMapTools.addLocate(map, { lang: 'en' | 'fr', position: 'topleft' | 'topright' })
//       a round "find me" button under the zoom buttons. Only when tapped does it ask the browser for the
//       position (navigator.geolocation.getCurrentPosition); it then shows a blue dot with its accuracy
//       circle and centres the map there. The position is never sent, logged or stored anywhere.
//   NinesMapTools.directionsUrl(place)   Google Maps directions to { name, address, postcode, lat, lng },
//       by public transport, from wherever the person is (no origin given).
//   NinesMapTools.addressText(place)     "name, address, postcode" (the postcode once).
//   NinesMapTools.actions(place, lang, options)  a Directions link + a "Copy address" button, ready to place.
(function () {
  'use strict';

  var TEXT = {
    en: {
      locate: 'Show my location', locating: 'Finding your location…', directions: 'Directions',
      copy: 'Copy address', copied: 'Copied', selected: 'Selected: press copy',
      denied: 'Location is off for this site. Allow it in your browser settings to see where you are.',
      unavailable: 'Your location is not available right now.',
      timeout: 'Finding your location took too long. Try again.',
      unsupported: 'This browser cannot share your location.'
    },
    fr: {
      locate: 'Afficher ma position', locating: 'Recherche de votre position…', directions: 'Itinéraire',
      copy: 'Copier l’adresse', copied: 'Copié', selected: 'Sélectionné : copiez',
      denied: 'La localisation est désactivée pour ce site. Autorisez-la dans les réglages du navigateur pour voir où vous êtes.',
      unavailable: 'Votre position n’est pas disponible pour le moment.',
      timeout: 'La recherche de votre position a pris trop de temps. Réessayez.',
      unsupported: 'Ce navigateur ne peut pas partager votre position.'
    }
  };
  function t(lang) { return TEXT[lang === 'fr' ? 'fr' : 'en']; }

  function make(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }

  // ---- Find me ----

  var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="4" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function addLocate(map, options) {
    var L = window.L;
    var opts = options || {};
    var words = t(opts.lang);
    var dot = null, ring = null, note = null, noteTimer = null;

    function say(text) {
      if (!note) {
        note = make('div', { 'class': 'locate-note', role: 'status', 'aria-live': 'polite', 'data-no-i18n': '' });
        map.getContainer().appendChild(note);
      }
      note.textContent = text;
      note.hidden = !text;
      clearTimeout(noteTimer);
      if (text) noteTimer = setTimeout(function () { note.hidden = true; }, 6000);
    }

    var Locate = L.Control.extend({
      options: { position: opts.position || 'topleft' },
      onAdd: function () {
        var bar = L.DomUtil.create('div', 'leaflet-bar locate-control');
        var button = make('button', { type: 'button', 'class': 'locate-button', 'aria-label': words.locate, title: words.locate, 'data-no-i18n': '' });
        button.innerHTML = ICON;   // a fixed icon, no data in it
        bar.appendChild(button);
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(button, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          if (!navigator.geolocation) { say(words.unsupported); return; }
          if (button.getAttribute('aria-busy') === 'true') return;
          button.setAttribute('aria-busy', 'true');
          say(words.locating);
          navigator.geolocation.getCurrentPosition(function (pos) {
            button.removeAttribute('aria-busy');
            say('');
            var here = [pos.coords.latitude, pos.coords.longitude];
            var accuracy = Math.max(5, pos.coords.accuracy || 0);
            if (!ring) {
              ring = L.circle(here, { radius: accuracy, className: 'locate-accuracy', color: '#3D8BFD', weight: 1, fillColor: '#3D8BFD', fillOpacity: 0.12, interactive: false }).addTo(map);
              dot = L.circleMarker(here, { radius: 7, className: 'locate-dot', color: '#FFFFFF', weight: 2, fillColor: '#3D8BFD', fillOpacity: 1, interactive: false }).addTo(map);
            } else {
              ring.setLatLng(here).setRadius(accuracy);
              dot.setLatLng(here);
            }
            map.setView(here, Math.max(map.getZoom(), accuracy <= 150 ? 16 : 14));
          }, function (err) {
            button.removeAttribute('aria-busy');
            say(err && err.code === 1 ? words.denied : err && err.code === 3 ? words.timeout : words.unavailable);
          }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
        });
        return bar;
      }
    });
    map.addControl(new Locate());
  }

  // ---- Directions and address ----

  function addressText(place) {
    var p = place || {};
    var name = String(p.name || '').trim(), address = String(p.address || '').trim(), postcode = String(p.postcode || '').trim();
    if (postcode && address.toLowerCase().indexOf(postcode.toLowerCase()) !== -1) postcode = '';
    return [name, address, postcode].filter(Boolean).join(', ');
  }

  function directionsUrl(place) {
    var p = place || {};
    var hasText = String(p.name || '').trim() && String(p.address || '').trim();
    var destination = hasText ? addressText(p) : Number(p.lat) + ',' + Number(p.lng);
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination) + '&travelmode=transit';
  }

  // Copies the text; without the clipboard, selects it (in `selectNode`) so the person can copy it.
  function copy(text, button, lang, selectNode) {
    var words = t(lang);
    var label = button.textContent;
    function done(msg) {
      button.textContent = msg;
      setTimeout(function () { button.textContent = label; }, 1800);
    }
    function select() {
      if (!selectNode) return;
      var range = document.createRange();
      range.selectNodeContents(selectNode);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      done(words.selected);
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { done(words.copied); }, select);
      } else {
        select();
      }
    } catch (e) {
      select();
    }
  }

  // A Directions link and a "Copy address" button. options.linkClass / options.copyClass style them.
  function actions(place, lang, options) {
    var o = options || {};
    var words = t(lang);
    var link = make('a', { 'class': o.linkClass || 'directions-link', href: directionsUrl(place), target: '_blank', rel: 'noopener', 'data-no-i18n': '' }, words.directions);
    var copyButton = make('button', { type: 'button', 'class': o.copyClass || 'copy-address', 'data-no-i18n': '' }, words.copy);
    copyButton.addEventListener('click', function () { copy(addressText(place), copyButton, lang, o.selectNode); });
    return { directions: link, copy: copyButton };
  }

  window.NinesMapTools = { addLocate: addLocate, directionsUrl: directionsUrl, addressText: addressText, actions: actions, copy: copy };
})();
