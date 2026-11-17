// Which club this copy of the site serves. The Nines' copy lives at the site root; every other club
// has a folder (for example /lesronds/) built automatically with its own clubs/<slug>/club.js.
// Kept in a file, not the database, because pages need it before anyone signs in.
window.NINES_CLUB = Object.freeze({
  CLUB_ID: 1,                         // same id as in the clubs table
  NAME: 'The Nines',                  // shown in the top bar, titles and home page
  LANG: 'en',                         // 'en' or 'fr' (French wording is in js/i18n.js)
  TAGLINE: 'A private dining club in London.',
  FOOTER: 'The Nines · London',
  MAP_URL: 'https://map.thenines.club'
});
