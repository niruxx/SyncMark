const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'clients', 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
for (const target of ['chromium', 'firefox']) {
  const output = path.join(root, 'build', 'vault-extension', target);
  fs.mkdirSync(output, { recursive: true });
  for (const file of ['popup.html', 'popup.css', 'popup.js']) fs.copyFileSync(path.join(source, file), path.join(output, file));
  for (const file of ['vaultCrypto.js', 'vaultClient.js']) fs.copyFileSync(path.join(root, 'public', file), path.join(output, file));
  const config = structuredClone(manifest);
  if (target === 'firefox') { delete config.minimum_chrome_version; config.browser_specific_settings = { gecko: { id: 'syncmark-vault@local.invalid', strict_min_version: '128.0' } }; }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(`Built ${target}: ${output}`);
}
