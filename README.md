# The Nines: members website

The website for **The Nines**, a private dining club in London (about 25 members).

- Public home page: <https://site.thenines.club>
- Map (separate project, not in this repo): <https://map.thenines.club>

The site is plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.
Login and private data live in Supabase.

**This repository is public. Never commit secrets.** The only Supabase values that belong here are the
project URL and the publishable (anon) key in `js/config.js`. Never add any other Supabase key or a
database password anywhere in this repo.

## What is here (steps 1 to 5)

| File | What it does |
| --- | --- |
| `index.html` | Public placeholder home: logo, one line about the club, link to the map, "Member login". |
| `login.html` | Sign in with Google, email and password (sign in, create account, forgot password), or an emailed sign-in link. |
| `members/index.html` | Member home: "Welcome, name", role, a prompt to complete your profile, links. |
| `members/directory.html` | All listed members as cards (photo, name, bio, and email/phone only if they chose to show them), with search by name. |
| `members/profile.html` | Edit your own profile. Admins open it as `profile.html?profile=<id>` to edit anyone's, with extra "Listed" and "Foreign member" settings. |
| `members/admin.html` | Club admins only: add a member (access and card together), remove access, remove from club, edit, hide or show cards, change emails, and manage brigadier groups, all for this site's club. |
| `js/config.js` | Supabase project URL and publishable key (public by design), and which club this site belongs to (`CLUB_ID`). |
| `js/auth.js` | Shared Supabase client, login checks and page states. |
| `js/nav.js` | The shared top bar on every members page (Home, Directory, Map, Admin, Sign out). |
| `js/people.js` | Member cards, signed photo links and photo resizing, shared by the directory, profile and admin pages. |
| `js/login.js`, `js/members.js`, `js/directory.js`, `js/profile.js`, `js/admin.js` | Page scripts. |
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

One Supabase project serves several clubs: **The Nines** (club 1, site.thenines.club) and **Les Ronds**
(club 2, lesronds.thenines.club, site still to come). Each site knows its own club from `CLUB_ID` in
`js/config.js`. One person has one login and one shared profile, and can belong to several clubs.

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

### Directory privacy

- Members only see a club's directory through the database function `directory(club)`, and only for
  clubs they belong to. It returns listed cards only. Someone's email or phone appears **only** when that
  person ticked "Show my email" / "Show my phone number" for that club, except that **the club's admins
  always see every email and phone** in their club's directory.
- Ordinary members can read only their **own** rows in `members`, `profiles` and `club_profiles`, so
  they cannot look up other people's email or phone directly. Club admins read and edit their club's
  people; super admins everyone.
- Headshots are in a **private** storage bucket called `headshots`, one file per person at
  `<profile id>/avatar.jpg`, shared by all their clubs. Signed-in members can view headshots; only the
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

### 3. Turn on GitHub Pages

In the GitHub repo: **Settings → Pages**. Set the source to the `main` branch, root folder. The custom
domain `site.thenines.club` comes from the `CNAME` file. Add a DNS `CNAME` record for `site` pointing to
`officeofthenines.github.io`, then tick **Enforce HTTPS** once it is offered.

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
3. Tell the member to go to the site and choose **Member login**. They can use Google if that email is a
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

The last one should return an error or an empty list `[]`, never file names.

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
  Supabase project.
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
- **Club config:** `CLUB_ID` and `CLUB_NAME` in `js/config.js` say which club a site serves (1 = The
  Nines). The Les Ronds site will be the same code with `CLUB_ID: 2` and its own branding.
- **Maps (planned):** both club maps (map.thenines.club for club 1, ronds.thenines.club for club 2) stay
  public. Each restaurant row read from their Google Sheets carries a `club_id`, so later members signed
  in to that club may see extra detail. Nothing is gated yet.
