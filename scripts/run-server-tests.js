'use strict';

/**
 * Node 18's `node --test` does not expand globs (CI uses Node 18).
 * Passing `./server` would also load index.js. Collect *.test.js only.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collectTestFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) collectTestFiles(p, out);
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const serverRoot = path.join(__dirname, '..', 'server');
const files = collectTestFiles(serverRoot).sort();
if (!files.length) {
  console.error('No server/**/*.test.js files found');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
