import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Users, Gamepad2, Sparkles } from 'lucide-react';
import './App.css';

// Components
import Home from './components/Home';
import HostView from './components/HostView';
import PlayerView from './components/PlayerView';
import PublicDisplay from './components/PublicDisplay';
import SpotifyCallback from './components/SpotifyCallback';

function App() {
  return (
    <div className="App">
      <Router>
        <div className="app-container">
          {/* Header */}
          <motion.header 
            className="app-header"
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="header-content">
              <div className="logo">
                <Sparkles className="logo-icon" />
                <h1>Game of Tones</h1>
              </div>
              {/* icons removed on public display; kept on other routes if desired */}
            </div>
          </motion.header>

          {/* Main Content */}
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/host/:roomId" element={<HostView />} />
              <Route path="/player/:roomId" element={<PlayerView />} />
              <Route path="/display/:roomId" element={<PublicDisplay />} />
              <Route path="/callback" element={<SpotifyCallback />} />
            </Routes>
          </main>

          {/* Footer */}
          <motion.footer 
            className="app-footer"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          >
            <div className="footer-content">
              <p>🎵 Where Music Meets Bingo 🎵</p>
              <div className="footer-links">
                <a href="#" className="footer-link">About</a>
                <a href="#" className="footer-link">Help</a>
                <a href="#" className="footer-link">Contact</a>
              </div>
            </div>
          </motion.footer>
        </div>
      </Router>
    </div>
  );
}

export default App;
