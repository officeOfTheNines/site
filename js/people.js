// Shared pieces for the directory, profile and admin pages:
// member cards, signed headshot links and client-side photo resizing.
(function () {
  'use strict';

  var N = window.Nines;
  if (!N || N.loadFailed) return;

  var BUCKET = 'headshots';
  var LINK_SECONDS = 60 * 60; // signed links expire after one hour
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  var PHOTO_SIZE = 400;

  // Main photo, shown in every club unless a club has its own.
  function photoPathFor(profileId) {
    return profileId + '/avatar.jpg';
  }

  // A club's own photo for this person (club_profiles.override_photo_path), set by the office.
  function clubPhotoPathFor(profileId, clubId) {
    return profileId + '/club-' + clubId + '.jpg';
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    var first = Array.from(parts[0])[0] || '';
    var last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] || '') : '';
    return (first + last).toUpperCase();
  }

  // Returns { path: signedUrl } for the given storage paths. Missing files are left out.
  async function signedPhotoUrls(paths) {
    var unique = paths.filter(Boolean).filter(function (p, i, all) { return all.indexOf(p) === i; });
    if (unique.length === 0) return {};
    var result = await N.client.storage.from(BUCKET).createSignedUrls(unique, LINK_SECONDS);
    if (result.error) throw result.error;
    var map = {};
    (result.data || []).forEach(function (item) {
      if (item && item.signedUrl && !item.error) map[item.path] = item.signedUrl;
    });
    return map;
  }

  // "A & B" or "A, B & C"
  function joinNames(names) {
    var list = (names || []).filter(Boolean);
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }

  // Relation codes from the database -> label (translated on the French site).
  var RELATION = { godson: 'Godson:', godfather: 'Godfather:', co_brigadier: 'Co-brigadier:' };

  // Phone helpers. French numbers are stored as +33 6 12 34 56 78 -> "+33612345678" and shown in the
  // French way, "06 12 34 56 78"; other numbers are shown as stored.
  function dialNumber(phone) { return String(phone || '').replace(/[^0-9+]/g, ''); }
  function formatPhone(phone) {
    var d = dialNumber(phone);
    if (/^\+33[1-9]\d{8}$/.test(d)) return ('0' + d.slice(3)).replace(/(\d{2})(?=\d)/g, '$1 ');
    return String(phone || '');
  }
  // On the French site, a French number typed as "06 12 34 56 78" is stored as "+33612345678".
  function normalizePhone(phone, lang) {
    var text = String(phone || '').trim();
    var d = text.replace(/[\s.()-]/g, '');
    if (lang === 'fr' && /^0[1-9]\d{8}$/.test(d)) return '+33' + d.slice(1);
    if (/^\+33[1-9]\d{8}$/.test(d)) return d;
    return text;
  }

  // Builds a member card. person = { display_name, bio, email, phone, former_member, foreign_member,
  // co_brigadiers, club_role, occupation, other_clubs, address, private_fields, relations },
  // photoUrl = signed link or null.
  // All text goes in with textContent; links are built from validated values only.
  function renderCard(person, photoUrl, options) {
    var el = N.el;
    var opts = options || {};
    var name = person.display_name || 'Member';

    var avatar;
    if (photoUrl) {
      avatar = el('img', {
        className: 'avatar',
        src: photoUrl,
        alt: 'Photo of ' + name,
        width: '96',
        height: '96',
        loading: 'lazy',
        decoding: 'async'
      });
      avatar.addEventListener('error', function () {
        avatar.replaceWith(el('div', { className: 'avatar avatar-initials', 'aria-hidden': 'true', text: initials(name) }));
      });
    } else {
      avatar = el('div', { className: 'avatar avatar-initials', 'aria-hidden': 'true', text: initials(name) });
    }

    // Beside the photo: name, labels, club role and occupation.
    var details = el('div', { className: 'card-body card-head' }, [
      el(opts.headingTag || 'h2', { className: 'card-name', 'data-no-i18n': true, text: name })
    ]);
    var labels = [];
    if (person.former_member) labels.push(el('span', { className: 'card-label', text: 'Former member' }));
    if (person.foreign_member) labels.push(el('span', { className: 'card-label', text: 'Foreign member' }));
    if (labels.length) details.appendChild(el('p', { className: 'card-labels' }, labels));
    if (person.club_role) details.appendChild(el('p', { className: 'card-role', 'data-no-i18n': true, text: person.club_role }));
    if (person.occupation) details.appendChild(el('p', { className: 'card-occupation', 'data-no-i18n': true, text: person.occupation }));
    var clubs = (person.other_clubs || []).filter(Boolean);
    // Below the photo, across the whole card: other clubs, bio, contact rows and related members.
    var rest = el('div', { className: 'card-rest' });
    if (clubs.length) {
      rest.appendChild(el('ul', { className: 'card-tags', 'aria-label': 'Other clubs' }, clubs.map(function (c) {
        return el('li', { className: 'tag', 'data-no-i18n': true, text: c });
      })));
    }
    if (person.bio) rest.appendChild(el('p', { className: 'card-bio', 'data-no-i18n': true, text: person.bio }));

    // Home, mobile, email. Admins also get a discreet marker on what other members cannot see
    // (private_fields comes from the database, for admins only).
    var hidden = person.private_fields || [];
    var contact = el('ul', { className: 'card-contact' });
    function contactRow(field, label, value) {
      var row = el('li', { className: 'contact-row' }, [el('span', { className: 'contact-label', text: label + ' ' }), value]);
      if (hidden.indexOf(field) !== -1) {
        row.appendChild(el('span', { className: 'private-marker', title: 'Other members cannot see this', text: 'Hidden from members' }));
      }
      contact.appendChild(row);
    }
    if (person.address) contactRow('address', 'Home:', el('span', { className: 'contact-address', 'data-no-i18n': true, text: person.address }));
    if (person.phone) {
      var dial = dialNumber(person.phone);
      if (dial.length >= 5) contactRow('phone', 'Mobile:', el('a', { href: 'tel:' + dial, 'data-no-i18n': true, text: formatPhone(person.phone) }));
    }
    if (person.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email)) {
      contactRow('email', 'Email:', el('a', { href: 'mailto:' + encodeURIComponent(person.email).replace(/%40/g, '@'), 'data-no-i18n': true, text: person.email }));
    }
    if (contact.children.length) rest.appendChild(contact);

    // Related members: from the database's relation codes (directory), else plain co-brigadier names
    // (profile preview). One line per person and relation.
    if (Array.isArray(person.relations)) {
      var seen = {};
      var rels = person.relations.filter(function (r) {
        var k = (RELATION[r.relation] ? r.relation : 'co_brigadier') + '|' + r.display_name;
        if (!r.display_name || seen[k]) return false;
        seen[k] = true;
        return true;
      });
      if (rels.length) {
        rest.appendChild(el('ul', { className: 'card-relations' }, rels.map(function (r) {
          return el('li', null, [
            el('span', { className: 'muted', text: (RELATION[r.relation] || RELATION.co_brigadier) + ' ' }),
            el('span', { 'data-no-i18n': true, text: r.display_name })
          ]);
        })));
      }
    } else if (person.co_brigadiers && person.co_brigadiers.length) {
      rest.appendChild(el('p', { className: 'card-brigadiers' }, [
        el('span', { className: 'muted', text: (person.co_brigadiers.length === 1 ? 'Co-brigadier: ' : 'Co-brigadiers: ') }),
        joinNames(person.co_brigadiers)
      ]));
    }

    var parts = [avatar, details];
    if (rest.children.length) parts.push(rest);
    return el('article', { className: 'member-card' }, parts);
  }

  // Turns a chosen file into a square ~400px JPEG Blob. Re-drawing on a canvas drops all metadata
  // (location, camera details). Throws an Error with a friendly message on bad input.
  async function processPhoto(file) {
    if (!file) throw new Error('Please choose a photo.');
    if (!/^image\//.test(file.type || '')) throw new Error('That file is not an image. Please choose a JPEG, PNG or similar photo.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('That photo is larger than 5 MB. Please choose a smaller one.');

    var source;
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      source = await loadWithImageElement(file);
    }

    var w = source.width;
    var h = source.height;
    if (!w || !h) throw new Error('That image could not be read. Please try another photo.');
    var side = Math.min(w, h);
    var sx = Math.round((w - side) / 2);
    var sy = Math.round((h - side) / 2);
    var out = Math.min(PHOTO_SIZE, side);

    var canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0E2A1E'; // background for transparent images
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, side, side, 0, 0, out, out);
    if (source.close) source.close();

    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.8); });
    if (!blob) throw new Error('That image could not be processed. Please try another photo.');
    return blob;
  }

  function loadWithImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That image could not be opened. Please try a JPEG or PNG photo.'));
      };
      img.src = url;
    });
  }

  async function uploadPhoto(profileId, blob) {
    var path = photoPathFor(profileId);
    var result = await N.client.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600'
    });
    if (result.error) throw result.error;
    return path;
  }

  async function removePhoto(profileId) {
    var result = await N.client.storage.from(BUCKET).remove([photoPathFor(profileId)]);
    if (result.error) throw result.error;
  }

  async function removeClubPhoto(profileId, clubId) {
    var result = await N.client.storage.from(BUCKET).remove([clubPhotoPathFor(profileId, clubId)]);
    if (result.error) throw result.error;
  }

  window.NinesPeople = {
    initials: initials,
    joinNames: joinNames,
    photoPathFor: photoPathFor,
    clubPhotoPathFor: clubPhotoPathFor,
    signedPhotoUrls: signedPhotoUrls,
    renderCard: renderCard,
    formatPhone: formatPhone,
    normalizePhone: normalizePhone,
    processPhoto: processPhoto,
    uploadPhoto: uploadPhoto,
    removePhoto: removePhoto,
    removeClubPhoto: removeClubPhoto
  };
})();
