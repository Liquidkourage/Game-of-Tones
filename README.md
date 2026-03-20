# 🎵 Game of Tones

A modern, real-time music bingo game with Spotify integration. Where music meets bingo in a dark, nightlife-themed experience!

## ✨ Features

- **🎵 Spotify Premium Integration** - Connect your Spotify account and use your playlists
- **🎮 Real-time Multiplayer** - Live game updates with Socket.io
- **🎲 Smart Bingo Cards** - Automatic generation with your unique 5x15 or 1x75 playlist system
- **🎯 Configurable Snippets** - Adjustable song snippet length (15-60 seconds)
- **🏆 Real-time Winners** - Automatic bingo detection with manual host verification
- **📱 Responsive Design** - Works on desktop, tablet, and mobile
- **🌙 Dark Nightlife Theme** - Modern, high-energy UI with neon accents
- **📺 Public Display** - Dedicated screen for game information

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Spotify Premium account (for host)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd GameOfTones
   ```

2. **Install dependencies**
   ```bash
   npm run install-all
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Spotify API credentials:
   ```
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
   ```

4. **Start the development servers**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   - Client: http://localhost:3000
   - Server: http://localhost:5000

## 🎮 How to Play

### For Hosts

1. **Connect Spotify** - Link your Spotify Premium account
2. **Select Playlists** - Choose 5 playlists with 15+ songs each, or 1 playlist with 75+ songs
3. **Configure Settings** - Set snippet length and game options
4. **Start Game** - Begin the music bingo session
5. **Control Playback** - Play, pause, and skip songs
6. **Verify Winners** - Manually confirm bingo calls

### For Players

1. **Join Room** - Enter the room code provided by the host
2. **Get Your Card** - Receive a unique bingo card with songs from the selected playlists
3. **Listen & Mark** - Click on squares when you hear matching songs
4. **Call BINGO!** - Get 5 in a row to win!

### Game Modes

- **Traditional Bingo** - 5 in a row (horizontal, vertical, or diagonal)
- **Pattern Bingo** - Custom patterns (coming soon)
- **Blackout** - Complete the entire card (coming soon)

## 🛠️ Tech Stack

### Frontend
- **React 18** with TypeScript
- **Framer Motion** for animations
- **Lucide React** for icons
- **Socket.io Client** for real-time communication

### Backend
- **Node.js** with Express
- **Socket.io** for real-time features
- **Spotify Web API** for music integration
- **Helmet** for security

### Styling
- **CSS3** with custom properties
- **Dark nightlife theme** with neon accents
- **Responsive design** for all devices

## 📁 Project Structure

```
GameOfTones/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── App.tsx       # Main app component
│   │   └── App.css       # Global styles
│   └── package.json
├── server/                # Node.js backend
│   ├── index.js          # Main server file
│   ├── spotify.js        # Spotify integration
│   └── package.json
├── package.json           # Root package.json
└── README.md
```

## 🎯 Game Mechanics

### Card Generation System

**5x15 Mode:**
- Each column uses one playlist
- 5 songs randomly selected from each playlist
- 5 playlists required (15+ songs each)

**1x75 Mode:**
- Single playlist with 75+ songs
- 25 songs randomly selected for the card
- All columns use the same playlist

### Bingo Detection

- **Automatic Detection** - Real-time checking for valid bingo patterns
- **Manual Verification** - Host confirms winners to prevent false calls
- **Multiple Winners** - Support for multiple players calling bingo

## 🎨 Design Features

- **Dark Theme** - Easy on the eyes for extended gaming sessions
- **Neon Accents** - High-energy visual effects
- **Smooth Animations** - Framer Motion powered transitions
- **Responsive Layout** - Works on all screen sizes
- **Accessibility** - High contrast and keyboard navigation

## 🔧 Development

### Available Scripts

```bash
npm run dev          # Start both client and server
npm run server       # Start server only
npm run client       # Start client only
npm run build        # Build for production
npm run install-all  # Install all dependencies
```

### Environment Variables

```env
# Server Configuration
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000

# Spotify API
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
```

## 🚀 Deployment

### Railway (Recommended)

1. **Connect GitHub repository**
2. **Set environment variables**
3. **Deploy automatically**

### Manual Deployment

1. **Build the client**
   ```bash
   cd client && npm run build
   ```

2. **Start the server**
   ```bash
   npm start
   ```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🎵 Credits

- **Spotify Web API** for music integration
- **Framer Motion** for animations
- **Lucide** for beautiful icons
- **Socket.io** for real-time features

---

**Game of Tones** - Where Music Meets Bingo! 🎵🎮

## Dev speed

- **Typecheck only (fast):** `npm run client:typecheck` from repo root, or `cd client && npm run typecheck`.
- **Assistant conventions:** see [AGENTS.md](./AGENTS.md).
