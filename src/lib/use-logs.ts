import { useEffect, useState, useSyncExternalStore } from 'react';

import { getLogs, subscribeLogs } from './logger';
import { getPerfSnapshot, subscribePerf, type PerfSnapshot } from './perf-monitor';

export function useLogs() {
  return useSyncExternalStore(subscribeLogs, getLogs, getLogs);
}

export function usePerfSnapshot(): PerfSnapshot {
  const [snap, setSnap] = useState(getPerfSnapshot);
  useEffect(() => subscribePerf(setSnap), []);
  return snap;
}
