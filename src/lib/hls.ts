import { requireOptionalNativeModule, type EventSubscription } from 'expo';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { log } from './logger';
// mux.js chỉ có bản CommonJS, không kèm khai báo kiểu
// eslint-disable-next-line @typescript-eslint/no-require-imports
const muxjs = require('mux.js') as {
  mp4: {
    Transmuxer: new (opts?: { remux?: boolean; keepOriginalTimestamps?: boolean }) => MuxTransmuxer;
  };
};

interface MuxSegment {
  initSegment: Uint8Array;
  data: Uint8Array;
}
interface MuxTransmuxer {
  on(event: 'data', cb: (s: MuxSegment) => void): void;
  on(event: 'done', cb: () => void): void;
  push(bytes: Uint8Array): void;
  flush(): void;
}

/**
 * Tải video HLS (.m3u8) về thành một file .mp4:
 * 1. Đọc playlist (chọn chất lượng cao nhất nếu có nhiều mức).
 * 2. Tải từng đoạn bằng trình tải native của Ryx (đi qua DNS riêng, có cookie của trang).
 * 3. Đoạn mã hoá AES-128 → giải mã native. Đoạn .ts → mux.js chuyển sang MP4 phân mảnh; đoạn fMP4 → ghép thẳng.
 * 4. Native chuyển MP4 phân mảnh thành MP4 thường (Ảnh/Tệp mở được ở mọi nơi). Lỗi bước này thì giữ bản phân mảnh.
 * Giới hạn: không làm được SAMPLE-AES/DRM, video H.265 trong .ts, và video có tiếng tách riêng (chỉ lấy hình).
 */

interface NativeEvent {
  id: string;
  type: 'start' | 'progress' | 'done' | 'error';
  message?: string;
  size?: number;
}
interface NativeHls {
  startDownload(id: string, url: string, path: string, headers: Record<string, string>): void;
  cancelDownload(id: string): void;
  decryptAes128(inPath: string, outPath: string, keyPath: string, ivHex: string): Promise<void>;
  exportMp4(inPath: string, outPath: string): Promise<void>;
  addListener(event: 'onDownload', cb: (e: NativeEvent) => void): EventSubscription;
}
const Native = requireOptionalNativeModule<Partial<NativeHls>>('RyxNet');
const native = Native && typeof Native.exportMp4 === 'function' ? (Native as NativeHls) : null;

export const hlsSupported = !!native;

export class HlsError extends Error {}

const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

let seq = 0;
/** Tải 1 file nhỏ qua trình tải native, chờ xong */
function fetchTo(url: string, path: string, referer: string | undefined, cancelled: () => boolean): Promise<void> {
  const n = native!;
  const id = `hls-${Date.now().toString(36)}-${seq++}`;
  return new Promise((resolve, reject) => {
    if (cancelled()) return reject(new HlsError('Đã huỷ'));
    const sub = n.addListener('onDownload', (e) => {
      if (e.id !== id) return;
      if (e.type === 'done') {
        sub.remove();
        resolve();
      } else if (e.type === 'error') {
        sub.remove();
        reject(new HlsError(e.message ?? 'Tải đoạn video thất bại'));
      }
    });
    n.startDownload(id, url, path, referer ? { Referer: referer } : {});
  });
}

/** Ghép đường dẫn tương đối của playlist với địa chỉ playlist */
function resolveUrl(ref: string, base: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  const m = /^(https?:\/\/[^/]+)(\/[^?#]*)?/i.exec(base);
  if (!m) return ref;
  const origin = m[1];
  if (ref.startsWith('//')) return base.split(':')[0] + ':' + ref;
  if (ref.startsWith('/')) return origin + ref;
  const dir = (m[2] ?? '/').replace(/[^/]*$/, '');
  const parts = (dir + ref).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return origin + out.join('/');
}

function attr(line: string, name: string): string | undefined {
  const m = new RegExp(`${name}=("([^"]*)"|[^,]*)`).exec(line);
  return m ? (m[2] ?? m[1]) : undefined;
}

interface Segment {
  url: string;
  key?: { url: string; iv?: string };
  seqNo: number;
}
interface MediaPlaylist {
  init?: { url: string; key?: { url: string; iv?: string } };
  segments: Segment[];
}

function parseMedia(text: string, base: string): MediaPlaylist {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let seqNo = 0;
  let key: Segment['key'];
  let init: MediaPlaylist['init'];
  const segments: Segment[] = [];
  for (const l of lines) {
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seqNo = parseInt(l.split(':')[1], 10) || 0;
    else if (l.startsWith('#EXT-X-KEY:')) {
      const method = attr(l, 'METHOD');
      if (method === 'NONE') key = undefined;
      else if (method === 'AES-128') key = { url: resolveUrl(attr(l, 'URI') ?? '', base), iv: attr(l, 'IV') };
      else throw new HlsError(`Video được bảo vệ (${method}), không tải được`);
    } else if (l.startsWith('#EXT-X-MAP:')) init = { url: resolveUrl(attr(l, 'URI') ?? '', base), key };
    else if (l.startsWith('#EXT-X-BYTERANGE')) throw new HlsError('Kiểu HLS này (BYTERANGE) chưa hỗ trợ');
    else if (l && !l.startsWith('#')) segments.push({ url: resolveUrl(l, base), key, seqNo: seqNo++ });
  }
  return { init, segments };
}

export interface HlsProgress {
  done: number;
  total: number;
  bytes: number;
}

export async function downloadHls(opts: {
  url: string;
  referer?: string;
  /** file:// của file .mp4 đích */
  destUri: string;
  onProgress: (p: HlsProgress) => void;
  isCancelled: () => boolean;
}): Promise<number> {
  if (!native) throw new HlsError('Cần cài bản Ryx 1.0.6 trở lên');
  const { referer, isCancelled } = opts;
  const work = new Directory(Paths.cache, `hls-${Date.now().toString(36)}`);
  work.create({ intermediates: true, idempotent: true });
  const wp = (name: string) => toPath(new File(work, name).uri);
  const readText = async (name: string) => new File(work, name).text();
  try {
    // 1. Playlist
    let playlistUrl = opts.url;
    await fetchTo(playlistUrl, wp('p0.m3u8'), referer, isCancelled);
    let text = await readText('p0.m3u8');
    if (!text.includes('#EXTM3U')) throw new HlsError('Không phải playlist HLS');
    if (text.includes('#EXT-X-STREAM-INF')) {
      // Nhiều mức chất lượng → chọn băng thông cao nhất
      const lines = text.split(/\r?\n/).map((l) => l.trim());
      let best: { bw: number; url: string; audio?: string } | null = null;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const bw = parseInt(attr(lines[i], 'BANDWIDTH') ?? '0', 10);
        const next = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
        if (next && (!best || bw > best.bw))
          best = { bw, url: resolveUrl(next, playlistUrl), audio: attr(lines[i], 'AUDIO') };
      }
      if (!best) throw new HlsError('Playlist không có luồng video');
      if (best.audio && new RegExp(`TYPE=AUDIO[^\\n]*GROUP-ID="${best.audio}"[^\\n]*URI=`).test(text))
        log.warn(
          'download',
          'Video HLS có tiếng tách riêng: Ryx chỉ ghép được hình, file có thể không có tiếng',
          playlistUrl,
        );
      playlistUrl = best.url;
      await fetchTo(playlistUrl, wp('p1.m3u8'), referer, isCancelled);
      text = await readText('p1.m3u8');
    }
    const pl = parseMedia(text, playlistUrl);
    if (pl.segments.length === 0) throw new HlsError('Playlist không có đoạn video nào');
    if (!text.includes('#EXT-X-ENDLIST'))
      log.warn('download', 'Đây có thể là luồng trực tiếp: chỉ tải được phần đang có', playlistUrl);

    // 2. Khoá giải mã (tải 1 lần mỗi khoá)
    const keyFiles = new Map<string, string>();
    const keyPath = async (u: string) => {
      let p = keyFiles.get(u);
      if (!p) {
        p = wp(`k${keyFiles.size}.key`);
        await fetchTo(u, p, referer, isCancelled);
        keyFiles.set(u, p);
      }
      return p;
    };
    const getBytes = async (url: string, name: string, key?: Segment['key'], seqNo = 0): Promise<Uint8Array> => {
      const raw = wp(name);
      await fetchTo(url, raw, referer, isCancelled);
      if (!key) return new File(work, name).bytes();
      const iv = key.iv ?? seqNo.toString(16).padStart(32, '0');
      await native.decryptAes128(raw, wp(`${name}.dec`), await keyPath(key.url), iv);
      return new File(work, `${name}.dec`).bytes();
    };

    // 3. Ghép thành MP4 phân mảnh
    const frag = new File(work, 'out.fmp4');
    frag.create();
    const h = frag.open(FileMode.ReadWrite);
    let bytes = 0;
    const write = async (b: Uint8Array) => {
      if (b.byteLength === 0) return;
      await h.writeBytes(b);
      bytes += b.byteLength;
    };
    try {
      const firstUrl = pl.segments[0].url.split('?')[0];
      const isFmp4 = !!pl.init || /\.(m4s|mp4|m4v|cmfv)$/i.test(firstUrl);
      if (isFmp4) {
        if (pl.init) await write(await getBytes(pl.init.url, 'init', pl.init.key));
      }
      let mux: MuxTransmuxer | null = null;
      let wroteInit = false;
      const pending: Uint8Array[] = [];
      if (!isFmp4) {
        mux = new muxjs.mp4.Transmuxer({ remux: true });
        mux.on('data', (seg) => {
          if (!wroteInit) {
            pending.push(seg.initSegment);
            wroteInit = true;
          }
          pending.push(seg.data);
        });
      }
      for (let i = 0; i < pl.segments.length; i++) {
        if (isCancelled()) throw new HlsError('Đã huỷ');
        const s = pl.segments[i];
        const b = await getBytes(s.url, `s${i}`, s.key, s.seqNo);
        // Xoá file tạm ngay để không đầy bộ nhớ máy
        for (const n of [`s${i}`, `s${i}.dec`]) {
          const f = new File(work, n);
          if (f.exists) f.delete();
        }
        if (mux) {
          mux.push(b);
          mux.flush();
          while (pending.length) await write(pending.shift()!);
        } else await write(b);
        opts.onProgress({ done: i + 1, total: pl.segments.length, bytes });
      }
      if (mux && !wroteInit) throw new HlsError('Không đọc được hình/tiếng trong video (có thể là H.265)');
    } finally {
      h.close();
    }

    // 4. MP4 phân mảnh → MP4 thường
    const dest = new File(opts.destUri);
    try {
      await native.exportMp4(toPath(frag.uri), toPath(dest.uri));
    } catch (e) {
      log.warn('download', 'Không chuyển được sang MP4 thường, giữ bản MP4 phân mảnh', e);
      if (dest.exists) dest.delete();
      frag.move(dest);
    }
    return dest.exists ? (dest.size ?? bytes) : bytes;
  } finally {
    try {
      if (work.exists) work.delete();
    } catch {}
  }
}
