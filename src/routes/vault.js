// Zero-knowledge vault key management. Every field this router reads or
// writes is opaque to the server — salts and wrapped-DEK ciphertext only
// (see public/vaultCrypto.js for the key hierarchy). The one exception is
// /vault/legacy-passwords, a one-time bridge for accounts that had passwords
// saved before this feature existed: it uses the OLD server-held key
// (src/utils/vault.js) exactly as many times as needed to hand this user's
// existing plaintext back over the authenticated session channel, so the
// client can re-encrypt under its new DEK. It never decrypts anything once
// every user has migrated (see PUT /vault/keys below).
const express = require('express');
const { statements, db, anyLegacyPasswordsRemain } = require('../db');
const { decrypt } = require('../utils/vault');

const router = express.Router();

function keysResponse(row) {
  return {
    vaultSalt: row.vault_salt,
    wrappedDekPassphrase: row.wrapped_dek_passphrase,
    wrappedDekPassphraseIv: row.wrapped_dek_passphrase_iv,
    recoverySalt: row.recovery_salt,
    wrappedDekRecovery: row.wrapped_dek_recovery,
    wrappedDekRecoveryIv: row.wrapped_dek_recovery_iv,
  };
}

function requireFields(body, fields) {
  return fields.every((f) => typeof body[f] === 'string' && body[f].length > 0);
}

router.get('/vault/keys', (req, res) => {
  const row = statements.getVaultKeys.get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Vault not set up yet' });
  res.json(keysResponse(row));
});

// Initial vault setup (first-ever unlock, or finishing a legacy-data
// migration) — writes every field at once. Once no account anywhere still
// has un-migrated legacy passwords, the old global key is deleted for good.
router.put('/vault/keys', (req, res) => {
  const fields = ['vaultSalt', 'wrappedDekPassphrase', 'wrappedDekPassphraseIv', 'recoverySalt', 'wrappedDekRecovery', 'wrappedDekRecoveryIv'];
  if (!requireFields(req.body, fields)) return res.status(400).json({ error: 'Missing vault key fields' });

  statements.upsertVaultKeys.run({
    userId: req.user.id,
    vaultSalt: req.body.vaultSalt,
    wrappedDekPassphrase: req.body.wrappedDekPassphrase,
    wrappedDekPassphraseIv: req.body.wrappedDekPassphraseIv,
    recoverySalt: req.body.recoverySalt,
    wrappedDekRecovery: req.body.wrappedDekRecovery,
    wrappedDekRecoveryIv: req.body.wrappedDekRecoveryIv,
  });

  if (!anyLegacyPasswordsRemain()) {
    db.prepare("DELETE FROM app_settings WHERE key = 'vault_encryption_key'").run();
  }

  res.status(201).json({ ok: true });
});

// Passphrase change: only the passphrase-wrapped DEK artifact changes — the
// recovery-key wrap, and every vault item, stay exactly as they were.
router.put('/vault/keys/passphrase', (req, res) => {
  const existing = statements.getVaultKeys.get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'Vault not set up yet' });

  const fields = ['vaultSalt', 'wrappedDekPassphrase', 'wrappedDekPassphraseIv'];
  if (!requireFields(req.body, fields)) return res.status(400).json({ error: 'Missing vault key fields' });

  statements.updateVaultPassphraseWrap.run({
    userId: req.user.id,
    vaultSalt: req.body.vaultSalt,
    wrappedDekPassphrase: req.body.wrappedDekPassphrase,
    wrappedDekPassphraseIv: req.body.wrappedDekPassphraseIv,
  });
  res.json({ ok: true });
});

// Recovery: the client already unwrapped the DEK with the old recovery key
// before calling this — since a recovery key is only ever shown once, this
// call replaces BOTH wraps with a new passphrase and a freshly generated
// recovery key together.
router.put('/vault/keys/recover', (req, res) => {
  const existing = statements.getVaultKeys.get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'Vault not set up yet' });

  const fields = ['vaultSalt', 'wrappedDekPassphrase', 'wrappedDekPassphraseIv', 'recoverySalt', 'wrappedDekRecovery', 'wrappedDekRecoveryIv'];
  if (!requireFields(req.body, fields)) return res.status(400).json({ error: 'Missing vault key fields' });

  statements.upsertVaultKeys.run({
    userId: req.user.id,
    vaultSalt: req.body.vaultSalt,
    wrappedDekPassphrase: req.body.wrappedDekPassphrase,
    wrappedDekPassphraseIv: req.body.wrappedDekPassphraseIv,
    recoverySalt: req.body.recoverySalt,
    wrappedDekRecovery: req.body.wrappedDekRecovery,
    wrappedDekRecoveryIv: req.body.wrappedDekRecoveryIv,
  });
  res.json({ ok: true });
});

// One-time bridge for pre-existing accounts: hands back this user's
// passwords decrypted under the old global key so the client can re-encrypt
// them under its new DEK. `notes` was never encrypted server-side even in
// the old scheme, so it comes back as-is.
router.get('/vault/legacy-passwords', (req, res) => {
  const rows = statements.listAllPasswordsRaw.all(req.user.id);
  res.json(rows.map((row) => ({
    id: row.id,
    siteName: row.site_name,
    url: row.url,
    username: row.username,
    password: decrypt(row.password_enc),
    notes: row.notes,
    favorite: row.favorite,
  })));
});

module.exports = router;
