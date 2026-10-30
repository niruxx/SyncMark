const path = require('path');
const { Worker } = require('worker_threads');

// Each integration suite gets its own module cache, database, and environment.
// Worker threads also work in environments that restrict child-process spawning.
(async () => {
  for (const file of ['file-sync.test.js', 'bookmarks.test.js', 'passwords.test.js']) {
    await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, file));
      worker.once('error', reject);
      worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${file} failed (${code})`)));
    });
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
