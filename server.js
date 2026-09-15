const path = require('path');
const express = require('express');

const authRouter = require('./src/routes/auth');
const bookmarksRouter = require('./src/routes/bookmarks');
const importRouter = require('./src/routes/import');
const foldersRouter = require('./src/routes/folders');
const contactsRouter = require('./src/routes/contacts');
const eventsRouter = require('./src/routes/events');
const filesRouter = require('./src/routes/files');
const passwordsRouter = require('./src/routes/passwords');
const featuresRouter = require('./src/routes/features');
const backupsRouter = require('./src/routes/backups');
const carddavRouter = require('./src/routes/carddav');
const caldavRouter = require('./src/routes/caldav');
const { requireAuth } = require('./src/middleware/auth');
const { gateRouter } = require('./src/middleware/featureGate');
const { startScheduler } = require('./src/backup');
const { PORT } = require('./src/config');

const app = express();

// CardDAV/CalDAV clients (iOS Contacts/Calendar, DAVx5) authenticate over HTTP
// Basic Auth, not the session cookie — mounted before express.json() matters
// so they can parse PROPFIND/REPORT XML and vCard/iCal PUT bodies themselves.
// carddavRouter owns the shared /dav/ and /dav/principals discovery routes
// (see the notes in src/routes/carddav.js), so it's mounted first.
app.use(carddavRouter);
app.use(caldavRouter);

app.use(express.json());
app.use('/api', authRouter);
app.use('/api', requireAuth, featuresRouter);
app.use('/api', requireAuth, backupsRouter);
app.use('/api', requireAuth, gateRouter('bookmarks', bookmarksRouter));
app.use('/api', requireAuth, gateRouter('bookmarks', importRouter));
app.use('/api', requireAuth, gateRouter('bookmarks', foldersRouter));
app.use('/api', requireAuth, gateRouter('contacts', contactsRouter));
app.use('/api', requireAuth, gateRouter('calendar', eventsRouter));
app.use('/api', requireAuth, gateRouter('files', filesRouter));
app.use('/api', requireAuth, gateRouter('passwords', passwordsRouter));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`SyncMark running at http://localhost:${PORT}`);
  startScheduler();
});
