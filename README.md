# The Nines: members website

The website for **The Nines**, a private dining club in London (about 25 members).

- Public home page: <https://site.thenines.club>
- Map (separate project, not in this repo): <https://map.thenines.club>

The site is plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.
Login and private data live in Supabase.

**This repository is public. Never commit secrets.** The only Supabase values that belong here are the
project URL and the publishable (anon) key in `js/config.js`. Never add any other Supabase key or a
database password anywhere in this repo.

## What is here

| File | What it does |
| --- | --- |
| `index.html` | Public placeholder home: logo, one line about the club, link to the map, "Member area". |
| `login.html` | Sign in with Google, email and password (sign in, create account, forgot password), or an emailed sign-in link. |
| `members/index.html` | Member home: "Welcome, name", role, a prompt to complete your profile, **Recent activity** (recos and comments from your clubs, with the My clubs / All clubs toggle), **My activity**, links. |
| `members/directory.html` | All listed members as cards (photo, name, bio, and email/phone only if they chose to show them), with search by name. |
| `members/profile.html` | Edit your own profile. Admins open it as `profile.html?profile=<id>` to edit anyone's, with extra "Listed" and "Foreign member" settings. |
| `members/recos.html` | **Recos**: restaurants members recommend, on a full-screen map shared across clubs. Search by name, add a reco (+ or a long-press on the map), edit or delete your own. Separate from the club's dinner map. |
| `members/dinners.html` | Club admins only: the club's dinner calendar (date, optional venue, brigadier group), open or close replies, set a deadline, and each dinner's replies (totals, "no answer yet" filter, force an answer, CSV export). |
| `members/admin.html` | Club admins only: add a member (access and card together), remove access, remove from club, edit, hide or show cards, change emails, and manage brigadier groups, all for this site's club. |
| `js/config.js` | Supabase project URL and publishable key (public by design). |
| `js/club.js` | Which club this copy of the site serves: id, name, language, tagline, map address (The Nines). |
| `js/i18n.js` | Shows the pages in the club's language: French wording for every English text, and the club's name and map on the pages. |
| `clubs/<slug>/` | Every other club: its `club.js` and logo. `clubs/lesronds/` is published at `/lesronds/`. |
| `scripts/build-site.sh`, `.github/workflows/publish.yml` | Build and publish the site on every merge: The Nines at the root, each club in its own folder. |
| `js/auth.js` | Shared Supabase client, login checks and page states. |
| `js/nav.js` | The shared top bar on every members page (Home, Directory, Recos, Map, Admin, Sign out). |
| `js/people.js` | Member cards, signed photo links and photo resizing, shared by the directory, profile and admin pages. |
| `js/places-search.js` | Finding a restaurant for Recos: `searchPlaces(query)` (OpenStreetMap search through Photon), `nearestPlace(lat, lng)` (what is at a point of the map, for long-press) and reading pasted Google Maps links. The only file to change to switch search provider. |
| `js/club-switch.js` | The current club, for members of more than one club: a small switch in the top bar of every members page. |
| `js/dinner-scores.js` | Dinner pins, colour tiers, legend and score buttons, ported from the club dinner maps, for the Events view. |
| `js/dinner.js`, `js/dinners.js` | The "Next dinner" panel on the member home, and the Dinners admin page. |
| `js/activity.js`, `js/scope.js` | The home page's activity sections, and the "My clubs / All clubs" choice shared by the home page and the Recos map (remembered per member in the browser). |
| `js/login.js`, `js/members.js`, `js/directory.js`, `js/profile.js`, `js/admin.js`, `js/recos.js` | Page scripts. |
| `css/style.css` | Dark green and brass styles. |
| `supabase/schema.sql` | The complete current schema for a new project (all clubs): tables, security rules, functions, the headshots storage bucket, the clubs and the first admins. |
| `supabase/migrations/` | One file per step, to upgrade a project that is already running. |
| `CNAME` | Custom domain `site.thenines.club` for GitHub Pages. |

### How access works

1. Anyone can create an account (Google, password or emailed link).
2. An account only gets into a club's member area when its email is **confirmed** and is on **that club's**
   access list (`club_access`), or belongs to a super admin. Everyone else sees: "Your email is not on the
   member list. Please contact the office."
3. This is enforced **in the database** with row-level security. The checks in the page only decide what
   to show. A person who is not on the list gets nothing back from the database, even if they call the
   API directly.
4. The publishable (anon) key on its own must not be able to read any table or call any function.
   `schema.sql` grants nothing to the `anon` role.

### Clubs, access, profiles and cards (step 5)

One Supabase project serves several clubs: **The Nines** (club 1, site.thenines.club, English) and
**Dîner des Ronds** (club 2, site.thenines.club/lesronds/, French). Each copy of the site knows its own
club from `js/club.js`. One person has one login and one shared profile, and can belong to several
clubs. All clubs share one web address, so one sign-in covers them all.

### Clubs, folders and languages

- **One codebase, one folder per club.** The Nines' pages are the site root. Each other club has a folder
  in `clubs/` (its `club.js` and logo); on every merge GitHub builds the site with a copy of the pages in
  that club's folder (`scripts/build-site.sh`). Nothing is copied by hand.
- **Language:** `LANG` in the club's `club.js` (`en` or `fr`). The pages are written in English and
  `js/i18n.js` shows them in French when asked, including messages that appear later. Names and bios are
  never translated. To change a French wording, edit `js/i18n.js`.
- **Name, tagline, footer and map** on the pages come from the club's `club.js`. The `clubs` table holds
  the same names and addresses for the club pickers and the Map menu (`site_url`, `map_url`).
- **Club picker:** choosing another club opens the same page in that club's folder, in its language.
- **Short address:** lesronds.thenines.club forwards to site.thenines.club/lesronds/ (Squarespace →
  Domains → thenines.club → forwarding). The address bar then shows site.thenines.club/lesronds/.
- **Adding a club later:** add its row to the `clubs` table (SQL), a folder `clubs/<slug>/` with its
  `club.js` (copy `clubs/lesronds/club.js`) and logo, then merge.
- **Placeholder logo:** Dîner des Ronds uses a plain white circle until its logo arrives; replace the three
  `favicon` files in `clubs/lesronds/`.

| Table | Means | Created by |
| --- | --- | --- |
| `clubs` | One row per club: id, name, web address, map address | `schema.sql` |
| `club_access` | **Access**: who may open each club's member area, their role there (member or admin) and whether they need a card (`needs_profile`). One row per person **per club** | Club admins |
| `super_admins` | People who manage every club (an admin of all clubs) | The SQL editor |
| `members` | **Sign-in record**: one row per login account | Automatically, on sign-in |
| `profiles` | **Shared profile**: name, phone, photo, one per email, used by all the person's clubs | Admins in advance, or automatically on first sign-in |
| `club_profiles` | **Card in one club**: bio, listed, foreign member, show email, show phone | Admins in advance, or automatically on first sign-in |

- **Admins can create a card before the person ever signs in.** "Add a member" puts the email on the
  club's list and creates the card in one step, reusing the person's shared profile if another club
  already made one.
- **Linking happens on first sign-in.** When someone signs in with a **confirmed** email that matches a
  profile, it is linked to their login (`profiles.member_id`). Google and password sign-ins with the same
  email land on the same profile. Clubs that need a card get a blank one. An unconfirmed account cannot
  claim anything.
- **Two ways to remove someone, both for one club only:**
  - **Remove access** (Access table): they can no longer open the club's member area; their card is kept,
    hidden if the admin asks (the dialog suggests hiding), otherwise shown with a **"Former member"**
    label. Adding the email again restores access and keeps the card.
  - **Remove from club** (Directory cards table): deletes their access, their card and their brigadier
    group places in that club, after a confirmation. A group that would be left with fewer than two
    members is deleted too, but only after the dialog says so. If the person then belongs to **no club at
    all** (no access and no card anywhere), their shared profile, photo and login record (`members`) are
    deleted as well. Their Supabase sign-in account is not; it simply has no access, and can be deleted in
    **Authentication → Users** if wanted. Someone in several clubs keeps their profile and login.
  - Neither action ever touches another club.
- **Whether a card appears in a club's directory depends only on that card's "Listed"**, which only that
  club's admins change. Use it, for example, to keep an admin out of the directory.
- **Office and staff accounts can have no card at all** (`needs_profile` off for that club):
  `office@thenines.club` starts this way. Switch it with **No card** / **Create card** in the Access
  table, or tick **No directory card** when adding someone.
- **"Foreign member"** (admins only, per club) marks people who have moved abroad. They keep access and
  appear with a "Foreign member" label. When the site starts sending club emails, they will be left out.
- **Club pickers** (only for people in more than one club; everyone else sees no change):
  - **Directory:** a "Club" dropdown next to the heading, defaulting to the site's own club.
  - **Map:** the top bar's "Map" becomes a small menu with each club's map (both public, new tab).
  - **Admin page:** a club dropdown for people who administer more than one club (super admins), plus
    the read-only list of super admins.
  - The chosen club travels in the address (`?club=2`), so a reload or a link keeps it, and "Edit my
    profile" or "Edit" open the card in that club. Each site still opens on its own club.
- **Super admins** (`jbsolanet@gmail.com`) are admins of every club. Each club also has its own admins in
  `club_access`. A club must always keep at least one admin of its own.

### Brigadier groups (step 3)

- A **brigadier group** is the standing team that organises a club's monthly dinners: usually two members,
  rarely three. Each group belongs to one club (`brigadier_groups.club_id`).
- Two tables: `brigadier_groups` (one row per group, with a plain integer `id`) and
  `brigadier_group_members` (which people belong to which group). Members must have a card in the group's
  club, so groups can be set up before people sign in.
- **Co-brigadiers are never stored.** A person's co-brigadiers are worked out from the groups they share,
  so the relationship is never typed twice. Directory cards show "Co-brigadiers: …", naming listed cards
  only.
- A person normally belongs to one group. More than one is allowed (the admin page marks people who are
  already in a group) but the site does not build anything special around it.
- Club admins create, edit and delete their club's groups on the admin page. Deleting a group keeps the
  cards; removing someone from the club removes them from its groups.
- **Intended next step:** a `dinners` table with a `brigadier_group_id integer references
  brigadier_groups (id)` column, so the "Brigadiers" shown for a dinner (today a free-text string such as
  "James S.") come from that group's members.

### Recos (step 7)

Members' own restaurant recommendations, on a map in the members area (`members/recos.html`, "Recos" in
the top bar). The club's official dinner map (map.thenines.club, ronds.thenines.club) is separate and
unchanged.

- **Places and comments.** `venues` (called `reco_places` before step 9) holds one row per restaurant (name, address, coordinates, an
  optional OpenStreetMap id). `reco_comments` holds the recos: who wrote it, the club they posted as,
  a description of up to 300 characters, and who can see it.
- **Who can see a reco** (the slider when adding one):
  - **Everyone** (default): members of every club.
  - **My club**: only members of the club it was posted as.
  - **Only me**: only the author. Super admins can also see it, to moderate.
- **A restaurant appears on someone's map only if they can see at least one of its recos** (or added
  it). Nothing else gives it away: no count, error or "already recommended" warning mentions a
  restaurant they cannot see.
- **Each line reads** "FirstName L., Club name: description. 17 Nov 2026". Emails and phone numbers are
  never shown.
- **Posting.** Members post only as themselves and only as a club they belong to. Members of several
  clubs choose which one ("Post as"; the default is the club of the site they are on). People with no
  card (office accounts) cannot post.
- **Duplicates.** Before adding, the site asks the database for a restaurant the member can already
  see with the same OpenStreetMap id, or within about 30 m with a similar name. If there is one, it
  shows "Already recommended" with its recos, and the new reco is added to that restaurant instead of
  making a second pin. If the only match is one the member cannot see, the database quietly adds the
  reco to it without saying so. The member then sees that restaurant under the name and address it
  was first saved with, which may differ slightly from what they typed.
- **Editing.** Authors edit or delete their own recos from the map popup, including who can see them.
  Club admins can delete recos posted as their club; super admins can delete any. Deleting a
  restaurant's last reco removes the restaurant.
- **Database rules.** New recos go through the function `add_reco()` only; reading goes through
  `reco_feed()` and row-level security. Who added a restaurant (`created_by`) is never readable from
  the site. Visitors who are not signed in get nothing.

#### The Recos page

- **Full-screen map** with a slim bar on top: **←** back to the club's home page, **search**, and **+** to add
  a reco. The back address is `BACK_URL` at the top of `js/recos.js` (today `../`: `/` for The Nines,
  `/lesronds/` for Les Ronds), to change when the home page moves.
- **Search** filters the pins by name as you type and lists the matches; picking one opens its card. It
  ignores case and accents, and only ever sees the recos the member is allowed to see. Words starting
  with `#` are reserved for tags, once recos have them.
- **Long-press the map** (about half a second; right-click or a long mouse press on a computer) to add a
  reco at that spot. The page suggests the nearest restaurant from OpenStreetMap, or leaves the name
  empty to type. A press next to an existing reco (within about 40 m) offers to add to it instead. Moving
  the finger or a second finger (pinch) cancels the press, so dragging and zooming still work.
- A **tip** about long-press shows on the first visit until it is dismissed (remembered in the browser).

#### Recent activity and the My clubs / All clubs toggle (step 9)

- The member home shows **Recent activity**: new recos ("added") and new comments on existing ones
  ("commented on"), newest first, 20 at a time with "Load more". Each card shows "First L., Club", the
  restaurant, its postcode or area, the comment cut to about 140 characters and how long ago; tapping it
  opens that reco on the map. Below it, **My activity** lists the member's own recos and comments.
- Everything comes from the existing reco tables through `activity_feed(scope, limit, before)`, which runs
  with the member's own rights (row-level security applies) and adds: never your own events; "Only me"
  never shown to others; "My club" only to that club's members. **My clubs** = by members of your clubs;
  **All clubs** = also "Everyone" recos by members of any club. Edits make no event; deleting removes it.
- The same toggle filters the Recos map ("All clubs" shows every pin you can see, as before). The choice
  is shared by both pages and remembered per member in the browser; it starts on "My clubs".
- Stars, price level and photos are not stored yet: the feed returns them as empty, and each card keeps a
  hidden thumbnail slot for later.

#### Venues and club events (step 9, ready for the dinner maps)

- `venues` holds every restaurant once (each reco points to it through `reco_comments.venue_id`): those members recommend (Recos) and, later, those where the club
  dined. A restaurant can be both, so it is one pin.
- `club_events` is ready for the two dinner maps' Google Sheets but not used by the site yet. One row per
  dinner: `club_id`, `venue_id`, `event_date`, `season` and `month` (as written in the sheet), `brigadiers`
  (a JSON array of names as text, as they were at the time), `rating_wine`, `rating_food`, `rating_vibe`
  (sheet columns bottles, plate, atmosphere), `menu_url`, `notes`, and `source_ref` (the sheet's own id,
  so an import can be re-run). Ratings are out of the club's `clubs.rating_scale` (10 for The Nines, 20
  for Les Ronds); the database refuses a rating above it.
- Nobody can read or write `club_events` from the site yet: it is filled in the SQL editor or by an import
  script. A venue used by a club event cannot be deleted, and removing its last reco keeps it.
- **Menus** (step 10) live in the private `menus` bucket at `menus/<club slug>/<file>` (for example
  `menus/nines/1.1.pdf`), and `club_events.menu_url` holds that path. Only members of that club and super
  admins can open them, through links that expire; the office uploads them (Supabase dashboard,
  **Storage → menus**, or an import script).
- The dinners and venues from both dinner maps' Google Sheets were loaded once with a private SQL file (it
  holds members' names, so it is not in this repo).
- Importing a sheet row: find the venue with the same rules as Recos duplicates (same map id, or within
  about 30 m with a similar name), or create it, then add the event.

#### Dinner calendar and replies (step 11)

- **Calendar**: club admins plan dinners on the Dinners page: a date (dinners never have a time), an optional
  venue, and the brigadier group. Each dinner's replies are **Not open** (hidden from members, the default),
  **Open** or **Closed**, with an optional deadline. The 107 past dinners from the dinner maps are Not open.
- **Home panel**: each member sees, for each of their clubs, the nearest dinner from today (in the club's time
  zone: London for The Nines, Paris for Les Ronds) whose replies are Open or Closed: date, venue, the
  brigadiers' photos and short names, and a Reply button (Attending / Not attending). With none, it shows "Our
  last dinner at <restaurant>".
- **Change window**: a member may change their reply only within **1 hour of their first reply** (changing it
  does not restart the hour), only while replies are Open and before the deadline, and never once an admin has
  set it. Otherwise the page says "Please contact us directly".
- **Enforced in the database**: members cannot write replies directly; `rsvp_answer()` checks the club, the
  status, the deadline, the hour and the admin lock with the server's clock. Members read only their own
  reply; club admins read their club's. `admin_set_answer()` sets, forces or clears a reply; a reply set by an
  admin is locked for the member.

#### Events on the Recos map, and the current club (step 12)

- **Events**: a button at the bottom left of the Recos map swaps the reco pins for the dinners of the member's
  current club (and back: the button then reads "Recos"). The map keeps its position and zoom; the choice is
  remembered in the browser. One pin per restaurant, coloured by the most recent dinner's score with the dinner
  maps' scale (gold 7.5+, silver 6.5–7.5, bronze below, out of 10; the same once scaled for Les Ronds' 20);
  grey "Not rated" when it has no score. Buttons: Overall (the average of the ratings present), Food, Wine,
  Atmosphere. The popup lists every dinner there: date, season, brigadiers, scores out of the club's scale, and
  a Menu link (private menus open through a link that expires). In Events the + button and long-press are
  off, and My clubs / All clubs (Recos only) is hidden.
- Data comes from `club_dinner_map(club)`, for members of that club only; dinners still to come whose replies
  are not open stay hidden, and so do dinners without a venue.
- **Current club**: members of more than one club get a switch in the top bar (the club's name). It sets one
  shared current club, remembered in the browser and starting with the club of the site they are on, used
  by the home page's dinner panel, its My clubs feed, and the Events view (all refresh in place). On pages
  about one club (directory, profile, admin, dinners), switching opens that page for the chosen club.
  Members of one club see no switch.

#### Claude's read access to replies (optional)

Migration 011 creates a view, `v_event_answers_for_claude` (dinner date, club, venue, member name, answer, last
change, set by: no emails, phones or ids), and a role, `claude_reader`, that can read only that view, in
read-only transactions. The role cannot sign in until you give it a password:

1. In the Supabase SQL editor, run `alter role claude_reader with login password '...';` with a long random
   password you type there. Never put it in this repo, in a chat or in an email.
2. Supabase dashboard, **Connect**, "Session pooler": copy the connection string, with the user
   `claude_reader.bfblobnjrhcacwoqszwh` and that password.
3. Give it to Claude only as a connector's configuration (for example a Postgres connector or MCP server in
   Claude Desktop or Claude Code, where the string is stored in its settings), never typed into a conversation.
4. To switch it off: `alter role claude_reader nologin;`.

#### Finding a restaurant

The search box uses **Photon** (photon.komoot.io), a free search over **OpenStreetMap** data. To respect
its fair-use terms, it searches only after the member stops typing (0.6 s), at most once a second, keeps
a small cache, and asks for 6 results. Results are biased towards the club's city.

A member can also **paste a Google Maps link** (`google.com/maps/place/…`): the name and coordinates are
read from the link itself, and nothing is fetched from Google. Short links (`maps.app.goo.gl/…`) cannot be
read without asking Google, so the page asks the member to open the link and paste the full address.
Either way, the member confirms the spot by dragging the pin on a small map.

**Adding Google Places later (not done now).** What would change:

1. Get a Google Maps Platform API key with the Places API enabled, restricted by HTTP referrer to
   `site.thenines.club`, with a monthly spending cap. A browser key is public, so the restrictions are what
   protect it.
2. Replace the body of `searchPlaces()` in `js/places-search.js` with a Places Autocomplete call (Place
   Autocomplete then Place Details, with session tokens so each search is billed once). The rest of the site
   would not change.
3. Add Google's hosts (`maps.googleapis.com`, `places.googleapis.com`) to `connect-src` (and `script-src`
   if using Google's script) in the Content-Security-Policy of `members/recos.html`.
4. Store Google's `place_id` as `external_id` (for example `google:ChIJ…`) so duplicates match exactly.
   Google's terms allow keeping place ids indefinitely, but not caching names, addresses or coordinates
   from Google beyond short limits. So either keep what the member confirms on the map (their own entry),
   or refresh the details from Google when showing them.
5. Show "Powered by Google" next to the search results, as Google's terms require, and follow their rules
   on displaying Google results on a non-Google map.

### A different photo per club (step 8)

Everyone has a **main photo** (`profiles.photo_path`), shown in all their clubs. A person's card in one
club can also have **its own photo** (`club_profiles.override_photo_path`, file
`<profile id>/club-<club id>.jpg`), shown in that club's directory instead. When it is empty, the main
photo shows. For example, Arnaud's main photo shows at The Nines, and Les Ronds can show a different one.

- **Changing a photo on the profile page** (or pressing "Remove photo") from club X changes the main photo
  and club X's photo: club X's own photo is cleared, so the new main photo shows there. Other clubs that
  have their own photo keep it. When a club shows its own photo, the profile page says so under the photo.
- **Club photos are set by the office**, in bulk: upload the file to the `headshots` bucket as
  `<profile id>/club-<club id>.jpg` (Supabase dashboard, **Storage → headshots**, in the person's folder),
  then in the SQL editor:

  ```sql
  update public.club_profiles
  set override_photo_path = profile_id::text || '/club-' || club_id::text || '.jpg'
  where club_id = 2 and profile_id = (select id from public.profiles where email = 'person@example.com');
  ```

  The database only accepts that exact file name for that card.
- "Remove from club" deletes the person's photo for that club too.

### Directory privacy

- Members only see a club's directory through the database function `directory(club)`, and only for
  clubs they belong to. It returns listed cards only. Someone's email or phone appears **only** when that
  person ticked "Show my email" / "Show my phone number" for that club, except that **the club's admins
  always see every email and phone** in their club's directory.
- Ordinary members can read only their **own** rows in `members`, `profiles` and `club_profiles`, so
  they cannot look up other people's email or phone directly. Club admins read and edit their club's
  people; super admins everyone.
- Headshots are in a **private** storage bucket called `headshots`. Each person has one main photo at
  `<profile id>/avatar.jpg`, shared by all their clubs. A club can also show **its own photo** of someone
  (see "A different photo per club" below). Signed-in members can view headshots; only the
  person, or an admin of one of their clubs, can upload, replace or delete theirs. The site shows photos
  through signed links that stop working after one hour.
- Photos are cropped to a square, resized to 400 × 400 and saved as JPEG in the browser before upload,
  which also removes camera details such as location. Files over 5 MB or that are not images are refused.

## Setup (one-off, done by the office)

### 1. Run the database schema

1. Open the Supabase dashboard for the project `bfblobnjrhcacwoqszwh`.
2. Go to **SQL Editor**, then **New query**.
3. Paste the whole of `supabase/schema.sql` and press **Run**.

It runs as one transaction and is safe to run again. It creates the two clubs, the super admin
(`jbsolanet@gmail.com`) and The Nines' first admins (`office@thenines.club`, with no card, and
`jbsolanet@gmail.com`).

**Upgrading an existing project:** run only the file for the new step, from `supabase/migrations/`:

| File | What it adds |
| --- | --- |
| `migrations/012_events_map.sql` | Step 12: `club_dinner_map(club)` for the Events view on the Recos map, and `activity_feed()` gets an optional current club for "My clubs". Functions only; no table or data changes. |
| `migrations/011_dinner_calendar.sql` | Step 11: dinner calendar and replies. `club_events` gets `brigadier_group_id`, `rsvp_status` (not_open / open / closed) and `rsvp_deadline`, and its venue becomes optional; `clubs` gets `timezone`; new table `club_event_answers`; functions `rsvp_answer()`, `home_dinner_panel()`, `admin_set_answer()`, `admin_event_answers()`, `admin_save_event()`, `admin_set_rsvp_status()`, `admin_set_rsvp_deadline()`, `admin_club_events()`, `admin_venue_options()`, `admin_brigadier_group_options()`; the read-only view and role for Claude. Nothing deleted; past dinners unchanged. |
| `migrations/010_menus.sql` | Step 10: dinner menus. A private `menus` storage bucket (PDFs and photos, up to 20 MB), one folder per club (`menus/<club slug>/<file>`); only that club's members and super admins can open them. `club_events.menu_url` also accepts such a path. Only adds things. |
| `migrations/009_activity_feed.sql` | Step 9: renames `reco_places` to `venues` and `reco_comments.place_id` to `venue_id` (no data changes; the Recos functions that use them are re-created, and `add_reco()` / `reco_feed()` now return `venue_id`), adds `clubs.rating_scale` (10 / 20) and `club_events` (club dinners, empty for now), and the home page's activity feed: `activity_feed()`, `my_reco_activity()`, `reco_scope_place_ids()` (the map's "My clubs" view), two helpers and four indexes. Existing Recos permissions unchanged. |
| `migrations/008_club_photos.sql` | Step 8: a club's own photo for someone. Adds `club_profiles.override_photo_path`, lets club photo files into the headshots bucket, and makes `directory()` show the club's photo when there is one. Only adds things. |
| `migrations/007_recos.sql` | Step 7: Recos. Adds `reco_places` (renamed `venues` in step 9) and `reco_comments`, their security rules, and the functions `add_reco()`, `find_reco_place()` and `reco_feed()`. Only adds things; runs as one transaction. |
| `migrations/006_lesronds_site.sql` | Step 6: Les Ronds' name ("Dîner des Ronds") and address (`site.thenines.club/lesronds/`) in the `clubs` table. Only updates two rows. |
| `migrations/005_multi_club.sql` | Step 5: several clubs. Adds `clubs`, `club_access` (replacing `allowed_emails`; every existing row moves to club 1), `super_admins` and `club_profiles` (each card's bio and settings move there, club 1), puts brigadier groups in club 1, and makes every rule and function per club. Runs as one transaction: if anything fails, nothing changes. |
| `migrations/004_change_email.sql` | Step 4: `admin_change_email()`, so an admin can move a member to a new email in one action. Only adds a function. |
| `migrations/003_brigadier_groups.sql` | Step 3: brigadier groups (`brigadier_groups`, `brigadier_group_members`), co-brigadiers on directory cards, and the admin actions to save and delete groups. Only adds things. |
| `migrations/002_directory.sql` | Step 2: the `profiles` table (directory cards, which admins can create before someone signs in), the `directory()` function, the admin actions `admin_add_member()` and `admin_remove_access()`, the private `headshots` storage bucket and its rules, and tighter rules on who can read the `members` table. Removing access no longer deletes anything. |

These files never lose member data: rows you added by hand in Supabase are kept (005 moves them to the
new tables). Each one is safe to run twice. `schema.sql` always holds the complete, current schema
(every step together) for setting up a brand-new project.

### 2. Check the Supabase auth settings

These were set up already. Check them again if login links go to the wrong place:

- **Authentication → URL Configuration**: Site URL `https://site.thenines.club`. Redirect URLs include
  `https://site.thenines.club/**` and `https://officeofthenines.github.io/site/**`.
- **Authentication → Sign In / Providers**: Email (with "Confirm email" on) and Google enabled.
- **Emails (important):** Supabase's built-in email sender is only for testing. It sends very few emails per
  hour and may only deliver to members of the Supabase team. Before inviting members, set up your own email
  sender under **Authentication → Emails → SMTP Settings** (for example Resend, Postmark or your Google
  Workspace). Otherwise confirmation, password reset and sign-in emails will not arrive. Google sign-in
  needs no email, so it works either way.

### 3. Publishing (GitHub Pages)

The site is built and published by GitHub on every merge to `main` (`.github/workflows/publish.yml`), so
each club's folder is created automatically. One-off setting: in the GitHub repo, **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The custom domain stays `site.thenines.club` (DNS `CNAME`
record for `site` pointing to `officeofthenines.github.io`, **Enforce HTTPS** ticked). Each publish shows
in the **Actions** tab; **Run workflow** there republishes without a code change.

### 4. Logo and favicons

`favicon.png` (the logo, also shown on the pages), `favicon.ico` and `favicon-180.png` (Apple touch icon)
are in the repo root, copied from the map site so both sites share the same logo.

## Adding members

Everything on the admin page applies to **this site's club** (The Nines on site.thenines.club).

1. Sign in as an admin of the club (or a super admin) and open **Admin** (or go to `members/admin.html`).
2. Under **Add a member**, type their email and display name, choose **Member** or **Admin**, tick or untick
   **Listed in the directory** and **Foreign member**, and press **Add member**. This gives access to the
   club and creates their card. You then land on their card and can add a bio, phone, photo and choices.
   If the person is already in another club, their shared name, phone and photo are reused.
3. Tell the member to go to the site and choose **Member area**. They can use Google if that email is a
   Google account, or create an account with a password, or ask for a sign-in link. They must use the same
   email address. Their card then becomes theirs to edit.

For an office or staff account that should have access but no directory card, tick **No directory card**
before pressing **Add member**.

Emails that are on the list without a card (for example ones added by hand in Supabase) show **Create
card** and **No card** buttons in the **Access** table. Unless marked "No card", they also get a blank card
automatically when they first sign in.

### Changing someone's email

If a member starts using a different email, press **Change email** next to them in the **Access** table
(or, for someone without access, in the **Directory cards** table) and type the new address. In one step:

1. their access moves to the new email, keeping their role and settings;
2. their card moves too, keeping photo, bio, brigadier groups and choices;
3. their old login stops working. When they sign in with the new email (Google or password), the card
   links to them automatically. Nothing is duplicated or deleted.

The new email must not already be in use. You cannot change your own email; ask another admin. An email
is shared by all of a person's clubs, so a club admin can only change it for someone who is in no other
club; otherwise a super admin does it.

### Removing someone

- **Remove** (Access table) = remove access to this club, keeping their card; choose whether to hide it.
- **Remove from club** (Directory cards table) = delete their access, card and brigadier places in this
  club, after a confirmation that says what else will happen (see "Clubs, access, profiles and cards").

You cannot remove yourself, and a club's last admin cannot be removed or demoted; the database blocks
both. To change someone's role, remove their access and add them again with the new role (their card is
kept).

You can also give access in the Supabase SQL editor (they get a blank card when they first sign in):

```sql
insert into public.club_access (club_id, email, role, added_by)
values (1, lower('Name@Example.com'), 'member', 'office')
on conflict (club_id, email) do nothing;
```

To make someone a super admin (admin of every club), only in the SQL editor:

```sql
insert into public.super_admins (email, added_by) values (lower('name@example.com'), 'office')
on conflict (email) do nothing;
```

## Checks

Status key: **Ran** = tested while building; **To do** = needs the live Supabase project and a browser.

Before building this, the database rules were tested on a local PostgreSQL 16 copy, with stand-ins for
Supabase's `auth.users`, `auth.uid()` and the `anon` / `authenticated` roles. The pages were tested in
Chromium with a fake Supabase server. Neither replaces a test against the real project.

- [ ] **An address not on the list can sign up and sign in but sees only the "not on the list" message.**
  Ran: locally (database returns nothing, page shows only the message and sign out).
  To do: live, with a real throwaway account.
- [ ] **An address not on the list cannot read `club_access` or `members` through the API, even with
  the anon key.** Ran: locally (permission denied for anon; zero rows for a signed-in outsider; inserts
  rejected). To do: live, with the commands below.
- [ ] **A listed address sees the member home.** Ran: page with a fake server. To do: live.
- [ ] **An admin sees the admin page; a plain member is turned away.** Ran: page with a fake server, and
  database rules locally. To do: live.
- [ ] **An admin can add and remove emails.** Ran: page with a fake server, and database rules locally
  (emails are trimmed and lowercased, duplicates and bad addresses rejected, "added by" is recorded
  by the database). To do: live.
- [ ] **The last admin cannot be removed or demoted.** Ran: locally, including deleting all admins at once
  and two admins removing each other at the same moment. To do: live.
- [ ] **Opening `members/index.html` or `members/admin.html` logged out goes to the login page.**
  Ran: in Chromium. To do: live.
- [ ] **No secrets in the repo.** Ran: searched the full history of this branch for private Supabase
  keys, JWTs, passwords and private keys. Only the publishable key is present. Repeat before each merge.
- [ ] **Google sign-in, email confirmation, password reset and emailed sign-in links work end to end.**
  Could not run: needs the live project and real email.

#### Step 2: directory, profiles, headshots, navigation

- [ ] **An admin can add a member (access and card in one step) before they sign in; when that person signs
  in with the same confirmed email, the card becomes theirs, with no duplicate.** Ran: locally (an
  unconfirmed account is not linked; a confirmed one is linked to the admin's card and can then edit only
  that card) and in Chromium (the form, the redirect to the new card, saving it). To do: live.
- [ ] **Someone on the list with no card gets a blank one on first sign-in, with email and phone hidden.**
  Ran: locally. To do: live.
- [ ] **Removing access keeps the card; the admin chooses whether to hide it; a listed card without access
  shows "Former member"; adding the email again restores access and keeps the card.** Ran: locally and in
  Chromium (the dialog, with hiding ticked by default). To do: live.
- [ ] **Deleting a card is admin-only, asks for confirmation and removes the photo too.** Ran: locally
  (members cannot delete) and in Chromium. To do: live.
- [ ] **Office/staff accounts (`needs_profile` off, such as `office@thenines.club`) never get a card
  automatically, keep full admin access and still see the directory; admins can switch this per email and
  create a card later.** Ran: locally (upgrade, sign-in, access-only add, switching, re-running the file
  does not undo an admin's choice) and in Chromium. To do: live.
- [ ] **"Listed" and "Foreign member" can only be changed by admins.** Ran: locally (a member's attempt is
  ignored; an admin can set and clear both) and in Chromium. To do: live.
- [ ] **Upgrading a running step 1 project keeps every allowlist entry and member.** Ran: locally with
  hand-added addresses (all kept; signed-in members got cards with their names; the result is identical to
  a fresh project). To do: live, by comparing `select count(*) from club_access;` before and after.
- [ ] **A member sees the directory and can edit only their own profile.** Ran: locally and in Chromium
  (opening `profile.html?profile=<someone else>` as a member shows "Admins only"). To do: live.
- [ ] **A member with "Show my email" off has no email in the directory response, even through the API with
  the publishable key and a member's login.** Ran: locally (`directory()` returns null email and phone
  while the flags are off). To do: live, with the SQL below or a browser's network tab.
- [ ] **Members cannot read other people's email or phone from `members` or `profiles`.** Ran: locally (a
  member gets only their own row from each table; admins get all). To do: live.
- [ ] **Turning a flag on makes that detail appear, and turning it off removes it.** Ran: locally and in
  the profile preview. To do: live.
- [ ] **A headshot upload works, is resized, and shows through an expiring link.** Ran: in Chromium (a
  large image is uploaded as a 400 × 400 JPEG with no camera data, to `<profile id>/avatar.jpg`; links are
  requested for 3600 seconds). To do: live, including checking the link stops working after an hour.
- [ ] **A member cannot overwrite or delete someone else's headshot.** Ran: locally against the storage
  rules. To do: live.
- [ ] **An address not on the list, or a logged-out visitor, gets nothing from the directory or the
  bucket.** Ran: locally (anon: permission denied; outsider and removed members: zero rows and zero files).
  To do: live, with the commands below.
- [ ] **The navigation bar shows Admin only to admins, highlights the current page, collapses to a menu on
  phones, and Map opens the public map in a new tab.** Ran: in Chromium. To do: live.

#### Step 3: brigadier groups

- [ ] **Admins can create, edit and delete brigadier groups of two or three; one person in two groups is
  allowed.** Ran: locally and in Chromium (validation for fewer than two members and duplicates; the
  confirmation before deleting). To do: live.
- [ ] **Co-brigadiers appear on each member's directory card and on their own profile preview, worked out
  from shared groups; hidden cards are never named.** Ran: locally and in Chromium. To do: live.
- [ ] **Only admins can change groups or read the group tables; outsiders and logged-out visitors get
  nothing.** Ran: locally. To do: live.
- [ ] **Deleting a card removes it from its groups; deleting a group keeps the cards.** Ran: locally.
  To do: live.

#### Step 4: change email

- [ ] **An admin can move a member to a new email: access, card, photo, bio, groups and choices move with
  it; the old login loses access; the new login lands on the same card with no duplicate.** Ran: locally
  (including a login that already uses the new email, a former member with only a card, and renaming an
  office account) and in Chromium (the dialog, its checks, Escape to cancel). To do: live.
- [ ] **Refused: an email already in use, an invalid address, the same address, your own email, and
  anyone who is not an admin.** Ran: locally. To do: live.

#### Step 5: several clubs

- [ ] **Upgrading keeps every access row, profile, card, group and login, and the Nines site works as
  before.** Ran: locally on a copy of the live data (27 access rows, 26 profiles, 9 groups, 19 group
  places, all kept; the next new group is still number 10; the upgraded database is identical to a fresh
  `schema.sql`) and in Chromium (all earlier page checks, now per club). To do: live.
- [ ] **A member sees only their own club's directory; a person in two clubs sees both, with one profile
  and a card in each.** Ran: locally. To do: live, once Les Ronds has members.
- [ ] **Club admins manage only their own club; super admins manage all clubs.** Ran: locally (a Les
  Ronds admin cannot add to The Nines, read The Nines' access list, edit Nines-only people, change the
  email of someone also in The Nines, or put a Nines-only person in a Les Ronds group). To do: live.
- [ ] **Admins see every email and phone in their club's directory; members only where shown.** Ran:
  locally. To do: live.
- [ ] **Remove from club deletes access, card and group places in that club only; asks before deleting a
  group left with fewer than two; deletes the shared profile and login record only when the person is in
  no club.** Ran: locally (both cases, plus "not yourself" and "never the club's last admin") and in
  Chromium (the confirmation dialog, photo removed first when the profile goes). To do: live.
- [ ] **Remove access still keeps the card as "Former member".** Ran: locally. To do: live.

#### Club pickers

- [ ] **People in one club see no picker and a plain Map link; people in several clubs get the Directory
  club dropdown, the Map menu with each club's map, and (as admins of several clubs) the Admin club
  dropdown and super-admin list. The choice is kept in the address and followed by profile edits.** Ran:
  in Chromium with a fake server (switching to Les Ronds shows its empty directory, admin actions go to
  club 2, phone layout and touch targets). To do: live; a super admin can try it now, before Les Ronds has
  members.

#### Dîner des Ronds site (French)

- [ ] **site.thenines.club/lesronds/ shows Dîner des Ronds in French (home, login, member pages, admin,
  messages), with its placeholder logo and map; The Nines at the root is unchanged.** Ran: on the built
  site in Chromium (all earlier checks still pass at the root; a scan of the visible French pages found no
  English wording left). To do: live, after switching Pages to GitHub Actions.
- [ ] **The club picker opens the same page in the other club's folder, in its language, signed in.**
  Ran: in Chromium. To do: live.
- [ ] **lesronds.thenines.club forwards to site.thenines.club/lesronds/.** To do: after the Squarespace
  forwarding is set up.

#### Step 7: Recos

Ran: every rule below on a local copy of the database with The Nines and Les Ronds members loaded (people
in both clubs, admins, a super admin, and a visitor who is not signed in), and the page in Chromium with a
fake server (English and French, phone layout). To do: live, with two or three real accounts, after
running `007_recos.sql`. Use members of different clubs, one of them not a super admin.

- [ ] **1. An "Only me" reco is invisible to others.** Member A adds a new restaurant with the slider on
  **Only me**. Member B (another club, not a super admin) sees no pin and no entry in the list. B then
  adds the same restaurant: there is **no** "Already recommended" warning. B's reco appears on the map
  as normal, and A's line is still not shown to B.
- [ ] **2. "My club" recos stay within the club.** A member of The Nines adds a reco with **My club**.
  Another Nines member sees it; a Les Ronds-only member sees neither the line nor, if it is the only reco,
  the pin.
- [ ] **3. Nobody can post as a club they are not in.** The "Post as" choice lists only the member's own
  clubs. In the SQL editor, posting as another club is refused:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub', 'LOGIN-ID-OF-A-NINES-ONLY-MEMBER', 'role', 'authenticated')::text, true);
  select * from public.add_reco(2, 'Test', null, 48.85, 2.35, null, 'test', 'everyone');
  -- expect: ERROR  You can only post as a club you belong to.
  rollback;
  ```
- [ ] **4. A duplicate adds a reco, not a second pin.** Member B searches for a restaurant A has already
  recommended (visible to B). Pressing **Add my reco** shows "Already recommended" with A's reco; pressing
  **Add my reco to it** adds B's line to the same pin. There is still one pin, now with two recos.
- [ ] **5. Deleting the last reco removes the pin.** On a restaurant with only your reco, press
  **Delete** in the popup and confirm. The pin and the list entry disappear.
- [ ] **Edit and delete rights.** Only your own lines show **Edit**. Club admins see **Delete** on lines
  posted as their club; super admins on every line.
- [ ] **Not signed in sees nothing** (see the anon checks below, including `reco_feed`).

#### Step 12: Events on the Recos map, current club

Ran: the functions on a local copy with both clubs' dinners, and the pages in Chromium with a fake server
(desktop, 375 px and 320 px phones, French). To do: live, after running `012_events_map.sql`.

- [ ] **Events shows the club's dinners, coloured like the dinner map; Recos brings the recos back, same view.**
- [ ] **A pin's popup lists every dinner at that restaurant; Menu opens the menu.**
- [ ] **A member of both clubs switches club in the top bar: the Events pins, legend and the home panel follow.**
- [ ] **A member of one club sees no switch.**

#### Step 11: dinner calendar and replies

Ran: every rule on a local copy of the database with both clubs' members and the 107 imported dinners (first
reply, change at 59 and 61 minutes, a change inside the hour not restarting it, deadline, closed and not open,
admin lock, cross-club, members reading only their own), and the pages in Chromium with a fake server (phone,
desktop, French). To do: live, after running `011_dinner_calendar.sql`.

- [ ] **An admin adds a dinner on the Dinners page and opens it; it appears at the top of every member's home.**
- [ ] **A member replies; the page shows the reply and "You can change this until HH:MM"; after that time,
  changing says "Please contact us directly".**
- [ ] **The admin forces a reply; the member can no longer change it.**
- [ ] **A Not open dinner never appears on a member's home.**
- [ ] **The Replies sheet shows every member, the "no answer yet" filter and totals, and exports a CSV.**

#### Step 9: activity feed and My clubs / All clubs

Ran: every rule on a local copy of the database with both clubs' members (Nines-only, both clubs, Les Ronds
admin, super admin), and the pages in Chromium with a fake server (desktop, phone, French). To do: live,
after running `009_activity_feed.sql`.

- [ ] **Your own recos never appear in Recent activity, but do in My activity.**
- [ ] **An "Only me" reco never appears in anyone else's feed; a "My club" reco only for that club's members.**
- [ ] **My clubs shows people from your clubs; All clubs adds "Everyone" recos from the other club.**
- [ ] **The toggle on the home page and on the map stay in step; tapping a card opens that reco on the map.**
- [ ] **Editing a comment does not bring it back to the top; deleting it removes it.**

#### Recos page: full-screen map and long-press

Ran: in Chromium with a fake server, desktop and phone sizes, touch emulated (long-press, drag, pinch),
English and French. To do: on a real phone.

- [ ] **The map fills the screen; the bar shows ←, search and +; the CARTO / OpenStreetMap credits stay
  visible.**
- [ ] **Search finds a reco whatever the accents or capitals, and picking it opens its card.**
- [ ] **Long-press an empty spot: a marker appears and the add form opens with the nearest restaurant's
  name (or an empty name). Saving puts the reco at that spot.**
- [ ] **Dragging or pinching the map never opens the form. Cancel removes the marker.**
- [ ] **Long-press right next to an existing reco: "Already recommended" appears with an offer to add to it.**

#### Step 8: a different photo per club

Ran: on a local copy of the database with both clubs' members (directory per club, file-name rules,
storage rights, clearing), and the profile page in Chromium with a fake server. To do: live, with Arnaud's
cards after the bulk photo load.

- [ ] **With a club photo set for Les Ronds, Les Ronds' directory shows it and The Nines' shows the main
  photo.**
- [ ] **On Les Ronds' profile page, the club photo shows with the note under it. Saving a new photo there
  changes the photo in both clubs, and the note goes away.**
- [ ] **Saving a new photo from The Nines leaves Les Ronds' own photo as it is.**

#### Seeing the directory as a particular member (SQL editor)

Replace the id with a real login id from `select id, email from public.members;`. Nothing is changed.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'PUT-LOGIN-ID-HERE', 'role', 'authenticated')::text, true);
select display_name, email, phone from public.directory(1); -- email/phone only where opted in (all, for admins)
select email from public.members;                          -- only this member's own row
select email, phone from public.profiles;                  -- only this member's own profile
rollback;
```

### Checking that the anon key can see nothing

Run these from any terminal. Each should fail with a permission error (HTTP 401 or 403, or a message
containing `permission denied`), never return data:

```bash
curl -s "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/club_access?select=*" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9"
```

```bash
curl -s "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/members?select=*" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/my_access" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{\"p_club\":1}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/is_member" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{\"p_club\":1}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/directory" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{\"p_club\":1}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/storage/v1/object/list/headshots" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{\"prefix\":\"\"}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/reco_feed" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{}"
```

```bash
curl -s "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/venues?select=*" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9"
```

The headshots one should return an error or an empty list `[]`, never file names.

You can also check in the SQL editor that `anon` has no privileges:

```sql
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';           -- expect no rows

select routine_name from information_schema.role_routine_grants
where grantee = 'anon' and routine_schema = 'public';         -- expect no rows
```

## Technical notes

- supabase-js is loaded from jsDelivr at a pinned version (`2.118.0`) with a subresource-integrity hash.
  To upgrade, change the version in the three pages that load it and update the `integrity` hash.
- Emailed links use Supabase's "implicit" flow, so a link works even when it is opened in a different
  browser or app from the one that asked for it.
- Each page has a Content-Security-Policy that only allows this site, jsDelivr, Google Fonts and the
  Supabase project. `members/recos.html` also allows the map tiles (CARTO, basemaps.cartocdn.com) and the
  place search (photon.komoot.io). The tiles use the same CARTO key as the dinner map (public by design; allowed domains are set in the CARTO dashboard).
- Leaflet `1.9.4` (the Recos map) is loaded from jsDelivr with subresource-integrity hashes, like supabase-js.
- **Fresh files after each deploy:** the build adds `?v=<commit>` to every local stylesheet and script
  address in the pages (`scripts/build-site.sh`), so browsers and phones never mix a new page with an
  old cached `style.css` or script.
- Paths are relative, so the site works both at `site.thenines.club` and at
  `officeofthenines.github.io/site/`.
- Text from the database is always inserted with `textContent`, never `innerHTML`.
- `.gitignore` blocks spreadsheets, CSV files, `import*.sql` files and a `private/` folder, so member lists
  with emails are never committed to this public repo by accident. Member data is loaded with SQL run in
  the Supabase SQL editor, never stored here.
- The members top bar is built by `js/nav.js`. To add a page to it in a later step, add one line to the
  `LINKS` list at the top of that file and put `<header class="site-header" data-nav="<key>"></header>`
  on the new page.
- "Remove from club" removes the person's headshot too when their profile is deleted (they are in no
  other club). A profile deleted directly in the Supabase table editor leaves its photo in the bucket
  (Supabase does not allow deleting storage files from SQL); tidy it up in **Storage → headshots** if needed.
- **Club config:** `js/club.js` (The Nines) and `clubs/<slug>/club.js` (other clubs) say which club a
  copy of the site serves, in which language. Kept in files, not the database, because pages need it
  before anyone signs in.
- **Maps (planned):** both club maps (map.thenines.club for club 1, ronds.thenines.club for club 2) stay
  public. Each restaurant row read from their Google Sheets carries a `club_id`, so later members signed
  in to that club may see extra detail. Nothing is gated yet.
