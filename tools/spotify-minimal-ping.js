#!/usr/bin/env node
/**
 * Minimal Spotify Web API smoke test (no TEMPO server, no HostView, no quarantine).
 *
 * What it does:
 * 1) Optionally exchanges SPOTIFY_REFRESH_TOKEN for an access token (client id + secret).
 *    Or use SPOTIFY_ACCESS_TOKEN if you have a still-valid access token.
 * 2) GET /v1/me  (and optionally one playlists request) — prints status + Retry-After + small body.
 *
 * Use this to see whether Spotify is returning 200 vs 429 for your *developer app* + *user* token,
 * independent of the game server.
 *
 * From repo root (set env in shell or a local .env — do not commit secrets):
 *   node tools/spotify-minimal-ping.js
 *   node tools/spotify-minimal-ping.js --playlists
 *
 * Required (either):
 *   SPOTIFY_ACCESS_TOKEN=<access>   (skip refresh)
 * or:
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
 *   SPOTIFY_REFRESH_TOKEN=...      (user refresh token for this app)
 */
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv is optional; user can export env in shell
}

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com';

async function refreshAccessToken() {
  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  const refresh = (process.env.SPOTIFY_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refresh) {
    return null;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await fetch(ACCOUNTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  if (!r.ok) {
    console.error('Token refresh failed:', r.status, json);
    process.exit(1);
  }
  if (!json.access_token) {
    console.error('Token refresh: no access_token in response', json);
    process.exit(1);
  }
  return String(json.access_token);
}

async function spotifyGet(path, accessToken) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ra = r.headers.get('retry-after') || r.headers.get('Retry-After') || '';
  let bodyPreview = '';
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    if (j && j.error) {
      bodyPreview = JSON.stringify(
        { error: j.error, error_description: j.error_description, message: j.error?.message },
        null,
        0
      );
    } else {
      const id = j && j.id;
      const name = j && (j.display_name != null ? j.display_name : j.name);
      bodyPreview = JSON.stringify(
        { id, display_name: name, product: j.product, has_items: j.items != null },
        null,
        2
      );
    }
  } catch {
    bodyPreview = text.length > 200 ? text.slice(0, 200) + '…' : text;
  }
  return { path, status: r.status, retryAfter: ra, bodyPreview };
}

function main() {
  const wantPlaylists = process.argv.includes('--playlists');

  (async () => {
    let access = (process.env.SPOTIFY_ACCESS_TOKEN || '').trim();
    if (!access) {
      console.log('No SPOTIFY_ACCESS_TOKEN; refreshing via client id + secret + refresh token…\n');
      access = await refreshAccessToken();
    } else {
      console.log('Using SPOTIFY_ACCESS_TOKEN (no refresh).\n');
    }

    if (!access) {
      console.error(
        'Set SPOTIFY_ACCESS_TOKEN, or SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET + SPOTIFY_REFRESH_TOKEN'
      );
      process.exit(1);
    }

    const a = await spotifyGet('/v1/me', access);
    printLine('GET /v1/me', a);
    if (a.status === 200 && wantPlaylists) {
      const b = await spotifyGet('/v1/me/playlists?limit=1', access);
      printLine('GET /v1/me/playlists?limit=1', b);
    }

    if (wantPlaylists && a.status !== 200) {
      console.log('\n(--playlists skipped: /v1/me was not 200)\n');
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

function printLine(label, o) {
  const ra = o.retryAfter ? `  Retry-After: ${o.retryAfter}s` : '';
  console.log(`${label}`);
  console.log(`  status: ${o.status}${ra}`);
  console.log(`  body: ${o.bodyPreview}\n`);
}

main();
