const path = require('path');
const fs = require('fs');

const DEFAULT_PORT = 3000;
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');

function parsePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// data/config.json ({ "port": 8080 }) lives next to the database, so it
// survives updates and is covered by the same Docker bind mount. Anything
// wrong with it falls back to the default rather than stopping the server.
function readFileConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read data/config.json: ${err.message}`);
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn(`Ignoring data/config.json — invalid JSON: ${err.message}`);
    return {};
  }
}

// Precedence: PORT environment variable > data/config.json > 3000.
function resolvePort() {
  if (process.env.PORT) {
    const fromEnv = parsePort(process.env.PORT);
    if (fromEnv) return fromEnv;
    console.warn(`Ignoring invalid PORT environment variable "${process.env.PORT}"`);
  }

  const fileConfig = readFileConfig();
  if (fileConfig.port !== undefined) {
    const fromFile = parsePort(fileConfig.port);
    if (fromFile) return fromFile;
    console.warn(`Ignoring invalid "port" in data/config.json (${JSON.stringify(fileConfig.port)}) — must be a whole number from 1 to 65535`);
  }

  return DEFAULT_PORT;
}

const PORT = resolvePort();

module.exports = { PORT };
