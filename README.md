# SyncMark

A self-hosted bookmark manager. Import bookmark exports from your browser, or from Pocket, Instapaper, Readwise Reader, Omnivore, Matter, Linkwarden, mymind, Karakeep, Tab Session Manager, or OneTab, into a local server, then browse, search, edit, and delete them from a web UI — protected by a username/password you set up on first run.

![Bookmarks — list view](docs/screenshots/02-bookmarks-list.png)

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
  - [Linux — step by step](#linux--step-by-step)
  - [Other platforms](#other-platforms)
- [Hosting](#hosting)
- [Updating an existing instance](#updating-an-existing-instance)
- [Configuration](#configuration)
- [Importing bookmarks](#importing-bookmarks)
  - [Exporting bookmarks](#exporting-bookmarks)
- [Browser extensions](#browser-extensions)
- [Contacts & CardDAV sync](#contacts--carddav-sync)
- [Calendar & CalDAV sync](#calendar--caldav-sync)
- [File Manager](#file-manager)
- [Mobile use](#mobile-use)
- [Backup & restore](#backup--restore)
- [API](#api)
- [AI usage disclaimer](#ai-usage-disclaimer)

## Features

- Material Design 3 interface in the Google Photos idiom: tonal surfaces, pill-shaped nav and buttons, a prominent rounded search bar in the app bar, Material Symbols icons, elevation instead of borders, and Roboto throughout — plus deliberately-paced animated transitions between pages (via the CSS View Transitions API where supported, with an equivalent hand-rolled fade for browsers without it, e.g. Firefox)
- Light and dark themes, both built on the same Material tonal palette (light by default; switch in Settings → Appearance)
- A subtle, slow-drifting animated gradient behind the app (off automatically for anyone with reduced-motion preferences set) — only ever shown once you're signed in, never behind the sign-in/register screen
- **A dedicated sign-in/register page on first run**: the first person to open SyncMark lands on a clean, standalone welcome page — a two-step wizard (username/password, then which of Bookmarks/Contacts/Calendar to turn on) rather than a dialog over a half-loaded app; after that, every visit opens a plain sign-in page before anything else loads. No email/SMTP involved anywhere — see [Resetting a forgotten password](#resetting-a-forgotten-password) for the CLI-based recovery path instead
- **Feature toggles** (Settings → General, also set during first-run): turn Bookmarks/Contacts/Calendar/Files on or off — disabling one hard-blocks its API and CardDAV/CalDAV routes, not just its nav tab — see [Feature toggles](#feature-toggles)
- Click the "SyncMark" title in the top left from anywhere to jump back to your bookmarks
- Configurable session length (Settings → Session): stay signed in for 5 minutes, 1 hour, 30 days, or permanently (never asked again) — applies the next time you sign in
- Account menu (top right, click your name): jump straight to Settings → Account, or sign out, from anywhere in one click
- **Settings → Account**: set a custom profile picture (PNG/JPEG/GIF/WebP, up to 2 MB — stored in the database and shown in the top bar on every page), and change your username or password, each re-confirmed with your current password — lives alongside every other Settings tab rather than a separate page
- A top progress bar on every action — API calls and page navigations alike — so nothing ever feels like it silently hung
- Delete account (Settings → Danger zone): password-confirmed, permanently wipes the account *and* every bookmark/folder/setting, then returns to the first-run setup screen
- Import bookmark/read-it-later exports from a browser (Chrome, Firefox, Edge, Safari — HTML or JSON), Pocket, Instapaper, Readwise Reader, Omnivore, Tab Session Manager, OneTab, Matter, Linkwarden, mymind, or Karakeep — format is auto-detected from content, see [Importing bookmarks](#importing-bookmarks)
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
- **Duplicate contact detection**: finds probable duplicate contacts by matching name, email, or phone number, and merges them in one click — see [Fuzzy search, unified cards, tags & groups](#fuzzy-search-unified-cards-tags--groups)
- **Calendar tab** with a full month-grid view, basic recurring events (daily/weekly/monthly, with an optional end date), and a built-in **CalDAV server** so events sync with your phone's native calendar app — the same server address and login as Contacts sync — see [Calendar & CalDAV sync](#calendar--caldav-sync)
- Calendar: click a date to open that day's events in a side panel (the month grid shrinks to make room); right-click a date or an event for a quick Add/Edit/Remove menu; import/export `.ics` (iCalendar) files
- Settings → **How to use SyncMark**: an in-app quick tour plus step-by-step CardDAV/CalDAV sync setup for iOS, Android, Linux, and Windows
- **File Manager tab** (off by default — turn it on in Settings → General) — browse, upload, download, view images/video, edit text files, rename, change permissions, and trash (with restore) files under one or more admin-configured, strictly sandboxed server folders ("locations") — see [File Manager](#file-manager)
- **Mobile-responsive UI**: the whole app is usable on a phone, not just squeezed to fit — a slide-in drawer for folders/groups/locations, tables become tap-friendly cards, dialogs go full-screen, and long-press stands in for right-click — see [Mobile use](#mobile-use)
- **Automated backups**: scheduled (daily/weekly) or on-demand snapshots — including actual File Manager file contents, not just their paths — with retention, per-module selection for both backup and restore, and one-click, password-confirmed restore — see [Backup & restore](#backup--restore)
- **Tabbed Settings**: Account / General / Bookmarks / Files / Contacts / Calendar / Backup, each with only the controls relevant to it instead of one long scrolling page, plus a search box that filters settings by keyword across every tab at once

## Screenshots

| | |
|---|---|
| ![First-run welcome / account setup](docs/screenshots/01-welcome-setup.png) First-run welcome screen — creates the one account that protects this instance | ![Sign in](docs/screenshots/05-sign-in.png) Sign-in screen on every later visit |
| ![Bookmarks, list view](docs/screenshots/02-bookmarks-list.png) Bookmarks — list view, with the folder rail and search/sort toolbar | ![Bookmarks, grid view](docs/screenshots/03-bookmarks-grid.png) Bookmarks — grid view, with favicons |
| ![Settings page](docs/screenshots/04-settings.png) Settings — appearance, session, import/export, and account danger zone | ![Dark theme](docs/screenshots/06-dark-theme.png) The same list view in dark theme |
| ![Account page with profile picture](docs/screenshots/07-account-profile-picture.png) Account — profile picture, username, and password | ![Account menu open](docs/screenshots/08-account-menu.png) The top-bar account menu — account settings and sign out, one click away from anywhere |

## Installation

**Prerequisites:** [Node.js](https://nodejs.org) 18 or later (which includes npm). No external database — everything lives in one SQLite file. There's no build step and no separate frontend to compile — `npm install` followed by `npm start` is the whole install, on every platform.

### Linux — step by step

This is the fullest walkthrough because Linux is the one platform where a few things (which Node you get, whether a C/C++ toolchain exists) vary by distro and aren't handled for you. macOS and Windows users can skip to [Other platforms](#other-platforms) below.

**1. Install Node.js via nvm, not your distro's package manager.**
Debian/Ubuntu's `apt` repo, for example, ships Node 20 bundled with **npm 9.2.0** — over two years old, and the version most likely to hit the `npm audit fix` bug described in step 6. [nvm](https://github.com/nvm-sh/nvm) sidesteps this entirely and works the same way on every distro:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install --lts
node -v && npm -v   # sanity check — should print v18+ and a current npm
```

**2. Install git, if it isn't already there:**

```bash
# Debian/Ubuntu
sudo apt-get update && sudo apt-get install -y git

# Fedora/RHEL
sudo dnf install -y git

# Arch
sudo pacman -S git
```

**3. Install a C/C++ build toolchain.**
SyncMark's only native dependency, `better-sqlite3`, normally installs a prebuilt binary with no compiling at all — but if none matches your exact Node version/CPU architecture, `npm install` falls back to building it from source, and that needs `make`, a compiler, and Python, which most minimal/server Linux installs don't have out of the box. Installing this *before* step 5 avoids hitting a `gyp ERR! stack Error: not found: make` failure partway through:

```bash
# Debian/Ubuntu
sudo apt-get install -y build-essential python3

# Fedora/RHEL
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y make gcc-c++ python3

# Arch
sudo pacman -S base-devel python
```

**4. Clone the repository:**

```bash
git clone <this-repo-url> syncmark
cd syncmark
```

**5. Install dependencies:**

```bash
npm install
```

If this prompts about install scripts (`npm warn allow-scripts …`), that's expected the first time on a new machine — approve it with `npm approve-scripts better-sqlite3`.

**6. Ignore the "N vulnerabilities... run `npm audit fix`" nudge npm prints.**
It's flagging a `qs` vulnerability nested three levels down (`qs` ← `body-parser` ← `express`), and there's no non-breaking fix for it yet — only a major-version bump of Express that npm can't apply automatically. Running `npm audit fix` against a transitive vulnerability like that is a [documented source of npm bugs](https://github.com/npm/cli/issues/6356) — it can loop, alternate between package versions on repeat runs, or "fix" it and then immediately report the same vulnerability again. There's nothing to act on: just don't run `npm audit fix`, and it'll resolve itself once Express ships a release with a patched `qs`.

**7. Start the server:**

```bash
npm start
```

You should see `SyncMark running at http://localhost:3000`.

**8. Open it and finish setup.**
On the same machine, visit `http://localhost:3000`. Follow the on-screen two-step wizard: your username and password, then which tabs to turn on (Bookmarks/Contacts/Calendar default on, Files defaults off since it reads/writes the server filesystem — all changeable later in Settings → General → Features).

**9. (Optional) Reach it from your phone or another device on the same network.**
Find the server's LAN IP (`ip addr show` or `hostname -I`), then open port 3000 to your LAN if a firewall is active:

```bash
# ufw (Ubuntu default, if enabled)
sudo ufw allow 3000/tcp

# firewalld (Fedora/RHEL default)
sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload
```

Then visit `http://<that-ip>:3000` from your phone or laptop — the whole web UI, including the mobile-optimized layout, works the same way over LAN as it does on localhost.

**10. (Optional but recommended) Keep it running after you log out or reboot.**
`npm start` only runs while that terminal session is open. For anything beyond quick testing, run it as a systemd service instead — see [systemd (Linux)](#systemd-linux) under Hosting below for the exact unit file, or use [pm2](#pm2-cross-platform-process-manager) if you'd rather not touch systemd.

### Other platforms

**macOS**: ships `make`/`clang` via Xcode Command Line Tools (`xcode-select --install` if `npm install` ever asks for them), so step 3 above is rarely needed. Otherwise the same `git clone` → `npm install` → `npm start` applies, and [nvm](https://github.com/nvm-sh/nvm) is still the recommended way to get Node over Homebrew or the installer from nodejs.org, for the same "keep npm current" reason as Linux.

**Windows**: almost always has a matching prebuilt `better-sqlite3` binary, so there's no build-tools step at all. Install Node from [nodejs.org](https://nodejs.org) (or `nvm-windows`), then the same three commands:

```powershell
git clone <this-repo-url> syncmark
cd syncmark
npm install
npm start
```

Open `http://localhost:3000` and follow the same first-run setup as above.

## Hosting

SyncMark is a single long-running Node process (`node server.js`) plus a SQLite file — host it however you'd host any small Node app. Whichever method you pick below (other than Docker), the same [Installation](#installation) advice applies to the host too: install Node from [nodejs.org](https://nodejs.org) or nvm rather than the OS package manager if you can, especially on Debian/Ubuntu. A few ways to keep it running:

### Docker (recommended for a server/NAS)

The Docker path sidesteps the npm-version issue above entirely — the `Dockerfile` builds on the official `node:20-bookworm-slim` image, which bundles Node's own current npm rather than Debian's `apt` one.

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

### Reinstalling via a fresh `git clone` (keeping your data)

`git pull` in place (above) is the normal path — use a fresh clone only if you're moving to a new machine, or want a clean checkout instead of an existing one. Either way, the only thing that has to survive is the `data/` folder; everything else comes from the new clone:

```bash
# 1. Back up first, same as any update
cp -r data data-backup-$(date +%F)

# 2. Clone the new copy somewhere else (don't overwrite the old checkout yet)
git clone https://github.com/<you>/SyncMark.git syncmark-new
cd syncmark-new
npm install

# 3. Carry your data over — the new clone's own data/ is empty
cp -r ../SyncMark/data ./data

# 4. Start the new copy, verify it (see "Verify" above), then point your
#    hosting method (systemd/pm2/Docker volume/reverse proxy) at the new
#    directory and retire the old one
npm start
```

On Windows PowerShell, swap step 1 and 3's `cp -r` for `Copy-Item -Recurse`. With Docker, there's nothing to copy at all — the bind-mounted `data/` directory on the host is already independent of the image, so re-running `docker compose up -d --build` (or pulling a new image) against the same volume is the fresh-clone equivalent.

The one thing to get right: never `git clone` (or `git checkout`/`git clean`) *over* an existing install's own `data/` folder — a clean clone starts with no `data/` directory at all, and cloning into the same path SyncMark is already running from would require moving `data/` out of the way first. Cloning into a new, separate directory and copying `data/` in, as above, avoids that risk entirely.

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
| Account (username/password) | Settings → Account | requires your current password to change |
| Profile picture | Settings → Account | stored in the database, so it survives updates and follows you to any browser |
| Feature toggles | Settings → General → Features | Bookmarks/Contacts/Calendar on by default, Files off by default — see [Feature toggles](#feature-toggles) below |
| File locations | Settings → Files | name + absolute server path per location — see [File Manager](#file-manager) below |
| Backup schedule | Settings → Backup | off by default; frequency, retention count, and an optional custom directory — see [Backup & restore](#backup--restore) below |

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

Settings → Bookmarks → **Import bookmarks** accepts a single file and figures out the format from its content — not the file extension or an explicit selector — so you just export from wherever your bookmarks currently live and upload whatever file (or the CSV/HTML file inside a `.zip`, if the service exports a zip — extract it first, SyncMark doesn't unzip archives) it gives you. Supported sources:

| Source | Export it as | Notes |
| --- | --- | --- |
| Chrome / Edge | HTML (`chrome://bookmarks` → menu → *Export bookmarks*) or the raw `Bookmarks` file (JSON) | Netscape Bookmark File Format / Chrome's own JSON tree |
| Firefox | HTML or JSON (Bookmarks → Manage Bookmarks → Import and Backup) | Netscape format / Firefox's `text/x-moz-place` JSON backup |
| Safari | HTML (File → Export Bookmarks) | Netscape format |
| **Pocket** | HTML (`ril_export.html`) or CSV | Read/unread status comes from the Unread/Read Archive heading (HTML) or the `status` column (CSV) and becomes the folder |
| **Instapaper** | HTML or CSV (Settings → export) | Folder column/heading preserved |
| **Readwise Reader** | CSV ("Export Library as CSV" or the Command Palette's "Generate CSV export") | `Folder` column (Unread/Archive) preserved |
| **Omnivore** | JSON (`metadata_*.json`) | Labels become the folder |
| **Tab Session Manager** | JSON (session export) | Each session becomes a folder, tabs within its windows become bookmarks |
| **OneTab** | plain text (default) or the JSON export some third-party scripts produce | Blank-line-separated tab groups become folders |
| **Matter** | CSV or JSON | Best-effort — Matter's export isn't rigidly specified, so the URL/title/tag columns are matched leniently |
| **Linkwarden** | full backup JSON | Collection hierarchy (including nested collections) is rebuilt as a folder path |
| **mymind** | `cards.csv` (Account → *Export my mind*) | Best-effort lenient CSV matching, same as Matter |
| **Karakeep** (formerly Hoarder) | JSON export | Tags become the folder |
| Anything else | HTML, JSON, or a CSV with a `url`/`link` column | Falls back to generic parsing — a flat `{title, url}[]` JSON array or a lenient CSV import both work |

Folder structure (or the closest equivalent — labels, tags, or a status/category column) is preserved and browsable in the sidebar after import. Whatever format you imported from, [exporting](#exporting-bookmarks) back out always produces the same standard HTML or JSON regardless of where the bookmarks originally came from — the source format only matters at import time.

### Exporting bookmarks

Settings → Bookmarks → **Export bookmarks** downloads everything currently in SyncMark as either a browser-importable Netscape HTML file or a JSON array (`GET /api/export?format=html` / `?format=json`) — the same two formats regardless of which of the sources above the bookmarks were originally imported from, since importing always normalizes into the same `{title, url, folder}` shape first.

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

**Manual import/export**: Settings → Contacts (and the Contacts page toolbar) lets you import a `.vcf` (vCard) or `.csv` file, or export every contact as either — useful for one-off transfers or backups outside of CardDAV. The CSV export is a plain, Excel/Google-Sheets-openable spreadsheet (with a UTF-8 BOM so accented names render correctly when opened in Excel, rather than a real binary `.xlsx` — there's no spreadsheet-format dependency in the project, and every spreadsheet app opens CSV natively). CSV import accepts SyncMark's own export format (`First Name, Last Name, Organization, Phones, Emails, Notes, Favorite`, with multiple phones/emails packed into one cell as `type:value; type:value`) plus a few common alternate headers from other address books (`Given Name`/`Family Name`, `Company`, a plain `Name` column, etc.); it does not carry the newer fields below (title, tags, addresses, social/messaging, custom fields, key dates, relationships) — those are vCard/JSON-only for now. The Contacts page itself also supports multi-select (checkboxes + "select all") with a bulk-action bar to favorite, unfavorite, export, or delete several contacts at once, and "Export selected" for just the checked ones.

### Fuzzy search, unified cards, tags & groups

- **Fuzzy search** — the search bar matches name, organization, title, phone numbers, emails, and tags all at once, tolerating typos and partial/out-of-order matches (a lightweight, dependency-free subsequence matcher, not a full search engine — plenty for a personal address book).
- **Unified Contact Card** — clicking a contact opens a single read-only view merging every phone, email, address, social profile, messaging handle, key date, custom field, relationship, and note into one place; an **Edit** button from there opens the full editor.
- **Notes are Markdown** — `**bold**`, `*italic*`, `` `code` ``, `[text](url)` (http(s)/mailto links only), and `- ` bullet lists, with a Preview toggle in the editor. Rendered client-side by escaping the text first and only then applying formatting, so there's never a way for a note's content to inject markup.
- **Relationships** link to another real contact in your address book (e.g. "Manager: Jane Doe") rather than a free-text name — click through to jump to theirs, and deleting a linked contact automatically removes the relationship entries that pointed at it elsewhere.
- **Tags** are free-form labels on a contact (autocompleted from tags you've already used) and show as small pills on the row and card.
- **Groups** (sidebar, "Manage groups") are either **manual** — drag a contact from the table onto a group to add it — or **smart**, matching contacts automatically against a small set of AND-ed rules (tag equals, organization/title contains, favorite is, added within N days) — e.g. a "Clients added this month" group is `tag equals Client` + `added within 30 days`.
- **Duplicate detection** — the toolbar's "Find duplicates" button groups contacts that share a normalized email, phone number, or exact full name. For each group, pick which contact to keep (defaults to whichever has the most fields filled in), choose which of the others to fold in, and merge: every phone/email/address/social profile/messaging handle/tag/custom field/key date is unioned onto the survivor, relationships and group memberships that pointed at a merged-away contact are repointed rather than dropped, and the merged-away contacts are deleted. A group can also be dismissed as "not duplicates," which is remembered so it won't keep resurfacing.

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

**Setup**: Settings → Files → add a **location** — a name plus an absolute path on the server (e.g. `/srv/media` or `C:\Users\me\Documents`). The path must already exist and be a directory; either type it in directly, or click **Browse…** to navigate the server's filesystem (starting from the drive list on Windows, or `/` elsewhere) and pick a folder without needing to know its exact path. Add as many as you like; each shows up as its own entry in the Files tab's sidebar.

**Sandboxing**: every location is a hard boundary. Browsing, uploading, downloading, renaming, and deleting can never reach outside the configured path — no `..` traversal, no absolute-path injection, and (best-effort) no escaping through a symlink placed inside the location either. Removing a location in Settings only un-registers it; nothing on disk is touched.

**Using it**: double-click a folder to open it, or a file to view/edit it in the browser where possible (see below) — otherwise it downloads. Click a file's Download button to always get the raw file regardless of type. Right-click anything — a file, a folder, or empty space in the list — for a quick menu: Download, View (images/video), Edit (text files), Rename, Permissions, and Move to trash. "New folder" and "Upload" (multiple files at once) are in the top bar. Uploads stream straight to disk rather than buffering in memory, and — unlike the 2 MB/25 MB caps on avatars and bookmark/contact/calendar imports elsewhere in the app — there's no file-size limit; disk space is the natural ceiling for a personal file server.

**Viewing images and video**: PNG/JPEG/GIF/WebP images and MP4/WebM/Ogg/MOV video play inline in a preview dialog rather than downloading — served with the same strict-MIME-allowlist, `nosniff`, locked-down-CSP recipe the contact-photo endpoint already uses, so an unrecognized extension is refused (415) rather than guessed at.

**Editing text files**: common text/code extensions (`.txt .md .json .csv .log .yml .ini .conf .env .xml .css .js .ts .html .py .java .c .cpp .sh` and a few more) open in an in-browser editor — full-file overwrite on Save, capped at 5 MB (a file larger than that isn't realistically editable in a browser `<textarea>` anyway). Closing with unsaved changes asks for confirmation first.

**Permissions**: right-click → Permissions shows an owner/group/other × read/write/execute grid on Linux/macOS, or a single "Read-only" toggle on Windows (Node's `chmod` only meaningfully controls that one bit there). Applies to the item itself only, not recursively to a folder's contents.

**Trash**: deleting now moves an item to a hidden `.trash` folder inside its location rather than deleting it immediately. Each location shows its own **Trash** as a nested entry right under it in the sidebar — clicking it browses into that location's trash the same way you'd browse into any folder, with the breadcrumb showing "Location / Trash". Each row offers Restore (back to its exact original path, recreating parent folders if needed) or Delete permanently, and an "Empty trash" button appears in the toolbar while you're in that view. Nothing is purged automatically — items stay until you clear them yourself. A location's `.trash` folder itself never shows up in normal browsing, and `.trash` is a reserved name at a location's root (an upload/folder/rename using it there is rejected) so it can never be shadowed by something else.

**Known limitations**: no move-between-locations or bulk multi-select yet, no archive (.zip) download for a whole folder at once, permission changes aren't recursive, and trash has no automatic purge/expiry.

## Mobile use

Every page works on a phone browser, not just a shrunk-down desktop layout:

- **Collapsible navigation**: the top nav (Bookmarks/Contacts/Calendar/Files/Settings) collapses into a hamburger menu on narrow screens instead of wrapping awkwardly.
- **Slide-in drawer**: on Bookmarks, Contacts, and Files — the three pages with a sidebar (folders, groups, and locations respectively) — the sidebar becomes an off-canvas drawer opened by a menu button, with a tap-outside-to-close backdrop, rather than pushing the page content down.
- **Tables become cards**: the Bookmarks, Contacts, and Files tables restack into a card per row on phone-width screens instead of squeezing a multi-column table.
- **Full-screen dialogs**: every modal (adding/editing a contact, an event, a bookmark, and so on) takes over the full screen on a phone instead of rendering as a cramped centered box.
- **Calendar**: the month grid stays a grid rather than switching to a list, with events shown as a small dot per day; tapping a day opens its event list as a full-screen sheet.
- **Touch targets and gestures**: icon buttons meet the 44px minimum touch-target size on mobile, and long-pressing a calendar day/event or a file/folder brings up the same quick-action menu that right-clicking shows on desktop.
- Reordering bookmarks and folders by dragging is desktop-only for now — sorting by title/date, and the Folder field in the edit dialog, cover the same ground on a phone.

There's no installable app or offline support (no PWA manifest/service worker) — it's a responsive website you reach through your phone's regular browser, over the same address as any other device on your network.

## Backup & restore

Settings → Backup covers both scheduled and one-off backups of the whole instance, split into five independent **modules** — Bookmarks, Contacts (with groups), Calendar, Files, and Account & settings — each of which can be included or left out separately, for both backing up and restoring.

**What a backup contains**: a gzip-compressed `.tar.gz` archive — `db.json` (the selected modules' database rows) plus, when the Files module is included, the actual file contents of every configured File Manager location, not just their registered paths. Active sessions are never included (restoring the Account module signs every device out on purpose — see below). It's a real, standard tar archive: openable with any ordinary tool, not just SyncMark itself.

**Choosing what to back up**: the checkbox row under "What to back up" applies to both scheduled backups and "Back up now." Leaving Files selected means backup size and time scale with however much you keep in File Manager locations — worth knowing before pointing a location at something huge.

**Automatic backups** (off by default): turn on "Back up automatically," choose daily or weekly, and how many backups to keep (oldest are pruned once you're over the count). By default backups are written to `data/backups/` on the server, but you can point the directory field at anywhere else the server can write to — including a folder synced by rclone, Dropbox, OneDrive, or similar, if you want an actual off-machine copy. SyncMark itself has no cloud-provider integration; pointing it at a synced folder is what gets a copy off the machine.

**Manual backups**: "Back up now" creates one immediately with the current module selection, independent of the schedule.

**Restoring**: each entry in the restore-points list shows which modules it contains, and can be downloaded, deleted, or restored. The restore dialog lets you pick which of *those* modules to actually apply — restoring just Bookmarks from a backup leaves your current Contacts/Calendar/Files/Account completely untouched. Database modules (Bookmarks/Contacts/Calendar/Account) fully replace their current data when applied — that part is as destructive as it sounds, so it's password-confirmed like deleting the account. **Files is the one exception**: restoring it only adds and overwrites files from the backup — anything present in a location that isn't in the backup is left alone, never deleted, since real files on disk aren't as trivially recoverable as a database row is. Every device is signed out only if the Account module was applied, since that's the only module that can change who's logged in. Restoring runs live, through the server's existing database connection; there's no need to stop or restart the server.

**Older backups keep working**: a `.json.gz` backup made before this module system existed (database-only, no file contents) still lists, downloads, and restores correctly — it's just treated as containing every module.

**Note on CardDAV/CalDAV sync after a restore**: restoring an older Contacts or Calendar backup can move that data backward relative to what a phone or desktop client last synced. If a synced device looks out of step afterward, removing and re-adding its CardDAV/CalDAV account forces a full resync.

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
| GET    | `/api/contacts/duplicates` | Grouped probable-duplicate contacts (matching name/email/phone), dismissed pairs excluded |
| POST   | `/api/contacts/merge` | Merge contacts (`{ primaryId, mergeIds: number[] }`) — unions fields onto `primaryId`, repoints relationships/group membership, deletes the rest |
| POST   | `/api/contacts/duplicates/dismiss` | Mark a set of contacts as "not duplicates" (`{ ids: number[] }`), remembered per pair |
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
| GET    | `/api/files/browse-server` | List directories at an arbitrary server path (`?path=`, omit for the drive list on Windows or `/` elsewhere) — for picking a location's path, not sandboxed to a location |
| GET    | `/api/files/browse`   | List a folder's contents (`?location=<id>&path=<relative>`) — `[{ name, type: "dir"\|"file", size, modifiedAt }]` |
| GET    | `/api/files/download` | Download a file (`?location=&path=`), streamed          |
| GET    | `/api/files/view`     | View an image/video inline (`?location=&path=`) — 415 if the extension isn't on the allowlist |
| GET    | `/api/files/text`     | Read a text file's content (`?location=&path=`) — `{ content }`, 413 if over 5 MB |
| PUT    | `/api/files/text`     | Save a text file — raw `text/plain` body (`?location=&path=`), full overwrite, 413 if over 5 MB |
| GET    | `/api/files/permissions` | Read a file/folder's mode (`?location=&path=`) — `{ mode, platform: "win32"\|"posix", isDirectory }` |
| PUT    | `/api/files/permissions` | Set a file/folder's mode (`{ location, path, mode }`, 0–0o777) — not recursive for folders |
| POST   | `/api/files/upload`   | Upload one or more files (`?location=&path=`, multipart field `files`) — 409 if a name collides unless `&overwrite=1` |
| POST   | `/api/files/mkdir`    | Create a folder (`{ location, path, name }`)             |
| PUT    | `/api/files/rename`   | Rename a file or folder in place (`{ location, path, newName }`) |
| DELETE | `/api/files/item`     | Move a file or folder to that location's trash (`?location=&path=`) — no longer a permanent delete |
| GET    | `/api/files/trash`    | List a location's trash (`?location=`) — `[{ id, name, originalRelPath, deletedAt, size }]` |
| POST   | `/api/files/trash/:id/restore` | Restore a trashed item to its original path (`?location=`) — 409 if something's there now |
| DELETE | `/api/files/trash/:id` | Permanently delete one trashed item (`?location=`)      |
| DELETE | `/api/files/trash`    | Empty a location's trash entirely (`?location=`)         |
| GET    | `/api/backups`        | List restore points (`[{ name, size, modifiedAt }]`), newest first |
| POST   | `/api/backups/run`    | Create a backup immediately (`{ modules? }`, defaults to the schedule's selection) |
| GET    | `/api/backups/:file/modules` | Which modules a specific backup contains (`{ modules: string[] }`) |
| GET/PUT | `/api/backups/schedule` | Get/set the backup schedule (`{ enabled, frequency: "daily"\|"weekly", retentionCount, dir, modules: string[] }`) — `modules` is any non-empty subset of `bookmarks`/`contacts`/`calendar`/`files`/`account` |
| GET    | `/api/backups/:file/download` | Download a backup — the raw `.tar.gz` archive, or decompressed plain `.json` for a legacy `.json.gz` one |
| DELETE | `/api/backups/:file`  | Delete one restore point                             |
| POST   | `/api/backups/:file/restore` | Restore a backup (`{ password, modules? }`, defaults to every module the backup contains) — returns `{ appliedModules }`; signs out every device only if `account` was applied |

Favicons are rendered client-side via Google's public favicon service (`s2/favicons`), based on each bookmark's domain — no favicon data is stored server-side. Theme and default view preferences are stored in the browser's `localStorage`.

## AI usage disclaimer

> [!NOTE]
> Parts of SyncMark's — code, documentation, and this README included — were
> written with the help of AI coding assistants. Everything is reviewed before
> it ships, but if you spot something that looks off, please open an issue.
