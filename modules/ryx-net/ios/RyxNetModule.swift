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
      // Bật càng sớm càng tốt: WebKit chỉ áp proxy cho các kết nối mở SAU khi cấu hình.
      RyxProxy.shared.startIfEnabled()
    }

    OnDestroy {
      RyxProxy.shared.onLog = nil
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
  }
}
