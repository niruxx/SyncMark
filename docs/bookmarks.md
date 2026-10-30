# Bookmark library tools

The bookmark workspace now includes tags, private notes, library review, readable
page captures, collection sharing, RSS feeds, browser synchronization, and visit
widgets. Existing libraries migrate automatically on server startup.

## Tags, notes, and search

Use **Add bookmark** or **Edit** to enter comma-separated tags and personal notes.
Tags are trimmed, lowercased, deduplicated, and limited to 30 tags of 60 characters
each. Notes allow 20,000 characters. The toolbar tag filter combines with folder,
favorite, and text filters. Text search matches titles, URLs, notes, tags, and
captured page text. Search is substring-based SQLite search, not ranked full-text
indexing.

JSON export/import preserves tags, notes, and favorites, including bookmarks with
no folder. Browser HTML export retains its existing title/URL/folder format.
Full-instance bookmark backups additionally preserve captured text, sharing groups,
collection grants, and synchronization IDs. Active guest sessions and sync locks
are not restored. Account-only restores leave bookmark collections intact.

## Duplicates and link health

**Review library** lists duplicate URL groups. Normalization uses the URL parser
and ignores fragments; it does not discard query parameters or equate HTTP with
HTTPS. Choose which bookmark/folder to keep before merging. A merge combines tags,
distinct notes, favorite status, visit counts, and an available page capture.
Other bookmarks in the confirmed group are deleted. Combined metadata must fit
the normal limits.

The link-health section checks individual bookmarks or the next 50 entries in the
current folder, prioritizing older checks. **Stop checking** takes effect after
the current request. Search, tag, and favorite filters do not narrow that batch.

| Result | Meaning |
| --- | --- |
| `ok` | Final HTTP response below 400 |
| `broken` | HTTP 404 or 410 |
| `http:STATUS` | Another HTTP error; may require login or reject automated requests |
| `blocked` | Private/reserved destination rejected by the fetch policy |
| `unreachable` | Network, timeout, TLS, or another fetch failure; not proof the page is gone |

Checks use HEAD and fall back to GET for servers returning 405/501. There is no
automatic deletion of broken links and no background crawl.

## Readable page captures

Use a bookmark's **More → Capture readable page** action. SyncMark stores a
read-only text snapshot of server-rendered HTML or plain text. **Read captured
page** opens the stored text; **Refresh captured page** replaces it after a
successful capture. A failed refresh preserves the previous copy. Changing the
bookmark URL clears its old capture and link-check result.

Captures are intentionally lightweight: they do not preserve images, styles,
downloads, authenticated sessions, browser-executed JavaScript, or a full offline
website. Script/style/navigation content is removed and snapshots are served as
plain text with a sandboxed content policy. Each bookmark stores one current
capture; full backups can retain earlier copies.

Fetching is limited to standard HTTP(S) web ports, four redirects, a 12-second
request deadline, and 2 MiB of response content. One fetch per account runs at a
time. Every destination, including redirects, is checked for private/reserved IPs.
DNS results are validated and pinned to the actual connection. Embedded URL
credentials, local network pages, and unsupported compressed/binary responses are
not captured. No login cookies or account credentials are sent to remote sites.

## Read-only collection sharing

Select a folder, then **Share collection**. The collection includes that folder
and its subfolders. With no folder selected, it includes the whole library.
Search, tags, and Favorites are view filters, not share boundaries; the sharing
dialog states the actual scope before creation.

- Enter existing regular-account usernames for direct grants.
- Use **Manage sharing groups** to create bookmark-specific recipient groups.
  Removing members immediately removes their group access. These are not global
  administrator roles or permissions for other modules.
- Enable **Create public link and RSS feed** for an unguessable bearer URL. Add an
  optional password and expiration. The public URL is displayed only at creation;
  only its hash is stored. Revoke and recreate the share if you lose the URL.
- Use **Shared with me** to browse collections granted to your account.

Recipients see titles, URLs, tags, and relative folder paths. Notes, captures,
visit statistics, internal bookmark IDs, and the owner's other collections remain
private. Public pages do not load remote favicons or scripts. Shares are read-only
and update as bookmarks enter or leave the collection. Renaming a folder follows
its shares; deleting it revokes them. Disabling the owner, expiration, revocation,
or disabling Bookmarks immediately blocks access.

Password-protected public pages issue a one-hour, HttpOnly guest cookie after
unlocking; no SyncMark account is needed. Password attempts are rate-limited.
Use HTTPS when publishing the service or connecting feed readers.

## RSS feeds

Copy the RSS address when creating a public collection link. A feed follows the
same collection, password, expiration, and revocation rules. Feed items contain
titles, destination URLs, and tags, with stable URL/folder identifiers. They omit
personal notes and page captures. Passwordless feed URLs grant access to anyone
who possesses them. For protected feeds, configure HTTP Basic authentication in
the reader with any username and the collection password; an unlocked browser can
also use its guest cookie.

## Bidirectional browser sync with Floccus

Install [Floccus](https://floccus.org/guides/) and select its **XBEL file in WebDAV**
account type. Use:

| Setting | Value |
| --- | --- |
| Server URL | `https://your-syncmark-host/bookmark-sync/` |
| Bookmark file | `bookmarks.xbel` |
| Credentials | Your regular SyncMark account username/password |
| Format | XBEL |
| Floccus encryption | Off; the server needs to parse the tree |

**Sync browsers** in the app shows the server address. This syncs the entire
account's library, not the selected collection or current search. Select a
dedicated local browser folder, use merge for the first sync, keep the client's
deletion safeguard enabled, and avoid competing native browser synchronization on
that folder. Take a backup before an initial merge of two populated libraries.

The endpoint implements the Floccus WebDAV adapter's GET/HEAD, lock-file handling,
temporary upload, size PROPFIND, and MOVE sequence. Uploaded XML is retained
byte-for-byte until the library tree changes, satisfying its size verification.
Stable IDs connect bookmark and folder changes in both directions, including
deletions. A surviving bookmark keeps its server-side tags, notes, favorite state,
capture, and visits. Those extra fields are not transported by Floccus XBEL.
Renamed folder shares follow the folder's sync ID; deleted collection shares are
revoked.

Only HTTP(S) URLs without embedded credentials are accepted; bookmarklets,
separators represented by other URL schemes, HTML-file mode, and encrypted XBEL
are unsupported. Trees are limited to 5 MiB, 20,000 items, and 40 folder levels.
Malformed/duplicate IDs and unsupported tree structures are rejected before any
transaction is applied. Web bookmark/folder mutations return 423 during sync.
Conditional writes and a baseline tree hash reject stale library replacements.
Locks expire after 15 minutes if a client disappears.

This implements the [Floccus WebDAV request sequence](https://github.com/floccusaddon/floccus/blob/develop/src/lib/adapters/WebDav.ts),
not the Nextcloud Bookmarks API. Automated protocol round trips pass; a real
Floccus browser session has not been verified in this environment.

## Visits and dashboard widgets

Opening a bookmark from SyncMark's list, grid, folder sidebar, or dashboard records
a visit. **Recently opened** and **Frequently visited** display the top five
entries. Direct visits outside SyncMark, right-click “open link” actions that do
not dispatch a tracked click, and openings from public/shared collections are not
counted. Counters belong to the owner and are never published with a share.

## API additions

`/api` routes require the usual session cookie and enabled Bookmarks feature.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/bookmarks?tag=TAG&q=TEXT` | Filter tags and search metadata/captured text |
| POST / PUT | `/api/bookmarks`, `/api/bookmarks/ID` | Accept `tags: string[]` and `notes: string` |
| GET | `/api/bookmarks/tags` | Distinct tags |
| GET | `/api/bookmarks/dashboard` | Library totals, recent, and frequent entries |
| GET | `/api/bookmarks/duplicates` | Duplicate URL groups |
| POST | `/api/bookmarks/duplicates/merge` | `{keepId, ids}`; explicit metadata-preserving merge |
| POST | `/api/bookmarks/ID/check` | Check destination health |
| POST / GET / DELETE | `/api/bookmarks/ID/archive` | Capture, read, or remove stored text |
| POST | `/api/bookmarks/ID/visit` | Record an opening |
| GET / POST | `/api/bookmark-groups` | List/create groups; creation uses `{name, members: [username]}` |
| PUT / DELETE | `/api/bookmark-groups/ID` | Replace members/name or remove group |
| GET / POST | `/api/bookmark-shares` | List/create owned shares |
| GET | `/api/bookmark-shares/received` | Collections granted to this account |
| GET | `/api/bookmark-shares/ID/items` | Authorized read-only collection |
| DELETE | `/api/bookmark-shares/ID` | Revoke an owned share |
| GET / POST | `/s/bookmarks/TOKEN` | Public view / password unlock |
| GET | `/s/bookmarks/TOKEN/rss` | RSS; cookie or collection Basic password when protected |

Share creation accepts `{folder, title?, users?: [username], groups?: [id],
public?: boolean, password?: string, expiresAt?: ISODate}` and returns
`{id, url, rss}`. Public addresses are returned once. Reverse proxies must forward
Authorization and the sync endpoint's PROPFIND/MOVE/Destination headers.
