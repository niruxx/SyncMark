// Resets a SyncMark account's password directly against the database — for
// when the web UI's own password is forgotten and there's no in-app recovery
// path (this app has no email/SMTP integration by design). Works for any
// account, admin included, since an admin has no separate recovery path.
//
// Usage:
//   node scripts/reset-password.js <username> <newPassword>
//   node scripts/reset-password.js <username>              (prompts interactively — input is NOT masked)
//   node scripts/reset-password.js <newPassword>            (only when exactly one account exists)
//   node scripts/reset-password.js                          (prompts for both — only when exactly one account exists)

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
  const allUsers = db.prepare('SELECT id, username FROM users').all();
  if (allUsers.length === 0) {
    console.error('No account exists yet — there is nothing to reset. Run the app and complete first-run setup instead.');
    process.exitCode = 1;
    return;
  }

  let [usernameArg, passwordArg] = process.argv.slice(2);

  // With more than one account, the first argument must name which one —
  // there's no "the" account to fall back to once SyncMark is multi-user.
  if (allUsers.length > 1 && !usernameArg) {
    console.error(
      `Multiple accounts exist — specify which one:\n` +
        allUsers.map((u) => `  ${u.username}`).join('\n') +
        `\n\nUsage: node scripts/reset-password.js <username> [newPassword]`
    );
    process.exitCode = 1;
    return;
  }

  let user;
  if (usernameArg && allUsers.some((u) => u.username === usernameArg)) {
    user = allUsers.find((u) => u.username === usernameArg);
  } else if (allUsers.length === 1) {
    // Single-account instance: usernameArg (if given and it didn't match) is
    // actually the password, same as this script's original single-user form.
    user = allUsers[0];
    passwordArg = usernameArg ?? passwordArg;
  } else {
    console.error(`No account named "${usernameArg}". Existing accounts:\n` + allUsers.map((u) => `  ${u.username}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  let newPassword = passwordArg;
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
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  console.log(`Password for "${user.username}" has been reset. Every signed-in device for this account has been signed out.`);
}

main();
