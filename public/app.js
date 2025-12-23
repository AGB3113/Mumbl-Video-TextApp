const socket = io();
let currentUser = null;
let rtcPeer = null;
let callTarget = null;
let localStream;

const byId = (id) => document.getElementById(id);
const statusEl = byId('status');
const friendsEl = byId('friends');
const messagesEl = byId('messages');
const storyFeed = byId('story-feed');
const locationFeed = byId('location-feed');
const lanListEl = byId('lan-list');

function renderFriendList(friends) {
  friendsEl.innerHTML = '';
  friends.forEach((friend) => {
    const li = document.createElement('li');
    li.textContent = friend;
    friendsEl.appendChild(li);
  });
}

function renderLanPeers(peers) {
  lanListEl.innerHTML = '';
  if (!peers.length) {
    const li = document.createElement('li');
    li.textContent = 'No other devices detected yet.';
    lanListEl.appendChild(li);
    return;
  }
  peers.forEach((peer) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.innerHTML = `<strong>${peer}</strong>`;
    const actions = document.createElement('div');
    actions.className = 'row';

    const setChat = document.createElement('button');
    setChat.textContent = 'Target chat';
    setChat.addEventListener('click', () => {
      byId('chat-target').value = peer;
      setStatus(`Chat target set to ${peer}`);
    });

    const setCall = document.createElement('button');
    setCall.textContent = 'Target call';
    setCall.addEventListener('click', () => {
      byId('call-target').value = peer;
      setStatus(`Call target set to ${peer}`);
    });

    const addFriend = document.createElement('button');
    addFriend.textContent = 'Add friend';
    addFriend.addEventListener('click', () => {
      socket.emit('friends:add', peer, (resp) => setStatus(resp.ok ? `Added ${peer}` : resp.message));
    });

    actions.append(setChat, setCall, addFriend);
    li.append(title, actions);
    lanListEl.appendChild(li);
  });
}

function addMessage({ from, body, scope, local }) {
  const div = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `<strong>${scope === 'group' ? `[${scope}] ` : ''}${from}${local ? ' (me)' : ''}</strong><br/>${body}<small>${new Date().toLocaleTimeString()}</small>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addStory(story) {
  const li = document.createElement('li');
  li.textContent = `${story.author}: ${story.content}`;
  storyFeed.prepend(li);
}

function addLocationUpdate(coords) {
  const li = document.createElement('li');
  li.textContent = `${coords.sender}: ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)} @ ${new Date(coords.timestamp).toLocaleTimeString()}`;
  locationFeed.prepend(li);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function refreshLanPeers() {
  socket.emit('lan:list', (resp) => {
    if (resp?.ok) {
      renderLanPeers(resp.peers);
    }
  });
}

byId('register').addEventListener('click', () => {
  const name = byId('name').value;
  socket.emit('register', name, (resp) => {
    if (resp.ok) {
      currentUser = resp.username;
      renderFriendList(resp.friends);
      setStatus(`Online as ${resp.username}`);
      refreshLanPeers();
    } else {
      setStatus(resp.message || 'Failed to join');
    }
  });
});

byId('nfc-generate').addEventListener('click', () => {
  socket.emit('nfc:token', (resp) => {
    if (!resp.ok) {
      setStatus(resp.message);
      return;
    }
    navigator.clipboard?.writeText(resp.token);
    alert(`NFC token ready: ${resp.token}\n(share or tap to add)`);
  });
});

byId('nfc-claim').addEventListener('click', async () => {
  if ('NDEFReader' in window) {
    try {
      const reader = new NDEFReader();
      await reader.scan();
      reader.onreading = (event) => {
        const record = event.message.records[0];
        const text = record ? new TextDecoder().decode(record.data) : '';
        socket.emit('nfc:claim', text, handleClaimResponse);
      };
      return;
    } catch (err) {
      console.warn('Web NFC fallback', err);
    }
  }
  const token = prompt('Enter token');
  if (token) socket.emit('nfc:claim', token, handleClaimResponse);
});

byId('refresh-lan').addEventListener('click', () => refreshLanPeers());

function handleClaimResponse(resp) {
  if (resp.ok) {
    setStatus(`Added ${resp.friend}`);
  } else {
    setStatus(resp.message);
  }
}

byId('send-chat').addEventListener('click', () => {
  const to = byId('chat-target').value.trim();
  const body = byId('chat-body').value;
  const scope = byId('chat-scope').value;
  socket.emit('message:send', { to, body, scope });
  byId('chat-body').value = '';
});

byId('join-group').addEventListener('click', () => {
  const groupId = byId('chat-target').value.trim();
  if (!groupId) return;
  socket.emit('group:join', { groupId, label: groupId });
  setStatus(`Joined group ${groupId}`);
});

byId('post-story').addEventListener('click', () => {
  const content = byId('story-body').value;
  socket.emit('story:create', { content }, (resp) => {
    if (resp.ok) {
      addStory(resp.story);
      byId('story-body').value = '';
    } else {
      setStatus(resp.message);
    }
  });
});

byId('share-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Geolocation unsupported');
    return;
  }
  navigator.geolocation.getCurrentPosition((pos) => {
    socket.emit('location:update', { lat: pos.coords.latitude, lon: pos.coords.longitude });
  });
});

socket.on('friends:update', (friends) => renderFriendList(friends));
socket.on('message:receive', addMessage);
socket.on('story:new', addStory);
socket.on('stories:seed', (stories) => stories.forEach(addStory));
socket.on('location:receive', addLocationUpdate);
socket.on('lan:update', (peers) => renderLanPeers(peers));

// Simple WebRTC handling
const callState = byId('call-state');
const hangupBtn = byId('hangup');

async function startCall() {
  callTarget = byId('call-target').value.trim();
  if (!callTarget) return;
  await setupPeer(true);
  callState.textContent = `Calling ${callTarget}...`;
}

async function setupPeer(isCaller) {
  rtcPeer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  hangupBtn.disabled = false;

  rtcPeer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('call:signal', { target: callTarget, data: { candidate: event.candidate } });
    }
  };

  rtcPeer.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.play();
  };

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localStream.getTracks().forEach((track) => rtcPeer.addTrack(track, localStream));

  if (isCaller) {
    const offer = await rtcPeer.createOffer();
    await rtcPeer.setLocalDescription(offer);
    socket.emit('call:signal', { target: callTarget, data: { offer } });
  }
}

socket.on('call:signal', async ({ from, data }) => {
  callTarget = from;
  if (data.offer) {
    await setupPeer(false);
    await rtcPeer.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await rtcPeer.createAnswer();
    await rtcPeer.setLocalDescription(answer);
    socket.emit('call:signal', { target: from, data: { answer } });
    callState.textContent = `In call with ${from}`;
  } else if (data.answer) {
    await rtcPeer.setRemoteDescription(new RTCSessionDescription(data.answer));
    callState.textContent = `In call with ${from}`;
  } else if (data.candidate) {
    await rtcPeer.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

function endCall() {
  if (rtcPeer) {
    rtcPeer.getSenders().forEach((s) => s.track?.stop());
    rtcPeer.close();
    rtcPeer = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  hangupBtn.disabled = true;
  callState.textContent = 'Idle';
}

byId('start-call').addEventListener('click', startCall);
hangupBtn.addEventListener('click', endCall);
