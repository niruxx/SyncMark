// Zero-knowledge vault cryptography — the one module that actually touches
// key material. Every function here runs client-side only (the web app AND
// the browser extension load this exact file, unmodified) and relies solely
// on the native Web Crypto API (AES-256-GCM + PBKDF2), so there's no WASM/
// third-party crypto dependency to audit or bundle.
//
// Key hierarchy:
//   vault passphrase --PBKDF2--> VK (Vault Key)   --unwraps--> DEK
//   recovery key      --PBKDF2--> RK (Recovery Key) --unwraps--> DEK
//   DEK encrypts every actual vault item (passwords/notes/attachments).
// The server only ever stores salts and the two wrapped-DEK ciphertexts. It
// can derive neither VK, RK, nor DEK from what it's given.
(function (global) {
  const PBKDF2_ITERATIONS = 600000;
  const PBKDF2_HASH = 'SHA-256';
  const AES_ALG = 'AES-GCM';
  const AES_LENGTH = 256;
  const IV_BYTES = 12;
  const SALT_BYTES = 16;

  function toB64(bufferOrView) {
    const bytes = bufferOrView instanceof Uint8Array ? bufferOrView : new Uint8Array(bufferOrView);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromB64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  // Derives an AES-256-GCM wrapping key (VK or RK) from a passphrase/recovery
  // key string. Generates a fresh salt when none is supplied (initial setup);
  // pass the stored salt back in on every subsequent unlock.
  async function deriveKey(secret, saltB64) {
    const salt = saltB64 ? fromB64(saltB64) : randomBytes(SALT_BYTES);
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
      baseKey,
      { name: AES_ALG, length: AES_LENGTH },
      false,
      ['wrapKey', 'unwrapKey']
    );
    return { key, saltB64: toB64(salt) };
  }

  // The Data Encryption Key — generated once per vault, extractable only so
  // it can be wrapped (never exported in the clear).
  async function generateDek() {
    return crypto.subtle.generateKey({ name: AES_ALG, length: AES_LENGTH }, true, ['encrypt', 'decrypt']);
  }

  async function wrapDek(dek, wrappingKey) {
    const iv = randomBytes(IV_BYTES);
    const wrapped = await crypto.subtle.wrapKey('raw', dek, wrappingKey, { name: AES_ALG, iv });
    return { wrappedB64: toB64(wrapped), ivB64: toB64(iv) };
  }

  async function unwrapDek(wrappedB64, ivB64, wrappingKey) {
    return crypto.subtle.unwrapKey(
      'raw',
      fromB64(wrappedB64),
      wrappingKey,
      { name: AES_ALG, iv: fromB64(ivB64) },
      { name: AES_ALG, length: AES_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt/decrypt one plaintext string field with the DEK. Same
  // `iv:ciphertext` base64 colon-join convention the old server-side vault
  // used, so ciphertext strings still round-trip through a plain TEXT column.
  async function encryptField(plaintext, dek) {
    const iv = randomBytes(IV_BYTES);
    const data = new TextEncoder().encode(String(plaintext ?? ''));
    const ciphertext = await crypto.subtle.encrypt({ name: AES_ALG, iv }, dek, data);
    return `${toB64(iv)}:${toB64(ciphertext)}`;
  }

  async function decryptField(payload, dek) {
    if (!payload) return '';
    const sep = String(payload).indexOf(':');
    if (sep === -1) return '';
    const ivB64 = payload.slice(0, sep);
    const dataB64 = payload.slice(sep + 1);
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: AES_ALG, iv: fromB64(ivB64) },
        dek,
        fromB64(dataB64)
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      return ''; // wrong key / corrupted row — fail closed rather than throw
    }
  }

  // Same idea, for raw bytes (attachments) rather than a text field.
  async function encryptBytes(bytes, dek) {
    const iv = randomBytes(IV_BYTES);
    const ciphertext = await crypto.subtle.encrypt({ name: AES_ALG, iv }, dek, bytes);
    return { ivB64: toB64(iv), ciphertext: new Uint8Array(ciphertext) };
  }

  async function decryptBytes(ciphertextBytes, ivB64, dek) {
    const plaintext = await crypto.subtle.decrypt({ name: AES_ALG, iv: fromB64(ivB64) }, dek, ciphertextBytes);
    return new Uint8Array(plaintext);
  }

  // Recovery key: 20 random bytes, base32-ish encoded (no ambiguous
  // characters), grouped for readability — shown to the user exactly once.
  const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  function formatRecoveryKey(bytes) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
    return output.match(/.{1,4}/g).join('-');
  }

  function generateRecoveryKey() {
    return formatRecoveryKey(randomBytes(20));
  }

  function normalizeRecoveryKey(formatted) {
    return String(formatted || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  global.VaultCrypto = {
    PBKDF2_ITERATIONS,
    deriveKey,
    generateDek,
    wrapDek,
    unwrapDek,
    encryptField,
    decryptField,
    encryptBytes,
    decryptBytes,
    generateRecoveryKey,
    normalizeRecoveryKey,
    toB64,
    fromB64,
    randomBytes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
