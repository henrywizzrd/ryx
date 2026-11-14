/**
 * Link mở app từ bên ngoài (expo-router gọi trước khi điều hướng):
 * - "ryx://dataUrl=…" do extension Chia sẻ "Mở bằng Ryx" (expo-share-intent) gửi → về màn chính, hook useShareIntent
 *   trong app/index.tsx tự đọc link được chia sẻ.
 * - "ryx://open?url=<link>" (dùng với Phím tắt) → màn chính với ?open=<link>, app/index.tsx mở link trong thẻ mới.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('dataUrl=')) return '/';
    const m = /^(?:ryx:\/\/|\/)?open\/?\?(?:.*&)?url=([^&]+)/.exec(path);
    if (m) return `/?open=${m[1]}`;
  } catch {
    // Link lạ: để expo-router xử lý như bình thường
  }
  return path;
}
