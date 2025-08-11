# 🎵 Spotify Integration Setup Guide

## Prerequisites
- Spotify Premium account (required for playback control)
- Node.js and npm installed

## Step 1: Create Spotify App

1. **Go to Spotify Developer Dashboard**
   - Visit: https://developer.spotify.com/dashboard
   - Log in with your Spotify account

2. **Create a New App**
   - Click "Create App"
   - Fill in the details:
     - **App name**: `Game of Tones`
     - **App description**: `Music bingo game with real-time playback`
     - **Website**: `http://127.0.0.1:3002`
     - **Redirect URI**: `http://127.0.0.1:3002/callback`
   - Accept the terms and click "Save"

3. **Get Your Credentials**
   - Copy your **Client ID** and **Client Secret**
   - You'll need these for the environment variables

## Step 2: Set Up Environment Variables

1. **Create `.env` file in the root directory**
   ```bash
   cp env.example .env
   ```

2. **Edit `.env` file with your credentials**
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   CLIENT_URL=http://localhost:3000

       # Spotify API Configuration
    SPOTIFY_CLIENT_ID=your_actual_client_id_here
    SPOTIFY_CLIENT_SECRET=your_actual_client_secret_here
    SPOTIFY_REDIRECT_URI=http://127.0.0.1:3002/callback
   ```

## Step 3: Start the Application

1. **Install dependencies** (if not already done)
   ```bash
   npm run install-all
   ```

2. **Start the development servers**
   ```bash
   npm run dev
   ```

3. **Open your browser**
   - Client: http://127.0.0.1:3002
   - Server: http://localhost:5000

## Step 4: Test Spotify Integration

1. **Navigate to Host View**
   - Go to: http://127.0.0.1:3002/host/test-room
   - Click "Connect Spotify"

2. **Authorize Spotify**
   - You'll be redirected to Spotify
   - Log in and authorize the app
   - You'll be redirected back to the callback page

3. **Test Playlist Loading**
   - After successful connection, your playlists should load
   - Select playlists for the game

4. **Test Playback**
   - Make sure Spotify is open on any device
   - Try playing a song from the host interface

## Features Available

### ✅ **What Works:**
- **Spotify OAuth** - Secure authorization flow
- **Playlist Loading** - Fetch user's playlists
- **Track Information** - Get song details and metadata
- **Playback Control** - Play, pause, skip songs
- **Device Management** - Control any Spotify device
- **Token Management** - Automatic token refresh

### 🎮 **Game Integration:**
- **Bingo Card Generation** - Create cards from selected playlists
- **Real-time Updates** - Live song information to players
- **Snippet Control** - Configurable song snippet length
- **Winner Detection** - Automatic bingo detection

## Troubleshooting

### Common Issues:

1. **"No Spotify devices found"**
   - Solution: Open Spotify on any device (phone, computer, etc.)
   - Make sure you're logged in to Spotify

2. **"Authorization failed"**
   - Check your Client ID and Secret in `.env`
   - Verify redirect URI matches exactly: `http://localhost:3000/callback`

3. **"Failed to get playlists"**
   - Ensure you have Spotify Premium
   - Check that your app has the correct scopes

4. **"Playback not working"**
   - Make sure Spotify is actively playing on a device
   - Try refreshing the page and reconnecting

### Debug Steps:

1. **Check server logs** for detailed error messages
2. **Verify environment variables** are loaded correctly
3. **Test API endpoints** directly:
   - `GET http://localhost:5000/api/spotify/auth`
   - `GET http://localhost:5000/api/spotify/playlists`

## API Endpoints

### Spotify Integration:
- `GET /api/spotify/auth` - Get authorization URL
- `GET /api/spotify/callback` - Handle OAuth callback
- `GET /api/spotify/playlists` - Get user's playlists
- `GET /api/spotify/playlists/:id/tracks` - Get playlist tracks
- `GET /api/spotify/devices` - Get user's devices
- `POST /api/spotify/play` - Start playback
- `POST /api/spotify/pause` - Pause playback
- `POST /api/spotify/next` - Skip to next track
- `GET /api/spotify/current` - Get current track

## Security Notes

- **Never commit your `.env` file** to version control
- **Keep your Client Secret secure** - it's like a password
- **Use HTTPS in production** for secure token exchange
- **Implement proper session management** for production use

## Next Steps

Once Spotify integration is working:

1. **Test the full game flow** with multiple players
2. **Add more game features** like different bingo patterns
3. **Implement proper error handling** and user feedback
4. **Add CSS styling** to make the interfaces look great
5. **Deploy to production** with proper environment setup

---

**🎵 Happy Gaming! 🎮**

Your Game of Tones is now ready to rock with real Spotify integration! 