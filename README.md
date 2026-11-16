# The Nines: members website

The website for **The Nines**, a private dining club in London (about 25 members).

- Public home page: <https://site.thenines.club>
- Map (separate project, not in this repo): <https://map.thenines.club>

The site is plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.
Login and private data live in Supabase.

**This repository is public. Never commit secrets.** The only Supabase values that belong here are the
project URL and the publishable (anon) key in `js/config.js`. Never add any other Supabase key or a
database password anywhere in this repo.

## What is here (steps 1 to 4)

| File | What it does |
| --- | --- |
| `index.html` | Public placeholder home: logo, one line about the club, link to the map, "Member login". |
| `login.html` | Sign in with Google, email and password (sign in, create account, forgot password), or an emailed sign-in link. |
| `members/index.html` | Member home: "Welcome, name", role, a prompt to complete your profile, links. |
| `members/directory.html` | All listed members as cards (photo, name, bio, and email/phone only if they chose to show them), with search by name. |
| `members/profile.html` | Edit your own profile. Admins open it as `profile.html?profile=<id>` to edit anyone's, with extra "Listed" and "Foreign member" settings. |
| `members/admin.html` | Admins only: add a member (access and card together), remove access, edit, hide, show or delete directory cards, and manage brigadier groups. |
| `js/config.js` | Supabase project URL and publishable key (public by design). |
| `js/auth.js` | Shared Supabase client, login checks and page states. |
| `js/nav.js` | The shared top bar on every members page (Home, Directory, Map, Admin, Sign out). |
| `js/people.js` | Member cards, signed photo links and photo resizing, shared by the directory, profile and admin pages. |
| `js/login.js`, `js/members.js`, `js/directory.js`, `js/profile.js`, `js/admin.js` | Page scripts. |
| `css/style.css` | Dark green and brass styles. |
| `supabase/schema.sql` | The complete schema for a new project: tables, security rules, helper functions, the headshots storage bucket and the first two admins. |
| `supabase/migrations/` | One file per step, to upgrade a project that is already running. |
| `CNAME` | Custom domain `site.thenines.club` for GitHub Pages. |

### How access works

1. Anyone can create an account (Google, password or emailed link).
2. An account only gets in when its email is **confirmed** and the address is in the `allowed_emails`
   table. Everyone else sees: "Your email is not on the member list. Please contact the office."
3. This is enforced **in the database** with row-level security. The checks in the page only decide what
   to show. A person who is not on the list gets nothing back from the database, even if they call the
   API directly.
4. The publishable (anon) key on its own must not be able to read any table or call any function.
   `schema.sql` grants nothing to the `anon` role.

### Access, sign-ins and directory cards (step 2)

Three separate ideas, in three tables:

| Table | Means | Created by |
| --- | --- | --- |
| `allowed_emails` | **Access**: who may sign in, their role, and whether they need a card (`needs_profile`) | Admins |
| `members` | **Sign-in record**: one row per login account | Automatically, when someone on the list signs in |
| `profiles` | **Directory card**: name, bio, phone, photo and settings, one per email | Admins in advance, or automatically on first sign-in |

- **Admins can create a card before the person ever signs in.** "Add a member" on the admin page puts the
  email on the list and creates the card in one step.
- **Linking happens on first sign-in.** When someone signs in with a **confirmed** email that matches a
  card, the card is linked to their login (`profiles.member_id`). Google and password sign-ins with the
  same email land on the same card. If there is no card for their email, a blank one is created. From then
  on they can edit their own card and nobody else's. An unconfirmed account cannot claim a card.
- **Removing access never deletes the card.** Access stops at once. The admin chooses whether to hide the
  card (the dialog suggests hiding). If it stays listed, it shows a **"Former member"** label. Adding the
  email again restores access and keeps the card as it was.
- **Deleting a card** is a separate admin action, with a confirmation. It removes the card and the photo
  for good. If the person still has access, a blank card is created the next time they sign in.
- **Whether a card appears in the directory depends only on "Listed"**, which only admins change. Use it,
  for example, to keep an admin out of the directory.
- **Office and staff accounts can have no card at all.** When an email's `needs_profile` is off, no card
  is ever created for it automatically (not on sign-in, not during the upgrade). It still has full access.
  `office@thenines.club` starts this way. Switch it per email with **No card** / **Create card** in the
  admin page's Access table, or tick **No directory card** when adding someone.
- **"Foreign member"** (admins only) marks people who have moved abroad. They keep access and appear with a
  "Foreign member" label. When the site starts sending club emails, they will be left out.

### Brigadier groups (step 3)

- A **brigadier group** is the standing team that organises the monthly dinners: usually two members,
  rarely three. Each dinner is run by one group.
- Two tables: `brigadier_groups` (one row per group, with a plain integer `id`) and
  `brigadier_group_members` (which cards belong to which group). Members are directory cards
  (`profiles`), so groups can be set up before people sign in.
- **Co-brigadiers are never stored.** A person's co-brigadiers are worked out from the groups they share,
  so the relationship is never typed twice. Directory cards show "Co-brigadiers: …", naming listed cards
  only.
- A person normally belongs to one group. More than one is allowed (the admin page marks people who are
  already in a group) but the site does not build anything special around it.
- Admins create, edit and delete groups on the admin page. Deleting a group keeps the cards; deleting a
  card removes it from its groups.
- **Intended next step:** a `dinners` table with a `brigadier_group_id integer references
  brigadier_groups (id)` column, so the "Brigadiers" shown for a dinner (today a free-text string such as
  "James S.") come from that group's members.

### Directory privacy (step 2)

- Members only see other people through the database function `directory()`. It returns listed cards
  only, and includes someone's email or phone **only** when that person ticked "Show my email" / "Show my
  phone number". Both are off until they choose, including on cards created by an admin.
- Ordinary members can read only their **own** row in `members` and `profiles`, so they cannot look up
  other people's email or phone directly. Admins can read and edit everything.
- Headshots are in a **private** storage bucket called `headshots`, one file per card at
  `<profile id>/avatar.jpg`. Members can view all headshots but can only upload, replace or delete their own.
  The site shows photos through signed links that stop working after one hour.
- Photos are cropped to a square, resized to 400 × 400 and saved as JPEG in the browser before upload,
  which also removes camera details such as location. Files over 5 MB or that are not images are refused.

## Setup (one-off, done by the office)

### 1. Run the database schema

1. Open the Supabase dashboard for the project `bfblobnjrhcacwoqszwh`.
2. Go to **SQL Editor**, then **New query**.
3. Paste the whole of `supabase/schema.sql` and press **Run**.

It is safe to run again later: it will not duplicate anything or remove members you have added.
It creates the two first admins: `office@thenines.club` and `jbsolanet@gmail.com`.

**Upgrading an existing project:** run only the file for the new step, from `supabase/migrations/`:

| File | What it adds |
| --- | --- |
| `migrations/004_change_email.sql` | Step 4: `admin_change_email()`, so an admin can move a member to a new email in one action. Only adds a function. |
| `migrations/003_brigadier_groups.sql` | Step 3: brigadier groups (`brigadier_groups`, `brigadier_group_members`), co-brigadiers on directory cards, and the admin actions to save and delete groups. Only adds things. |
| `migrations/002_directory.sql` | Step 2: the `profiles` table (directory cards, which admins can create before someone signs in), the `directory()` function, the admin actions `admin_add_member()` and `admin_remove_access()`, the private `headshots` storage bucket and its rules, and tighter rules on who can read the `members` table. Removing access no longer deletes anything. |

These files only add and change rules. They never delete rows, so members you added by hand in Supabase
stay as they are. Each one is safe to run twice. `schema.sql` always holds the complete, current schema
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

1. Sign in as an admin (`office@thenines.club` or `jbsolanet@gmail.com`) and open **Admin** (or go to
   `members/admin.html`).
2. Under **Add a member**, type their email and display name, choose **Member** or **Admin**, tick or untick
   **Listed in the directory** and **Foreign member**, and press **Add member**. This gives access and
   creates their card. You then land on their card and can add a bio, phone, photo and choices.
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

The new email must not already be in use. You cannot change your own email; ask another admin.

To remove someone's access, press **Remove** in the **Access** table and choose whether to hide their card
too. You cannot remove yourself, and the last admin cannot be removed or demoted; the database blocks both.
To change someone's role, remove their access and add them again with the new role (their card is kept).

You can also give access in the Supabase SQL editor (they get a blank card when they first sign in):

```sql
insert into public.allowed_emails (email, role, added_by)
values (lower('Name@Example.com'), 'member', 'office')
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
- [ ] **An address not on the list cannot read `allowed_emails` or `members` through the API, even with
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
  a fresh project). To do: live, by comparing `select count(*) from allowed_emails;` before and after.
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

#### Seeing the directory as a particular member (SQL editor)

Replace the id with a real login id from `select id, email from public.members;`. Nothing is changed.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'PUT-LOGIN-ID-HERE', 'role', 'authenticated')::text, true);
select display_name, email, phone from public.directory();  -- email/phone only where that person opted in
select email from public.members;                          -- only this member's own row
select email, phone from public.profiles;                  -- only this member's own card
rollback;
```

### Checking that the anon key can see nothing

Run these from any terminal. Each should fail with a permission error (HTTP 401 or 403, or a message
containing `permission denied`), never return data:

```bash
curl -s "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/allowed_emails?select=*" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9"
```

```bash
curl -s "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/members?select=*" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/my_access" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/is_member" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{}"
```

```bash
curl -s -X POST "https://bfblobnjrhcacwoqszwh.supabase.co/rest/v1/rpc/directory" -H "apikey: sb_publishable_QQEzrHya4R6QqEuvYT1XyQ_BJPKGly9" -H "Content-Type: application/json" -d "{}"
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
- Deleting a card from the admin page removes its headshot too. A card deleted directly in the Supabase
  table editor leaves its photo in the bucket (Supabase does not allow deleting storage files from SQL);
  tidy it up in **Storage → headshots** if needed.
