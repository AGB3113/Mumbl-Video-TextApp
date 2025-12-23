# MUMBL Chat

A real-time messaging prototype featuring NFC-style friend exchange, stories, group chat, live location sharing, and WebRTC audio calling. Designed for quick prototyping and mobile testing via HTTPS tunnels (ngrok or similar).

## 🌐 Why HTTPS/Ngrok?
Several APIs require a **secure context (HTTPS)** to work on real devices:
- **WebRTC:** peer-to-peer audio calls
- **Geolocation:** live location sharing
- **Web NFC (where supported):** tap-to-add friends

Use `ngrok http 3000` (or similar) to expose your local server over HTTPS for realistic testing.

## 🚀 Setup
1. Install dependencies
   ```bash
   npm install
   ```
2. Run the server
   ```bash
   npm start
   ```
3. (Optional) Expose via ngrok for mobile testing
   ```bash
   ngrok http 3000
   ```
4. Open `http://localhost:3000` (or your ngrok HTTPS URL) in two tabs/devices to try chat, NFC tokens, location, and calls.

## 🧭 Feature Guide
- **Register**: choose a display name and join.
- **Add friends via NFC token**: generate a token (auto-copied), share it, and the other user claims it. Web NFC is used if available, otherwise you can paste the token.
- **Chat**: send direct messages to friends or join a group by ID and chat within it.
- **Same LAN picker**: refresh the "Same LAN devices" panel to target chat/calls or add friends who are on the same local network.
- **Stories**: post 24-hour text stories; friends receive them instantly.
- **Location sharing**: share your current coordinates with friends (requires geolocation permissions).
- **Calls**: start an audio call with a friend; signaling uses Socket.IO and media flows via WebRTC.

## 🛠️ Notes
- Data is in-memory only; restart clears users/stories.
- Web NFC support varies by platform; token entry fallback is provided.
- TURN is not configured; for production-grade calls, add a TURN server alongside the existing STUN config.
