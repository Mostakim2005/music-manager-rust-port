// src/renderer/composables/useLinkedMediaSync.ts
import { onBeforeUnmount } from 'vue';

export function useLinkedMediaSync(
  getAudioEl: () => HTMLAudioElement | null,
  getVideoEl: () => HTMLVideoElement | null
) {
  let syncInterval: ReturnType<typeof setInterval> | null = null;

  function enforceSyncTick() {
    const audio = getAudioEl();
    const video = getVideoEl();
    if (!audio || !video) return;

    // Strict Architectural Rule: Video is permanently muted slave
    if (!video.muted) video.muted = true;
    if (video.volume !== 0) video.volume = 0;

    if (audio.paused) {
      if (!video.paused) video.pause();
      return;
    }

    if (video.paused && video.readyState >= 2) {
      video.play().catch(() => {});
    }

    const drift = video.currentTime - audio.currentTime;
    const absDrift = Math.abs(drift);

    if (absDrift > 0.45) {
      // Hard seek only when drift exceeds 450ms (e.g., user scrubbed the seekbar)
      video.currentTime = audio.currentTime;
      video.playbackRate = audio.playbackRate;
    } else if (absDrift > 0.035) {
      // Smooth proportional catch-up/slow-down without frame stutter
      const correction = Math.max(-0.035, Math.min(0.035, -drift * 0.25));
      video.playbackRate = Number((audio.playbackRate + correction).toFixed(3));
    } else if (video.playbackRate !== audio.playbackRate) {
      video.playbackRate = audio.playbackRate;
    }
  }

  function startSyncLoop() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(enforceSyncTick, 120);
  }

  function stopSyncLoop() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  onBeforeUnmount(stopSyncLoop);

  return { enforceSyncTick, startSyncLoop, stopSyncLoop };
}
