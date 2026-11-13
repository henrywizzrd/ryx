import UIKit
import WebKit
import ObjectiveC

/// Màu `theme-color` trang tự khai báo, lấy bằng API công khai WKWebView.themeColor (iOS 15+).
/// iOS báo màu này ngay khi đọc xong <head>, sớm hơn script đo màu trong trang. Màu được chuyển vào
/// script của trang (window.__ryxTop) để nó gửi về app qua đường tin nhắn sẵn có — nhờ vậy biết đúng thẻ nào,
/// và script tự đợi trang mới vẽ xong mới gửi (không đổi màu dải trên khi trang cũ còn đang hiện).
enum RyxTheme {
  private static var key: UInt8 = 0

  static func watch(_ w: WKWebView) {
    if objc_getAssociatedObject(w, &key) != nil { return }
    let obs = w.observe(\.themeColor, options: [.initial, .new]) { web, _ in
      let hex = web.themeColor.flatMap { hexOf($0, traits: web.traitCollection) } ?? ""
      DispatchQueue.main.async {
        web.evaluateJavaScript("window.__ryxTop&&window.__ryxTop('\(hex)')", completionHandler: nil)
      }
    }
    // Gắn vào chính WebView: WebView mất thì bộ theo dõi mất theo
    objc_setAssociatedObject(w, &key, obs, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
  }

  private static func hexOf(_ c: UIColor, traits: UITraitCollection) -> String? {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    guard c.resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a), a > 0.5 else { return nil }
    func h(_ v: CGFloat) -> String { String(format: "%02x", Int((min(max(v, 0), 1) * 255).rounded())) }
    return "#" + h(r) + h(g) + h(b)
  }
}
