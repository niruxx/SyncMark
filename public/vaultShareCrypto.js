(function (global) {
  const rsa = { name: 'RSA-OAEP', hash: 'SHA-256' };
  async function fingerprint(publicKey) {
    const hash = await crypto.subtle.digest('SHA-256', VaultCrypto.fromB64(publicKey));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function createIdentity(dek) {
    const keys = await crypto.subtle.generateKey({ ...rsa, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey']);
    const publicKey = VaultCrypto.toB64(await crypto.subtle.exportKey('spki', keys.publicKey));
    const privateKey = VaultCrypto.toB64(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    return { publicKey, privateEnc: await VaultCrypto.encryptField(privateKey, dek), fingerprint: await fingerprint(publicKey) };
  }
  async function unlockIdentity(identity, dek) {
    if (await fingerprint(identity.publicKey) !== identity.fingerprint) throw new Error('Sharing identity fingerprint mismatch');
    const plain = await VaultCrypto.decryptFieldStrict(identity.privateEnc, dek);
    return crypto.subtle.importKey('pkcs8', VaultCrypto.fromB64(plain), rsa, false, ['unwrapKey']);
  }
  function context(meta) {
    return new TextEncoder().encode(JSON.stringify({ version: 1, id: meta.id, senderId: meta.senderId, recipientId: meta.recipientId, recipientFingerprint: meta.recipientFingerprint }));
  }
  async function seal(item, recipient, meta) {
    if (await fingerprint(recipient.publicKey) !== meta.recipientFingerprint) throw new Error('Recipient fingerprint mismatch');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const pub = await crypto.subtle.importKey('spki', VaultCrypto.fromB64(recipient.publicKey), rsa, false, ['wrapKey']);
    const aad = context(meta), iv = VaultCrypto.randomBytes(12);
    const wrapped = await crypto.subtle.wrapKey('raw', key, pub, { name: 'RSA-OAEP', label: aad });
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify(item)));
    return { wrappedKey: VaultCrypto.toB64(wrapped), payload: `${VaultCrypto.toB64(iv)}:${VaultCrypto.toB64(encrypted)}` };
  }
  async function open(share, privateKey) {
    const aad = context({ id: share.id, senderId: share.sender_id, recipientId: share.recipient_id, recipientFingerprint: share.recipient_fingerprint });
    const key = await crypto.subtle.unwrapKey('raw', VaultCrypto.fromB64(share.wrapped_key), privateKey, { name: 'RSA-OAEP', label: aad }, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const [iv, ciphertext] = share.payload.split(':');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: VaultCrypto.fromB64(iv), additionalData: aad }, key, VaultCrypto.fromB64(ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  global.VaultSharing = { fingerprint, createIdentity, unlockIdentity, seal, open };
})(typeof window !== 'undefined' ? window : globalThis);
