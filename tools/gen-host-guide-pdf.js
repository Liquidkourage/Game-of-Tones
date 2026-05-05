/**
 * Generates docs/Tempo-Host-First-Time-Guide.pdf using client dependency jspdf.
 * Run from repo root: node tools/gen-host-guide-pdf.js
 */
const fs = require('fs');
const path = require('path');

const { jsPDF } = require(path.join(__dirname, '..', 'client', 'node_modules', 'jspdf'));

const SECTIONS = [
  ['Hosting your first Tempo show',
    'Tempo is music bingo: players mark squares when they hear songs on their cards; you control playback from one computer (the host). These steps assume your product name is Tempo / Game of Tones.'],
  ['1. Open Tempo and your room',
    'Open Tempo in a browser on the laptop that will run the show. Use your host link or room code. Enter a host display name if asked — players see it.'],
  ['2. Connect your music (Connection)',
    'Use Connection in the header to link Spotify and/or YouTube Music, depending on your event. Stay connected before loading playlists. If you use Spotify for playback, you will pick a playback device (phone app open, speaker, etc.) when starting the game. Tip: connect at home on Wi‑Fi first.'],
  ['3. Load playlists into your mix',
    'In your library, select the playlists or catalog packs that belong to tonight’s game. Tempo builds a pool from those selections; you will lock it when you finalize the mix.'],
  ['4. Plan rounds (recommended)',
    'Open Round Planner or Round Manager. Create Round 1, Round 2, etc. Assign playlists to each round. Per round, set bingo pattern (line, full card, custom, …) and free center if you use it. You can skip rounds and use one big pool instead.'],
  ['5. Finalize the mix',
    'On the Game tab, click Finalize mix. Wait for confirmation — tracks finish loading and player boards are generated from the locked pool. Until finalize succeeds, treat the setup as draft.'],
  ['6. Save each round at home (optional, strong prep)',
    'After finalize, in Round Manager use Save round on each round. That stores a snapshot (frozen songs for that round, snippet length, random-start mode, layout hint) in this browser. Use Print PDF per round if you want paper cards. Snapshots live in this browser’s storage — use the same computer at the venue when possible.'],
  ['7. Pattern and playback (Game tab)',
    'Choose the bingo pattern. Set snippet length (seconds per clip). Set random starts if clips should not always begin at 0:00. Per-round settings apply when that round is current.'],
  ['8. Players join',
    'Share the player join link or room code. Guests open it on their phones, enter a name, and receive a bingo card. Put the Public Display on a projector or TV if you use it for the room.'],
  ['9. Start the game',
    'If you use rounds, in Round Manager Start the round you are about to play so it is current. Click Start Game. Tempo plays clips in order; the display shows what has played. If you saved rounds earlier and this round is current, playback can follow the saved snapshot order.'],
  ['10. During and after the show',
    'Use host controls to skip or pause as labeled. When someone calls Bingo, use verification if your flow shows it. End game when finished so playback and timers stop cleanly.'],
  ['Night-before checklist',
    'Connection works • Playlists selected • Mix finalized • Rounds saved (if used) and PDFs printed if wanted • Playback device tested • Player link and display link tested.'],
  ['If something goes wrong',
    'No tracks / finalize fails: reconnect music, refresh library, retry on stable Wi‑Fi. No sound: check Spotify device and volume. Wrong cards: only refinalize when you accept new random boards.'],
];

const outDir = path.join(__dirname, '..', 'docs');
const outFile = path.join(outDir, 'Tempo-Host-First-Time-Guide.pdf');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** U+2011 (non-breaking hyphen) makes jsPDF emit bad UTF-16-ish strings in WinAnsi mode → huge letter-spacing in viewers. */
function sanitizePdfText(s) {
  return s.replace(/\u2011/g, '-');
}

function main() {
  ensureDir(outDir);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 54;
  const maxW = pageW - 2 * margin;
  let y = margin;
  const titleSize = 16;
  const bodySize = 11;
  const titleLH = 22;
  const bodyLH = 14;
  const sectionGap = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titleSize);
  doc.text('Tempo — Host quick start', margin, y);
  y += titleLH + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(bodySize);
  const sub = doc.splitTextToSize('Step-by-step for first-time hosts. Generated from project tooling.', maxW);
  sub.forEach((line) => {
    doc.text(line, margin, y);
    y += bodyLH;
  });
  y += sectionGap;

  for (const [heading, body] of SECTIONS) {
    const safeHeading = sanitizePdfText(heading);
    const safeBody = sanitizePdfText(body);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const headLines = doc.splitTextToSize(safeHeading, maxW);
    for (const line of headLines) {
      if (y > pageH - margin - bodyLH * 3) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += titleLH - 2;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    const bodyLines = doc.splitTextToSize(safeBody, maxW);
    for (const line of bodyLines) {
      if (y > pageH - margin - bodyLH) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += bodyLH;
    }
    y += sectionGap;
  }

  doc.save(outFile);
  console.log('Wrote', outFile);
}

main();
