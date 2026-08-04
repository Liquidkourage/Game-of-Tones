import { jsPDF } from 'jspdf';
import {
  appendMultiRoundCallSheetsToDoc,
  type RoundCallSheetPdfOpts,
} from './printRoundCallSheetPdf';
import {
  appendMultiRoundPrintableCardsToDoc,
  appendPlayerPackPrintableCardsToDoc,
  normalizePrintableCardPacking,
  type PdfPageCursor,
  type PrintableCardPacking,
  type PrintablePdfSection,
} from './printableBingoPdf';

export type OfflineShowPackTrack = {
  id?: string;
  name?: string;
  artist?: string;
  youtubeMusic?: boolean;
  appleMusic?: boolean;
};

export type OfflineShowPackPlaylist = {
  id: string;
  name: string;
};

export type OfflineShowPackRound = {
  roundName: string;
  patternLabel?: string;
  prize?: string;
  mixGeometry?: string;
  playOrderLocked?: boolean;
  playlists: OfflineShowPackPlaylist[];
  tracks: OfflineShowPackTrack[];
};

export type OfflineShowPackPdfOpts = {
  roomLabel: string;
  rounds: OfflineShowPackRound[];
  callSections: RoundCallSheetPdfOpts[];
  cardSections: PrintablePdfSection[];
  /** by-round (default) or by-player (one sheet per player across all rounds). */
  cardPacking?: PrintableCardPacking;
};

const MARGIN = 48;
const BODY_LINE = 15;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const LEFTOVERS_ID = '__leftovers__';

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\u2011/g, '-')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .trim();
}

function pageWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

function pageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight();
}

function addPage(doc: jsPDF): number {
  doc.addPage();
  return MARGIN;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  return y + needed > pageHeight(doc) - MARGIN ? addPage(doc) : y;
}

function drawWrapped(
  doc: jsPDF,
  text: string,
  y: number,
  opts: {
    size?: number;
    style?: 'normal' | 'bold';
    color?: [number, number, number];
    indent?: number;
    gapAfter?: number;
  } = {},
): number {
  const x = MARGIN + (opts.indent ?? 0);
  const maxWidth = pageWidth(doc) - MARGIN - x;
  const size = opts.size ?? 10;
  const lineHeight = Math.max(BODY_LINE, size * 1.35);
  const lines = doc.splitTextToSize(clean(text), maxWidth) as string[];
  y = ensureSpace(doc, y, lines.length * lineHeight);
  doc.setFont('helvetica', opts.style ?? 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...(opts.color ?? [28, 28, 32]));
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y + (opts.gapAfter ?? 0);
}

function drawLink(doc: jsPDF, label: string, url: string, y: number, indent = 0): number {
  y = ensureSpace(doc, y, BODY_LINE);
  const x = MARGIN + indent;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(22, 92, 160);
  doc.textWithLink(clean(label), x, y, { url });
  return y + BODY_LINE;
}

function drawCover(doc: jsPDF, opts: OfflineShowPackPdfOpts): void {
  const centerX = pageWidth(doc) / 2;
  doc.setFillColor(20, 24, 32);
  doc.rect(0, 0, pageWidth(doc), pageHeight(doc), 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.text('TEMPO', centerX, 230, { align: 'center' });
  doc.setFontSize(24);
  doc.text('Offline Show Pack', centerX, 270, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.text(clean(opts.roomLabel), centerX, 310, { align: 'center' });
  doc.text(
    `${opts.rounds.length} saved round${opts.rounds.length === 1 ? '' : 's'}`,
    centerX,
    334,
    { align: 'center' },
  );
  doc.setFontSize(11);
  doc.setTextColor(205, 211, 220);
  doc.text('Prepared for zero-Wi-Fi play', centerX, 390, { align: 'center' });
}

function drawInstructions(doc: jsPDF): void {
  let y = addPage(doc);
  y = drawWrapped(doc, 'Run the show offline', y, { size: 22, style: 'bold', gapAfter: 12 });
  const steps = [
    'Before leaving Wi-Fi: open every Spotify playlist link in this pack and tap Download in the Spotify app.',
    'Print the bingo cards and host call sheets at the end of this pack.',
    'Use the large projector cue page for each round, or display that PDF page full-screen.',
    'Play from Spotify Offline mode or a prepared local audio library, following the numbered call sheet order.',
    'Mark each called song on paper. Verify winners against their printed card and the call sheet.',
  ];
  for (let index = 0; index < steps.length; index += 1) {
    y = drawWrapped(doc, `${index + 1}. ${steps[index]}`, y, { size: 11, gapAfter: 7 });
  }
  y += 12;
  y = drawWrapped(doc, 'Offline limits', y, { size: 15, style: 'bold', gapAfter: 7 });
  drawWrapped(
    doc,
    'Tempo live hosting, player phones, automatic calls, winner verification, and live projector updates require a network. This pack is the paper/static fallback: cards, call order, cues, and previously downloaded audio.',
    y,
    { size: 11 },
  );
}

function playlistLabel(round: OfflineShowPackRound): string {
  if (!round.playlists.length) return 'Local/offline library';
  return round.playlists.map((playlist) => clean(playlist.name) || clean(playlist.id)).join(', ');
}

function geometryLabel(round: OfflineShowPackRound): string {
  if (round.mixGeometry === '5x15') return '5 x 15 column mode - five playlists, one per card column';
  if (round.mixGeometry === '1x75') return '1 x 75 round mix - one playlist supplies the full pool';
  return 'Saved mixed pool';
}

function drawRunOfShow(doc: jsPDF, rounds: OfflineShowPackRound[]): void {
  addPage(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(28, 28, 32);
  doc.text('Run of show', MARGIN, MARGIN);
  const columnGap = 24;
  const columnWidth = (pageWidth(doc) - MARGIN * 2 - columnGap) / 2;
  const rowHeight = 108;
  const startY = 82;

  rounds.forEach((round, index) => {
    const column = index >= 6 ? 1 : 0;
    const row = index % 6;
    const x = MARGIN + column * (columnWidth + columnGap);
    let y = startY + row * rowHeight;
    const lines = (value: string, maxLines = 2) =>
      (doc.splitTextToSize(clean(value), columnWidth) as string[]).slice(0, maxLines);
    const write = (value: string, size: number, style: 'normal' | 'bold', maxLines = 2) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(28, 28, 32);
      const wrapped = lines(value, maxLines);
      doc.text(wrapped, x, y);
      y += wrapped.length * Math.max(11, size * 1.2);
    };

    write(`${index + 1}. ${round.roundName}`, 11, 'bold');
    write(`Pattern: ${round.patternLabel || 'Not specified'}`, 8.5, 'normal');
    write(`Prize: ${round.prize || 'Not specified'}`, 8.5, 'normal', 1);
    write(geometryLabel(round), 8.5, 'normal');
    write(`Playlist${round.playlists.length === 1 ? '' : 's'}: ${playlistLabel(round)}`, 8, 'normal');
  });
}

function drawProjectorCues(doc: jsPDF, rounds: OfflineShowPackRound[]): void {
  rounds.forEach((round, index) => {
    doc.addPage('letter', 'landscape');
    const centerX = pageWidth(doc) / 2;
    const pageH = pageHeight(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(20, 24, 32);
    doc.rect(0, 0, pageWidth(doc), pageH, 'F');
    doc.setTextColor(0, 255, 136);
    doc.setFontSize(18);
    doc.text(`ROUND ${index + 1}`, centerX, 105, { align: 'center' });
    const roundLines = doc.splitTextToSize(clean(round.roundName), pageWidth(doc) - 2 * MARGIN);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(30);
    doc.text(roundLines, centerX, 155, { align: 'center' });
    const patternY = 155 + roundLines.length * 38 + 25;
    doc.setTextColor(0, 255, 136);
    doc.setFontSize(22);
    const patternLines = doc.splitTextToSize(
      `Pattern: ${clean(round.patternLabel) || 'Not specified'}`,
      pageWidth(doc) - 2 * MARGIN,
    );
    doc.text(patternLines, centerX, patternY, {
      align: 'center',
    });
    const prizeLines = doc.splitTextToSize(
      `Prize: ${clean(round.prize) || 'Not specified'}`,
      pageWidth(doc) - 2 * MARGIN,
    );
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text(prizeLines, centerX, patternY + patternLines.length * 28 + 30, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(180, 184, 194);
    doc.text(geometryLabel(round), centerX, pageH - 58, { align: 'center' });
    doc.text('Static projector cue - advance to the next round manually', centerX, pageH - 38, {
      align: 'center',
    });
  });
}

function spotifyPlaylists(round: OfflineShowPackRound): OfflineShowPackPlaylist[] {
  return round.playlists.filter(
    (playlist) => playlist.id !== LEFTOVERS_ID && SPOTIFY_ID.test(playlist.id),
  );
}

function drawAudioChecklist(doc: jsPDF, rounds: OfflineShowPackRound[]): void {
  let y = addPage(doc);
  y = drawWrapped(doc, 'Offline audio checklist', y, { size: 22, style: 'bold', gapAfter: 8 });
  y = drawWrapped(
    doc,
    'Open each playlist in Spotify while online, tap Download, and confirm the green downloaded indicator before the show.',
    y,
    { size: 10, color: [72, 72, 78], gapAfter: 12 },
  );

  rounds.forEach((round, roundIndex) => {
    y = ensureSpace(doc, y, 100);
    y = drawWrapped(doc, `${roundIndex + 1}. ${round.roundName}`, y, {
      size: 15,
      style: 'bold',
      gapAfter: 5,
    });
    const spotify = spotifyPlaylists(round);
    for (const playlist of spotify) {
      const webUrl = `https://open.spotify.com/playlist/${playlist.id}`;
      y = drawWrapped(doc, `Playlist: ${playlist.name || playlist.id}`, y, {
        size: 10,
        style: 'bold',
        indent: 12,
      });
      y = drawLink(doc, webUrl, webUrl, y, 12);
      y = drawWrapped(doc, `Spotify app URI: spotify:playlist:${playlist.id}`, y, {
        size: 9,
        indent: 12,
        color: [72, 72, 78],
        gapAfter: 4,
      });
    }

    const hasLeftovers = round.playlists.some((playlist) => playlist.id === LEFTOVERS_ID);
    if (hasLeftovers) {
      y = drawWrapped(
        doc,
        'Leftovers: no Spotify playlist link. Use the call sheet order with tracks saved in your local/offline library.',
        y,
        { size: 10, indent: 12, gapAfter: 5 },
      );
    }

    if (!spotify.length && !hasLeftovers) {
      const firstSpotifyTrack = round.tracks.find(
        (track) => !track.youtubeMusic && !track.appleMusic && SPOTIFY_ID.test(clean(track.id)),
      );
      y = drawWrapped(
        doc,
        'No Spotify playlist link is available for this round. Prepare these tracks in your local/offline library.',
        y,
        { size: 10, indent: 12 },
      );
      if (firstSpotifyTrack?.id) {
        const trackUrl = `https://open.spotify.com/track/${firstSpotifyTrack.id}`;
        y = drawLink(doc, `First track: ${trackUrl}`, trackUrl, y, 12);
      }
    }

    y = drawWrapped(doc, 'Track order', y, { size: 10, style: 'bold', indent: 12, gapAfter: 2 });
    y = drawWrapped(
      doc,
      round.playOrderLocked
        ? 'Locked at Save round - matches the Start Game sequence.'
        : 'Legacy snapshot - save this round again before the show to lock the Start Game sequence.',
      y,
      { size: 8, indent: 12, color: [72, 72, 78], gapAfter: 4 },
    );
    round.tracks.forEach((track, trackIndex) => {
      y = drawWrapped(
        doc,
        `[  ] ${trackIndex + 1}. ${clean(track.artist) || '-'} - ${clean(track.name) || '-'}`,
        y,
        { size: 9, indent: 12, gapAfter: 2 },
      );
      const id = clean(track.id);
      if (id) {
        const source = track.youtubeMusic ? 'YouTube Music' : track.appleMusic ? 'Apple Music' : 'Spotify';
        const idLine = SPOTIFY_ID.test(id) && source === 'Spotify'
          ? `Spotify ID: ${id} | URI: spotify:track:${id}`
          : `${source} ID: ${id}`;
        y = drawWrapped(doc, idLine, y, {
          size: 8,
          indent: 24,
          color: [72, 72, 78],
          gapAfter: 2,
        });
      }
    });
    y += 10;
  });
}

/** Build one zero-Wi-Fi fallback PDF: guide, cues, audio links, call sheets, and cards. */
export async function buildOfflineShowPackPdfBlob(opts: OfflineShowPackPdfOpts): Promise<Blob> {
  if (!opts.rounds.length) {
    throw new Error('Nothing to export - save at least one round first.');
  }
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const cursor: PdfPageCursor = { pageStarted: true };
  drawCover(doc, opts);
  drawInstructions(doc);
  drawRunOfShow(doc, opts.rounds);
  drawAudioChecklist(doc, opts.rounds);
  appendMultiRoundCallSheetsToDoc(doc, opts.callSections, cursor);
  const packing = normalizePrintableCardPacking(opts.cardPacking);
  if (packing === 'by-player') {
    await appendPlayerPackPrintableCardsToDoc(doc, opts.cardSections, cursor);
  } else {
    await appendMultiRoundPrintableCardsToDoc(doc, opts.cardSections, cursor);
  }
  drawProjectorCues(doc, opts.rounds);
  return doc.output('blob');
}
