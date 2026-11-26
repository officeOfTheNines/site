// Dinner scores on a map: colour tiers, pins and score buttons, ported from the club dinner
// maps (map.thenines.club, ronds.thenines.club) so the Events view on the Recos map looks the same.
// Main map rules kept: gold from 7.5, silver from 6.5, bronze below (out of 10); Les Ronds' map uses
// 15 and 13 out of 20, which is the same once scores are scaled by the club's rating_scale.
// Columns: rating_food = plate, rating_wine = bottles, rating_vibe = atmosphere ("Vibe", as on the maps).
// Overall comes from the database with the maps' formula: (2 x food + wine + vibe) / 4, all three needed.
// Season winners (js/season-winners.js): the dinner(s) with the season's highest score in the category
// chosen get a gold ring with four small spikes around their circle, and a small gold badge with the season
// number (the badge only when zoomed in). The circle itself does not change. No legend.
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

  // Winners for every category at once: { overall: { dinner id: true }, food: …, wine: …, atmosphere: … },
  // within each season (and the one club loaded). Overall uses the exact formula, as the public map does.
  var W = window.NinesSeasonWinners;
  function exactScore(d, mode) {
    return mode === 'overall' ? W.overall(d.rating_food, d.rating_wine, d.rating_vibe) : num(d[COLUMN[mode]]);
  }
  var ROW = { id: function (d) { return d.event_id; }, season: function (d) { return d.season; }, date: function (d) { return d.event_date; } };
  function seasonWinners(dinners) {
    var out = {};
    MODES.forEach(function (m) {
      out[m.key] = W.winners(dinners, { id: ROW.id, season: ROW.season, date: ROW.date, score: function (d) { return exactScore(d, m.key); } });
    });
    return out;
  }
  function seasonNumbers(dinners) { return W.seasonNumbers(dinners, ROW); }

  // "7.5", "14.06" (at most two decimals, no trailing zeros)
  function short(v) { return String(Number(Number(v).toFixed(2))); }
  function withScale(v, scale) { return v === null ? null : short(v) + '/' + (scale || 10); }

  // The main map's pin: a 28px dot showing the score inside a 44px tap target; grey when not rated.
  // season = the season number when this pin is a season winner: gold ring (2px gap, 1px), four spikes and
  // a small badge with the number (CSS shows the badge only when zoomed in). Same size and colour of dot.
  var RING = '<span class="pin-ring" aria-hidden="true"><i class="pin-spike"></i><i class="pin-spike"></i><i class="pin-spike"></i><i class="pin-spike"></i></span>';
  function icon(score, scale, season) {
    var win = !!season;
    return window.L.divIcon({
      className: 'pin pin--' + tier(score, scale) + (win ? ' pin--winner' : ''),
      html: (win ? RING : '') + '<span class="pin-dot">' + (score === null ? '–' : Number(score).toFixed(1)) + '</span>' +
            (win ? '<span class="pin-badge" aria-hidden="true">' + Number(season) + '</span>' : ''),
      iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14]
    });
  }

  window.NinesDinnerScores = { MODES: MODES, scoreOf: scoreOf, exactScore: exactScore, tier: tier, seasonWinners: seasonWinners, seasonNumbers: seasonNumbers, icon: icon, withScale: withScale, short: short };
})();
