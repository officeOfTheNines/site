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
  var FIELDS = 'id, email, member_id, display_name, bio, phone, show_email, show_phone, photo_path, listed, foreign_member, member_updated_on';

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
  var adminRows = document.getElementById('admin-rows');
  var listed = document.getElementById('listed');
  var foreign = document.getElementById('foreign');
  var emailShown = document.getElementById('email-shown');
  var saveButton = document.getElementById('save-button');
  var errorBox = document.getElementById('form-error');
  var statusBox = document.getElementById('form-status');
  var cardPreview = document.getElementById('card-preview');

  var state = {
    profile: null,        // the row being edited
    isAdmin: false,
    editingOther: false,
    hasAccess: true,      // is the profile's email on the member list?
    photoUrl: null,       // signed link for the saved photo
    pendingBlob: null,    // a new, resized photo waiting to be saved
    pendingUrl: null,
    removePhoto: false
  };

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
      phone: showPhone.checked && PHONE_RE.test(phoneInput.value.trim()) ? phoneInput.value.trim() : null,
      former_member: !state.hasAccess,
      foreign_member: foreign.checked
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
    state.removePhoto = !!(state.profile && state.profile.photo_path);
    showStatus(state.removePhoto ? 'Photo will be removed when you press "Save profile".' : '');
    updatePreview();
    photoInput.focus();
  });

  [nameInput, bioInput, phoneInput, showEmail, showPhone, listed, foreign].forEach(function (input) {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var name = nameInput.value.trim();
    var bio = bioInput.value.trim();
    var phone = phoneInput.value.trim();

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

    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    showError('');
    try {
      var id = state.profile.id;
      var photoPath = state.profile.photo_path;
      if (state.pendingBlob) {
        photoPath = await P.uploadPhoto(id, state.pendingBlob);
      } else if (state.removePhoto && photoPath) {
        await P.removePhoto(id);
        photoPath = null;
      }

      var row = {
        display_name: name,
        bio: bio || null,
        phone: phone || null,
        show_email: showEmail.checked,
        show_phone: showPhone.checked,
        photo_path: photoPath
      };
      if (state.isAdmin) {
        row.listed = listed.checked;
        row.foreign_member = foreign.checked;
      }

      var result = await client.from('profiles').update(row).eq('id', id).select(FIELDS);
      if (result.error) throw result.error;
      if (!result.data || result.data.length !== 1) throw new Error('The profile could not be saved. Please reload and try again.');

      state.profile = result.data[0];
      if (state.pendingBlob) {
        // keep showing the local copy; a fresh signed link is made on the next visit
        state.photoUrl = state.pendingUrl;
        state.pendingBlob = null;
        state.pendingUrl = null;
      }
      if (!photoPath) state.photoUrl = null;
      state.removePhoto = false;
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
    if (/profiles_bio_length/.test(msg)) return 'Please keep the bio to 500 characters or fewer.';
    if (/display_name/.test(msg)) return 'Please enter a display name of 1 to 80 characters.';
    if (/payload too large|exceeded the maximum/i.test(msg)) return 'That photo is too large. Please try another one.';
    return 'Could not save. ' + N.friendlyError(error);
  }

  async function load(access) {
    var mine = access.profile;
    var param = new URLSearchParams(window.location.search).get('profile');
    state.isAdmin = access.role === 'admin';
    state.editingOther = !!param && !(mine && mine.id === param);

    if (state.editingOther && !state.isAdmin) { N.showState('not-admin'); return; }
    if (param && !UUID_RE.test(param)) { N.showState('not-found'); return; }
    if (!param && !mine) {
      throw new Error('Your profile could not be set up. Please reload, or contact the office.');
    }

    var result = await client.from('profiles').select(FIELDS).eq('id', param || mine.id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) { N.showState('not-found'); return; }
    var profile = state.profile = result.data;

    if (state.editingOther) {
      var allow = await client.from('allowed_emails').select('email').eq('email', profile.email).maybeSingle();
      state.hasAccess = !allow.error && !!allow.data;
    }

    if (profile.photo_path) {
      try {
        var urls = await P.signedPhotoUrls([profile.photo_path]);
        state.photoUrl = urls[profile.photo_path] || null;
      } catch (e) {
        state.photoUrl = null;
      }
    }

    nameInput.value = profile.display_name || '';
    bioInput.value = profile.bio || '';
    phoneInput.value = profile.phone || '';
    showEmail.checked = !!profile.show_email;
    showPhone.checked = !!profile.show_phone;
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
      back.setAttribute('href', 'admin.html');
      document.getElementById('show-email-text').textContent = 'Show email to other members';
      document.getElementById('show-phone-text').textContent = 'Show phone number to other members';
      if (new URLSearchParams(window.location.search).get('new') === '1') {
        showStatus('Member added: ' + who + '. Add a bio, phone or photo below, or leave it as it is.');
      }
    } else if (!profile.member_updated_on) {
      showStatus('Welcome! Check your profile and press "Save profile". Email and phone stay hidden unless you tick the boxes.');
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
