import { jsPDF } from 'jspdf';
import {
  appendMultiRoundCallSheetsToDoc,
  type RoundCallSheetPdfOpts,
} from './printRoundCallSheetPdf';

export type PrintableSquare = {
  position: string;
  customSongName?: string;
  customArtistName?: string;
  songName?: string;
  artistName?: string;
  isFreeSpace?: boolean;
  /** Leftovers: original playlist name (third line). */
  originPlaylistName?: string;
};

export type PrintableCard = {
  squares: PrintableSquare[];
  printableIndex?: number;
};

function gridFromSquares(squares: PrintableSquare[]): (PrintableSquare | null)[][] {
  const grid: (PrintableSquare | null)[][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => null as PrintableSquare | null),
  );
  for (const sq of squares) {
    const parts = String(sq.position || '').split('-');
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);
    if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || r > 4 || c < 0 || c > 4) continue;
    grid[r][c] = sq;
  }
  return grid;
}

function cellLabel(sq: PrintableSquare | null | undefined): {
  title: string;
  subtitle: string;
  tertiary: string;
} {
  if (!sq) return { title: '', subtitle: '', tertiary: '' };
  if (sq.isFreeSpace) return { title: 'FREE', subtitle: '', tertiary: '' };
  const title = (sq.customSongName || sq.songName || '').trim() || '—';
  const subtitle = (sq.customArtistName || sq.artistName || '').trim();
  const tertiary = (sq.originPlaylistName || '').trim();
  return { title, subtitle, tertiary };
}

/** Light print layout: minimize fills and saturated color to reduce ink. */
const PAGE = { r: 255, g: 255, b: 255 };
const INK = { r: 26, g: 26, b: 28 };
const INK_MUTED = { r: 72, g: 72, b: 76 };
const BORDER = { r: 100, g: 100, b: 105 };

const TITLE_LINE_FACTOR = 1.14;
const ARTIST_LINE_FACTOR = 1.12;
const PLAYLIST_LINE_FACTOR = 1.1;

/** Watermark strength for venue logo on the bingo grid (baked in canvas for reliable PDF output). */
const GRID_LOGO_OPACITY = 0.1;

/** How many bingo cards to tile on one US Letter page. */
export const CARDS_PER_PAGE_OPTIONS = [1, 2, 4, 6, 8] as const;
export type CardsPerPage = (typeof CARDS_PER_PAGE_OPTIONS)[number];

export function normalizeCardsPerPage(n: unknown): CardsPerPage {
  const v = Math.floor(Number(n));
  if (v === 2 || v === 4 || v === 6 || v === 8) return v;
  return 1;
}

/** Soft UX threshold — warn, but still allow the export. */
export const PRINTABLE_CARDS_SOFT_WARN = 200;
/** Absolute safety ceiling (must stay aligned with server PRINTABLE_CARDS_MAX default). */
export const PRINTABLE_CARDS_HARD_MAX = 1000;

export function clampPrintableCardCount(n: unknown): number {
  const raw = Math.floor(Number(n));
  if (!Number.isFinite(raw)) return 30;
  return Math.min(PRINTABLE_CARDS_HARD_MAX, Math.max(1, raw));
}

/** Confirm before large exports; returns false if the host cancels. */
export function confirmLargePrintableExport(count: number): boolean {
  if (count <= PRINTABLE_CARDS_SOFT_WARN) return true;
  return window.confirm(
    `Generate ${count} cards?\n\nExports over ${PRINTABLE_CARDS_SOFT_WARN} can take a while and create a large PDF. You can cancel and print in smaller batches instead.`,
  );
}

function nUpGrid(cardsPerPage: CardsPerPage): { cols: number; rows: number } {
  switch (cardsPerPage) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 1, rows: 2 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return { cols: 2, rows: 3 };
    case 8:
      return { cols: 2, rows: 4 };
  }
}

export type PrintablePdfOpts = {
  freeSpace?: boolean;
  /** Legacy single-line subtitle; also shown when roundName omitted. */
  subtitle?: string;
  roundName?: string;
  patternLabel?: string;
  roomLabel?: string;
  /** 5×15: stem playlist name under each B-I-N-G-O column header. */
  columnLabels?: string[];
  /** Five column letters printed above the grid (host pref, e.g. TEMPO); defaults to BINGO. */
  columnLetters?: string;
  /** 1×75: stem playlist name in the card header meta block. */
  singlePlaylistTitle?: string;
  /** Venue logo URL (absolute or path) — centered on the 5×5 grid at ~10% opacity, fit inside grid bounds. */
  logoUrl?: string | null;
  /** Diagonal PREVIEW watermark (free sample card). */
  previewWatermark?: boolean;
  /** Cards tiled per Letter page (1, 2, 4, 6, or 8). Default 1. */
  cardsPerPage?: CardsPerPage | number;
};

export type PrintablePdfSection = {
  cards: PrintableCard[];
  opts: PrintablePdfOpts;
};

type FitResult = {
  titlePt: number;
  artistPt: number;
  playlistPt: number;
  titleLines: string[];
  artistLines: string[];
  playlistLines: string[];
  totalH: number;
};

/**
 * Largest font sizes that fit — title bold, artist normal, optional playlist tertiary.
 */
function fitSongTextToCell(
  doc: jsPDF,
  title: string,
  subtitle: string,
  textW: number,
  maxH: number,
  tertiary = '',
): FitResult {
  const gap = subtitle ? 5 : 0;
  const playlistGap = tertiary ? 3 : 0;
  const maxTitlePt = 14;
  const minTitlePt = 5;
  const maxTitleLines = 7;
  const maxArtistLines = 5;
  const maxPlaylistLines = 3;

  for (let titlePt = maxTitlePt; titlePt >= minTitlePt; titlePt--) {
    const artistPt = Math.max(5, Math.min(titlePt - 1, 12));
    const playlistPt = Math.max(4, Math.min(artistPt - 1, 9));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(titlePt);
    const rawTitle = doc.splitTextToSize(title, textW);
    const titleLines = rawTitle.slice(0, maxTitleLines);
    const titleH = titleLines.length * titlePt * TITLE_LINE_FACTOR;

    let artistLines: string[] = [];
    let artistH = 0;
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(artistPt);
      artistLines = doc.splitTextToSize(subtitle, textW).slice(0, maxArtistLines);
      artistH = artistLines.length * artistPt * ARTIST_LINE_FACTOR;
    }

    let playlistLines: string[] = [];
    let playlistH = 0;
    if (tertiary) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(playlistPt);
      playlistLines = doc.splitTextToSize(tertiary, textW).slice(0, maxPlaylistLines);
      playlistH = playlistLines.length * playlistPt * PLAYLIST_LINE_FACTOR;
    }

    const totalH =
      titleH +
      (subtitle ? gap + artistH : 0) +
      (tertiary ? playlistGap + playlistH : 0);
    if (totalH <= maxH && titleLines.length > 0) {
      return { titlePt, artistPt, playlistPt, titleLines, artistLines, playlistLines, totalH };
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(minTitlePt);
  const titleLines = doc.splitTextToSize(title, textW).slice(0, maxTitleLines);
  const artistPt = 5;
  const playlistPt = 4;
  let artistLines: string[] = [];
  let playlistLines: string[] = [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(artistPt);
  if (subtitle) artistLines = doc.splitTextToSize(subtitle, textW).slice(0, maxArtistLines);
  doc.setFontSize(playlistPt);
  if (tertiary) playlistLines = doc.splitTextToSize(tertiary, textW).slice(0, maxPlaylistLines);
  const titleH = titleLines.length * minTitlePt * TITLE_LINE_FACTOR;
  const artistH = artistLines.length * artistPt * ARTIST_LINE_FACTOR;
  const playlistH = playlistLines.length * playlistPt * PLAYLIST_LINE_FACTOR;
  const totalH =
    titleH + (subtitle ? gap + artistH : 0) + (tertiary ? playlistGap + playlistH : 0);

  return {
    titlePt: minTitlePt,
    artistPt,
    playlistPt,
    titleLines,
    artistLines,
    playlistLines,
    totalH,
  };
}

function drawSongCell(
  doc: jsPDF,
  x: number,
  y: number,
  cell: number,
  title: string,
  subtitle: string,
  tertiary = '',
): void {
  const pad = 5;
  const textW = Math.max(12, cell - pad * 2);
  const maxH = cell - pad * 2;
  const cx = x + cell / 2;

  const fit = fitSongTextToCell(doc, title, subtitle, textW, maxH, tertiary);
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

  if (tertiary && fit.playlistLines.length > 0) {
    cursorY += 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fit.playlistPt);
    doc.setTextColor(INK_MUTED.r, INK_MUTED.g, INK_MUTED.b);
    for (const line of fit.playlistLines) {
      doc.text(line, cx, cursorY, { align: 'center' });
      cursorY += fit.playlistPt * PLAYLIST_LINE_FACTOR;
    }
  }
}

async function loadLogoPngDataUrlForGrid(
  url: string,
  maxW: number,
  maxH: number,
): Promise<{ dataUrl: string; drawW: number; drawH: number } | null> {
  const trimmed = String(url || '').trim();
  if (!trimmed || typeof window === 'undefined') return null;

  let resolved: string;
  try {
    resolved = new URL(trimmed, window.location.href).toString();
  } catch {
    return null;
  }

  let bmp: ImageBitmap | null = null;
  try {
    const res = await fetch(resolved, {
      mode: 'cors',
      credentials: (() => {
        try {
          return new URL(resolved).origin === window.location.origin ? 'include' : 'omit';
        } catch {
          return 'omit';
        }
      })(),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    bmp = await createImageBitmap(blob);
    const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
    const drawW = Math.max(1, Math.round(bmp.width * scale));
    const drawH = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, drawW, drawH);
    ctx.globalAlpha = GRID_LOGO_OPACITY;
    ctx.drawImage(bmp, 0, 0, drawW, drawH);
    ctx.globalAlpha = 1;
    return { dataUrl: canvas.toDataURL('image/png'), drawW, drawH };
  } catch {
    return null;
  } finally {
    try {
      bmp?.close();
    } catch {
      /* ignore */
    }
  }
}

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

/** Layout for one bingo card inside a page slot (full page or n-up cell). */
type CardLayout = {
  originX: number;
  originY: number;
  slotW: number;
  slotH: number;
  pad: number;
  titleFontPt: number;
  metaFontPt: number;
  bingoFontPt: number;
  columnLabelPt: number;
  titleBaseline: number;
  gridTop: number;
  cell: number;
  gridW: number;
  gridX: number;
  bingoBaseline: number;
};

const COLUMN_LABEL_PT = 7;
const COLUMN_LABEL_MAX_LINES = 2;
const COLUMN_LABEL_RESERVE_PT = 22;
/** Reference content width for a full-page card (Letter − 40pt margins). */
const FULL_PAGE_CONTENT_W = 532;

function headerMetaLines(opts: PrintablePdfOpts): string[] {
  const lines: string[] = [];
  if (opts.roundName?.trim()) lines.push(opts.roundName.trim());
  else if (opts.subtitle?.trim()) lines.push(opts.subtitle.trim());
  if (opts.patternLabel?.trim()) lines.push(`Pattern: ${opts.patternLabel.trim()}`);
  if (opts.singlePlaylistTitle?.trim()) {
    lines.push(`Playlist: ${opts.singlePlaylistTitle.trim()}`);
  }
  if (opts.roomLabel?.trim() && !opts.subtitle?.includes(opts.roomLabel.trim())) {
    lines.push(opts.roomLabel.trim());
  }
  return lines;
}

function computeCardLayoutInSlot(
  originX: number,
  originY: number,
  slotW: number,
  slotH: number,
  opts: PrintablePdfOpts,
): CardLayout {
  const pad = Math.max(3, Math.min(14, Math.min(slotW, slotH) * 0.035));
  const contentW = Math.max(40, slotW - pad * 2);
  const wScale = contentW / FULL_PAGE_CONTENT_W;

  const titleFontPt = Math.max(6, Math.min(17, 17 * wScale));
  const metaFontPt = Math.max(4.5, Math.min(10, 10 * wScale));
  const bingoFontPt = Math.max(5, Math.min(13, 13 * wScale));
  const columnLabelPt = Math.max(4, Math.min(COLUMN_LABEL_PT, COLUMN_LABEL_PT * wScale));

  const titleBaseline = originY + pad + titleFontPt;
  const metaBlockH = headerMetaLines(opts).length * (metaFontPt * 1.35);
  const bingoBaseline = titleBaseline + metaBlockH + Math.max(6, 28 * wScale);
  const hasColumnLabels = opts.columnLabels?.length === 5;
  const columnLabelReserve = hasColumnLabels
    ? Math.max(8, COLUMN_LABEL_RESERVE_PT * wScale)
    : 0;
  const gridTop = bingoBaseline + Math.max(3, 16 * wScale) + columnLabelReserve;
  const availW = contentW;
  const availH = originY + slotH - pad - gridTop;
  const cell = Math.min(availW / 5, Math.max(6, availH) / 5);
  const gridW = cell * 5;
  const gridX = originX + pad + (availW - gridW) / 2;

  return {
    originX,
    originY,
    slotW,
    slotH,
    pad,
    titleFontPt,
    metaFontPt,
    bingoFontPt,
    columnLabelPt,
    titleBaseline,
    gridTop,
    cell,
    gridW,
    gridX,
    bingoBaseline,
  };
}

function fitColumnLabel(
  doc: jsPDF,
  raw: string,
  maxW: number,
  maxLines: number,
  fontPt: number,
): string[] {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontPt);
  const text = raw.trim() || '—';
  let lines = doc.splitTextToSize(text, maxW);
  if (lines.length <= maxLines) return lines;
  lines = lines.slice(0, maxLines);
  let last = lines[maxLines - 1];
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > maxW) {
    last = last.slice(0, -1);
  }
  lines[maxLines - 1] = `${last}…`;
  return lines;
}

function drawCardHeader(doc: jsPDF, layout: CardLayout, opts: PrintablePdfOpts): void {
  const {
    originX,
    slotW,
    pad,
    titleFontPt,
    metaFontPt,
    bingoFontPt,
    columnLabelPt,
    titleBaseline,
    bingoBaseline,
    gridX,
    cell,
  } = layout;
  const centerX = originX + slotW / 2;

  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titleFontPt);
  doc.text('TEMPO', centerX, titleBaseline, { align: 'center' });

  const meta = headerMetaLines(opts);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(metaFontPt);
  doc.setTextColor(INK_MUTED.r, INK_MUTED.g, INK_MUTED.b);
  let y = titleBaseline + titleFontPt * 1.05;
  for (const line of meta) {
    doc.text(line, centerX, y, { align: 'center', maxWidth: slotW - pad * 2 });
    y += metaFontPt * 1.35;
  }

  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bingoFontPt);
  const letters =
    typeof opts.columnLetters === 'string' && opts.columnLetters.length === 5
      ? opts.columnLetters.toUpperCase().split('')
      : BINGO_LETTERS;
  for (let c = 0; c < 5; c++) {
    const cx = gridX + c * cell + cell / 2;
    doc.text(letters[c], cx, bingoBaseline, { align: 'center' });
  }

  const colLabels = opts.columnLabels;
  if (colLabels?.length === 5) {
    const labelLh = columnLabelPt * 1.12;
    const textW = Math.max(6, cell - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(columnLabelPt);
    doc.setTextColor(INK_MUTED.r, INK_MUTED.g, INK_MUTED.b);
    const labelY = bingoBaseline + Math.max(3, 6 * (columnLabelPt / COLUMN_LABEL_PT));
    for (let c = 0; c < 5; c++) {
      const cx = gridX + c * cell + cell / 2;
      const lines = fitColumnLabel(doc, colLabels[c] || '', textW, COLUMN_LABEL_MAX_LINES, columnLabelPt);
      let ly = labelY + columnLabelPt * 0.85;
      for (const line of lines) {
        doc.text(line, cx, ly, { align: 'center' });
        ly += labelLh;
      }
    }
  }
}

function drawBingoCardInSlot(
  doc: jsPDF,
  card: PrintableCard,
  layout: CardLayout,
  logoForGrid: { dataUrl: string; drawW: number; drawH: number } | null,
  opts: PrintablePdfOpts,
): void {
  const { originX, originY, slotW, slotH, gridTop, cell, gridW, gridX } = layout;
  const grid = gridFromSquares(card.squares || []);
  const drawLogoUnderCells = logoForGrid != null;

  drawCardHeader(doc, layout, opts);

  if (drawLogoUnderCells && logoForGrid) {
    const ix = gridX + (gridW - logoForGrid.drawW) / 2;
    const iy = gridTop + (gridW - logoForGrid.drawH) / 2;
    try {
      doc.addImage(logoForGrid.dataUrl, 'PNG', ix, iy, logoForGrid.drawW, logoForGrid.drawH);
    } catch {
      /* ignore broken image */
    }
  }

  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.setLineWidth(Math.max(0.25, Math.min(0.4, cell * 0.01)));

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = gridX + c * cell;
      const y = gridTop + r * cell;
      const sq = grid[r][c];
      const { title, subtitle, tertiary } = cellLabel(sq);

      if (sq?.isFreeSpace) {
        if (!drawLogoUnderCells) {
          doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
          doc.rect(x, y, cell, cell, 'FD');
        }
        doc.setTextColor(INK.r, INK.g, INK.b);
        doc.setFont('helvetica', 'bold');
        const freePt = Math.max(4, Math.min(16, cell * 0.22));
        doc.setFontSize(freePt);
        doc.text('FREE', x + cell / 2, y + cell / 2 + freePt * 0.28, { align: 'center' });
      } else {
        if (!drawLogoUnderCells) {
          doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
          doc.rect(x, y, cell, cell, 'FD');
        }
        drawSongCell(doc, x, y, cell, title, subtitle, tertiary);
      }

      doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
      doc.rect(x, y, cell, cell, 'S');
    }
  }

  // Light cut guide when multiple cards share a page.
  if (slotW < doc.internal.pageSize.getWidth() - 1 || slotH < doc.internal.pageSize.getHeight() - 1) {
    doc.setDrawColor(200, 200, 205);
    doc.setLineWidth(0.3);
    doc.rect(originX + 1, originY + 1, slotW - 2, slotH - 2, 'S');
  }

  if (opts.previewWatermark) {
    doc.setTextColor(190, 190, 190);
    doc.setFont('helvetica', 'bold');
    const wmPt = Math.max(14, Math.min(42, layout.cell * 0.9));
    doc.setFontSize(wmPt);
    doc.text('PREVIEW', originX + slotW / 2, originY + slotH * 0.55, {
      align: 'center',
      angle: 35,
    });
  }
}

async function prepareLogoForGrid(
  opts: PrintablePdfOpts,
  gridW: number,
): Promise<{ dataUrl: string; drawW: number; drawH: number } | null> {
  const logoUrl = opts.logoUrl != null && String(opts.logoUrl).trim() ? String(opts.logoUrl).trim() : null;
  if (!logoUrl) return null;
  return loadLogoPngDataUrlForGrid(logoUrl, gridW, gridW);
}

function fillPageWhite(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
  doc.rect(0, 0, pageW, pageH, 'F');
}

export type PdfPageCursor = { pageStarted: boolean };

/** Append a list of cards into `doc`, tiling `cardsPerPage` per Letter page. */
async function appendCardsToDoc(
  doc: jsPDF,
  cards: PrintableCard[],
  opts: PrintablePdfOpts,
  cursor: PdfPageCursor,
): Promise<void> {
  if (!cards.length) return;

  const cpp = normalizeCardsPerPage(opts.cardsPerPage);
  const { cols, rows } = nUpGrid(cpp);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pageMargin = cpp === 1 ? 40 : 16;
  const gutter = cpp === 1 ? 0 : 8;
  const slotW = (pageW - pageMargin * 2 - gutter * (cols - 1)) / cols;
  const slotH = (pageH - pageMargin * 2 - gutter * (rows - 1)) / rows;

  const sampleLayout = computeCardLayoutInSlot(0, 0, slotW, slotH, opts);
  const logoForGrid = await prepareLogoForGrid(opts, sampleLayout.gridW);

  let slotOnPage = 0;
  for (const card of cards) {
    if (slotOnPage === 0) {
      if (cursor.pageStarted) doc.addPage();
      fillPageWhite(doc);
      cursor.pageStarted = true;
    }

    const col = slotOnPage % cols;
    const row = Math.floor(slotOnPage / cols);
    const ox = pageMargin + col * (slotW + gutter);
    const oy = pageMargin + row * (slotH + gutter);
    const layout = computeCardLayoutInSlot(ox, oy, slotW, slotH, opts);
    drawBingoCardInSlot(doc, card, layout, logoForGrid, opts);

    slotOnPage = (slotOnPage + 1) % cpp;
  }
}

/**
 * Multi-page US Letter PDF — music bingo cards tiled by `opts.cardsPerPage` (default 1).
 */
export async function buildPrintableBingoPdfBlob(
  cards: PrintableCard[],
  opts: PrintablePdfOpts = {},
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const cursor: PdfPageCursor = { pageStarted: false };
  await appendCardsToDoc(doc, cards, opts, cursor);
  return doc.output('blob');
}

/** Append printable bingo cards into an existing PDF (or start a new doc). */
export async function appendMultiRoundPrintableCardsToDoc(
  doc: jsPDF,
  sections: PrintablePdfSection[],
  cursor: PdfPageCursor,
): Promise<void> {
  for (const section of sections) {
    if (!section.cards.length) continue;
    // Start each round on a fresh page so rounds never share a sheet.
    await appendCardsToDoc(doc, section.cards, section.opts, cursor);
  }
}

/** Pre-show export: one PDF with all saved rounds (round header on each card page). */
export async function buildMultiRoundPrintablePdfBlob(
  sections: PrintablePdfSection[],
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const cursor: PdfPageCursor = { pageStarted: false };
  await appendMultiRoundPrintableCardsToDoc(doc, sections, cursor);
  if (!cursor.pageStarted) {
    throw new Error('No printable cards to export.');
  }
  return doc.output('blob');
}

/** Call sheets first, then printable cards — one download for pre-show prep. */
export async function buildCombinedPreShowPdfBlob(
  callSections: RoundCallSheetPdfOpts[],
  cardSections: PrintablePdfSection[],
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const cursor: PdfPageCursor = { pageStarted: false };
  appendMultiRoundCallSheetsToDoc(doc, callSections, cursor);
  await appendMultiRoundPrintableCardsToDoc(doc, cardSections, cursor);
  if (!cursor.pageStarted) {
    throw new Error('Nothing to export — save at least one round first.');
  }
  return doc.output('blob');
}
