// src/renderer/services/osMediaSession.ts
import { toPlayableMediaUrl } from '../utils/localMediaUrl';

export function bindOsMediaSessionHandlers(handlers: {
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekTo: (seconds: number) => void;
}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', handlers.onPlay);
  navigator.mediaSession.setActionHandler('pause', handlers.onPause);
  navigator.mediaSession.setActionHandler('previoustrack', handlers.onPrev);
  navigator.mediaSession.setActionHandler('nexttrack', handlers.onNext);
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') {
      handlers.onSeekTo(details.seekTime);
    }
  });
}

export function updateOsMediaMetadata(track: {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  durationSec?: number;
  positionSec?: number;
}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const artworkSrc = track.coverUrl ? toPlayableMediaUrl(track.coverUrl) : '';

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    album: track.album || 'Music Manager',
    artwork: artworkSrc ? [{ src: artworkSrc, sizes: '512x512', type: 'image/jpeg' }] : []
  });

  if (track.durationSec && track.durationSec > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: track.durationSec,
        playbackRate: 1.0,
        position: Math.min(track.durationSec, Math.max(0, track.positionSec ?? 0))
      });
    } catch {
      // Ignore transient position state errors during track load
    }
  }
}
