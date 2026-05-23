import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Pencil, Play } from 'lucide-react';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import { youtubeTrackDisplayFields } from '../utils/youtubeTrackDisplay';
import { validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';
import { hasSongAlias, type SongAliases } from '../utils/songAliasDisplay';

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
  /** Song ids that have already finished playing (not including current). */
  playedSongIds?: ReadonlySet<string>;
  getDisplaySongTitle: (id: string, cleaned: string) => string;
  getDisplaySongArtist: (id: string, fallback: string) => string;
  songAliases: SongAliases;
  onEditSongAlias: (song: { id: string; title: string; artist: string }) => void;
};

/** Rows to keep visible above the fold before we scroll the list. */
const PIN_ROWS_BEFORE_SCROLL = 5;

function rowTopInContainer(container: HTMLElement, row: HTMLElement): number {
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return rowRect.top - containerRect.top + container.scrollTop;
}

/** Scrollable bingo pool; early songs stay at top, later songs pin ~2nd row in view. */
const BingoPoolList: React.FC<BingoPoolListProps> = ({
  songs,
  currentSongId,
  playedSongIds,
  getDisplaySongTitle,
  getDisplaySongArtist,
  songAliases,
  onEditSongAlias,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastScrolledIndexRef = useRef<number>(-1);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !currentSongId) return;

    const currentIndex = songs.findIndex((s) => s.id === currentSongId);
    if (currentIndex < 0) return;

    const applyScroll = () => {
      if (currentIndex < PIN_ROWS_BEFORE_SCROLL) {
        if (container.scrollTop !== 0) {
          container.scrollTo({
            top: 0,
            behavior: lastScrolledIndexRef.current >= 0 ? 'smooth' : 'auto',
          });
        }
        lastScrolledIndexRef.current = currentIndex;
        return;
      }

      const row = rowRefs.current[currentIndex];
      if (!row) return;

      const sample = rowRefs.current[0] || row;
      const rowStride = Math.max(sample.offsetHeight || 52, 44);
      const topInset = rowTopInContainer(container, row);
      const targetScroll = Math.max(0, topInset - rowStride * 1.5);

      if (Math.abs(container.scrollTop - targetScroll) > 4) {
        const delta = Math.abs(container.scrollTop - targetScroll);
        container.scrollTo({
          top: targetScroll,
          behavior: delta > 80 && lastScrolledIndexRef.current >= 0 ? 'smooth' : 'auto',
        });
      }
      lastScrolledIndexRef.current = currentIndex;
    };

    requestAnimationFrame(applyScroll);
  }, [currentSongId, songs]);

  return (
    <div ref={scrollRef} className="bingo-pool-list" role="list" aria-label="Bingo pool playback order">
      {songs.map((song, index) => {
        const ytf = youtubeTrackDisplayFields(song);
        const displayTitle = getDisplaySongTitle(song.id, ytf.title);
        const displayArtist = getDisplaySongArtist(song.id, ytf.artist);
        const isAliased = hasSongAlias(songAliases, song.id);
        const validation = validateSongTitleSync(displayTitle, ytf.title);
        const validationColor = getValidationColor(validation);
        const validationMessage = getValidationMessage(validation);
        const isCurrent = currentSongId === song.id;
        const isPlayed = !isCurrent && (playedSongIds?.has(song.id) ?? false);
        const isLowConfidence = validation.confidence < 0.7;

        return (
          <div
            key={`${song.id}-${index}`}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            role="listitem"
            className={`bingo-pool-list__row${isCurrent ? ' bingo-pool-list__row--current' : ''}${
              isPlayed ? ' bingo-pool-list__row--played' : ''
            }${isLowConfidence ? ' bingo-pool-list__row--warn' : ''}`}
            title={`Song Title Comparison:

Original: "${song.name}"
Cleaned: "${displayTitle}"
${isAliased ? `Alias: "${displayTitle}" — ${displayArtist}` : ''}

${validationMessage}`}
          >
            <span className="bingo-pool-list__status" aria-hidden>
              {isCurrent ? (
                <Play className="bingo-pool-list__status-icon bingo-pool-list__status-icon--now" size={16} />
              ) : isPlayed ? (
                <Check className="bingo-pool-list__status-icon bingo-pool-list__status-icon--played" size={16} />
              ) : (
                <span className="bingo-pool-list__status-dot" />
              )}
            </span>
            <span className="bingo-pool-list__num">#{index + 1}</span>
            <div className="bingo-pool-list__main">
              <div className="bingo-pool-list__title-row">
                <span className="bingo-pool-list__title">{displayTitle}</span>
                {song.explicit === true ? (
                  <SpotifyExplicitBadge size="md" title="Marked explicit on Spotify" />
                ) : null}
                {isAliased ? (
                  <span className="bingo-pool-list__edited">(aliased)</span>
                ) : null}
                {!isAliased && displayTitle !== song.name ? (
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
              <div className="bingo-pool-list__artist">by {displayArtist}</div>
            </div>
            <button
              type="button"
              className="bingo-pool-list__edit btn-secondary"
              onClick={() =>
                onEditSongAlias({ id: song.id, title: song.name || '', artist: song.artist || '' })
              }
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              Alias
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default BingoPoolList;
