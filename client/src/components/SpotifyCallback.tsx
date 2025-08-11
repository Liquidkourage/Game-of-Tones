import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, CheckCircle, AlertCircle } from 'lucide-react';

const SpotifyCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting to Spotify...');

           useEffect(() => {
           console.log('SpotifyCallback component loaded');
           console.log('Current URL:', window.location.href);
           console.log('Search params:', Object.fromEntries(searchParams.entries()));
           
           const handleCallback = async () => {
             const code = searchParams.get('code');
             const error = searchParams.get('error');

             if (error) {
         setStatus('error');
         setMessage('Spotify authorization failed. Please try again.');
         
         // Get the return URL or default to home
         const returnUrl = localStorage.getItem('spotify_return_url') || '/';
         localStorage.removeItem('spotify_return_url'); // Clean up
         
         console.log('Spotify auth error, returning to:', returnUrl);
         setTimeout(() => {
           navigate(returnUrl);
         }, 3000);
         return;
       }

       if (!code) {
         setStatus('error');
         setMessage('No authorization code received.');
         
         // Get the return URL or default to home
         const returnUrl = localStorage.getItem('spotify_return_url') || '/';
         localStorage.removeItem('spotify_return_url'); // Clean up
         
         console.log('No auth code, returning to:', returnUrl);
         setTimeout(() => {
           navigate(returnUrl);
         }, 3000);
         return;
       }

                   try {
               const response = await fetch(`${API_BASE || ''}/api/spotify/callback?code=${code}`);
               const data = await response.json();

                 if (data.success) {
           setStatus('success');
           setMessage('Spotify connected successfully!');
           
           // Store tokens in localStorage for future use
           if (data.tokens) {
             localStorage.setItem('spotify_tokens', JSON.stringify(data.tokens));
           }
           
           // Get the return URL or default to home
           let returnUrl = localStorage.getItem('spotify_return_url') || '/';
           localStorage.removeItem('spotify_return_url'); // Clean up
           
           // If the return URL is just '/', try to detect if we should go to a host view
           if (returnUrl === '/') {
             // Check if there's a room ID in the URL or localStorage
             const urlParams = new URLSearchParams(window.location.search);
             const roomId = urlParams.get('roomId') || localStorage.getItem('spotify_room_id');
             if (roomId) {
               returnUrl = `/host/${roomId}`;
               localStorage.removeItem('spotify_room_id');
               console.log('Detected room ID, redirecting to host view:', returnUrl);
             }
           }
           
                       console.log('Spotify connected successfully, returning to:', returnUrl);
            console.log('Available localStorage keys:', Object.keys(localStorage));
            console.log('Retrieved return URL from localStorage:', returnUrl);
            console.log('All localStorage items:', Object.entries(localStorage));
            console.log('spotify_return_url from localStorage:', localStorage.getItem('spotify_return_url'));
            console.log('spotify_room_id from localStorage:', localStorage.getItem('spotify_room_id'));
           // REMOVED AUTOMATIC REDIRECT - Let user see the success screen
           // setTimeout(() => {
           //   navigate(returnUrl);
           // }, 2000);
         } else {
           setStatus('error');
           setMessage('Failed to connect to Spotify. Please try again.');
           
           // Get the return URL or default to home
           const returnUrl = localStorage.getItem('spotify_return_url') || '/';
           localStorage.removeItem('spotify_return_url'); // Clean up
           
           console.log('Spotify connection failed, returning to:', returnUrl);
           // REMOVED AUTOMATIC REDIRECT - Let user see the error screen
           // setTimeout(() => {
           //   navigate(returnUrl);
           // }, 3000);
         }
             } catch (error) {
         console.error('Error handling Spotify callback:', error);
         setStatus('error');
         setMessage('An error occurred while connecting to Spotify.');
         
         // Get the return URL or default to home
         const returnUrl = localStorage.getItem('spotify_return_url') || '/';
         localStorage.removeItem('spotify_return_url'); // Clean up
         
         console.log('Spotify callback error, returning to:', returnUrl);
         // REMOVED AUTOMATIC REDIRECT - Let user see the error screen
         // setTimeout(() => {
         //   navigate(returnUrl);
         // }, 3000);
       }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="spotify-callback">
      <motion.div 
        className="callback-container"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="callback-content">
          {status === 'loading' && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Music className="callback-icon loading" />
            </motion.div>
          )}
          
          {status === 'success' && (
            <CheckCircle className="callback-icon success" />
          )}
          
          {status === 'error' && (
            <AlertCircle className="callback-icon error" />
          )}
          
                     <h2>Spotify Connection</h2>
           <p>{message}</p>
           
           {status === 'success' && (
             <div className="success-actions">
               <button 
                 onClick={() => navigate('/')}
                 className="btn-primary"
               >
                 Go to Home
               </button>
               <button 
                 onClick={() => {
                   // Try to reconstruct the host URL from the current URL
                   const urlParams = new URLSearchParams(window.location.search);
                   const roomId = urlParams.get('roomId') || localStorage.getItem('spotify_room_id');
                   if (roomId) {
                     navigate(`/host/${roomId}`);
                   } else {
                     navigate('/');
                   }
                 }}
                 className="btn-secondary"
               >
                 Go to Host View
               </button>
             </div>
           )}
          
          {status === 'loading' && (
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SpotifyCallback; 