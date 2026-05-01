/** Same-origin BroadcastChannel for host → dedicated YouTube playback window. */

export function getYoutubeHostPlaybackChannelName(roomId: string): string {
  return `got-yt-host-playback-${roomId}`;
}

export type YoutubeHostPlaybackPayload = {
  videoId: string;
  startMs: number;
  snippetSeconds: number;
} | null;

export type YoutubeHostPlaybackChannelMessage =
  | { type: 'playback'; payload: YoutubeHostPlaybackPayload }
  | { type: 'volume'; volume: number }
  | { type: 'REQUEST_SYNC' }
  /** Playback popup/tab mounted — host must hide the corner iframe so only one player runs. */
  | { type: 'POPUP_ACTIVE' }
  /** Playback window going away — host may show the corner player again. */
  | { type: 'POPUP_CLOSING' };
