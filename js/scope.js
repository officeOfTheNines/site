// The "My clubs | All clubs" choice, shared by the home feed and the Recos map.
// Remembered per member in this browser (localStorage); anything unreadable falls back to "My clubs".
//   NinesScope.get(userId)                     -> 'my_clubs' or 'all_clubs'
//   NinesScope.set(userId, scope)
//   NinesScope.toggle(container, userId, onChange) builds the segmented control in container
(function () {
  'use strict';

  var DEFAULT = 'my_clubs';
  var CHOICES = [
    { value: 'my_clubs', label: 'My clubs' },
    { value: 'all_clubs', label: 'All clubs' }
  ];

  function key(userId) { return 'nines.scope.' + (userId || 'anyone'); }

  function get(userId) {
    try {
      var v = window.localStorage.getItem(key(userId));
      return v === 'all_clubs' || v === 'my_clubs' ? v : DEFAULT;
    } catch (e) {
      return DEFAULT;
    }
  }

  function set(userId, scope) {
    try { window.localStorage.setItem(key(userId), scope); } catch (e) { /* not remembered */ }
  }

  // A two-option segmented control (radio group): arrow keys move between options.
  function toggle(container, userId, onChange) {
    var current = get(userId);
    var group = document.createElement('div');
    group.className = 'scope-toggle';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Show recos from');
    var buttons = CHOICES.map(function (choice) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'scope-option';
      b.setAttribute('role', 'radio');
      b.dataset.scope = choice.value;
      b.textContent = choice.label;
      b.addEventListener('click', function () { choose(choice.value, true); });
      b.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) return;
        e.preventDefault();
        var next = choice.value === 'my_clubs' ? 'all_clubs' : 'my_clubs';
        choose(next, true);
        buttons.filter(function (x) { return x.dataset.scope === next; })[0].focus();
      });
      group.appendChild(b);
      return b;
    });
    function paint() {
      buttons.forEach(function (b) {
        var on = b.dataset.scope === current;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    }
    function choose(value, notify) {
      if (value === current) return;
      current = value;
      set(userId, value);
      paint();
      if (notify && onChange) onChange(value);
    }
    paint();
    container.replaceChildren(group);
    return { value: function () { return current; } };
  }

  window.NinesScope = { get: get, set: set, toggle: toggle, DEFAULT: DEFAULT };
})();
