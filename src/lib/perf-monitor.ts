import { AppState } from 'react-native';

import { log } from './logger';

/**
 * Đo độ mượt của luồng JS bằng requestAnimationFrame.
 * - Mỗi 5 giây tính FPS trung bình; dưới LOW_FPS thì ghi log "perf".
 * - Một khung hình kéo dài hơn FREEZE_MS = JS bị treo (giật/đứng hình) → ghi log ngay.
 * Chỉ chạy khi app đang mở (foreground) để không tốn pin.
 */

const WINDOW_MS = 5000;
const LOW_FPS = 45;
const FREEZE_MS = 400;
const JANK_FRAME_MS = 50;

export interface PerfSnapshot {
  fps: number;
  /** Số khung hình > 50ms trong cửa sổ đo gần nhất. */
  janky: number;
  /** Số lần JS bị treo > 400ms kể từ khi mở app. */
  freezes: number;
}

let running = false;
let rafId: number | null = null;
let last = 0;
let windowStart = 0;
let frames = 0;
let janky = 0;
let snapshot: PerfSnapshot = { fps: 60, janky: 0, freezes: 0 };
const listeners = new Set<(s: PerfSnapshot) => void>();

function tick(now: number) {
  if (!running) return;
  if (last) {
    const dt = now - last;
    if (dt > JANK_FRAME_MS) janky++;
    if (dt > FREEZE_MS) {
      snapshot = { ...snapshot, freezes: snapshot.freezes + 1 };
      log.perf('perf', `JS bị treo ${Math.round(dt)} ms`, 'Giao diện đứng hình trong khoảng này. Xem log ngay trước đó để biết đang làm gì.');
    }
  }
  last = now;
  frames++;
  if (!windowStart) windowStart = now;
  const elapsed = now - windowStart;
  if (elapsed >= WINDOW_MS) {
    const fps = Math.round((frames * 1000) / elapsed);
    snapshot = { ...snapshot, fps, janky };
    if (fps < LOW_FPS) log.perf('perf', `JS FPS thấp: ${fps} fps`, `${janky} khung hình bị chậm (>${JANK_FRAME_MS}ms) trong ${Math.round(elapsed / 1000)} giây`);
    listeners.forEach((l) => l(snapshot));
    windowStart = now;
    frames = 0;
    janky = 0;
  }
  rafId = requestAnimationFrame(tick);
}

function start() {
  if (running) return;
  running = true;
  last = 0;
  windowStart = 0;
  frames = 0;
  janky = 0;
  rafId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

let initialized = false;

export function initPerfMonitor() {
  if (initialized) return;
  initialized = true;
  if (AppState.currentState === 'active') start();
  AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
}

export function getPerfSnapshot(): PerfSnapshot {
  return snapshot;
}

export function subscribePerf(listener: (s: PerfSnapshot) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Đo thời gian một việc đồng bộ; ghi log nếu chậm hơn ngưỡng. */
export function measure<T>(tag: string, label: string, fn: () => T, warnMs = 100): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - t0;
    if (ms >= warnMs) log.perf(tag, `${label} mất ${Math.round(ms)} ms`);
  }
}
