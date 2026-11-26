// Recos (members/recos.html): members' restaurant recommendations on their own map.
// Separate from the club's dinner map. What each person sees is decided by the database
// (reco_feed(), add_reco(), find_reco_place() and row-level security): this page only shows it.
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed || !window.L || !window.NinesPlaces) {
    window.NinesPageLoadFailed();
    return;
  }

  var client = N.client;
  var el = N.el;
  var VISIBILITY = ['everyone', 'club', 'me'];
  var VISIBILITY_TEXT = {
    everyone: 'Everyone: members of every club can see it.',
    club: 'My club: only members of the club you post as can see it.',
    me: 'Only me: nobody else can see it.'
  };
  var CENTRES = { 1: [51.5072, -0.1276], 2: [48.8566, 2.3522] }; // London, Paris
  // Where the back arrow goes: this club's member home (club news and recent activity).
  // Change it here if the home page moves.
  var BACK_URL = 'index.html';
  var LONG_PRESS_MS = 500;   // hold this long on the map to add a reco there (not on phones: + only)
  // Phones: the same breakpoint as the card sheet (700px). No + / − buttons (pinch and double-tap zoom) and
  // no adding by long-press, so a double-tap or a held tap only ever zooms.
  function isPhone() { return window.matchMedia('(max-width: 700px)').matches; }
  var PRESS_SLOP_PX = 8;     // moving further than this cancels the press (it is a drag)
  var NEARBY_M = 40;         // a long-press this close to a pin offers to add to that restaurant
  var TIP_KEY = 'nines.recos.longPressTipDismissed';
  // CARTO basemap key, the same one the dinner map uses. It is a browser key, so it is public by design;
  // the domains allowed to use it are set in the CARTO dashboard.
  var TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_4qad_1_15e6672081357063faf80bbe';
  var ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
  var dateFormat = new Intl.DateTimeFormat(N.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  var collator = new Intl.Collator(N.lang === 'fr' ? 'fr' : 'en-GB', { sensitivity: 'base' });

  var errorBox = document.getElementById('recos-error');
  var statusBox = document.getElementById('recos-status');
  var countNode = document.getElementById('recos-count');
  var emptyNode = document.getElementById('recos-empty');
  var searchInput = document.getElementById('recos-search');
  var searchClear = document.getElementById('recos-search-clear');
  var searchList = document.getElementById('recos-search-results');
  var tipNode = document.getElementById('recos-tip');
  var scopeEmptyNode = document.getElementById('recos-scope-empty');

  var addOpen = document.getElementById('add-open');
  var addPanel = document.getElementById('add-panel');
  var queryInput = document.getElementById('place-query');
  var searchStatus = document.getElementById('search-status');
  var resultsNode = document.getElementById('search-results');
  var placeStep = document.getElementById('place-step');
  var queryStep = document.getElementById('query-step');
  var nameInput = document.getElementById('place-name');
  var addressInput = document.getElementById('place-address');
  var bodyInput = document.getElementById('reco-body');
  var bodyCount = document.getElementById('reco-count');
  var visibilityInput = document.getElementById('reco-visibility');
  var visibilityValue = document.getElementById('reco-visibility-value');
  var postAsRow = document.getElementById('post-as-row');
  var postAs = document.getElementById('post-as');
  var duplicateBox = document.getElementById('duplicate-box');
  var duplicateComments = document.getElementById('duplicate-comments');
  var submitButton = document.getElementById('reco-submit');
  var cancelButton = document.getElementById('add-cancel');
  var closeButton = document.getElementById('add-close');
  var nameHint = document.getElementById('place-name-hint');
  var differentButton = document.getElementById('duplicate-different');

  var editDialog = document.getElementById('edit-dialog');
  var editBody = document.getElementById('edit-body');
  var editVisibility = document.getElementById('edit-visibility');
  var editError = document.getElementById('edit-error');
  var deleteDialog = document.getElementById('delete-reco-dialog');

  var map = null;
  var markers = {};       // place id -> Leaflet marker
  var places = [];        // [{ id, name, address, lat, lng, comments: [...] }]
  var addMap = null;
  var addMarker = null;
  var chosen = null;      // the place being added: { name, address, lat, lng, external_id }
  var duplicate = null;   // a visible matching place, when found
  var homeClub = null;
  var canAdd = false;     // members with a profile; office accounts cannot post
  var pressMarker = null; // temporary marker where a long-press happened
  var userId = null;
  var scope = 'my_clubs'; // shared with the home feed (js/scope.js)
  var scopeIds = null;    // "My clubs": the ids of the places in scope (from reco_scope_venue_ids)
  var forcedId = null;    // a place opened from a link stays on the map whatever the scope

  // Events mode: the current club's dinners instead of the recos (club_dinner_map)
  var MODE_KEY = 'nines.recos.mode';
  var mode = 'recos';            // 'recos' or 'events'
  var dinnerVenues = [];         // [{ id, name, address, lat, lng, scale, dinners: [newest first] }]
  var dinnerMarkers = {};        // venue id -> marker
  var dinnerClubId = null;       // whose dinners are loaded
  var scoreMode = 'overall';     // overall | food | wine | atmosphere

  var statusTimer = null;
  function showError(text) { clearTimeout(statusTimer); statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) {
    errorBox.textContent = '';
    statusBox.textContent = text || '';
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(function () { statusBox.textContent = ''; }, 5000);
  }

  function fold(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function dbMessage(error) {
    var msg = String((error && error.message) || '');
    if (/permission denied|row-level security|not allowed/i.test(msg)) return 'You do not have permission to do that.';
    if (/body_shape/.test(msg)) return 'Please write a reco of 1 to 300 characters.';
    if (/name_shape/.test(msg)) return 'Please enter the restaurant\'s name.';
    return msg || N.friendlyError(error);
  }

  // Asks a <dialog> and resolves true when confirmed.
  function confirmDialog(dialog) {
    return new Promise(function (resolve) {
      function done() { dialog.removeEventListener('close', done); resolve(dialog.returnValue === 'confirm'); }
      dialog.returnValue = '';
      dialog.addEventListener('close', done);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.returnValue = window.confirm(dialog.textContent.replace(/\s+/g, ' ').trim()) ? 'confirm' : 'cancel'; done(); }
    });
  }

  // ---- One comment line: "First L., Club name: description. 17 Nov 2026" ----

  function commentLine(c, withActions) {
    var body = String(c.body || '').trim();
    if (!/[.!?…]$/.test(body)) body += '.';
    var li = el('li', { className: 'reco-line' });
    var text = el('p', { className: 'reco-text' });
    text.appendChild(el('span', { className: 'reco-author', 'data-no-i18n': true, text: c.author_label + ', ' + c.club_name + ': ' }));
    text.appendChild(el('span', { 'data-no-i18n': true, text: body + ' ' }));
    text.appendChild(el('span', { className: 'reco-date', 'data-no-i18n': true, text: dateFormat.format(new Date(c.created_at)) }));
    li.appendChild(text);
    if (c.visibility !== 'everyone') {
      li.appendChild(el('span', { className: 'card-label', text: c.visibility === 'club' ? 'My club' : 'Only me' }));
    }
    if (withActions && (c.is_mine || c.can_delete)) {
      var actions = el('span', { className: 'reco-actions' });
      if (c.is_mine) {
        var edit = el('button', { type: 'button', className: 'button link', text: 'Edit' });
        edit.addEventListener('click', function () { editComment(c); });
        actions.appendChild(edit);
      }
      var del = el('button', { type: 'button', className: 'button link danger-link', text: 'Delete' });
      del.addEventListener('click', function () { deleteComment(c); });
      actions.appendChild(del);
      li.appendChild(actions);
    }
    return li;
  }

  // Cards: a Leaflet popup on desktop and tablet; on phones (up to 700px) the same card in a bottom sheet
  // that slides up, as on the public dinner map (js/card-sheet.js).
  // Selected marker: the pin whose card is open gets a subtle, slowly pulsing white halo and is raised above
  // the others (same size), and every other pin fades to 45%. Cleared completely when its card closes (tap on the empty map,
  // X, swipe down, Escape), when another pin is chosen, and on any change of view, club, score or redraw;
  // clearing also removes a link's dinner / venue id from the address bar so a refresh does not reselect it.
  var cardSheet = null;
  var selected = null;
  var FOCUS_ZOOM = 16;
  function bindCard(marker, contentFn, popupOptions) {
    marker.bindPopup(contentFn, popupOptions);
    marker.off('click', marker._openPopup, marker);   // our own click handler picks popup or sheet
    marker.on('click', function () { showCard(marker); });
    marker.cardContent = contentFn;
  }
  function select(marker) {
    if (selected === marker) return;
    clearSelection();
    selected = marker;
    var node = marker.getElement();
    if (node) node.classList.add('is-selected');
    marker.setZIndexOffset(10000);
    map.getContainer().classList.add('has-selection');
  }
  function clearSelection() {
    if (map) map.getContainer().classList.remove('has-selection');
    if (!selected) return;
    var node = selected.getElement();
    if (node) node.classList.remove('is-selected');
    selected.setZIndexOffset(0);
    selected = null;
    var url = new URL(window.location.href);
    ['view', 'dinner', 'club', 'venue'].forEach(function (k) { url.searchParams.delete(k); });
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  function showCard(marker, sheetOptions) {
    if (cardSheet && window.NinesCardSheet.isPhone()) {
      map.closePopup();
      cardSheet.show(marker.cardContent(), marker.getLatLng(), sheetOptions);
    } else {
      if (cardSheet) cardSheet.close();
      marker.openPopup();
    }
    select(marker);
  }
  function closeCards() {
    map.closePopup();
    if (cardSheet) cardSheet.close();
    clearSelection();
  }
  // Opened by a link: open the card, then fly so the pin sits in the middle of the visible map (on phones,
  // above the sheet: the centre moves up by half the sheet's height), at street level.
  function focusMarker(marker) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var phone = cardSheet && window.NinesCardSheet.isPhone();
    if (phone) showCard(marker, { nudge: false });
    var z = FOCUS_ZOOM;
    var covered = phone ? cardSheet.peekHeight() : 0;
    var target = map.unproject(map.project(marker.getLatLng(), z).add([0, covered / 2]), z);
    if (!phone) map.once('moveend', function () { showCard(marker); });
    map.flyTo(target, z, { animate: !reduce, duration: 0.6 });
  }

  function popupContent(place) {
    var box = el('div', { className: 'reco-popup' }, [
      el('h3', { className: 'reco-place-name', 'data-no-i18n': true, text: place.name })
    ]);
    var addressNode = place.address ? el('p', { className: 'muted small', 'data-no-i18n': true, text: place.address }) : null;
    if (addressNode) box.appendChild(addressNode);
    // Directions (Google Maps, by transport, from where the member is; js/map-tools.js). The phone sheet
    // peeks down to here (.peek-end).
    if (window.NinesMapTools) {
      var go = window.NinesMapTools.actions({ name: place.name, address: place.address, lat: place.lat, lng: place.lng }, N.lang,
        { linkClass: 'button popup-directions' });
      box.appendChild(el('div', { className: 'popup-place-actions peek-end' }, [go.directions]));
    } else if (addressNode) {
      addressNode.classList.add('peek-end');
    }
    var list = el('ul', { className: 'reco-lines' });
    place.comments.forEach(function (c) { list.appendChild(commentLine(c, true)); });
    if (!place.comments.length) list.appendChild(el('li', { className: 'muted small', text: 'No recos you can see.' }));
    box.appendChild(list);
    return box;
  }

  // ---- Loading and drawing ----

  // "My clubs": which places to show (the database applies the same rules as the home feed).
  // "All clubs": every place the member can see, as before.
  async function loadScope() {
    scopeIds = null;
    if (scope !== 'my_clubs') return;
    var result = await client.rpc('reco_scope_venue_ids', { p_scope: 'my_clubs' });
    if (result.error) throw result.error;
    scopeIds = {};
    (result.data || []).forEach(function (row) {
      var id = typeof row === 'string' ? row : row.reco_scope_venue_ids;
      scopeIds[id] = true;
    });
  }

  function inScope(p) { return scope !== 'my_clubs' || !scopeIds || scopeIds[p.id] || p.id === forcedId; }

  async function load() {
    var result = await client.rpc('reco_feed');
    if (result.error) throw result.error;
    try {
      await loadScope();
    } catch (e) {
      scopeIds = null; // the scope could not be checked: show every reco the member can see
    }
    var byId = {};
    places = [];
    (result.data || []).forEach(function (row) {
      var place = byId[row.venue_id];
      if (!place) {
        place = byId[row.venue_id] = { id: row.venue_id, name: row.venue_name, address: row.address, lat: row.lat, lng: row.lng, comments: [] };
        places.push(place);
      }
      if (row.comment_id) place.comments.push(row);
    });
    places.forEach(function (p) {
      p.comments.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    });
    places.sort(function (a, b) { return collator.compare(a.name, b.name); });
    draw();
  }

  function pinIcon() {
    return L.divIcon({ className: 'reco-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });
  }

  function draw() {
    clearSelection();
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
    places.forEach(function (place) {
      var marker = L.marker([place.lat, place.lng], { icon: pinIcon(), title: place.name, alt: place.name, keyboard: true });
      // keep the open card clear of the top bar
      bindCard(marker, function () { return popupContent(place); }, { maxWidth: 320, autoPanPaddingTopLeft: [16, 88], autoPanPaddingBottomRight: [16, 40] });
      markers[place.id] = marker;
    });
    applyFilter();
    fitShown();
  }

  function fitShown() {
    var shown = places.filter(inScope);
    if (shown.length) {
      map.fitBounds(L.latLngBounds(shown.map(function (p) { return [p.lat, p.lng]; })), { padding: [40, 40], maxZoom: 15 });
    }
  }

  // ---- Search (top bar) ----
  // Only the recos this member may see are ever loaded (reco_feed applies the Everyone / My club /
  // Only me rules), so the search cannot find anything else. Matching ignores case and accents.
  // Each word must match. A word starting with # will match a tag once recos have tags
  // (place.tags, not stored yet); today such a word matches nothing.
  function matches(place, query) {
    var words = fold(query).split(/\s+/).filter(Boolean);
    var name = fold(place.name);
    return words.every(function (w) {
      if (w.charAt(0) === '#') return (place.tags || []).some(function (t) { return fold(t) === w.slice(1); });
      return name.indexOf(w) !== -1;
    });
  }

  function shownPlaces() {
    if (mode === 'events') return shownVenues();
    var q = searchInput.value.trim();
    return places.filter(function (p) { return inScope(p) && (!q || matches(p, q)); });
  }

  // Pins: only the matching recos while a search is typed.
  function applyFilter() {
    if (mode === 'events') { applyEventsFilter(); return; }
    var q = searchInput.value.trim();
    var shown = shownPlaces();
    places.forEach(function (p) {
      var on = shown.indexOf(p) !== -1;
      if (on && !map.hasLayer(markers[p.id])) markers[p.id].addTo(map);
      if (!on && map.hasLayer(markers[p.id])) markers[p.id].remove();
    });
    searchClear.hidden = !searchInput.value;
    emptyNode.hidden = places.length > 0;
    scopeEmptyNode.hidden = !(places.length > 0 && !q && shown.length === 0);
    countNode.textContent = q
      ? (shown.length === 1 ? '1 restaurant matches' : shown.length + ' restaurants match')
      : (places.length === 1 ? '1 restaurant' : places.length + ' restaurants');
  }

  var activeOption = -1;
  function closeResults() {
    searchList.hidden = true;
    searchList.replaceChildren();
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeOption = -1;
  }

  // The short list under the field: best matches first (names starting with the search).
  function showResults() {
    var q = fold(searchInput.value.trim());
    searchList.replaceChildren();
    activeOption = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (!q) { closeResults(); return; }
    var found = shownPlaces().slice().sort(function (a, b) {
      var sa = fold(a.name).indexOf(q) === 0 ? 0 : 1, sb = fold(b.name).indexOf(q) === 0 ? 0 : 1;
      return sa - sb || collator.compare(a.name, b.name);
    }).slice(0, 8);
    if (!found.length) {
      searchList.appendChild(el('li', { className: 'recos-search-none', text: mode === 'events' ? 'No dinners match.' : 'No recos match.' }));
    }
    found.forEach(function (p, i) {
      var li = el('li', { id: 'recos-option-' + i, role: 'option', className: 'recos-option', 'aria-selected': 'false' }, [
        el('span', { className: 'recos-option-name', 'data-no-i18n': true, text: p.name }),
        el('span', { className: 'muted small', text: p.dinners
          ? (p.dinners.length === 1 ? '1 dinner' : p.dinners.length + ' dinners')
          : (p.comments.length === 1 ? '1 reco' : p.comments.length + ' recos') })
      ]);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the field
      li.addEventListener('click', function () { pickResult(p); });
      li._place = p;
      searchList.appendChild(li);
    });
    searchList.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function highlight(index) {
    var options = searchList.querySelectorAll('[role="option"]');
    if (!options.length) return;
    activeOption = (index + options.length) % options.length;
    options.forEach(function (o, i) { o.setAttribute('aria-selected', i === activeOption ? 'true' : 'false'); });
    searchInput.setAttribute('aria-activedescendant', options[activeOption].id);
    options[activeOption].scrollIntoView({ block: 'nearest' });
  }

  function pickResult(place) {
    searchInput.value = place.name;
    applyFilter();
    closeResults();
    openPlace(place.id);
  }

  function clearSearch() {
    searchInput.value = '';
    applyFilter();
    closeResults();
    searchInput.focus();
  }

  searchInput.addEventListener('input', function () { applyFilter(); showResults(); });
  searchInput.addEventListener('focus', function () { if (searchInput.value.trim()) showResults(); });
  searchInput.addEventListener('blur', function () { setTimeout(closeResults, 150); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (searchList.hidden) showResults(); highlight(activeOption + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(activeOption - 1); }
    else if (e.key === 'Enter') {
      var options = searchList.querySelectorAll('[role="option"]');
      var pick = options[activeOption >= 0 ? activeOption : 0];
      if (pick) { e.preventDefault(); pickResult(pick._place); }
    } else if (e.key === 'Escape') {
      if (!searchList.hidden) closeResults(); else if (searchInput.value) clearSearch();
    }
  });
  searchClear.addEventListener('click', clearSearch);

  function openPlace(id, fromLink) {
    if (mode === 'events') { openVenue(id); return; }
    var marker = markers[id];
    if (!marker) return;
    if (!map.hasLayer(marker)) {
      searchInput.value = '';
      var place = places.find(function (p) { return p.id === id; });
      if (place && !inScope(place)) forcedId = id; // outside "My clubs": show it anyway
      applyFilter();
    }
    if (fromLink) { focusMarker(marker); return; }
    // jump (no animation) so the card can then pan itself clear of the top bar
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: false });
    showCard(marker);
  }

  async function refresh(openId, fromLink) {
    try {
      await load();
      if (openId) openPlace(openId, fromLink);
    } catch (error) {
      showError('Could not load the recos. ' + N.friendlyError(error));
    }
  }

  // ---- Edit and delete (own comments; club admins and super admins may delete) ----

  async function editComment(c) {
    editBody.value = c.body;
    editVisibility.value = c.visibility;
    editError.textContent = '';
    closeCards();
    if (!(await confirmDialog(editDialog))) return;
    var body = editBody.value.trim();
    if (!body || body.length > 300) { showError('Please write a reco of 1 to 300 characters.'); return; }
    var result = await client.from('reco_comments').update({ body: body, visibility: editVisibility.value })
      .eq('id', c.comment_id).select('id');
    if (result.error || !result.data || result.data.length !== 1) {
      showError('Could not save your reco. ' + (result.error ? dbMessage(result.error) : 'Please reload and try again.'));
      return;
    }
    showStatus('Your reco is saved.');
    await refresh(c.venue_id);
  }

  async function deleteComment(c) {
    closeCards();
    if (!(await confirmDialog(deleteDialog))) return;
    var result = await client.from('reco_comments').delete().eq('id', c.comment_id).select('id');
    if (result.error || !result.data || result.data.length !== 1) {
      showError('Could not delete the reco. ' + (result.error ? dbMessage(result.error) : 'Please reload and try again.'));
      return;
    }
    showStatus('The reco was deleted.');
    await refresh();
  }

  // ---- Adding a reco ----

  function visibilityChoice() { return VISIBILITY[Number(visibilityInput.value)] || 'everyone'; }

  function updateVisibilityText() {
    visibilityValue.textContent = VISIBILITY_TEXT[visibilityChoice()];
    visibilityInput.setAttribute('aria-valuetext', visibilityValue.textContent);
  }

  function updateCount() { bodyCount.textContent = bodyInput.value.length + ' of 300 characters'; }

  function resetAdd() {
    removePressMarker();
    queryStep.hidden = false;
    nameHint.textContent = '';
    nameInput.placeholder = '';
    queryInput.value = '';
    resultsNode.replaceChildren();
    searchStatus.textContent = '';
    placeStep.hidden = true;
    clearDuplicate();
    chosen = null;
    nameInput.value = '';
    addressInput.value = '';
    bodyInput.value = '';
    visibilityInput.value = '0';
    updateVisibilityText();
    updateCount();
  }

  // The add flow opens from the + button or from a long-press on the map.
  function openAdd() {
    closeCards();
    closeResults();
    addPanel.hidden = false;
    resetAdd();
  }
  function closeAdd() {
    addPanel.hidden = true;
    removePressMarker();
    addOpen.focus();
  }
  addOpen.addEventListener('click', function () {
    if (!canAdd) { showError('You need a member profile to add a reco.'); return; }
    openAdd();
    queryInput.focus();
  });
  cancelButton.addEventListener('click', closeAdd);
  closeButton.addEventListener('click', closeAdd);
  addPanel.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAdd(); });

  function choose(place, quiet) {
    chosen = { name: place.name || '', address: place.address || '', lat: place.lat, lng: place.lng, external_id: place.external_id || null };
    nameInput.value = chosen.name;
    addressInput.value = chosen.address;
    resultsNode.replaceChildren();
    searchStatus.textContent = '';
    clearDuplicate();
    placeStep.hidden = false;

    var spot = [chosen.lat, chosen.lng];
    if (!addMap) {
      addMap = L.map('add-map', { scrollWheelZoom: false }).setView(spot, 17);
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(addMap);
      addMarker = L.marker(spot, { draggable: true, icon: pinIcon(), keyboard: true, title: 'Drag to correct the location', alt: 'Restaurant location' }).addTo(addMap);
      addMarker.on('dragend', function () {
        var ll = addMarker.getLatLng();
        chosen.lat = ll.lat;
        chosen.lng = ll.lng;
        if (pressMarker) pressMarker.setLatLng(ll);
        clearDuplicate();
      });
    } else {
      addMarker.setLatLng(spot);
      addMap.setView(spot, 17);
    }
    setTimeout(function () { addMap.invalidateSize(); }, 50);
    if (!quiet) (chosen.name ? bodyInput : nameInput).focus();
  }

  // ---- Adding by long-press on the map ----

  function removePressMarker() {
    if (pressMarker) { pressMarker.remove(); pressMarker = null; }
  }

  function distanceM(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * r / 2) * Math.sin((lat2 - lat1) * r / 2) +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) * Math.sin((lng2 - lng1) * r / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function showDuplicate(place, offerDifferent) {
    duplicate = { id: place.id, name: place.name, address: place.address, lat: place.lat, lng: place.lng };
    var known = places.find(function (p) { return p.id === place.id; });
    duplicateComments.replaceChildren();
    ((known && known.comments) || []).forEach(function (c) { duplicateComments.appendChild(commentLine(c, false)); });
    duplicateBox.hidden = false;
    differentButton.hidden = !offerDifferent;
    submitButton.textContent = 'Add my reco to it';
  }

  var pressSeq = 0;
  var lastPressAt = 0;
  // Opens the add flow at a point of the map: a temporary marker there, the nearest restaurant's
  // name suggested (or an empty name to type), and, if the point is on or next to a reco the member
  // can see, the offer to add to that restaurant instead.
  async function addAt(latlng) {
    if (!canAdd || mode === 'events') return;   // no adding from the dinners view
    // a phone may send its own long-press event just after ours: ignore that repeat
    if (!addPanel.hidden && Date.now() - lastPressAt < 900) return;
    lastPressAt = Date.now();
    dismissTip();
    openAdd();
    pressMarker = L.marker(latlng, { icon: L.divIcon({ className: 'reco-pin reco-pin-new', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      keyboard: false, interactive: false, alt: 'New reco location' }).addTo(map);
    // the place is already chosen on the map: no restaurant search, the name field comes first,
    // and no field is focused (on a phone that would open the keyboard over the form)
    queryStep.hidden = true;
    choose({ name: '', address: '', lat: latlng.lat, lng: latlng.lng, external_id: null }, true);
    addPanel.scrollTop = 0;

    var nearest = null;
    places.forEach(function (p) {
      var d = distanceM(latlng.lat, latlng.lng, p.lat, p.lng);
      if (d <= NEARBY_M && (!nearest || d < nearest.d)) nearest = { place: p, d: d };
    });
    if (nearest) {
      nameInput.value = nearest.place.name;
      addressInput.value = nearest.place.address || '';
      nameHint.textContent = 'Already recommended near here.';
      showDuplicate(nearest.place, true);
      return;
    }
    await suggestName(latlng);
  }

  async function suggestName(latlng) {
    var seq = ++pressSeq;
    nameInput.placeholder = 'Looking up the nearest place…';
    nameHint.textContent = 'Looking up the nearest place…';
    var found = null;
    try {
      found = await window.NinesPlaces.nearestPlace(latlng.lat, latlng.lng);
    } catch (e) {
      found = null;
    }
    if (seq !== pressSeq || !chosen || addPanel.hidden) return;
    nameInput.placeholder = '';
    if (nameInput.value.trim()) { nameHint.textContent = ''; return; } // the member already typed a name
    if (found) {
      nameInput.value = found.name;
      if (!addressInput.value) addressInput.value = found.address || '';
      chosen.external_id = found.external_id;
      chosen.suggestedName = found.name;
      nameHint.textContent = 'Suggested from the map. Change it if needed.';
    } else {
      nameHint.textContent = 'No place found here. Type the restaurant\'s name.';
    }
  }

  differentButton.addEventListener('click', function () {
    var spot = chosen && L.latLng(chosen.lat, chosen.lng);
    nameInput.value = '';
    addressInput.value = '';
    clearDuplicate();
    if (spot) suggestName(spot);
  });

  // Long-press (touch, pen, or a long mouse press) and right-click both open the add flow.
  // A press is cancelled when the finger moves (a drag), a second finger touches (a pinch),
  // or the map starts moving or zooming.
  function setUpLongPress() {
    var box = map.getContainer();
    var press = null; // { id, x, y, timer }
    function cancel() { if (press) { clearTimeout(press.timer); press = null; } }
    box.addEventListener('pointerdown', function (e) {
      if (press && e.pointerId !== press.id) { cancel(); return; } // a second finger: a pinch
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return;
      if (mode === 'events' || isPhone()) return;   // phones add with the + button only
      cancel();
      var x = e.clientX, y = e.clientY;
      press = { id: e.pointerId, x: x, y: y, timer: setTimeout(function () {
        press = null;
        addAt(map.mouseEventToLatLng({ clientX: x, clientY: y }));
      }, LONG_PRESS_MS) };
    });
    // watched on the whole page: the other finger of a pinch may land on the bar or the tip
    document.addEventListener('pointerdown', function (e) {
      if (press && e.pointerId !== press.id) cancel();
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX) cancel();
    }, true);
    ['pointerup', 'pointercancel'].forEach(function (type) {
      document.addEventListener(type, function (e) { if (press && e.pointerId === press.id) cancel(); }, true);
    });
    map.on('movestart zoomstart', cancel);
    // right-click on a computer; some phones also send this after a long-press (ignored as a repeat)
    map.on('contextmenu', function (e) { cancel(); if (!isPhone()) addAt(e.latlng); });
  }

  // ---- First-visit tip ----

  function tipDismissed() {
    try { return window.localStorage.getItem(TIP_KEY) === '1'; } catch (e) { return false; }
  }
  function dismissTip() {
    tipNode.hidden = true;
    try { window.localStorage.setItem(TIP_KEY, '1'); } catch (e) { /* private mode: shown again next time */ }
  }
  document.getElementById('recos-tip-close').addEventListener('click', dismissTip);
  function showTip() {
    if (!canAdd || tipDismissed()) return;
    var desktop = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    document.getElementById('recos-tip-text').textContent = isPhone()
      ? 'Tip: press + to add a reco.'
      : desktop ? 'Tip: right-click (or long-press) the map to add a reco.' : 'Tip: long-press the map to add a reco.';
    tipNode.hidden = false;
  }

  var searchTimer = null;
  var searchSeq = 0;
  queryInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var text = queryInput.value.trim();
    resultsNode.replaceChildren();
    searchStatus.textContent = '';
    if (!text) return;

    var link = window.NinesPlaces.parseMapLink(text);
    if (link && link.needsFullLink) {
      searchStatus.textContent = 'Short links cannot be read. Open the link, then copy the full address from your browser and paste it here.';
      return;
    }
    if (link) {
      if (link.lat === null) {
        searchStatus.textContent = 'This link has no location. Search for the restaurant by name instead.';
        if (link.name) queryInput.value = link.name;
        return;
      }
      choose(link);
      if (!link.name) nameInput.focus();
      return;
    }
    if (text.length < 3) return;
    // wait until the member stops typing, to be gentle on the free search service
    searchTimer = setTimeout(function () { runSearch(text); }, 600);
  });

  async function runSearch(text) {
    var seq = ++searchSeq;
    searchStatus.textContent = 'Searching…';
    try {
      var centre = CENTRES[homeClub.id] || CENTRES[1];
      var found = await window.NinesPlaces.searchPlaces(text, { lat: centre[0], lng: centre[1] });
      if (seq !== searchSeq) return;
      resultsNode.replaceChildren();
      searchStatus.textContent = found.length ? '' : 'No places found. Try another spelling, or paste a Google Maps link.';
      found.forEach(function (place) {
        var b = el('button', { type: 'button', className: 'search-result' }, [
          el('span', { className: 'search-result-name', 'data-no-i18n': true, text: place.name }),
          el('span', { className: 'muted small', 'data-no-i18n': true, text: place.address || '' })
        ]);
        b.addEventListener('click', function () { choose(place); });
        resultsNode.appendChild(el('li', null, [b]));
      });
    } catch (error) {
      if (seq !== searchSeq) return;
      searchStatus.textContent = (error && error.message) || 'The place search is not available right now. Try again in a moment.';
    }
  }

  // A changed name or location needs a fresh duplicate check.
  function clearDuplicate() {
    duplicate = null;
    duplicateBox.hidden = true;
    differentButton.hidden = true;
    submitButton.textContent = 'Add my reco';
  }
  nameInput.addEventListener('input', function () { clearDuplicate(); nameHint.textContent = ''; });

  visibilityInput.addEventListener('input', updateVisibilityText);
  bodyInput.addEventListener('input', updateCount);

  // Before adding: a matching restaurant the member can already see? Then their reco joins it.
  // (A matching place they cannot see is handled by the database, without telling them.)
  submitButton.addEventListener('click', async function () {
    if (!chosen) return;
    var name = nameInput.value.trim();
    var body = bodyInput.value.trim();
    if (!name) { showError('Please enter the restaurant\'s name.'); nameInput.focus(); return; }
    if (!body || body.length > 300) { showError('Please write a reco of 1 to 300 characters.'); bodyInput.focus(); return; }
    var clubId = Number(postAs.value) || homeClub.id;
    // a place suggested from the map keeps its OpenStreetMap id only if its name was kept
    var externalId = chosen.suggestedName && name !== chosen.suggestedName ? null : chosen.external_id;

    submitButton.disabled = true;
    showError('');
    try {
      if (!duplicate) {
        var match = await client.rpc('find_reco_place', { p_name: name, p_lat: chosen.lat, p_lng: chosen.lng, p_external_id: externalId });
        if (match.error) throw match.error;
        if (match.data && match.data.length) {
          showDuplicate(match.data[0], false);
          duplicateBox.scrollIntoView({ block: 'nearest' });
          return; // the member confirms with a second click
        }
      }
      var result = await client.rpc('add_reco', {
        p_club: clubId,
        p_name: name,
        p_address: addressInput.value.trim() || null,
        p_lat: chosen.lat,
        p_lng: chosen.lng,
        p_external_id: externalId,
        p_body: body,
        p_visibility: visibilityChoice(),
        p_venue_id: duplicate ? duplicate.id : null
      });
      if (result.error) throw result.error;
      var added = result.data && result.data[0];
      addPanel.hidden = true;
      removePressMarker();
      submitButton.textContent = 'Add my reco';
      await refresh(added && added.venue_id);
      showStatus('Your reco is added.');
    } catch (error) {
      showError('Could not add your reco. ' + dbMessage(error));
    } finally {
      submitButton.disabled = false;
    }
  });


  // ---- Events mode: the current club's dinners ----

  var S = window.NinesDinnerScores;
  // [ Recos | Dinners ]: two options, the active one highlighted (a radio group for screen readers)
  var modeToggle = document.getElementById('mode-toggle');
  var modeOptions = Array.prototype.slice.call(modeToggle.querySelectorAll('.mode-option'));
  var scoresNode = document.getElementById('events-scores');
  var eventsEmpty = document.getElementById('events-empty');

  function readMode() {
    try { return window.localStorage.getItem(MODE_KEY) === 'events' ? 'events' : 'recos'; } catch (e) { return 'recos'; }
  }
  function saveMode(m) {
    try { window.localStorage.setItem(MODE_KEY, m); } catch (e) { /* not remembered */ }
  }
  function currentClubId() {
    return window.NinesClubSwitch ? window.NinesClubSwitch.get().club_id : homeClub.id;
  }

  async function loadDinners() {
    var club = currentClubId();
    var result = await client.rpc('club_dinner_map', { p_club: club });
    if (result.error) throw result.error;
    var byVenue = {};
    dinnerVenues = [];
    (result.data || []).forEach(function (d) {
      var v = byVenue[d.venue_id];
      if (!v) {
        v = byVenue[d.venue_id] = { id: d.venue_id, name: d.venue_name, address: d.address, lat: d.lat, lng: d.lng,
                                    scale: d.rating_scale || 10, dinners: [] };
        dinnerVenues.push(v);
      }
      v.dinners.push(d);
    });
    dinnerVenues.forEach(function (v) {
      v.dinners.sort(function (a, b) { return String(b.event_date).localeCompare(String(a.event_date)); });
    });
    dinnerVenues.sort(function (a, b) { return collator.compare(a.name, b.name); });
    dinnerClubId = club;
    drawDinners();
  }

  // One pin per venue, coloured by the newest dinner's selected score (grey when not rated). Season winners
  // (js/season-winners.js) for the category selected: the pin shows the winning dinner, with a gold ring,
  // four spikes and a badge with the season number; the badge only from BADGE_ZOOM, where the West End
  // pins stop piling up. Winners get no extra layering.
  var BADGE_ZOOM = 15;
  var winnersByMode = {}, seasonNumber = {};
  function showBadgesForZoom() {
    map.getContainer().classList.toggle('show-season-badges', map.getZoom() >= BADGE_ZOOM);
  }
  function drawDinners() {
    clearSelection();
    Object.keys(dinnerMarkers).forEach(function (id) { dinnerMarkers[id].remove(); });
    dinnerMarkers = {};
    var all = [].concat.apply([], dinnerVenues.map(function (v) { return v.dinners; }));
    winnersByMode = S.seasonWinners(all);
    seasonNumber = S.seasonNumbers(all);
    var wins = winnersByMode[scoreMode] || {};
    dinnerVenues.forEach(function (v) {
      var won = v.dinners.filter(function (d) { return wins[d.event_id]; })
        .sort(function (a, b) { return (seasonNumber[b.event_id] || 0) - (seasonNumber[a.event_id] || 0); })[0];
      var shown = won || v.dinners[0];
      var score = S.scoreOf(shown, scoreMode);
      var label = v.name + ', ' + (score === null ? 'Not rated' : S.withScale(score, v.scale)) +
        (won ? ', winner of season ' + seasonNumber[won.event_id] : '');
      var marker = L.marker([v.lat, v.lng], { icon: S.icon(score, v.scale, won ? seasonNumber[won.event_id] : null), title: label, alt: label, keyboard: true });
      bindCard(marker, function () { return venuePopup(v); }, {
        className: 'dinner-leaflet-popup', minWidth: 260, maxWidth: 340,
        maxHeight: Math.max(260, Math.round(window.innerHeight * 0.62)),
        autoPanPaddingTopLeft: [16, 140], autoPanPaddingBottomRight: [16, 96]
      });
      dinnerMarkers[v.id] = marker;
    });
    applyEventsFilter();
  }

  function shownVenues() {
    var q = searchInput.value.trim();
    return dinnerVenues.filter(function (v) { return !q || matches(v, q); });
  }

  function applyEventsFilter() {
    Object.keys(markers).forEach(function (id) { if (map.hasLayer(markers[id])) markers[id].remove(); });
    var shown = shownVenues();
    dinnerVenues.forEach(function (v) {
      var m = dinnerMarkers[v.id], on = shown.indexOf(v) !== -1;
      if (on && !map.hasLayer(m)) m.addTo(map);
      if (!on && map.hasLayer(m)) m.remove();
    });
    searchClear.hidden = !searchInput.value;
    emptyNode.hidden = true;
    scopeEmptyNode.hidden = true;
    eventsEmpty.hidden = dinnerVenues.length > 0;
    var q = searchInput.value.trim();
    countNode.textContent = q
      ? (shown.length === 1 ? '1 restaurant matches' : shown.length + ' restaurants match')
      : (dinnerVenues.length === 1 ? '1 restaurant' : dinnerVenues.length + ' restaurants');
  }

  function openVenue(id) {
    var marker = dinnerMarkers[id];
    if (!marker) return;
    if (!map.hasLayer(marker)) { searchInput.value = ''; applyEventsFilter(); }
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: false });
    showCard(marker);
  }

  // Centre and zoom on the pin of one dinner (by its club_event id) and open its card; false if the dinner
  // is not on this map (not the member's club, hidden, or no venue).
  function openDinner(eventId) {
    var v = dinnerVenues.find(function (x) { return x.dinners.some(function (d) { return d.event_id === eventId; }); });
    var marker = v && dinnerMarkers[v.id];
    if (!marker) return false;
    if (!map.hasLayer(marker)) { searchInput.value = ''; applyEventsFilter(); }
    focusMarker(marker);
    return true;
  }

  function fitDinners() {
    if (dinnerVenues.length) {
      map.fitBounds(L.latLngBounds(dinnerVenues.map(function (v) { return [v.lat, v.lng]; })), { padding: [48, 48], maxZoom: 15 });
    }
  }

  async function openMenu(url) {
    if (/^https:\/\//.test(url)) { window.open(url, '_blank', 'noopener'); return; }
    var tab = window.open('', '_blank');   // opened now, so the browser does not block it
    var result = await client.storage.from('menus').createSignedUrl(url.replace(/^menus\//, ''), 300);
    if (result.error || !result.data || !result.data.signedUrl) {
      if (tab) tab.close();
      showError('Could not open the menu. ' + N.friendlyError(result.error));
      return;
    }
    if (tab) { tab.opener = null; tab.location = result.data.signedUrl; }
    else window.location.assign(result.data.signedUrl);
  }

  // ---- The dinner card, as on the dinner maps (season · month · number, name, address, brigadiers,
  // the selected score, Plate / Bottles / Atmosphere bars, View menu) ----

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "Jean-Baptiste Solanet" -> "Jean-Baptiste S." (first name + family-name initial, skipping "de", "van")
  function shortName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || '';
    for (var i = 1; i < parts.length; i++) {
      var c = parts[i].charAt(0);
      if (c !== c.toLowerCase()) return parts[0] + ' ' + c.toUpperCase() + '.';
    }
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  }
  function joinNames(list) {
    list = list.filter(Boolean);
    return list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }
  function eyebrowOf(d) {
    var month = d.month || (MONTHS[Number(String(d.event_date).slice(5, 7)) - 1] + '-' + String(d.event_date).slice(2, 4));
    var number = d.source_ref ? (String(d.source_ref).match(/#\S+$/) || [])[0] : null;
    return [d.season, month, number].filter(Boolean).join(' · ');
  }
  function scoreBar(label, value, scale) {
    var n = value === null || value === undefined ? null : Number(value);
    var fill = el('span', { className: 'dc-bar-fill' });
    fill.style.width = (n === null ? 0 : Math.max(0, Math.min(100, n / scale * 100))).toFixed(0) + '%';  // CSSOM: allowed by the page's policy
    return el('div', { className: 'dc-bar' }, [
      el('span', { className: 'dc-bar-label', text: label }),
      el('span', { className: 'dc-bar-track' }, [fill]),
      el('span', { className: 'dc-bar-value', 'data-no-i18n': true, text: n === null ? '—' : n.toFixed(2) })
    ]);
  }

  function dinnerCard(d, v, first) {
    var go = null;
    var card = el('section', { className: 'dinner-card' + (first ? '' : ' dinner-card-earlier') });
    card.appendChild(el('p', { className: 'dc-eyebrow', 'data-no-i18n': true, text: eyebrowOf(d) }));
    // "Winner of Season 3 · Overall, Food": every category this dinner won, next to the venue name
    // (earlier dinners: under their season line)
    var wonIn = S.MODES.filter(function (m) { return (winnersByMode[m.key] || {})[d.event_id]; });
    var winLine = wonIn.length && seasonNumber[d.event_id] ? el('span', { className: 'dc-winner' }, [
      el('span', { text: 'Winner of Season' }), document.createTextNode(' '),
      el('span', { 'data-no-i18n': true, text: String(seasonNumber[d.event_id]) }), document.createTextNode(' · ')
    ].concat([].concat.apply([], wonIn.map(function (m, i) {
      return (i ? [document.createTextNode(', ')] : []).concat([el('span', { text: m.label })]);   // each label translated on its own
    })))) : null;
    if (first) {
      card.appendChild(el('h3', { className: 'dc-name' }, [el('span', { 'data-no-i18n': true, text: v.name }), winLine]));
    } else if (winLine) {
      card.appendChild(el('p', { className: 'dc-winner-row' }, [winLine]));
    }
    if (first) {
      var addressNode = v.address ? el('p', { className: 'dc-address', 'data-no-i18n': true, text: v.address }) : null;
      if (addressNode) card.appendChild(addressNode);
      go = window.NinesMapTools ? window.NinesMapTools.actions({ name: v.name, address: v.address, lat: v.lat, lng: v.lng }, N.lang,
        { linkClass: 'dc-menu dc-directions' }) : null;
    }
    if (d.brigadiers && d.brigadiers.length) {
      card.appendChild(el('p', { className: 'dc-brigadiers', 'data-no-i18n': true, text: joinNames(d.brigadiers.map(shortName)) }));
    }
    var rated = ['rating_food', 'rating_wine', 'rating_vibe'].some(function (k) { return d[k] !== null && d[k] !== undefined; });
    if (rated) {
      var score = S.scoreOf(d, scoreMode);
      var label = (S.MODES.find(function (m) { return m.key === scoreMode; }) || S.MODES[0]).label;
      card.appendChild(el('div', { className: 'dc-score-block' + (first ? ' peek-end' : '') }, [
        el('span', { className: 'dc-eyebrow', text: label + ' score' }),
        el('span', { className: 'dc-score-wrap' }, [
          el('span', { className: 'dc-score t-' + S.tier(score, v.scale), 'data-no-i18n': true, text: score === null ? '—' : score.toFixed(2) }),
          el('span', { className: 'dc-scale', 'data-no-i18n': true, text: '/' + v.scale })
        ])
      ]));
      card.appendChild(el('div', { className: 'dc-bars' }, [
        scoreBar('Plate', d.rating_food, v.scale),
        scoreBar('Bottles', d.rating_wine, v.scale),
        scoreBar('Atmosphere', d.rating_vibe, v.scale)
      ]));
    } else {
      card.appendChild(el('p', { className: 'dc-tbc' + (first ? ' peek-end' : ''), text: 'Ratings coming soon' }));
    }
    // the newest dinner's card: Directions (gold) next to View menu
    var buttons = first && go ? el('div', { className: 'dc-actions' }, [go.directions]) : null;
    if (d.menu_url) {
      var menu = el('button', { type: 'button', className: 'dc-menu', text: 'View menu' });
      menu.addEventListener('click', function () { openMenu(d.menu_url); });
      if (buttons) buttons.appendChild(menu); else card.appendChild(menu);
    }
    if (buttons) card.appendChild(buttons);
    if (!d.menu_url && first) card.appendChild(el('p', { className: 'dc-no-menu', text: 'Menu not yet available' }));
    return card;
  }

  function venuePopup(v) {
    var box = el('div', { className: 'dinner-popup' }, [dinnerCard(v.dinners[0], v, true)]);
    if (v.dinners.length > 1) {
      box.appendChild(el('p', { className: 'dc-earlier-heading', text: 'Earlier dinners here' }));
      v.dinners.slice(1).forEach(function (d) { box.appendChild(dinnerCard(d, v, false)); });
    }
    return box;
  }

  function buildScoreButtons() {
    scoresNode.replaceChildren();
    S.MODES.forEach(function (m) {
      var b = el('button', { type: 'button', role: 'radio', className: 'toggle-btn', 'aria-checked': String(m.key === scoreMode), text: m.label });
      b.addEventListener('click', function () {
        scoreMode = m.key;
        scoresNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        closeCards();
        drawDinners();
      });
      scoresNode.appendChild(b);
    });
  }

  // Switch between the recos and the dinners. The map keeps its position and zoom.
  async function setMode(next, fit) {
    mode = next;
    saveMode(next);
    var ev = next === 'events';
    modeOptions.forEach(function (b) {
      var on = b.dataset.mode === next;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    addOpen.hidden = ev || !canAdd;
    document.getElementById('recos-scope').hidden = ev;   // My clubs / All clubs: Recos only
    scoresNode.hidden = !ev;
    searchInput.placeholder = ev ? 'Search dinners' : 'Search recos';
    closeCards();
    closeResults();
    if (ev) {
      tipNode.hidden = true;
      if (!addPanel.hidden) closeAdd();
      if (dinnerClubId !== currentClubId()) {
        try { await loadDinners(); } catch (error) { showError('Could not load the dinners. ' + N.friendlyError(error)); return; }
        if (fit) fitDinners();
      } else {
        applyEventsFilter();
      }
    } else {
      Object.keys(dinnerMarkers).forEach(function (id) { dinnerMarkers[id].remove(); });
      eventsEmpty.hidden = true;
      applyFilter();
    }
    if (searchInput.value.trim()) showResults();
  }

  modeOptions.forEach(function (b) {
    b.addEventListener('click', function () { if (b.dataset.mode !== mode) setMode(b.dataset.mode, false); });
  });
  // arrow keys move between the two options, as in any radio group
  modeToggle.addEventListener('keydown', function (e) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) return;
    e.preventDefault();
    var next = mode === 'events' ? 'recos' : 'events';
    setMode(next, false);
    modeOptions.forEach(function (b) { if (b.dataset.mode === next) b.focus(); });
  });

  // ---- Start ----

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    homeClub = N.pickClub(access, false);
    // the clubs this person can post as (default: this site's club)
    var postable = (access.clubs || []).filter(function (c) { return c.role; });
    postAs.replaceChildren();
    postable.forEach(function (c) {
      var o = el('option', { value: String(c.club_id), text: c.name });
      if (c.club_id === homeClub.id) o.selected = true;
      postAs.appendChild(o);
    });
    if (!postable.length) postAs.appendChild(el('option', { value: String(homeClub.id), text: homeClub.name }));
    postAsRow.hidden = postable.length < 2;
    canAdd = !!access.profile; // office/staff accounts have no profile, so cannot post
    addOpen.hidden = !canAdd;
    if (!canAdd) emptyNode.textContent = 'No recos yet.';

    document.getElementById('recos-back').href = BACK_URL;
    userId = access.session && access.session.user && access.session.user.id;
    scope = window.NinesScope ? window.NinesScope.get(userId) : 'all_clubs';
    if (window.NinesScope) {
      window.NinesScope.toggle(document.getElementById('recos-scope'), userId, async function (value) {
        scope = value;
        forcedId = null;
        try {
          await loadScope();
        } catch (error) {
          showError('Could not load the recos. ' + N.friendlyError(error));
        }
        closeCards();
        applyFilter();
        if (searchInput.value.trim()) showResults();
        fitShown();
      });
    }
    N.showState('ready');
    // pinch and double-tap zoom on (the only zoom on phones, where the + / − buttons are hidden by CSS)
    map = L.map('recos-map', { zoomControl: false, touchZoom: true, doubleClickZoom: true }).setView(CENTRES[homeClub.id] || CENTRES[1], 13);
    cardSheet = window.NinesCardSheet ? window.NinesCardSheet.create(map, { onClose: clearSelection }) : null;   // phone cards
    map.on('popupclose', function (e) { if (selected && e.popup === selected.getPopup()) clearSelection(); });
    map.on('zoomend', showBadgesForZoom);   // season badges only from BADGE_ZOOM
    showBadgesForZoom();
    L.control.zoom({ position: 'topright' }).addTo(map);
    // "find me": asks for the position only when tapped; never stored or sent (js/map-tools.js)
    if (window.NinesMapTools) window.NinesMapTools.addLocate(map, { lang: N.lang, position: 'topright' });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
    setUpLongPress();
    updateVisibilityText();
    updateCount();
    buildScoreButtons();
    // Links into the map (ids only, never names or personal data):
    //   recos.html?venue=<id>                                (home feed) that reco, centred, card open
    //   recos.html?view=dinners&dinner=<club_event id>&club=<club id>   (home dinner panel) the Dinners view
    //       of that club, centred and zoomed on that dinner's pin with its card open; if the dinner is not
    //       on the member's map, the Dinners view opens as usual, without an error.
    var params = new URLSearchParams(window.location.search);
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var linked = params.get('venue');
    var linkedDinner = params.get('view') === 'dinners' && UUID.test(params.get('dinner') || '') ? params.get('dinner') : null;
    var linkedClub = /^[0-9]+$/.test(params.get('club') || '') ? Number(params.get('club')) : null;
    if (params.get('view') === 'dinners' && linkedClub && window.NinesClubSwitch) window.NinesClubSwitch.set(linkedClub);
    var startMode = params.get('view') === 'dinners' ? 'events' : linked ? 'recos' : readMode();
    if (startMode === 'recos') showTip();
    refresh(UUID.test(linked || '') ? linked : null, true).then(async function () {
      if (startMode !== 'events') { saveMode('recos'); return; }
      await setMode('events', !linkedDinner);
      if (linkedDinner && !openDinner(linkedDinner)) fitDinners();
    });
    // the current club (members of several clubs): its dinners and scale, in place
    if (window.NinesClubSwitch) {
      window.NinesClubSwitch.onChange(async function () {
        if (mode !== 'events') { dinnerClubId = null; return; }
        closeCards();
        try { await loadDinners(); fitDinners(); } catch (error) { showError('Could not load the dinners. ' + N.friendlyError(error)); }
      });
    }
  });
})();
