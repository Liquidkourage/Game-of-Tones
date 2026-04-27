#!/usr/bin/env node
/**
 * Encrypt a Spotify client secret for `organizations.spotify_client_secret_encrypted`
 * (same as server/credentialCrypto — needs TEMPO_ORG_CREDENTIALS_KEY, 64 hex chars).
 *
 *   npm run encrypt-org-secret -- "plain_secret_from_dashboard"
 *   npx cross-env TEMPO_ORG_CREDENTIALS_KEY=abc... node tools/encrypt-spotify-org-secret.js
 *   (prompts if no argument)
 *   type secret.txt | node tools/encrypt-spotify-org-secret.js
 */

const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  /* optional */
}

const credentialCrypto = require(path.join(__dirname, '..', 'server', 'credentialCrypto'));

function run(plain) {
  if (!plain) {
    console.error('Empty secret.');
    process.exit(1);
  }
  try {
    const enc = credentialCrypto.encryptSecret(plain);
    process.stdout.write(`${enc}\n`);
  } catch (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  }
}

function main() {
  if (!credentialCrypto.isOrgCredentialsKeyConfigured()) {
    console.error('Set TEMPO_ORG_CREDENTIALS_KEY (64 hex characters), same as your server / Railway env.');
    process.exit(1);
  }

  let plain = process.argv.slice(2).join(' ').trim();

  if (!plain && !process.stdin.isTTY) {
    try {
      plain = fs.readFileSync(0, 'utf8').trim();
    } catch {
      /* ignore */
    }
  }

  if (plain) {
    run(plain);
    return;
  }

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  readline.question('Spotify client secret: ', (answer) => {
    readline.close();
    run((answer || '').trim());
  });
}

main();
