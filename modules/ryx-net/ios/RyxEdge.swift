import UIKit
import WebKit

/// Hiệu ứng mờ dần ở mép trên (iOS 26+): nội dung trang chạy lên dưới giờ/pin/Dynamic Island,
/// mép trên mờ đậm rồi nhạt dần xuống — giống Safari / app Claude. Dùng API có sẵn của iOS, không phải thư viện.
enum RyxEdge {
  /// Vùng cuộn đã đặt rồi: chỉ đặt 1 lần (đổi qua lại kiểu hiệu ứng nhiều lần có thể làm iOS ngừng đổi màu theo trang)
  private static let done = NSHashTable<UIScrollView>.weakObjects()

  /// Áp cho mọi WKWebView và mọi vùng cuộn được đánh dấu testID "ryx-edge" (trang chủ). Trả về số vùng đã áp.
  static func applyAll() -> Int {
    guard #available(iOS 26.0, *) else { return 0 }
    var n = 0
    func soft(_ sv: UIScrollView) {
      if done.contains(sv) { return }
      done.add(sv)
      // Đặt hẳn .soft: có báo cáo iOS 27 đổi mặc định sang .hard (dải đặc có đường kẻ)
      sv.topEdgeEffect.style = .soft
      sv.topEdgeEffect.isHidden = false
      n += 1
    }
    func firstScroll(_ v: UIView) -> UIScrollView? {
      if let s = v as? UIScrollView { return s }
      for c in v.subviews { if let s = firstScroll(c) { return s } }
      return nil
    }
    func walk(_ v: UIView) {
      if let w = v as? WKWebView {
        soft(w.scrollView)
        // Thanh cuộn bắt đầu dưới giờ/pin như nội dung
        w.scrollView.verticalScrollIndicatorInsets.top = w.scrollView.contentInset.top
        return
      }
      if v.accessibilityIdentifier == "ryx-edge", let s = firstScroll(v) { soft(s) }
      for c in v.subviews { walk(c) }
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let ws = scene as? UIWindowScene else { continue }
      for window in ws.windows { walk(window) }
    }
    return n
  }
}
