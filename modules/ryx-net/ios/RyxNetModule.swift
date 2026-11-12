import ExpoModulesCore

/// Cầu nối JS ↔ proxy DNS nội bộ của Ryx.
public class RyxNetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RyxNet")

    Events("onLog")

    OnCreate {
      RyxProxy.shared.onLog = { [weak self] level, message in
        self?.sendEvent("onLog", ["level": level, "message": message])
      }
      RyxBlocker.shared.onLog = { [weak self] level, message in
        self?.sendEvent("onLog", ["level": level, "message": message])
      }
      // Bật càng sớm càng tốt: WebKit chỉ áp proxy cho các kết nối mở SAU khi cấu hình.
      RyxProxy.shared.startIfEnabled()
    }

    OnDestroy {
      RyxProxy.shared.onLog = nil
      RyxBlocker.shared.onLog = nil
    }

    /// iOS 17+ mới có ProxyConfiguration cho WKWebView.
    Function("isSupported") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }

    Function("getStatus") { () -> [String: Any] in
      RyxProxy.shared.status()
    }

    /// provider: "cloudflare" | "google"
    Function("setEnabled") { (enabled: Bool, provider: String) in
      RyxProxy.shared.setEnabled(enabled, provider: provider)
    }

    /// Lấy (và xoá) các dòng log ghi trước khi JS kịp lắng nghe sự kiện.
    Function("drainLogs") { () -> [[String: String]] in
      RyxProxy.shared.drainLogs()
    }

    /// Xoá bộ nhớ đệm DNS (khi đổi máy chủ).
    Function("clearCache") {
      RyxProxy.shared.clearCache()
    }

    // MARK: Content Blocking (bộ lọc quảng cáo của WebKit)

    /// Biên dịch luật (JSON định dạng Safari Content Blocker). Trả nil nếu ổn, chuỗi lỗi nếu hỏng.
    AsyncFunction("compileRules") { (id: String, json: String, promise: Promise) in
      RyxBlocker.shared.compile(id: id, json: json) { error in promise.resolve(error) }
    }.runOnQueue(.main)

    /// Bật đúng các danh sách này cho mọi WebView. Trả số danh sách tìm thấy.
    AsyncFunction("setActiveRules") { (ids: [String], promise: Promise) in
      RyxBlocker.shared.setActive(ids: ids) { n in promise.resolve(n) }
    }.runOnQueue(.main)

    /// Gắn bộ lọc vào các WebView mới tạo. Trả số WebView vừa gắn.
    AsyncFunction("attachRules") { () -> Int in
      RyxBlocker.shared.attachAll()
    }.runOnQueue(.main)

    AsyncFunction("removeRules") { (ids: [String], promise: Promise) in
      RyxBlocker.shared.remove(ids: ids) { promise.resolve(nil) }
    }.runOnQueue(.main)

    AsyncFunction("listRules") { (promise: Promise) in
      RyxBlocker.shared.listIds { ids in promise.resolve(ids) }
    }.runOnQueue(.main)
  }
}
