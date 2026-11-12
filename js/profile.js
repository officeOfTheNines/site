// Profile editor (members/profile.html).
//   profile.html               -> edit your own profile
//   profile.html?member=<id>   -> admins edit another member's profile
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
  var listedRow = document.getElementById('listed-row');
  var listed = document.getElementById('listed');
  var emailShown = document.getElementById('email-shown');
  var saveButton = document.getElementById('save-button');
  var errorBox = document.getElementById('form-error');
  var statusBox = document.getElementById('form-status');
  var cardPreview = document.getElementById('card-preview');

  var state = {
    targetId: null,
    isAdmin: false,
    editingOther: false,
    email: '',
    savedName: '',
    profileExists: false,
    photoPath: null,      // what is saved in the database
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
    var count = bioInput.value.length;
    bioCount.textContent = count + ' of 500 characters';

    var person = {
      display_name: nameInput.value.trim() || 'Your name',
      bio: bioInput.value.trim(),
      email: showEmail.checked ? state.email : null,
      phone: showPhone.checked && PHONE_RE.test(phoneInput.value.trim()) ? phoneInput.value.trim() : null
    };
    cardPreview.replaceChildren(P.renderCard(person, currentPhotoUrl(), { headingTag: 'h3' }));
    if (state.isAdmin && !listed.checked) {
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
    state.removePhoto = !!state.photoPath;
    showStatus(state.photoPath ? 'Photo will be removed when you press "Save profile".' : '');
    updatePreview();
    photoInput.focus();
  });

  [nameInput, bioInput, phoneInput, showEmail, showPhone, listed].forEach(function (input) {
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
      showError('Add a phone number, or untick "Show my phone number".');
      phoneInput.focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    showError('');
    try {
      var photoPath = state.photoPath;
      if (state.pendingBlob) {
        photoPath = await P.uploadPhoto(state.targetId, state.pendingBlob);
      } else if (state.removePhoto && state.photoPath) {
        await P.removePhoto(state.targetId);
        photoPath = null;
      }

      if (name !== state.savedName) {
        var nameResult = await client.from('members').update({ display_name: name }).eq('id', state.targetId).select('id');
        if (nameResult.error) throw nameResult.error;
        if (!nameResult.data || nameResult.data.length !== 1) throw new Error('Your name could not be saved. Please reload and try again.');
      }

      var row = {
        bio: bio || null,
        phone: phone || null,
        show_email: showEmail.checked,
        show_phone: showPhone.checked,
        photo_path: photoPath
      };
      if (state.isAdmin) row.listed = listed.checked;

      var result = state.profileExists
        ? await client.from('profiles').update(row).eq('member_id', state.targetId).select('member_id')
        : await client.from('profiles').insert(Object.assign({ member_id: state.targetId }, row)).select('member_id');
      if (result.error) throw result.error;
      if (!result.data || result.data.length !== 1) throw new Error('The profile could not be saved. Please reload and try again.');

      state.profileExists = true;
      state.savedName = name;
      if (state.pendingBlob) {
        // keep showing the local copy; a fresh signed link is made on the next visit
        state.photoUrl = state.pendingUrl;
        state.pendingBlob = null;
        state.pendingUrl = null;
      }
      state.photoPath = photoPath;
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
    var myId = access.member && access.member.id;
    var param = new URLSearchParams(window.location.search).get('member');
    if (!myId && !param) {
      throw new Error('Your directory entry could not be set up. Please contact the office.');
    }
    state.isAdmin = access.role === 'admin';
    state.targetId = param || myId;
    state.editingOther = state.targetId !== myId;

    if (state.editingOther && !state.isAdmin) { N.showState('not-admin'); return; }
    if (!UUID_RE.test(state.targetId)) { N.showState('not-found'); return; }

    var memberResult = await client.from('members').select('id, display_name, email, user_id').eq('id', state.targetId).maybeSingle();
    if (memberResult.error) throw memberResult.error;
    if (!memberResult.data) { N.showState('not-found'); return; }

    var profileResult = await client
      .from('profiles')
      .select('bio, phone, show_email, show_phone, photo_path, listed')
      .eq('member_id', state.targetId)
      .maybeSingle();
    if (profileResult.error) throw profileResult.error;

    var member = memberResult.data;
    var profile = profileResult.data;
    state.email = member.email || '';
    state.savedName = member.display_name || '';
    state.profileExists = !!profile;
    state.photoPath = profile ? profile.photo_path : null;

    if (state.photoPath) {
      try {
        var urls = await P.signedPhotoUrls([state.photoPath]);
        state.photoUrl = urls[state.photoPath] || null;
      } catch (e) {
        state.photoUrl = null;
      }
    }

    nameInput.value = member.display_name || '';
    bioInput.value = (profile && profile.bio) || '';
    phoneInput.value = (profile && profile.phone) || '';
    showEmail.checked = !!(profile && profile.show_email);
    showPhone.checked = !!(profile && profile.show_phone);
    listed.checked = profile ? profile.listed !== false : true;
    listedRow.hidden = !state.isAdmin;
    emailShown.textContent = state.email ? '(' + state.email + ')' : '';

    if (state.editingOther) {
      var who = member.display_name || member.email;
      document.getElementById('profile-heading').textContent = 'Edit profile: ' + who;
      document.title = 'Edit profile · The Nines';
      document.getElementById('profile-intro').textContent =
        'You are editing another member\'s profile as an admin. Changes show in the directory straight away.' +
        (member.user_id ? '' : ' ' + (member.email || 'This person') + ' has not signed in yet. When they sign in with ' +
          'that email, they can edit this profile themselves.');
      if (new URLSearchParams(window.location.search).get('new') === '1') {
        showStatus('Directory entry created for ' + who + '. Add a bio, phone or photo below, or leave it as it is.');
      }
      var back = document.getElementById('back-link');
      back.textContent = 'Back to admin';
      back.setAttribute('href', 'admin.html');
      document.getElementById('show-email-text').textContent = 'Show email to other members';
      document.getElementById('show-phone-text').textContent = 'Show phone number to other members';
    } else if (!profile) {
      showStatus('Welcome! Fill in your profile so other members can find you. Email and phone stay hidden unless you tick the boxes.');
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
