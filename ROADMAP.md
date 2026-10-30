# SyncMark roadmap: missing Nextcloud capabilities

Compared on **October 30, 2026** against SyncMark's README, database schema,
server routes, DAV handlers, and browser UI. Only missing capabilities are listed;
items extending an existing module describe the missing part specifically.

Nextcloud references include Hub products and optional apps, labeled below.
Availability depends on the installed apps, version, and server configuration.
This is a proposed backlog, not a release schedule or a promise of complete
Nextcloud ecosystem parity. Priority reflects suggested implementation order.

## P1 — Core capability gaps

### Account security

- [ ] Two-factor authentication with authenticator codes and recovery codes.
- [ ] Device-specific app passwords for DAV and other clients, individually revocable.
- [ ] A connected-device/session list with last activity and remote sign-out.

Nextcloud reference: [two-factor authentication](https://docs.nextcloud.com/server/latest/user_manual/en/user_2fa.html) and [device/session management](https://docs.nextcloud.com/server/latest/user_manual/en/session_management.html).

### File sharing and access control

- [ ] Share files and folders with other users or groups using explicit access permissions.
- [ ] Public share links with passwords, expiration dates, and revocation.
- [ ] Upload-only file-request links for receiving files from people without accounts.
- [ ] Shared team folders and application-level permissions, separate from filesystem mode bits.

Nextcloud reference: [sharing](https://nextcloud.com/sharing/).

### File synchronization and recovery

- [x] General-purpose file WebDAV access for mounting and syncing file locations — authenticated `/webdav/` with owned locations, conditional writes, and safe file operations; no DAV locks or Nextcloud-specific APIs.
- [x] Desktop folder synchronization with selective sync and conflict handling — `scripts/sync-files.js` integrates rclone bisync, filter files, offline folders, and retained conflict copies. Requires a separately installed/configured rclone client; real-client interoperability verification remains pending.
- [ ] Mobile file synchronization, offline availability, and automatic camera uploads — server support and Android/iOS WebDAV client setup are ready; background/offline behavior is provided by third-party clients, with device verification still pending. No native SyncMark mobile client is included.
- [x] Per-file version history with preview and restoration of earlier revisions — snapshots before SyncMark overwrites; restoration preserves the current revision. History is path-bound; direct host writes are not monitored.
- [x] File move/copy operations between folders and bulk file actions — visible row actions and checkbox selection; transfers between owned locations and per-item error reporting.
- [x] Resumable/chunked uploads for large files and interrupted connections — browser pause/resume, persistent offsets, staged atomic completion, and conflict detection.

Setup, API contracts, and limitations: [File synchronization and recovery](docs/file-sync.md).

Nextcloud references: [Files](https://nextcloud.com/files/) and [WebDAV and sync clients](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html).

### Calendar scheduling

- [ ] Multiple named, color-coded calendars per account.
- [ ] Calendar sharing with read-only or editing access, plus public calendar links.
- [ ] Subscribe to external calendars by URL with scheduled refresh.
- [ ] Event reminders through notifications and optional email delivery.
- [ ] Attendees, meeting invitations, RSVP responses, and availability checks.
- [ ] Edit or cancel a single occurrence in a recurring series.
- [ ] Day, week, and agenda views alongside the month view.
- [ ] Appointment booking pages with configurable availability.

Nextcloud reference: [Calendar user guide](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/calendar.html).

Implementation dependency: model reminders, attendees, and recurrence exceptions
through storage, the UI, and DAV import/export together; SyncMark's current
iCalendar parser explicitly ignores unmodeled fields such as `VALARM` and `ATTENDEE`.

## P2 — Extend the personal workspace

### Bookmarks — optional Nextcloud Bookmarks app

- [x] Bookmark tags and personal notes/descriptions — editor fields, tag filters, metadata search, and JSON round trips.
- [x] Detect duplicate bookmarks and broken links — confirmed metadata-preserving duplicate merges and manual individual/batch health checks.
- [x] Archive linked pages and search their captured contents — readable text snapshots of HTML/plain text, with bounded fetching and private-network protection; full-fidelity/browser-rendered archives are not included.
- [x] Share bookmark collections with users/groups or public links — read-only grants, bookmark sharing groups, public passwords/expiration/revocation, and private-field exclusion.
- [x] Bidirectional browser bookmark synchronization, such as Floccus-compatible integration — dedicated XBEL WebDAV adapter with stable IDs, lock/temp/MOVE handling, byte-exact size verification, and stale-write protection. Automated protocol tests pass; real Floccus browser verification remains pending.
- [x] RSS feeds for bookmark collections — tokenized collection feeds, optional password authentication, and shared revocation/expiration rules.
- [x] Visit-frequency statistics and recent/frequent bookmark dashboard widgets — tracked openings from SyncMark and owner-only top-five widgets.

Setup, API contracts, and limitations: [Bookmark library tools](docs/bookmarks.md).

Nextcloud reference: [Bookmarks feature list and clients](https://github.com/nextcloud/bookmarks#readme).

### Contacts and address books

- [ ] Multiple independently managed address books per account.
- [ ] Shared address books with user/group permissions.

Nextcloud reference: [Groupware](https://nextcloud.com/groupware/).

### Passwords — optional Nextcloud Passwords app

- [x] Password folders and tags — editor metadata, folder management, combined filters, and encrypted JSON round trips.
- [x] Password security checks and warnings for insecure credentials — local short/common/reused/contextual password and HTTP checks; no remote breach lookup or guaranteed strength score.
- [x] Secure password sharing with other users — recipient-key encrypted snapshots, verified fingerprints, inbox/save-copy, expiration/revocation, and source-edit revocation. Attachments are not shared; decrypted copies cannot be revoked.
- [x] Browser autofill integration and dedicated mobile-client access — buildable Chromium/Firefox extension with explicit exact-origin fill, revocable read-only device credentials, and a dedicated mobile web vault with opt-in encrypted offline storage. Real browser/device QA is pending; native Android/iOS system-wide autofill is not included.

Setup, API contracts, and limitations: [Password vault tools and clients](docs/password-vault.md).

Nextcloud reference: [Passwords app features and clients](https://passwordsapp.org/).

Implementation constraint: organization, sharing, and client integration must
preserve SyncMark's browser-side vault encryption and recovery model.

### Search, activity, and notifications

- [ ] Unified search across enabled modules from a single entry point.
- [ ] Search file contents using an optional indexing service.
- [ ] A dashboard combining upcoming events, recent files, and useful app widgets.
- [ ] Persistent activity history for file changes and sharing events.
- [ ] A notification center for reminders, shares, and mentions.
- [ ] File comments and user mentions.

Nextcloud references: [web interface and unified search](https://docs.nextcloud.com/server/stable/user_manual/de/webinterface.html), [Files](https://nextcloud.com/files/), and [sharing](https://nextcloud.com/sharing/).

### Tasks and notes — optional Nextcloud apps

- [ ] Task lists with due dates, priorities, subtasks, completion state, and CalDAV `VTODO` synchronization.
- [ ] A dedicated Markdown notes library with categories and client synchronization.
- [ ] Kanban boards with cards, assignments, due dates, and attachments.

Nextcloud references: [Tasks](https://apps.nextcloud.com/apps/tasks), [Notes](https://apps.nextcloud.com/apps/notes), and [Deck](https://github.com/nextcloud/deck).

## P3 — Larger platform additions

These require substantial new infrastructure or integrations; evaluate them
individually after the core workspace gaps.

### Collaboration products

- [ ] Collaborative office document, spreadsheet, and presentation editing through an office-engine integration. Reference: [Nextcloud Office](https://nextcloud.com/office/).
- [ ] Direct/group chat, audio/video calls, and screen sharing. Reference: [Nextcloud Talk](https://nextcloud.com/talk/).
- [ ] An IMAP/SMTP webmail client integrated with contacts and calendar. Reference: [Nextcloud Groupware](https://nextcloud.com/groupware/).

### Administration and integrations

- [ ] User groups for shared-resource membership and access policies.
- [ ] Per-user storage quotas with usage reporting and enforcement.
- [ ] External storage backends such as S3, SMB, and SFTP.
- [ ] LDAP/Active Directory user provisioning and authentication.
- [ ] Federated sharing with other compatible server instances.
- [ ] Event-triggered workflow rules and external automation integrations.
- [ ] An optional private AI assistant for content search, summarization, and writing.

Nextcloud references: [Files](https://nextcloud.com/files/), [storage configuration](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/config_sample_php_parameters.html), [LDAP integration](https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_ldap.html), [Flow](https://nextcloud.com/flow/), and [Assistant](https://nextcloud.com/assistant/).

## Suggested dependencies

1. Add device credentials and session controls before introducing sync clients.
2. Define resource ownership, groups, and access permissions before sharing resources.
3. Add file revision/conflict handling before multi-client or collaborative editing.
4. Add a notification service and background delivery jobs before event reminders.
5. Introduce shared search/activity interfaces before adding more application modules.
