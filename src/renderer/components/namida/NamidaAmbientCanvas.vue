<template>
  <canvas ref="canvasRef" class="namida-ambient-canvas" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    palette?: string[];
    bassEnergy?: number; // 0.0 to 1.0 from Web Audio AnalyserNode
    isPlaying?: boolean;
  }>(),
  {
    palette: () => ['#6366f1', '#8b5cf6', '#ec4899', '#1e1b4b'],
    bassEnergy: 0,
    isPlaying: true
  }
);

const canvasRef = ref<HTMLCanvasElement | null>(null);
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let rafId = 0;
let startTime = performance.now();

function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16) || 0;
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

const currentColors = [
  [0.38, 0.4, 0.94],
  [0.54, 0.36, 0.96],
  [0.92, 0.28, 0.6],
  [0.11, 0.1, 0.29]
];
let targetColors = [...currentColors.map((c) => [...c])];

watch(
  () => props.palette,
  (newPal) => {
    if (!newPal || newPal.length === 0) return;
    for (let i = 0; i < 4; i++) {
      targetColors[i] = hexToRgbNormalized(newPal[i % newPal.length]);
    }
  },
  { immediate: true, deep: true }
);

const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bass;
  uniform vec3 u_c0;
  uniform vec3 u_c1;
  uniform vec3 u_c2;
  uniform vec3 u_c3;

  void main() {
    vec2 uv = v_uv;
    float t = u_time * 0.28;
    float pulse = 1.0 + u_bass * 0.18;

    vec2 p0 = vec2(0.5 + 0.35 * sin(t * 0.9), 0.5 + 0.35 * cos(t * 0.7));
    vec2 p1 = vec2(0.5 + 0.38 * cos(t * 0.6 + 1.4), 0.5 + 0.32 * sin(t * 1.1));
    vec2 p2 = vec2(0.5 + 0.30 * sin(t * 1.2 + 2.8), 0.5 + 0.36 * cos(t * 0.8 + 0.9));

    float d0 = 1.0 / (pow(distance(uv, p0) * 2.2 / pulse, 2.0) + 0.45);
    float d1 = 1.0 / (pow(distance(uv, p1) * 2.2 / pulse, 2.0) + 0.45);
    float d2 = 1.0 / (pow(distance(uv, p2) * 2.4, 2.0) + 0.45);

    vec3 col = u_c3 * 0.45;
    col += u_c0 * d0 * 0.38;
    col += u_c1 * d1 * 0.34;
    col += u_c2 * d2 * 0.30;

    // Subtle dark vignette for lyric contrast
    float vignette = smoothstep(1.15, 0.25, distance(uv, vec2(0.5)));
    col *= mix(0.45, 0.92, vignette);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function compileShader(ctx: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = ctx.createShader(type)!;
  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);
  return shader;
}

function renderLoop(now: number) {
  if (!gl || !program) return;

  // Smoothly lerp palette colors (spring-like transition on track change)
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < 3; c++) {
      currentColors[i][c] += (targetColors[i][c] - currentColors[i][c]) * 0.04;
    }
  }

  const elapsed = (now - startTime) * 0.001;
  gl.useProgram(program);

  gl.uniform1f(gl.getUniformLocation(program, 'u_time'), elapsed);
  gl.uniform1f(gl.getUniformLocation(program, 'u_bass'), props.bassEnergy || 0);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c0'), currentColors[0]);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c1'), currentColors[1]);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c2'), currentColors[2]);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c3'), currentColors[3]);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  rafId = requestAnimationFrame(renderLoop);
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = 256;
  canvas.height = 256;

  gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.viewport(0, 0, 256, 256);
  rafId = requestAnimationFrame(renderLoop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
});
</script>

<style scoped>
.namida-ambient-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  z-index: 0;
}
</style>
