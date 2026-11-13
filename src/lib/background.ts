import { requireOptionalNativeModule, type EventSubscription } from 'expo';
import { AppState } from 'react-native';

import { log } from './logger';

interface NativeBg {
  bgBegin(title: string, subtitle: string): string | null;
  bgProgress(done: number, total: number, title: string, subtitle: string): void;
  bgEnd(success: boolean): void;
  requestNotify(): Promise<boolean>;
  notify(title: string, body: string): void;
  addListener(event: 'onBackground', cb: (e: { type: 'started' | 'expired' }) => void): EventSubscription;
}
const Native = requireOptionalNativeModule<Partial<NativeBg>>('RyxNet');
const bg = Native && typeof Native.bgBegin === 'function' ? (Native as NativeBg) : null;

export interface BgItem {
  id: string;
  name: string;
  /** 0…1 */
  fraction: number;
  done: boolean;
}

/**
 * Giữ app chạy tiếp khi rời app trong lúc tải (iOS 26+, bản 1.0.7+).
 * Một tác vụ nền chung cho mọi lượt tải; tiến độ là trung bình các file trong đợt tải hiện tại.
 */
class BackgroundDownloads {
  private running = false;
  private batch = new Map<string, BgItem>();
  private lastSent = 0;
  private warned = false;
  private askedNotify = false;
  private sub: EventSubscription | null = null;

  constructor() {
    if (!bg) return;
    this.sub = bg.addListener('onBackground', (e) => {
      if (e.type === 'started') log.debug('download', 'iOS đã nhận tác vụ tải nền (rời app vẫn tải tiếp)');
      if (e.type === 'expired') {
        this.running = false;
        log.warn(
          'download',
          'iOS đã dừng tác vụ tải nền',
          'Thường do tiến độ đứng yên quá lâu, máy nóng hoặc thiếu pin. Mở lại Ryx để tải tiếp/tải lại.',
        );
      }
    });
  }

  /** Gọi khi một lượt tải bắt đầu (lúc app đang mở, ngay sau khi bấm tải) */
  start(id: string, name: string) {
    if (!bg) return;
    this.batch.set(id, { id, name, fraction: 0, done: false });
    if (!this.askedNotify) {
      this.askedNotify = true;
      void bg.requestNotify().catch(() => {});
    }
    if (this.running) return this.push(true);
    const err = bg.bgBegin('Ryx đang tải', name);
    if (err) {
      if (!this.warned) {
        this.warned = true;
        log.warn('download', 'Không bật được tải nền: rời app thì tải sẽ dừng', err);
      }
      return;
    }
    this.running = true;
    this.push(true);
  }

  progress(id: string, fraction: number) {
    const it = this.batch.get(id);
    if (!it) return;
    it.fraction = Math.max(it.fraction, Math.min(1, fraction));
    this.push(false);
  }

  /** Xong (ok) hoặc lỗi/huỷ (!ok) */
  finish(id: string, ok: boolean, name: string) {
    const it = this.batch.get(id);
    if (it) {
      it.done = true;
      it.fraction = 1;
    }
    if (ok && bg && AppState.currentState !== 'active') bg.notify('Đã tải xong', name);
    if (!ok && bg && AppState.currentState !== 'active') bg.notify('Tải không thành công', name);
    if ([...this.batch.values()].every((x) => x.done)) {
      this.batch.clear();
      if (this.running && bg) bg.bgEnd(true);
      this.running = false;
    } else this.push(true);
  }

  private push(force: boolean) {
    if (!bg || !this.running) return;
    const now = Date.now();
    if (!force && now - this.lastSent < 500) return;
    this.lastSent = now;
    const items = [...this.batch.values()];
    const left = items.filter((x) => !x.done);
    const done = Math.round(items.reduce((a, x) => a + x.fraction, 0) * 1000);
    const total = items.length * 1000;
    const title = left.length > 1 ? `Ryx đang tải ${left.length} file` : 'Ryx đang tải';
    const subtitle = left.length === 1 ? left[0].name : `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    bg.bgProgress(done, total, title, subtitle);
  }

  dispose() {
    this.sub?.remove();
  }
}

export const backgroundDownloads = new BackgroundDownloads();
