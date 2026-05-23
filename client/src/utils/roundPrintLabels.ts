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
