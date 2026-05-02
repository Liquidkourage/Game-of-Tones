/**
 * Sample PDF for printable bingo layout QA — mirrors client/src/utils/printableBingoPdf.ts (light / ink-conscious).
 * Run from repo root: node tools/generate-sample-printable-bingo-pdf.js
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { jsPDF } = require(path.join(__dirname, '..', 'client', 'node_modules', 'jspdf'));

const PAGE = { r: 255, g: 255, b: 255 };
const INK = { r: 26, g: 26, b: 28 };
const INK_MUTED = { r: 72, g: 72, b: 76 };
const BORDER = { r: 100, g: 100, b: 105 };
const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const TITLE_LINE_FACTOR = 1.14;
const ARTIST_LINE_FACTOR = 1.12;

function gridFromSquares(squares) {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => null));
  for (const sq of squares) {
    const parts = String(sq.position || '').split('-');
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);
    if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || r > 4 || c < 0 || c > 4) continue;
    grid[r][c] = sq;
  }
  return grid;
}

function cellLabel(sq) {
  if (!sq) return { title: '', subtitle: '' };
  if (sq.isFreeSpace) return { title: 'FREE', subtitle: '' };
  const title = (sq.customSongName || sq.songName || '').trim() || '—';
  const subtitle = (sq.artistName || '').trim();
  return { title, subtitle };
}

function fitSongTextToCell(doc, title, subtitle, textW, maxH) {
  const gap = subtitle ? 5 : 0;
  const maxTitlePt = 14;
  const minTitlePt = 5;
  const maxTitleLines = 7;
  const maxArtistLines = 5;

  for (let titlePt = maxTitlePt; titlePt >= minTitlePt; titlePt--) {
    const artistPt = Math.max(5, Math.min(titlePt - 1, 12));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(titlePt);
    const titleLines = doc.splitTextToSize(title, textW).slice(0, maxTitleLines);
    const titleH = titleLines.length * titlePt * TITLE_LINE_FACTOR;

    let artistLines = [];
    let artistH = 0;
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(artistPt);
      artistLines = doc.splitTextToSize(subtitle, textW).slice(0, maxArtistLines);
      artistH = artistLines.length * artistPt * ARTIST_LINE_FACTOR;
    }

    const totalH = titleH + (subtitle ? gap + artistH : 0);
    if (totalH <= maxH && titleLines.length > 0) {
      return { titlePt, artistPt, titleLines, artistLines, totalH };
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(minTitlePt);
  const titleLines = doc.splitTextToSize(title, textW).slice(0, maxTitleLines);
  const artistPt = 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(artistPt);
  const artistLines = subtitle ? doc.splitTextToSize(subtitle, textW).slice(0, maxArtistLines) : [];
  const titleH = titleLines.length * minTitlePt * TITLE_LINE_FACTOR;
  const artistH = artistLines.length * artistPt * ARTIST_LINE_FACTOR;
  const totalH = titleH + (subtitle ? gap + artistH : 0);

  return { titlePt: minTitlePt, artistPt, titleLines, artistLines, totalH };
}

function drawSongCell(doc, x, y, cell, title, subtitle) {
  const pad = 5;
  const textW = Math.max(12, cell - pad * 2);
  const maxH = cell - pad * 2;
  const cx = x + cell / 2;

  const fit = fitSongTextToCell(doc, title, subtitle, textW, maxH);
  const blockTop = y + (cell - fit.totalH) / 2;
  let cursorY = blockTop + fit.titlePt * 0.72;

  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fit.titlePt);
  for (const line of fit.titleLines) {
    doc.text(line, cx, cursorY, { align: 'center' });
    cursorY += fit.titlePt * TITLE_LINE_FACTOR;
  }

  if (subtitle && fit.artistLines.length > 0) {
    cursorY += 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fit.artistPt);
    doc.setTextColor(INK_MUTED.r, INK_MUTED.g, INK_MUTED.b);
    for (const line of fit.artistLines) {
      doc.text(line, cx, cursorY, { align: 'center' });
      cursorY += fit.artistPt * ARTIST_LINE_FACTOR;
    }
  }
}

function renderPdf(cards) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const marginBottom = 40;

  const titleFontPt = 17;
  const titleBaseline = margin + 22;
  const bingoFontPt = 13;
  const bingoBaseline = titleBaseline + 28;
  const gridTop = bingoBaseline + 16;

  const availW = pageW - margin * 2;
  const availH = pageH - gridTop - marginBottom;
  const cell = Math.min(availW / 5, availH / 5);
  const gridW = cell * 5;
  const gridX = margin + (availW - gridW) / 2;

  for (let i = 0; i < cards.length; i++) {
    if (i > 0) doc.addPage();
    const card = cards[i];
    const grid = gridFromSquares(card.squares || []);

    doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
    doc.rect(0, 0, pageW, pageH, 'F');

    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(titleFontPt);
    doc.text('TEMPO — Music Bingo', pageW / 2, titleBaseline, { align: 'center' });

    doc.setFontSize(bingoFontPt);
    for (let c = 0; c < 5; c++) {
      const cx = gridX + c * cell + cell / 2;
      doc.text(BINGO_LETTERS[c], cx, bingoBaseline, { align: 'center' });
    }

    doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
    doc.setLineWidth(0.4);

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const x = gridX + c * cell;
        const y = gridTop + r * cell;
        const sq = grid[r][c];
        const { title, subtitle } = cellLabel(sq);

        doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
        doc.rect(x, y, cell, cell, 'FD');

        if (sq && sq.isFreeSpace) {
          doc.setTextColor(INK.r, INK.g, INK.b);
          doc.setFont('helvetica', 'bold');
          const freePt = Math.min(16, cell * 0.15);
          doc.setFontSize(freePt);
          doc.text('FREE', x + cell / 2, y + cell / 2 + freePt * 0.28, { align: 'center' });
        } else {
          drawSongCell(doc, x, y, cell, title, subtitle);
        }

        doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
        doc.rect(x, y, cell, cell, 'S');
      }
    }
  }

  return doc.output('arraybuffer');
}

function makeSampleSquares(seed) {
  const squares = [];
  const titles = [
    ['September', 'Earth, Wind & Fire'],
    ['In Da Club', '50 Cent'],
    ['Bohemian Rhapsody', 'Queen'],
    ['Walk This Way', 'Aerosmith ft. Run-DMC'],
    ['Money Maker', 'Ludacris ft. Pharrell'],
    ['More Than a Feeling', 'Boston'],
    ['Uptown Funk', 'Mark Ronson ft. Bruno Mars'],
    ['Hey Ya!', 'Outkast'],
    ['Sweet Caroline', 'Neil Diamond'],
    ['Livin’ on a Prayer', 'Bon Jovi'],
    ['Don’t Stop Believin’', 'Journey'],
    ['I Want It That Way', 'Backstreet Boys'],
    ['Yeah!', 'Usher ft. Lil Jon & Ludacris'],
    ['Crazy in Love', 'Beyoncé ft. Jay-Z'],
    ['Smooth', 'Santana ft. Rob Thomas'],
    ['All the Small Things', 'blink-182'],
    ['Come On Eileen', 'Dexys Midnight Runners'],
    ['Take On Me', 'a-ha'],
    ['Wake Me Up Before You Go-Go', 'Wham!'],
    ['This Very Long Song Title Is Here To Test Wrapping And Four Line Clamp Behavior', 'The Sample Artists'],
    ['Short', 'Min'],
    ['ABC', 'Jackson 5'],
    ['Le Freak', 'Chic'],
    ['Superstition', 'Stevie Wonder'],
    ['Good Vibrations', 'The Beach Boys'],
  ];
  let t = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (row === 2 && col === 2) {
        squares.push({ position: `${row}-${col}`, isFreeSpace: true });
        continue;
      }
      const pair = titles[(t + seed * 3) % titles.length];
      t++;
      squares.push({
        position: `${row}-${col}`,
        customSongName: pair[0],
        artistName: pair[1],
      });
    }
  }
  return squares;
}

const cards = [
  { squares: makeSampleSquares(0), printableIndex: 1 },
  { squares: makeSampleSquares(1), printableIndex: 2 },
];

const outDir = path.join(__dirname, 'sample-output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'tempo-printable-bingo-sample.pdf');
const buf = Buffer.from(renderPdf(cards));
fs.writeFileSync(outPath, buf);
console.log('Wrote', outPath);
