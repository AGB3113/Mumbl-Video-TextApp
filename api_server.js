const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const users = new Map(); // username -> { socketId, friends: Set<string>, netKey: string }
const nfcTokens = new Map(); // token -> username
const stories = []; // { id, author, content, createdAt }
const networks = new Map(); // netKey -> Set<username>

function networkKeyFromAddress(address) {
  if (!address) return 'unknown';
  const ipv4Match = address.match(/(\d+\.\d+\.\d+\.\d+)/);
  const ipv4 = ipv4Match ? ipv4Match[1] : null;
  if (ipv4) {
    const octets = ipv4.split('.');
    return octets.slice(0, 3).join('.');
  }
  return address;
}

function notifyLanPeers(netKey) {
  const peers = Array.from(networks.get(netKey) || []);
  peers.forEach((peer) => {
    const session = users.get(peer);
    if (session) {
      io.to(session.socketId).emit('lan:update', peers.filter((name) => name !== peer));
    }
  });
}

function pruneStories() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (let i = stories.length - 1; i >= 0; i -= 1) {
    if (stories[i].createdAt < cutoff) {
      stories.splice(i, 1);
    }
  }
}

function addFriends(userA, userB) {
  if (!users.has(userA) || !users.has(userB)) return;
  users.get(userA).friends.add(userB);
  users.get(userB).friends.add(userA);
  io.to(users.get(userA).socketId).emit('friends:update', Array.from(users.get(userA).friends));
  io.to(users.get(userB).socketId).emit('friends:update', Array.from(users.get(userB).friends));
}

function broadcastToFriends(username, event, payload) {
  const user = users.get(username);
  if (!user) return;
  user.friends.forEach((friend) => {
    const friendSession = users.get(friend);
    if (friendSession) {
      io.to(friendSession.socketId).emit(event, payload);
    }
  });
}

io.on('connection', (socket) => {
  let username;

  socket.on('register', (name, ack) => {
    if (typeof name !== 'string' || !name.trim()) {
      ack?.({ ok: false, message: 'A display name is required.' });
      return;
    }
    const normalized = name.trim().slice(0, 32);
    if (users.has(normalized)) {
      ack?.({ ok: false, message: 'Name already in use.' });
      return;
    }
    username = normalized;
    const netKey = networkKeyFromAddress(socket.handshake.address);
    users.set(username, { socketId: socket.id, friends: new Set(), netKey });
    if (!networks.has(netKey)) networks.set(netKey, new Set());
    networks.get(netKey).add(username);
    ack?.({ ok: true, username, friends: [] });
    socket.emit('stories:seed', stories.filter((story) => story.createdAt >= Date.now() - 24 * 60 * 60 * 1000));
    notifyLanPeers(netKey);
    console.log(`User registered: ${username}`);
  });

  socket.on('disconnect', () => {
    if (!username) return;
    const session = users.get(username);
    if (session) {
      const netKey = session.netKey;
      users.delete(username);
      networks.get(netKey)?.delete(username);
      if (networks.get(netKey)?.size === 0) networks.delete(netKey);
      notifyLanPeers(netKey);
    }
    console.log(`User disconnected: ${username}`);
  });

  socket.on('lan:list', (ack) => {
    if (!username) return;
    const netKey = users.get(username)?.netKey;
    const peers = netKey ? Array.from(networks.get(netKey) || []).filter((name) => name !== username) : [];
    ack?.({ ok: true, peers });
  });

  socket.on('nfc:token', (ack) => {
    if (!username) {
      ack?.({ ok: false, message: 'Register first.' });
      return;
    }
    const token = crypto.randomUUID();
    nfcTokens.set(token, { owner: username, createdAt: Date.now() });
    setTimeout(() => nfcTokens.delete(token), 5 * 60 * 1000);
    ack?.({ ok: true, token });
  });

  socket.on('nfc:claim', (token, ack) => {
    if (!username) {
      ack?.({ ok: false, message: 'Register first.' });
      return;
    }
    const info = nfcTokens.get(token);
    if (!info) {
      ack?.({ ok: false, message: 'Token not found or expired.' });
      return;
    }
    if (info.owner === username) {
      ack?.({ ok: false, message: 'Cannot add yourself.' });
      return;
    }
    addFriends(info.owner, username);
    nfcTokens.delete(token);
    ack?.({ ok: true, friend: info.owner });
  });

  socket.on('friends:add', (friendName, ack) => {
    if (!username) return;
    if (!users.has(friendName)) {
      ack?.({ ok: false, message: 'Friend is offline or not registered.' });
      return;
    }
    addFriends(username, friendName);
    ack?.({ ok: true, friend: friendName });
  });

  socket.on('message:send', ({ to, body, scope }) => {
    if (!username || !body) return;
    const safeBody = body.toString().slice(0, 500);
    if (scope === 'group') {
      socket.to(to).emit('message:receive', { from: username, body: safeBody, scope });
      socket.emit('message:receive', { from: username, body: safeBody, scope, local: true });
      return;
    }
    if (!users.has(to)) return;
    if (!users.get(username).friends.has(to)) return;
    io.to(users.get(to).socketId).emit('message:receive', { from: username, body: safeBody, scope: 'dm' });
    socket.emit('message:receive', { from: username, body: safeBody, scope: 'dm', local: true });
  });

  socket.on('group:join', ({ groupId, label }) => {
    if (!username || !groupId) return;
    socket.join(groupId);
    socket.emit('group:joined', { groupId, label });
  });

  socket.on('location:update', (payload) => {
    if (!username) return;
    const coords = {
      lat: Number(payload?.lat),
      lon: Number(payload?.lon),
      timestamp: Date.now(),
      sender: username,
    };
    broadcastToFriends(username, 'location:receive', coords);
  });

  socket.on('story:create', ({ content }, ack) => {
    if (!username) return;
    const trimmed = (content || '').toString().trim().slice(0, 240);
    if (!trimmed) {
      ack?.({ ok: false, message: 'Story content required.' });
      return;
    }
    pruneStories();
    const story = { id: crypto.randomUUID(), author: username, content: trimmed, createdAt: Date.now() };
    stories.push(story);
    broadcastToFriends(username, 'story:new', story);
    ack?.({ ok: true, story });
  });

  socket.on('call:signal', ({ target, data }) => {
    if (!username || !target) return;
    const friend = users.get(target);
    if (friend) {
      io.to(friend.socketId).emit('call:signal', { from: username, data });
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
