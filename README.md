# The Nines: members website

The website for **The Nines**, a private dining club in London (about 25 members).

- Public home page: <https://site.thenines.club>
- Map (separate project, not in this repo): <https://map.thenines.club>

The site is plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.
Login and private data live in Supabase.

**This repository is public. Never commit secrets.** The only Supabase values that belong here are the
project URL and the publishable (anon) key in `js/config.js`. Never add any other Supabase key or a
database password anywhere in this repo.

## What is here (step 1)

| File | What it does |
| --- | --- |
| `index.html` | Public placeholder home: logo, one line about the club, link to the map, "Member login". |
| `login.html` | Sign in with Google, email and password (sign in, create account, forgot password), or an emailed sign-in link. |
| `members/index.html` | Member home: "Welcome, name", role, sign out. Placeholder for later steps. |
| `members/admin.html` | Admins only: see, add and remove allowed emails. |
| `js/config.js` | Supabase project URL and publishable key (public by design). |
| `js/auth.js` | Shared Supabase client, login checks and page states. |
| `js/login.js`, `js/members.js`, `js/admin.js` | Page scripts. |
| `css/style.css` | Dark green and brass styles. |
| `supabase/schema.sql` | Tables, security rules, helper functions and the first two admins. |
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

## Setup (one-off, done by the office)

### 1. Run the database schema

1. Open the Supabase dashboard for the project `bfblobnjrhcacwoqszwh`.
2. Go to **SQL Editor**, then **New query**.
3. Paste the whole of `supabase/schema.sql` and press **Run**.

It is safe to run again later: it will not duplicate anything or remove members you have added.
It creates the two first admins: `office@thenines.club` and `jbsolanet@gmail.com`.

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
