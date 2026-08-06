import React, { useState } from 'react';
import { AlertTriangle, ArrowDownToLine, GripVertical, ListMusic, Play, X } from 'lucide-react';
import { BINGO_COLUMN_LETTERS } from '../../utils/bingoColumnOrder';
import { ROUND_PLAYLIST_REORDER_MIME } from '../../utils/roundPlaylistOrder';
import { playlistDisplayParts } from '../../utils/roundPrintLabels';
import './HostPlaylistLibrary.css';

export type SelectedRoundPlaylistRow = {
  id: string;
  name: string;
  trackCount?: number;
};

export type HostSelectedRoundPanelProps = {
  roundName: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  songCount: number;
  playlists: SelectedRoundPlaylistRow[];
  canEdit: boolean;
  onRemovePlaylist: (playlistId: string) => void;
  /** Reorder playlists within this round (column order left → right). */
  onReorderPlaylists?: (fromIndex: number, toIndex: number) => void;
  /** Drop a dragged library playlist here to assign it to this round. */
  onDropPlaylist?: (playlistId: string) => void;
  /** A library playlist drag is in progress: pulse this panel as a drop target. */
  dropTargetActive?: boolean;
  /** Five column letters for column-mode badges (defaults to BINGO). */
  columnLetters?: readonly string[];
  /** True when this round is already the one Start game will use. */
  isNextRound?: boolean;
  /** Load this round as next for Start game / Set round. */
  onSetNextRound?: () => void;
  canSetNextRound?: boolean;
};

const statusLabel: Record<HostSelectedRoundPanelProps['status'], string> = {
  completed: 'Done',
  active: 'Live',
  planned: 'Planned',
  unplanned: 'Draft',
};

function isPlaylistReorderDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(ROUND_PLAYLIST_REORDER_MIME);
}

/**
 * Details for the round currently selected in "Tonight's rounds".
 * Summarizes one round; assign/remove/reorder playlists for column order.
 */
const HostSelectedRoundPanel: React.FC<HostSelectedRoundPanelProps> = ({
  roundName,
  status,
  songCount,
  playlists,
  canEdit,
  onRemovePlaylist,
  onReorderPlaylists,
  onDropPlaylist,
  dropTargetActive = false,
  columnLetters,
  isNextRound = false,
  onSetNextRound,
  canSetNextRound = true,
}) => {
  const lowSongs = playlists.length > 0 && songCount > 0 && songCount < 15;
  const needsForPool = songCount >= 50 && songCount < 75 ? 75 - songCount : 0;
  const [libraryDragOver, setLibraryDragOver] = useState(false);
  const [dragChipIndex, setDragChipIndex] = useState<number | null>(null);
  const [dropChipIndex, setDropChipIndex] = useState<number | null>(null);
  const count = playlists.length;
  const columnMode = count === 5;
  const letters =
    columnLetters && columnLetters.length === 5 ? columnLetters : BINGO_COLUMN_LETTERS;
  const canReorder = canEdit && count >= 2 && Boolean(onReorderPlaylists);
  const structureValid = count === 1 || count === 5;
  const structureCopy =
    count === 0
      ? 'No playlists assigned'
      : count === 1
        ? 'Round Mix · 1 playlist supplies the full bingo pool'
        : columnMode
          ? 'Column mode · one playlist per card column'
          : count < 5
            ? `${count} playlists — rounds need 1 or 5`
            : `${count} playlists — rounds allow at most 5`;

  return (
    <section
      className={[
        'host-selected-round host-glass-panel',
        onDropPlaylist && dropTargetActive && !dragChipIndex ? 'host-selected-round--drop-ready' : '',
        libraryDragOver ? 'host-selected-round--drag-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Selected round details"
      onDragEnter={(e) => {
        if (!onDropPlaylist || isPlaylistReorderDrag(e)) return;
        e.preventDefault();
        setLibraryDragOver(true);
      }}
      onDragOver={(e) => {
        if (isPlaylistReorderDrag(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          return;
        }
        if (!onDropPlaylist) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setLibraryDragOver(true);
      }}
      onDragLeave={(e) => {
        if (isPlaylistReorderDrag(e)) return;
        if (!onDropPlaylist) return;
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setLibraryDragOver(false);
      }}
      onDrop={(e) => {
        if (isPlaylistReorderDrag(e)) return;
        if (!onDropPlaylist) return;
        e.preventDefault();
        const playlistId = e.dataTransfer.getData('text/plain');
        if (playlistId) onDropPlaylist(playlistId);
        setLibraryDragOver(false);
      }}
    >
      <header className="host-selected-round__head">
        <p className="host-selected-round__eyebrow">Selected round</p>
        <h3 className="host-selected-round__title">
          {roundName}
          <span
            className={[
              `host-selected-round__status host-selected-round__status--${status}`,
              isNextRound && status !== 'active' ? 'host-selected-round__status--next' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {isNextRound && status !== 'active' ? 'Next up' : statusLabel[status]}
          </span>
        </h3>
        <p className="host-selected-round__meta">
          {structureCopy}
          {count > 0 && songCount > 0 ? ` · ${songCount} songs` : ''}
        </p>
        {onSetNextRound ? (
          <button
            type="button"
            className={
              isNextRound
                ? 'btn-secondary host-selected-round__set-next is-current'
                : 'btn-primary host-selected-round__set-next'
            }
            onClick={onSetNextRound}
            disabled={isNextRound || !canSetNextRound}
            title={
              isNextRound
                ? 'This round is already next for Start game'
                : canSetNextRound
                  ? 'Load this round for Start game and Set round'
                  : 'End the live round before switching'
            }
          >
            <Play className="w-3.5 h-3.5" aria-hidden />
            {isNextRound ? 'Next up' : 'Set as next round'}
          </button>
        ) : null}
        {canReorder ? (
          <p className="host-selected-round__reorder-hint">
            Drag playlists to set {columnMode ? 'column order left → right' : 'play order'}.
          </p>
        ) : null}
      </header>
      {count > 0 && !structureValid ? (
        <p className="host-selected-round__warn" role="status">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          {count < 5
            ? `Add ${5 - count} more playlist${5 - count !== 1 ? 's' : ''} for column mode, or remove ${
                count - 1 === 1 ? '1' : count - 1
              } to use a single playlist.`
            : `Remove ${count - 5} playlist${count - 5 !== 1 ? 's' : ''} — rounds use 1 playlist or 5.`}
        </p>
      ) : null}
      {lowSongs ? (
        <p className="host-selected-round__warn" role="status">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          Fewer than 15 listed songs — this round may not reach the card-ready track minimum.
        </p>
      ) : null}
      {needsForPool ? (
        <p className="host-selected-round__warn host-selected-round__warn--pool" role="status">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          Need {needsForPool} for 75+
        </p>
      ) : null}
      {playlists.length > 0 ? (
        <ul className="host-selected-round__list">
          {playlists.map((p, i) => {
            const isDropTarget = dropChipIndex === i && dragChipIndex !== null;
            const isDragging = dragChipIndex === i;
            const { title: displayName, poolSize } = playlistDisplayParts(p.name, p.trackCount);
            return (
              <li
                key={p.id}
                className={[
                  'host-selected-round__row',
                  canReorder ? 'host-selected-round__row--draggable' : '',
                  poolSize ? 'host-selected-round__row--pool' : '',
                  isDropTarget ? 'host-selected-round__row--drop-target' : '',
                  isDragging ? 'host-selected-round__row--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={canReorder}
                onDragStart={(e) => {
                  if (!canReorder || !onReorderPlaylists) return;
                  e.dataTransfer.setData('text/plain', p.id);
                  e.dataTransfer.setData(ROUND_PLAYLIST_REORDER_MIME, String(i));
                  e.dataTransfer.effectAllowed = 'move';
                  setDragChipIndex(i);
                }}
                onDragEnd={() => {
                  setDragChipIndex(null);
                  setDropChipIndex(null);
                }}
                onDragOver={(e) => {
                  if (!canReorder || dragChipIndex === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setDropChipIndex(i);
                }}
                onDragLeave={() => {
                  setDropChipIndex((cur) => (cur === i ? null : cur));
                }}
                onDrop={(e) => {
                  if (!canReorder || !onReorderPlaylists) return;
                  const fromRaw = e.dataTransfer.getData(ROUND_PLAYLIST_REORDER_MIME);
                  if (fromRaw === '') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const from = Number(fromRaw);
                  if (Number.isFinite(from)) {
                    onReorderPlaylists(from, i);
                  }
                  setDragChipIndex(null);
                  setDropChipIndex(null);
                  setLibraryDragOver(false);
                }}
              >
                {canReorder ? (
                  <GripVertical className="host-selected-round__grip" aria-hidden />
                ) : (
                  <ListMusic className="w-3.5 h-3.5" aria-hidden />
                )}
                {columnMode ? (
                  <span
                    className="host-selected-round__column-label"
                    title={`${letters[i]} column`}
                  >
                    {letters[i]}
                  </span>
                ) : null}
                <span className="host-selected-round__name" title={displayName}>
                  {displayName}
                </span>
                {poolSize ? (
                  <span className="host-playlist-pool-size-chip" aria-label={`${poolSize} song pool`}>
                    {poolSize}+
                  </span>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    className="host-selected-round__remove"
                    title={`Remove ${displayName} from this round`}
                    aria-label={`Remove ${displayName} from this round`}
                    onClick={() => onRemovePlaylist(p.id)}
                  >
                    <X className="w-3.5 h-3.5" aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          {onDropPlaylist ? (
            <div className="host-selected-round__dropzone" aria-hidden>
              <ArrowDownToLine className="w-5 h-5" aria-hidden />
            </div>
          ) : null}
          <p className="host-selected-round__empty" role="status">
            Add 1 playlist for a round mix, or 5 playlists for column mode.{' '}
            {onDropPlaylist
              ? 'Drag a playlist from the library here (or onto a round above), or use the Rounds button on a playlist row.'
              : 'Drag a playlist from the library onto a round above, or use the Rounds button on a playlist row.'}
          </p>
        </>
      )}
    </section>
  );
};

export default HostSelectedRoundPanel;
