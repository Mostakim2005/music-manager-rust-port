<template>
  <div
    class="namida-stacked-player w-full max-w-2xl mx-auto flex flex-col items-center justify-center px-4 py-2 space-y-4"
  >
    <!-- Top Media (Video 16:9 or Artwork Square) -->
    <div class="media-container w-full flex justify-center items-center">
      <!-- Video Mode -->
      <div
        v-if="isVideoMode"
        class="video-wrapper relative w-full aspect-video max-h-[340px] rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10 flex items-center justify-center"
      >
        <video
          ref="videoElRef"
          class="w-full h-full object-contain"
          :src="videoSrc"
          playsinline
          @timeupdate="$emit('videoTimeUpdate', $event)"
          @ended="$emit('videoEnded')"
          @play="$emit('videoPlay')"
          @pause="$emit('videoPause')"
        ></video>
      </div>

      <!-- Audio Cover Mode -->
      <div
        v-else
        class="cover-wrapper relative w-64 sm:w-72 md:w-80 aspect-square rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-black/40 group"
      >
        <img
          v-if="coverUrl"
          :src="coverUrl"
          alt="Album cover"
          class="w-full h-full object-cover select-none transition-transform duration-500 group-hover:scale-102"
        />
        <div
          v-else
          class="w-full h-full flex items-center justify-center bg-neutral-800 text-white/30 text-5xl"
        >
          <i class="ri-disc-line"></i>
        </div>
      </div>
    </div>

    <!-- ONE Synced Lyric Line Directly Beneath Artwork -->
    <div
      class="synced-lyric-container w-full min-h-[56px] flex flex-col items-center justify-center text-center px-4 select-none"
    >
      <transition name="lyric-fade" mode="out-in">
        <div :key="currentLyricText" class="space-y-0.5">
          <div
            class="current-line text-lg sm:text-xl font-semibold text-white/95 tracking-tight line-clamp-1"
          >
            {{ currentLyricText || '♫ ♫ ♫' }}
          </div>
          <div v-if="currentLyricSub" class="text-xs text-emerald-400 font-medium line-clamp-1">
            {{ currentLyricSub }}
          </div>
        </div>
      </transition>
      <!-- Dimmed Next Line -->
      <div class="next-line text-xs sm:text-sm text-white/40 mt-1 line-clamp-1 max-w-md">
        {{ nextLyricText }}
      </div>
    </div>

    <!-- Track Info + Heart -->
    <div class="track-info-row w-full flex items-center justify-between px-2 pt-1">
      <div class="min-w-0 flex-1 pr-4">
        <h2
          class="text-xl sm:text-2xl font-bold tracking-tight text-white truncate"
          :title="song?.name"
        >
          {{ song?.name || 'Unknown Track' }}
        </h2>
        <div class="text-sm text-white/60 truncate mt-0.5">
          <span
            v-for="(artist, idx) in artistList"
            :key="idx"
            class="hover:text-emerald-400 transition cursor-pointer"
            @click="$emit('artistClick', artist.id)"
          >
            {{ artist.name }}{{ idx < artistList.length - 1 ? ' / ' : '' }}
          </span>
        </div>
      </div>

      <!-- Heart / Favorite Button -->
      <button
        type="button"
        class="w-10 h-10 rounded-full flex items-center justify-center text-xl transition cursor-pointer shrink-0 hover:bg-white/10 active:scale-95"
        :class="isFavorite ? 'text-red-500' : 'text-white/60 hover:text-white'"
        :title="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
        @click="$emit('toggleFavorite')"
      >
        <i :class="isFavorite ? 'ri-heart-3-fill' : 'ri-heart-3-line'"></i>
      </button>
    </div>

    <!-- Full-Width Waveform Visualizer (Min Height 56px) -->
    <div class="waveform-section w-full px-2 space-y-1">
      <NamidaWaveformSeekbar
        :file-path="(song as any)?.localPath || (song as any)?.path || ''"
        :current-time="currentTime"
        :duration="duration"
        :accent-color="'#10b981'"
        @seek="$emit('seek', $event)"
      />

      <!-- Time Labels (Tabular numbers) -->
      <div
        class="flex items-center justify-between text-xs font-mono tabular-nums text-white/50 px-1"
      >
        <span>{{ formatVideoTime(currentTime) }}</span>
        <span>{{ formatVideoTime(duration) }}</span>
      </div>
    </div>

    <!-- Big Round Play Controls -->
    <div class="controls-row flex items-center justify-center gap-6 sm:gap-8 pt-2">
      <!-- Shuffle Mode -->
      <button
        type="button"
        class="w-9 h-9 rounded-full flex items-center justify-center text-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
        :class="{ 'text-emerald-400': playMode === 1 }"
        title="Shuffle"
        @click="$emit('togglePlayMode')"
      >
        <i class="ri-shuffle-line"></i>
      </button>

      <!-- Previous -->
      <button
        type="button"
        class="w-12 h-12 rounded-full flex items-center justify-center text-2xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition cursor-pointer"
        title="Previous"
        @click="$emit('prev')"
      >
        <i class="ri-skip-back-fill"></i>
      </button>

      <!-- Big Play / Pause Circle (64px) -->
      <button
        type="button"
        class="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30 transition-all cursor-pointer"
        :title="isPlaying ? 'Pause' : 'Play'"
        @click="$emit('togglePlay')"
      >
        <i class="text-3xl" :class="isPlaying ? 'ri-pause-fill' : 'ri-play-fill pl-1'"></i>
      </button>

      <!-- Next -->
      <button
        type="button"
        class="w-12 h-12 rounded-full flex items-center justify-center text-2xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition cursor-pointer"
        title="Next"
        @click="$emit('next')"
      >
        <i class="ri-skip-forward-fill"></i>
      </button>

      <!-- Repeat Mode -->
      <button
        type="button"
        class="w-9 h-9 rounded-full flex items-center justify-center text-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
        :class="{ 'text-emerald-400': playMode === 0 || playMode === 2 }"
        title="Repeat mode"
        @click="$emit('togglePlayMode')"
      >
        <i :class="playMode === 2 ? 'ri-repeat-one-line' : 'ri-repeat-line'"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { formatVideoTime } from '@/utils/videoQualityHelpers';
import NamidaWaveformSeekbar from '@/components/namida/NamidaWaveformSeekbar.vue';

const props = withDefaults(
  defineProps<{
    song: SongResult;
    isVideoMode?: boolean;
    videoSrc?: string;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
    currentLyricLine?: { text: string; romaText?: string; trText?: string } | null;
    nextLyricLine?: { text: string; romaText?: string; trText?: string } | null;
    isFavorite?: boolean;
    waveformBars?: number[];
    playMode?: number;
  }>(),
  {
    isVideoMode: false,
    videoSrc: '',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    currentLyricLine: null,
    nextLyricLine: null,
    isFavorite: false,
    waveformBars: () => [],
    playMode: 0
  }
);

const emit = defineEmits<{
  (e: 'togglePlay'): void;
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'seek', time: number): void;
  (e: 'toggleFavorite'): void;
  (e: 'togglePlayMode'): void;
  (e: 'artistClick', artistId: number): void;
  (e: 'videoRef', el: HTMLVideoElement | null): void;
  (e: 'videoTimeUpdate', event: Event): void;
  (e: 'videoEnded'): void;
  (e: 'videoPlay'): void;
  (e: 'videoPause'): void;
}>();

const videoElRef = ref<HTMLVideoElement | null>(null);

watch(videoElRef, (el) => {
  emit('videoRef', el);
});

onMounted(() => {
  if (videoElRef.value) {
    emit('videoRef', videoElRef.value);
  }
});

const coverUrl = computed(() => {
  return getImgUrl(props.song?.picUrl, '500y500');
});

const artistList = computed(() => {
  if (Array.isArray(props.song?.ar)) {
    return props.song.ar;
  }
  if (Array.isArray((props.song as any)?.artists)) {
    return (props.song as any).artists;
  }
  return [{ id: 0, name: (props.song as any)?.artist || 'Unknown' }];
});

const currentLyricText = computed(() => {
  return props.currentLyricLine?.text || '';
});

const currentLyricSub = computed(() => {
  const line = props.currentLyricLine;
  if (!line) return '';
  if (line.trText) return line.trText;
  // Romanization echoes the text for Latin-script lyrics; only show it when it
  // is a real transliteration, otherwise the same line renders twice.
  if (line.romaText && line.romaText !== line.text) return line.romaText;
  return '';
});

const nextLyricText = computed(() => {
  return props.nextLyricLine?.text || '';
});

</script>

<style scoped>
.lyric-fade-enter-active,
.lyric-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.lyric-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.lyric-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
