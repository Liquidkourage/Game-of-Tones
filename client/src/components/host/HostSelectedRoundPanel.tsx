import React, { useState } from 'react';
import { AlertTriangle, ListMusic, X } from 'lucide-react';
import './HostPlaylistLibrary.css';

export type SelectedRoundPlaylistRow = {
  id: string;
  name: string;
};

export type HostSelectedRoundPanelProps = {
  roundName: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  songCount: number;
  playlists: SelectedRoundPlaylistRow[];
  canEdit: boolean;
  onRemovePlaylist: (playlistId: string) => void;
  /** Drop a dragged library playlist here to assign it to this round. */
  onDropPlaylist?: (playlistId: string) => void;
};

const statusLabel: Record<HostSelectedRoundPanelProps['status'], string> = {
  completed: 'Done',
  active: 'Live',
  planned: 'Planned',
  unplanned: 'Draft',
};

/**
 * Details for the round currently selected in "Tonight's rounds".
 * Read-mostly: it summarizes one round and allows removing a playlist; it is
 * intentionally not another assignment bucket list competing with the timeline.
 */
const HostSelectedRoundPanel: React.FC<HostSelectedRoundPanelProps> = ({
  roundName,
  status,
  songCount,
  playlists,
  canEdit,
  onRemovePlaylist,
  onDropPlaylist,
}) => {
  const lowSongs = playlists.length > 0 && songCount > 0 && songCount < 15;
  const [dragOver, setDragOver] = useState(false);
  const count = playlists.length;
  // Tempo round rule: exactly 1 playlist (Round Mix) or exactly 5 (Column mode).
  const columnMode = count === 5;
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
        dragOver ? 'host-selected-round--drag-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Selected round details"
      onDragEnter={(e) => {
        if (!onDropPlaylist) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!onDropPlaylist) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!onDropPlaylist) return;
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        if (!onDropPlaylist) return;
        e.preventDefault();
        const playlistId = e.dataTransfer.getData('text/plain');
        if (playlistId) onDropPlaylist(playlistId);
        setDragOver(false);
      }}
    >
      <header className="host-selected-round__head">
        <p className="host-selected-round__eyebrow">Selected round</p>
        <h3 className="host-selected-round__title">
          {roundName}
          <span className={`host-selected-round__status host-selected-round__status--${status}`}>
            {statusLabel[status]}
          </span>
        </h3>
        <p className="host-selected-round__meta">
          {structureCopy}
          {count > 0 && songCount > 0 ? ` · ${songCount} songs` : ''}
        </p>
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
      {playlists.length > 0 ? (
        <ul className="host-selected-round__list">
          {playlists.map((p, i) => (
            <li key={p.id} className="host-selected-round__row">
              <ListMusic className="w-3.5 h-3.5" aria-hidden />
              {columnMode ? (
                <span className="host-selected-round__column-label">Col {i + 1}</span>
              ) : null}
              <span className="host-selected-round__name" title={p.name}>
                {p.name}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="host-selected-round__remove"
                  title={`Remove ${p.name} from this round`}
                  aria-label={`Remove ${p.name} from this round`}
                  onClick={() => onRemovePlaylist(p.id)}
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="host-selected-round__empty" role="status">
          Add 1 playlist for a round mix, or 5 playlists for column mode.{' '}
          {onDropPlaylist
            ? 'Drag a playlist from the library here (or onto a round above), or use the Rounds button on a playlist row.'
            : 'Drag a playlist from the library onto a round above, or use the Rounds button on a playlist row.'}
        </p>
      )}
    </section>
  );
};

export default HostSelectedRoundPanel;
