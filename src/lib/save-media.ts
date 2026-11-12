import { File, Paths } from 'expo-file-system';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library/legacy';

import { log } from '@/lib/logger';

export type MediaKind = 'image' | 'video';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif)(?:[/?#]|$)/i;
const VIDEO_EXT = /\.(mp4|m4v|mov)(?:[/?#]|$)/i;

/** Đuôi file để Ảnh nhận đúng loại (link kiểu get_file/…/123.mp4/?token không có đuôi ở cuối). */
function extFor(url: string, kind: MediaKind): string {
  const m = (kind === 'video' ? VIDEO_EXT : IMAGE_EXT).exec(url);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return kind === 'video' ? 'mp4' : 'jpg';
}

export class SaveMediaError extends Error {}

/**
 * Tải ảnh/video về máy rồi lưu vào app Ảnh.
 * Gửi kèm Referer của trang vì nhiều máy chủ ảnh/video chặn tải khi thiếu.
 */
export async function saveMediaToPhotos(url: string, kind: MediaKind, pageUrl: string | null): Promise<void> {
  if (!/^https?:/i.test(url)) {
    // blob:/data: là dữ liệu nằm trong trang (vd video HLS), không tải lại được từ ngoài
    throw new SaveMediaError(kind === 'video' ? 'Video này phát theo dạng luồng nên không lưu được.' : 'Ảnh này không có link tải được.');
  }
  const perm = await requestPermissionsAsync(true);
  if (!perm.granted) throw new SaveMediaError('Ryx chưa được cấp quyền thêm vào Ảnh. Vào Cài đặt → Ryx → Ảnh để bật.');

  const dest = new File(Paths.cache, `ryx-${Date.now()}.${extFor(url, kind)}`);
  const started = Date.now();
  try {
    const file = await File.downloadFileAsync(url, dest, {
      headers: pageUrl ? { Referer: pageUrl } : {},
    });
    await saveToLibraryAsync(file.uri);
    log.info('media', `Đã lưu ${kind === 'video' ? 'video' : 'ảnh'} vào Ảnh (${((Date.now() - started) / 1000).toFixed(1)} s)`, url);
    try {
      file.delete();
    } catch {}
  } catch (e) {
    log.error('media', `Lưu ${kind === 'video' ? 'video' : 'ảnh'} thất bại`, `${url}\n${String(e)}`);
    try {
      if (dest.exists) dest.delete();
    } catch {}
    throw new SaveMediaError(kind === 'video' ? 'Không tải được video (máy chủ có thể không cho tải).' : 'Không tải được ảnh.');
  }
}
