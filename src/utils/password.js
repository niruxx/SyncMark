const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidateBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}

module.exports = { hashPassword, verifyPassword };
