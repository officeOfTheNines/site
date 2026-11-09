// Public Supabase settings for The Nines members site.
//
// These two values are SAFE to publish: the publishable (anon) key only identifies the project.
// It cannot read any table or call any function on its own; row-level security and the grants
// in supabase/schema.sql decide what a signed-in member may see.
//
// NEVER put any other Supabase key, a database password or any other secret in this repo.
// The repo is public.
window.NINES_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://bfblobnjrhcacwoqszwh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9'
});
