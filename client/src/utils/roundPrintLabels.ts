import type { BingoPattern, PatternCompositeSpec } from '../patternDefinitions';
import {
  describeCompositePatternAudienceSentence,
  getPatternDisplayName,
} from '../patternDefinitions';

export type RoundPrintMeta = {
  roundName: string;
  roomLabel: string;
  pattern: BingoPattern | string;
  linesRequired?: number;
  patternComposite?: PatternCompositeSpec | null;
};

/** Human-readable winning pattern for printable PDF headers and filenames. */
export function roundPatternLabelForPrint(meta: RoundPrintMeta): string {
  const p = meta.pattern || 'line';
  if (p === 'composite') {
    const sentence = describeCompositePatternAudienceSentence(meta.patternComposite ?? null);
    return sentence ? `Combined: ${sentence}` : 'Combined pattern';
  }
  if (p === 'custom') return 'Custom pattern';
  let label = getPatternDisplayName(p);
  if (p === 'line' && (meta.linesRequired ?? 1) > 1) {
    label += ` · ${meta.linesRequired} lines`;
  }
  return label;
}

export function roundPrintablePdfSubtitle(meta: RoundPrintMeta): string {
  const pattern = roundPatternLabelForPrint(meta);
  return `${meta.roomLabel} · ${meta.roundName} · ${pattern}`;
}

/** Strip common Game of Tones playlist prefixes for printable/display stems. */
const PRINTABLE_PLAYLIST_PREFIX =
  /^\s*(?:GoT|Game\s+of\s+Tones|GameOfTones)\s*[-–—:]*\s*/i;

export function stemPlaylistDisplayName(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const stemmed = trimmed.replace(PRINTABLE_PLAYLIST_PREFIX, '').trim();
  return stemmed || trimmed;
}

/** Display-only playlist title plus an optional trailing pool-size token. */
export function playlistDisplayParts(raw: string): { title: string; poolSize?: 75 } {
  const stemmed = stemPlaylistDisplayName(raw);
  const poolSizeSuffix = /\s+75$/;
  if (!poolSizeSuffix.test(stemmed)) return { title: stemmed };

  return {
    title: stemmed.replace(poolSizeSuffix, '').trim(),
    poolSize: 75,
  };
}

/** 5×15 column labels or 1×75 single title — omit for other playlist counts. */
export function printablePlaylistLabelsFromNames(names: string[]): {
  columnLabels?: string[];
  singlePlaylistTitle?: string;
} {
  const stems = names.map(stemPlaylistDisplayName).filter((s) => s.length > 0);
  if (stems.length === 5) return { columnLabels: stems };
  if (stems.length === 1) return { singlePlaylistTitle: stems[0] };
  return {};
}
