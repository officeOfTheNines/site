// Dinner scores on the member map's Dinners view: pins, medals and score buttons.
// Colours are medals, per club year (season) and for the score chosen (Overall, Food, Wine, Vibe):
// gold = the year's best dinner, silver = 2nd, bronze = 3rd, dark green = the others, grey = not rated.
// Tied scores share a place (two firsts are both gold, the next is 3rd). No legend: it took too much room.
// Columns: rating_food = plate, rating_wine = bottles, rating_vibe = atmosphere ("Vibe", as on the maps).
// Overall comes from the database with the maps' formula: (2 x food + wine + vibe) / 4, all three needed.
(function () {
  'use strict';

  var MODES = [
    { key: 'overall', label: 'Overall' },
    { key: 'food', label: 'Food' },
    { key: 'wine', label: 'Wine' },
    { key: 'atmosphere', label: 'Vibe' }
  ];
  var COLUMN = { overall: 'overall', food: 'rating_food', wine: 'rating_wine', atmosphere: 'rating_vibe' };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // The selected score of one dinner, in the club's own scale (null when not rated).
  function scoreOf(dinner, mode) {
    return num(dinner[COLUMN[mode] || 'overall']);
  }

  // The club year a dinner belongs to: its season ("S4", "16-17"), else September to August from its date.
  function yearOf(dinner) {
    if (dinner.season) return String(dinner.season);
    var d = String(dinner.event_date || '');
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    if (!y) return '?';
    return m >= 9 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
  }

  var MEDALS = ['gold', 'silver', 'bronze'];

  // Medal of every dinner for one score: { dinner id: 'gold' | 'silver' | 'bronze' | 'other' | 'tbc' }.
  // Place = 1 + the number of dinners that year with a strictly higher score.
  function medals(dinners, mode) {
    var byYear = {}, out = {};
    dinners.forEach(function (d) {
      var score = scoreOf(d, mode);
      if (score === null) { out[d.event_id] = 'tbc'; return; }
      (byYear[yearOf(d)] = byYear[yearOf(d)] || []).push({ id: d.event_id, score: score });
    });
    Object.keys(byYear).forEach(function (y) {
      var list = byYear[y];
      list.forEach(function (x) {
        var place = 1 + list.filter(function (o) { return o.score > x.score; }).length;
        out[x.id] = MEDALS[place - 1] || 'other';
      });
    });
    return out;
  }

  var ORDER = { gold: 0, silver: 1, bronze: 2, other: 3, tbc: 4 };
  function better(a, b) { return ORDER[a] <= ORDER[b]; }

  // "7.5", "14.06" (at most two decimals, no trailing zeros)
  function short(v) { return String(Number(Number(v).toFixed(2))); }
  function withScale(v, scale) { return v === null ? null : short(v) + '/' + (scale || 10); }

  // A 28px dot showing the score inside a 44px tap target, coloured by its medal.
  function icon(score, medal) {
    return window.L.divIcon({
      className: 'pin pin--' + (medal || 'tbc'),
      html: '<span class="pin-dot">' + (score === null ? '–' : Number(score).toFixed(1)) + '</span>',
      iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14]
    });
  }

  window.NinesDinnerScores = { MODES: MODES, scoreOf: scoreOf, yearOf: yearOf, medals: medals, better: better, icon: icon, withScale: withScale, short: short };
})();
