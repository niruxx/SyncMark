const express = require('express');
const { statements, deleteFolder, renameFolder, ensureFolderAncestors, listMergedFolders } = require('../db');
const { normalizeFolderPath } = require('../utils/folderPath');

const router = express.Router();

function folderExists(name) {
  const inBookmarks = statements.listFolders.all().some((row) => row.folder === name);
  if (inBookmarks) return true;
  return statements.listFolderNames.all().some((row) => row.name === name);
}

router.get('/folders', (req, res) => {
  res.json(listMergedFolders());
});

router.post('/folders', (req, res) => {
  const name = normalizeFolderPath(req.body.name);
  if (!name) return res.status(400).json({ error: 'Folder name is required' });

  ensureFolderAncestors(name);
  res.status(201).json({ folder: name, count: 0 });
});

router.put('/folders', (req, res) => {
  const oldName = normalizeFolderPath(req.body.oldName);
  const newName = normalizeFolderPath(req.body.newName);

  if (!oldName || !newName) {
    return res.status(400).json({ error: 'oldName and newName are required' });
  }
  if (oldName === newName) {
    return res.json({ folder: newName });
  }
  if (!folderExists(oldName)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  renameFolder(oldName, newName);
  res.json({ folder: newName });
});

// Drag-and-drop reordering of sidebar folders. beforeName/afterName are the
// folder's new siblings (same parent path); the new position is placed between them.
router.put('/folders/reorder', (req, res) => {
  const name = normalizeFolderPath(req.body.name);
  if (!name) return res.status(400).json({ error: 'Folder name is required' });
  if (!folderExists(name)) return res.status(404).json({ error: 'Folder not found' });

  const beforeName = req.body.beforeName ? normalizeFolderPath(req.body.beforeName) : null;
  const afterName = req.body.afterName ? normalizeFolderPath(req.body.afterName) : null;

  const before = beforeName ? statements.getFolderByName.get(beforeName) : null;
  const after = afterName ? statements.getFolderByName.get(afterName) : null;

  let position;
  if (before && after) {
    position = (before.position + after.position) / 2;
  } else if (before) {
    position = before.position + 1;
  } else if (after) {
    position = after.position - 1;
  } else {
    position = 0;
  }

  ensureFolderAncestors(name);
  statements.setFolderPosition.run({ name, position });
  res.json({ folder: name, position });
});

router.delete('/folders', (req, res) => {
  const name = normalizeFolderPath(req.body.name);
  if (!name) return res.status(400).json({ error: 'Folder name is required' });
  if (!folderExists(name)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  deleteFolder(name);
  res.status(204).end();
});

module.exports = router;
