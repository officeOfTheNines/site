// Login page: Google, email + password (sign in, create account, forgot password), magic link.
(function () {
  'use strict';

  var errorBox = document.getElementById('error');
  var statusBox = document.getElementById('status');

  function showError(text) {
    statusBox.textContent = '';
    errorBox.textContent = text || '';
  }
  function showStatus(text) {
    errorBox.textContent = '';
    statusBox.textContent = text || '';
  }
  function clearMessages() { showError(''); }

  var N = window.Nines;
  if (!N || N.loadFailed) {
    document.querySelectorAll('[data-state]').forEach(function (node) {
      node.hidden = node.getAttribute('data-state') !== 'error';
    });
    showError('The login system could not load. Check your connection, turn off any content blocker for this site, and reload.');
    return;
  }

  var client = N.client;
  var membersUrl = N.siteUrl('members/index.html');
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }

  // Disables a button while a request runs, so people cannot double-submit.
  async function busy(button, label, task) {
    var original = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (label) button.textContent = label;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (label) button.textContent = original;
    }
  }

  // ---- Google ----
  var googleButton = document.getElementById('google-button');
  googleButton.addEventListener('click', function () {
    clearMessages();
    busy(googleButton, null, async function () {
      var result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: membersUrl, queryParams: { prompt: 'select_account' } }
      });
      if (result.error) showError(N.friendlyError(result.error));
    });
  });

  // ---- Email and password ----
  var mode = 'signin';
  var modeSignin = document.getElementById('mode-signin');
  var modeSignup = document.getElementById('mode-signup');
  var pwForm = document.getElementById('password-form');
  var pwEmail = document.getElementById('pw-email');
  var pwPassword = document.getElementById('pw-password');
  var pwHint = document.getElementById('pw-hint');
  var pwSubmit = document.getElementById('pw-submit');
  var forgotButton = document.getElementById('forgot-button');

  function setMode(next) {
    mode = next;
    var signup = next === 'signup';
    modeSignin.setAttribute('aria-pressed', String(!signup));
    modeSignup.setAttribute('aria-pressed', String(signup));
    pwSubmit.textContent = signup ? 'Create account' : 'Sign in';
    pwPassword.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    pwHint.hidden = !signup;
    forgotButton.hidden = signup;
    clearMessages();
  }
  modeSignin.addEventListener('click', function () { setMode('signin'); });
  modeSignup.addEventListener('click', function () { setMode('signup'); });

  pwForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = cleanEmail(pwEmail.value);
    var password = pwPassword.value;

    if (!EMAIL_RE.test(email)) { showError('Please enter a valid email address.'); pwEmail.focus(); return; }
    if (!password) { showError('Please enter your password.'); pwPassword.focus(); return; }
    if (mode === 'signup' && password.length < 8) {
      showError('Please choose a password of at least 8 characters.'); pwPassword.focus(); return;
    }
    clearMessages();

    busy(pwSubmit, mode === 'signup' ? 'Creating…' : 'Signing in…', async function () {
      if (mode === 'signup') {
        var up = await client.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: membersUrl }
        });
        if (up.error) { showError(N.friendlyError(up.error)); return; }
        if (up.data && up.data.session) { window.location.replace(membersUrl); return; }
        // Same message whether or not the address already has an account.
        showStatus('Check your email (' + email + ') and open the link to confirm your account. ' +
          'If you already have an account, sign in instead.');
        pwPassword.value = '';
        return;
      }

      var result = await client.auth.signInWithPassword({ email: email, password: password });
      if (result.error) { showError(N.friendlyError(result.error)); return; }
      window.location.replace(membersUrl);
    });
  });

  forgotButton.addEventListener('click', function () {
    var email = cleanEmail(pwEmail.value);
    if (!EMAIL_RE.test(email)) {
      showError('Type your email address above first, then press "Forgot password?" again.');
      pwEmail.focus();
      return;
    }
    clearMessages();
    busy(forgotButton, 'Sending…', async function () {
      var result = await client.auth.resetPasswordForEmail(email, { redirectTo: N.siteUrl('login.html') });
      if (result.error) { showError(N.friendlyError(result.error)); return; }
      showStatus('If ' + email + ' has an account, we have emailed a link to choose a new password.');
    });
  });

  // ---- Magic link ----
  var magicForm = document.getElementById('magic-form');
  var magicEmail = document.getElementById('magic-email');
  var magicSubmit = document.getElementById('magic-submit');

  magicForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = cleanEmail(magicEmail.value);
    if (!EMAIL_RE.test(email)) { showError('Please enter a valid email address.'); magicEmail.focus(); return; }
    clearMessages();
    busy(magicSubmit, 'Sending…', async function () {
      var result = await client.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: membersUrl }
      });
      if (result.error) { showError(N.friendlyError(result.error)); return; }
      showStatus('We have sent a sign-in link to ' + email + '. Open it on this device or any other.');
    });
  });

  // ---- Password recovery (arrived from the reset email) ----
  var recoveryForm = document.getElementById('recovery-form');
  var newPassword = document.getElementById('new-password');
  var newPassword2 = document.getElementById('new-password-2');
  var recoverySubmit = document.getElementById('recovery-submit');
  var inRecovery = N.urlParams.type === 'recovery';

  function showRecovery() {
    inRecovery = true;
    N.showState('recovery');
    newPassword.focus();
  }

  recoveryForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (newPassword.value.length < 8) { showError('Please choose a password of at least 8 characters.'); newPassword.focus(); return; }
    if (newPassword.value !== newPassword2.value) { showError('The two passwords do not match.'); newPassword2.focus(); return; }
    clearMessages();
    busy(recoverySubmit, 'Saving…', async function () {
      var result = await client.auth.updateUser({ password: newPassword.value });
      if (result.error) { showError(N.friendlyError(result.error)); return; }
      showStatus('Password saved. Taking you to the member area…');
      window.location.replace(membersUrl);
    });
  });

  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') setTimeout(showRecovery, 0);
  });

  // ---- First load ----
  (async function init() {
    if (N.urlParams.error) {
      showError(N.friendlyError({ message: N.urlParams.errorCode || N.urlParams.error }));
    }
    try {
      var result = await client.auth.getSession();
      if (result.error) throw result.error;
      var session = result.data.session;
      if (inRecovery) {
        if (session) { showRecovery(); return; }
        showError('That password reset link has expired or was already used. Please ask for a new one.');
        N.showState('signin');
        return;
      }
      if (session) {
        // Already signed in: the member page decides what they may see.
        window.location.replace(membersUrl);
        return;
      }
      N.showState('signin');
    } catch (error) {
      showError(N.friendlyError(error));
      N.showState('signin');
    }
  })();
})();
