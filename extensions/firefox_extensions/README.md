# SyncMark — Firefox extension

A Firefox toolbar extension for the SyncMark bookmark server. It doesn't read the SQLite
database file directly (browser extensions can't touch the filesystem, and `better-sqlite3`
is a native Node module that can't run in a browser) — instead it talks to the same REST
API (`/api/bookmarks`, `/api/folders`, `/api/auth/*`) that the SyncMark web app uses, over
HTTP, using your existing SyncMark sign-in.

As of this version, the extension can also talk directly to two other self-hosted bookmark
managers instead of SyncMark — **[Linkwarden](https://linkwarden.app/)** and
**[Karakeep](https://karakeep.app/)** — over HTTP or HTTPS (an IP address like
`http://192.168.1.10:3000` works fine). Pick one in the extension's options page; everything
below (the popup, add/edit/delete, the bookmarks bar) then operates on that service instead.

## Features

- Sign in (and first-run account setup, if the server hasn't been configured yet) directly from the popup
- **☆ Bookmark this page** — one click, prefills title/URL from the active tab
- Search and filter by folder
- Add, delete, and (SyncMark/Linkwarden only) edit and favorite/unfavorite bookmarks
- Click a bookmark to open it in a new tab
- **Bookmarks bar**: pin one folder/collection/list to a slim bar injected under the address bar on every page — a self-hosted stand-in for the browser's native bookmarks bar, synced from whichever service is connected. Off by default; turn it on and pick a folder from the extension's options page (⚙ in the popup). Left-click opens in the current tab, Ctrl/Cmd-click or middle-click opens in a new tab (same as a native bookmark), and the ✕ on the right hides it for that page only. It won't show up on the connected service's own pages

Not included (by design, to keep the popup focused — use the web app for these): grid view,
drag-and-drop reordering, folder create/rename/delete, import/export, theme switching, and
the session-length setting. All of those remain in the full web UI at your server's address.

## Connecting Linkwarden or Karakeep instead of SyncMark

Open the extension's options page and pick a service from the **Bookmark service** dropdown:

- **Linkwarden** — sign in with your username and password (the extension exchanges them for a
  session token, the same way Linkwarden's own browser extension does), or paste a pre-generated
  **Access Token** from Linkwarden's *Settings → Access Tokens* — the latter is recommended since
  it avoids storing your password. "Folders" here are Linkwarden **Collections**.
- **Karakeep** — Karakeep's public API only supports **API keys**, not username/password, so
  generate one from Karakeep's *Settings → API Keys* and paste it in. "Folders" here are Karakeep
  **Lists**; since Karakeep lists are many-to-many (a bookmark can be in several, or none), adding
  a bookmark to a list is a separate step the extension does automatically, and editing an
  existing bookmark's list membership isn't supported from the popup — use Karakeep's own UI for
  that.

Both connect over plain `http://` as well as `https://`, so a LAN address or bare IP works.

## Load it in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this directory

This loads it for the current Firefox session only (it's removed on restart) — the standard
way to run an unsigned/unpublished extension for personal use. For something that persists
across restarts, package the folder as a `.zip`/`.xpi` and self-distribute it, or submit it
to [addons.mozilla.org](https://addons.mozilla.org) for signing.

## First use

1. Click the SyncMark icon in the toolbar, then the ⚙ settings icon (or right-click the icon → *Manage Extension* → *Preferences*)
2. Enter your SyncMark server's URL (e.g. `http://localhost:3000`, or wherever it's hosted) and save
3. Reopen the popup — it'll walk you through account setup (first run) or sign-in, exactly like the web app

## Notes

- The extension requests broad host permissions (`http://*/*`, `https://*/*`) since the server
  address is configurable and self-hosted instances can be anywhere. If you only ever point it
  at one address, you can narrow `host_permissions` in `manifest.json` to just that origin
  (e.g. `"http://localhost:3000/*"`) for tighter scope.
- For SyncMark, sessions are the same cookie-based sessions the web app uses — signing in here
  doesn't create a separate account, and the session-length you configured in the web app's
  Settings page still applies. Linkwarden and Karakeep tokens are stored in the extension's own
  local storage instead (never synced anywhere else), since those services are accessed with
  Bearer tokens rather than cookies.
- The bookmarks bar only shows bookmarks filed directly in the pinned folder (not subfolders),
  matching how a real bookmarks-bar folder behaves. It reflows the page down by its own height
  (`margin-top` on `<html>`), which can visually clash with sites that pin their own header to
  the very top of the viewport — the ✕ button hides it per-page if that happens.
- Toggling the bar or switching the pinned folder in options refreshes every open tab
  automatically; the extension polls your server for that folder's bookmarks at most once
  every 30 seconds per tab, so edits made elsewhere can take a moment to show up.
