/**
 * Ghép các đoạn MPEG-TS của video HLS thành một MP4 phân mảnh có mốc thời gian liền mạch.
 *
 * Vì sao cần: nhiều trang chèn quảng cáo hoặc ghép nhiều nguồn vào cùng playlist, nên mốc thời gian (PTS)
 * của các đoạn nhảy cóc (có khi đánh dấu #EXT-X-DISCONTINUITY, có khi không). mux.js tính thời gian của
 * mọi đoạn so với đoạn đầu → thời lượng thành ~12 tiếng và phần lớn video đen. Ở đây: hễ gặp chỗ nhảy cóc
 * thì bắt đầu một "nhóm" mới với bộ chuyển đổi mới (thời gian lại từ 0), rồi dời mốc thời gian của nhóm
 * đó (hộp tfdt) tới đúng vị trí theo thời lượng trong playlist, và đánh lại số thứ tự mảnh (hộp mfhd).
 */

type Transmuxer = {
  on(event: 'data', cb: (s: { initSegment: Uint8Array; data: Uint8Array }) => void): void;
  push(bytes: Uint8Array): void;
  flush(): void;
};
type Inspect = (bytes: Uint8Array) => { video?: { dts: number }[]; audio?: { dts: number }[] } | undefined;

export interface MuxLib {
  mp4: { Transmuxer: new (opts?: { remux?: boolean }) => Transmuxer };
  mp2t: { tools: { inspect: Inspect } };
}

const CLOCK = 90000;
/** Mốc thời gian lệch quá chừng này so với đoạn trước → coi như nhảy cóc */
const JUMP_LIMIT = 10 * CLOCK;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function setU32(b: Uint8Array, o: number, v: number) {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}

/** Duyệt các hộp con trong [start, end) */
function* boxes(b: Uint8Array, start: number, end: number): Generator<{ type: string; at: number; size: number }> {
  let o = start;
  while (o + 8 <= end) {
    const size = u32(b, o);
    if (size < 8 || o + size > end) return;
    yield { type: type4(b, o + 4), at: o, size };
    o += size;
  }
}

/** track_ID → timescale, đọc từ hộp moov của đoạn khởi tạo */
export function trackTimescales(init: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  for (const moov of boxes(init, 0, init.length)) {
    if (moov.type !== 'moov') continue;
    for (const trak of boxes(init, moov.at + 8, moov.at + moov.size)) {
      if (trak.type !== 'trak') continue;
      let id = 0;
      let scale = 0;
      for (const c of boxes(init, trak.at + 8, trak.at + trak.size)) {
        if (c.type === 'tkhd') id = u32(init, c.at + 8 + 4 + (init[c.at + 8] === 1 ? 16 : 8));
        if (c.type === 'mdia')
          for (const m of boxes(init, c.at + 8, c.at + c.size))
            if (m.type === 'mdhd') scale = u32(init, m.at + 8 + 4 + (init[m.at + 8] === 1 ? 16 : 8));
      }
      if (id) out.set(id, scale || CLOCK);
    }
  }
  return out;
}

/** Dời tfdt của mỗi track thêm offsetSec, đánh lại số mảnh. Sửa trực tiếp trên mảng. */
function shiftFragments(b: Uint8Array, offsetSec: number, scales: Map<number, number>, nextSeq: () => number) {
  for (const box of boxes(b, 0, b.length)) {
    if (box.type !== 'moof') continue;
    for (const c of boxes(b, box.at + 8, box.at + box.size)) {
      if (c.type === 'mfhd') setU32(b, c.at + 12, nextSeq());
      if (c.type !== 'traf') continue;
      let track = 0;
      for (const t of boxes(b, c.at + 8, c.at + c.size)) {
        if (t.type === 'tfhd') track = u32(b, t.at + 12);
        if (t.type !== 'tfdt' || offsetSec <= 0) continue;
        const add = Math.round(offsetSec * (scales.get(track) ?? CLOCK));
        const v1 = b[t.at + 8] === 1;
        const o = t.at + 12;
        if (v1) {
          const value = u32(b, o) * 4294967296 + u32(b, o + 4) + add;
          setU32(b, o, Math.floor(value / 4294967296));
          setU32(b, o + 4, value % 4294967296);
        } else {
          const value = u32(b, o) + add;
          if (value >= 4294967296) throw new Error('Video quá dài cho kiểu MP4 này');
          setU32(b, o, value);
        }
      }
    }
  }
}

/**
 * mux.js ghi thời lượng "không rõ" (0xFFFFFFFF ở thang 90 000 = ~13,3 tiếng) vào đoạn khởi tạo, vì nó làm cho phát trực tiếp.
 * Trình phát của iOS tin con số đó → video hiện dài ~12–13 tiếng, phần sau đen. Ghi lại thời lượng thật (sửa trên bản sao).
 */
export function withDuration(init: Uint8Array, seconds: number): Uint8Array {
  const b = new Uint8Array(init);
  const clamp = (v: number) => Math.min(0xfffffffe, Math.max(0, Math.round(v)));
  for (const moov of boxes(b, 0, b.length)) {
    if (moov.type !== 'moov') continue;
    let movieScale = CLOCK;
    for (const c of boxes(b, moov.at + 8, moov.at + moov.size)) {
      if (c.type === 'mvhd' && b[c.at + 8] === 0) {
        movieScale = u32(b, c.at + 20) || CLOCK;
        setU32(b, c.at + 24, clamp(seconds * movieScale));
      }
      if (c.type !== 'trak') continue;
      for (const t of boxes(b, c.at + 8, c.at + c.size)) {
        if (t.type === 'tkhd' && b[t.at + 8] === 0) setU32(b, t.at + 28, clamp(seconds * movieScale));
        if (t.type === 'mdia')
          for (const m of boxes(b, t.at + 8, t.at + t.size))
            if (m.type === 'mdhd' && b[m.at + 8] === 0)
              setU32(b, m.at + 24, clamp(seconds * (u32(b, m.at + 20) || CLOCK)));
      }
    }
  }
  return b;
}

/** Một số trang giấu đoạn video sau phần đầu của file ảnh (PNG/JPG giả): tìm chỗ bắt đầu thật của TS */
export function findTsStart(b: Uint8Array): number {
  const max = Math.min(b.length - 377, 1 << 20);
  for (let o = 0; o < max; o++) if (b[o] === 0x47 && b[o + 188] === 0x47 && b[o + 376] === 0x47) return o;
  return -1;
}

export class TsJoiner {
  private mux: Transmuxer | null = null;
  private pending: Uint8Array[] = [];
  private init: Uint8Array | null = null;
  private scales = new Map<number, number>();
  private seq = 1;
  private groupStart = 0;
  private elapsed = 0;
  private lastDts: number | null = null;
  /** Số nhóm (1 = liền mạch) và số đoạn phải bỏ phần đầu giả */
  groups = 0;
  strippedHeaders = 0;

  constructor(private lib: MuxLib) {}

  private newGroup() {
    this.groups++;
    this.groupStart = this.elapsed;
    const m = new this.lib.mp4.Transmuxer({ remux: true });
    m.on('data', (s) => {
      if (!this.init) {
        this.init = s.initSegment;
        this.scales = trackTimescales(s.initSegment);
        this.pending.push(s.initSegment);
      }
      const frag = new Uint8Array(s.data);
      shiftFragments(frag, this.groupStart, this.scales, () => this.seq++);
      this.pending.push(frag);
    });
    this.mux = m;
  }

  /** Thêm một đoạn (đã giải mã). Trả về các phần cần ghi nối vào file. */
  push(raw: Uint8Array, durationSec: number, discontinuity: boolean): Uint8Array[] {
    let b = raw;
    if (b[0] !== 0x47) {
      const at = findTsStart(b);
      if (at < 0) throw new Error('Đoạn video không phải định dạng TS');
      b = b.subarray(at);
      this.strippedHeaders++;
    }
    const info = this.lib.mp2t.tools.inspect(b);
    const t = info?.video?.[0]?.dts ?? info?.audio?.[0]?.dts;
    const jumped = t !== undefined && this.lastDts !== null && Math.abs(t - this.lastDts) > JUMP_LIMIT;
    if (!this.mux || discontinuity || jumped) this.newGroup();
    const last = info?.video?.[info.video.length - 1]?.dts ?? info?.audio?.[info.audio.length - 1]?.dts;
    if (last !== undefined) this.lastDts = last;
    this.mux!.push(b);
    this.mux!.flush();
    this.elapsed += durationSec;
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get hasInit() {
    return !!this.init;
  }

  /** Đoạn khởi tạo kèm thời lượng thật (ghi đè lên phần đầu file khi ghép xong, cùng độ dài) */
  finalInit(): Uint8Array | null {
    return this.init ? withDuration(this.init, this.elapsed) : null;
  }
}
