// Dinner scores on a map: colour tiers, pins, legend and score buttons, ported from the club dinner
// maps (map.thenines.club, ronds.thenines.club) so the Events view on the Recos map looks the same.
// Main map rules kept: gold from 7.5, silver from 6.5, bronze below (out of 10); Les Ronds' map uses
// 15 and 13 out of 20, which is the same once scores are scaled by the club's rating_scale.
// Columns: rating_food = plate, rating_wine = bottles, rating_vibe = atmosphere ("Vibe", as on the maps).
// Overall comes from the database with the maps' formula: (2 x food + wine + vibe) / 4, all three needed.
// The best dinner of each season (for the score chosen) gets a star instead of the round dot.
(function () {
  'use strict';

  var MODES = [
    { key: 'overall', label: 'Overall' },
    { key: 'food', label: 'Food' },
    { key: 'wine', label: 'Wine' },
    { key: 'atmosphere', label: 'Vibe' }
  ];
  var COLUMN = { overall: 'overall', food: 'rating_food', wine: 'rating_wine', atmosphere: 'rating_vibe' };
  var GOLD = 7.5, SILVER = 6.5;   // out of 10, as on the main map

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // The selected score of one dinner, in the club's own scale (null when not rated).
  function scoreOf(dinner, mode) {
    return num(dinner[COLUMN[mode] || 'overall']);
  }

  // Tier of a score, compared out of 10 whatever the club's scale.
  function tier(score, scale) {
    if (score === null) return 'tbc';
    var out10 = score / (scale || 10) * 10;
    if (out10 >= GOLD) return 'gold';
    if (out10 >= SILVER) return 'silver';
    return 'bronze';
  }

  // The club year a dinner belongs to: its season ("S4", "16-17"), else September to August from its date.
  function yearOf(dinner) {
    if (dinner.season) return String(dinner.season);
    var d = String(dinner.event_date || '');
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    if (!y) return '?';
    return m >= 9 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
  }

  // The best dinner of each season for one score: { dinner id: true } (dinners tied for first all count).
  function seasonBest(dinners, mode) {
    var top = {}, out = {};
    dinners.forEach(function (d) {
      var s = scoreOf(d, mode), y = yearOf(d);
      if (s !== null && (top[y] === undefined || s > top[y])) top[y] = s;
    });
    dinners.forEach(function (d) {
      var s = scoreOf(d, mode);
      if (s !== null && s === top[yearOf(d)]) out[d.event_id] = true;
    });
    return out;
  }

  // "7.5", "14.06" (at most two decimals, no trailing zeros)
  function short(v) { return String(Number(Number(v).toFixed(2))); }
  function withScale(v, scale) { return v === null ? null : short(v) + '/' + (scale || 10); }

  // The main map's pin: a 28px dot showing the score inside a 44px tap target; grey when not rated.
  // star = the season's best dinner for the chosen score: a star instead of the dot, same colour.
  function icon(score, scale, star) {
    return window.L.divIcon({
      className: 'pin pin--' + tier(score, scale) + (star ? ' pin--star' : ''),
      html: '<span class="pin-dot">' + (score === null ? '–' : Number(score).toFixed(1)) + '</span>',
      iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14]
    });
  }

  // The main map's legend, with the thresholds in the club's scale, plus "Not rated".
  function legend(container, scale) {
    var s = scale || 10;
    var gold = short(GOLD / 10 * s), silver = short(SILVER / 10 * s);
    var items = [['gold', gold + '+'], ['silver', silver + '–' + gold], ['bronze', 'Under ' + silver], ['tbc', 'Not rated'], ['star', 'Best of the season']];
    container.replaceChildren.apply(container, items.map(function (it) {
      var item = document.createElement('span');
      item.className = 'legend-item';
      var dot = document.createElement('span');
      dot.className = 'legend-dot legend-' + it[0];
      if (it[0] === 'star') dot.textContent = '★';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(it[1]));
      return item;
    }));
  }

  window.NinesDinnerScores = { MODES: MODES, scoreOf: scoreOf, tier: tier, yearOf: yearOf, seasonBest: seasonBest, icon: icon, legend: legend, withScale: withScale, short: short };
})();
