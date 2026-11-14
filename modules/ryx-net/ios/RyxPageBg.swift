import UIKit
import WebKit

/// Vùng dưới giờ/pin khi đang ở đầu trang: để WebKit tự tô bằng màu nền của chính trang.
/// WKWebView chỉ tô phần nằm ngoài trang (khoảng đệm phía trên, chỗ kéo quá đà) khi KHÔNG trong suốt;
/// react-native-webview mặc định để trong suốt nên trước đây lộ màu nền app thành một dải riêng.
/// WebKit cập nhật màu này cùng lúc vẽ khung hình, nên đổi trang là đổi màu khớp luôn (không trễ như đo bằng script).
enum RyxPageBg {
  static func apply(_ w: WKWebView, bg: UIColor?) {
    // Màu hiện ra trước khi trang có nội dung: theo theme app, đỡ chớp trắng khi đang dùng theme tối
    if let bg, w.backgroundColor != bg { w.backgroundColor = bg }
    if !w.isOpaque { w.isOpaque = true }
  }

  /// "#rrggbb" → UIColor
  static func color(_ hex: String?) -> UIColor? {
    guard let hex, hex.count == 7, hex.hasPrefix("#"), let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }
}
