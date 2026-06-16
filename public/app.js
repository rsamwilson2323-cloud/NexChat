// ============================================================
//  NexChat — app.js
//  Full client-side logic
// ============================================================

const socket = io();
let ME = null;           // current logged-in user
let currentPeer = null;  // currently open chat username
let replyingTo = null;   // message being replied to
let contextMsgEl = null; // element that triggered context menu
let editingMsgId = null; // message being edited
let reactionTargetId = null; // message id for full reaction picker
let typingTimer = null;
let favReactions = ['❤️','👍','😂','😮','😢','🙏'];
let contactsCache = {};  // username -> contact info
let chatMessagesCache = {}; // peer -> messages[]
let onlineStatus = {};   // username -> {online, lastSeen}
let touchStartX = 0;

// ── API helpers ───────────────────────────────────────────────
async function api(path, data, method='POST') {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data) opts.body = JSON.stringify(data);
  const res = await fetch(path, opts);
  return res.json();
}
async function apiGet(path) {
  const res = await fetch(path);
  return res.json();
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const r = await apiGet('/api/me');
  if (r.ok) { ME = r.user; initApp(); }
  else { showAuth(); }

  // Load server links
  loadLinks();

  // Auth tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('loginForm').classList.toggle('hidden', which !== 'login');
      document.getElementById('registerForm').classList.toggle('hidden', which !== 'register');
    });
  });

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('registerBtn').addEventListener('click', doRegister);
  ['loginUsername','loginPassword','regUsername','regPassword'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') { id.startsWith('login') ? doLogin() : doRegister(); }});
  });
});

async function loadLinks() {
  try {
    // Get local IP from server
    const localIPEl = document.getElementById('localIPLink');
    const ngrokEl = document.getElementById('ngrokLink');
    if (localIPEl) {
      // Detect from current URL
      const host = window.location.hostname;
      const port = window.location.port || 3000;
      localIPEl.textContent = `http://${host}:${port}`;
    }
    // Try to load ngrok URL
    const nr = await fetch('/ngrok-url.txt').catch(()=>null);
    if (nr && nr.ok) {
      const url = await nr.text();
      if (ngrokEl && url.trim()) ngrokEl.textContent = url.trim();
      else if (ngrokEl) ngrokEl.textContent = 'Not configured (add NGROK_AUTHTOKEN to server.js)';
    } else if (ngrokEl) {
      ngrokEl.textContent = 'Not configured (add NGROK_AUTHTOKEN to server.js)';
    }
  } catch(e) {}
}

window.copyLink = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const orig = el.style.color;
    el.style.color = '#22c55e';
    setTimeout(() => el.style.color = orig, 1000);
  });
};

function showAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
}
function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
}

// ── AUTH ─────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) return setErr('loginError','Fill all fields');
  const r = await api('/api/login', {username, password});
  if (!r.ok) return setErr('loginError', r.error);
  ME = r.user;
  initApp();
}
async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const displayName = document.getElementById('regDisplayName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const bio = document.getElementById('regBio').value.trim();
  if (!username || !password) return setErr('regError','Username & password required');
  if (username.length < 3) return setErr('regError','Username must be 3+ chars');
  const r = await api('/api/register', {username, password, displayName, phone, bio});
  if (!r.ok) return setErr('regError', r.error);
  ME = r.user;
  initApp();
}
function setErr(id, msg) { document.getElementById(id).textContent = msg; }

// ── INIT APP ──────────────────────────────────────────────────
function initApp() {
  showApp();
  favReactions = ME.favReactions || ['❤️','👍','😂','😮','😢','🙏'];
  socket.emit('user:online', ME.username);
  loadSidebarAvatar();
  loadContacts();
  setupSocketListeners();
  setupUI();
  initEmojiPicker();
}

function loadSidebarAvatar() {
  const img = document.getElementById('myAvatarSidebar');
  img.src = ME.avatar || '/icons/default-avatar.svg';
}

// ── CONTACTS & CHAT LIST ──────────────────────────────────────
async function loadContacts() {
  const r = await apiGet('/api/contacts');
  if (!r.ok) return;
  contactsCache = {};
  r.contacts.forEach(c => { contactsCache[c.username] = c; });
  renderChatList();
}

function renderChatList(filter='') {
  const list = document.getElementById('chatList');
  list.innerHTML = '';
  const peers = Object.keys(contactsCache);
  const filtered = filter
    ? peers.filter(u => {
        const c = contactsCache[u];
        return u.toLowerCase().includes(filter) || (c.nickname||'').toLowerCase().includes(filter);
      })
    : peers;

  filtered.forEach(async username => {
    const contact = contactsCache[username];
    const msgs = chatMessagesCache[username] || [];
    const lastMsg = msgs[msgs.length-1];
    const item = document.createElement('div');
    item.className = 'chat-item' + (currentPeer===username?' active':'');
    item.dataset.peer = username;

    const online = onlineStatus[username]?.online;
    const timeStr = lastMsg ? formatTime(lastMsg.timestamp) : '';
    const preview = lastMsg ? (lastMsg.media?.length ? '📎 Media' : lastMsg.text) : '';

    // Fetch user info if not cached
    let userInfo = { displayName: contact.nickname || username, avatar: '' };
    apiGet(`/api/user/${username}`).then(r2 => {
      if (r2.ok) {
        contactsCache[username]._info = r2.user;
        // Update avatar
        const av = item.querySelector('.chat-item-avatar');
        if (av && r2.user.avatar) av.src = r2.user.avatar;
      }
    });

    item.innerHTML = `
      <div class="chat-item-avatar-wrap">
        <img class="chat-item-avatar${online?' online-border':''}" src="${contactsCache[username]._info?.avatar||'/icons/default-avatar.svg'}" alt="${username}"/>
        <div class="chat-item-online${online?' visible':''}"></div>
      </div>
      <div class="chat-item-info">
        <div class="chat-item-top">
          <span class="chat-item-name">${contact.nickname || username}</span>
          <span class="chat-item-time">${timeStr}</span>
        </div>
        <div class="chat-item-bottom">
          <span class="chat-item-preview">${escHtml(preview.slice?preview.slice(0,50):preview)}</span>
        </div>
      </div>`;
    item.addEventListener('click', () => openChat(username));
    list.appendChild(item);
  });
}

// ── OPEN CHAT ─────────────────────────────────────────────────
async function openChat(peer) {
  currentPeer = peer;
  replyingTo = null;
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatView').classList.remove('hidden');

  // Mobile
  document.getElementById('chatArea').classList.add('mobile-open');

  // Mark active
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.peer === peer);
  });

  // Set header
  const info = contactsCache[peer];
  const userInfo = info?._info;
  document.getElementById('peerName').textContent = info?.nickname || peer;
  document.getElementById('peerAvatar').src = userInfo?.avatar || '/icons/default-avatar.svg';
  updatePeerStatus(peer);

  // Load messages
  const r = await apiGet(`/api/messages/${peer}`);
  if (r.ok) {
    chatMessagesCache[peer] = r.messages;
    renderMessages(peer);
    markSeen(peer);
  }

  document.getElementById('msgInput').focus();
}

function updatePeerStatus(peer) {
  if (!peer) return;
  const status = onlineStatus[peer];
  const dot = document.getElementById('peerStatusDot');
  const sub = document.getElementById('peerStatus');
  if (status?.online) {
    dot.className = 'chat-header-status online';
    sub.textContent = 'online';
  } else {
    dot.className = 'chat-header-status';
    sub.textContent = status?.lastSeen ? 'last seen ' + formatTime(status.lastSeen) : 'offline';
  }
}

async function markSeen(peer) {
  socket.emit('message:seen', { from: peer });
}

// ── RENDER MESSAGES ───────────────────────────────────────────
function renderMessages(peer) {
  const list = document.getElementById('messagesList');
  list.innerHTML = '';
  const msgs = chatMessagesCache[peer] || [];
  msgs.forEach(msg => list.appendChild(buildMsgEl(msg)));
  scrollToBottom();
}

function buildMsgEl(msg) {
  const isSent = msg.from === ME.username;
  const wrap = document.createElement('div');
  wrap.className = `msg-block ${isSent?'sent':'recv'}`;
  wrap.dataset.id = msg.id;
  wrap.dataset.from = msg.from;
  wrap.dataset.to = msg.to;

  let replyHtml = '';
  if (msg.replyTo) {
    const orig = findMsg(msg.replyTo);
    const rname = orig ? (orig.from===ME.username?'You':contactsCache[orig.from]?.nickname||orig.from) : 'Unknown';
    const rtext = orig ? (orig.text || '📎 Media') : 'Deleted message';
    replyHtml = `<div class="msg-reply-quote">
      <div class="reply-quote-name">${escHtml(rname)}</div>
      <div class="reply-quote-text">${escHtml(rtext.slice(0,60))}</div>
    </div>`;
  }

  let mediaHtml = '';
  if (msg.media && msg.media.length) {
    mediaHtml = '<div class="msg-media">';
    msg.media.forEach(f => {
      if (f.type?.startsWith('image/')) {
        mediaHtml += `<img class="msg-img" src="${f.url}" loading="lazy" onclick="openLightbox('${f.url}')"/>`;
      } else if (f.type?.startsWith('video/')) {
        mediaHtml += `<video class="msg-video" src="${f.url}" controls></video>`;
      } else {
        const size = f.size ? ` · ${formatBytes(f.size)}` : '';
        mediaHtml += `<div class="msg-file" onclick="window.open('${f.url}')">
          <span class="msg-file-icon">📄</span>
          <div class="msg-file-info">
            <div class="msg-file-name">${escHtml(f.name||'File')}</div>
            <div class="msg-file-size">${size}</div>
          </div>
        </div>`;
      }
    });
    mediaHtml += '</div>';
  }

  const tickHtml = isSent ? `<span class="msg-ticks ${'ticks-'+msg.status}">${msg.status==='seen'?'✓✓':msg.status==='delivered'?'✓✓':'✓'}</span>` : '';
  const editedHtml = msg.edited ? `<span class="msg-edited">edited</span>` : '';

  // Reactions
  let reactHtml = '';
  if (msg.reactions && Object.keys(msg.reactions).length) {
    const grouped = {};
    Object.entries(msg.reactions).forEach(([user, emoji]) => {
      if (!grouped[emoji]) grouped[emoji] = [];
      grouped[emoji].push(user);
    });
    reactHtml = '<div class="msg-reactions">';
    Object.entries(grouped).forEach(([emoji, users]) => {
      const mine = users.includes(ME.username) ? ' mine' : '';
      reactHtml += `<div class="reaction-chip${mine}" data-emoji="${emoji}" data-msgid="${msg.id}" title="${users.join(', ')}" onclick="toggleReaction('${msg.id}','${emoji}','${msg.from}','${msg.to}')">
        ${emoji} <span class="reaction-count">${users.length}</span>
      </div>`;
    });
    reactHtml += '</div>';
  }

  wrap.innerHTML = `
    <span class="msg-swipe-indicator">↩</span>
    <div class="msg-bubble">
      ${replyHtml}${mediaHtml}
      ${msg.text ? `<span class="msg-text">${escHtml(msg.text)}</span>` : ''}
    </div>
    <div class="msg-meta">
      <span class="msg-time">${formatTime(msg.timestamp)}</span>
      ${editedHtml}
      ${tickHtml}
    </div>
    ${reactHtml}`;

  // Events
  const bubble = wrap.querySelector('.msg-bubble');

  // Right-click
  bubble.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e, wrap, msg); });

  // Long press (mobile)
  let lpTimer;
  bubble.addEventListener('touchstart', e => { lpTimer = setTimeout(() => showContextMenu(e.touches[0], wrap, msg), 500); }, {passive:true});
  bubble.addEventListener('touchend', () => clearTimeout(lpTimer));
  bubble.addEventListener('touchmove', () => clearTimeout(lpTimer));

  // Swipe to reply (touch)
  let swipeStartX = 0;
  wrap.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; }, {passive:true});
  wrap.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - swipeStartX;
    if (dx > 40 && !isSent) { wrap.classList.add('swiping'); }
    else if (dx < -40 && isSent) { wrap.classList.add('swiping'); }
    else { wrap.classList.remove('swiping'); }
  }, {passive:true});
  wrap.addEventListener('touchend', e => {
    if (wrap.classList.contains('swiping')) { setReply(msg); }
    wrap.classList.remove('swiping');
  });

  // Tick click for info
  const ticks = wrap.querySelector('.msg-ticks');
  if (ticks) ticks.addEventListener('click', e => { e.stopPropagation(); showMsgInfo(msg); });

  return wrap;
}

function findMsg(id) {
  if (!currentPeer) return null;
  return (chatMessagesCache[currentPeer]||[]).find(m=>m.id===id);
}

function scrollToBottom() {
  const area = document.getElementById('messagesArea');
  area.scrollTop = area.scrollHeight;
}

// ── SEND MESSAGE ──────────────────────────────────────────────
async function sendMessage() {
  const inputEl = document.getElementById('msgInput');
  const text = inputEl.innerText.trim();

  // Gather staged files
  const stagedFiles = window._stagedFiles || [];
  if (!text && !stagedFiles.length) return;

  let media = [];
  if (stagedFiles.length) {
    const formData = new FormData();
    stagedFiles.forEach(f => formData.append('files', f));
    const uploadRes = await fetch('/api/upload', { method:'POST', body:formData });
    const uploadData = await uploadRes.json();
    if (uploadData.ok) media = uploadData.files;
    window._stagedFiles = [];
  }

  const msgData = {
    to: currentPeer,
    text,
    media,
    replyTo: replyingTo?.id || null
  };

  socket.emit('message:send', msgData);

  inputEl.innerText = '';
  clearReply();
  stopTyping();
}

// ── SOCKET EVENTS ─────────────────────────────────────────────
function setupSocketListeners() {
  socket.on('message:new', msg => {
    const peer = msg.from === ME.username ? msg.to : msg.from;
    if (!chatMessagesCache[peer]) chatMessagesCache[peer] = [];
    // Avoid duplicates
    if (!chatMessagesCache[peer].find(m=>m.id===msg.id)) {
      chatMessagesCache[peer].push(msg);
    }
    if (currentPeer === peer) {
      const list = document.getElementById('messagesList');
      // Replace if exists else append
      const existing = list.querySelector(`[data-id="${msg.id}"]`);
      if (existing) existing.replaceWith(buildMsgEl(msg));
      else list.appendChild(buildMsgEl(msg));
      scrollToBottom();
      if (msg.from !== ME.username) markSeen(peer);
    }
    renderChatList();
  });

  socket.on('message:statusUpdate', ({id, status, seenAt, by}) => {
    // Update in cache
    Object.values(chatMessagesCache).forEach(msgs => {
      const m = msgs.find(m=>m.id===id);
      if (m) { m.status = status; if(seenAt) m.seenAt = seenAt; }
    });
    // Update DOM
    const msgEl = document.querySelector(`[data-id="${id}"]`);
    if (msgEl) {
      const ticks = msgEl.querySelector('.msg-ticks');
      if (ticks) {
        ticks.className = `msg-ticks ticks-${status}`;
        ticks.textContent = status==='seen'?'✓✓':status==='delivered'?'✓✓':'✓';
      }
    }
  });

  socket.on('message:edited', msg => {
    const peer = msg.from===ME.username?msg.to:msg.from;
    if (chatMessagesCache[peer]) {
      const idx = chatMessagesCache[peer].findIndex(m=>m.id===msg.id);
      if (idx>=0) chatMessagesCache[peer][idx] = msg;
    }
    const msgEl = document.querySelector(`[data-id="${msg.id}"]`);
    if (msgEl) msgEl.replaceWith(buildMsgEl(msg));
  });

  socket.on('message:deleted', ({id}) => {
    Object.values(chatMessagesCache).forEach(msgs => {
      const idx = msgs.findIndex(m=>m.id===id);
      if (idx>=0) msgs.splice(idx,1);
    });
    const msgEl = document.querySelector(`[data-id="${id}"]`);
    if (msgEl) msgEl.remove();
  });

  socket.on('message:reacted', ({id, reactions}) => {
    Object.values(chatMessagesCache).forEach(msgs => {
      const m = msgs.find(m=>m.id===id);
      if (m) m.reactions = reactions;
    });
    const msgEl = document.querySelector(`[data-id="${id}"]`);
    if (msgEl) {
      const msg = findMsg(id) || (chatMessagesCache[currentPeer]||[]).find(m=>m.id===id);
      if (msg) msgEl.replaceWith(buildMsgEl(msg));
    }
  });

  socket.on('user:status', ({username, online, lastSeen}) => {
    onlineStatus[username] = {online, lastSeen};
    if (currentPeer===username) updatePeerStatus(username);
    // Update chat list dot
    const item = document.querySelector(`.chat-item[data-peer="${username}"]`);
    if (item) {
      const av = item.querySelector('.chat-item-avatar');
      const dot = item.querySelector('.chat-item-online');
      if (av) av.className = `chat-item-avatar${online?' online-border':''}`;
      if (dot) dot.className = `chat-item-online${online?' visible':''}`;
    }
  });

  socket.on('typing:start', ({from}) => {
    if (from===currentPeer) showTyping();
  });
  socket.on('typing:stop', ({from}) => {
    if (from===currentPeer) hideTyping();
  });

  socket.on('user:avatarUpdate', ({username, avatar}) => {
    if (contactsCache[username]) {
      if (!contactsCache[username]._info) contactsCache[username]._info = {};
      contactsCache[username]._info.avatar = avatar;
    }
    // Update chat header if open
    if (currentPeer===username) {
      document.getElementById('peerAvatar').src = avatar;
    }
    // Update chat list
    const item = document.querySelector(`.chat-item[data-peer="${username}"] .chat-item-avatar`);
    if (item) item.src = avatar;
  });
}

// ── TYPING ────────────────────────────────────────────────────
let typingActive = false;
function onType() {
  if (!currentPeer) return;
  if (!typingActive) { typingActive=true; socket.emit('typing:start',{to:currentPeer}); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}
function stopTyping() {
  if (!currentPeer||!typingActive) return;
  typingActive=false;
  socket.emit('typing:stop',{to:currentPeer});
}

let typingEl = null;
function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement('div');
  typingEl.className='typing-indicator';
  typingEl.innerHTML=`<div class="typing-dots"><span></span><span></span><span></span></div> typing...`;
  document.getElementById('messagesList').appendChild(typingEl);
  scrollToBottom();
}
function hideTyping() {
  if (typingEl) { typingEl.remove(); typingEl=null; }
}

// ── CONTEXT MENU ──────────────────────────────────────────────
let ctxMsgData = null;
function showContextMenu(e, wrapEl, msg) {
  ctxMsgData = msg;
  contextMsgEl = wrapEl;

  const menu = document.getElementById('contextMenu');
  const reactions = document.getElementById('ctxReactions');

  // Build reactions row
  reactions.innerHTML = '';
  favReactions.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'ctx-emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', () => { toggleReaction(msg.id, emoji, msg.from, msg.to); closeContextMenu(); });
    reactions.appendChild(btn);
  });
  // + button
  const plus = document.createElement('button');
  plus.className = 'ctx-emoji plus';
  plus.textContent = '+';
  plus.addEventListener('click', () => { closeContextMenu(); openFullReactionPicker(msg); });
  reactions.appendChild(plus);

  // Hide edit if not my message
  const editBtn = menu.querySelector('[data-action="edit"]');
  editBtn.style.display = msg.from===ME.username ? '' : 'none';
  const deleteBtn = menu.querySelector('[data-action="delete"]');
  deleteBtn.style.display = msg.from===ME.username ? '' : 'none';

  // Position
  menu.classList.remove('hidden');
  const x = e.clientX || e.pageX || 100;
  const y = e.clientY || e.pageY || 100;
  let left = x, top = y;
  const mw = 200, mh = 200;
  if (left+mw > window.innerWidth) left = window.innerWidth-mw-8;
  if (top+mh > window.innerHeight) top = y-mh;
  menu.style.left = left+'px';
  menu.style.top = top+'px';
}
function closeContextMenu() {
  document.getElementById('contextMenu').classList.add('hidden');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#contextMenu')) closeContextMenu();
});

document.getElementById('contextMenu').addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !ctxMsgData) return;
  const msg = ctxMsgData;

  if (action==='reply') setReply(msg);
  if (action==='copy') navigator.clipboard.writeText(msg.text||'');
  if (action==='edit') openEditModal(msg);
  if (action==='info') showMsgInfo(msg);
  if (action==='delete') {
    socket.emit('message:delete', {id:msg.id, peer:currentPeer});
  }
  closeContextMenu();
});

// ── REPLY ─────────────────────────────────────────────────────
function setReply(msg) {
  replyingTo = msg;
  const preview = document.getElementById('replyPreview');
  const name = msg.from===ME.username?'You':(contactsCache[msg.from]?.nickname||msg.from);
  document.getElementById('replyName').textContent = name;
  document.getElementById('replyText').textContent = msg.text || (msg.media?.length?'📎 Media':'');
  preview.classList.remove('hidden');
  document.getElementById('msgInput').focus();
}
function clearReply() {
  replyingTo = null;
  document.getElementById('replyPreview').classList.add('hidden');
}

// ── EDIT ──────────────────────────────────────────────────────
function openEditModal(msg) {
  editingMsgId = msg.id;
  document.getElementById('editMsgInput').value = msg.text;
  document.getElementById('editMsgOverlay').classList.remove('hidden');
}

// ── MESSAGE INFO ──────────────────────────────────────────────
function showMsgInfo(msg) {
  const body = document.getElementById('msgInfoBody');
  const sent = formatFull(msg.timestamp);
  const seenAt = msg.seenAt ? formatFull(msg.seenAt) : '—';
  const status = msg.status || 'sent';
  const statusEmoji = status==='seen'?'👁️ Seen':status==='delivered'?'✓✓ Delivered':'✓ Sent';

  body.innerHTML = `
    <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusEmoji}</span></div>
    <div class="info-row"><span class="info-label">Sent</span><span class="info-val">${sent}</span></div>
    <div class="info-row"><span class="info-label">Seen at</span><span class="info-val">${seenAt}</span></div>
    ${msg.edited?`<div class="info-row"><span class="info-label">Edited</span><span class="info-val">${formatFull(msg.editedAt)}</span></div>`:''}
  `;
  document.getElementById('msgInfoOverlay').classList.remove('hidden');
}

// ── REACTIONS ────────────────────────────────────────────────
function toggleReaction(id, emoji, msgFrom, msgTo) {
  socket.emit('message:react', {id, emoji, msgFrom, msgTo});
}
function openFullReactionPicker(msg) {
  reactionTargetId = msg;
  const grid = document.getElementById('fullEmojiGrid');
  grid.innerHTML = '';
  window.ALL_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className='emoji-btn';
    btn.textContent=emoji;
    btn.addEventListener('click', () => {
      toggleReaction(msg.id, emoji, msg.from, msg.to);
      document.getElementById('reactionPickerOverlay').classList.add('hidden');
    });
    grid.appendChild(btn);
  });
  document.getElementById('reactionPickerOverlay').classList.remove('hidden');
}

// ── EMOJI PICKER ──────────────────────────────────────────────
function initEmojiPicker() {
  const cats = document.getElementById('emojiCats');
  const grid = document.getElementById('emojiGrid');
  cats.innerHTML = '';
  grid.innerHTML = '';

  let first = true;
  Object.entries(window.EMOJI_DATA).forEach(([label, emojis]) => {
    const catIcon = label.split(' ')[0];
    const btn = document.createElement('button');
    btn.className = 'emoji-cat-btn' + (first?' active':'');
    btn.textContent = catIcon;
    btn.title = label.split(' ').slice(1).join(' ');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-cat-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderEmojiGrid(emojis);
    });
    cats.appendChild(btn);
    if (first) { renderEmojiGrid(emojis); first=false; }
  });
}
function renderEmojiGrid(emojis) {
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className='emoji-btn';
    btn.textContent=emoji;
    btn.addEventListener('click', () => insertEmoji(emoji));
    grid.appendChild(btn);
  });
}
function insertEmoji(emoji) {
  const input = document.getElementById('msgInput');
  input.focus();
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(emoji));
    range.collapse(false);
  } else {
    input.textContent += emoji;
  }
}

// ── SETUP UI ──────────────────────────────────────────────────
function setupUI() {
  // Back button
  document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('chatArea').classList.remove('mobile-open');
    currentPeer = null;
    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('welcomeScreen').classList.remove('hidden');
  });

  // Send
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('msgInput').addEventListener('keydown', e => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    onType();
  });
  document.getElementById('msgInput').addEventListener('input', onType);

  // Emoji picker toggle
  document.getElementById('emojiOpenBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('emojiPicker').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#emojiPicker') && !e.target.closest('#emojiOpenBtn')) {
      document.getElementById('emojiPicker').classList.add('hidden');
    }
  });

  // File attach
  document.getElementById('attachBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    window._stagedFiles = Array.from(e.target.files);
    const names = window._stagedFiles.map(f=>f.name).join(', ');
    document.getElementById('msgInput').textContent = `[${window._stagedFiles.length} file(s): ${names}]`;
  });

  // Cancel reply
  document.getElementById('cancelReply').addEventListener('click', clearReply);

  // Profile panel
  document.getElementById('openProfile').addEventListener('click', openProfilePanel);
  document.getElementById('closeProfile').addEventListener('click', closeProfilePanel);
  document.getElementById('profileOverlay').addEventListener('click', closeProfilePanel);
  document.getElementById('saveProfile').addEventListener('click', saveProfile);
  document.getElementById('savePass').addEventListener('click', changePassword);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('avatarInput').addEventListener('change', uploadAvatar);
  document.getElementById('infoBtn').addEventListener('click', () => openContactInfo(currentPeer));

  // New chat
  document.getElementById('newChatBtn').addEventListener('click', () => {
    document.getElementById('newChatOverlay').classList.remove('hidden');
  });
  document.getElementById('closeNewChat').addEventListener('click', () => {
    document.getElementById('newChatOverlay').classList.add('hidden');
  });
  document.getElementById('newChatOverlay').addEventListener('click', e => {
    if (e.target===e.currentTarget) document.getElementById('newChatOverlay').classList.add('hidden');
  });
  document.getElementById('newChatSearch').addEventListener('input', searchUsers);

  // Search in sidebar
  document.getElementById('searchInput').addEventListener('input', e => {
    renderChatList(e.target.value.trim().toLowerCase());
  });

  // Contact panel close
  document.getElementById('closeContact').addEventListener('click', () => {
    document.getElementById('contactPanel').classList.add('hidden');
  });

  // Edit modal
  document.getElementById('confirmEdit').addEventListener('click', () => {
    if (!editingMsgId) return;
    const text = document.getElementById('editMsgInput').value.trim();
    if (!text) return;
    socket.emit('message:edit', {id:editingMsgId, peer:currentPeer, text});
    document.getElementById('editMsgOverlay').classList.add('hidden');
    editingMsgId = null;
  });
  document.getElementById('closeEditMsg').addEventListener('click', () => {
    document.getElementById('editMsgOverlay').classList.add('hidden');
  });

  // Msg info modal close
  document.getElementById('closeMsgInfo').addEventListener('click', () => {
    document.getElementById('msgInfoOverlay').classList.add('hidden');
  });

  // Reaction picker close
  document.getElementById('closeReactionPicker').addEventListener('click', () => {
    document.getElementById('reactionPickerOverlay').classList.add('hidden');
  });

  // Close modals on overlay click
  ['msgInfoOverlay','editMsgOverlay','reactionPickerOverlay'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', e => { if(e.target===el) el.classList.add('hidden'); });
  });

  // Paste images
  document.addEventListener('paste', e => {
    if (!currentPeer) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      window._stagedFiles = files;
      document.getElementById('msgInput').textContent = `[${files.length} image(s) pasted]`;
    }
  });
}

// ── PROFILE ───────────────────────────────────────────────────
function openProfilePanel() {
  document.getElementById('profileDisplayName').value = ME.displayName || '';
  document.getElementById('profileBio').value = ME.bio || '';
  document.getElementById('profilePhone').value = ME.phone || '';
  document.getElementById('profileAvatar').src = ME.avatar || '/icons/default-avatar.svg';
  renderFavReactionsEditor();
  document.getElementById('profileOverlay').classList.remove('hidden');
  document.getElementById('profilePanel').classList.remove('hidden');
}
function closeProfilePanel() {
  document.getElementById('profileOverlay').classList.add('hidden');
  document.getElementById('profilePanel').classList.add('hidden');
}
async function saveProfile() {
  const displayName = document.getElementById('profileDisplayName').value.trim();
  const bio = document.getElementById('profileBio').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const r = await api('/api/profile/update', {displayName, bio, phone});
  if (r.ok) { ME = r.user; loadSidebarAvatar(); closeProfilePanel(); }
}
async function changePassword() {
  const oldPass = document.getElementById('oldPass').value;
  const newPass = document.getElementById('newPass').value;
  if (!oldPass||!newPass) return alert('Fill both fields');
  const r = await api('/api/profile/password', {oldPassword:oldPass, newPassword:newPass});
  if (r.ok) { alert('Password updated!'); document.getElementById('oldPass').value=''; document.getElementById('newPass').value=''; }
  else alert(r.error||'Failed');
}
async function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('avatar', file);
  const res = await fetch('/api/profile/avatar', {method:'POST', body:fd});
  const data = await res.json();
  if (data.ok) {
    ME.avatar = data.avatar;
    document.getElementById('profileAvatar').src = data.avatar;
    document.getElementById('myAvatarSidebar').src = data.avatar;
  }
}
async function logout() {
  await api('/api/logout');
  ME = null; currentPeer = null;
  showAuth();
}

function renderFavReactionsEditor() {
  const wrap = document.getElementById('favReactionsEdit');
  wrap.innerHTML = '';
  for (let i=0;i<6;i++) {
    const slot = document.createElement('div');
    slot.className = 'fav-emoji-slot';
    slot.textContent = favReactions[i] || '+';
    const idx = i;
    slot.addEventListener('click', () => pickFavEmoji(idx, slot));
    wrap.appendChild(slot);
  }
}
function pickFavEmoji(idx, slotEl) {
  // Show a small emoji picker for this slot
  const emojiList = window.ALL_EMOJIS;
  const pop = document.createElement('div');
  pop.style.cssText = 'position:fixed;z-index:999;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:10px;display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-height:200px;overflow-y:auto;width:280px;';
  emojiList.forEach(emoji => {
    const btn = document.createElement('button');
    btn.style.cssText='border:none;background:transparent;font-size:20px;cursor:pointer;border-radius:6px;padding:4px;';
    btn.textContent=emoji;
    btn.addEventListener('click', async () => {
      favReactions[idx] = emoji;
      slotEl.textContent = emoji;
      pop.remove();
      await api('/api/profile/reactions', {reactions:favReactions});
      ME.favReactions = favReactions;
    });
    pop.appendChild(btn);
  });
  document.body.appendChild(pop);
  const rect = slotEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth-290) + 'px';
  pop.style.top = (rect.bottom+4)+'px';
  setTimeout(()=>document.addEventListener('click', function rem(e){if(!pop.contains(e.target)){pop.remove();document.removeEventListener('click',rem);}}, {once:false}),100);
}

// ── CONTACT INFO ──────────────────────────────────────────────
async function openContactInfo(peer) {
  if (!peer) return;
  const r = await apiGet(`/api/user/${peer}`);
  if (!r.ok) return;
  const u = r.user;
  const body = document.getElementById('contactInfoBody');
  body.innerHTML = `
    <div style="text-align:center;padding:16px 0;">
      <img class="contact-info-avatar" src="${u.avatar||'/icons/default-avatar.svg'}"/>
      <div class="contact-info-name" style="margin-top:12px;">${escHtml(u.displayName)}</div>
      <div class="contact-info-bio">${escHtml(u.bio||'')}</div>
    </div>
    <div class="contact-info-row">📞 <span>${escHtml(u.phone||'Not set')}</span></div>
    <div class="contact-info-row">👤 <span>@${escHtml(u.username)}</span></div>
    <div style="margin-top:16px;">
      <button class="btn-danger" onclick="removeContact('${peer}')">Remove Contact</button>
    </div>`;
  document.getElementById('contactPanel').classList.remove('hidden');
}
window.removeContact = async function(peer) {
  await api('/api/contacts/remove', {targetUsername:peer});
  delete contactsCache[peer];
  if (currentPeer===peer) {
    currentPeer = null;
    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('welcomeScreen').classList.remove('hidden');
  }
  document.getElementById('contactPanel').classList.add('hidden');
  renderChatList();
};

// ── SEARCH USERS ──────────────────────────────────────────────
let searchDebounce;
async function searchUsers() {
  const q = document.getElementById('newChatSearch').value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    if (!q) { document.getElementById('newChatResults').innerHTML=''; return; }
    const r = await apiGet(`/api/search?q=${encodeURIComponent(q)}`);
    const results = document.getElementById('newChatResults');
    results.innerHTML = '';
    if (!r.ok || !r.results.length) {
      results.innerHTML='<div style="padding:16px;color:var(--text3);text-align:center;">No users found</div>';
      return;
    }
    r.results.forEach(user => {
      const item = document.createElement('div');
      item.className='result-item';
      item.innerHTML=`
        <img class="result-avatar" src="${user.avatar||'/icons/default-avatar.svg'}"/>
        <div class="result-info">
          <div class="name">${escHtml(user.displayName)}</div>
          <div class="phone">@${escHtml(user.username)}${user.phone?' · '+escHtml(user.phone):''}</div>
        </div>`;
      item.addEventListener('click', async () => {
        // Add contact and open chat
        const r2 = await api('/api/contacts/add', {targetUsername:user.username, nickname:user.displayName});
        if (r2.ok) {
          contactsCache = {};
          r2.contacts.forEach(c => { contactsCache[c.username] = c; });
          renderChatList();
        }
        document.getElementById('newChatOverlay').classList.add('hidden');
        openChat(user.username);
      });
      results.appendChild(item);
    });
  }, 300);
}

// ── LIGHTBOX ──────────────────────────────────────────────────
window.openLightbox = function(url) {
  const lb = document.createElement('div');
  lb.className='lightbox';
  lb.innerHTML=`<img src="${url}"/>`;
  lb.addEventListener('click', ()=>lb.remove());
  document.body.appendChild(lb);
};

// ── UTILS ─────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString()===now.toDateString()) {
    return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
function formatFull(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {dateStyle:'medium', timeStyle:'short'});
}
function formatBytes(b) {
  if (b<1024) return b+'B';
  if (b<1024*1024) return (b/1024).toFixed(1)+'KB';
  return (b/(1024*1024)).toFixed(1)+'MB';
}

// Default avatar fallback
document.addEventListener('error', e => {
  if (e.target.tagName==='IMG') e.target.src='/icons/default-avatar.svg';
}, true);
