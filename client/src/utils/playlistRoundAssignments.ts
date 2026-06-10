import { canonicalPlaylistIdForMatch } from './effectiveBingoPoolPreview';

export type RoundAssignmentRef = {
  index: number;
  name: string;
};

/** Round indices where this playlist is assigned (canonical id match). */
export function roundIndicesForPlaylist(
  playlistId: string,
  rounds: ReadonlyArray<{ playlistIds?: string[] }>,
): number[] {
  const canon = canonicalPlaylistIdForMatch(String(playlistId));
  const indices: number[] = [];
  rounds.forEach((round, index) => {
    if ((round.playlistIds || []).some((id) => canonicalPlaylistIdForMatch(String(id)) === canon)) {
      indices.push(index);
    }
  });
  return indices;
}

export function playlistAssignedToRound(
  playlistId: string,
  roundIndex: number,
  rounds: ReadonlyArray<{ playlistIds?: string[] }>,
): boolean {
  return roundIndicesForPlaylist(playlistId, rounds).includes(roundIndex);
}

export function roundAssignmentLabel(roundIndex: number): string {
  return `R${roundIndex + 1}`;
}
