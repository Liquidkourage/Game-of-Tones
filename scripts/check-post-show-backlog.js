#!/usr/bin/env node
/** Source-contract checks for Oct 19 post-show backlog. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pv = read('client/src/components/PlayerView.tsx');
const hv = read('client/src/components/HostView.tsx');
const app = read('client/src/App.tsx');
const pd = read('client/src/components/PublicDisplay.tsx');
const idx = read('server/index.js');
const patterns = read('client/src/patternDefinitions.ts');
const reqPanel = read('client/src/components/host/HostRequestsPanel.tsx');
const night = read('client/src/components/host/HostNightBoardPanel.tsx');

const checks = [
  [
    'bingo incomplete popup',
    pv.includes("You haven't completed the winning pattern yet") &&
      pv.includes('showIncompletePatternPopup'),
  ],
  [
    'bingo gate before emit',
    /if \(!card \|\| !checkVisualPattern\(card\)\)[\s\S]{0,200}showIncompletePatternPopup/.test(pv),
  ],
  ['Join hidden in active game', app.includes('inActiveGame') && app.includes('inActiveGame ? null')],
  [
    'letter empty sync guard',
    pd.includes('Empty server payload must not wipe letters'),
  ],
  ['custom empty mask client alert', hv.includes('no squares are saved')],
  [
    'custom empty mask server reject',
    idx.includes('custom pattern but no squares are saved') ||
      idx.includes('Custom pattern needs at least one square'),
  ],
  ['host-song-request socket', idx.includes("socket.on('host-song-request'")],
  ['request limit_reached', idx.includes('limit_reached') && idx.includes('maxSongRequestsPerPlayer')],
  ['host add UI', reqPanel.includes('Add a request') && reqPanel.includes('onHostAddRequest')],
  ['request cap UI', reqPanel.includes('Per-player limit') && reqPanel.includes('maxSongRequestsPerPlayer')],
  ['requests nav chip', hv.includes('host-sidebar__chip')],
  ['winnerName on EventRound / night board', hv.includes('winnerName') && night.includes('winnerName')],
  ['line progress helper', patterns.includes('formatLinePatternProgress')],
  ['mark flush delay 120ms', pv.includes('drainMarkSquareTelemetry, 120')],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) fail += 1;
}
process.exit(fail ? 1 : 0);
