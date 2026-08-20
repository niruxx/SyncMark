# SyncMark — Chrome extension

A Chrome (and other Chromium-based browsers — Edge, Brave, Opera, Vivaldi, etc.) toolbar
extension for the SyncMark bookmark server. This is a port of `extensions/firefox_extensions`
with the same functionality, adjusted for Chrome's Manifest V3 (`chrome.*` APIs instead of
`browser.*`; no `browser_specific_settings`).

It doesn't read the SQLite database file directly (browser extensions can't touch the
filesystem, and `better-sqlite3` is a native Node module that can't run in a browser) —
instead it talks to the same REST API (`/api/bookmarks`, `/api/folders`, `/api/auth/*`) that
the SyncMark web app uses, over HTTP, using your existing SyncMark sign-in.

## Features

- Sign in (and first-run account setup, if the server hasn't been configured yet) directly from the popup
- **☆ Bookmark this page** — one click, prefills title/URL from the active tab
- Search and filter by folder
- Add, edit, delete, and favorite/unfavorite bookmarks
- Click a bookmark to open it in a new tab
- **Bookmarks bar**: pin one folder to a slim bar injected under the address bar on every page — a self-hosted stand-in for the browser's native bookmarks bar. Off by default; turn it on and pick a folder from the extension's options page (⚙ in the popup). Left-click opens in the current tab, Ctrl/Cmd-click or middle-click opens in a new tab (same as a native bookmark), and the ✕ on the right hides it for that page only. It won't show up on your SyncMark server's own pages

Not included (by design, to keep the popup focused — use the web app for these): grid view,
drag-and-drop reordering, folder create/rename/delete, import/export, theme switching, and
the session-length setting. All of those remain in the full web UI at your server's address.

## Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this directory (`extensions/chromium_extensions`)

This works the same way in other Chromium browsers (`edge://extensions`, `brave://extensions`,
etc.) with Developer mode enabled. Unlike Firefox's temporary add-ons, this stays installed
across browser restarts until you remove it. For permanent distribution, package it as a
`.zip` and submit it to the Chrome Web Store.

There's no custom toolbar icon bundled here — Chrome requires PNG icons (unlike Firefox, which
accepts the SVG used in the Firefox extension), and none is included, so Chrome shows its
default extension icon. Add a `48`/`96`/`128`px PNG under `icons/` and reference it from
`action.default_icon` / `icons` in `manifest.json` if you'd like a branded icon.

## First use

1. Click the SyncMark icon in the toolbar, then the ⚙ settings icon (or right-click the icon → *Options*)
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
- The bookmarks bar only shows bookmarks filed directly in the pinned folder (not subfolders),
  matching how a real bookmarks-bar folder behaves. It reflows the page down by its own height
  (`margin-top` on `<html>`), which can visually clash with sites that pin their own header to
  the very top of the viewport — the ✕ button hides it per-page if that happens.
- Toggling the bar or switching the pinned folder in options refreshes every open tab
  automatically; the extension polls your server for that folder's bookmarks at most once
  every 30 seconds per tab, so edits made elsewhere can take a moment to show up.
