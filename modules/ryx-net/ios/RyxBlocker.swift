import Foundation
import UIKit
import WebKit

/// Content Blocking của WebKit cho mọi WKWebView trong app (giống cách Brave/AdGuard chặn trên iOS):
/// luật được biên dịch một lần (WKContentRuleListStore lưu lại qua các lần mở app),
/// rồi gắn vào userContentController của từng WebView. Chặn ngay ở tầng mạng, kể cả trong iframe.
/// Mọi hàm chạy trên luồng chính (WebKit yêu cầu).
final class RyxBlocker {
  static let shared = RyxBlocker()

  private var store: WKContentRuleListStore? { WKContentRuleListStore.default() }
  /// Danh sách đang bật (theo thứ tự id).
  private var active: [WKContentRuleList] = []
  private var generation = 0
  /// WebView đã gắn danh sách của thế hệ nào (khoá yếu: WebView đóng thì tự rơi khỏi bảng).
  private let attached = NSMapTable<WKWebView, NSNumber>.weakToStrongObjects()
  /// Mọi danh sách Ryx từng gắn, để gỡ khi thay bộ mới.
  private var everAttached: [WKContentRuleList] = []

  var onLog: ((String, String) -> Void)?

  func compile(id: String, json: String, completion: @escaping (String?) -> Void) {
    guard let store else { return completion("Không mở được kho luật của WebKit") }
    let started = Date()
    store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: json) { [weak self] list, error in
      if let error {
        completion(error.localizedDescription)
        return
      }
      let ms = Int(Date().timeIntervalSince(started) * 1000)
      self?.onLog?("debug", "Biên dịch bộ lọc \(id) xong trong \(ms) ms")
      completion(list == nil ? "Không có kết quả biên dịch" : nil)
    }
  }

  /// Bật đúng các danh sách có id trong `ids` (đã biên dịch trước đó); gắn lại vào mọi WebView.
  func setActive(ids: [String], completion: @escaping (Int) -> Void) {
    guard let store else { return completion(0) }
    var found: [String: WKContentRuleList] = [:]
    let group = DispatchGroup()
    for id in ids {
      group.enter()
      store.lookUpContentRuleList(forIdentifier: id) { list, _ in
        if let list { found[id] = list }
        group.leave()
      }
    }
    group.notify(queue: .main) { [weak self] in
      guard let self else { return completion(0) }
      self.active = ids.compactMap { found[$0] }
      self.generation += 1
      self.attachAll()
      completion(self.active.count)
    }
  }

  /// Gắn danh sách đang bật vào mọi WKWebView đang có trên màn hình (gọi lại khi có thẻ mới).
  @discardableResult
  func attachAll() -> Int {
    var count = 0
    for webView in Self.allWebViews() {
      let gen = attached.object(forKey: webView)?.intValue ?? -1
      if gen == generation { continue }
      let ucc = webView.configuration.userContentController
      for old in everAttached { ucc.remove(old) }
      for list in active { ucc.add(list) }
      attached.setObject(NSNumber(value: generation), forKey: webView)
      count += 1
    }
    for list in active where !everAttached.contains(where: { $0 === list }) { everAttached.append(list) }
    return count
  }

  func remove(ids: [String], completion: @escaping () -> Void) {
    guard let store, !ids.isEmpty else { return completion() }
    let group = DispatchGroup()
    for id in ids {
      group.enter()
      store.removeContentRuleList(forIdentifier: id) { _ in group.leave() }
    }
    group.notify(queue: .main, execute: completion)
  }

  func listIds(completion: @escaping ([String]) -> Void) {
    guard let store else { return completion([]) }
    store.getAvailableContentRuleListIdentifiers { ids in
      DispatchQueue.main.async { completion(ids ?? []) }
    }
  }

  private static func allWebViews() -> [WKWebView] {
    var out: [WKWebView] = []
    func walk(_ v: UIView) {
      if let w = v as? WKWebView {
        out.append(w)
        return
      }
      for s in v.subviews { walk(s) }
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let ws = scene as? UIWindowScene else { continue }
      for window in ws.windows { walk(window) }
    }
    return out
  }
}
