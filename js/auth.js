// Shared Supabase client and auth helpers for the login and member pages.
//
// Important: the allowlist checks in this file only decide what the page shows.
// The real protection is row-level security in Supabase (see supabase/schema.sql):
// private data is only returned to confirmed, allowlisted accounts.
(function () {
  'use strict';

  var cfg = window.NINES_CONFIG;
  if (!cfg || !window.supabase || !window.supabase.createClient) {
    window.Nines = { loadFailed: true };
    return;
  }

  // Site root, worked out from where this script lives (works on site.thenines.club
  // and on officeofthenines.github.io/site/).
  var scriptSrc = document.currentScript && document.currentScript.src;
  var siteRoot = new URL('../', scriptSrc || window.location.href);

  function siteUrl(path) {
    return new URL(path, siteRoot).href;
  }

  // Read what Supabase put in the address bar BEFORE the client clears it.
  // Errors arrive as ?error_description=... or #error_description=... (for example an expired link).
  function readUrlParams() {
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var query = new URLSearchParams(window.location.search);
    function get(name) { return hash.get(name) || query.get(name); }
    return {
      error: get('error_description') || get('error'),
      errorCode: get('error_code'),
      type: get('type')
    };
  }
  var urlParams = readUrlParams();

  var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // "implicit" lets an emailed link work even when it is opened in a different
      // browser or app from the one that asked for it (common on phones).
      flowType: 'implicit'
    }
  });

  // ---- small DOM helpers (never use innerHTML with data) ----

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'className') node.className = value;
        else if (key === 'hidden') node.hidden = true;
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function setText(selector, text) {
    document.querySelectorAll(selector).forEach(function (node) { node.textContent = text; });
  }

  // Shows blocks whose data-state includes "name" (space-separated list) and hides the rest.
  function showState(name) {
    document.querySelectorAll('[data-state]').forEach(function (node) {
      node.hidden = node.getAttribute('data-state').split(/\s+/).indexOf(name) === -1;
    });
    document.body.setAttribute('aria-busy', name === 'loading' ? 'true' : 'false');
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong. Please try again.';
    var msg = String(error.message || error.error_description || error);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Could not reach the server. Check your connection and try again.';
    }
    if (/rate limit|too many/i.test(msg)) {
      return 'Too many attempts. Please wait a few minutes and try again.';
    }
    if (/invalid login credentials/i.test(msg)) {
      return 'That email and password do not match. Check them, or use "Forgot password".';
    }
    if (/email not confirmed/i.test(msg)) {
      return 'Please confirm your email first: open the link we sent you when you created your account.';
    }
    if (/expired|otp_expired|invalid.*(link|token)/i.test(msg)) {
      return 'That link has expired or was already used. Please ask for a new one.';
    }
    return msg;
  }

  // True when the server says the saved login is no longer valid.
  function isSessionProblem(error) {
    if (!error) return false;
    var code = error.code || '';
    return error.status === 401 || code === 'PGRST301' || code === 'PGRST303' ||
      /jwt|token is expired|invalid claim/i.test(error.message || '');
  }

  var leaving = false;

  async function signOut() {
    leaving = true;
    try {
      await client.auth.signOut({ scope: 'local' });
    } catch (e) {
      // Even if the network call fails, the local session is cleared.
    }
    window.location.replace(siteUrl('login.html'));
  }

  function bindSignOutButtons() {
    document.querySelectorAll('[data-action="sign-out"]').forEach(function (button) {
      button.addEventListener('click', function () {
        button.disabled = true;
        signOut();
      });
    });
  }

  function goToLogin(message) {
    if (leaving) return;
    leaving = true;
    var url = new URL(siteUrl('login.html'));
    if (message) url.searchParams.set('error_description', message);
    window.location.replace(url.href);
  }

  // Works out who the visitor is and what they may see.
  // Returns { session, role, member } where role is 'admin', 'member' or null,
  // and member is their directory entry { id, display_name, email } (or null).
  async function loadAccess() {
    var sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    var session = sessionResult.data.session;
    if (!session) return { session: null, role: null, member: null };

    var access = await client.rpc('my_access');
    if (access.error) throw access.error;
    var role = access.data || null;
    if (!role) return { session: session, role: null, member: null };

    var claim = await client.rpc('claim_membership');
    if (claim.error) throw claim.error;

    // The caller's directory entry (it may have been created by an admin before their first login).
    var me = await client
      .from('members')
      .select('id, display_name, email')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (me.error) throw me.error;

    return { session: session, role: role, member: me.data };
  }

  // Used by every page under members/. Shows "loading" until the check is done, then:
  //   not logged in   -> login page
  //   not on the list -> the "denied" block
  //   error           -> the "error" block
  // Resolves with the access object for allowed members, or null otherwise.
  async function guardMembersPage() {
    showState('loading');
    bindSignOutButtons();

    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') goToLogin();
    });

    var access;
    try {
      access = await loadAccess();
    } catch (error) {
      if (isSessionProblem(error)) {
        try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
        goToLogin('Your session has ended. Please sign in again.');
        return null;
      }
      setText('[data-slot="error-message"]', friendlyError(error));
      showState('error');
      return null;
    }

    if (!access.session) {
      goToLogin(urlParams.error ? friendlyError({ message: urlParams.errorCode || urlParams.error }) : null);
      return null;
    }

    if (!access.role) {
      setText('[data-slot="denied-email"]', access.session.user.email || '');
      showState('denied');
      return null;
    }

    var name = (access.member && access.member.display_name) ||
      (access.session.user.email || '').split('@')[0];
    setText('[data-slot="name"]', name);
    setText('[data-slot="email"]', access.session.user.email || '');
    setText('[data-slot="role"]', access.role === 'admin' ? 'Admin' : 'Member');
    document.querySelectorAll('[data-admin-only]').forEach(function (node) {
      node.hidden = access.role !== 'admin';
    });
    return access;
  }

  window.Nines = {
    client: client,
    urlParams: urlParams,
    siteUrl: siteUrl,
    el: el,
    setText: setText,
    showState: showState,
    friendlyError: friendlyError,
    signOut: signOut,
    bindSignOutButtons: bindSignOutButtons,
    loadAccess: loadAccess,
    guardMembersPage: guardMembersPage
  };
})();
