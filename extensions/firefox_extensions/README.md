# SyncMark — Firefox extension

A Firefox toolbar extension for the SyncMark bookmark server. It doesn't read the SQLite
database file directly (browser extensions can't touch the filesystem, and `better-sqlite3`
is a native Node module that can't run in a browser) — instead it talks to the same REST
API (`/api/bookmarks`, `/api/folders`, `/api/auth/*`) that the SyncMark web app uses, over
HTTP, using your existing SyncMark sign-in.

## Features

- Sign in (and first-run account setup, if the server hasn't been configured yet) directly from the popup
- **☆ Bookmark this page** — one click, prefills title/URL from the active tab
- Search and filter by folder
- Add, edit, delete, and favorite/unfavorite bookmarks
- Click a bookmark to open it in a new tab

Not included (by design, to keep the popup focused — use the web app for these): grid view,
drag-and-drop reordering, folder create/rename/delete, import/export, theme switching, and
the session-length setting. All of those remain in the full web UI at your server's address.

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
- Sessions are the same cookie-based sessions the web app uses — signing in here doesn't create
  a separate account, and the session-length you configured in the web app's Settings page
  still applies.
