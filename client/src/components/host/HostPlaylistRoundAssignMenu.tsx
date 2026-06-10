import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import {
  roundAssignmentLabel,
  roundIndicesForPlaylist,
} from '../../utils/playlistRoundAssignments';
import './HostPlaylistLibrary.css';

export type HostPlaylistRoundAssignMenuProps = {
  playlistId: string;
  playlistName: string;
  rounds: ReadonlyArray<{ id: string; name: string; playlistIds?: string[] }>;
  onAssign: (roundIndex: number) => void;
  onUnassign: (roundIndex: number) => void;
  disabled?: boolean;
};

const HostPlaylistRoundAssignMenu: React.FC<HostPlaylistRoundAssignMenuProps> = ({
  playlistId,
  playlistName,
  rounds,
  onAssign,
  onUnassign,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const assignedIndices = roundIndicesForPlaylist(playlistId, rounds);
  const usedInEvent = assignedIndices.length > 0;
  const reusedAcrossRounds = assignedIndices.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="host-playlist-assign" ref={rootRef}>
      {usedInEvent ? (
        <span className="host-playlist-assign__chips" aria-label="Assigned rounds">
          {assignedIndices.map((i) => (
            <span
              key={i}
              className={
                reusedAcrossRounds
                  ? 'host-playlist-assign__chip host-playlist-assign__chip--caution'
                  : 'host-playlist-assign__chip'
              }
              title={`Assigned to ${rounds[i]?.name ?? roundAssignmentLabel(i)}`}
            >
              {roundAssignmentLabel(i)}
            </span>
          ))}
        </span>
      ) : null}
      <button
        type="button"
        className="host-playlist-assign__trigger btn-secondary"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled || rounds.length === 0}
        title={`Assign ${playlistName} to rounds`}
        onClick={() => setOpen((v) => !v)}
      >
        Rounds
        <ChevronDown className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open ? (
        <div id={menuId} className="host-playlist-assign__menu" role="dialog" aria-label="Assign to rounds">
          {usedInEvent ? (
            <p className="host-playlist-assign__caution">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
              {reusedAcrossRounds
                ? 'Used in multiple rounds — reuse is allowed.'
                : `Already used in ${assignedIndices.map((i) => roundAssignmentLabel(i)).join(', ')}`}
            </p>
          ) : null}
          <ul className="host-playlist-assign__list">
            {rounds.map((round, index) => {
              const assigned = assignedIndices.includes(index);
              return (
                <li key={round.id}>
                  <label className="host-playlist-assign__row">
                    <input
                      type="checkbox"
                      checked={assigned}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onAssign(index);
                        } else {
                          onUnassign(index);
                        }
                      }}
                    />
                    <span className="host-playlist-assign__round-name">{round.name}</span>
                    {assigned ? (
                      <span className="host-playlist-assign__assigned-tag">
                        <Check className="w-3 h-3" aria-hidden />
                        Assigned
                      </span>
                    ) : usedInEvent ? (
                      <span className="host-playlist-assign__reuse-hint">Reuse?</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default HostPlaylistRoundAssignMenu;
