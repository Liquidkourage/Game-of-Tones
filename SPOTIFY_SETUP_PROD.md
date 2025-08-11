Spotify Production Setup

1) Create a Spotify App (developer.spotify.com)
- Note the Client ID and Client Secret.

2) Set Redirect URIs
- Add: https://YOUR-CLIENT-DOMAIN/callback

3) Configure Railway server variables
- SPOTIFY_CLIENT_ID
- SPOTIFY_CLIENT_SECRET
- SPOTIFY_REDIRECT_URI = https://YOUR-CLIENT-DOMAIN/callback

4) Update CORS
- On the server, set CORS_ORIGINS = https://YOUR-CLIENT-DOMAIN

5) Test
- Deploy, open host page, click Connect Spotify, complete OAuth.


