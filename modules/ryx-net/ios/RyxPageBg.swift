import UIKit
import WebKit
import ObjectiveC

/// Vùng dưới giờ/pin khi đang ở đầu trang: để WebKit tự tô bằng màu nền của chính trang.
/// WKWebView chỉ tô phần nằm ngoài trang (khoảng đệm phía trên, chỗ kéo quá đà) khi KHÔNG trong suốt;
/// react-native-webview mặc định để trong suốt nên trước đây lộ màu nền app thành một dải riêng.
/// WebKit cập nhật màu này cùng lúc vẽ khung hình, nên đổi trang là đổi màu khớp luôn (không trễ như đo bằng script).
enum RyxPageBg {
  private static var key: UInt8 = 0

  static func apply(_ w: WKWebView, bg: UIColor?) {
    // Màu hiện ra trước khi trang có nội dung: theo theme app, đỡ chớp trắng khi đang dùng theme tối
    if let bg, w.backgroundColor != bg { w.backgroundColor = bg }
    if !w.isOpaque { w.isOpaque = true }
    attachChannel(w)
  }

  /// Kênh "ryxBg": script của trang báo khi Ryx đang đảo màu trang (chế độ tối/sáng cho trang).
  /// WebKit lấy màu nền GỐC của trang (trước khi đảo) để tô vùng trên/dưới, nên phải đặt lại cho đúng màu sau khi đảo.
  /// "" = trả về mặc định của WebKit.
  private static func attachChannel(_ w: WKWebView) {
    if objc_getAssociatedObject(w, &key) != nil { return }
    let ucc = w.configuration.userContentController
    ucc.removeScriptMessageHandler(forName: "ryxBg")
    ucc.add(Handler.shared, name: "ryxBg")
    objc_setAssociatedObject(w, &key, true, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
  }

  private final class Handler: NSObject, WKScriptMessageHandler {
    static let shared = Handler()
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
      // Chỉ nhận từ khung chính (khung nhúng không được đổi màu nền cả trang)
      guard message.frameInfo.isMainFrame, let web = message.webView else { return }
      let c = RyxPageBg.color(message.body as? String)
      if web.underPageBackgroundColor != c { web.underPageBackgroundColor = c }
    }
  }

  /// "#rrggbb" → UIColor
  static func color(_ hex: String?) -> UIColor? {
    guard let hex, hex.count == 7, hex.hasPrefix("#"), let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }
}
