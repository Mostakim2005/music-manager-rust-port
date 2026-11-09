<template>
  <div
    ref="containerRef"
    class="namida-waveform-seekbar"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="hoverRatio = null"
  >
    <div
      v-for="(peak, idx) in normalizedPeaks"
      :key="idx"
      class="waveform-bar"
      :class="{
        'is-played': idx / normalizedPeaks.length <= displayRatio,
        'is-hovered': hoverRatio !== null && idx / normalizedPeaks.length <= hoverRatio
      }"
      :style="{
        height: `${Math.max(14, Math.round(peak * 100))}%`,
        '--bar-accent': accentColor
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { getOrComputeWaveformPeaks } from '../../services/songLibrary';

const props = withDefaults(
  defineProps<{
    filePath?: string;
    currentTime: number;
    duration: number;
    accentColor?: string;
    barsCount?: number;
  }>(),
  {
    filePath: '',
    accentColor: '#8b5cf6',
    barsCount: 140
  }
);

const emit = defineEmits<{
  (e: 'seek', targetSeconds: number): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const rawPeaks = ref<number[]>([]);
const isDragging = ref(false);
const dragRatio = ref(0);
const hoverRatio = ref<number | null>(null);

watch(
  () => props.filePath,
  async (newPath) => {
    if (!newPath || newPath.startsWith('http')) {
      // Fallback procedural wave for uncached online streams
      rawPeaks.value = Array.from({ length: props.barsCount }, (_, i) =>
        0.25 + 0.65 * Math.abs(Math.sin(i * 0.21) * Math.cos(i * 0.07))
      );
      return;
    }
    try {
      rawPeaks.value = await getOrComputeWaveformPeaks(newPath, props.barsCount);
    } catch {
      rawPeaks.value = Array(props.barsCount).fill(0.3);
    }
  },
  { immediate: true }
);

const normalizedPeaks = computed(() =>
  rawPeaks.value.length > 0 ? rawPeaks.value : Array(props.barsCount).fill(0.25)
);

const displayRatio = computed(() => {
  if (isDragging.value) return dragRatio.value;
  if (!props.duration || props.duration <= 0) return 0;
  return Math.min(1, Math.max(0, props.currentTime / props.duration));
});

function ratioFromEvent(e: PointerEvent): number {
  const el = containerRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}

function onPointerDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  isDragging.value = true;
  dragRatio.value = ratioFromEvent(e);
}

function onPointerMove(e: PointerEvent) {
  const r = ratioFromEvent(e);
  hoverRatio.value = r;
  if (isDragging.value) {
    dragRatio.value = r;
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  const r = ratioFromEvent(e);
  isDragging.value = false;
  if (props.duration > 0) {
    emit('seek', r * props.duration);
  }
}
</script>

<style scoped>
.namida-waveform-seekbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  height: 42px;
  width: 100%;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  padding: 4px 0;
}

.waveform-bar {
  flex: 1;
  min-width: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  transition: height 180ms ease, background-color 120ms ease, transform 120ms ease;
}

.waveform-bar.is-hovered {
  background: rgba(255, 255, 255, 0.45);
}

.waveform-bar.is-played {
  background: var(--bar-accent, #8b5cf6);
  box-shadow: 0 0 8px var(--bar-accent, rgba(139, 92, 246, 0.55));
}
</style>
