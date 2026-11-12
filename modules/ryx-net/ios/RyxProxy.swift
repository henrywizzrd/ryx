import Foundation
import Network
import WebKit

/// Proxy HTTP CONNECT chạy trên 127.0.0.1, tự phân giải tên miền bằng DNS over HTTPS
/// (Cloudflare 1.1.1.1 / Google 8.8.8.8) rồi nối thẳng tới IP thật.
/// - Chỉ đổi cách hỏi DNS: kết nối HTTPS của trang vẫn mã hoá đầu-cuối (proxy chỉ chuyển byte, không giải mã).
/// - Áp cho WKWebsiteDataStore.default() (WebView của Ryx) qua ProxyConfiguration (iOS 17+).
/// - DoH lỗi → dùng DNS hệ thống để trang vẫn mở được (và ghi log).
final class RyxProxy {
  static let shared = RyxProxy()

  var onLog: ((String, String) -> Void)?

  private let queue = DispatchQueue(label: "ryx.proxy", qos: .userInitiated)
  private var listener: NWListener?
  private var port: UInt16 = 0
  private var running = false
  private var applied = false

  private let defaults = UserDefaults.standard
  private let kEnabled = "ryx.dns.enabled"
  private let kProvider = "ryx.dns.provider"

  // Thống kê (chỉ đọc/ghi trên `queue`)
  private var statResolved = 0
  private var statCacheHits = 0
  private var statDohFailures = 0
  private var statFallbacks = 0
  private var statTunnels = 0
  private var statTunnelFailures = 0
  private var loggedDohFailures = 0
  private var fallbackHostsLogged = Set<String>()

  private var cache: [String: (ips: [String], expires: Date)] = [:]
  private var pendingLogs: [[String: String]] = []
  private let logLock = NSLock()

  private let session: URLSession = {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = 4
    cfg.timeoutIntervalForResource = 6
    cfg.waitsForConnectivity = false
    cfg.httpMaximumConnectionsPerHost = 4
    cfg.connectionProxyDictionary = [:] // DoH đi thẳng, không qua proxy nào
    return URLSession(configuration: cfg)
  }()

  var enabled: Bool { defaults.object(forKey: kEnabled) as? Bool ?? false }
  var provider: String { defaults.string(forKey: kProvider) ?? "cloudflare" }

  // MARK: - Log

  private func log(_ level: String, _ message: String) {
    logLock.lock()
    pendingLogs.append(["level": level, "message": message])
    if pendingLogs.count > 200 { pendingLogs.removeFirst(pendingLogs.count - 200) }
    logLock.unlock()
    onLog?(level, message)
  }

  func drainLogs() -> [[String: String]] {
    logLock.lock()
    defer { logLock.unlock() }
    let out = pendingLogs
    pendingLogs.removeAll()
    return out
  }

  // MARK: - Bật / tắt

  func startIfEnabled() {
    if enabled { start() }
  }

  func setEnabled(_ on: Bool, provider: String) {
    defaults.set(on, forKey: kEnabled)
    defaults.set(provider == "google" ? "google" : "cloudflare", forKey: kProvider)
    clearCache()
    if on { start() } else { stop() }
  }

  func clearCache() {
    queue.async { self.cache.removeAll() }
  }

  func status() -> [String: Any] {
    var supported = false
    if #available(iOS 17.0, *) { supported = true }
    return queue.sync { () -> [String: Any] in
      [
        "supported": supported,
        "enabled": enabled,
        "provider": provider,
        "running": running,
        "applied": applied,
        "port": Int(port),
        "resolved": statResolved,
        "cacheHits": statCacheHits,
        "dohFailures": statDohFailures,
        "fallbacks": statFallbacks,
        "tunnels": statTunnels,
        "tunnelFailures": statTunnelFailures,
      ]
    }
  }

  func start() {
    guard #available(iOS 17.0, *) else {
      log("warn", "DNS riêng cần iOS 17 trở lên, máy đang dùng bản thấp hơn")
      return
    }
    queue.async {
      if self.listener != nil {
        if self.running { self.applyProxy() }
        return
      }
      do {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        params.acceptLocalOnly = true
        params.allowLocalEndpointReuse = true
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] conn in self?.handleClient(conn) }
        l.stateUpdateHandler = { [weak self] state in
          guard let self else { return }
          switch state {
          case .ready:
            self.port = l.port?.rawValue ?? 0
            self.running = true
            self.log("info", "Proxy DNS đã chạy ở 127.0.0.1:\(self.port), máy chủ: \(self.provider)")
            self.applyProxy()
          case .failed(let err):
            self.running = false
            self.log("error", "Proxy DNS dừng vì lỗi: \(err.localizedDescription)")
            self.listener = nil
            self.clearProxy()
          case .cancelled:
            self.running = false
          default:
            break
          }
        }
        self.listener = l
        l.start(queue: self.queue)
      } catch {
        self.log("error", "Không mở được proxy DNS: \(error.localizedDescription)")
      }
    }
  }

  func stop() {
    queue.async {
      self.listener?.cancel()
      self.listener = nil
      self.running = false
      self.port = 0
      self.clearProxy()
      self.log("info", "Đã tắt DNS riêng (trình duyệt dùng lại mạng thường)")
    }
  }

  private func applyProxy() {
    guard port > 0, let nwPort = NWEndpoint.Port(rawValue: port) else { return }
    DispatchQueue.main.async {
      guard #available(iOS 17.0, *) else { return }
      var config = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: nwPort))
      config.excludedDomains = ["localhost", "127.0.0.1"]
      WKWebsiteDataStore.default().proxyConfigurations = [config]
      self.queue.async { self.applied = true }
    }
  }

  private func clearProxy() {
    DispatchQueue.main.async {
      guard #available(iOS 17.0, *) else { return }
      WKWebsiteDataStore.default().proxyConfigurations = []
      self.queue.async { self.applied = false }
    }
  }

  // MARK: - Xử lý một kết nối từ WebView

  private func handleClient(_ client: NWConnection) {
    client.start(queue: queue)
    readHeader(client, buffer: Data())
  }

  private static let headerEnd = Data("\r\n\r\n".utf8)

  private func readHeader(_ client: NWConnection, buffer: Data) {
    client.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, done, error in
      guard let self else { return }
      var buf = buffer
      if let data { buf.append(data) }
      if let r = buf.range(of: RyxProxy.headerEnd) {
        let head = buf.subdata(in: buf.startIndex..<r.upperBound)
        let rest = buf.subdata(in: r.upperBound..<buf.endIndex)
        self.route(client, head: head, rest: rest)
      } else if error != nil || done || buf.count > 65_536 {
        client.cancel()
      } else {
        self.readHeader(client, buffer: buf)
      }
    }
  }

  private func route(_ client: NWConnection, head: Data, rest: Data) {
    let text = String(decoding: head, as: UTF8.self)
    let firstLine = text.components(separatedBy: "\r\n").first ?? ""
    let parts = firstLine.split(separator: " ", maxSplits: 2).map(String.init)
    guard parts.count >= 2 else { return reply(client, "400 Bad Request") }
    let method = parts[0].uppercased()
    let target = parts[1]

    if method == "CONNECT" {
      guard let (host, port) = Self.splitHostPort(target, defaultPort: 443) else {
        return reply(client, "400 Bad Request")
      }
      openUpstream(host: host, port: port) { [weak self] upstream in
        guard let self else { return }
        guard let upstream else { return self.reply(client, "502 Bad Gateway") }
        let ok = Data("HTTP/1.1 200 Connection Established\r\n\r\n".utf8)
        client.send(content: ok, completion: .contentProcessed { err in
          if err != nil { client.cancel(); upstream.cancel(); return }
          if !rest.isEmpty { upstream.send(content: rest, completion: .contentProcessed { _ in }) }
          self.relay(from: client, to: upstream)
          self.relay(from: upstream, to: client)
        })
      }
      return
    }

    // HTTP thường (http://...): request-line dạng tuyệt đối → đổi về dạng đường dẫn
    guard let url = URL(string: target), let host = url.host else { return reply(client, "400 Bad Request") }
    let port = UInt16(url.port ?? 80)
    var path = url.path.isEmpty ? "/" : url.path
    if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
      path = comps.percentEncodedPath.isEmpty ? "/" : comps.percentEncodedPath
      if let q = comps.percentEncodedQuery { path += "?" + q }
    }
    let version = parts.count > 2 ? parts[2] : "HTTP/1.1"
    var lines = text.components(separatedBy: "\r\n").filter { !$0.isEmpty }
    lines.removeFirst()
    lines = lines.filter {
      let l = $0.lowercased()
      return !l.hasPrefix("proxy-connection:") && !l.hasPrefix("connection:") && !l.hasPrefix("keep-alive:")
    }
    lines.insert("\(method) \(path) \(version)", at: 0)
    lines.append("Connection: close")
    let newHead = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)

    openUpstream(host: host, port: port) { [weak self] upstream in
      guard let self else { return }
      guard let upstream else { return self.reply(client, "502 Bad Gateway") }
      upstream.send(content: newHead + rest, completion: .contentProcessed { err in
        if err != nil { client.cancel(); upstream.cancel(); return }
        self.relay(from: client, to: upstream)
        self.relay(from: upstream, to: client)
      })
    }
  }

  private func reply(_ client: NWConnection, _ status: String) {
    let body = Data("HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)
    client.send(content: body, completion: .contentProcessed { _ in client.cancel() })
  }

  /// Chuyển byte một chiều cho tới khi một bên đóng.
  private func relay(from: NWConnection, to: NWConnection) {
    from.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, done, error in
      if let data, !data.isEmpty {
        to.send(content: data, completion: .contentProcessed { sendErr in
          if sendErr != nil {
            from.cancel(); to.cancel()
          } else if done {
            self?.finish(from: from, to: to)
          } else {
            self?.relay(from: from, to: to)
          }
        })
      } else if done || error != nil {
        self?.finish(from: from, to: to)
      } else {
        self?.relay(from: from, to: to)
      }
    }
  }

  private func finish(from: NWConnection, to: NWConnection) {
    to.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
      to.cancel()
    })
    from.cancel()
  }

  // MARK: - Kết nối tới máy chủ thật

  private func openUpstream(host: String, port: UInt16, completion: @escaping (NWConnection?) -> Void) {
    resolve(host) { [weak self] ips in
      guard let self else { return completion(nil) }
      if ips.isEmpty {
        // DoH không trả lời được → để hệ thống tự phân giải (trang vẫn mở được nếu không bị chặn)
        self.statFallbacks += 1
        if self.fallbackHostsLogged.count < 50, self.fallbackHostsLogged.insert(host).inserted {
          self.log("warn", "Không hỏi được DNS riêng cho \(host), dùng DNS hệ thống")
        }
        self.connect(candidates: [host], port: port, host: host, completion: completion)
      } else {
        self.connect(candidates: ips, port: port, host: host, completion: completion)
      }
    }
  }

  private func connect(candidates: [String], port: UInt16, host: String, completion: @escaping (NWConnection?) -> Void) {
    guard let first = candidates.first, let nwPort = NWEndpoint.Port(rawValue: port) else {
      statTunnelFailures += 1
      log("warn", "Không kết nối được tới \(host):\(port)")
      return completion(nil)
    }
    let conn = NWConnection(host: NWEndpoint.Host(first), port: nwPort, using: .tcp)
    let state = Flag()
    let timeout = DispatchWorkItem { [weak self] in
      guard !state.done else { return }
      state.done = true
      conn.cancel()
      self?.connect(candidates: Array(candidates.dropFirst()), port: port, host: host, completion: completion)
    }
    conn.stateUpdateHandler = { [weak self] connState in
      guard let self, !state.done else { return }
      switch connState {
      case .ready:
        state.done = true
        timeout.cancel()
        conn.stateUpdateHandler = nil
        self.statTunnels += 1
        completion(conn)
      case .failed:
        state.done = true
        timeout.cancel()
        conn.cancel()
        self.connect(candidates: Array(candidates.dropFirst()), port: port, host: host, completion: completion)
      default:
        break
      }
    }
    queue.asyncAfter(deadline: .now() + 8, execute: timeout)
    conn.start(queue: queue)
  }

  // MARK: - DNS over HTTPS

  private static func isIPLiteral(_ host: String) -> Bool {
    if IPv4Address(host) != nil { return true }
    if IPv6Address(host) != nil { return true }
    return false
  }

  private func resolve(_ host: String, completion: @escaping ([String]) -> Void) {
    if Self.isIPLiteral(host) || host == "localhost" { return completion([host]) }
    let key = host.lowercased()
    if let hit = cache[key], hit.expires > Date() {
      statCacheHits += 1
      return completion(hit.ips)
    }
    let order = provider == "google" ? ["google", "cloudflare"] : ["cloudflare", "google"]
    queryChain(key, providers: order, type: 1) { [weak self] ips, ttl in
      guard let self else { return completion([]) }
      if !ips.isEmpty {
        self.store(key, ips, ttl)
        return completion(ips)
      }
      // Không có IPv4 → thử IPv6
      self.queryChain(key, providers: order, type: 28) { ips6, ttl6 in
        if !ips6.isEmpty { self.store(key, ips6, ttl6) }
        completion(ips6)
      }
    }
  }

  private func store(_ host: String, _ ips: [String], _ ttl: Int) {
    statResolved += 1
    let seconds = min(max(ttl, 60), 3600)
    cache[host] = (ips, Date().addingTimeInterval(TimeInterval(seconds)))
    if cache.count > 2000 { cache.removeAll() }
  }

  private func queryChain(_ host: String, providers: [String], type: Int, completion: @escaping ([String], Int) -> Void) {
    guard let p = providers.first else { return completion([], 0) }
    query(host, provider: p, type: type) { [weak self] ips, ttl, failed in
      guard let self else { return completion([], 0) }
      if failed {
        self.statDohFailures += 1
        if self.loggedDohFailures < 20 {
          self.loggedDohFailures += 1
          self.log("warn", "Máy chủ DNS \(p) không trả lời cho \(host), thử máy chủ khác")
        }
        self.queryChain(host, providers: Array(providers.dropFirst()), type: type, completion: completion)
      } else {
        completion(ips, ttl)
      }
    }
  }

  /// Gọi DoH dạng JSON. Dùng địa chỉ IP để không phải hỏi DNS hệ thống cho chính máy chủ DNS.
  private func query(_ host: String, provider: String, type: Int, completion: @escaping ([String], Int, Bool) -> Void) {
    let name = host.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? host
    let urlString = provider == "google"
      ? "https://8.8.8.8/resolve?name=\(name)&type=\(type)"
      : "https://1.1.1.1/dns-query?name=\(name)&type=\(type)"
    guard let url = URL(string: urlString) else { return queue.async { completion([], 0, true) } }
    var req = URLRequest(url: url)
    req.setValue("application/dns-json", forHTTPHeaderField: "Accept")
    session.dataTask(with: req) { [weak self] data, response, error in
      var ips: [String] = []
      var ttl = 300
      var failed = true
      if error == nil, let http = response as? HTTPURLResponse, http.statusCode == 200, let data,
         let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        failed = false
        // Status 0 = NOERROR, 3 = NXDOMAIN (tên miền không tồn tại: không phải lỗi máy chủ)
        if let answers = obj["Answer"] as? [[String: Any]] {
          for a in answers where (a["type"] as? Int) == type {
            if let ip = a["data"] as? String { ips.append(ip) }
            if let t = a["TTL"] as? Int { ttl = min(ttl, t) }
          }
        }
      }
      self?.queue.async { completion(ips, ttl, failed) }
    }.resume()
  }

  // MARK: - Tiện ích

  /// "host:port", "[ipv6]:port" → (host, port)
  static func splitHostPort(_ s: String, defaultPort: UInt16) -> (String, UInt16)? {
    if s.hasPrefix("[") {
      guard let close = s.firstIndex(of: "]") else { return nil }
      let host = String(s[s.index(after: s.startIndex)..<close])
      let after = s[s.index(after: close)...]
      if after.hasPrefix(":"), let p = UInt16(after.dropFirst()) { return (host, p) }
      return (host, defaultPort)
    }
    if let colon = s.lastIndex(of: ":"), let p = UInt16(s[s.index(after: colon)...]) {
      return (String(s[..<colon]), p)
    }
    return s.isEmpty ? nil : (s, defaultPort)
  }
}


/// Cờ dùng chung giữa các closure (chỉ đọc/ghi trên hàng đợi của proxy).
private final class Flag {
  var done = false
}
