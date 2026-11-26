// Phone bottom sheet for map cards, copied from the public dinner map (map.thenines.club): same breakpoint
// (700px), states, animation and gestures. On wider screens the page keeps its Leaflet popups.
//
//   var sheet = NinesCardSheet.create(map, { onClose: fn })   // map: the Leaflet map; onClose: when it closes
//   NinesCardSheet.isPhone()                    // true up to 700px wide
//   sheet.show(node, latlng, { nudge: false })  // put a card in the sheet and slide it up to "peek" (nudge: move
//                                               // the map so the pin shows above it; default true)
//   sheet.close()
//   sheet.peekHeight()                          // how much of the screen the sheet covers now (0 when closed)
//
// States: closed | peek (up to the card's .peek-end element) | open (full height, scrolls).
//   - drag the bar (or the peeking card) up more than 50px: open; down: peek, or close from peek
//   - tap the grab handle: open / back to peek; tap the peeking card (not a button or link): open
//   - the X, Escape, or a tap on the empty map: close
(function () {
  'use strict';

  var QUERY = '(max-width: 700px)';
  function isPhone() { return window.matchMedia(QUERY).matches; }

  function create(map, options) {
    var opts = options || {};
    var panel = document.createElement('aside');
    panel.className = 'card-sheet';
    panel.setAttribute('aria-label', 'Selected restaurant');
    panel.innerHTML = '<div class="sheet-bar">' +
      '<button class="sheet-grab" type="button" aria-label="Show more details"><span></span></button>' +
      '<button class="sheet-close" type="button" aria-label="Close">✕</button></div>' +
      '<div class="card-sheet-body" aria-live="polite"></div>';   // fixed markup, no data
    document.body.appendChild(panel);
    var grab = panel.querySelector('.sheet-grab');
    var closeButton = panel.querySelector('.sheet-close');
    var body = panel.querySelector('.card-sheet-body');

    var state = 'closed';   // closed | peek | open
    var drag = null;
    var justDragged = false;
    var lastLatLng = null;

    function set(next) {
      var was = state;
      state = next;
      panel.classList.toggle('sheet-peek', next === 'peek');
      panel.classList.toggle('sheet-open', next === 'open');
      if (next !== 'open') panel.scrollTop = 0;
      grab.setAttribute('aria-label', next === 'open' ? 'Show less' : 'Show more details');
      if (next === 'closed') panel.setAttribute('aria-hidden', 'true'); else panel.removeAttribute('aria-hidden');
      if (next === 'closed' && was !== 'closed' && opts.onClose) opts.onClose();
    }

    function close() {
      if (state === 'closed') return;
      set('closed');
    }

    // The peek shows everything down to the card's .peek-end element (the score, or Directions)
    function updatePeek() {
      var end = body.querySelector('.peek-end');
      if (!end) { panel.style.removeProperty('--peek'); return; }
      var bottom = end.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + panel.scrollTop;
      panel.style.setProperty('--peek', Math.ceil(bottom + 4) + 'px');
    }
    function peekHeight() {
      return parseFloat(getComputedStyle(panel).getPropertyValue('--peek')) || 220;
    }

    // Nudge the map so the chosen pin is not hidden behind the peeking sheet
    function showPinAboveSheet(latlng) {
      if (!latlng) return;
      var size = map.getSize();
      var visibleH = size.y - peekHeight();
      var pt = map.latLngToContainerPoint(latlng);
      if (pt.y > visibleH - 40 || pt.y < 110 || pt.x < 30 || pt.x > size.x - 30) {
        map.panBy([pt.x - size.x / 2, pt.y - (110 + visibleH) / 2]);   // 110: below the search bar
      }
    }

    function show(node, latlng, showOptions) {
      body.replaceChildren(node);
      lastLatLng = latlng || null;
      set('peek');
      updatePeek();
      if (!showOptions || showOptions.nudge !== false) showPinAboveSheet(lastLatLng);
    }

    function offset() {
      var h = panel.offsetHeight;
      return state === 'open' ? 0 : state === 'peek' ? h - peekHeight() : h;
    }

    panel.addEventListener('pointerdown', function (e) {
      if (!isPhone() || state === 'closed' || e.target.closest('.sheet-close')) return;
      if (state === 'open' && !e.target.closest('.sheet-bar')) return;   // let the content scroll
      drag = { id: e.pointerId, y0: e.clientY, t0: offset(), moved: false, dy: 0 };
    });
    panel.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = e.clientY - drag.y0;
      if (!drag.moved && Math.abs(drag.dy) > 6) {
        drag.moved = true;
        try { panel.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        panel.classList.add('dragging');
      }
      if (drag.moved) {
        var t = Math.max(0, Math.min(panel.offsetHeight, drag.t0 + drag.dy));
        panel.style.transform = 'translateY(' + t + 'px)';
      }
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var moved = drag.moved, dy = drag.dy;
      drag = null;
      if (!moved) return;
      justDragged = true;
      setTimeout(function () { justDragged = false; }, 0);
      panel.classList.remove('dragging');
      panel.style.transform = '';
      if (dy < -50) set('open');
      else if (dy > 50) { if (state === 'open') set('peek'); else close(); }
      else set(state);
    }
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);

    grab.addEventListener('click', function () {
      if (justDragged) return;
      set(state === 'open' ? 'peek' : 'open');
    });
    closeButton.addEventListener('click', close);
    // Tapping the peeking card (not a button or link) opens it fully
    panel.addEventListener('click', function (e) {
      if (justDragged || !isPhone() || state !== 'peek' || e.target.closest('button, a, input, select, textarea')) return;
      set('open');
    });
    // Tapping the empty map, or Escape, closes it
    map.on('click', function () { if (isPhone() && state !== 'closed') close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state !== 'closed') close(); });
    window.addEventListener('resize', function () { if (!isPhone()) close(); else if (state !== 'closed') updatePeek(); });

    set('closed');
    return { show: show, close: close, isOpen: function () { return state !== 'closed'; }, state: function () { return state; },
             peekHeight: function () { return state === 'closed' ? 0 : state === 'open' ? panel.offsetHeight : peekHeight(); } };
  }

  window.NinesCardSheet = { create: create, isPhone: isPhone };
})();
