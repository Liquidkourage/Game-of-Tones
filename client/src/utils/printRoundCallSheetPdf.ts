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
  tracks: CallSheetTrack[];
};

/**
 * Simple letter-sized host call sheet — numbered playback order from a saved round snapshot.
 */
export function buildRoundCallSheetPdfBlob(opts: RoundCallSheetPdfOpts): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxW = pageW - 2 * margin;
  let y = margin;

  const titlePt = 16;
  const subPt = 11;
  const bodyPt = 10;
  const titleLH = 22;
  const bodyLH = 14;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titlePt);
  doc.setTextColor(26, 26, 28);
  doc.text(sanitizePdfText('TEMPO — Host call sheet'), margin, y);
  y += titleLH;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(subPt);
  doc.setTextColor(72, 72, 76);
  const subLines = doc.splitTextToSize(sanitizePdfText(`${opts.roundName} · ${opts.roomLabel}`), maxW);
  subLines.forEach((ln: string) => {
    ensureSpace(bodyLH);
    doc.text(ln, margin, y);
    y += bodyLH;
  });
  y += 8;

  doc.setFontSize(bodyPt - 1);
  doc.setTextColor(90, 90, 95);
  const hint = doc.splitTextToSize(
    sanitizePdfText(
      "Playback order from this round's Save round snapshot (same sequence as Start Game when a snapshot exists).",
    ),
    maxW,
  );
  hint.forEach((ln: string) => {
    ensureSpace(bodyLH);
    doc.text(ln, margin, y);
    y += bodyLH;
  });
  y += 10;

  doc.setFontSize(bodyPt);
  doc.setTextColor(26, 26, 28);

  opts.tracks.forEach((t, i) => {
    const artist = sanitizePdfText(String(t.artist || '').trim() || '—');
    const name = sanitizePdfText(String(t.name || '').trim() || '—');
    const line = `${i + 1}. ${artist} — ${name}`;
    const wrapped = doc.splitTextToSize(line, maxW);
    wrapped.forEach((ln: string) => {
      ensureSpace(bodyLH);
      doc.text(ln, margin, y);
      y += bodyLH;
    });
    y += 3;
  });

  return doc.output('blob');
}
