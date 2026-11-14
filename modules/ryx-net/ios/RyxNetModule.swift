import ExpoModulesCore

/// Cầu nối JS ↔ proxy DNS nội bộ của Ryx.
public class RyxNetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RyxNet")

    Events("onLog", "onDownload", "onBackground")

    OnCreate {
      RyxProxy.shared.onLog = { [weak self] level, message in
        self?.sendEvent("onLog", ["level": level, "message": message])
      }
      RyxBlocker.shared.onLog = { [weak self] level, message in
        self?.sendEvent("onLog", ["level": level, "message": message])
      }
      RyxDownloader.shared.onEvent = { [weak self] payload in
        self?.sendEvent("onDownload", payload)
      }
      RyxBackground.shared.onEvent = { [weak self] payload in
        self?.sendEvent("onBackground", payload)
      }
      // Bật càng sớm càng tốt: WebKit chỉ áp proxy cho các kết nối mở SAU khi cấu hình.
      RyxProxy.shared.startIfEnabled()
    }

    OnDestroy {
      RyxProxy.shared.onLog = nil
      RyxBlocker.shared.onLog = nil
      RyxDownloader.shared.onEvent = nil
      RyxBackground.shared.onEvent = nil
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

    // MARK: Tải về (đi qua DNS riêng + cookie của WebView)

    Function("startDownload") { (id: String, url: String, path: String, headers: [String: String]) in
      RyxDownloader.shared.start(id: id, url: url, path: path, headers: headers)
    }

    Function("cancelDownload") { (id: String) in
      RyxDownloader.shared.cancel(id: id)
    }

    // MARK: Tải tiếp khi rời app (iOS 26+) + thông báo

    Function("bgBegin") { (title: String, subtitle: String) -> String? in
      RyxBackground.shared.begin(title: title, subtitle: subtitle)
    }

    Function("bgProgress") { (done: Double, total: Double, title: String, subtitle: String) in
      RyxBackground.shared.progress(done: Int64(done), total: Int64(total), title: title, subtitle: subtitle)
    }

    Function("bgEnd") { (success: Bool) in
      RyxBackground.shared.end(success: success)
    }

    AsyncFunction("requestNotify") { (promise: Promise) in
      RyxBackground.shared.requestNotify { promise.resolve($0) }
    }

    Function("notify") { (title: String, body: String) in
      RyxBackground.shared.notify(title: title, body: body)
    }

    // MARK: Video HLS

    AsyncFunction("decryptAes128") { (inPath: String, outPath: String, keyPath: String, ivHex: String) in
      try RyxMedia.decryptAES128(inPath: inPath, outPath: outPath, keyPath: keyPath, ivHex: ivHex)
    }

    AsyncFunction("exportMp4") { (inPath: String, outPath: String, promise: Promise) in
      RyxMedia.exportMp4(inPath: inPath, outPath: outPath) { error in
        if let error { promise.reject("ERR_EXPORT", error.localizedDescription) } else { promise.resolve(nil) }
      }
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
    AsyncFunction("applyEdgeEffects") { (bg: String?) -> Int in
      RyxEdge.applyAll(bg: RyxPageBg.color(bg))
    }.runOnQueue(.main)

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
