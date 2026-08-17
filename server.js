const path = require('path');
const express = require('express');

const authRouter = require('./src/routes/auth');
const bookmarksRouter = require('./src/routes/bookmarks');
const importRouter = require('./src/routes/import');
const foldersRouter = require('./src/routes/folders');
const { requireAuth } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', authRouter);
app.use('/api', requireAuth, bookmarksRouter);
app.use('/api', requireAuth, importRouter);
app.use('/api', requireAuth, foldersRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`SyncMark running at http://localhost:${PORT}`);
});
