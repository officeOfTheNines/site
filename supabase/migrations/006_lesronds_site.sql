-- ===========================================================================
-- STEP 6: Les Ronds' site address and name
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 005. Safe to run again. Only changes two clubs rows.
-- Every club now lives under one web address, in its own folder: The Nines at the root, Les Ronds
-- at /lesronds/ (lesronds.thenines.club forwards there). The club pickers use site_url to open the
-- same page in the other club's folder, in its language.

update public.clubs set site_url = 'https://site.thenines.club/' where id = 1;
update public.clubs set site_url = 'https://site.thenines.club/lesronds/', name = 'Dîner des Ronds' where id = 2;

notify pgrst, 'reload schema';
