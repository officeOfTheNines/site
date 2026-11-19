// Finding a restaurant for Recos. Everything about the search provider is in this file, so it can be
// swapped later without touching the rest of the site.
//
//   NinesPlaces.searchPlaces(query, near) -> Promise of [{ name, address, lat, lng, external_id }]
//   NinesPlaces.parseMapLink(text)        -> { name, address, lat, lng, external_id } or null
//   NinesPlaces.nearestPlace(lat, lng)    -> Promise of the nearest restaurant or named place
//                                            { name, address, lat, lng, external_id, distance } or null
//
// Provider today: Photon (photon.komoot.io), a free search over OpenStreetMap data. Its fair-use terms
// ask for no heavy or bulk use, so: searches only after the member stops typing (debounced by the
// caller), at most one request per second, a small cache, and a handful of results.
// Pasted Google Maps links are read locally (name and coordinates from the link itself); nothing is
// fetched from Google and no Google place id is stored.
(function () {
  'use strict';

  var PHOTON = 'https://photon.komoot.io/api/';
  var PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
  var FOOD = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'biergarten', 'food_court', 'ice_cream'];
  var MIN_GAP_MS = 1000;
  var lastRequest = 0;
  var cache = {};

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function addressOf(p) {
    var street = [p.housenumber, p.street].filter(Boolean).join(' ');
    var town = [p.postcode, p.city || p.town || p.village || p.district].filter(Boolean).join(' ');
    return [street, town].filter(Boolean).join(', ') || null;
  }

  function toPlace(feature) {
    var p = feature.properties || {};
    var c = (feature.geometry && feature.geometry.coordinates) || [];
    if (!p.name || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
    return {
      name: p.name,
      address: addressOf(p),
      lat: c[1],
      lng: c[0],
      external_id: p.osm_type && p.osm_id ? 'osm:' + p.osm_type + p.osm_id : null
    };
  }

  // One request to Photon: cached, and never more than one per second.
  async function fetchFeatures(url) {
    url.searchParams.set('lang', document.documentElement.lang === 'fr' ? 'fr' : 'en');
    var key = url.href;
    if (cache[key]) return cache[key];

    var gap = Date.now() - lastRequest;
    if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);
    lastRequest = Date.now();

    var response = await fetch(key, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('The place search is not available right now. Try again in a moment.');
    var data = await response.json();
    cache[key] = data.features || [];
    return cache[key];
  }

  async function photon(query, near, foodOnly) {
    var url = new URL(PHOTON);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '6');
    if (near) { url.searchParams.set('lat', String(near.lat)); url.searchParams.set('lon', String(near.lng)); }
    if (foodOnly) {
      ['amenity:restaurant', 'amenity:cafe', 'amenity:bar', 'amenity:pub', 'amenity:fast_food', 'amenity:biergarten']
        .forEach(function (tag) { url.searchParams.append('osm_tag', tag); });
    }
    return (await fetchFeatures(url)).map(toPlace).filter(Boolean);
  }

  function metres(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * r / 2) * Math.sin((lat2 - lat1) * r / 2) +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) * Math.sin((lng2 - lng1) * r / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // What is at this point of the map? The nearest restaurant, café or bar within about 80 m;
  // otherwise the nearest named place (a shop, a building...) within about 40 m; otherwise null
  // (an empty spot: the member types the name). Streets, districts and towns are never suggested.
  async function nearestPlace(lat, lng) {
    var url = new URL(PHOTON_REVERSE);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('radius', '0.1'); // km
    url.searchParams.set('limit', '10');
    var features = await fetchFeatures(url);
    var ignore = /^(highway|place|boundary|railway|landuse|natural|waterway|route)$/;
    var candidates = features.map(function (f) {
      var place = toPlace(f);
      if (!place) return null;
      var props = f.properties || {};
      if (ignore.test(props.osm_key || '') || /^(street|city|district|locality|county|state|country|postcode)$/.test(props.type || '')) return null;
      place.distance = metres(lat, lng, place.lat, place.lng);
      place.food = props.osm_key === 'amenity' && FOOD.indexOf(props.osm_value) !== -1;
      return place;
    }).filter(Boolean).sort(function (a, b) { return a.distance - b.distance; });
    var best = candidates.find(function (p) { return p.food && p.distance <= 80; }) ||
               candidates.find(function (p) { return p.distance <= 40; }) || null;
    if (best) delete best.food;
    return best;
  }

  // Restaurants, cafés and bars first; if none, any place with that name.
  async function searchPlaces(query, near) {
    var q = String(query || '').trim();
    if (q.length < 3) return [];
    var places = await photon(q, near, true);
    if (!places.length) places = await photon(q, near, false);
    return places;
  }

  // Reads a pasted Google Maps link, e.g.
  //   https://www.google.com/maps/place/Le+Chateaubriand/@48.8667,2.3789,17z/data=...!3d48.8668!4d2.3790
  //   https://maps.google.com/?q=48.8668,2.3790
  // Short links (maps.app.goo.gl) cannot be read without asking Google, so they return
  // { needsFullLink: true }: the member opens the link and pastes the full address instead.
  function parseMapLink(text) {
    var raw = String(text || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    var url;
    try { url = new URL(raw); } catch (e) { return null; }
    var host = url.hostname.replace(/^www\./, '');
    if (/^(maps\.app\.goo\.gl|goo\.gl)$/.test(host)) return { needsFullLink: true };
    if (!/(^|\.)google\.[a-z.]+$/.test(host) && host !== 'maps.google.com') return null;

    var path = decodeURIComponent(url.pathname);
    var full = decodeURIComponent(raw);
    var name = null, lat = null, lng = null;

    var placeName = path.match(/\/maps\/place\/([^/]+)/);
    if (placeName) name = placeName[1].replace(/\+/g, ' ').trim();

    var pin = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);       // the place's own pin
    var view = full.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);          // the map's centre
    var q = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('ll');
    var qPair = q && q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pin) { lat = Number(pin[1]); lng = Number(pin[2]); }
    else if (qPair) { lat = Number(qPair[1]); lng = Number(qPair[2]); }
    else if (view) { lat = Number(view[1]); lng = Number(view[2]); }
    if (!name && q && !qPair) name = q.replace(/\+/g, ' ').trim();

    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return name ? { name: name, address: null, lat: null, lng: null, external_id: null } : null;
    }
    return { name: name || '', address: null, lat: lat, lng: lng, external_id: null };
  }

  window.NinesPlaces = { searchPlaces: searchPlaces, parseMapLink: parseMapLink, nearestPlace: nearestPlace };
})();
