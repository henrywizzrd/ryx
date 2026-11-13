import Foundation
import Network
import WebKit

/// Tải file cho màn "Tải về" của Ryx, đi CÙNG ĐƯỜNG với trình duyệt:
/// - qua proxy DNS riêng của Ryx (iOS 17+) nên tên miền bị nhà mạng chặn vẫn tải được;
/// - gửi kèm cookie của trang (lấy từ WebView) và User-Agent giống WebView, vì nhiều máy chủ video kiểm tra.
/// Gửi sự kiện tiến độ / xong / lỗi về JS qua `onEvent`.
final class RyxDownloader: NSObject, URLSessionDownloadDelegate {
  static let shared = RyxDownloader()

  /// (tên sự kiện, dữ liệu) — module chuyển thành event "onDownload"
  var onEvent: (([String: Any]) -> Void)?

  private let lock = NSLock()
  private var sessionPort: UInt16 = 0
  private var _session: URLSession?
  private var tasksById: [String: URLSessionDownloadTask] = [:]
  private var info: [Int: (id: String, path: String)] = [:]
  private var lastEmit: [String: Date] = [:]
  private var canceled = Set<String>()

  static let userAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

  /// Tạo lại phiên khi cổng proxy đổi (bật/tắt DNS riêng).
  private func session() -> URLSession {
    let port = RyxProxy.shared.activePort
    lock.lock()
    defer { lock.unlock() }
    if let s = _session, sessionPort == port { return s }
    let cfg = URLSessionConfiguration.default
    cfg.timeoutIntervalForRequest = 30
    cfg.httpShouldSetCookies = false // tự gắn cookie lấy từ WebView
    if #available(iOS 17.0, *), port > 0, let nwPort = NWEndpoint.Port(rawValue: port) {
      cfg.proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: nwPort))]
    }
    let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    _session?.finishTasksAndInvalidate()
    _session = s
    sessionPort = port
    return s
  }

  func start(id: String, url: String, path: String, headers: [String: String]) {
    guard let u = URL(string: url) else {
      return emit(["id": id, "type": "error", "message": "Link không hợp lệ"])
    }
    // Cookie của trang nằm trong kho cookie của WebView (phải đọc trên luồng chính)
    DispatchQueue.main.async {
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
        let host = u.host ?? ""
        let match = cookies.filter { c in
          let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
          return host == d || host.hasSuffix("." + d)
        }
        var req = URLRequest(url: u)
        req.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        for (k, v) in HTTPCookie.requestHeaderFields(with: match) { req.setValue(v, forHTTPHeaderField: k) }
        let task = self.session().downloadTask(with: req)
        self.lock.lock()
        self.tasksById[id] = task
        self.info[task.taskIdentifier] = (id, path)
        self.lock.unlock()
        task.resume()
        self.emit([
          "id": id, "type": "start",
          "viaProxy": RyxProxy.shared.activePort > 0, "cookies": match.count,
        ])
      }
    }
  }

  func cancel(id: String) {
    lock.lock()
    let task = tasksById[id]
    canceled.insert(id)
    lock.unlock()
    task?.cancel()
  }

  private func emit(_ payload: [String: Any]) {
    onEvent?(payload)
  }

  private func lookup(_ task: URLSessionTask) -> (id: String, path: String)? {
    lock.lock()
    defer { lock.unlock() }
    return info[task.taskIdentifier]
  }

  private func finish(_ task: URLSessionTask) {
    lock.lock()
    if let i = info.removeValue(forKey: task.taskIdentifier) {
      tasksById.removeValue(forKey: i.id)
      lastEmit.removeValue(forKey: i.id)
    }
    lock.unlock()
  }

  // MARK: URLSessionDownloadDelegate

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard let i = lookup(downloadTask) else { return }
    let now = Date()
    lock.lock()
    let last = lastEmit[i.id] ?? .distantPast
    let due = now.timeIntervalSince(last) > 0.3
    if due { lastEmit[i.id] = now }
    lock.unlock()
    if due {
      emit(["id": i.id, "type": "progress", "written": totalBytesWritten, "total": max(totalBytesExpectedToWrite, 0)])
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard let i = lookup(downloadTask) else { return }
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
    if status >= 400 {
      emit(["id": i.id, "type": "error", "message": "Máy chủ trả lỗi \(status)"])
      return
    }
    let dest = URL(fileURLWithPath: i.path)
    do {
      try? FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
      if FileManager.default.fileExists(atPath: dest.path) { try FileManager.default.removeItem(at: dest) }
      try FileManager.default.moveItem(at: location, to: dest)
      let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
      let type = (downloadTask.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
      emit(["id": i.id, "type": "done", "size": size, "contentType": type])
    } catch {
      emit(["id": i.id, "type": "error", "message": "Không lưu được file: \(error.localizedDescription)"])
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer { finish(task) }
    guard let error, let i = lookup(task) else { return }
    lock.lock()
    let wasCanceled = canceled.remove(i.id) != nil
    lock.unlock()
    if wasCanceled { return }
    emit(["id": i.id, "type": "error", "message": error.localizedDescription])
  }
}
