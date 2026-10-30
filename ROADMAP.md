# SyncMark roadmap

## P1 — Core capability gaps

### Account security

- [ ] Two-factor authentication with authenticator codes and recovery codes.
- [ ] Device-specific app passwords for DAV and other clients, individually revocable.
- [ ] A connected-device/session list with last activity and remote sign-out.

### File sharing and access control

- [ ] Share files and folders with other users or groups using explicit access permissions.
- [ ] Public share links with passwords, expiration dates, and revocation.
- [ ] Upload-only file-request links for receiving files from people without accounts.
- [ ] Shared team folders and application-level permissions, separate from filesystem mode bits.

### File synchronization and recovery

- [x] General-purpose file WebDAV access for mounting and syncing file locations.
- [x] Desktop folder synchronization with selective sync and conflict handling.
- [ ] Mobile file synchronization, offline availability, and automatic camera uploads.
- [x] Per-file version history with preview and restoration of earlier revisions.
- [x] File move/copy operations between folders and bulk file actions.
- [x] Resumable/chunked uploads for large files and interrupted connections.

### Calendar scheduling

- [ ] Multiple named, color-coded calendars per account.
- [ ] Calendar sharing with read-only or editing access, plus public calendar links.
- [ ] Subscribe to external calendars by URL with scheduled refresh.
- [ ] Event reminders through notifications and optional email delivery.
- [ ] Attendees, meeting invitations, RSVP responses, and availability checks.
- [ ] Edit or cancel a single occurrence in a recurring series.
- [ ] Day, week, and agenda views alongside the month view.
- [ ] Appointment booking pages with configurable availability.

## P2 — Extend the personal workspace

### Bookmarks

- [x] Bookmark tags and personal notes/descriptions.
- [x] Detect duplicate bookmarks and broken links.
- [x] Archive linked pages and search their captured contents.
- [x] Share bookmark collections with users/groups or public links.
- [x] Bidirectional browser bookmark synchronization, such as Floccus-compatible integration.
- [x] RSS feeds for bookmark collections.
- [x] Visit-frequency statistics and recent/frequent bookmark dashboard widgets.

### Contacts and address books

- [ ] Multiple independently managed address books per account.
- [ ] Shared address books with user/group permissions.

### Passwords

- [x] Password folders and tags.
- [x] Password security checks and warnings for insecure credentials.
- [x] Secure password sharing with other users.
- [x] Browser autofill integration and dedicated mobile-client access.

### Search, activity, and notifications

- [ ] Unified search across enabled modules from a single entry point.
- [ ] Search file contents using an optional indexing service.
- [ ] A dashboard combining upcoming events, recent files, and useful app widgets.
- [ ] Persistent activity history for file changes and sharing events.
- [ ] A notification center for reminders, shares, and mentions.
- [ ] File comments and user mentions.

### Tasks and notes

- [ ] Task lists with due dates, priorities, subtasks, completion state, and CalDAV `VTODO` synchronization.
- [ ] A dedicated Markdown notes library with categories and client synchronization.
- [ ] Kanban boards with cards, assignments, due dates, and attachments.

## P3 — Larger platform additions

### Collaboration products

- [ ] Collaborative office document, spreadsheet, and presentation editing through an office-engine integration.
- [ ] Direct/group chat, audio/video calls, and screen sharing.
- [ ] An IMAP/SMTP webmail client integrated with contacts and calendar.

### Administration and integrations

- [ ] User groups for shared-resource membership and access policies.
- [ ] Per-user storage quotas with usage reporting and enforcement.
- [ ] External storage backends such as S3, SMB, and SFTP.
- [ ] LDAP/Active Directory user provisioning and authentication.
- [ ] Federated sharing with other compatible server instances.
- [ ] Event-triggered workflow rules and external automation integrations.
- [ ] An optional private AI assistant for content search, summarization, and writing.
