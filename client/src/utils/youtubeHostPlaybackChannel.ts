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
  | { type: 'REQUEST_SYNC' };
