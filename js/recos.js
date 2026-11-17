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
  // CARTO basemap key, the same one the dinner map uses. It is a browser key, so it is public by design;
  // the domains allowed to use it are set in the CARTO dashboard.
  var TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_4qad_1_15e6672081357063faf80bbe';
  var ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
  var dateFormat = new Intl.DateTimeFormat(N.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  var collator = new Intl.Collator(N.lang === 'fr' ? 'fr' : 'en-GB', { sensitivity: 'base' });

  var errorBox = document.getElementById('recos-error');
  var statusBox = document.getElementById('recos-status');
  var filterInput = document.getElementById('filter');
  var countNode = document.getElementById('recos-count');
  var emptyNode = document.getElementById('recos-empty');
  var listNode = document.getElementById('place-list');

  var addOpen = document.getElementById('add-open');
  var addPanel = document.getElementById('add-panel');
  var queryInput = document.getElementById('place-query');
  var searchStatus = document.getElementById('search-status');
  var resultsNode = document.getElementById('search-results');
  var placeStep = document.getElementById('place-step');
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

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }

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

  function popupContent(place) {
    var box = el('div', { className: 'reco-popup' }, [
      el('h3', { className: 'reco-place-name', 'data-no-i18n': true, text: place.name })
    ]);
    if (place.address) box.appendChild(el('p', { className: 'muted small', 'data-no-i18n': true, text: place.address }));
    var list = el('ul', { className: 'reco-lines' });
    place.comments.forEach(function (c) { list.appendChild(commentLine(c, true)); });
    if (!place.comments.length) list.appendChild(el('li', { className: 'muted small', text: 'No recos you can see.' }));
    box.appendChild(list);
    return box;
  }

  // ---- Loading and drawing ----

  async function load() {
    var result = await client.rpc('reco_feed');
    if (result.error) throw result.error;
    var byId = {};
    places = [];
    (result.data || []).forEach(function (row) {
      var place = byId[row.place_id];
      if (!place) {
        place = byId[row.place_id] = { id: row.place_id, name: row.place_name, address: row.address, lat: row.lat, lng: row.lng, comments: [] };
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
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
    places.forEach(function (place) {
      var marker = L.marker([place.lat, place.lng], { icon: pinIcon(), title: place.name, alt: place.name, keyboard: true });
      marker.bindPopup(function () { return popupContent(place); }, { maxWidth: 320, autoPanPadding: [24, 24] });
      markers[place.id] = marker;
    });
    applyFilter();
    if (places.length) {
      map.fitBounds(L.latLngBounds(places.map(function (p) { return [p.lat, p.lng]; })), { padding: [40, 40], maxZoom: 15 });
    }
  }

  function applyFilter() {
    var q = fold(filterInput.value.trim());
    var shown = places.filter(function (p) { return !q || fold(p.name).indexOf(q) !== -1; });
    places.forEach(function (p) {
      var on = shown.indexOf(p) !== -1;
      if (on && !map.hasLayer(markers[p.id])) markers[p.id].addTo(map);
      if (!on && map.hasLayer(markers[p.id])) markers[p.id].remove();
    });

    listNode.replaceChildren();
    shown.forEach(function (p) {
      var button = el('button', { type: 'button', className: 'place-link' }, [
        el('span', { className: 'place-link-name', 'data-no-i18n': true, text: p.name }),
        el('span', { className: 'muted small', text: p.comments.length === 1 ? '1 reco' : p.comments.length + ' recos' })
      ]);
      button.addEventListener('click', function () { openPlace(p.id); });
      listNode.appendChild(el('li', null, [button]));
    });
    emptyNode.hidden = places.length > 0;
    countNode.textContent = q
      ? (shown.length === 1 ? '1 restaurant matches' : shown.length + ' restaurants match')
      : (places.length === 1 ? '1 restaurant' : places.length + ' restaurants');
  }

  function openPlace(id) {
    var marker = markers[id];
    if (!marker) return;
    if (!map.hasLayer(marker)) { filterInput.value = ''; applyFilter(); }
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
    marker.openPopup();
    document.getElementById('recos-map').scrollIntoView({ block: 'nearest' });
  }

  async function refresh(openId) {
    try {
      await load();
      if (openId) openPlace(openId);
    } catch (error) {
      showError('Could not load the recos. ' + N.friendlyError(error));
    }
  }

  // ---- Edit and delete (own comments; club admins and super admins may delete) ----

  async function editComment(c) {
    editBody.value = c.body;
    editVisibility.value = c.visibility;
    editError.textContent = '';
    map.closePopup();
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
    await refresh(c.place_id);
  }

  async function deleteComment(c) {
    map.closePopup();
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

  addOpen.addEventListener('click', function () {
    addPanel.hidden = false;
    addOpen.hidden = true;
    resetAdd();
    queryInput.focus();
  });
  cancelButton.addEventListener('click', function () {
    addPanel.hidden = true;
    addOpen.hidden = false;
    addOpen.focus();
  });

  function choose(place) {
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
        clearDuplicate();
      });
    } else {
      addMarker.setLatLng(spot);
      addMap.setView(spot, 17);
    }
    setTimeout(function () { addMap.invalidateSize(); }, 50);
    (chosen.name ? bodyInput : nameInput).focus();
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
    submitButton.textContent = 'Add my reco';
  }
  nameInput.addEventListener('input', clearDuplicate);

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

    submitButton.disabled = true;
    showError('');
    try {
      if (!duplicate) {
        var match = await client.rpc('find_reco_place', { p_name: name, p_lat: chosen.lat, p_lng: chosen.lng, p_external_id: chosen.external_id });
        if (match.error) throw match.error;
        if (match.data && match.data.length) {
          duplicate = match.data[0];
          var known = places.find(function (p) { return p.id === duplicate.id; });
          duplicateComments.replaceChildren();
          ((known && known.comments) || []).forEach(function (c) { duplicateComments.appendChild(commentLine(c, false)); });
          duplicateBox.hidden = false;
          submitButton.textContent = 'Add my reco to it';
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
        p_external_id: chosen.external_id,
        p_body: body,
        p_visibility: visibilityChoice(),
        p_place_id: duplicate ? duplicate.id : null
      });
      if (result.error) throw result.error;
      var added = result.data && result.data[0];
      addPanel.hidden = true;
      addOpen.hidden = false;
      submitButton.textContent = 'Add my reco';
      await refresh(added && added.place_id);
      showStatus('Your reco is added.');
    } catch (error) {
      showError('Could not add your reco. ' + dbMessage(error));
    } finally {
      submitButton.disabled = false;
    }
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
    if (!access.profile) {
      addOpen.hidden = true; // office/staff accounts have no profile, so cannot post
    }

    N.showState('ready');
    map = L.map('recos-map', { scrollWheelZoom: false }).setView(CENTRES[homeClub.id] || CENTRES[1], 13);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
    updateVisibilityText();
    updateCount();
    filterInput.addEventListener('input', applyFilter);
    refresh();
  });
})();
