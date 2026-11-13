/**
 * Bộ thông số chuyển động dùng chung, theo tinh thần "Designing Fluid Interfaces" (Apple, WWDC 2018):
 * lò xo tắt dần tới hạn (dampingRatio 1) là mặc định → mượt, không nảy; chỉ giữ chút đàn hồi rất nhẹ
 * cho thứ được ngón tay ném đi. Thời lượng ở đây là thời lượng cảm nhận (Reanimated chạy ~1,5 lần).
 */
export const MOTION = {
  /** Trang thu nhỏ / phóng to, màn các thẻ */
  smooth: { duration: 460, dampingRatio: 1 },
  /** Dock về chỗ cũ sau khi kéo, nảy rất nhẹ */
  settle: { duration: 420, dampingRatio: 0.92 },
  /** Phản hồi nhỏ: nhấn nút, phồng thanh địa chỉ, menu bật ra */
  snappy: { duration: 280, dampingRatio: 1 },
} as const;

/** Thời lượng (ms) cho các hiệu ứng thêm/xoá/dồn chỗ của danh sách */
export const LAYOUT_MS = 380;
