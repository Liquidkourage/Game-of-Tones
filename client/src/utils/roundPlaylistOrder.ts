import { sortIdsByBingoColumnOrder } from './bingoColumnOrder';

export interface RoundPlaylistRow {
  id: string;
  name: string;
  tracks?: number;
}

export interface RoundWithPlaylists {
  playlistIds: string[];
  playlistNames: string[];
  songCount: number;
  status: string;
}

/** Rebuild parallel id/name arrays; songCount unchanged (order-only). */
export function applyPlaylistIdOrder<TRound extends RoundWithPlaylists>(
  round: TRound,
  orderedIds: string[],
  playlistLookup: RoundPlaylistRow[],
): TRound {
  const names = orderedIds.map((id) => {
    const fromLib = playlistLookup.find((p) => String(p.id) === String(id));
    if (fromLib?.name) return fromLib.name;
    const prevIdx = round.playlistIds.findIndex((pid) => String(pid) === String(id));
    return prevIdx >= 0 ? round.playlistNames[prevIdx] : '';
  });
  return {
    ...round,
    playlistIds: orderedIds,
    playlistNames: names,
  };
}

export function sortRoundPlaylistsByBingoColumns<TRound extends RoundWithPlaylists>(
  round: TRound,
  playlistLookup: RoundPlaylistRow[],
): TRound {
  const ids = round.playlistIds || [];
  if (ids.length <= 1) return round;
  const nameForId = (id: string) => {
    const fromLib = playlistLookup.find((p) => String(p.id) === String(id));
    if (fromLib?.name) return fromLib.name;
    const i = round.playlistIds.indexOf(id);
    return i >= 0 ? round.playlistNames[i] : '';
  };
  const ordered = sortIdsByBingoColumnOrder(ids, nameForId);
  if (ordered.every((id, i) => id === ids[i])) return round;
  return applyPlaylistIdOrder(round, ordered, playlistLookup);
}
