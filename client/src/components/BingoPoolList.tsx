import React, { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import { youtubeTrackDisplayFields } from '../utils/youtubeTrackDisplay';
import { validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';

export type BingoPoolSong = {
  id: string;
  name?: string;
  artist?: string;
  explicit?: boolean;
  youtubeMusic?: boolean;
};

type BingoPoolListProps = {
  songs: BingoPoolSong[];
  currentSongId?: string | null;
  getDisplaySongTitle: (id: string, cleaned: string) => string;
  customSongTitles: Record<string, string>;
  onEditSongTitle: (song: { id: string; title: string; artist: string }) => void;
};

/** Scrollable bingo pool; keeps the active track near the top of the visible list. */
const BingoPoolList: React.FC<BingoPoolListProps> = ({
  songs,
  currentSongId,
  getDisplaySongTitle,
  customSongTitles,
  onEditSongTitle,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!currentSongId || !scrollRef.current) return;
    const row = rowRefs.current[currentSongId];
    if (!row) return;
    const container = scrollRef.current;
    const rowTop = row.offsetTop;
    const targetScroll = Math.max(0, rowTop - 12);
    const delta = Math.abs(container.scrollTop - targetScroll);
    container.scrollTo({
      top: targetScroll,
      behavior: delta > 48 ? 'smooth' : 'auto',
    });
  }, [currentSongId, songs]);

  return (
    <div ref={scrollRef} className="bingo-pool-list" role="list" aria-label="Bingo pool playback order">
      {songs.map((song, index) => {
        const ytf = youtubeTrackDisplayFields(song);
        const displayTitle = getDisplaySongTitle(song.id, ytf.title);
        const validation = validateSongTitleSync(displayTitle, ytf.title);
        const validationColor = getValidationColor(validation);
        const validationMessage = getValidationMessage(validation);
        const isCurrent = currentSongId === song.id;
        const isLowConfidence = validation.confidence < 0.7;

        return (
          <div
            key={song.id}
            ref={(el) => {
              rowRefs.current[song.id] = el;
            }}
            role="listitem"
            className={`bingo-pool-list__row${isCurrent ? ' bingo-pool-list__row--current' : ''}${
              isLowConfidence ? ' bingo-pool-list__row--warn' : ''
            }`}
            title={`Song Title Comparison:

Original: "${song.name}"
Cleaned: "${displayTitle}"
${customSongTitles[song.id] ? `Custom: "${customSongTitles[song.id]}"` : ''}

${validationMessage}`}
          >
            <span className="bingo-pool-list__num" aria-hidden>
              #{index + 1}
            </span>
            <div className="bingo-pool-list__main">
              <div className="bingo-pool-list__title-row">
                <span className="bingo-pool-list__title">{displayTitle}</span>
                {song.explicit === true ? (
                  <SpotifyExplicitBadge size="md" title="Marked explicit on Spotify" />
                ) : null}
                {customSongTitles[song.id] ? (
                  <span className="bingo-pool-list__edited">(edited)</span>
                ) : null}
                {!customSongTitles[song.id] && displayTitle !== song.name ? (
                  <span className="bingo-pool-list__cleaned">(cleaned)</span>
                ) : null}
                <span className="bingo-pool-list__validation" style={{ color: validationColor }}>
                  {validation.confidence < 0.7 ? (
                    <AlertTriangle size={14} aria-hidden />
                  ) : validation.confidence < 0.8 ? (
                    <AlertCircle size={14} aria-hidden />
                  ) : (
                    <CheckCircle2 size={14} aria-hidden />
                  )}
                </span>
              </div>
              <div className="bingo-pool-list__artist">by {ytf.artist}</div>
            </div>
            <button
              type="button"
              className="bingo-pool-list__edit btn-secondary"
              onClick={() =>
                onEditSongTitle({ id: song.id, title: song.name || '', artist: song.artist || '' })
              }
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              Edit
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default BingoPoolList;
