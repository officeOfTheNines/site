// Profile editor (members/profile.html).
//   profile.html                -> edit your own profile
//   profile.html?profile=<id>   -> admins edit any profile (including people who have not signed in,
//                                  or whose access was removed)
// The database decides what is allowed; the page only mirrors those rules.
(function () {
  'use strict';

  var N = window.Nines;
  var P = window.NinesPeople;
  if (!N || N.loadFailed || !P) {
    window.NinesPageLoadFailed();
    return;
  }

  var client = N.client;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var PHONE_RE = /^[0-9+() .-]{5,30}$/;
  // Shared profile (same in every club) + this club's card (bio, visibility, admin settings).
  var PROFILE_FIELDS = 'id, email, member_id, display_name, phone, photo_path';
  // override_photo_path = this club's own photo, shown here instead of the main one (null = main photo)
  var CARD_FIELDS = 'bio, show_email, show_phone, listed, foreign_member, member_updated_on, override_photo_path, ' +
    'occupation, other_clubs, address, show_address, member_number, club_role';
  var LANG = window.NinesI18n ? window.NinesI18n.lang : 'en';

  var form = document.getElementById('profile-form');
  var nameInput = document.getElementById('display-name');
  var bioInput = document.getElementById('bio');
  var bioCount = document.getElementById('bio-count');
  var phoneInput = document.getElementById('phone');
  var photoInput = document.getElementById('photo-input');
  var photoRemove = document.getElementById('photo-remove');
  var photoPreview = document.getElementById('photo-preview');
  var showEmail = document.getElementById('show-email');
  var showPhone = document.getElementById('show-phone');
  var showAddress = document.getElementById('show-address');
  var occupationInput = document.getElementById('occupation');
  var clubsInput = document.getElementById('other-clubs');
  var addressInput = document.getElementById('address');
  var numberInput = document.getElementById('member-number');
  var roleInput = document.getElementById('club-role');
  var adminRows = document.getElementById('admin-rows');
  var listed = document.getElementById('listed');
  var foreign = document.getElementById('foreign');
  var emailShown = document.getElementById('email-shown');
  var saveButton = document.getElementById('save-button');
  var errorBox = document.getElementById('form-error');
  var statusBox = document.getElementById('form-status');
  var cardPreview = document.getElementById('card-preview');

  var club = null; // the club whose card is edited

  var state = {
    profile: null,        // the row being edited
    isAdmin: false,
    editingOther: false,
    hasAccess: true,      // is the profile's email on the member list?
    photoUrl: null,       // signed link for the saved photo
    pendingBlob: null,    // a new, resized photo waiting to be saved
    pendingUrl: null,
    removePhoto: false,
    coBrigadiers: []      // names of listed co-brigadiers, for the preview
  };

  // "Travellers Club, Polo de Paris" -> ["Travellers Club", "Polo de Paris"] (blanks and repeats removed)
  function parseClubs(text) {
    var seen = {};
    return String(text || '').split(/[,;\n]/).map(function (c) { return c.trim(); }).filter(function (c) {
      var k = c.toLowerCase();
      if (!c || seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function showError(text) { statusBox.textContent = ''; errorBox.textContent = text || ''; }
  function showStatus(text) { errorBox.textContent = ''; statusBox.textContent = text || ''; }

  function currentPhotoUrl() {
    if (state.pendingUrl) return state.pendingUrl;
    if (state.removePhoto) return null;
    return state.photoUrl;
  }

  function updatePreview() {
    bioCount.textContent = bioInput.value.length + ' of 500 characters';

    var person = {
      display_name: nameInput.value.trim() || 'Your name',
      bio: bioInput.value.trim(),
      email: showEmail.checked && state.profile ? state.profile.email : null,
      phone: showPhone.checked && PHONE_RE.test(phoneInput.value.trim()) ? P.normalizePhone(phoneInput.value, LANG) : null,
      address: showAddress.checked ? addressInput.value.trim() : null,
      occupation: occupationInput.value.trim(),
      other_clubs: parseClubs(clubsInput.value),
      club_role: roleInput.value.trim(),
      former_member: !state.hasAccess,
      foreign_member: foreign.checked,
      co_brigadiers: state.coBrigadiers
    };
    cardPreview.replaceChildren(P.renderCard(person, currentPhotoUrl(), { headingTag: 'h3' }));
    if (!listed.checked) {
      cardPreview.appendChild(N.el('p', { className: 'muted small', text: 'Hidden: this card is not shown in the directory.' }));
    }

    var url = currentPhotoUrl();
    photoPreview.replaceChildren(url
      ? N.el('img', { className: 'avatar', src: url, alt: 'Headshot preview', width: '96', height: '96' })
      : N.el('div', { className: 'avatar avatar-initials', 'aria-hidden': 'true', text: P.initials(nameInput.value) }));
    photoRemove.hidden = !url;
  }

  function clearPending() {
    if (state.pendingUrl) URL.revokeObjectURL(state.pendingUrl);
    state.pendingBlob = null;
    state.pendingUrl = null;
  }

  photoInput.addEventListener('change', async function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file) return;
    showError('');
    try {
      var blob = await P.processPhoto(file);
      clearPending();
      state.pendingBlob = blob;
      state.pendingUrl = URL.createObjectURL(blob);
      state.removePhoto = false;
      showStatus('Photo ready. Press "Save profile" to upload it.');
      updatePreview();
    } catch (error) {
      showError(error.message || 'That photo could not be used.');
    }
  });

  photoRemove.addEventListener('click', function () {
    clearPending();
    state.removePhoto = !!(state.profile && (state.profile.photo_path || state.profile.override_photo_path));
    showStatus(state.removePhoto ? 'Photo will be removed when you press "Save profile".' : '');
    updatePreview();
    photoInput.focus();
  });

  [nameInput, bioInput, phoneInput, showEmail, showPhone, showAddress, occupationInput, clubsInput, addressInput, roleInput, listed, foreign].forEach(function (input) {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var name = nameInput.value.trim();
    var bio = bioInput.value.trim();
    var phone = P.normalizePhone(phoneInput.value, LANG);
    var occupation = occupationInput.value.trim();
    var clubs = parseClubs(clubsInput.value);
    var address = addressInput.value.trim();
    var numberText = numberInput.value.trim();
    var clubRole = roleInput.value.trim();

    if (!name) { showError('Please enter a display name.'); nameInput.focus(); return; }
    if (name.length > 80) { showError('Please keep the display name to 80 characters or fewer.'); nameInput.focus(); return; }
    if (bio.length > 500) { showError('Please keep the bio to 500 characters or fewer.'); bioInput.focus(); return; }
    if (phone && !PHONE_RE.test(phone)) {
      showError('That phone number has characters we cannot use. Use digits, spaces and + ( ) - . only.');
      phoneInput.focus();
      return;
    }
    if (showPhone.checked && !phone) {
      showError('Add a phone number, or untick the "show phone number" box.');
      phoneInput.focus();
      return;
    }
    if (occupation.length > 200) { showError('Please keep the occupation to 200 characters or fewer.'); occupationInput.focus(); return; }
    if (clubs.length > 12 || clubs.join('|').length > 600) { showError('Please list at most 12 other clubs.'); clubsInput.focus(); return; }
    if (address.length > 300) { showError('Please keep the address to 300 characters or fewer.'); addressInput.focus(); return; }
    if (state.isAdmin && numberText && !/^[1-9][0-9]{0,5}$/.test(numberText)) {
      showError('The member number must be a whole number, for example 42.');
      numberInput.focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    showError('');
    try {
      var id = state.profile.id;
      // A new photo (or "Remove photo") changes the main photo, shown in every club, and this club's
      // photo: if this club had its own, it is cleared so the new main photo shows here too.
      // Other clubs' own photos are left alone.
      var photoPath = state.profile.photo_path;
      var clearClubPhoto = false;
      if (state.pendingBlob) {
        photoPath = await P.uploadPhoto(id, state.pendingBlob);
        clearClubPhoto = !!state.profile.override_photo_path;
      } else if (state.removePhoto) {
        if (photoPath) await P.removePhoto(id);
        photoPath = null;
        clearClubPhoto = !!state.profile.override_photo_path;
      }
      if (clearClubPhoto) await P.removeClubPhoto(id, club.id);

      // shared details: name, phone and photo appear in every club the person belongs to
      var shared = await client.from('profiles')
        .update({ display_name: name, phone: phone || null, photo_path: photoPath })
        .eq('id', id).select(PROFILE_FIELDS);
      if (shared.error) throw shared.error;
      if (!shared.data || shared.data.length !== 1) throw new Error('The profile could not be saved. Please reload and try again.');

      // this club's card
      var cardRow = { bio: bio || null, show_email: showEmail.checked, show_phone: showPhone.checked, show_address: showAddress.checked,
                      occupation: occupation || null, other_clubs: clubs, address: address || null };
      if (clearClubPhoto) cardRow.override_photo_path = null;
      if (state.isAdmin) {
        cardRow.listed = listed.checked;
        cardRow.foreign_member = foreign.checked;
        cardRow.member_number = numberText ? Number(numberText) : null;
        cardRow.club_role = clubRole || null;
      }
      var card = await client.from('club_profiles').update(cardRow)
        .eq('club_id', club.id).eq('profile_id', id).select(CARD_FIELDS);
      if (card.error) throw card.error;
      if (!card.data || card.data.length !== 1) throw new Error('The card could not be saved. Please reload and try again.');

      state.profile = Object.assign({}, shared.data[0], card.data[0]);
      if (state.pendingBlob) {
        // keep showing the local copy; a fresh signed link is made on the next visit
        state.photoUrl = state.pendingUrl;
        state.pendingBlob = null;
        state.pendingUrl = null;
      }
      if (!photoPath) state.photoUrl = null;
      state.removePhoto = false;
      if (clearClubPhoto) document.getElementById('club-photo-note').hidden = true;
      if (!state.editingOther) N.setText('[data-slot="name"]', name);
      showStatus(state.editingOther ? 'Profile saved.' : 'Your profile is saved.');
      updatePreview();
    } catch (error) {
      showError(saveErrorMessage(error));
    } finally {
      saveButton.disabled = false;
      saveButton.removeAttribute('aria-busy');
    }
  });

  function saveErrorMessage(error) {
    var msg = String((error && error.message) || '');
    if (/row-level security|permission denied|unauthorized|403/i.test(msg)) {
      return 'You do not have permission to change this profile.';
    }
    if (/profiles_phone_shape/.test(msg)) return 'That phone number has characters we cannot use.';
    if (/bio_length/.test(msg)) return 'Please keep the bio to 500 characters or fewer.';
    if (/member_number_idx|duplicate key/.test(msg)) return 'That member number is already used in this club.';
    if (/club_profiles_text_lengths|club_profiles_other_clubs/.test(msg)) return 'One of the fields is too long. Please shorten it.';
    if (/display_name/.test(msg)) return 'Please enter a display name of 1 to 80 characters.';
    if (/payload too large|exceeded the maximum/i.test(msg)) return 'That photo is too large. Please try another one.';
    return 'Could not save. ' + N.friendlyError(error);
  }

  // Co-brigadiers = everyone sharing a brigadier group with this card (listed cards only, as in the
  // directory). Members ask the database for their own; admins work it out from the group tables.
  async function loadCoBrigadiers(profileId, asAdmin) {
    try {
      if (!asAdmin) {
        var mine = await client.rpc('my_co_brigadiers', { p_club: club.id });
        return mine.error ? [] : (mine.data || []);
      }
      // this club's groups that include the card
      var clubGroups = await client.from('brigadier_groups').select('id').eq('club_id', club.id);
      if (clubGroups.error || !clubGroups.data.length) return [];
      var mineIn = await client.from('brigadier_group_members').select('group_id')
        .eq('profile_id', profileId).in('group_id', clubGroups.data.map(function (g) { return g.id; }));
      if (mineIn.error || !mineIn.data.length) return [];
      var others = await client.from('brigadier_group_members').select('profile_id')
        .in('group_id', mineIn.data.map(function (g) { return g.group_id; })).neq('profile_id', profileId);
      if (others.error || !others.data.length) return [];
      // names of those co-brigadiers whose card in this club is listed
      var cards = await client.from('club_profiles').select('listed, profiles(display_name)')
        .eq('club_id', club.id).in('profile_id', others.data.map(function (o) { return o.profile_id; }));
      if (cards.error) return [];
      var names = cards.data
        .filter(function (c) { return c.listed && c.profiles; })
        .map(function (c) { return c.profiles.display_name; });
      return names.filter(function (n, i) { return names.indexOf(n) === i; }).sort();
    } catch (e) {
      return [];
    }
  }

  async function load(access) {
    var mine = access.profile;
    var param = new URLSearchParams(window.location.search).get('profile');
    state.editingOther = !!param && !(mine && mine.id === param);
    // the club whose card is edited: this site's, or ?club= (any of your clubs for your own card;
    // only clubs you administer for someone else's)
    club = N.pickClub(access, state.editingOther);
    state.isAdmin = club.role === 'admin';

    if (state.editingOther && !state.isAdmin) { N.showState('not-admin'); return; }
    if (param && !UUID_RE.test(param)) { N.showState('not-found'); return; }
    if (!param && !mine) { N.showState('no-card'); return; }

    var targetId = param || mine.id;
    var result = await client.from('profiles').select(PROFILE_FIELDS).eq('id', targetId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) { N.showState('not-found'); return; }
    var cardResult = await client.from('club_profiles').select(CARD_FIELDS)
      .eq('club_id', club.id).eq('profile_id', targetId).maybeSingle();
    if (cardResult.error) throw cardResult.error;
    if (!cardResult.data) { N.showState(state.editingOther ? 'not-found' : 'no-card'); return; }
    var profile = state.profile = Object.assign({}, result.data, cardResult.data);

    if (state.editingOther) {
      var allow = await client.from('club_access').select('email')
        .eq('club_id', club.id).eq('email', profile.email).maybeSingle();
      state.hasAccess = !allow.error && !!allow.data;
    }

    state.coBrigadiers = await loadCoBrigadiers(profile.id, state.editingOther);

    document.getElementById('club-photo-note').hidden = !profile.override_photo_path;
    // the photo this club shows: its own if it has one, otherwise the main photo
    var shownPath = profile.override_photo_path || profile.photo_path;
    if (shownPath) {
      try {
        var urls = await P.signedPhotoUrls([shownPath]);
        state.photoUrl = urls[shownPath] || null;
      } catch (e) {
        state.photoUrl = null;
      }
    }

    nameInput.value = profile.display_name || '';
    bioInput.value = profile.bio || '';
    phoneInput.value = profile.phone ? (LANG === 'fr' ? P.formatPhone(profile.phone) : profile.phone) : '';
    occupationInput.value = profile.occupation || '';
    clubsInput.value = (profile.other_clubs || []).join(', ');
    addressInput.value = profile.address || '';
    numberInput.value = profile.member_number || '';
    roleInput.value = profile.club_role || '';
    showEmail.checked = !!profile.show_email;
    showPhone.checked = !!profile.show_phone;
    showAddress.checked = !!profile.show_address;
    listed.checked = profile.listed !== false;
    foreign.checked = !!profile.foreign_member;
    adminRows.hidden = !state.isAdmin;
    emailShown.textContent = profile.email ? '(' + profile.email + ')' : '';

    if (state.editingOther) {
      var who = profile.display_name || profile.email;
      var notes = ['You are editing this profile as an admin. Changes show in the directory straight away.'];
      if (!state.hasAccess) {
        notes.push(profile.email + ' is not on the member list: they cannot sign in to the site. If their card is listed, it is marked "Former member".');
      } else if (!profile.member_id) {
        notes.push(profile.email + ' has not signed in yet. When they sign in with that email, they can edit this profile themselves.');
      }
      document.getElementById('profile-heading').textContent = 'Edit profile: ' + who;
      document.title = 'Edit profile · The Nines';
      document.getElementById('profile-intro').textContent = notes.join(' ');
      var back = document.getElementById('back-link');
      back.textContent = 'Back to admin';
      back.setAttribute('href', N.withClub('admin.html', club));
      document.getElementById('show-email-text').textContent = 'Show email to other members';
      document.getElementById('show-phone-text').textContent = 'Show mobile to other members';
      document.getElementById('show-address-text').textContent = 'Show home address to other members';
      if (new URLSearchParams(window.location.search).get('new') === '1') {
        showStatus('Member added: ' + who + '. Add a bio, phone or photo below, or leave it as it is.');
      }
    } else if (!profile.member_updated_on) {
      showStatus('Welcome! Check your profile and press "Save profile". Other members only see the email, mobile and home address you tick below.');
    }

    var backLink = document.getElementById('back-link');
    if (!state.editingOther && backLink) backLink.setAttribute('href', N.withClub('directory.html', club));
    if (!club.isHome && !state.editingOther) {
      var intro = document.getElementById('profile-intro');
      intro.textContent = 'Your card in ' + club.name + '. ' + intro.textContent;
    }
    N.showState('ready');
    updatePreview();
  }

  N.guardMembersPage().then(function (access) {
    if (!access) return;
    load(access).catch(function (error) {
      N.setText('[data-slot="error-message"]', N.friendlyError(error));
      N.showState('error');
    });
  });
})();
