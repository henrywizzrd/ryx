import AVFoundation
import CommonCrypto
import Foundation

/// Hỗ trợ tải video HLS: giải mã đoạn AES-128 và chuyển MP4 phân mảnh (ghép từ các đoạn) thành MP4 thường.
enum RyxMedia {
  enum Failure: LocalizedError {
    case badKey, crypt(Int32), export(String)
    var errorDescription: String? {
      switch self {
      case .badKey: return "Khoá giải mã không hợp lệ"
      case .crypt(let s): return "Giải mã thất bại (\(s))"
      case .export(let m): return m
      }
    }
  }

  /// AES-128-CBC, PKCS7 (chuẩn HLS). iv: 16 byte.
  static func decryptAES128(inPath: String, outPath: String, keyPath: String, ivHex: String) throws {
    let key = try Data(contentsOf: URL(fileURLWithPath: keyPath))
    guard key.count == kCCKeySizeAES128 else { throw Failure.badKey }
    let iv = dataFromHex(ivHex, length: 16)
    let input = try Data(contentsOf: URL(fileURLWithPath: inPath))
    var out = Data(count: input.count + kCCBlockSizeAES128)
    var moved = 0
    let outCap = out.count
    let status = out.withUnsafeMutableBytes { outPtr in
      input.withUnsafeBytes { inPtr in
        key.withUnsafeBytes { keyPtr in
          iv.withUnsafeBytes { ivPtr in
            CCCrypt(
              CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
              keyPtr.baseAddress, key.count, ivPtr.baseAddress,
              inPtr.baseAddress, input.count, outPtr.baseAddress, outCap, &moved)
          }
        }
      }
    }
    guard status == CCCryptorStatus(kCCSuccess) else { throw Failure.crypt(status) }
    out.count = moved
    try out.write(to: URL(fileURLWithPath: outPath))
  }

  static func dataFromHex(_ hex: String, length: Int) -> Data {
    var s = hex.lowercased()
    if s.hasPrefix("0x") { s = String(s.dropFirst(2)) }
    s = String(repeating: "0", count: max(0, length * 2 - s.count)) + s
    var d = Data(capacity: length)
    var i = s.startIndex
    while i < s.endIndex, d.count < length {
      let j = s.index(i, offsetBy: 2)
      d.append(UInt8(s[i..<j], radix: 16) ?? 0)
      i = j
    }
    return d
  }

  /// MP4 phân mảnh → MP4 thường (giữ nguyên hình/tiếng, không nén lại).
  static func exportMp4(inPath: String, outPath: String, completion: @escaping (Error?) -> Void) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: inPath))
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      return completion(Failure.export("Không tạo được phiên xuất video"))
    }
    let out = URL(fileURLWithPath: outPath)
    try? FileManager.default.removeItem(at: out)
    session.outputURL = out
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    session.exportAsynchronously {
      if session.status == .completed { completion(nil) }
      else { completion(Failure.export(session.error?.localizedDescription ?? "Xuất video thất bại")) }
    }
  }
}
