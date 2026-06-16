# 💬 NexChat
A modern and private WhatsApp-like Chat Application built with HTML, CSS, JavaScript, Node.js, and Socket.IO. Send messages, images, and videos instantly over your local WiFi or anywhere in the world via Ngrok — all data saved permanently on your own machine. No third-party servers. No subscriptions. Yours forever.

## ✨ Features
* 💬 Real-time messaging over WiFi and internet
* 🌐 Local IP + Ngrok link sharing for long-distance chat
* 🔐 Username and password login with bcrypt encryption
* 👤 Profile photo, display name, bio, and phone number
* 📁 Send images, videos, files — multiple at once
* ↩️ Reply to specific messages (swipe or right-click)
* ✏️ Edit and delete sent messages
* 😍 React to messages with emoji (customisable favourites)
* ✓ Sent / ✓✓ Delivered / 🔵 Seen message ticks
* 👁️ Message info — who saw it and exactly when
* ⌨️ Live typing indicator
* 🟢 Online / offline status with last seen time
* 🔍 Search contacts by name or phone number
* 📱 Mobile and desktop responsive UI
* 💾 All data saved permanently — works for life, not just runtime

## 📂 Project Structure
```text
NexChat/
│
├── server.js
├── package.json
├── START.bat
├── start.sh
├── README.md
│
├── data/
│   ├── users.json
│   ├── messages.json
│   ├── contacts.json
│   └── sessions/
│
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── emojis.js
    ├── media/
    ├── avatars/
    └── icons/
```

## 🚀 Getting Started

### Prerequisites
Install Node.js (v18 or higher) from:
```text
https://nodejs.org
```

### Clone the Repository
```bash
git clone https://github.com/rsamwilson2323-cloud/NexChat.git
```

### Run the Project

**Windows:**
```text
Double-click START.bat
```

**Mac / Linux:**
```bash
chmod +x start.sh
./start.sh
```

Then open your browser at:
```text
http://localhost:3000
```
Dependencies install automatically on first run.

## 🎮 How to Use
1. Open NexChat in your browser.
2. Create an account with a username and password.
3. Search for other users by name or phone number.
4. Add them as a contact and start chatting.
5. Send text, images, videos, or any files.
6. Right-click or long-press any message for reply, edit, delete, react, and info options.
7. Share your Local IP or Ngrok link so others can join.

## 🌐 Sharing with Others

### Same WiFi Network
Share the IP address shown in the app welcome screen:
```text
http://192.168.x.x:3000
```

### Long Distance (Internet)
1. Sign up free at https://ngrok.com
2. Copy your authtoken from the Ngrok dashboard
3. Open `server.js` and paste it on line 6:
```js
const NGROK_AUTHTOKEN = "your_token_here";
```
4. Restart the server — your public Ngrok URL appears instantly in the app.

## 🌟 Features Overview
* End-to-end local storage — your data never leaves your machine
* Multi-device support — open on phone and PC simultaneously
* Message reactions with 6 customisable favourite emojis
* Full emoji picker with categories
* Image lightbox viewer and video player
* Paste images directly into the chat input
* Permanent backup in the `data/` folder — copy it anywhere

## 🛠 Technologies Used
* HTML5
* CSS3
* JavaScript (ES6+)
* Node.js
* Express.js
* Socket.IO
* Multer
* Bcryptjs
* Ngrok

## 🎯 Use Cases
* Private family or friend group chat
* Offline LAN messaging at home or office
* Remote team communication via Ngrok
* Self-hosted alternative to WhatsApp
* JavaScript + Node.js learning project
* Portfolio demonstration

## 📄 License
This project is licensed under the MIT License.

## 👨‍💻 Author
**R. Sam Wilson**

GitHub: https://github.com/rsamwilson2323-cloud

---
💬 Chat privately, share freely, and own your data — a full-featured personal messenger that runs on your machine and lasts a lifetime.
