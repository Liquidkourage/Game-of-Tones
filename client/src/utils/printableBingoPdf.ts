import { jsPDF } from 'jspdf';
import {
  appendMultiRoundCallSheetsToDoc,
  type RoundCallSheetPdfOpts,
} from './printRoundCallSheetPdf';

export type PrintableSquare = {
  position: string;
  customSongName?: string;
  songName?: string;
  artistName?: string;
  isFreeSpace?: boolean;
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

function cellLabel(sq: PrintableSquare | null | undefined): { title: string; subtitle: string } {
  if (!sq) return { title: '', subtitle: '' };
  if (sq.isFreeSpace) return { title: 'FREE', subtitle: '' };
  const title = (sq.customSongName || sq.songName || '').trim() || '—';
  const subtitle = (sq.artistName || '').trim();
  return { title, subtitle };
}

/** Light print layout: minimize fills and saturated color to reduce ink. */
const PAGE = { r: 255, g: 255, b: 255 };
const INK = { r: 26, g: 26, b: 28 };
const INK_MUTED = { r: 72, g: 72, b: 76 };
const BORDER = { r: 100, g: 100, b: 105 };

const TITLE_LINE_FACTOR = 1.14;
const ARTIST_LINE_FACTOR = 1.12;

/** Watermark strength for venue logo on the bingo grid (baked in canvas for reliable PDF output). */
const GRID_LOGO_OPACITY = 0.1;

export type PrintablePdfOpts = {
  freeSpace?: boolean;
  /** Legacy single-line subtitle; also shown when roundName omitted. */
  subtitle?: string;
  roundName?: string;
  patternLabel?: string;
  roomLabel?: string;
  /** Venue logo URL (absolute or path) — centered on the 5×5 grid at ~10% opacity, fit inside grid bounds. */
  logoUrl?: string | null;
};

export type PrintablePdfSection = {
  cards: PrintableCard[];
  opts: PrintablePdfOpts;
};

type FitResult = {
  titlePt: number;
  artistPt: number;
  titleLines: string[];
  artistLines: string[];
  totalH: number;
};

/**
 * Largest font sizes that fit — title bold, artist normal, centered block.
 */
function fitSongTextToCell(
  doc: jsPDF,
  title: string,
  subtitle: string,
  textW: number,
  maxH: number,
): FitResult {
  const gap = subtitle ? 5 : 0;
  const maxTitlePt = 14;
  const minTitlePt = 5;
  const maxTitleLines = 7;
  const maxArtistLines = 5;

  for (let titlePt = maxTitlePt; titlePt >= minTitlePt; titlePt--) {
    const artistPt = Math.max(5, Math.min(titlePt - 1, 12));

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

    const totalH = titleH + (subtitle ? gap + artistH : 0);
    if (totalH <= maxH && titleLines.length > 0) {
      return { titlePt, artistPt, titleLines, artistLines, totalH };
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(minTitlePt);
  const titleLines = doc.splitTextToSize(title, textW).slice(0, maxTitleLines);
  const artistPt = 5;
  let artistLines: string[] = [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(artistPt);
  if (subtitle) artistLines = doc.splitTextToSize(subtitle, textW).slice(0, maxArtistLines);
  const titleH = titleLines.length * minTitlePt * TITLE_LINE_FACTOR;
  const artistH = artistLines.length * artistPt * ARTIST_LINE_FACTOR;
  const totalH = titleH + (subtitle ? gap + artistH : 0);

  return {
    titlePt: minTitlePt,
    artistPt,
    titleLines,
    artistLines,
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
): void {
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

type PageLayout = {
  pageW: number;
  pageH: number;
  margin: number;
  marginBottom: number;
  gridTop: number;
  cell: number;
  gridW: number;
  gridX: number;
  bingoBaseline: number;
};

function computePageLayout(doc: jsPDF, headerLineCount: number): PageLayout {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const marginBottom = 40;
  const titleFontPt = 17;
  const metaFontPt = 10;
  const titleBaseline = margin + 20;
  const metaBlockH = Math.max(0, headerLineCount - 1) * (metaFontPt * 1.35);
  const bingoFontPt = 13;
  const bingoBaseline = titleBaseline + metaBlockH + 28;
  const gridTop = bingoBaseline + 16;
  const availW = pageW - margin * 2;
  const availH = pageH - gridTop - marginBottom;
  const cell = Math.min(availW / 5, availH / 5);
  const gridW = cell * 5;
  const gridX = margin + (availW - gridW) / 2;
  return { pageW, pageH, margin, marginBottom, gridTop, cell, gridW, gridX, bingoBaseline };
}

function headerMetaLines(opts: PrintablePdfOpts): string[] {
  const lines: string[] = [];
  if (opts.roundName?.trim()) lines.push(opts.roundName.trim());
  else if (opts.subtitle?.trim()) lines.push(opts.subtitle.trim());
  if (opts.patternLabel?.trim()) lines.push(`Pattern: ${opts.patternLabel.trim()}`);
  if (opts.roomLabel?.trim() && !opts.subtitle?.includes(opts.roomLabel.trim())) {
    lines.push(opts.roomLabel.trim());
  }
  return lines;
}

function drawPageHeader(doc: jsPDF, layout: PageLayout, opts: PrintablePdfOpts): void {
  const { pageW, bingoBaseline } = layout;
  const margin = layout.margin;
  const titleFontPt = 17;
  const metaFontPt = 10;
  const titleBaseline = margin + 20;

  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titleFontPt);
  doc.text('TEMPO — Music Bingo', pageW / 2, titleBaseline, { align: 'center' });

  const meta = headerMetaLines(opts);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(metaFontPt);
  doc.setTextColor(INK_MUTED.r, INK_MUTED.g, INK_MUTED.b);
  let y = titleBaseline + 18;
  for (const line of meta) {
    doc.text(line, pageW / 2, y, { align: 'center', maxWidth: pageW - margin * 2 });
    y += metaFontPt * 1.35;
  }

  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const { gridX, cell } = layout;
  for (let c = 0; c < 5; c++) {
    const cx = gridX + c * cell + cell / 2;
    doc.text(BINGO_LETTERS[c], cx, bingoBaseline, { align: 'center' });
  }
}

function drawBingoCardPage(
  doc: jsPDF,
  card: PrintableCard,
  layout: PageLayout,
  logoForGrid: { dataUrl: string; drawW: number; drawH: number } | null,
  opts: PrintablePdfOpts,
): void {
  const { pageW, pageH, gridTop, cell, gridW, gridX } = layout;
  const grid = gridFromSquares(card.squares || []);
  const drawLogoUnderCells = logoForGrid != null;

  doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
  doc.rect(0, 0, pageW, pageH, 'F');
  drawPageHeader(doc, layout, opts);

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
  doc.setLineWidth(0.4);

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = gridX + c * cell;
      const y = gridTop + r * cell;
      const sq = grid[r][c];
      const { title, subtitle } = cellLabel(sq);

      if (sq?.isFreeSpace) {
        if (!drawLogoUnderCells) {
          doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
          doc.rect(x, y, cell, cell, 'FD');
        }
        doc.setTextColor(INK.r, INK.g, INK.b);
        doc.setFont('helvetica', 'bold');
        const freePt = Math.min(16, cell * 0.15);
        doc.setFontSize(freePt);
        doc.text('FREE', x + cell / 2, y + cell / 2 + freePt * 0.28, { align: 'center' });
      } else {
        if (!drawLogoUnderCells) {
          doc.setFillColor(PAGE.r, PAGE.g, PAGE.b);
          doc.rect(x, y, cell, cell, 'FD');
        }
        drawSongCell(doc, x, y, cell, title, subtitle);
      }

      doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
      doc.rect(x, y, cell, cell, 'S');
    }
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

/**
 * Multi-page US Letter PDF — one music bingo card per page, print-ready (light / ink-conscious).
 */
export async function buildPrintableBingoPdfBlob(
  cards: PrintableCard[],
  opts: PrintablePdfOpts = {},
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const headerLines = 1 + headerMetaLines(opts).length;
  const layout = computePageLayout(doc, headerLines);
  const logoForGrid = await prepareLogoForGrid(opts, layout.gridW);

  for (let i = 0; i < cards.length; i++) {
    if (i > 0) doc.addPage();
    drawBingoCardPage(doc, cards[i], layout, logoForGrid, opts);
  }

  return doc.output('blob');
}

export type PdfPageCursor = { pageStarted: boolean };

/** Append printable bingo cards into an existing PDF (or start a new doc). */
export async function appendMultiRoundPrintableCardsToDoc(
  doc: jsPDF,
  sections: PrintablePdfSection[],
  cursor: PdfPageCursor,
): Promise<void> {
  for (const section of sections) {
    if (!section.cards.length) continue;
    const headerLines = 1 + headerMetaLines(section.opts).length;
    const layout = computePageLayout(doc, headerLines);
    const logoForGrid = await prepareLogoForGrid(section.opts, layout.gridW);

    for (const card of section.cards) {
      if (cursor.pageStarted) doc.addPage();
      cursor.pageStarted = true;
      drawBingoCardPage(doc, card, layout, logoForGrid, section.opts);
    }
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
