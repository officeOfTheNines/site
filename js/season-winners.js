// Season winners for dinner maps: which dinners had the highest score of their season, in one category.
// No dependencies, so any map can use it (the member map today; the public dinner maps could later).
//
//   NinesSeasonWinners.overall(plate, bottles, atmosphere)
//       0.5 x plate + 0.25 x bottles + 0.25 x atmosphere (= (2 x plate + bottles + atmosphere) / 4, as on the
//       public map); null unless all three are numbers.
//   NinesSeasonWinners.winners(rows, opts) -> { row id: true } for the winners
//       Within each club and each season, the row(s) with the highest score win; tied rows all win; rows
//       without a score cannot win. opts tells it how to read a row:
//         id(row), score(row) -> number or null, season(row) -> label or null, date(row) -> 'YYYY-MM-DD',
//         club(row) -> club id (optional: one club when left out)
//   NinesSeasonWinners.seasonKey(label, date)
//       The season label ("S3", "2018/2019"), or September to August from the date ("2025/2026").
//   NinesSeasonWinners.seasonNumbers(rows, opts) -> { row id: number }
//       "S3" -> 3; "2018/2019" -> years since the club's first such season + 1; otherwise the season's order
//       in the club (by its first date).
(function () {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function overall(plate, bottles, atmosphere) {
    var p = toNum(plate), b = toNum(bottles), a = toNum(atmosphere);
    return p === null || b === null || a === null ? null : 0.5 * p + 0.25 * b + 0.25 * a;
  }

  function seasonKey(label, date) {
    var l = String(label || '').trim();
    if (l) return l;
    var d = String(date || '');
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    if (!y) return '?';
    return m >= 9 ? y + '/' + (y + 1) : (y - 1) + '/' + y;
  }

  function groupKey(row, opts) {
    return String(opts.club ? opts.club(row) : '') + '|' + seasonKey(opts.season(row), opts.date(row));
  }

  var EPS = 1e-9;   // scores equal to the billionth count as a tie (floating point)

  function winners(rows, opts) {
    var top = {}, out = {};
    rows.forEach(function (r) {
      var s = opts.score(r), k = groupKey(r, opts);
      if (isNum(s) && (top[k] === undefined || s > top[k])) top[k] = s;
    });
    rows.forEach(function (r) {
      var s = opts.score(r);
      if (isNum(s) && Math.abs(s - top[groupKey(r, opts)]) < EPS) out[opts.id(r)] = true;
    });
    return out;
  }

  function seasonNumbers(rows, opts) {
    var byClub = {};
    rows.forEach(function (r) {
      var c = String(opts.club ? opts.club(r) : ''), k = seasonKey(opts.season(r), opts.date(r)), d = String(opts.date(r) || '');
      var seasons = byClub[c] = byClub[c] || {};
      if (!seasons[k] || d < seasons[k]) seasons[k] = d;
    });
    var numbers = {};
    Object.keys(byClub).forEach(function (c) {
      var seasons = byClub[c], keys = Object.keys(seasons);
      var years = keys.filter(function (k) { return /^\d{4}\/\d{4}$/.test(k); }).map(function (k) { return Number(k.slice(0, 4)); });
      var firstYear = years.length ? Math.min.apply(null, years) : null;
      var byDate = keys.slice().sort(function (a, b) { return seasons[a] < seasons[b] ? -1 : seasons[a] > seasons[b] ? 1 : 0; });
      numbers[c] = {};
      keys.forEach(function (k) {
        var m = /^S(\d+)$/i.exec(k);
        numbers[c][k] = m ? Number(m[1]) : /^\d{4}\/\d{4}$/.test(k) ? Number(k.slice(0, 4)) - firstYear + 1 : byDate.indexOf(k) + 1;
      });
    });
    var out = {};
    rows.forEach(function (r) {
      out[opts.id(r)] = numbers[String(opts.club ? opts.club(r) : '')][seasonKey(opts.season(r), opts.date(r))];
    });
    return out;
  }

  window.NinesSeasonWinners = { overall: overall, winners: winners, seasonKey: seasonKey, seasonNumbers: seasonNumbers };
})();
