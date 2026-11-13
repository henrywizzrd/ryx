import BackgroundTasks
import Foundation
import UserNotifications

/// Giữ Ryx chạy tiếp khi cậu rời app trong lúc đang tải (iOS 26+: "tác vụ chạy tiếp" — BGContinuedProcessingTask).
/// Trong lúc tác vụ chạy, cả app (DNS riêng, trình tải, phần ghép HLS bằng JS) vẫn hoạt động như khi đang mở;
/// iOS hiện tiến độ ở Dynamic Island / màn hình khoá. Vuốt tắt app trong đa nhiệm thì iOS vẫn huỷ hết.
/// Một tác vụ chung cho mọi lượt tải đang chạy; JS báo tiến độ tổng (phải tăng đều, đứng im lâu iOS sẽ dừng).
final class RyxBackground {
  static let shared = RyxBackground()
  static let prefix = (Bundle.main.bundleIdentifier ?? "com.henrywizzrd.ryx") + ".download."

  var onEvent: (([String: Any]) -> Void)?
  private let lock = NSLock()
  private var task: AnyObject?  // BGContinuedProcessingTask (iOS 26+)
  private var pending: (done: Int64, total: Int64, title: String, subtitle: String)?
  private var seq = 0

  /// Bắt đầu tác vụ nền (gọi khi bấm tải, lúc app đang mở). Trả về lý do nếu không bắt đầu được.
  func begin(title: String, subtitle: String) -> String? {
    guard #available(iOS 26.0, *) else { return "Cần iOS 26 trở lên" }
    lock.lock()
    let running = task != nil
    seq += 1
    let id = Self.prefix + "\(Int(Date().timeIntervalSince1970))-\(seq)"
    lock.unlock()
    if running { return nil }
    // Phải đăng ký đúng mã cụ thể ngay trước khi gửi (mã trong Info.plist là dạng ".*")
    let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { [weak self] t in
      guard let self, let task = t as? BGContinuedProcessingTask else { t.setTaskCompleted(success: false); return }
      self.lock.lock()
      self.task = task
      let p = self.pending
      self.lock.unlock()
      task.progress.totalUnitCount = max(p?.total ?? 1, 1)
      task.progress.completedUnitCount = p?.done ?? 0
      task.expirationHandler = { [weak self] in
        self?.lock.lock()
        self?.task = nil
        self?.lock.unlock()
        self?.onEvent?(["type": "expired"])
        task.setTaskCompleted(success: false)
      }
      self.onEvent?(["type": "started"])
    }
    if !ok { return "Không đăng ký được tác vụ nền" }
    let req = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: subtitle)
    req.strategy = .fail
    do {
      try BGTaskScheduler.shared.submit(req)
      return nil
    } catch {
      return error.localizedDescription
    }
  }

  func progress(done: Int64, total: Int64, title: String, subtitle: String) {
    lock.lock()
    pending = (done, total, title, subtitle)
    let t = task
    lock.unlock()
    guard #available(iOS 26.0, *), let task = t as? BGContinuedProcessingTask else { return }
    task.progress.totalUnitCount = max(total, 1)
    task.progress.completedUnitCount = min(done, max(total, 1))
    task.updateTitle(title, subtitle: subtitle)
  }

  func end(success: Bool) {
    lock.lock()
    let t = task
    task = nil
    pending = nil
    lock.unlock()
    guard #available(iOS 26.0, *), let task = t as? BGContinuedProcessingTask else { return }
    task.progress.completedUnitCount = task.progress.totalUnitCount
    task.setTaskCompleted(success: success)
  }

  // MARK: Thông báo "Đã tải xong" (khi đang ở ngoài app)

  func requestNotify(completion: @escaping (Bool) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
      completion(granted)
    }
  }

  func notify(title: String, body: String) {
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    c.sound = .default
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)
    UNUserNotificationCenter.current().add(req)
  }
}
