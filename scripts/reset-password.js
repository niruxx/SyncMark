// Resets the SyncMark account's password directly against the database —
// for when the web UI's own password is forgotten and there's no in-app
// recovery path (this app has no email/SMTP integration by design).
//
// Usage:
//   node scripts/reset-password.js <newPassword>
//   node scripts/reset-password.js            (prompts interactively — input is NOT masked)

const readline = require('readline');
const { db } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const user = db.prepare('SELECT id, username FROM users LIMIT 1').get();
  if (!user) {
    console.error('No account exists yet — there is nothing to reset. Run the app and complete first-run setup instead.');
    process.exitCode = 1;
    return;
  }

  let newPassword = process.argv[2];
  if (!newPassword) {
    console.log('(Input is not masked — make sure nobody is looking over your shoulder.)');
    newPassword = await promptPassword(`New password for "${user.username}": `);
  }

  if (!newPassword || newPassword.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
  db.prepare('DELETE FROM sessions').run();

  console.log(`Password for "${user.username}" has been reset. Every signed-in device has been signed out.`);
}

main();
