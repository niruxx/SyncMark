# SyncMark

A self-hosted bookmark manager. Import bookmark exports from your browser (HTML or JSON) into a local server, then browse, search, edit, and delete them from a web UI — protected by a username/password you set up on first run.

![Bookmarks — list view](docs/screenshots/02-bookmarks-list.png)

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Hosting](#hosting)
- [Updating an existing instance](#updating-an-existing-instance)
- [Configuration](#configuration)
- [Importing bookmarks](#importing-bookmarks)
- [Browser extensions](#browser-extensions)
- [Contacts & CardDAV sync](#contacts--carddav-sync)
- [Calendar & CalDAV sync](#calendar--caldav-sync)
- [File Manager](#file-manager)
- [API](#api)

## Features

- Material Design 3 interface in the Google Photos idiom: tonal surfaces, pill-shaped nav and buttons, a prominent rounded search bar in the app bar, Material Symbols icons, elevation instead of borders, and Roboto throughout — plus deliberately-paced animated transitions between pages (via the CSS View Transitions API where supported, with an equivalent hand-rolled fade for browsers without it, e.g. Firefox)
- Light and dark themes, both built on the same Material tonal palette (light by default; switch in Settings → Appearance)
- A subtle, slow-drifting animated gradient behind the app (off automatically for anyone with reduced-motion preferences set) — only ever shown once you're signed in, never behind the sign-in/register screen
- **A dedicated sign-in/register page on first run**: the first person to open SyncMark lands on a clean, standalone welcome page — a two-step wizard (username/password, then which of Bookmarks/Contacts/Calendar to turn on) rather than a dialog over a half-loaded app; after that, every visit opens a plain sign-in page before anything else loads. No email/SMTP involved anywhere — see [Resetting a forgotten password](#resetting-a-forgotten-password) for the CLI-based recovery path instead
- **Feature toggles** (Settings → General, also set during first-run): turn Bookmarks/Contacts/Calendar/Files on or off — disabling one hard-blocks its API and CardDAV/CalDAV routes, not just its nav tab — see [Feature toggles](#feature-toggles)
- Click the "SyncMark" title in the top left from anywhere to jump back to your bookmarks
- Configurable session length (Settings → Session): stay signed in for 5 minutes, 1 hour, 30 days, or permanently (never asked again) — applies the next time you sign in
- Account menu (top right, click your name): jump to account settings or sign out from anywhere in one click, no need to dig into Settings first
- Account management (top right): set a custom profile picture (PNG/JPEG/GIF/WebP, up to 2 MB — stored in the database and shown in the top bar on every page), and change your username or password, each re-confirmed with your current password
- A top progress bar on every action — API calls and page navigations alike — so nothing ever feels like it silently hung
- Delete account (Settings → Danger zone): password-confirmed, permanently wipes the account *and* every bookmark/folder/setting, then returns to the first-run setup screen
- Import Netscape-format HTML bookmark exports (Chrome, Firefox, Edge, Safari) and JSON exports (Chrome's `Bookmarks` file, Firefox's JSON backup, or a generic `{title, url}[]` array)
- Add bookmarks manually, and edit or delete any bookmark (title, URL, folder) — imported or manual
- Browse bookmarks in a collapsible folder tree — expand a folder to see its bookmarks inline, or click it to filter the main view (subfolders included); search over title and URL
- Manage folders directly: create empty folders, rename (cascades to subfolders and their bookmarks) — either via the "Manage folders" dialog, or double-click a folder's name right in the sidebar for a quick inline rename — or delete (bookmarks become unfiled, not deleted)
- Double-click a bookmark's title — in list view or grid view — to rename it in place, without opening the full edit dialog
- Drag sidebar folders up/down to reorder them (siblings under the same parent only); the order sticks
- Favorite/star any bookmark and jump straight to them from the sidebar; sort the list by title or date added
- Reorganize by dragging: in list or grid view, drag a bookmark to a new spot to reorder it — this automatically switches sort to "Custom order" so the drop sticks; drag it onto a sidebar folder (or "★ Favorites") to move it there instead. Expanding a folder in the sidebar also shows its bookmarks as its own drag-reorderable list
- List and grid view, each showing the site's favicon next to every entry, with animated transitions throughout
- Export the whole library as an HTML file (re-importable in any browser) or JSON, from the Settings page
- Keyboard shortcuts: `/` to search, `n` to add a bookmark, `Esc` to close dialogs
- Settings page: import bookmarks, light/dark theme, default view, library stats, export, and a clear-all-bookmarks reset
- Single Node process, SQLite storage — no external database required
- Firefox and Chrome toolbar extensions (`extensions/`) for quick access without opening a tab
- **Contacts tab** with its own add/edit/delete UI (name, phone numbers, emails, organization, notes, favorite, photo) plus a built-in **CardDAV server** so contacts stay in sync with your phone's native contacts app — see [Contacts & CardDAV sync](#contacts--carddav-sync)
- Contacts: import/export `.vcf` (vCard) or `.csv` files, multi-select with a bulk-action bar (favorite/unfavorite/export/delete selected), sort by name or date added
- Contacts: fuzzy search (name/org/title/phone/email/tags), a unified read-only Contact Card, Markdown notes, addresses/social profiles/messaging handles/custom fields/key dates, relationships linked to other contacts, and tags + drag-and-drop manual or rule-based smart groups — see [Fuzzy search, unified cards, tags & groups](#fuzzy-search-unified-cards-tags--groups)
- **Calendar tab** with a full month-grid view, basic recurring events (daily/weekly/monthly, with an optional end date), and a built-in **CalDAV server** so events sync with your phone's native calendar app — the same server address and login as Contacts sync — see [Calendar & CalDAV sync](#calendar--caldav-sync)
- Calendar: click a date to open that day's events in a side panel (the month grid shrinks to make room); right-click a date or an event for a quick Add/Edit/Remove menu; import/export `.ics` (iCalendar) files
- Settings → **How to use SyncMark**: an in-app quick tour plus step-by-step CardDAV/CalDAV sync setup for iOS, Android, Linux, and Windows
- **File Manager tab** (off by default — turn it on in Settings → General) — browse, upload, download, rename, and delete files under one or more admin-configured, strictly sandboxed server folders ("locations") — see [File Manager](#file-manager)
- **Tabbed Settings**: General / Bookmarks / Files / Contacts / Calendar, each with only the import/export, sync, and stats controls relevant to it, instead of one long scrolling page

## Screenshots

| | |
|---|---|
| ![First-run welcome / account setup](docs/screenshots/01-welcome-setup.png) First-run welcome screen — creates the one account that protects this instance | ![Sign in](docs/screenshots/05-sign-in.png) Sign-in screen on every later visit |
| ![Bookmarks, list view](docs/screenshots/02-bookmarks-list.png) Bookmarks — list view, with the folder rail and search/sort toolbar | ![Bookmarks, grid view](docs/screenshots/03-bookmarks-grid.png) Bookmarks — grid view, with favicons |
| ![Settings page](docs/screenshots/04-settings.png) Settings — appearance, session, import/export, and account danger zone | ![Dark theme](docs/screenshots/06-dark-theme.png) The same list view in dark theme |
| ![Account page with profile picture](docs/screenshots/07-account-profile-picture.png) Account — profile picture, username, and password | ![Account menu open](docs/screenshots/08-account-menu.png) The top-bar account menu — account settings and sign out, one click away from anywhere |

## Installation

**Prerequisites:** [Node.js](https://nodejs.org) 18 or later (which includes npm). No external database — everything lives in one SQLite file.

```bash
git clone <this-repo-url> syncmark
cd syncmark
npm install
npm start
```

Open `http://localhost:3000` and follow the on-screen setup — a short two-step wizard: your username and password, then which tabs to turn on (Bookmarks/Contacts/Calendar default on, Files defaults off since it reads/writes the server filesystem — all changeable later in Settings → General → Features). That's the whole install — there's no build step, no separate frontend to compile.

`npm install` builds the `better-sqlite3` native module for your platform. If it prompts about install scripts (`npm warn allow-scripts …`), that's expected the first time on a new machine/OS — approve it with:

```bash
npm approve-scripts better-sqlite3
```

**Linux only — if `npm install` fails while building `better-sqlite3`:** npm normally fetches a prebuilt binary and skips compiling entirely; it only falls back to building from source (via `node-gyp rebuild`) when none matches your exact Node version/architecture, and that build needs a C/C++ toolchain most minimal Linux installs don't have by default. If you see an error like `gyp ERR! stack Error: not found: make`, install the build tools for your distro first, then re-run `npm install`:

```bash
# Debian/Ubuntu
sudo apt-get install -y build-essential python3

# Fedora/RHEL
sudo dnf groupinstall "Development Tools" -y
sudo dnf install -y python3

# Arch
sudo pacman -S base-devel python
```

macOS and Windows aren't usually affected — macOS ships `make`/`clang` with Xcode Command Line Tools (`xcode-select --install` if missing), and Windows almost always has a matching prebuilt binary available.

## Hosting

SyncMark is a single long-running Node process (`node server.js`) plus a SQLite file — host it however you'd host any small Node app. A few ways to keep it running:

### Docker (recommended for a server/NAS)

```bash
docker compose up -d --build
```

This builds from the included `Dockerfile` and runs SyncMark on port 3000, persisting `data/` to the host via a bind mount (see `docker-compose.yml`). To use a different host port, edit the `ports:` line (e.g. `"8080:3000"`). To run without Compose:

```bash
docker build -t syncmark .
docker run -d --name syncmark -p 3000:3000 -v "$(pwd)/data:/app/data" --restart unless-stopped syncmark
```

### pm2 (cross-platform process manager)

```bash
npm install -g pm2
pm2 start server.js --name syncmark
pm2 save
pm2 startup   # prints an OS-specific command to make pm2 itself survive reboots
```

### systemd (Linux)

Create `/etc/systemd/system/syncmark.service`:

```ini
[Unit]
Description=SyncMark
After=network.target

[Service]
Type=simple
User=syncmark
WorkingDirectory=/opt/syncmark
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now syncmark`.

### Windows

Run it in the background with [NSSM](https://nssm.cc/) (`nssm install SyncMark "C:\Program Files\nodejs\node.exe" "C:\path\to\syncmark\server.js"`) or Task Scheduler set to run at startup — or use pm2 above, which works the same way on Windows.

### Putting it behind a reverse proxy (recommended if exposed beyond localhost)

SyncMark itself only speaks plain HTTP. If you're reaching it over the internet (not just your LAN), put a reverse proxy in front for HTTPS — [Caddy](https://caddyserver.com/) is the least fuss:

```
bookmarks.example.com {
    reverse_proxy localhost:3000
}
```

or an nginx server block proxying to `http://127.0.0.1:3000`. Session cookies are `HttpOnly`/`SameSite=Lax` but not marked `Secure`, so they *do* work over plain HTTP on a LAN — HTTPS via a reverse proxy is about protecting your password and session cookie in transit once traffic leaves your network, not a hard requirement to run it at all.

## Updating an existing instance

Updating is: **back up → pull → install → restart**. Your data is never touched by an update — it lives in `data/bookmarks.sqlite3`, which is gitignored and stays put across pulls.

### 1. Back up first (always)

```bash
cp -r data data-backup-$(date +%F)
```

On Windows PowerShell: `Copy-Item data "data-backup-$(Get-Date -f yyyy-MM-dd)" -Recurse`.

This is the one step worth never skipping — it's the whole database, and it's what lets you roll back.

### 2. Pull, install, restart

```bash
git pull
npm install          # picks up any new/changed dependencies
```

Then restart using whichever method you host with:

| Hosting method | Restart command |
| --- | --- |
| Docker Compose | `docker compose up -d --build` |
| Docker (plain) | `docker build -t syncmark . && docker rm -f syncmark && docker run -d --name syncmark -p 3000:3000 -v "$(pwd)/data:/app/data" --restart unless-stopped syncmark` |
| pm2 | `pm2 restart syncmark` |
| systemd | `sudo systemctl restart syncmark` |
| Manual (`npm start`) | Stop with `Ctrl+C`, then `npm start` again |

With Docker Compose the `git pull` + `docker compose up -d --build` pair is all you need — `npm install` happens inside the image build.

### 3. Verify

Load the page and confirm you're still signed in (or can sign in) and your bookmarks are listed. `curl -s localhost:3000/api/auth/status` should return `{"setupRequired":false,...}` — if it unexpectedly says `true`, stop and restore your backup, because that means it's looking at an empty database.

### Database migrations

There's nothing to run by hand. On every start, SyncMark inspects its own schema and applies any missing additive changes itself (new tables via `CREATE TABLE IF NOT EXISTS`, new columns via `ALTER TABLE … ADD COLUMN`). Existing rows keep their data and get sensible defaults for new columns.

The important caveat: **migrations are forward-only** — there are no down-migrations. Once a newer version has started against your database and added columns, rolling the *code* back to an older version isn't guaranteed to work against that upgraded file. That's exactly what the step-1 backup is for:

```bash
# roll back code and data together
git checkout <previous-commit-or-tag>
npm install
rm -rf data && cp -r data-backup-YYYY-MM-DD data
# then restart via your hosting method
```

### Notes on specific changes

- **Browser-stored preferences.** Theme and default view live in each browser's `localStorage`, not the database, so they survive updates but are per-browser and won't follow you to a new device.
- **Browser extensions don't auto-update.** They're loaded unpacked from `extensions/`, so after a `git pull` that touches them, reload the extension (`chrome://extensions` → reload, or re-load the temporary add-on in Firefox). The configured server URL is kept.
- **Hard-refresh after a UI update.** Browsers cache `style.css`/`app.js` aggressively; if the interface looks half-updated or broken after an upgrade, do a hard reload (`Ctrl+Shift+R`, or `Cmd+Shift+R` on macOS) before assuming something is wrong.

## Configuration

Everything is configured through environment variables at the process level, or through the Settings page in the app itself — there's no separate config file.

| Setting | Where | Notes |
| --- | --- | --- |
| Port | `PORT` env var (default `3000`) | e.g. `PORT=8080 npm start` |
| Data location | fixed at `data/bookmarks.sqlite3` | see [Data & backups](#data--backups) below |
| Theme, default view | Settings page | stored in the browser's `localStorage`, per-browser |
| Session length | Settings → Session | `5m` / `hourly` / `monthly` / `permanent`; stored server-side, applies to your *next* sign-in |
| Account (username/password) | Account page (top right) | requires your current password to change |
| Profile picture | Account page (top right) | stored in the database, so it survives updates and follows you to any browser |
| Feature toggles | Settings → General → Features | Bookmarks/Contacts/Calendar on by default, Files off by default — see [Feature toggles](#feature-toggles) below |
| File locations | Settings → Files | name + absolute server path per location — see [File Manager](#file-manager) below |

### Resetting a forgotten password

SyncMark has no email/SMTP integration and no public "forgot password" form by design — that would be an attack surface for an app that otherwise has none. Instead, an operator with shell access to the server (which is the only way anyone should be able to reset it, since SyncMark protects one account for the whole instance) runs:

```bash
npm run reset-password -- yourNewPassword123
```

or, to be prompted instead of putting the password on the command line (and in your shell history):

```bash
npm run reset-password
```

The prompt does **not** mask input, so only run it somewhere private. Either way it updates the account in `data/bookmarks.sqlite3` directly and signs every device out (`DELETE FROM sessions`), which is the sensible default whether you forgot the password or are resetting it because of a suspected compromise. It refuses to do anything if no account exists yet (nothing to reset — run first-run setup instead) or the new password is under 8 characters.

### Feature toggles

Settings → General → Features lets you turn Bookmarks, Contacts, Calendar, and Files on or off independently (at least one must stay on) — also asked up front during the first-run wizard. Turning one off is a **hard** block, not just a hidden tab:

- Its `/api/*` routes start returning `403`.
- Its CardDAV/CalDAV routes (`/dav/addressbooks/...` for Contacts, `/dav/calendars/...` for Calendar) start returning `403` too.
- It stops being *advertised* during CardDAV/CalDAV discovery — a PROPFIND on the principal no longer lists a disabled feature's home-set at all, so a phone/desktop client won't even offer to sync it.

Existing installs that predate a given toggle keep working exactly as before — a never-set flag defaults to *enabled* for Bookmarks/Contacts/Calendar, so nothing already in use is silently turned off by an update. **Files is the one exception**: it defaults to *disabled*, since it never existed before and is the only feature that reads/writes the host filesystem directly rather than just app data — turning it on is meant to be a deliberate choice, not an update side effect.

### Data & backups

All state — bookmarks, folders, your account, and active sessions — lives in one file: `data/bookmarks.sqlite3` (created automatically on first run, WAL mode). Back that up however you'd back up any file — the whole database is portable, and stopping the server first isn't required for WAL-mode SQLite, but is the safest bet for a consistent snapshot. If you're using Docker, back up the bind-mounted `data/` directory on the host instead of anything inside the container.

### Running on a non-default port

```bash
PORT=8080 npm start
```

(PowerShell: `$env:PORT=8080; npm start`. Docker/Compose: change the left-hand side of the `ports:` mapping — the app inside the container always listens on 3000.)

## Importing bookmarks

From your browser's bookmark manager, export your bookmarks:

- **Chrome/Edge**: `chrome://bookmarks` → menu → *Export bookmarks* (HTML), or copy the `Bookmarks` file from your profile directory (JSON)
- **Firefox**: Bookmarks → Manage Bookmarks → Import and Backup → *Export Bookmarks to HTML…*, or *Backup…* for a JSON backup

Then open SyncMark, go to **Settings → Import**, and choose the `.html` or `.json` file. Folder structure from the export is preserved and browsable in the sidebar.

## Browser extensions

Two toolbar extensions live under `extensions/` — a quick popup to search, browse, and add bookmarks without opening a SyncMark tab, plus an optional bookmarks bar pinned under the address bar. Both default to talking to your running SyncMark server over its normal API, but can instead be pointed at a self-hosted [Linkwarden](https://linkwarden.app/) or [Karakeep](https://karakeep.app/) instance (over HTTP or HTTPS) — pick a service in the extension's options page. Neither extension ships any bundled server address, so you point it at your instance's URL on first use.

- **Firefox**: `extensions/firefox_extensions/` — load via `about:debugging` → *Load Temporary Add-on…* (see its own README for details)
- **Chrome / Edge / other Chromium browsers**: `extensions/chromium_extensions/` — load via `chrome://extensions` → *Load unpacked* (see its own README for details)

## Contacts & CardDAV sync

The **Contacts** tab is a second, independent address book alongside your bookmarks — add, edit, delete, favorite, search, and attach a photo to contacts from the web UI, same as bookmarks. What makes it different is that SyncMark also speaks **CardDAV** (the standard contact-sync protocol), so your phone's native Contacts app can sync with it directly, in both directions.

**Setup** — in Settings → Contacts sync, copy the server address (`http://your-server:3000/dav/` or your HTTPS URL if behind a reverse proxy) and add it as a CardDAV account:

- **iOS**: Settings → Contacts → Accounts → Add Account → Other → Add CardDAV Account. Server = the address from Settings, username/password = your regular SyncMark login.
- **Android**: stock Android has had no built-in CardDAV setup since Android 5 — install the free [DAVx5](https://www.davx5.com/) app, add an account with the same address and credentials, then turn on contact sync for it under your phone's Accounts settings.

A contact added, edited, or deleted on your phone syncs back to SyncMark (and to any other synced device) the next time that device syncs; the same applies in reverse for changes made in the SyncMark UI.

**How it works**: CardDAV clients authenticate with the same username/password as the web UI, over HTTP Basic Auth (not the session cookie) — there's no separate sync password to manage. The server implements the minimal subset of RFC 6352 that real clients need: principal/address-book discovery, `GET`/`PUT`/`DELETE` on individual vCards, and `REPORT` (`addressbook-multiget`, `addressbook-query`, and incremental `sync-collection`) on the single address book every account gets (`SyncMark Contacts`).

**Known limitation**: name, organization, title, phone numbers, emails, addresses, a birthday (from Key dates), social profiles, tags, notes, favorite, and photo all round-trip via vCard (`TITLE`, `ADR`, `BDAY`, `X-SOCIALPROFILE`, `CATEGORIES`). Messaging handles, custom fields, non-birthday key dates, and relationships have no vCard equivalent and are SyncMark-only — a vCard property outside the modeled set, from either side, is silently dropped rather than stored, so it won't reappear on a later sync.

**Manual import/export**: Settings → Contacts (and the Contacts page toolbar) lets you import a `.vcf` (vCard) or `.csv` file, or export every contact as either — useful for one-off transfers or backups outside of CardDAV. CSV import accepts SyncMark's own export format (`First Name, Last Name, Organization, Phones, Emails, Notes, Favorite`, with multiple phones/emails packed into one cell as `type:value; type:value`) plus a few common alternate headers from other address books (`Given Name`/`Family Name`, `Company`, a plain `Name` column, etc.); it does not carry the newer fields below (title, tags, addresses, social/messaging, custom fields, key dates, relationships) — those are vCard/JSON-only for now. The Contacts page itself also supports multi-select (checkboxes + "select all") with a bulk-action bar to favorite, unfavorite, export, or delete several contacts at once, and "Export selected" for just the checked ones.

### Fuzzy search, unified cards, tags & groups

- **Fuzzy search** — the search bar matches name, organization, title, phone numbers, emails, and tags all at once, tolerating typos and partial/out-of-order matches (a lightweight, dependency-free subsequence matcher, not a full search engine — plenty for a personal address book).
- **Unified Contact Card** — clicking a contact opens a single read-only view merging every phone, email, address, social profile, messaging handle, key date, custom field, relationship, and note into one place; an **Edit** button from there opens the full editor.
- **Notes are Markdown** — `**bold**`, `*italic*`, `` `code` ``, `[text](url)` (http(s)/mailto links only), and `- ` bullet lists, with a Preview toggle in the editor. Rendered client-side by escaping the text first and only then applying formatting, so there's never a way for a note's content to inject markup.
- **Relationships** link to another real contact in your address book (e.g. "Manager: Jane Doe") rather than a free-text name — click through to jump to theirs, and deleting a linked contact automatically removes the relationship entries that pointed at it elsewhere.
- **Tags** are free-form labels on a contact (autocompleted from tags you've already used) and show as small pills on the row and card.
- **Groups** (sidebar, "Manage groups") are either **manual** — drag a contact from the table onto a group to add it — or **smart**, matching contacts automatically against a small set of AND-ed rules (tag equals, organization/title contains, favorite is, added within N days) — e.g. a "Clients added this month" group is `tag equals Client` + `added within 30 days`.

## Calendar & CalDAV sync

The **Calendar** tab works the same way, for events instead of contacts: a full month-grid view, and a built-in **CalDAV server** so your phone's native Calendar app can sync with it directly.

**Using the grid**: click a date to open that day's events in a panel on the right (the month grid shrinks to make room) — click an event there to edit it, or use the panel's "Add event on this day" button. Right-click a date, an event pill in the grid, or an event in the side panel for a quick context menu (Add, or Edit/Remove) without opening the full editor.

**Setup**: CalDAV uses the **same server address and login as CardDAV** (Settings → Contacts sync shows it) — a combined CalDAV+CardDAV client discovers both from one account.

- **iOS**: Settings → Calendar → Accounts → Add Account → Other → Add CalDAV Account. Same server address and SyncMark username/password as Contacts sync.
- **Android**: the same [DAVx5](https://www.davx5.com/) account used for contacts also handles calendar sync — enable it under your phone's Accounts settings.

**Recurring events**: the event editor supports basic recurrence — daily, weekly, or monthly, with an optional end date — stored and synced as a standard iCalendar `RRULE`. There's one event row per series (no per-occurrence editing or exceptions): editing or deleting a recurring event acts on the whole series, and a recurrence is expanded into the individual days it lands on entirely in the browser (the CalDAV server itself, like the CardDAV one, returns the raw series rather than expanding occurrences server-side).

**Known limitations**: no timezone database — times are stored and synced in UTC (or as a bare date for all-day events), so there's no `VTIMEZONE` support; an iCalendar property outside title/description/location/start/end/recurrence (alarms, attendees, etc.) is silently dropped on sync, same precedent as CardDAV's unmodeled vCard fields; multi-day events are shown as a repeated pill on each day they cover rather than a single spanning bar.

**Manual import/export**: Settings → Calendar lets you import an `.ics` file (one or many events) or export the whole calendar as one.

## File Manager

The **Files** tab is a personal file browser for the server itself — off by default (see [Feature toggles](#feature-toggles)), since it's the one feature that reads and writes the host filesystem directly.

**Setup**: Settings → Files → add a **location** — a name plus an absolute path on the server (e.g. `/srv/media` or `C:\Users\me\Documents`). The path must already exist and be a directory. Add as many as you like; each shows up as its own entry in the Files tab's sidebar.

**Sandboxing**: every location is a hard boundary. Browsing, uploading, downloading, renaming, and deleting can never reach outside the configured path — no `..` traversal, no absolute-path injection, and (best-effort) no escaping through a symlink placed inside the location either. Removing a location in Settings only un-registers it; nothing on disk is touched.

**Using it**: double-click a folder to open it, click a file's Download button (or double-click it) to download, and right-click anything — a file, a folder, or empty space in the list — for a quick Add/Rename/Delete/Download menu. "New folder" and "Upload" (multiple files at once) are in the top bar. Uploads stream straight to disk rather than buffering in memory, and — unlike the 2 MB/25 MB caps on avatars and bookmark/contact/calendar imports elsewhere in the app — there's no file-size limit; disk space is the natural ceiling for a personal file server.

**Known limitations**: no in-browser text/image preview or editing (download to view), no move-between-locations or bulk multi-select yet, and no archive (.zip) download for a whole folder at once.

## API

All `/api/*` routes below except the `/api/auth/*` ones require a valid session cookie (401 otherwise). Static files (the HTML/CSS/JS themselves) are always public — they're what render the sign-in screen. The CardDAV server at `/dav/` (and the `/.well-known/carddav` redirect to it) is separate from `/api` and uses HTTP Basic Auth instead of the session cookie — see [Contacts & CardDAV sync](#contacts--carddav-sync).

| Method | Path                  | Description                                       |
| ------ | --------------------- | -------------------------------------------------- |
| GET    | `/api/auth/status`    | `{ setupRequired, authenticated }`                   |
| POST   | `/api/auth/setup`     | First-run only: create the account (`{ username, password, features? }`), signs you in — `features` defaults every key not given |
| POST   | `/api/auth/login`     | `{ username, password }`                             |
| POST   | `/api/auth/logout`    | Clear the current session                            |
| GET/PUT | `/api/auth/settings` | Get/set the session-duration preference (`{ sessionDuration: "5m"\|"hourly"\|"monthly"\|"permanent" }`) — requires auth |
| GET    | `/api/auth/me`        | `{ username }` for the signed-in account              |
| PUT    | `/api/auth/account`   | Change username and/or password (`{ currentPassword, username?, newPassword? }`) |
| DELETE | `/api/auth/account`   | Delete the account and wipe all data (`{ password }`) — cannot be undone |
| GET    | `/api/auth/avatar`    | The profile picture's raw bytes (404 if none set)     |
| POST   | `/api/auth/avatar`    | Upload a profile picture (multipart, field `avatar`; PNG/JPEG/GIF/WebP, ≤ 2 MB) |
| DELETE | `/api/auth/avatar`    | Remove the profile picture                            |
| POST   | `/api/import`         | Upload a bookmark export file                       |
| GET    | `/api/bookmarks`      | List bookmarks (`?q=` search, `?folder=` filter includes subfolders, `&exact=1` for that folder only, `&favorite=1` favorites only, `&sort=title-asc\|title-desc\|created-asc\|created-desc\|custom`) |
| POST   | `/api/bookmarks`      | Add a bookmark manually (title, url, folder)         |
| GET    | `/api/bookmarks/:id`  | Get a single bookmark                                |
| PUT    | `/api/bookmarks/:id`  | Update title/url/folder/favorite                     |
| PUT    | `/api/bookmarks/:id/favorite` | Set favorite status (`{ favorite: true\|false }`) |
| PUT    | `/api/bookmarks/:id/reorder` | Set custom-order position between neighbors (`{ beforeId, afterId }`) |
| DELETE | `/api/bookmarks/:id`  | Remove a bookmark                                    |
| DELETE | `/api/bookmarks/all`  | Remove every bookmark                                |
| GET    | `/api/export`         | Download all bookmarks (`?format=html\|json`)         |
| GET    | `/api/folders`        | List all folders (including empty ones) with bookmark counts |
| POST   | `/api/folders`        | Create an (optionally empty) folder                  |
| PUT    | `/api/folders`        | Rename a folder (`{ oldName, newName }`), cascades to subfolders |
| DELETE | `/api/folders`        | Delete a folder (`{ name }`); its bookmarks become unfiled |
| PUT    | `/api/folders/reorder`| Set a folder's sidebar position between siblings (`{ name, beforeName, afterName }`) |
| GET    | `/api/stats`          | Total bookmark, folder, contact, and event counts     |
| GET    | `/api/contacts`       | List contacts — with `?q=`, fuzzy-ranked over name/org/title/phone/email/tags; without it, `?sort=name-asc\|name-desc\|created-asc\|created-desc`; `?favorite=1` and `?tag=<name>` filter either way |
| GET    | `/api/contacts/tags`  | Distinct tags across all contacts, for the tag input's autocomplete |
| POST   | `/api/contacts`       | Add a contact (`firstName`, `lastName`, `organization`, `phones[]`, `emails[]`, `notes`, `favorite`) |
| GET    | `/api/contacts/export` | Download every contact (or `?ids=1,2,3` for a selection) as one `.vcf` file, or `.csv` with `?format=csv` |
| POST   | `/api/contacts/import` | Upload a `.vcf` or `.csv` file (multipart, field `file`) — format is sniffed from the filename/content, one or many contacts |
| POST   | `/api/contacts/bulk`  | Bulk action on selected contacts (`{ ids: number[], action: "delete"\|"favorite"\|"unfavorite" }`) |
| GET    | `/api/contacts/:id`   | Get a single contact                                 |
| PUT    | `/api/contacts/:id`   | Update a contact                                     |
| DELETE | `/api/contacts/:id`   | Remove a contact                                     |
| DELETE | `/api/contacts/all`   | Remove every contact                                 |
| PUT    | `/api/contacts/:id/favorite` | Set favorite status (`{ favorite: true\|false }`) |
| GET    | `/api/contacts/:id/photo` | The contact's photo bytes (404 if none set)      |
| POST   | `/api/contacts/:id/photo` | Upload a contact photo (multipart, field `photo`; PNG/JPEG/GIF/WebP, ≤ 2 MB) |
| DELETE | `/api/contacts/:id/photo` | Remove a contact's photo                         |
| GET    | `/api/contact-groups` | List groups (`{ id, name, type: "manual"\|"smart", smart_rules, position }[]`) |
| POST   | `/api/contact-groups` | Add a group (`{ name, type, smartRules? }`) — `smartRules` is `[{ field, operator, value }]`, AND-ed |
| PUT    | `/api/contact-groups/:id` | Rename, or update a smart group's rules (a group's `type` can't change after creation) |
| PUT    | `/api/contact-groups/reorder` | Reorder the sidebar (`{ id, beforeId?, afterId? }`) |
| DELETE | `/api/contact-groups/:id` | Delete a group (members/rules only — contacts are untouched) |
| POST/DELETE | `/api/contact-groups/:id/members/:contactId` | Add/remove a contact from a **manual** group |
| GET    | `/api/contact-groups/:id/contacts` | Resolve a group's members — manual membership, or every contact matching a smart group's rules |
| GET    | `/api/events`         | List events (`?q=` search over title/location/description) — recurrence is returned as a raw `RRULE`, not expanded |
| POST   | `/api/events`         | Add an event (`title`, `description`, `location`, `startAt`, `endAt`, `allDay`, `recurrence: { freq: "daily"\|"weekly"\|"monthly", until }`) |
| GET    | `/api/events/export`  | Download every event as one `.ics` file              |
| POST   | `/api/events/import`  | Upload an `.ics` file (multipart, field `file`) — one or many events |
| GET    | `/api/events/:id`     | Get a single event                                   |
| PUT    | `/api/events/:id`     | Update an event (editing a recurring event updates the whole series) |
| DELETE | `/api/events/:id`     | Remove an event (deletes the whole series if recurring) |
| DELETE | `/api/events/all`     | Remove every event                                   |
| GET    | `/api/features`       | `{ bookmarks, contacts, calendar, files }` — never itself feature-gated |
| PUT    | `/api/features`       | Update flags (`{ bookmarks?, contacts?, calendar?, files? }`) — 400 if all four would end up off |
| GET    | `/api/files/locations` | List configured file locations (`{ id, name, path }[]`) |
| POST   | `/api/files/locations` | Add a location (`{ name, path }`) — `path` must be an absolute, existing directory |
| PUT    | `/api/files/locations/:id` | Update a location's name/path                    |
| DELETE | `/api/files/locations/:id` | Un-register a location — never touches anything on disk |
| GET    | `/api/files/browse`   | List a folder's contents (`?location=<id>&path=<relative>`) — `[{ name, type: "dir"\|"file", size, modifiedAt }]` |
| GET    | `/api/files/download` | Download a file (`?location=&path=`), streamed          |
| POST   | `/api/files/upload`   | Upload one or more files (`?location=&path=`, multipart field `files`) — 409 if a name collides unless `&overwrite=1` |
| POST   | `/api/files/mkdir`    | Create a folder (`{ location, path, name }`)             |
| PUT    | `/api/files/rename`   | Rename a file or folder in place (`{ location, path, newName }`) |
| DELETE | `/api/files/item`     | Delete a file, or a folder and everything in it (`?location=&path=`) |

Favicons are rendered client-side via Google's public favicon service (`s2/favicons`), based on each bookmark's domain — no favicon data is stored server-side. Theme and default view preferences are stored in the browser's `localStorage`.
