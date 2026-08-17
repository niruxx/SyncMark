/** Trims, collapses slashes, and drops empty segments from a folder path like "  /Work//Projects/ ". */
function normalizeFolderPath(raw) {
  return (raw || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

module.exports = { normalizeFolderPath };
