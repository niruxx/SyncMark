# Password organization, checks, sharing, and clients

Passwords retains browser-side vault encryption. Saved passwords, notes,
attachments, and private sharing keys are encrypted before upload. Site names,
URLs, usernames, favorites, folders, tags, share participants, and timestamps are
visible metadata. The account login password and the vault passphrase remain
separate credentials.

## Folders and tags

Add a folder path and comma-separated tags in the item editor. The toolbar filters
combine with search and Favorites. **Manage folders** creates, renames, or removes
folders; renames include descendants, and removal unfiles entries without deleting
them. Folder paths allow up to 500 characters. Tags are trimmed/lowercased and
limited to 30 tags of 60 characters each.

The encrypted JSON vault backup preserves folder/tag values. CSV keeps the
existing login-oriented format and does not preserve this organization. Import
validates entries within one transaction so malformed metadata does not leave a
half-imported vault.

## Local security checks

**Security check** decrypts login entries in the current browser and checks:

- Empty/short passwords (under 12 characters).
- A small local set of common or predictable patterns.
- Inclusion of the username.
- Reuse across vault entries.
- Credentials associated with an HTTP URL.
- Ciphertext that cannot be authenticated/decrypted.

The editor shows immediate local warnings. Reuse comparison uses temporary local
hashes; passwords and hashes are not uploaded or sent to a breach service. Secure
notes are excluded. This is a heuristic check, not a breach database, a strength
score, or a guarantee that an unflagged password is safe. There is no composition
rule requiring special characters. Closing the check or locking cancels it.

## Encrypted sharing with another user

Both accounts must unlock their vault once to initialize a sharing identity.
Use **Share** beside an item, look up the exact recipient username, and verify the
displayed fingerprint with that person through a separate trusted channel. The
recipient can find their fingerprint under **Shared passwords**. Confirm the
fingerprint, select a 1–365 day expiration, and choose whether to include notes.
Attachments and the owner's folder/tag organization are not included.

Each account has a 3072-bit RSA-OAEP/SHA-256 identity. The private PKCS#8 key is
AES-GCM encrypted under that account's existing vault DEK. Each share gets a fresh
AES-256-GCM content key wrapped to the recipient public key. Version, share ID,
sender ID, recipient ID, and recipient fingerprint bind both the key wrap and
payload through authenticated context. The server stores opaque ciphertext and
the recipient-wrapped content key, not a shared plaintext password or the vault
DEK. See [Web Crypto key wrapping](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/wrapKey).

**Shared passwords** lets recipients copy the secret or save a separate copy
encrypted under their own vault DEK in `Shared copies`. Owners can revoke shares;
recipients can remove inbox items. Updating the source's encrypted password/notes,
deleting it, expiration, disabling either account, or removing an account blocks
further access through SyncMark. Shares are snapshots, not live synchronized items.
Changing a source secret requires sharing a fresh copy.

Revocation cannot erase secrets already decrypted, copied, or saved by a recipient.
Fingerprint checking relies on the separate channel; the application still trusts
the server to deliver its JavaScript and enforce account authentication. This is
not a claim of an independently audited password manager. Existing identities are
never silently overwritten. If a sharing identity cannot be decrypted, restore
the matching vault backup rather than generating a replacement over it.

## Device credentials

Open **Browser & mobile access**, enter a device name and lifetime of 1–90 days,
and confirm the **account login password**. Copy the newly generated credential;
only its SHA-256 hash is retained on the server. At most 20 unexpired credentials
can be active per account. Each is independently revocable and grants only:

- The passphrase-wrapped vault key and salt (not the recovery wrap).
- That account's encrypted entries and ordinary vault metadata.

It cannot modify items, publish sharing keys, access attachments or other users'
vaults, or authorize ordinary `/api/passwords` routes. Account login-password
changes, expiration, disabling the account, revocation, or disabling Passwords
block access. Restoring accounts or passwords revokes all device credentials.
Use HTTPS except for localhost development. A device credential enables encrypted
vault downloads, so keep it private even though local unlock still needs the vault
passphrase.

## Browser autofill extension

Build both browser bundles from the repository root:

```text
node scripts/build-vault-extension.js
```

- Chromium/Chrome/Edge: enable developer mode in the extensions page, choose
  **Load unpacked**, and select `build/vault-extension/chromium`.
- Firefox: use `about:debugging` → **This Firefox** → **Load Temporary Add-on** and
  select `build/vault-extension/firefox/manifest.json`. Permanent distribution
  requires Mozilla signing; no store publication or signing is included.

Open an HTTPS login page, invoke the extension, enter your SyncMark server URL,
device credential, and vault passphrase, then choose **Fill login**. Requesting
server-host permission happens from that explicit action. The extension uses
[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
and scripting, with no permanent all-site content scripts or background autofill.
It requests optional access to the configured server hostname; host permission
patterns cover ports, while API requests stay on the configured origin.

Only exact scheme/hostname/port matches are offered. Autofill rechecks the active
tab and live top-frame origin, refuses cross-origin form submissions, hidden or
read-only password fields, new-password fields, and ambiguous multiple-password
forms. It fills a selected login and never submits the form. It does not fill
cross-origin frames, HTTP sites outside localhost, native apps, passkeys, or OTPs.

Unlock keys and decrypted passwords stay in popup memory. Closing the popup,
locking, or two minutes of inactivity clears the unlocked state. Remembering the
device credential is optional and stores it in extension-local storage; vault
passphrases, DEKs, and plaintext passwords are never stored there. **Forget saved
settings** clears saved settings and removes the server-host permission. Revoke
the server credential separately when retiring a device.

The bundles reuse the app's Web Crypto and matching helpers. They are buildable
and their crypto/origin/fill policies are tested; real Chromium/Firefox installation
and interaction testing remain pending in this environment.

## Dedicated mobile web client

Open `/vault-mobile/` on the same SyncMark server, or follow the link under
**Browser & mobile access**. Add it to your home screen through the browser menu.
It includes a manifest and service worker for its app shell. Enter the device
credential and vault passphrase to unlock locally, search metadata, and copy a
password, username, or secure note. Device credentials are not persisted by this
client. There is no account-login password field.

**Keep encrypted offline copy** explicitly stores the downloaded ciphertext and
wrapped key in IndexedDB. Vault metadata is readable in that copy. The service
worker caches only static app assets; it never caches API responses or decrypted
secrets. On later visits, choose **Use the saved encrypted offline copy** and
unlock with its passphrase. **Delete offline copy** removes the stored snapshot.
Offline data can become stale and is not automatically synchronized or erased by
server credential revocation; it is a copy already downloaded to that device.

The mobile client locks when hidden/backgrounded, on page exit, or after two
minutes of inactivity. JavaScript cannot guarantee immediate zeroization of
garbage-collected memory or clipboard contents. Use HTTPS for service-worker,
clipboard, and install support. Actual Android/iOS home-screen and device testing
remain pending. This is a dedicated mobile **web** client: native Android
AutofillService and iOS Credential Provider integration are not implemented.

## Backup and recovery

The Passwords module of full-instance backup now includes passwords, vault key
wraps, encrypted attachments, folder metadata, sharing identities, and encrypted
shares. This also fixes earlier module backups that omitted the wraps needed to
recover vault ciphertext. These backups still require the correct vault
passphrase or recovery key. Device credentials are not restored.

The existing per-vault encrypted JSON export contains entries and folder/tag
metadata. It does not export sharing identities, inboxes, attachments, or device
credentials; use a full-instance Passwords backup for those encrypted artifacts.

The UI also renders attachment names as text and surfaces authenticated-decryption
failures instead of silently showing or exporting an empty secret.

## API additions

Session-authenticated routes require enabled Passwords:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/passwords?folder=PATH&tag=TAG&q=TEXT` | Organization filters and metadata search |
| POST / PUT | `/api/passwords`, `/api/passwords/ID` | Accept `folder` and `tags` with encrypted fields |
| GET / POST / PUT / DELETE | `/api/password-folders` | List/create/rename/remove folders; list also returns distinct tags |
| GET / POST | `/api/password-sharing/me` | Read/create the immutable encrypted sharing identity |
| GET | `/api/password-sharing/directory?username=NAME` | Recipient public key/fingerprint |
| GET / POST | `/api/password-shares` | Active inbox/outbox or encrypted share creation |
| DELETE | `/api/password-shares/UUID` | Sender revocation or recipient removal |
| GET / POST | `/api/password-clients` | List clients or issue `{name, days, password}` credential |
| DELETE | `/api/password-clients/UUID` | Revoke an owned client |

The separate client API accepts only `Authorization: Bearer CREDENTIAL`:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/password-client/keys` | Passphrase wrapping artifacts only |
| GET | `/api/password-client/items` | Owned ciphertext entries; no server decryption |

Mutations and unknown client routes are rejected. Cookies cannot authenticate the
client API, and device credentials cannot authenticate ordinary session routes.
