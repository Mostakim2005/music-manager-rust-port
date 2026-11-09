<template>
  <n-drawer
    v-model:show="isVisible"
    height="100%"
    placement="bottom"
    :style="drawerBaseStyle"
    :to="`#layout-main`"
    :z-index="9998"
  >
    <div
      v-if="
        config.useCustomBackground && config.backgroundMode === 'image' && config.backgroundImage
      "
      class="background-layer"
      :style="backgroundImageStyle"
    ></div>
        <NamidaAmbientCanvas
      v-if="!config.useCustomBackground || config.backgroundMode !== 'solid'"
      :palette="ambientPalette"
      :is-playing="playerStore.isPlay"
    />
    <div id="drawer-target" :class="[config.theme]" class="relative z-10">
      <div
        class="control-left absolute top-8 left-8 z-[9999] flex items-center gap-2"
        :class="{ 'pure-mode': config.pureModeEnabled }"
      >
        <div class="control-btn" @click="closeMusicFull">
          <i class="ri-arrow-down-s-line"></i>
        </div>
        <template v-if="isElectron && !isMobile">
          <div class="control-btn" @click="minimizeWindow">
            <i class="iconfont icon-minisize"></i>
          </div>
          <div class="control-btn" @click="requestClose">
            <i class="iconfont icon-close"></i>
          </div>
        </template>
      </div>

      <div
        class="control-right absolute top-8 right-8 z-[9999]"
        :class="{ 'pure-mode': config.pureModeEnabled }"
      >
        <div
          v-if="hasRomanization"
          class="control-btn control-btn-pill"
          :class="{ 'is-active': config.showRomanization !== false }"
          title="Toggle Romanized / Phonetic Lyrics (Roma)"
          @click="toggleRomanization"
        >
          <span class="text-xs font-semibold">Roma</span>
        </div>

        <div
          v-if="hasTranslation"
          class="control-btn control-btn-pill"
          :class="{ 'is-active': config.showTranslation }"
          title="Toggle Translated Lyrics (Tr)"
          @click="toggleTranslation"
        >
          <span class="text-xs font-semibold">Tr</span>
        </div>

        <!-- Layout Toggle (Side-by-side vs Stacked) -->
        <div
          v-if="!isMobile"
          class="control-btn"
          :title="
            config.layoutMode === 'stacked'
              ? 'Switch to Side-by-side layout'
              : 'Switch to Stacked layout'
          "
          @click="toggleLayoutMode"
        >
          <i
            :class="
              config.layoutMode === 'stacked' ? 'ri-layout-column-line' : 'ri-layout-top-line'
            "
          ></i>
        </div>

        <!-- Save to Disk -->
        <div
          class="control-btn"
          title="Save to disk (Audio, Video, .lrc)"
          @click="showSaveToDiskModal = true"
        >
          <i class="ri-download-2-line"></i>
        </div>

        <!-- Edit Metadata, Artwork & Filename (same editor as the Local Music list) -->
        <div
          v-if="editableLocalEntry"
          class="control-btn"
          title="Edit Metadata, Artwork & Filename"
          @click="openTrackEditor"
        >
          <i class="ri-edit-box-line"></i>
        </div>

        <div
          v-if="!isMobile"
          class="control-btn"
          :class="{ 'is-active': forceShowOffsetStepper }"
          title="Toggle Lyric Timing Offset Control (-100ms / +100ms)"
          @click="forceShowOffsetStepper = !forceShowOffsetStepper"
        >
          <i class="ri-timer-line"></i>
        </div>

        <n-popover v-model:show="settingsPopoverVisible" trigger="click" placement="bottom" raw>
          <template #trigger>
            <div class="control-btn">
              <i class="ri-settings-3-line"></i>
            </div>
          </template>
          <lyric-settings ref="lyricSettingsRef" />
        </n-popover>

        <div class="control-btn" @click="toggleFullScreen">
          <i :class="isFullScreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
        </div>
      </div>

      <transition name="fade">
        <div v-if="showPureModeTip" class="pure-mode-tip-layer">
          <transition name="fade" mode="out-in">
            <div v-if="pureModeTipStep === 1" key="right" class="absolute inset-0">
              <div class="pure-mode-tip-highlight"></div>
              <div class="pure-mode-tip-bubble">
                <div class="pure-mode-tip-content">
                  <i class="ri-cursor-line"></i>
                  <span>{{ t('settings.lyricSettings.pureModeOnboarding') }}</span>
                  <div class="pure-mode-tip-dots">
                    <span class="is-active"></span>
                    <span></span>
                  </div>
                </div>
                <div class="pure-mode-tip-actions">
                  <button
                    type="button"
                    class="pure-mode-tip-btn pure-mode-tip-btn--primary"
                    @click="nextPureModeTipStep"
                  >
                    {{ t('common.nextStep') }}
                  </button>
                </div>
              </div>
            </div>
            <div v-else key="left" class="absolute inset-0">
              <div class="pure-mode-tip-highlight pure-mode-tip-highlight--left"></div>
              <div class="pure-mode-tip-bubble pure-mode-tip-bubble--left">
                <div class="pure-mode-tip-content">
                  <i class="ri-cursor-line"></i>
                  <span>{{ t('settings.lyricSettings.pureModeOnboardingStep2') }}</span>
                  <div class="pure-mode-tip-dots">
                    <span></span>
                    <span class="is-active"></span>
                  </div>
                </div>
                <div class="pure-mode-tip-actions">
                  <button type="button" class="pure-mode-tip-btn" @click="prevPureModeTipStep">
                    {{ t('common.prevStep') }}
                  </button>
                  <button
                    type="button"
                    class="pure-mode-tip-btn pure-mode-tip-btn--primary"
                    @click="finishPureModeTip"
                  >
                    {{ t('common.done') }}
                  </button>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </transition>

      <!-- C5 Stacked (Namida) Layout -->
      <div
        v-if="config.layoutMode === 'stacked'"
        class="stacked-wrapper w-full flex-1 flex items-center justify-center py-6 overflow-y-auto"
      >
        <namida-stacked-player
          :song="playMusic"
          :is-video-mode="playerStore.playbackMode === 'video'"
          :video-src="activeVideoSrc"
          :is-playing="playerStore.isPlay"
          :current-time="nowTime"
          :duration="allTime"
          :current-lyric-line="currentLyricItem"
          :next-lyric-line="nextLyricItem"
          :is-favorite="isFavorite"
          :play-mode="playMode"
          @toggle-play="handleTogglePlay"
          @prev="handlePrev"
          @next="handleNext"
          @seek="handleSeekTime"
          @toggle-favorite="toggleFavorite"
          @toggle-play-mode="togglePlayMode"
          @artist-click="handleArtistClick"
          @video-ref="onStackedVideoRef"
          @video-time-update="onVideoTimeUpdate"
          @video-ended="handleNext"
          @video-play="onVideoPlay"
          @video-pause="onVideoPause"
        />
      </div>

      <!-- Side-by-side Layout (Default, tightened) -->
      <div
        v-else
        class="content-wrapper"
        :class="{ 'compact-mode': config.compactLyrics }"
        :style="{ width: `${config.contentWidth}%` }"
      >
        <div
          v-if="!config.hideCover"
          class="left-side"
          :class="{ 'only-cover': config.hideLyrics }"
        >
          <!-- Video Element (when video mode is active) -->
          <div
            v-if="playerStore.playbackMode === 'video'"
            class="video-container relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10 flex items-center justify-center mb-3"
          >
            <video
              ref="sideVideoRef"
              class="w-full h-full object-contain"
              :src="activeVideoSrc"
              playsinline
              muted
              preload="metadata"
              @timeupdate="onVideoTimeUpdate"
              @ended="handleNext"
              @play="onVideoPlay"
              @pause="onVideoPause"
            ></video>
          </div>
          <!-- 3D Cover (when in audio mode) -->
          <div v-else class="img-container">
            <cover3-d
              ref="PicImgRef"
              :src="getImgUrl(playMusic?.picUrl, '500y500')"
              :loading="playMusic?.playLoading"
              :max-tilt="12"
              :scale="1.03"
              :shine-intensity="0.25"
            />
          </div>

          <!-- Mini lyric lines under the artwork/video: scrollable, click to seek -->
          <div
            v-if="showUnderArtworkLyrics"
            class="single-lyric-under-art my-3 w-full text-center px-4 select-none"
            @wheel.prevent="handleUnderArtWheel"
          >
            <div
              v-for="row in underArtworkLyricLines"
              :key="row.index"
              class="under-art-lyric-line cursor-pointer transition"
              :class="{ 'is-current': row.index === nowIndex }"
              @click="row.item && row.item.startTime !== -1 ? setAudioTime(row.index) : null"
            >
              <div
                class="text-sm font-semibold line-clamp-1"
                :class="row.index === nowIndex ? 'text-white/95' : 'text-white/50'"
              >
                {{ row.item?.text || '♫ ♫ ♫' }}
              </div>
              <div
                v-if="underArtSubLine(row.item)"
                class="text-xs font-medium line-clamp-1 mt-0.5"
                :class="row.index === nowIndex ? 'text-emerald-400' : 'text-emerald-400/40'"
              >
                {{ underArtSubLine(row.item) }}
              </div>
            </div>
            <button
              v-if="isNarrowLayout"
              type="button"
              class="lrc-edit-btn mt-2"
              @click="openLrcEditor"
            >
              <i class="ri-edit-2-line"></i>
              <span>Edit LRC</span>
            </button>
          </div>

          <div class="music-info">
            <div class="music-content-name" v-html="playMusic.name"></div>
            <div class="music-content-singer">
              <n-ellipsis
                class="text-ellipsis"
                line-clamp="2"
                :tooltip="{
                  contentStyle: { maxWidth: '600px' },
                  zIndex: 99999
                }"
              >
                <span
                  v-for="(item, index) in artistList"
                  :key="index"
                  class="cursor-pointer hover:text-green-500"
                  @click="handleArtistClick(item.id)"
                >
                  {{ item.name }}
                  {{ index < artistList.length - 1 ? ' / ' : '' }}
                </span>
              </n-ellipsis>
            </div>
            <simple-play-bar
              v-if="!config.hideMiniPlayBar"
              class="mt-4"
              :pure-mode-enabled="config.pureModeEnabled"
              :isDark="textColors.theme === 'dark'"
            />
          </div>
        </div>

        <div
          v-if="!isNarrowLayout"
          class="right-side"
          :class="{
            center: config.centerLyrics,
            hide: config.hideLyrics,
            'full-width': config.hideCover
          }"
        >
          <n-layout
            ref="lrcSider"
            class="music-lrc"
            :native-scrollbar="false"
            @mouseover="mouseOverLayout"
            @mouseleave="mouseLeaveLayout"
          >
            <div class="music-lrc-container">
              <div
                v-if="config.hideCover"
                class="music-info-header"
                :style="{ textAlign: config.centerLyrics ? 'center' : 'left' }"
              >
                <div class="music-info-name" v-html="playMusic.name"></div>
                <div class="music-info-singer">
                  <span
                    v-for="(item, index) in artistList"
                    :key="index"
                    class="cursor-pointer hover:text-green-500"
                    @click="handleArtistClick(item.id)"
                  >
                    {{ item.name }}
                    {{ index < artistList.length - 1 ? ' / ' : '' }}
                  </span>
                </div>
              </div>
              <div v-if="!supportAutoScroll" class="music-lrc-text no-scroll-tip">
                <span>{{ t('player.lrc.noAutoScroll') }}</span>
              </div>
              <div
                v-for="(item, index) in lrcArray"
                :id="`music-lrc-text-${index}`"
                :key="index"
                class="music-lrc-text"
                :style="getFocusStyle(index)"
                :class="{
                  'now-text': index === nowIndex,
                  'hover-text': item.text && item.startTime !== -1
                }"
                @click="item.startTime !== -1 ? setAudioTime(index) : null"
              >
                <div
                  v-if="config.showLineTimes !== false && lineTimeLabel(item)"
                  class="music-lrc-line-time"
                >
                  {{ lineTimeLabel(item) }}
                </div>
                <div
                  v-if="item.hasWordByWord && item.words && item.words.length > 0"
                  class="word-by-word-lyric"
                >
                  <template v-for="(word, wordIndex) in item.words" :key="wordIndex">
                    <span class="lyric-word" :style="getWordStyle(index, wordIndex, word)">
                      {{ word.text }} </span
                    ><span class="lyric-word" v-if="word.space">&nbsp;</span></template
                  >
                </div>
                <span v-else :style="getLrcStyle(index)">{{ item.text }}</span>
                <div
                  v-if="
                    config.showRomanization !== false &&
                    item.romaText &&
                    item.romaText !== item.text
                  "
                  class="music-lrc-text-roma"
                >
                  {{ item.romaText }}
                </div>
                <div v-show="config.showTranslation" class="music-lrc-text-tr">
                  {{ item.trText }}
                </div>
              </div>

              <div v-if="!lrcArray.length" class="music-lrc-text">
                <span>{{ t('player.lrc.noLrc') }}</span>
              </div>

              <!-- Edit LRC: raw timestamps (mm:ss,ms), per-line ±0.1 s, live follow -->
              <div class="lrc-edit-actions">
                <button type="button" class="lrc-edit-btn" @click="openLrcEditor">
                  <i class="ri-edit-2-line"></i>
                  <span>Edit LRC</span>
                </button>
              </div>
            </div>
          </n-layout>
        </div>
      </div>

      <!-- Offset stepper lives outside the lyric column so it stays reachable
           in narrow layouts too -->
      <lyric-correction-control
        v-if="!isMobile"
        :correction-time="correctionTime"
        :force-visible="forceShowOffsetStepper"
        @adjust="adjustCorrectionTime"
        @set="handleSetCorrectionTime"
      />

      <!-- Glass warning: audio/video length mismatch (different versions) -->
      <transition name="fade">
        <div
          v-if="lengthMismatchWarning"
          class="length-mismatch-warning absolute top-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-4 py-2.5 rounded-2xl"
        >
          <i class="ri-error-warning-line text-amber-300"></i>
          <span class="text-xs text-white/90">{{ lengthMismatchWarning }}</span>
          <button
            type="button"
            class="opacity-70 hover:opacity-100 transition cursor-pointer"
            aria-label="Dismiss length mismatch warning"
            @click="dismissLengthMismatch"
          >
            <i class="ri-close-line"></i>
          </button>
        </div>
      </transition>

      <!-- C1 Video Pill (bottom-left of fullscreen player) -->
      <div
        class="video-pill-wrapper absolute bottom-24 left-6 z-[9998] flex items-center"
        :class="{ 'pure-mode': config.pureModeEnabled }"
      >
        <div
          class="flex items-center bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/10 rounded-full p-1 shadow-lg transition"
        >
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer select-none"
            :class="
              playerStore.playbackMode === 'video'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-white/80 hover:text-white'
            "
            title="Toggle Audio ⇄ Video mode"
            :disabled="isSwitchingMode"
            @click="toggleAudioVideoMode"
          >
            <span class="text-sm leading-none">{{ playbackModeIcon }}</span>
            <span>{{ playbackModeLabel }}</span>
            <span class="text-[10px] opacity-75">•</span>
            <span class="text-[11px] font-mono opacity-90">{{ videoPillBadge }}</span>
          </button>
          <button
            type="button"
            class="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Video source options & qualities"
            @click="openVideoSourcePopover"
          >
            <i class="ri-more-line text-sm"></i>
          </button>
        </div>
      </div>

      <!-- C2 Video Source Popover -->
      <video-source-popover
        v-model:visible="videoPopoverVisible"
        :initial-tab="videoPopoverInitialTab"
        :song="playMusic"
        :is-video-mode="playerStore.playbackMode === 'video'"
        :selected-height="selectedVideoHeight"
        :current-youtube-id="currentYoutubeId"
        :variants="currentVariants"
        :song-record="currentSongRecord"
        @set-mode="handleSetMode"
        @select-quality="handleSelectQuality"
        @linked-youtube="handleLinkedYoutube"
        @play-variant="handlePlayVariant"
        @variants-updated="refreshSongVariants"
      />

      <!-- C6 Save to Disk Modal -->
      <save-to-disk-modal
        v-model:visible="showSaveToDiskModal"
        :song="playMusic"
        :youtube-id="currentYoutubeId"
        :lrc-string="rawLrcString"
        :song-id="currentSongRecord?.id"
        @saved-media="refreshSongVariants"
      />

      <!-- Edit LRC: raw timestamps (mm:ss,ms), per-line ±0.1 s edits that
           follow playback live -->
      <lrc-synchronizer-modal
        v-model:show="showLrcEditor"
        :initial-lyrics="rawLrcString"
        :file-path="currentLyricFilePath"
        :track="playMusic"
        :current-time-getter="getCurrentPlayTime"
        @apply="handleApplyEditedLrc"
      />

      <!-- In-player metadata editor (identical to the Local Music list button) -->
      <local-track-editor-modal
        v-model:show="showTrackEditor"
        :entry="editingEntry"
        @saved="handleTrackSaved"
      />

      <close-app-confirm-modal
        v-model:show="showCloseModal"
        v-model:remember-choice="rememberChoice"
        @action="confirmCloseAction"
      />
    </div>
  </n-drawer>
</template>

<script setup lang="ts">
import { useDebounceFn, useThrottleFn } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CloseAppConfirmModal from '@/components/common/CloseAppConfirmModal.vue';
import LocalTrackEditorModal from '@/components/common/LocalTrackEditorModal.vue';
import LrcSynchronizerModal from '@/components/common/LrcSynchronizerModal.vue';
import Cover3D from '@/components/cover/Cover3D.vue';
import LyricCorrectionControl from '@/components/lyric/LyricCorrectionControl.vue';
import LyricSettings from '@/components/lyric/LyricSettings.vue';
import NamidaStackedPlayer from '@/components/player/NamidaStackedPlayer.vue';
import SaveToDiskModal from '@/components/player/SaveToDiskModal.vue';
import SimplePlayBar from '@/components/player/SimplePlayBar.vue';
import VideoSourcePopover from '@/components/player/VideoSourcePopover.vue';
import {
  adjustCorrectionTime,
  allTime,
  artistList,
  correctionTime,
  lrcArray,
  lrcTimeArray,
  nowIndex,
  nowTime,
  playMusic,
  registerVideoSeekHandler,
  setAudioTime,
  setCorrectionTime,
  textColors,
  useLyricProgress
} from '@/hooks/MusicHook';
import { useArtist } from '@/hooks/useArtist';
import { useFavorite } from '@/hooks/useFavorite';
import { useLocalTrackEditor } from '@/hooks/useLocalTrackEditor';
import { useLyricBackground } from '@/hooks/useLyricBackground';
import { usePlaybackControl } from '@/hooks/usePlaybackControl';
import { usePlayMode } from '@/hooks/usePlayMode';
import { useWindowControls } from '@/hooks/useWindowControls';
import { audioService } from '@/services/audioService';
import { currentMediaOwner, mediaCoordinator } from '@/services/mediaCoordinator';
import {
  findSongByPath,
  getSong,
  getSongKey,
  getVariants,
  savePosition,
  setYoutubeId,
  type Song,
  type Variant
} from '@/services/songLibrary';
import { youtubeService } from '@/services/youtubeService';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';
import { DEFAULT_LYRIC_CONFIG, LyricConfig } from '@/types/lyric';
import type { ILyricText } from '@/types/music';
import { getImgUrl, isElectron, isMobile } from '@/utils';
import { getTextColors } from '@/utils/linearColor';
import NamidaAmbientCanvas from '@/components/namida/NamidaAmbientCanvas.vue';
import { useLinkedMediaSync } from '@/composables/useLinkedMediaSync';
import { filePathToMediaUrl } from '@/utils/localMediaUrl';
import { LYRIC_CONFIG_CHANGE_EVENT, readLyricConfig, writeLyricConfig } from '@/utils/lyricConfig';
import { formatLrcTimestamp, formatLrcTimestampMs } from '@/utils/lyrics';

const { t } = useI18n();
const lrcSider = ref<any>(null);
const isMouse = ref(false);
const { currentBackground, applyBackground } = useLyricBackground();

const customBackgroundStyle = computed(() => {
  if (!config.value.useCustomBackground) {
    return null;
  }

  switch (config.value.backgroundMode) {
    case 'solid':
      return config.value.solidColor;
    case 'gradient': {
      const { colors, direction } = config.value.gradientColors;
      return `linear-gradient(${direction}, ${colors.join(', ')})`;
    }
    case 'image':
      if (!config.value.backgroundImage) return null;
      return config.value.backgroundImage;
    case 'css':
      return config.value.customCss || null;
    default:
      return null;
  }
});

const drawerBaseStyle = computed(() => {
  if (config.value.useCustomBackground && config.value.backgroundMode === 'image') {
    return { background: 'transparent' };
  }
  if (config.value.useCustomBackground && customBackgroundStyle.value) {
    return { background: customBackgroundStyle.value };
  }
  return { background: currentBackground.value || props.background };
});

const backgroundImageStyle = computed(() => {
  const blur = config.value.imageBlur || 0;
  const brightness = config.value.imageBrightness || 100;
  return {
    backgroundImage: `url(${config.value.backgroundImage})`,
    filter: `blur(${blur}px) brightness(${brightness}%)`
  };
});
const showStickyHeader = ref(false);
const lyricSettingsRef = ref<InstanceType<typeof LyricSettings>>();
const isSongChanging = ref(false);
const isFullScreen = ref(false);
const forceShowOffsetStepper = ref(false);

const config = ref<LyricConfig>({ ...DEFAULT_LYRIC_CONFIG });

const hasRomanization = computed(() => {
  return lrcArray.value.some((item) => Boolean(item.romaText && item.romaText.trim()));
});

const hasTranslation = computed(() => {
  return lrcArray.value.some((item) => Boolean(item.trText && item.trText.trim()));
});

const toggleRomanization = () => {
  const current = config.value.showRomanization !== false;
  config.value = {
    ...config.value,
    showRomanization: !current
  };
};

const toggleTranslation = () => {
  config.value = {
    ...config.value,
    showTranslation: !config.value.showTranslation
  };
};

const toggleLayoutMode = () => {
  const current = config.value.layoutMode || 'side-by-side';
  const newMode = current === 'stacked' ? 'side-by-side' : 'stacked';
  config.value = {
    ...config.value,
    layoutMode: newMode
  };
  writeLyricConfig(config.value);
};

watch(
  () => lyricSettingsRef.value?.config,
  (newConfig) => {
    if (newConfig) {
      config.value = newConfig;
    }
  },
  { deep: true, immediate: true }
);

watch(
  () => config.value,
  (newConfig) => {
    writeLyricConfig(newConfig);
    if (lyricSettingsRef.value) {
      lyricSettingsRef.value.config = newConfig;
    }
  },
  { deep: true }
);

const handleLyricConfigChange = () => {
  const nextConfig = readLyricConfig();
  if (JSON.stringify(nextConfig) !== JSON.stringify(config.value)) {
    config.value = nextConfig;
  }
};

const PURE_MODE_ONBOARDED_KEY = 'pureModeOnboarded';
const settingsPopoverVisible = ref(false);
const showPureModeTip = ref(false);
const pureModeTipStep = ref(1);
const pendingPureModeTip = ref(false);

const showPureModeTipStep = (step: number) => {
  pureModeTipStep.value = step;
  showPureModeTip.value = true;
};

const displayPureModeTip = () => {
  pendingPureModeTip.value = false;
  localStorage.setItem(PURE_MODE_ONBOARDED_KEY, 'true');
  showPureModeTipStep(1);
};

const prevPureModeTipStep = () => {
  if (pureModeTipStep.value > 1) {
    showPureModeTipStep(1);
  }
};

const nextPureModeTipStep = () => {
  if (pureModeTipStep.value < 2) {
    showPureModeTipStep(2);
  }
};

const finishPureModeTip = () => {
  showPureModeTip.value = false;
};

const showPureModeOnboarding = () => {
  if (!isVisible.value || localStorage.getItem(PURE_MODE_ONBOARDED_KEY)) return;
  if (settingsPopoverVisible.value) {
    pendingPureModeTip.value = true;
    return;
  }
  displayPureModeTip();
};

watch(settingsPopoverVisible, (visible) => {
  if (!visible && pendingPureModeTip.value && isVisible.value) {
    displayPureModeTip();
  }
});

watch(
  () => config.value.pureModeEnabled,
  (newValue, oldValue) => {
    if (newValue && !oldValue) {
      showPureModeOnboarding();
    }
  }
);

const supportAutoScroll = computed(() => {
  return lrcArray.value.length > 0 && lrcArray.value[0].startTime !== -1;
});

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  background: {
    type: String,
    default: ''
  }
});

const themeMusic = {
  light: 'linear-gradient(to bottom, #ffffff, #f5f5f5)',
  dark: 'linear-gradient(to bottom, #1a1a1a, #000000)'
};

const emit = defineEmits(['update:modelValue']);

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const lrcScroll = (behavior: ScrollBehavior = 'smooth', forceTop: boolean = false) => {
  if (!isVisible.value || !lrcSider.value || !supportAutoScroll.value) return;

  if (forceTop) {
    lrcSider.value.scrollTo({
      top: 0,
      behavior
    });
    return;
  }

  if (isMouse.value) return;

  const nowEl = document.querySelector(`#music-lrc-text-${nowIndex.value}`) as HTMLElement;
  if (nowEl) {
    const containerHeight = lrcSider.value.$el.clientHeight;
    const elementTop = nowEl.offsetTop;
    const scrollTop = elementTop - containerHeight / 2 + nowEl.clientHeight / 2;

    lrcSider.value.scrollTo({
      top: scrollTop,
      behavior
    });
  }
};

const debouncedLrcScroll = useDebounceFn(lrcScroll, 200);

const mouseOverLayout = () => {
  if (isMobile.value) {
    return;
  }
  isMouse.value = true;
};

const mouseLeaveLayout = () => {
  if (isMobile.value) {
    return;
  }
  setTimeout(() => {
    isMouse.value = false;
    lrcScroll();
  }, 2000);
};

watch(nowIndex, () => {
  if (isSongChanging.value) return;
  debouncedLrcScroll();
});

watch(
  () => isVisible.value,
  () => {
    if (isVisible.value) {
      if (config.value.pureModeEnabled) {
        showPureModeOnboarding();
      }
      nextTick(() => {
        lrcScroll('instant');
      });
    } else {
      showPureModeTip.value = false;
    }
  }
);

const targetBackground = computed(() => {
  if (config.value.useCustomBackground && customBackgroundStyle.value) {
    if (typeof customBackgroundStyle.value === 'string') {
      return customBackgroundStyle.value;
    }
  }
  if (config.value.theme !== 'default') {
    return themeMusic[config.value.theme] || props.background;
  }
  return props.background;
});

watch(
  targetBackground,
  (newBg) => {
    if (newBg) {
      applyBackground(newBg);
    }
  },
  { immediate: true }
);

const { getLrcStyle: originalLrcStyle } = useLyricProgress();

const getLrcStyle = (index: number) => {
  const colors = textColors.value || getTextColors();
  const originalStyle = originalLrcStyle(index);
  const focusOn = config.value.focusCurrentLyric;

  if (index === nowIndex.value) {
    if (originalStyle.backgroundImage) {
      return {
        ...originalStyle,
        backgroundImage: originalStyle.backgroundImage
          .replace(/#ffffff/g, colors.active)
          .replace(/#ffffff8a/g, `${colors.primary}`),
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent'
      };
    } else {
      return {
        color: focusOn ? colors.active : colors.primary
      };
    }
  }

  return {
    color: colors.primary
  };
};

const FOCUS_LINE_LEVELS = [
  { opacity: 1, blur: 0 },
  { opacity: 0.5, blur: 1 },
  { opacity: 0.32, blur: 1.9 },
  { opacity: 0.22, blur: 2.8 }
];

const getFocusStyle = (index: number) => {
  if (!config.value.focusCurrentLyric) return {};

  const colors = textColors.value || getTextColors();
  const distance = Math.abs(index - nowIndex.value);
  const level = FOCUS_LINE_LEVELS[Math.min(distance, FOCUS_LINE_LEVELS.length - 1)];

  return {
    opacity: level.opacity,
    filter: distance === 0 ? `drop-shadow(0 0 12px ${colors.active}4d)` : `blur(${level.blur}px)`,
    transform: `scale(${distance === 0 ? 1.06 : 1})`,
    transition:
      'opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1), filter 0.55s cubic-bezier(0.4, 0, 0.2, 1), transform 0.55s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease'
  };
};

const getWordStyle = (lineIndex: number, _wordIndex: number, word: any) => {
  const colors = textColors.value || getTextColors();
  if (lineIndex !== nowIndex.value) {
    return {
      color: colors.primary,
      transition: 'color 0.3s ease',
      backgroundImage: 'none',
      WebkitTextFillColor: 'initial'
    };
  }

  const currentTime = (nowTime.value + correctionTime.value) * 1000;

  const wordStartTime = word.startTime;
  const wordEndTime = word.startTime + word.duration;

  if (currentTime >= wordStartTime && currentTime < wordEndTime) {
    const progress = Math.min((currentTime - wordStartTime) / word.duration, 1);
    const progressPercent = Math.round(progress * 100);

    return {
      backgroundImage: `linear-gradient(to right, ${colors.active} 0%, ${colors.active} ${progressPercent}%, ${colors.primary} ${progressPercent}%, ${colors.primary} 100%)`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      textShadow: `0 0 8px ${colors.active}40`,
      transition: 'all 0.1s ease'
    };
  } else if (currentTime >= wordEndTime) {
    return {
      color: colors.active,
      WebkitTextFillColor: 'initial',
      transition: 'none'
    };
  } else {
    return {
      color: colors.primary,
      WebkitTextFillColor: 'initial',
      transition: 'none'
    };
  }
};

const settingsStore = useSettingsStore();

const { navigateToArtist } = useArtist();

const handleArtistClick = (id: number) => {
  isVisible.value = false;
  navigateToArtist(id);
};

const setData = computed(() => settingsStore.setData);

watch(
  () => [setData.value.fontFamily, setData.value.fontScope],
  ([newFont, fontScope]) => {
    const defaultFonts =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    if (fontScope !== 'lyric' && fontScope !== 'global') {
      document.documentElement.style.setProperty('--current-font-family', defaultFonts);
      return;
    }

    if (newFont === 'system-ui') {
      document.documentElement.style.setProperty('--current-font-family', defaultFonts);
    } else {
      const fontList = newFont.split(',').map((font) => {
        const trimmedFont = font.trim();
        return /[\s'"()]/.test(trimmedFont) && !/^['"].*['"]$/.test(trimmedFont)
          ? `"${trimmedFont}"`
          : trimmedFont;
      });

      document.documentElement.style.setProperty(
        '--current-font-family',
        `${fontList.join(', ')}, ${defaultFonts}`
      );
    }
  },
  { immediate: true }
);

const handleScroll = () => {
  if (!lrcSider.value || !config.value.hideCover) return;
  const { scrollTop } = lrcSider.value.$el;
  showStickyHeader.value = scrollTop > 100;
};

const playerStore = usePlayerStore();

// Playback & mode hooks
const { isFavorite, toggleFavorite } = useFavorite();
const { playMode, togglePlayMode } = usePlayMode();
const { handlePrev, handleNext } = usePlaybackControl();

// Video & Popover state
const sideVideoRef = ref<HTMLVideoElement | null>(null);
const stackedVideoRef = ref<HTMLVideoElement | null>(null);

const onStackedVideoRef = (el: HTMLVideoElement | null) => {
  stackedVideoRef.value = el;
};

const activeVideoElement = computed<HTMLVideoElement | null>(() => {
  if (config.value.layoutMode === 'stacked') {
    return stackedVideoRef.value;
  }
  return sideVideoRef.value;
});

const activeVideoSrc = ref<string>('');
const activeMuxedBase = ref<string | null>(null);
const videoSeekOffset = ref(0);
const videoIsMuxed = ref(false);
const isSwitchingMode = ref(false);
const selectedVideoHeight = ref<number>(720);
const currentYoutubeId = ref<string>('');
const currentVariants = ref<Variant[]>([]);
const currentSongRecord = ref<Song | undefined>(undefined);

const videoPopoverVisible = ref(false);
const videoPopoverInitialTab = ref<'playback' | 'search' | 'link' | 'qualities' | 'linked'>(
  'playback'
);
const showSaveToDiskModal = ref(false);

const playbackModeLabel = computed(() =>
  playerStore.playbackMode === 'video' ? 'Video' : 'Audio'
);

const playbackModeIcon = computed(() => (playerStore.playbackMode === 'video' ? '🎬' : '🎵'));

const videoPillBadge = computed(() => {
  if (playerStore.playbackMode !== 'video') {
    // Audio mode: show the audio detail instead of a crossed-out "Video".
    const audioVariant = currentVariants.value.find((v) => v.kind === 'audio' && v.bitrateKbps);
    return audioVariant?.bitrateKbps ? `${Math.round(audioVariant.bitrateKbps)} kb/s` : '—';
  }
  if (selectedVideoHeight.value) {
    return `${selectedVideoHeight.value}p`;
  }
  return 'Active';
});

// Lyric line accessors for stacked/single-line modes
const currentLyricItem = computed(() => {
  if (!lrcArray.value || nowIndex.value < 0 || nowIndex.value >= lrcArray.value.length) {
    return null;
  }
  return lrcArray.value[nowIndex.value];
});

const nextLyricItem = computed(() => {
  if (!lrcArray.value || nowIndex.value + 1 >= lrcArray.value.length) {
    return null;
  }
  return lrcArray.value[nowIndex.value + 1];
});

// --- Responsive layout & under-artwork mini lyrics --------------------------
// The side lyrics column only renders when the window is wide enough for it.
// Below that the lyrics appear as a short scrollable strip under the artwork /
// video instead of dropping the whole column under it (which looked broken).
const isNarrowLayout = ref(false);
const measureLayoutWidth = () => {
  isNarrowLayout.value = window.innerWidth < 1024;
};

const showUnderArtworkLyrics = computed(
  () =>
    !config.value.hideLyrics && (Boolean(config.value.lyricsUnderArtwork) || isNarrowLayout.value)
);

const UNDER_ART_LINE_COUNT = 3;
const underArtScrollOffset = ref(0);

const underArtworkLyricLines = computed(() => {
  const arr = lrcArray.value || [];
  if (!arr.length) {
    return [{ index: -1, item: null as ILyricText | null }];
  }
  const center = Math.min(
    Math.max((nowIndex.value >= 0 ? nowIndex.value : 0) + underArtScrollOffset.value, 0),
    arr.length - 1
  );
  const start = Math.max(0, Math.min(center - 1, arr.length - UNDER_ART_LINE_COUNT));
  const lines: { index: number; item: ILyricText | null }[] = [];
  for (let i = 0; i < UNDER_ART_LINE_COUNT; i++) {
    const idx = start + i;
    if (idx < arr.length) lines.push({ index: idx, item: arr[idx] });
  }
  return lines;
});

const handleUnderArtWheel = (e: WheelEvent) => {
  const arr = lrcArray.value || [];
  if (arr.length <= UNDER_ART_LINE_COUNT) return;
  const delta = e.deltaY > 0 ? 1 : -1;
  underArtScrollOffset.value = Math.max(
    -arr.length,
    Math.min(arr.length, underArtScrollOffset.value + delta)
  );
};

// Translation first; romanization only when it actually differs — for
// Latin-script lyrics detectScriptAndRomanize() echoes the input, which is why
// the same line used to render twice under the artwork.
const underArtSubLine = (item: ILyricText | null | undefined): string => {
  if (!item) return '';
  if (item.trText) return item.trText;
  if (item.romaText && item.romaText !== item.text) return item.romaText;
  return '';
};

// --- Edit LRC ---------------------------------------------------------------
const showLrcEditor = ref(false);

// Glass warning shown when the linked video and the audio file have different
// lengths — a sign of different versions, which also affects lyric matching.
const lengthMismatchWarning = ref<string | null>(null);
let lengthMismatchTimer: number | null = null;

const dismissLengthMismatch = () => {
  lengthMismatchWarning.value = null;
  if (lengthMismatchTimer) {
    window.clearTimeout(lengthMismatchTimer);
    lengthMismatchTimer = null;
  }
};

const checkMediaLengthMismatch = (el: HTMLVideoElement) => {
  const videoDuration = Number.isFinite(el.duration) ? el.duration + videoSeekOffset.value : NaN;
  const audioDuration = allTime.value;
  if (!Number.isFinite(videoDuration) || !Number.isFinite(audioDuration) || audioDuration <= 0) {
    return;
  }
  const delta = Math.round(Math.abs(videoDuration - audioDuration));
  if (delta > 3) {
    lengthMismatchWarning.value = `Audio/video lengths differ by ${delta}s — likely different versions. Lyrics and sync can be affected.`;
    if (lengthMismatchTimer) window.clearTimeout(lengthMismatchTimer);
    lengthMismatchTimer = window.setTimeout(() => {
      lengthMismatchWarning.value = null;
      lengthMismatchTimer = null;
    }, 10000);
  } else {
    dismissLengthMismatch();
  }
};

const currentLyricFilePath = computed(() => {
  return (playMusic.value as any)?.localPath || (playMusic.value as any)?.path || undefined;
});

const openLrcEditor = () => {
  showLrcEditor.value = true;
};

const getCurrentPlayTime = () => nowTime.value;

// Per-line start time in "mm:ss,ms" — lets the user compare the first lyric
// against the seek bar to spot mismatched auto-found lyrics.
const lineTimeLabel = (item: ILyricText | null | undefined): string => {
  if (!item || item.startTime === undefined || item.startTime < 0) return '';
  return formatLrcTimestampMs(item.startTime / 1000);
};

/**
 * Applies the edited raw LRC to the live player immediately: the lyric panel,
 * the mini strip and the shared clock all reflect the edit without a reload.
 * Timestamps are parsed from both "[mm:ss.xx]" and the ms form "[mm:ss,ms]".
 */
const handleApplyEditedLrc = (lrcText: string) => {
  const parsed: ILyricText[] = [];
  const times: number[] = [];
  for (const rawLine of String(lrcText || '').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*\[(\d+):(\d+)(?:[.,](\d+))?\]\s*(.*)$/);
    if (!match) {
      if (rawLine.trim()) {
        parsed.push({ text: rawLine.trim(), trText: '', startTime: -1 });
      }
      continue;
    }
    const fracRaw = (match[3] || '0').slice(0, 3).padEnd(3, '0');
    const seconds =
      parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(fracRaw, 10) / 1000;
    parsed.push({ text: match[4] || '', trText: '', startTime: Math.round(seconds * 1000) });
    times.push(seconds);
  }
  lrcArray.value = parsed;
  lrcTimeArray.value = times;
};

// --- In-player metadata editor (same tool as the Local Music list) ---------
const { showTrackEditor, editingEntry, editableLocalEntry, openTrackEditor, handleTrackSaved } =
  useLocalTrackEditor(playMusic);

const rawLrcString = computed(() => {
  if (!lrcArray.value || lrcArray.value.length === 0) return '';
  return lrcArray.value
    .map((item) => {
      // startTime is milliseconds; serialize as extended LRC "[mm:ss.xxx]".
      const startSec = (item.startTime ?? 0) / 1000;
      return `${formatLrcTimestamp(startSec, 3)} ${item.text || ''}`;
    })
    .join('\n');
});

// Linked A/V slave control: the muted video follows the shared play state and
// yields whenever another surface (MV drawer, PiP) claims playback. It is
// deliberately NOT registered with the media coordinator — a muted video is
// not an audible surface and must never claim playback exclusivity from the
// audio element it is linked to.

const ambientPalette = computed<string[]>(() => {
  const p = (playMusic.value as any)?.paletteHex;
  if (Array.isArray(p) && p.length > 0) return p;
  const primary = (playMusic.value as any)?.primaryColor;
  const bg = (playMusic.value as any)?.backgroundColor;
  if (primary && bg) return [primary, bg, '#6366f1', '#1e1b4b'];
  return ['#6366f1', '#8b5cf6', '#ec4899', '#1e1b4b'];
});

const { enforceSyncTick, startSyncLoop, stopSyncLoop } = useLinkedMediaSync(
  () => audioService.getAudioElement(),
  () => activeVideoElement.value
);

watch(
  () => [playerStore.playbackMode, activeVideoSrc.value],
  ([mode, src]) => {
    if (mode === 'video' && src) {
      startSyncLoop();
    } else {
      stopSyncLoop();
    }
  },
  { immediate: true }
);

const syncVideoSlaveState = () => {
  const el = activeVideoElement.value;
  if (!el || playerStore.playbackMode !== 'video' || !activeVideoSrc.value) return;
  enforceSyncTick();
  el.muted = true;
  const owner = currentMediaOwner.value;
  const yielded = Boolean(owner && owner !== 'audioService');
  const shouldPlay = playerStore.isPlay && !yielded;
  if (shouldPlay && el.paused) {
    el.play().catch(() => {});
  } else if (!shouldPlay && !el.paused) {
    suppressVideoPauseSync = true;
    el.pause();
    suppressVideoPauseSync = false;
  }
};

watch(activeVideoElement, (el) => {
  if (el) {
    el.muted = true;
  }
  syncVideoSlaveState();
});

watch(
  () => playerStore.isPlay,
  () => syncVideoSlaveState()
);
watch(
  () => currentMediaOwner.value,
  () => syncVideoSlaveState()
);

// Lyric clicks must seek the element that is actually playing.
registerVideoSeekHandler((time) => {
  void seekVideoTo(time);
});

onBeforeUnmount(() => {
  registerVideoSeekHandler(null);
  const el = activeVideoElement.value;
  if (el && !el.paused) {
    el.pause();
  }
});

// Video events
// Linked A/V mode: the video element is muted and follows the audio element,
// so its own play/pause events never drive the shared play state.
const onVideoPlay = () => {
  const videoEl = activeVideoElement.value;
  if (videoEl) {
    videoEl.muted = true;
  }
};

let suppressVideoPauseSync = false;
// While a seek is being applied the element still reports the old time; ignore
// those ticks so the progress bar does not snap back to the previous position.
let suppressVideoTimeUpdatesUntil = 0;

const onVideoPause = () => {
  if (suppressVideoPauseSync || isSwitchingMode.value) return;
  // The video is a slave: if it stopped on its own (end/error) the shared
  // state follows the audio, which stays authoritative.
};

const onVideoTimeUpdate = (e: Event) => {
  const video = e.target as HTMLVideoElement;
  if (!video) return;
  if (Date.now() < suppressVideoTimeUpdatesUntil) return;
  const absoluteTime = videoSeekOffset.value + video.currentTime;

  const currentSound = audioService.getCurrentSound();
  const audioIsMaster = Boolean(
    currentSound &&
    audioService.getCurrentTrack()?.id === playMusic.value.id &&
    !currentSound.paused
  );
  if (audioIsMaster) {
    // Drift correction only: the video follows the audio clock, so audio and
    // video always share the same duration and playback time by construction.
    const drift = Math.abs(absoluteTime - currentSound!.currentTime);
    if (drift > 0.75) {
      try {
        video.currentTime = Math.max(0, currentSound!.currentTime - videoSeekOffset.value);
      } catch {
        // Stream not seekable yet; the next tick will retry.
      }
    }
    return;
  }

  nowTime.value = absoluteTime;
  saveVideoPositionThrottled(absoluteTime);
};

const saveVideoPositionThrottled = useThrottleFn((time: number) => {
  const key = getSongKey(playMusic.value);
  if (key) {
    savePosition(key, time);
  }
}, 3000);

// Toggle play/pause for both surfaces together. The audio element is the
// master; the muted video follows it through the isPlay slave watcher, so one
// button can never stop the video while the audio keeps playing (or the
// reverse) again.
const handleTogglePlay = () => {
  if (playerStore.isPlay) {
    playerStore.handlePause();
  } else {
    void playerStore.setPlayMusic(true);
  }
};

const handleSeekTime = (time: number) => {
  if (!Number.isFinite(time)) return;
  const target = Math.max(0, time);

  if (playerStore.playbackMode === 'video') {
    void seekVideoTo(target);
    return;
  }

  audioService.seek(target);
  nowTime.value = target;
  const key = getSongKey(playMusic.value);
  if (key) {
    savePosition(key, target);
  }
};

const handleSetCorrectionTime = (value: number) => {
  setCorrectionTime(value);
  if (playerStore.playbackMode === 'video') {
    const video = activeVideoElement.value;
    if (video) {
      nowTime.value = videoSeekOffset.value + video.currentTime;
    }
  }
};

// --- Video loading / seeking ---------------------------------------------
const withStreamStart = (base: string, start: number) => {
  try {
    const url = new URL(base);
    if (start > 0) url.searchParams.set('start', String(Math.floor(start)));
    else url.searchParams.delete('start');
    return url.toString();
  } catch {
    return base;
  }
};

const waitForVideoReady = (el: HTMLVideoElement, timeoutMs = 20000) =>
  new Promise<void>((resolve) => {
    if (el.readyState >= 1) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('loadedmetadata', finish);
      el.removeEventListener('error', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    el.addEventListener('loadedmetadata', finish);
    el.addEventListener('error', finish);
  });

/**
 * Enters video mode in linked A/V style: the audio element keeps playing as
 * the master clock and sound source, and the muted video joins it at the same
 * position once its metadata is ready. Nothing is paused and no crossfade is
 * started, so switching modes has no audible gap. Setting `currentTime` on a
 * freshly-assigned src is silently dropped, which is why sync is applied after
 * `loadedmetadata`.
 */
const enterVideoMode = async (src: string, muxedBase: string | null, carryTime?: number) => {
  isSwitchingMode.value = true;
  const startAt = typeof carryTime === 'number' ? carryTime : audioService.getCurrentTime();
  playerStore.setPlaybackMode('video', startAt);

  videoIsMuxed.value = Boolean(muxedBase);
  activeMuxedBase.value = muxedBase;
  videoSeekOffset.value = muxedBase ? Math.max(0, Math.floor(startAt)) : 0;
  activeVideoSrc.value = muxedBase ? withStreamStart(muxedBase, videoSeekOffset.value) : src;

  try {
    await nextTick();
    const el = activeVideoElement.value;
    if (!el) return;
    el.muted = true;

    await waitForVideoReady(el);

    // Re-read the clock after the wait: the audio advanced while the stream
    // resolved, and syncing to the stale start value caused visible drift.
    const masterTime = audioService.getCurrentTime() || startAt;
    const relative = Math.max(0, masterTime - videoSeekOffset.value);
    if (relative > 0.05) {
      try {
        el.currentTime = relative;
      } catch {
        // Stream not buffered yet; playback still starts from its first frame.
      }
    }
    nowTime.value = muxedBase ? videoSeekOffset.value + el.currentTime : masterTime;
    suppressVideoTimeUpdatesUntil = Date.now() + 300;
    checkMediaLengthMismatch(el);

    if (playerStore.isPlay) {
      try {
        await el.play();
      } catch (err) {
        console.warn('[MusicFull] Autoplay error:', err);
      }
    }
  } finally {
    isSwitchingMode.value = false;
    syncVideoSlaveState();
  }
};

const seekVideoTo = async (target: number) => {
  const absolute = Math.max(0, target);
  nowTime.value = absolute;
  suppressVideoTimeUpdatesUntil = Date.now() + 300;
  const key = getSongKey(playMusic.value);
  if (key) savePosition(key, absolute);

  // Linked A/V: the audio is the master, so it must seek together with the
  // video (lyric clicks, progress bar and video seeks all land here).
  try {
    audioService.seek(absolute);
  } catch {
    // ignore
  }

  const el = activeVideoElement.value;
  if (!el) return;

  const isSeekable = (() => {
    try {
      return el.seekable.length > 0;
    } catch {
      return false;
    }
  })();

  // A DASH stream muxed on the fly (Accept-Ranges: none) cannot seek. Fall back
  // to a progressive stream so the video actually jumps instead of freezing.
  if (!isSeekable && currentYoutubeId.value) {
    window.$message?.warning?.('Switching to a seekable stream…');
    try {
      const res = await youtubeService.getStreamUrl(currentYoutubeId.value, {
        kind: 'video',
        height: selectedVideoHeight.value,
        preferProgressive: true
      });
      const muxed = Boolean((res as any).isMuxedProxy);
      await enterVideoMode(res.videoUrl, muxed ? res.videoUrl : null, absolute);
      return;
    } catch (err) {
      console.warn('[MusicFull] Seek fallback failed:', err);
      return;
    }
  }

  try {
    // Muxed-proxy streams start at videoSeekOffset, so the element's timeline
    // is relative to it — seeking to the absolute time jumped past the target.
    el.currentTime = Math.max(0, absolute - videoSeekOffset.value);
  } catch {
    // ignore
  }
  if (el.paused && playerStore.isPlay) {
    el.muted = true;
    el.play().catch(() => {});
  }
};

// C1: Audio ⇄ Video Mode Switching
const toggleAudioVideoMode = async () => {
  if (playerStore.playbackMode === 'video') {
    switchBackToAudio();
    return;
  }
  await switchForwardToVideo();
};

const switchBackToAudio = () => {
  const time = audioService.getCurrentTime() || nowTime.value;

  suppressVideoPauseSync = true;
  const videoEl = activeVideoElement.value;
  if (videoEl) {
    videoEl.pause();
  }
  suppressVideoPauseSync = false;

  activeVideoSrc.value = '';
  videoIsMuxed.value = false;
  activeMuxedBase.value = null;
  videoSeekOffset.value = 0;

  playerStore.setPlaybackMode('song', time);
  nowTime.value = time;
  // Linked A/V: the audio never stopped — only realign it and make sure it is
  // playing when the user expects playback to continue.
  audioService.seek(time);
  if (playerStore.isPlay) {
    void audioService.play();
    mediaCoordinator.claimPlayback('audioService');
  }
};

const switchForwardToVideo = async () => {
  const song = playMusic.value;
  if (!song) return;

  const carryTime = audioService.getCurrentTime();

  // 1. Resolution order 1: local video variant
  await refreshSongVariants();
  const localVideo = currentVariants.value.find((v) => v.kind === 'video' && Boolean(v.path));
  if (localVideo && localVideo.path) {
    await enterVideoMode(filePathToMediaUrl(localVideo.path), null, carryTime);
    return;
  }

  // 2. Resolution order 2: stored youtubeId
  let ytId =
    currentYoutubeId.value || currentSongRecord.value?.youtubeId || (song as any).youtubeId;
  if (!ytId) {
    const localPath = (song as any).localPath || (song as any).path;
    if (localPath) {
      const readYt = await youtubeService.readLink(localPath);
      if (readYt) {
        ytId = youtubeService.extractVideoId(readYt) || undefined;
        if (ytId && currentSongRecord.value) {
          await setYoutubeId(currentSongRecord.value.id, ytId);
        }
      }
    }
  }

  if (ytId) {
    currentYoutubeId.value = ytId;
    try {
      const streamRes = await youtubeService.getStreamUrl(ytId, {
        kind: 'video',
        height: selectedVideoHeight.value,
        videoOnly: true
      });
      const muxed = Boolean((streamRes as any).isMuxedProxy);
      await enterVideoMode(streamRes.videoUrl, muxed ? streamRes.videoUrl : null, carryTime);
      return;
    } catch (err) {
      console.error('[MusicFull] Stream resolution error:', err);
      window.$message?.error?.('Failed to resolve video stream');
    }
  }

  // 3. Resolution order 3: open popover on Search
  videoPopoverInitialTab.value = 'search';
  videoPopoverVisible.value = true;
};

const openVideoSourcePopover = () => {
  videoPopoverInitialTab.value = 'playback';
  videoPopoverVisible.value = true;
};

const handleSetMode = (mode: 'song' | 'video') => {
  if (mode === 'song') {
    switchBackToAudio();
  } else {
    switchForwardToVideo();
  }
};

const handleSelectQuality = async (height: number) => {
  selectedVideoHeight.value = height;
  if (currentYoutubeId.value && playerStore.playbackMode === 'video') {
    const video = activeVideoElement.value;
    const carryTime = video ? videoSeekOffset.value + video.currentTime : nowTime.value;
    try {
      const streamRes = await youtubeService.getStreamUrl(currentYoutubeId.value, {
        kind: 'video',
        height,
        videoOnly: true
      });
      const muxed = Boolean((streamRes as any).isMuxedProxy);
      await enterVideoMode(streamRes.videoUrl, muxed ? streamRes.videoUrl : null, carryTime);
    } catch (err) {
      console.error('[MusicFull] Stream change error:', err);
    }
  }
};

const handleLinkedYoutube = async (id: string) => {
  currentYoutubeId.value = id;
  if (currentSongRecord.value) {
    await setYoutubeId(currentSongRecord.value.id, id);
  }
  await refreshSongVariants();
};

const handlePlayVariant = (v: Variant) => {
  if (v.kind === 'video' && v.path) {
    void enterVideoMode(filePathToMediaUrl(v.path), null, nowTime.value);
  } else if (v.kind === 'audio' && v.path) {
    switchBackToAudio();
  }
};

const refreshSongVariants = async () => {
  const song = playMusic.value;
  if (!song) return;

  const localPath = (song as any).localPath || (song as any).path;
  if (localPath) {
    const found = await findSongByPath(localPath);
    if (found) {
      currentSongRecord.value = found.song;
      currentVariants.value = await getVariants(found.song.id);
      if (found.song.youtubeId) currentYoutubeId.value = found.song.youtubeId;
      return;
    }
  } else if (song.id) {
    const songId = String(song.id);
    const rec = await getSong(songId);
    if (rec) {
      currentSongRecord.value = rec;
      currentVariants.value = await getVariants(rec.id);
      if (rec.youtubeId) currentYoutubeId.value = rec.youtubeId;
      return;
    }
  }
};

// Warm the stream cache (4h TTL in the main process) as soon as a song with a
// linked YouTube video starts, so switching to video mode later is near
// instant instead of waiting for a cold yt-dlp spawn.
const prefetchVideoStream = () => {
  const ytId = currentYoutubeId.value;
  if (!ytId) return;
  void youtubeService
    .getStreamUrl(ytId, { kind: 'video', height: selectedVideoHeight.value, videoOnly: true })
    .catch(() => {
      // Prefetch is best-effort; the real switch reports errors itself.
    });
};

// Per-song media reset: video, quality and YouTube link are matched by song
// ID, so none of them may survive a track change. Without this the previous
// song's video kept rendering ("old artwork/video stays"), the pill kept
// claiming "Video • 360p" and the play button toggled the stale video element
// instead of the new audio.
const resetVideoStateForNewSong = () => {
  suppressVideoPauseSync = true;
  const el = activeVideoElement.value;
  if (el && !el.paused) {
    el.pause();
  }
  suppressVideoPauseSync = false;
  activeVideoSrc.value = '';
  activeMuxedBase.value = null;
  videoSeekOffset.value = 0;
  videoIsMuxed.value = false;
  isSwitchingMode.value = false;
  selectedVideoHeight.value = 720;
  currentYoutubeId.value = '';
  currentVariants.value = [];
  currentSongRecord.value = undefined;
  dismissLengthMismatch();
  playerStore.resetMediaStateForNewSong();
};

let lastSeenSongId: string | number | undefined = playMusic.value?.id;

watch(
  () => playMusic.value,
  () => {
    const newId = playMusic.value?.id;
    const songChanged = newId !== lastSeenSongId;
    if (songChanged) {
      lastSeenSongId = newId;
      resetVideoStateForNewSong();
      underArtScrollOffset.value = 0;
    }
    void refreshSongVariants().then(() => {
      if (songChanged) prefetchVideoStream();
    });
  },
  { immediate: true, deep: true }
);

const closeMusicFull = () => {
  if (isElectron) {
    window.api.isFullScreen().then((fs) => {
      if (fs) {
        window.api.toggleFullScreen();
      }
    });
  } else if (isFullScreen.value && document.fullscreenElement) {
    document.exitFullscreen();
  }
  isVisible.value = false;
  playerStore.setMusicFull(false);
};

const { showCloseModal, rememberChoice, minimizeWindow, requestClose, confirmCloseAction } =
  useWindowControls();

let removeFullScreenListener: (() => void) | undefined;

const toggleFullScreen = async () => {
  try {
    if (isElectron) {
      window.api.toggleFullScreen();
      return;
    }
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      isFullScreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullScreen.value = false;
    }
  } catch (error) {
    console.error('Failed to toggle fullscreen:', error);
  }
};

const handleFullScreenChange = () => {
  isFullScreen.value = !!document.fullscreenElement;
};

onMounted(() => {
  if (lrcSider.value?.$el) {
    lrcSider.value.$el.addEventListener('scroll', handleScroll);
  }
  document.addEventListener('fullscreenchange', handleFullScreenChange);
  window.addEventListener(LYRIC_CONFIG_CHANGE_EVENT, handleLyricConfigChange);
  measureLayoutWidth();
  window.addEventListener('resize', measureLayoutWidth);

  if (isElectron) {
    window.api.isFullScreen().then((fs) => {
      isFullScreen.value = fs;
    });
    removeFullScreenListener = window.api.onWindowFullScreenState((fullscreen) => {
      isFullScreen.value = fullscreen;
    });
  }
});

onBeforeUnmount(() => {
  removeFullScreenListener?.();
  if (lrcSider.value?.$el) {
    lrcSider.value.$el.removeEventListener('scroll', handleScroll);
  }
  document.removeEventListener('fullscreenchange', handleFullScreenChange);
  window.removeEventListener(LYRIC_CONFIG_CHANGE_EVENT, handleLyricConfigChange);
  window.removeEventListener('resize', measureLayoutWidth);
  if (document.fullscreenElement) {
    document.exitFullscreen();
  }
});

watch(
  () => config.value.fontSize,
  (newSize) => {
    document.documentElement.style.setProperty('--lyric-font-size', `${newSize}px`);
  }
);

watch(
  () => config.value.fontWeight,
  (newWeight) => {
    document.documentElement.style.setProperty('--lyric-font-weight', newWeight.toString());
  }
);

watch(
  () => config.value.letterSpacing,
  (newSpacing) => {
    document.documentElement.style.setProperty('--lyric-letter-spacing', `${newSpacing}px`);
  }
);

watch(
  () => config.value.lineHeight,
  (newLineHeight) => {
    document.documentElement.style.setProperty('--lyric-line-height', newLineHeight.toString());
  }
);

onMounted(() => {
  const savedConfig = localStorage.getItem('music-full-config');
  if (savedConfig) {
    config.value = readLyricConfig();
  }
  if (lrcSider.value?.$el) {
    lrcSider.value.$el.addEventListener('scroll', handleScroll);
  }
});

watch(
  () => playMusic.value.id,
  (newId, oldId) => {
    if (newId !== oldId && newId) {
      isSongChanging.value = true;
      setTimeout(() => {
        lrcScroll('instant', true);
        setTimeout(() => {
          isSongChanging.value = false;
        }, 300);
      }, 100);
    }
  }
);

defineExpose({
  lrcScroll,
  config
});
</script>

<style scoped lang="scss">
@keyframes round {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.background-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
}

.drawer-back {
  @apply absolute bg-cover bg-center;
  z-index: -1;
  width: 200%;
  height: 200%;
  top: -50%;
  left: -50%;
}

.drawer-back.paused {
  animation-play-state: paused;
}

#drawer-target {
  @apply top-0 left-0 absolute overflow-hidden rounded w-full h-full;
  animation-duration: 300ms;

  .content-wrapper {
    @apply grid items-center mx-auto h-full;
    grid-template-columns: minmax(300px, 40%) 1fr;
    gap: 3rem;
    max-width: 1500px;
    padding: 2rem;
    transition: width 0.3s ease;

    @media (max-width: 1024px) {
      // Narrow: the side lyric column is not rendered at all (see
      // `isNarrowLayout`) — the left column takes the full width and lyrics
      // show as a strip under the artwork instead.
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }

    &.compact-mode {
      gap: 2rem;

      .right-side {
        max-width: 520px;
        margin-left: auto;
        margin-right: auto;

        .music-lrc-text {
          font-size: calc(var(--lyric-font-size, 22px) * 0.85) !important;
          padding-top: 6px !important;
          padding-bottom: 6px !important;
          line-height: 1.6 !important;
        }
      }
    }
  }

  .stacked-wrapper {
    height: calc(100vh - 100px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .left-side {
    @apply flex flex-col items-center justify-center h-full;
    transition: all 0.3s ease;

    &.only-cover {
      @apply col-span-2;

      .img-container {
        @apply w-[60vh] aspect-square;
      }

      .music-info {
        @apply max-w-[800px];
      }
    }

    .img-container {
      @apply relative w-[45vh] mb-4 aspect-square;
      max-width: 100%;
    }

    .single-lyric-under-art {
      width: 100%;
      max-width: 480px;
      max-height: 8.5rem;
      overflow: hidden;

      .under-art-lyric-line {
        padding: 2px 0;
        opacity: 0.9;

        &.is-current {
          opacity: 1;
        }

        &:hover {
          opacity: 1;
          filter: brightness(1.15);
        }
      }
    }

    .music-info {
      @apply w-full text-center max-w-[400px];

      .music-content-name {
        @apply text-3xl font-bold mb-2 line-clamp-2;
        color: var(--text-color-active);
      }

      .music-content-singer {
        @apply text-lg opacity-80;
        color: var(--text-color-primary);
      }
    }
  }

  .right-side {
    @apply flex flex-col justify-center h-full relative overflow-hidden;

    &.full-width {
      @apply col-span-2;
    }

    &.center {
      .music-lrc {
        @apply w-full mx-auto text-center;
      }

      .music-lrc-text {
        @apply text-center;
        transform-origin: center center;
      }

      .word-by-word-lyric {
        @apply justify-center;
      }
    }

    &.hide {
      @apply hidden;
    }

    .music-lrc {
      @apply w-full h-full bg-transparent;
      mask-image: linear-gradient(
        to bottom,
        transparent 0%,
        black 15%,
        black 85%,
        transparent 100%
      );
      -webkit-mask-image: linear-gradient(
        to bottom,
        transparent 0%,
        black 15%,
        black 85%,
        transparent 100%
      );

      .music-info-header {
        @apply mb-8;

        .music-info-name {
          @apply text-4xl font-bold mb-2 line-clamp-2;
          color: var(--text-color-active);
        }

        .music-info-singer {
          @apply text-xl opacity-80;
          color: var(--text-color-primary);
        }
      }
    }

    .music-lrc-container {
      padding: 50vh 0;
      min-height: 100%;
    }

    .music-lrc-text {
      @apply text-2xl cursor-pointer font-bold px-4 py-3;
      font-family: var(--current-font-family);
      font-weight: var(--lyric-font-weight, bold) !important;
      transition: all 0.3s ease;
      background-color: transparent;
      font-size: var(--lyric-font-size, 22px) !important;
      letter-spacing: var(--lyric-letter-spacing, 0) !important;
      line-height: var(--lyric-line-height, 2) !important;
      opacity: 0.6;
      transform-origin: left center;
      max-width: 94.3%;

      &.now-text {
        opacity: 1;
        transform: scale(1.05);
      }

      &.no-scroll-tip {
        @apply text-base opacity-60 cursor-default py-2;
        color: var(--text-color-primary);
        font-weight: normal;

        span {
          padding-right: 0;
        }

        &:hover {
          background-color: transparent;
        }
      }

      span {
        background-clip: text !important;
        -webkit-background-clip: text !important;
        padding-right: 30px;
      }

      &-roma {
        @apply font-normal italic;
        font-size: calc(var(--lyric-font-size, 22px) * 0.68) !important;
        line-height: 1.4 !important;
        opacity: 0.78;
        color: var(--text-color-primary);
        margin-top: 2px;
      }

      &-tr {
        @apply font-normal;
        opacity: 0.7;
        color: var(--text-color-primary);
      }

      .word-by-word-lyric {
        @apply flex flex-wrap;

        .lyric-word {
          @apply inline-block;
          padding-right: 0;
          font-weight: inherit;
          font-size: inherit;
          letter-spacing: inherit;
          line-height: inherit;
          cursor: inherit;
          position: relative;

          &:hover {
            background-color: rgba(255, 255, 255, 0.1);
          }
        }
      }
    }

    .hover-text {
      &:hover {
        @apply font-bold rounded-xl;
        opacity: 1 !important;
        filter: none !important;
        background-color: var(--hover-bg-color);

        span {
          color: var(--text-color-active) !important;
        }
      }
    }
  }
}

.mobile {
  #drawer-target {
    @apply p-4 pt-8;

    .content-wrapper {
      @apply flex-col justify-start p-0;
    }

    .music-img {
      display: none;
    }

    .music-lrc {
      height: calc(100vh - 260px) !important;
      width: 100vw;

      span {
        padding-right: 0px !important;
      }

      .hover-text {
        &:hover {
          background-color: transparent;
        }
      }

      .music-lrc-text {
        @apply text-xl text-center;
      }
    }

    .music-content {
      @apply h-[calc(100vh-120px)];
      width: 100vw !important;
    }
  }
}

.music-drawer {
  transition: none;
}

:root {
  --current-font-family:
    system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    sans-serif;
}

.close-btn {
  opacity: 0.3;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 1;
  }
}

.control-left,
.control-right {
  &.pure-mode {
    @apply pointer-events-auto;

    .control-btn {
      @apply opacity-0 transition-all duration-300;
      pointer-events: none;
    }

    &:hover .control-btn {
      @apply opacity-100;
      pointer-events: auto;
    }
  }

  &:not(.pure-mode) .control-btn {
    pointer-events: auto;
  }
}

.control-right {
  @apply flex items-center gap-2;
}

.pure-mode-tip-layer {
  @apply absolute inset-0 z-[9999] pointer-events-none;
}

.pure-mode-tip-highlight {
  @apply absolute top-8 right-8 w-20 h-9 rounded-lg;
  border: 1.5px dashed rgba(255, 255, 255, 0.75);
  animation: pure-tip-pulse 1.8s ease-out infinite;

  &--left {
    @apply right-auto left-8 w-9;
  }
}

.pure-mode-tip-bubble {
  @apply absolute top-[4.75rem] right-8 flex w-fit max-w-[320px] flex-col gap-2 rounded-xl px-4 py-3 text-sm pointer-events-auto;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);

  &--left {
    @apply right-auto left-8;
  }
}

.pure-mode-tip-content {
  @apply flex items-start gap-2;

  i {
    @apply mt-0.5 shrink-0 text-base;
    color: #10b981;
  }
}

.pure-mode-tip-actions {
  @apply flex items-center justify-end gap-2;
}

.pure-mode-tip-btn {
  @apply cursor-pointer rounded-lg border px-3 py-1 text-xs transition-colors;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.75);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.9);
  }

  &:disabled {
    @apply cursor-not-allowed opacity-40;
  }

  &--primary {
    background: #10b981;
    border-color: #10b981;
    color: #fff;

    &:hover:not(:disabled) {
      background: #059669;
      border-color: #059669;
      color: #fff;
    }
  }
}

.pure-mode-tip-dots {
  @apply ml-0.5 flex items-center gap-1 self-center;

  span {
    @apply h-1.5 w-1.5 rounded-full bg-white/25 transition-colors;
  }

  span.is-active {
    @apply bg-emerald-400;
  }
}

@keyframes pure-tip-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }

  70%,
  100% {
    box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.fade-leave-to {
  opacity: 0;
}

.control-btn {
  @apply w-9 h-9 flex items-center justify-center rounded cursor-pointer transition-all duration-300;
  background: rgba(142, 142, 142, 0.192);
  backdrop-filter: blur(12px);

  i {
    @apply text-xl;
    color: var(--text-color-active);
  }

  &.control-btn-pill {
    @apply w-auto px-2.5 h-8 rounded-full font-medium text-xs;
    color: var(--text-color-primary);
  }

  &.is-active {
    background: rgba(16, 185, 129, 0.28) !important;
    border: 1px solid rgba(16, 185, 129, 0.6) !important;
    color: #10b981 !important;

    i {
      color: #10b981 !important;
    }
  }

  &:hover {
    background: rgba(126, 121, 121, 0.2);

    i {
      opacity: 1;
    }
  }
}

.lyric-correction {
  .music-lrc:hover & {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
}

.music-lrc-line-time {
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.5px;
  opacity: 0.45;
  margin-bottom: 1px;
  user-select: none;
}

.length-mismatch-warning {
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  max-width: min(640px, 80vw);
}

.lrc-edit-actions {
  @apply flex justify-center pt-4 pb-2;
}

.lrc-edit-btn {
  @apply inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer select-none;
  background: rgba(142, 142, 142, 0.192);
  backdrop-filter: blur(12px);
  color: var(--text-color-primary);

  i {
    @apply text-sm;
    color: var(--text-color-active);
  }

  &:hover {
    background: rgba(16, 185, 129, 0.28);
    color: #10b981;

    i {
      color: #10b981;
    }
  }
}
</style>
