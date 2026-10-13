#!/usr/bin/env node
/**
 * Regression guard: org shared-host-assets / shelf enrichment must never call Spotify
 * to fill zero track counts (Oct 2026 429 incident).
 *
 *   npm run check:spotify-shelf
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  failures.push(msg);
}

// 1) Banned symbol must stay gone.
const bannedNames = [
  'enrichPlaylistRefsWithSpotifyLookups',
  'zeroCountBatchHydrate',
  'hydrateOrgShelfFromSpotify',
];
const scanFiles = [
  'server/index.js',
  'server/orgHostSharedAssets.js',
  'client/src/components/HostView.tsx',
  'client/src/utils/orgSharedHostAssets.ts',
];
for (const rel of scanFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const text = read(rel);
  for (const name of bannedNames) {
    if (text.includes(name)) {
      fail(`${rel}: banned symbol "${name}" must not be reintroduced`);
    }
  }
}

// 2) shared-host-assets handlers must not touch live Spotify helpers.
const indexJs = read('server/index.js');
const getStart = indexJs.indexOf("app.get('/api/org/shared-host-assets'");
const putStart = indexJs.indexOf("app.put('/api/org/shared-host-assets'");
if (getStart < 0 || putStart < 0) {
  fail('server/index.js: missing /api/org/shared-host-assets GET or PUT handler');
} else {
  const getChunk = indexJs.slice(getStart, putStart);
  const afterPut = indexJs.slice(putStart);
  const putEndMatch = afterPut.search(/\napp\.(get|put|post|delete|patch)\(/);
  const putChunk = putEndMatch > 0 ? afterPut.slice(0, putEndMatch) : afterPut.slice(0, 2500);
  const forbiddenInShelf = [
    'spotifyForRequest',
    'getPlaylistMetadataBrief',
    'getUserPlaylists',
    'fetchHostPlaylistTracksForApi',
    'multiTenantSpotify.getService',
    'enrichPlaylistRefsWithSpotify',
  ];
  for (const chunk of [
    { name: 'GET /api/org/shared-host-assets', text: getChunk },
    { name: 'PUT /api/org/shared-host-assets', text: putChunk },
  ]) {
    for (const needle of forbiddenInShelf) {
      if (chunk.text.includes(needle)) {
        fail(`${chunk.name}: must not call/reference "${needle}" (DB/cache only)`);
      }
    }
  }
  if (!getChunk.includes('Do NOT probe Spotify')) {
    fail('GET /api/org/shared-host-assets: missing hard-ban comment ("Do NOT probe Spotify")');
  }
}

if (failures.length) {
  console.error('check:spotify-shelf FAILED — org shelf must never auto-hit Spotify:\n');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
console.log('check:spotify-shelf OK — org shelf enrichment stays DB/cache-only.');
