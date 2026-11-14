import UIKit
import WebKit

/// Hiệu ứng mờ dần ở mép trên (iOS 26+): nội dung trang chạy lên dưới giờ/pin/Dynamic Island,
/// mép trên mờ đậm rồi nhạt dần xuống — giống Safari / app Claude. Dùng API có sẵn của iOS, không phải thư viện.
enum RyxEdge {
  /// Vùng cuộn đã đặt rồi: chỉ đặt 1 lần (đổi qua lại kiểu hiệu ứng nhiều lần có thể làm iOS ngừng đổi màu theo trang)
  private static let done = NSHashTable<UIScrollView>.weakObjects()

  /// Áp cho mọi WKWebView (kèm bỏ trong suốt, xem RyxPageBg) và mọi vùng cuộn được đánh dấu testID "ryx-edge" (trang chủ). Trả về số vùng đã áp.
  static func applyAll(bg: UIColor? = nil, top: CGFloat? = nil, bottom: CGFloat? = nil) -> Int {
    var n = 0
    func soft(_ sv: UIScrollView) {
      guard #available(iOS 26.0, *) else { return }
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
        // WebView không trong suốt: WebKit tự tô dải dưới giờ/pin bằng màu nền trang (xem RyxPageBg)
        RyxPageBg.apply(w, bg: bg)
        soft(w.scrollView)
        if let top, let bottom { obscure(w, top: top, bottom: bottom) }
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

  /// Tràn viền kiểu Safari 26 / Brave: báo cho WebKit vùng trên (giờ/pin, thanh địa chỉ) và dưới (dock) đang bị
  /// giao diện app che, thay cho contentInset cũ. WebKit khi đó cho trang vẽ lên dưới vùng bị che và tự kéo dài
  /// màu của header cố định lên trên (giống Safari), không còn dải màu riêng.
  /// obscuredContentInsets là API công khai iOS 26; nó tự đặt contentInset của vùng cuộn nên không đặt tay nữa.
  static func obscure(_ w: WKWebView, top: CGFloat, bottom: CGFloat) {
    let ins = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
    let safe = w.window?.safeAreaInsets ?? .zero
    if #available(iOS 26.0, *) {
      if w.obscuredContentInsets != ins { w.obscuredContentInsets = ins }
    } else {
      // iOS cũ: không có API mới, dùng khoảng đệm như trước
      if w.scrollView.contentInset != ins { w.scrollView.contentInset = ins }
    }
    // Đơn vị vh / phần tử cố định của trang tính theo vùng nhìn thấy được (giữa thanh trên và dock)
    if w.minimumViewportInset != ins || w.maximumViewportInset != ins {
      w.setMinimumViewportInset(ins, maximumViewportInset: ins)
    }
    // Thanh cuộn chạy trong vùng nhìn thấy được, không chui dưới giờ/pin hay dock
    w.scrollView.verticalScrollIndicatorInsets = UIEdgeInsets(
      top: max(0, top - safe.top), left: 0, bottom: max(0, bottom - safe.bottom), right: 0)
  }
}
