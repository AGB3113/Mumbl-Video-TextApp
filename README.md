# MUMBL Chat

A high-performance, real-time messaging application featuring glassmorphism UI, secure OTP verification, and WebRTC video calling.

## 🌐 The Role of ngrok in this Project
This application utilizes several modern Web APIs that require a **Secure Context (HTTPS)** to function:
1. **WebRTC:** For peer-to-peer video and audio calling.
2. **Push API:** For receiving notifications when the browser is closed.
3. **MediaDevices API:** For accessing the camera and microphone.

Since local development typically runs on `http://localhost`, **ngrok** is used to create a secure tunnel. This allows you to test these features on physical mobile devices by providing a public `https://` URL that tunnels directly to your local machine.

## 🚀 Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) installed.
- [ngrok](https://ngrok.com/) installed and authenticated.

### 2. Installation
```bash
npm install

4. Running the App
Start the Node server:
node api_server.js
Start the ngrok tunnel: In a new terminal window, run:
ngrok http 3000
Connect: Use the https://... URL provided by ngrok on your mobile device or desktop browser.
