# The Nines: members website

The website for **The Nines**, a private dining club in London (about 25 members).

- Public home page: <https://site.thenines.club>
- Map (separate project, not in this repo): <https://map.thenines.club>

The site is plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.
Login and private data live in Supabase.

**This repository is public. Never commit secrets.** The only Supabase values that belong here are the
project URL and the publishable (anon) key in `js/config.js`. Never add any other Supabase key or a
database password anywhere in this repo.

## What is here (steps 1 and 2)

| File | What it does |
| --- | --- |
| `index.html` | Public placeholder home: logo, one line about the club, link to the map, "Member login". |
| `login.html` | Sign in with Google, email and password (sign in, create account, forgot password), or an emailed sign-in link. |
| `members/index.html` | Member home: "Welcome, name", role, a prompt to complete your profile, links. |
| `members/directory.html` | All listed members as cards (photo, name, bio, and email/phone only if they chose to show them), with search by name. |
| `members/profile.html` | Edit your own profile. Admins open it as `profile.html?member=<id>` to edit someone else's. |
| `members/admin.html` | Admins only: add and remove allowed emails; edit any profile; hide or show someone in the directory. |
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

### Directory privacy (step 2)

- Members only see other members through the database function `directory()`. It returns listed members
  only, and includes someone's email or phone **only** when that member ticked "Show my email" / "Show my
  phone number". Both are off until the member chooses.
- Ordinary members can read only their **own** row in `members` and `profiles`, so they cannot look up
  other people's email or phone directly. Admins can read and edit everything.
- Headshots are in a **private** storage bucket called `headshots`, one file per member at
  `<member id>/avatar.jpg`. Members can view all headshots but can only upload, replace or delete their own.
  The site shows photos through signed links that stop working after one hour.
- Photos are cropped to a square, resized to 400 × 400 and saved as JPEG in the browser before upload,
  which also removes camera details such as location. Files over 5 MB or that are not images are refused.
- Admins can hide a member from the directory ("Hide" on the admin page) without removing their login.

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
| `migrations/002_directory.sql` | Step 2: the `profiles` table, the `directory()` function, the private `headshots` storage bucket and its rules, and tighter rules on who can read the `members` table. |

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

TODO: upload `favicon.png` (the logo, used on the pages too), `favicon.ico` and `favicon-180.png`
(Apple touch icon) to the repo root. Every page already links to them. Until they are uploaded, the
pages show the name "The Nines" without the logo.

## Adding members

1. Sign in as an admin (`office@thenines.club` or `jbsolanet@gmail.com`) and open **Admin** (or go to
   `members/admin.html`).
2. Type the member's email, choose **Member** (or **Admin**), and press **Add**.
3. Tell the member to go to the site and choose **Member login**. They can use Google if that email is a
   Google account, or create an account with a password, or ask for a sign-in link. They must use the same
   email address that is on the list.

To remove someone, press **Remove** next to their email. They lose access straight away, and their member profile is deleted (it comes back if they are added again and log in).
You cannot remove yourself, and the last admin cannot be removed or demoted. The database blocks both.
To change someone's role, remove them and add them again with the new role.

You can also add people in the Supabase SQL editor:

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

- [ ] **A member sees the directory and can edit only their own profile.** Ran: locally (a member's
  insert or update for someone else is rejected; trying to hide themselves is ignored) and in Chromium
  (opening `profile.html?member=<someone else>` as a member shows "Admins only"). To do: live.
- [ ] **A member with "Show my email" off has no email in the directory response, even through the API with
  the publishable key and a member's login.** Ran: locally (`directory()` returns null email and phone
  while the flags are off). To do: live, with the SQL below or a browser's network tab.
- [ ] **Members can no longer read other people's email or phone from `members` or `profiles`.** Ran:
  locally (a member gets only their own row from each table; admins get all). To do: live.
- [ ] **Turning a flag on makes that detail appear, and turning it off removes it.** Ran: locally and in
  the profile preview. To do: live.
- [ ] **A headshot upload works, is resized, and shows through an expiring link.** Ran: in Chromium (a
  1200 × 800 image is uploaded as a 400 × 400 JPEG with no camera data, to `<own id>/avatar.jpg`; links are
  requested for 3600 seconds). To do: live, including checking the link stops working after an hour.
- [ ] **A member cannot overwrite or delete someone else's headshot.** Ran: locally against the storage
  rules (upload to another folder or any other file name is rejected; update and delete of another member's
  file affect nothing). To do: live.
- [ ] **An address not on the list, or a logged-out visitor, gets nothing from the directory or the
  bucket.** Ran: locally (anon: permission denied; outsider: zero rows and zero files). To do: live, with
  the commands below.
- [ ] **Admins can edit any profile and hide someone from the directory without removing their login.**
  Ran: locally and in Chromium. To do: live.
- [ ] **The navigation bar shows Admin only to admins, highlights the current page, collapses to a menu on
  phones, and Map opens the public map in a new tab.** Ran: in Chromium. To do: live.

#### Seeing the directory as a particular member (SQL editor)

Replace the id with a real one from `select id, email from public.members;`. Nothing is changed.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'PUT-MEMBER-ID-HERE', 'role', 'authenticated')::text, true);
select display_name, email, phone from public.directory();  -- email/phone only where that person opted in
select email from public.members;                          -- only this member's own row
select member_id, phone from public.profiles;              -- only this member's own row
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
- The members top bar is built by `js/nav.js`. To add a page to it in a later step, add one line to the
  `LINKS` list at the top of that file and put `<header class="site-header" data-nav="<key>"></header>`
  on the new page.
- Removing an email from the list deletes that person's `members` and `profiles` rows, but their headshot
  file stays in the bucket (Supabase does not allow deleting storage files from SQL). Members cannot see it
  without a profile pointing to it. To tidy up, delete the folder in **Storage → headshots**.
