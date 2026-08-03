import { jsPDF } from 'jspdf';

export type CallSheetTrack = {
  name?: string;
  artist?: string;
};

/** Avoid WinAnsi quirks in jsPDF (same issue as host guide generator). */
function sanitizePdfText(s: string): string {
  return s.replace(/\u2011/g, '-');
}

export type RoundCallSheetPdfOpts = {
  roundName: string;
  roomLabel: string;
  /** Winning pattern for this saved round (shown under the round name). */
  patternLabel?: string;
  /** Optional prize for the round (shown beside the winning pattern). */
  prize?: string;
  tracks: CallSheetTrack[];
};

const MARGIN = 48;
const TITLE_PT = 16;
const SUB_PT = 11;
const BODY_PT = 10;
const ROUND_PT = 13;
const TITLE_LH = 22;
const BODY_LH = 14;

type CallSheetDocState = {
  doc: jsPDF;
  y: number;
  maxW: number;
  pageH: number;
};

function createCallSheetDocState(doc: jsPDF): CallSheetDocState {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  return { doc, y: MARGIN, maxW: pageW - 2 * MARGIN, pageH };
}

function ensureSpace(state: CallSheetDocState, need: number) {
  if (state.y + need > state.pageH - MARGIN) {
    state.doc.addPage();
    state.y = MARGIN;
  }
}

function drawWrapped(
  state: CallSheetDocState,
  lines: string[],
  font: 'helvetica',
  style: 'normal' | 'bold',
  size: number,
  color: [number, number, number],
) {
  state.doc.setFont(font, style);
  state.doc.setFontSize(size);
  state.doc.setTextColor(...color);
  lines.forEach((ln) => {
    ensureSpace(state, BODY_LH);
    state.doc.text(ln, MARGIN, state.y);
    state.y += BODY_LH;
  });
}

function drawPlaybackHint(state: CallSheetDocState) {
  const hint = state.doc.splitTextToSize(
    sanitizePdfText(
      "Playback order from each round's Save round snapshot (same sequence as Start Game when a snapshot exists).",
    ),
    state.maxW,
  );
  drawWrapped(state, hint, 'helvetica', 'normal', BODY_PT - 1, [90, 90, 95]);
  state.y += 10;
}

function drawTrackList(state: CallSheetDocState, tracks: CallSheetTrack[]) {
  state.doc.setFontSize(BODY_PT);
  state.doc.setTextColor(26, 26, 28);
  tracks.forEach((t, i) => {
    const artist = sanitizePdfText(String(t.artist || '').trim() || '—');
    const name = sanitizePdfText(String(t.name || '').trim() || '—');
    const line = `${i + 1}. ${artist} — ${name}`;
    const wrapped = state.doc.splitTextToSize(line, state.maxW);
    wrapped.forEach((ln: string) => {
      ensureSpace(state, BODY_LH);
      state.doc.setFont('helvetica', 'normal');
      state.doc.text(ln, MARGIN, state.y);
      state.y += BODY_LH;
    });
    state.y += 3;
  });
}

function drawDocumentTitle(state: CallSheetDocState, title: string, subtitle: string) {
  state.doc.setFont('helvetica', 'bold');
  state.doc.setFontSize(TITLE_PT);
  state.doc.setTextColor(26, 26, 28);
  ensureSpace(state, TITLE_LH);
  state.doc.text(sanitizePdfText(title), MARGIN, state.y);
  state.y += TITLE_LH;

  const subLines = state.doc.splitTextToSize(sanitizePdfText(subtitle), state.maxW);
  drawWrapped(state, subLines, 'helvetica', 'normal', SUB_PT, [72, 72, 76]);
  state.y += 8;
}

function drawRoundHeading(
  state: CallSheetDocState,
  roundName: string,
  roomLabel: string,
  patternLabel?: string,
  prize?: string,
) {
  state.doc.setFont('helvetica', 'bold');
  state.doc.setFontSize(ROUND_PT);
  state.doc.setTextColor(26, 26, 28);
  ensureSpace(state, TITLE_LH);
  state.doc.text(sanitizePdfText(roundName), MARGIN, state.y);
  state.y += TITLE_LH;

  const subParts = [roomLabel];
  if (patternLabel?.trim()) subParts.push(`Pattern: ${patternLabel.trim()}`);
  if (prize?.trim()) subParts.push(`Prize: ${prize.trim()}`);
  const subLines = state.doc.splitTextToSize(sanitizePdfText(subParts.join(' · ')), state.maxW);
  drawWrapped(state, subLines, 'helvetica', 'normal', SUB_PT, [72, 72, 76]);
  state.y += 6;
}

/** Tracks whether a jsPDF doc already has content (for merging call sheets + cards). */
export type PdfPageCursor = { pageStarted: boolean };

/** Append host call lists into an existing PDF (or start a new doc). */
export function appendMultiRoundCallSheetsToDoc(
  doc: jsPDF,
  sections: RoundCallSheetPdfOpts[],
  cursor: PdfPageCursor,
): void {
  if (!sections.length) return;

  if (cursor.pageStarted) {
    doc.addPage();
  }
  const state = createCallSheetDocState(doc);
  const roomLabel = sections[0].roomLabel;
  drawDocumentTitle(
    state,
    'TEMPO — Host call sheets',
    `${sections.length} saved round${sections.length !== 1 ? 's' : ''} · ${roomLabel}`,
  );
  drawPlaybackHint(state);
  cursor.pageStarted = true;

  sections.forEach((opts, i) => {
    if (i > 0) {
      doc.addPage();
      state.y = MARGIN;
    } else {
      state.y += 4;
    }
    drawRoundHeading(state, opts.roundName, opts.roomLabel, opts.patternLabel, opts.prize);
    drawTrackList(state, opts.tracks);
    if (i < sections.length - 1) {
      state.y += 8;
    }
  });
}

/**
 * Simple letter-sized host call sheet — numbered playback order from a saved round snapshot.
 */
export function buildRoundCallSheetPdfBlob(opts: RoundCallSheetPdfOpts): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const state = createCallSheetDocState(doc);
  const titleParts = [opts.roundName, opts.roomLabel];
  if (opts.patternLabel?.trim()) titleParts.push(`Pattern: ${opts.patternLabel.trim()}`);
  if (opts.prize?.trim()) titleParts.push(`Prize: ${opts.prize.trim()}`);
  const titleSub = titleParts.join(' · ');
  drawDocumentTitle(state, 'TEMPO — Host call sheet', titleSub);
  drawPlaybackHint(state);
  drawTrackList(state, opts.tracks);
  return doc.output('blob');
}

/** Pre-show export: one PDF with a call list per saved round (new page per round). */
export function buildMultiRoundCallSheetPdfBlob(sections: RoundCallSheetPdfOpts[]): Blob {
  if (!sections.length) {
    throw new Error('No call sheets to export.');
  }
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const cursor: PdfPageCursor = { pageStarted: false };
  appendMultiRoundCallSheetsToDoc(doc, sections, cursor);
  return doc.output('blob');
}
