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

  // This copy of the site's club (js/club.js): id, name, language.
  var siteClub = window.NINES_CLUB || { CLUB_ID: 1, NAME: 'The Nines', LANG: 'en' };
  var clubId = siteClub.CLUB_ID;

  // Works out who the visitor is and what they may see in THIS site's club.
  // Returns { session, role, profile, card } where role is 'admin', 'member' or null,
  // profile is their shared profile { id, display_name, email } (or null), and card is their card in
  // this club { member_updated_on } (or null: office/staff accounts have none).
  async function loadAccess() {
    var sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    var session = sessionResult.data.session;
    if (!session) return { session: null, role: null, profile: null, card: null };

    var access = await client.rpc('my_access', { p_club: clubId });
    if (access.error) throw access.error;
    var role = access.data || null;
    if (!role) return { session: session, role: null, profile: null, card: null };

    var claim = await client.rpc('claim_membership');
    if (claim.error) throw claim.error;

    // The caller's shared profile (it may have been created by an admin before their first sign-in;
    // claim_membership() has just linked it, or created a blank one) and their card in this club.
    var me = await client
      .from('profiles')
      .select('id, display_name, email')
      .eq('member_id', session.user.id)
      .maybeSingle();
    if (me.error) throw me.error;

    var card = null;
    if (me.data) {
      var c = await client
        .from('club_profiles')
        .select('member_updated_on')
        .eq('club_id', clubId)
        .eq('profile_id', me.data.id)
        .maybeSingle();
      if (c.error) throw c.error;
      card = c.data;
    }

    // Every club the person can open, with their role in each (for the club pickers).
    var clubs = await client.rpc('my_clubs');
    if (clubs.error) throw clubs.error;

    return { session: session, role: role, profile: me.data, card: card, clubs: clubs.data || [] };
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

    var name = (access.profile && access.profile.display_name) ||
      (access.session.user.email || '').split('@')[0];
    setText('[data-slot="name"]', name);
    setText('[data-slot="email"]', access.session.user.email || '');
    setText('[data-slot="role"]', access.role === 'admin' ? 'Admin' : 'Member');
    document.querySelectorAll('[data-admin-only]').forEach(function (node) {
      node.hidden = access.role !== 'admin';
    });
    if (window.NinesNav) window.NinesNav.setClubs(access.clubs);
    if (window.NinesClubSwitch) window.NinesClubSwitch.mount(access);
    return access;
  }

  // The club a page shows: ?club=<id> when the person may open that club (as an admin, when
  // adminOnly), otherwise this site's own club. Returns { id, name, role, choices }, where choices
  // are the clubs offered in the picker (shown only when there is more than one).
  function pickClub(access, adminOnly) {
    var choices = (access.clubs || []).filter(function (c) { return !adminOnly || c.role === 'admin'; });
    var home = { club_id: clubId, name: siteClub.NAME, role: access.role };
    if (!choices.some(function (c) { return c.club_id === clubId; })) choices.unshift(home);
    var wanted = Number(new URLSearchParams(window.location.search).get('club'));
    var chosen = choices.find(function (c) { return c.club_id === wanted; }) ||
      choices.find(function (c) { return c.club_id === clubId; }) || home;
    return { id: chosen.club_id, name: chosen.name, role: chosen.role, isHome: chosen.club_id === clubId, choices: choices };
  }

  // Adds "?club=<id>" to a link when the club is not this site's own (keeps the choice across pages).
  function withClub(href, club) {
    if (!club || club.isHome) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'club=' + encodeURIComponent(club.id);
  }

  // Where the club picker goes for a club: the same page in that club's own copy of the site
  // (clubs.site_url, for example https://site.thenines.club/lesronds/), so its language and logo
  // follow. Without a site address, this page with ?club=<id>.
  function clubPageUrl(target) {
    var here = window.location.pathname;
    var page = here.indexOf(siteRoot.pathname) === 0 ? here.slice(siteRoot.pathname.length) : 'members/index.html';
    if (target && target.club_id !== clubId && target.site_url && /^https:\/\//.test(target.site_url)) {
      return new URL(page, target.site_url.replace(/\/?$/, '/')).href;
    }
    var url = new URL(window.location.href);
    if (!target || target.club_id === clubId) url.searchParams.delete('club');
    else url.searchParams.set('club', target.club_id);
    return url.href;
  }

  // "Club: [The Nines ▾]" in the given container, only for people with more than one club to choose.
  // Changing it reloads the page for that club.
  function renderClubPicker(container, club) {
    if (!container || club.choices.length < 2) return;
    var select = el('select', { id: 'club-picker-select' });
    club.choices.forEach(function (c) {
      var option = el('option', { value: String(c.club_id), text: c.name });
      if (c.club_id === club.id) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      window.location.assign(clubPageUrl(club.choices.find(function (c) { return String(c.club_id) === select.value; })));
    });
    container.replaceChildren(el('label', { for: 'club-picker-select', text: 'Club' }), select);
    container.hidden = false;
  }

  window.Nines = {
    client: client,
    clubId: clubId,
    clubName: siteClub.NAME,
    lang: siteClub.LANG === 'fr' ? 'fr' : 'en',
    urlParams: urlParams,
    siteUrl: siteUrl,
    el: el,
    setText: setText,
    showState: showState,
    friendlyError: friendlyError,
    signOut: signOut,
    bindSignOutButtons: bindSignOutButtons,
    loadAccess: loadAccess,
    pickClub: pickClub,
    withClub: withClub,
    renderClubPicker: renderClubPicker,
    clubPageUrl: clubPageUrl,
    guardMembersPage: guardMembersPage
  };
})();
