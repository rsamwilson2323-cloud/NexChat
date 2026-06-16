// ============================================================
//  NexChat — server.js
// ============================================================
//
//  ██████████████████████████████████████████████████████████
//  ██                                                      ██
//  ██   STEP 1: PASTE YOUR NGROK AUTHTOKEN BELOW          ██
//  ██   Get it from: https://dashboard.ngrok.com          ██
//  ██   → Your Authtoken                                  ██
//  ██                                                      ██
//  ██████████████████████████████████████████████████████████

const NGROK_AUTHTOKEN = "3DLXyTtG8ury4yHMgR4VYIIg2sE_o7b5njh5E88ukXkr1maw";

//  ██████████████████████████████████████████████████████████
//  ██   STEP 2: Run:  npm install                          ██
//  ██   STEP 3: Run:  node server.js                       ██
//  ██████████████████████████████████████████████████████████

// ============================================================

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const FileStore  = require('session-file-store')(session);
const os         = require('os');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// ── Directories ──────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const MEDIA_DIR   = path.join(__dirname, 'public', 'media');
const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');
const SESS_DIR    = path.join(DATA_DIR, 'sessions');

[DATA_DIR, MEDIA_DIR, AVATARS_DIR, SESS_DIR,
 path.join(__dirname, 'public', 'icons')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

function loadJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

if (!fs.existsSync(USERS_FILE))    saveJSON(USERS_FILE, {});
if (!fs.existsSync(MESSAGES_FILE)) saveJSON(MESSAGES_FILE, {});
if (!fs.existsSync(CONTACTS_FILE)) saveJSON(CONTACTS_FILE, {});

// ── Session setup ─────────────────────────────────────────────
const sessionMiddleware = session({
  store: new FileStore({ path: SESS_DIR, ttl: 86400 * 30, retries: 1, reapInterval: 3600 }),
  secret: 'nexchat-2024-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 * 30, httpOnly: true, sameSite: 'lax' }
});

// ── Middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer ────────────────────────────────────────────────────
const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename:    (_req, file,  cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, (req.session.username || 'user') + '_' + Date.now() + ext);
  }
});
const uploadMedia  = multer({ storage: mediaStorage,  limits: { fileSize: 100 * 1024 * 1024 } });
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 10  * 1024 * 1024 } });

// ── Online users ──────────────────────────────────────────────
const onlineUsers  = new Map(); // username -> Set<socketId>
const lastSeenMap  = new Map(); // username -> timestamp

function isOnline(u)        { return onlineUsers.has(u) && onlineUsers.get(u).size > 0; }
function addSock(u, sid)    { if (!onlineUsers.has(u)) onlineUsers.set(u, new Set()); onlineUsers.get(u).add(sid); }
function removeSock(u, sid) { if (!onlineUsers.has(u)) return; onlineUsers.get(u).delete(sid); if (!onlineUsers.get(u).size) onlineUsers.delete(u); }
function chatKey(a, b)      { return [a, b].sort().join('__'); }
function sanitize(u) {
  return {
    username:     u.username,
    displayName:  u.displayName,
    phone:        u.phone        || '',
    bio:          u.bio          || '',
    avatar:       u.avatar       || '',
    favReactions: u.favReactions || ['❤️','👍','😂','😮','😢','🙏']
  };
}

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, displayName, phone, bio } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Username and password required' });
    if (username.length < 3)    return res.json({ ok: false, error: 'Username min 3 characters' });
    const users = loadJSON(USERS_FILE, {});
    if (users[username])        return res.json({ ok: false, error: 'Username already taken' });
    users[username] = {
      username,
      password:     await bcrypt.hash(password, 10),
      displayName:  displayName || username,
      phone:        phone || '',
      bio:          bio   || 'Hey there! I am using NexChat',
      avatar:       '',
      favReactions: ['❤️','👍','😂','😮','😢','🙏'],
      createdAt:    Date.now()
    };
    saveJSON(USERS_FILE, users);
    req.session.username = username;
    req.session.save(() => res.json({ ok: true, user: sanitize(users[username]) }));
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = loadJSON(USERS_FILE, {});
    if (!users[username])                                          return res.json({ ok: false, error: 'User not found' });
    if (!await bcrypt.compare(password, users[username].password)) return res.json({ ok: false, error: 'Wrong password' });
    req.session.username = username;
    req.session.save(() => res.json({ ok: true, user: sanitize(users[username]) }));
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const u = loadJSON(USERS_FILE, {})[req.session.username];
  if (!u) return res.json({ ok: false });
  res.json({ ok: true, user: sanitize(u) });
});

// ── PROFILE ───────────────────────────────────────────────────
app.post('/api/profile/update', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const users = loadJSON(USERS_FILE, {});
  const u     = users[req.session.username];
  const { displayName, bio, phone } = req.body;
  if (displayName !== undefined) u.displayName = displayName;
  if (bio         !== undefined) u.bio         = bio;
  if (phone       !== undefined) u.phone       = phone;
  saveJSON(USERS_FILE, users);
  res.json({ ok: true, user: sanitize(u) });
});

app.post('/api/profile/password', async (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const users = loadJSON(USERS_FILE, {});
  const u     = users[req.session.username];
  if (!await bcrypt.compare(req.body.oldPassword, u.password)) return res.json({ ok: false, error: 'Wrong current password' });
  u.password = await bcrypt.hash(req.body.newPassword, 10);
  saveJSON(USERS_FILE, users);
  res.json({ ok: true });
});

app.post('/api/profile/avatar', (req, res) => {
  if (!req.session.username) return res.status(401).json({ ok: false, error: 'Not logged in' });
  uploadAvatar.single('avatar')(req, res, err => {
    if (err)       return res.json({ ok: false, error: 'Upload failed: ' + err.message });
    if (!req.file) return res.json({ ok: false, error: 'No file received' });
    const users = loadJSON(USERS_FILE, {});
    const u     = users[req.session.username];
    if (u.avatar) { try { fs.unlinkSync(path.join(__dirname, 'public', u.avatar)); } catch {} }
    u.avatar = '/avatars/' + req.file.filename;
    saveJSON(USERS_FILE, users);
    io.emit('user:avatarUpdate', { username: req.session.username, avatar: u.avatar });
    console.log('[Avatar]', req.session.username, u.avatar);
    res.json({ ok: true, avatar: u.avatar });
  });
});

app.post('/api/profile/reactions', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const users = loadJSON(USERS_FILE, {});
  users[req.session.username].favReactions = req.body.reactions;
  saveJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// ── CONTACTS ──────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const c = loadJSON(CONTACTS_FILE, {});
  res.json({ ok: true, contacts: c[req.session.username] || [] });
});

app.post('/api/contacts/add', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const { targetUsername, nickname } = req.body;
  const users    = loadJSON(USERS_FILE, {});
  if (!users[targetUsername]) return res.json({ ok: false, error: 'User not found' });
  const contacts = loadJSON(CONTACTS_FILE, {});
  if (!contacts[req.session.username]) contacts[req.session.username] = [];
  if (!contacts[req.session.username].find(c => c.username === targetUsername)) {
    contacts[req.session.username].push({
      username:  targetUsername,
      nickname:  nickname || users[targetUsername].displayName,
      addedAt:   Date.now()
    });
    saveJSON(CONTACTS_FILE, contacts);
  }
  res.json({ ok: true, contacts: contacts[req.session.username] });
});

app.post('/api/contacts/remove', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const contacts = loadJSON(CONTACTS_FILE, {});
  if (contacts[req.session.username])
    contacts[req.session.username] = contacts[req.session.username].filter(c => c.username !== req.body.targetUsername);
  saveJSON(CONTACTS_FILE, contacts);
  res.json({ ok: true });
});

app.get('/api/search', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json({ ok: true, results: [] });
  const users = loadJSON(USERS_FILE, {});
  res.json({
    ok: true,
    results: Object.values(users)
      .filter(u => u.username !== req.session.username && (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.phone && u.phone.includes(q))
      ))
      .map(sanitize)
  });
});

app.get('/api/user/:username', (req, res) => {
  const u = loadJSON(USERS_FILE, {})[req.params.username];
  if (!u) return res.json({ ok: false });
  res.json({ ok: true, user: sanitize(u) });
});

// ── MESSAGES ──────────────────────────────────────────────────
app.get('/api/messages/:peer', (req, res) => {
  if (!req.session.username) return res.json({ ok: false });
  const all = loadJSON(MESSAGES_FILE, {});
  res.json({ ok: true, messages: all[chatKey(req.session.username, req.params.peer)] || [] });
});

// ── MEDIA UPLOAD ──────────────────────────────────────────────
app.post('/api/upload', (req, res) => {
  if (!req.session.username) return res.status(401).json({ ok: false, error: 'Not logged in' });
  uploadMedia.array('files', 20)(req, res, err => {
    if (err) {
      console.error('[Upload error]', err.message);
      return res.json({ ok: false, error: err.message });
    }
    if (!req.files || !req.files.length) return res.json({ ok: false, error: 'No files received' });
    const files = req.files.map(f => ({
      url:  '/media/' + f.filename,
      name: f.originalname,
      type: f.mimetype,
      size: f.size
    }));
    console.log('[Upload]', req.session.username, 'uploaded', files.length, 'file(s)');
    res.json({ ok: true, files });
  });
});

// ── STATUS ────────────────────────────────────────────────────
app.get('/api/status/:username', (req, res) => {
  res.json({ online: isOnline(req.params.username), lastSeen: lastSeenMap.get(req.params.username) || null });
});

// ── SOCKET.IO ─────────────────────────────────────────────────
io.on('connection', socket => {
  let me = null;

  socket.on('user:online', username => {
    me = username;
    addSock(username, socket.id);
    lastSeenMap.set(username, Date.now());
    socket.join(username);
    io.emit('user:status', { username, online: true });
    console.log('[+]', username, socket.id);
  });

  socket.on('message:send', data => {
    if (!me) return;
    const all = loadJSON(MESSAGES_FILE, {});
    const key = chatKey(me, data.to);
    if (!all[key]) all[key] = [];
    const msg = {
      id:        Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      from:      me,
      to:        data.to,
      text:      data.text    || '',
      media:     data.media   || [],
      replyTo:   data.replyTo || null,
      timestamp: Date.now(),
      edited:    false,
      reactions: {},
      status:    isOnline(data.to) ? 'delivered' : 'sent'
    };
    all[key].push(msg);
    saveJSON(MESSAGES_FILE, all);
    io.to(me).emit('message:new', msg);
    if (isOnline(data.to)) io.to(data.to).emit('message:new', msg);
    console.log('[MSG]', me, '->', data.to, msg.text.slice(0, 40));
  });

  socket.on('message:seen', data => {
    if (!me) return;
    const all = loadJSON(MESSAGES_FILE, {});
    const key = chatKey(me, data.from);
    if (!all[key]) return;
    let changed = false;
    all[key].forEach(m => {
      if (m.from === data.from && m.status !== 'seen') {
        m.status = 'seen'; m.seenAt = Date.now(); changed = true;
        io.to(data.from).emit('message:statusUpdate', { id: m.id, status: 'seen', seenAt: m.seenAt });
      }
    });
    if (changed) saveJSON(MESSAGES_FILE, all);
  });

  socket.on('message:edit', data => {
    if (!me) return;
    const all = loadJSON(MESSAGES_FILE, {});
    const key = chatKey(me, data.peer);
    if (!all[key]) return;
    const msg = all[key].find(m => m.id === data.id && m.from === me);
    if (!msg) return;
    msg.text = data.text; msg.edited = true; msg.editedAt = Date.now();
    saveJSON(MESSAGES_FILE, all);
    io.to(me).emit('message:edited', msg);
    io.to(data.peer).emit('message:edited', msg);
  });

  socket.on('message:delete', data => {
    if (!me) return;
    const all = loadJSON(MESSAGES_FILE, {});
    const key = chatKey(me, data.peer);
    if (!all[key]) return;
    const idx = all[key].findIndex(m => m.id === data.id && m.from === me);
    if (idx < 0) return;
    all[key].splice(idx, 1);
    saveJSON(MESSAGES_FILE, all);
    io.to(me).emit('message:deleted', { id: data.id });
    io.to(data.peer).emit('message:deleted', { id: data.id });
  });

  socket.on('message:react', data => {
    if (!me) return;
    const all = loadJSON(MESSAGES_FILE, {});
    const key = chatKey(data.msgFrom, data.msgTo);
    if (!all[key]) return;
    const msg = all[key].find(m => m.id === data.id);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (msg.reactions[me] === data.emoji) delete msg.reactions[me];
    else msg.reactions[me] = data.emoji;
    saveJSON(MESSAGES_FILE, all);
    [data.msgFrom, data.msgTo].forEach(p => io.to(p).emit('message:reacted', { id: data.id, reactions: msg.reactions }));
  });

  socket.on('typing:start', data => { if (me) io.to(data.to).emit('typing:start', { from: me }); });
  socket.on('typing:stop',  data => { if (me) io.to(data.to).emit('typing:stop',  { from: me }); });

  socket.on('disconnect', () => {
    if (me) {
      removeSock(me, socket.id);
      lastSeenMap.set(me, Date.now());
      if (!isOnline(me)) {
        io.emit('user:status', { username: me, online: false, lastSeen: lastSeenMap.get(me) });
        console.log('[-]', me);
      }
    }
  });
});

// ── START SERVER ──────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, '0.0.0.0', async () => {
  let localIP = 'localhost';
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) { localIP = i.address; break; }

  let ngrokURL = '';
  if (NGROK_AUTHTOKEN && NGROK_AUTHTOKEN !== 'PASTE_YOUR_NGROK_AUTHTOKEN_HERE') {
    try {
      const ngrok = require('@ngrok/ngrok');
      const l     = await ngrok.forward({ addr: PORT, authtoken: NGROK_AUTHTOKEN });
      ngrokURL    = l.url();
      console.log('[Ngrok] Tunnel opened:', ngrokURL);
    } catch (e) {
      console.error('[Ngrok] Failed to open tunnel:');
      console.error(e); // full error printed so nothing is hidden
    }
  } else {
    console.log('[Ngrok] Skipped — no authtoken set. Paste your token on line 9 of server.js');
  }

  // Write config for frontend to read
  const cfg = { localIP: `http://${localIP}:${PORT}`, localhost: `http://localhost:${PORT}`, ngrok: ngrokURL };
  fs.writeFileSync(path.join(__dirname, 'public', 'server-info.json'), JSON.stringify(cfg));

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║         NexChat Server Started             ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Localhost : http://localhost:${PORT}           ║`);
  console.log(`║  WiFi IP   : http://${localIP}:${PORT}      ║`);
  console.log(`║  Ngrok     : ${ngrokURL || 'Not configured'}`.padEnd(45) + '║');
  console.log('╚════════════════════════════════════════════╝\n');
  console.log('All activity logged below:\n');
});