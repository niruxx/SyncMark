# File synchronization and recovery

Enable Files and configure a location in Settings. In Files, choose that location
and select **Sync devices** to copy its WebDAV address. Each location has a stable
URL such as `https://sync.example.com/webdav/3/`. Authenticate with the regular
account's username/password; the administrator account has no file workspace.
Use HTTPS outside localhost. Reverse proxies must forward DAV methods, the
Authorization/Destination headers, and large streamed request bodies.

## Desktop folders and offline use

Install [rclone](https://rclone.org/install/), run `rclone config`, and create a
WebDAV remote named `syncmark`. Set its URL to the location address and vendor to
`other`, then enter your credentials interactively. Credentials stay in rclone's
configuration, not this repository or command arguments. This is generic WebDAV,
not a Nextcloud server; do not choose the Nextcloud vendor or native client.

Use an **empty** local folder for initialization:

```text
node scripts/sync-files.js --local "C:\Users\you\SyncMark" --remote syncmark: --initialize --dry-run
node scripts/sync-files.js --local "C:\Users\you\SyncMark" --remote syncmark: --initialize
node scripts/sync-files.js --local "C:\Users\you\SyncMark" --remote syncmark: --watch 60
```

On Linux/macOS, substitute a local path such as `/home/you/SyncMark`. After the
first initialization, omit `--initialize`. Local files remain available offline;
the helper synchronizes changes when connectivity returns and you rerun it.
A failed run stops the watcher so failures remain visible. It never silently
reinitializes sync state. Keep rclone's state/cache directory between runs.

Pass `--filters /path/to/filters.txt` on **every** run for selective sync. Example:

```text
+ /Documents/**
+ /Photos/**
- **
```

Choose filters before initialization. Changing them requires a deliberate rclone
resync; the helper refuses to initialize a nonempty folder. Use a new empty local
folder if you want to establish a different selection without merging old state.

The helper compares content checksums, downloading remote content when necessary;
this is more expensive than size-only comparison but detects same-size edits.
Normal sync keeps both conflicting versions with numbered conflict suffixes.
Deletions propagate during normal two-way sync; server deletions go to Trash.
Initialization uses the remote as the winner and is restricted to an empty local
folder. See [rclone bisync](https://rclone.org/bisync/) and its
[WebDAV backend](https://rclone.org/webdav/) for configuration and recovery.

## Mobile folders and camera backup

SyncMark provides the server endpoint; mobile background scheduling and offline
storage run in a separate WebDAV client. No native SyncMark mobile app is included.

- **Android:** configure a WebDAV account in FolderSync using the location URL.
  Create folder pairs for the remote subfolders you want stored locally. Use
  two-way sync for editable offline documents and set the desired schedule/network
  rules. For camera backup, pair local `DCIM/Camera` with a dedicated remote
  `Camera` folder in upload-only mode with deletion propagation disabled. See
  [FolderSync's model](https://foldersync.io/docs/help/concept/) and
  [camera-backup guide](https://foldersync.io/docs/help/guides/).
- **iOS:** use a WebDAV-capable file client for downloaded/offline documents.
  PhotoSync supports WebDAV photo/video transfers and configurable Autotransfer;
  configure a dedicated `Camera` subfolder and the desired trigger. See its
  [WebDAV setup](https://www.photosync-app.com/support/nas/answers/how-to-transfer-using-webdav?tl_faq=how-to-transfer-using-webdav)
  and [Autotransfer documentation](https://premium.photosync-app.com/autotransfer).
  Features can require a paid app plan.

Allow the client's requested background/battery permissions. Mobile operating
systems control when background work runs; this server cannot guarantee an upload
while an app is suspended. These are setup recipes, not a claim of device-tested
interoperability. Review the client's conflict/deletion settings before enabling
two-way sync.

## Version history, moving, and copying

Use the visible **Actions** menu beside a file to open **Version history**, preview
or download an earlier revision, or restore it. Restoring first saves the current
contents. Snapshots are captured before replacements through browser text editing,
multipart upload, resumable upload, or WebDAV PUT/overwrite COPY/MOVE.

History belongs to a location-relative **path**, not an inode: renaming/moving
does not move history, and copying does not clone it. Reusing a path reuses its
history. Writes made directly on the host filesystem are not monitored. Versions
are retained until their `.syncmark/versions` storage is removed by the operator;
there is no automatic version pruning or storage quota yet. Allow disk space for
versions, staged data, and incoming uploads. Existing full file-content backups
include `.syncmark` data; avoid backing up during an active upload.

Select row checkboxes for bulk **Copy**, **Move**, or **Move to trash**. Enter an
existing destination folder relative to a configured location; `.` means its root.
Transfers may cross owned locations and never overwrite existing destinations.
Bulk results report each item's outcome; successful items are not rolled back
when another item fails. Symbolic links, reserved metadata paths, and transfers
into the source's own subtree are rejected.

## Resumable uploads

Browser uploads use 8 MiB chunks. **Pause upload** stops after the current chunk.
Select the same file again to resume, including after reloading the page; resume
identifiers are stored locally and contain no file contents. Keep the original
file unchanged. Clearing browser storage loses the resume identifier. Inactive
sessions expire after seven days and are cleaned when another upload starts.
Uploads are limited to 100 GiB per file and 20 unfinished sessions per location.

Completed uploads are assembled into a staged file before an atomic replacement.
The existing file remains intact if a chunk fails. A changed destination produces
HTTP 412 instead of overwriting intervening edits; cancel/restart the upload to
choose a new destination state. The UI prompts before intentional replacement.

### API

All `/api` routes use the usual session cookie and Files feature gate.

| Method | Endpoint | Contract |
| --- | --- | --- |
| GET | `/api/files/sync-info?location=ID` | DAV URL, chunk size, maximum file size |
| GET | `/api/files/versions?location=ID&path=REL` | Prior versions |
| GET | `/api/files/versions/UUID?location=ID&path=REL` | Download; `&preview=1` serves an allowlisted image/video or sandboxed plain-text preview |
| POST | `/api/files/versions/UUID/restore?location=ID&path=REL` | Restore; optional `If-Match` detects stale state |
| POST | `/api/files/bulk` | JSON `{location, operation: "copy"\|"move"\|"trash", paths: [REL], destinationLocation?, destinationPath?}`; maximum 100 items |
| POST | `/api/files/uploads` | JSON `{location, path, size, overwrite?}`; returns `{id, offset, chunkSize}` |
| GET | `/api/files/uploads/UUID?location=ID` | Current offset and expected total size |
| PUT | `/api/files/uploads/UUID?location=ID` | Raw bytes with `Upload-Offset`; at most 8 MiB per request |
| POST | `/api/files/uploads/UUID/complete?location=ID` | Assemble and commit only when complete and destination unchanged |
| DELETE | `/api/files/uploads/UUID?location=ID` | Cancel and remove staged chunks |

WebDAV supports OPTIONS, depth-0/1 PROPFIND, PROPPATCH for custom properties, GET/HEAD with Range requests, PUT,
MKCOL, COPY/MOVE within a location, and DELETE to Trash. It implements conditional
`If-Match`/`If-None-Match` writes and advertises DAV class 1 only: no LOCK/UNLOCK,
infinite-depth listing, or Nextcloud-specific sync protocol. Custom DAV properties
are copied/moved by DAV operations; browser bulk operations do not migrate them.
Replacing a nonempty destination collection is deliberately rejected. Cross-location
transfers use the bulk API. Location writes are serialized in one Node process;
competing writers receive 423 and should retry. Direct host writes or multiple
server processes sharing a location are outside that concurrency guarantee.
