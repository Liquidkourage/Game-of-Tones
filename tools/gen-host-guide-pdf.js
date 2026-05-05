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
    'Use Connection in the header to link Spotify and/or YouTube Music, depending on your event. Stay connected before loading playlists. If you use Spotify for playback, you will pick a playback device (phone app open, speaker, etc.) when starting the game. Tip: connect at home on Wi-Fi first.'],
  ['3. Load playlists into your mix',
    'In your library, select the playlists or catalog packs that belong to tonight’s game. Tempo builds a pool from those selections; you will lock it when you finalize the mix.'],
  ['4. Plan rounds (recommended)',
    'On the Manager tab under Music & rounds, use Round buckets: create rounds and drag playlists into each bucket. Load for prep puts that round into the mix target so Bingo Pattern and snippet controls apply to it without starting the live round. Start round is for showtime handoff (marks active and opens Game). Open Round prep & PDF under Round & event when you need Save round / Print PDF from one place. You can skip buckets and use one big pool instead.'],
  ['5. Finalize the mix',
    'On the Game tab, click Finalize mix. Wait for confirmation — tracks finish loading and player boards are generated from the locked pool. Until finalize succeeds, treat the setup as draft.'],
  ['6. Save each round at home (optional, strong prep)',
    'For each round: tap Load for prep (bucket or Round prep panel), set pattern / snippet / random-start as you want, then Save round (finalizes if needed). That stores a snapshot (frozen songs for that round, snippet length, random-start mode, layout hint) in this browser. Use Print PDF per round for paper cards. You do not need Start round just to save or print in advance. Snapshots live in this browser — use the same computer at the venue when possible.'],
  ['7. Pattern and playback',
    'On Manager, after Load for prep on a round, edit Bingo Pattern (line, full card, custom, …), free center, snippet length, and random starts; changes attach to that round. On Game you can adjust playback settings again before Start Game.'],
  ['8. Players join',
    'Share the player join link or room code. Guests open it on their phones, enter a name, and receive a bingo card. Put the Public Display on a projector or TV if you use it for the room.'],
  ['9. Start the game',
    'When it is showtime, Load for prep or Start round so the correct round is current and playlists match the mix. Click Start Game. Tempo plays clips in order; the display shows what has played. If you saved a snapshot for the current round, playback can follow that frozen order.'],
  ['10. During and after the show',
    'Use host controls to skip or pause as labeled. When someone calls Bingo, use verification if your flow shows it. End game when finished so playback and timers stop cleanly.'],
  ['Night-before checklist',
    'Connection works • Playlists selected • Mix finalized • Rounds saved (if used) and PDFs printed if wanted • Playback device tested • Player link and display link tested.'],
  ['If something goes wrong',
    'No tracks / finalize fails: reconnect music, refresh library, retry on stable Wi-Fi. No sound: check Spotify device and volume. Wrong cards: only refinalize when you accept new random boards.'],
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
