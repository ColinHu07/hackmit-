import Foundation

/// App-private troubleshooting state. Never stores media, pairing keys, player
/// tokens, device identifiers, or complete setup URLs.
struct CameraDiagnostics: Encodable {
    let buildVersion: String
    let serverOrigin: String?
    let setupEvent: String
    let setupStatus: String
    let cameraStatus: String
    let paired: Bool
    let running: Bool
    let cameraReady: Bool
    let cameraState: String
    let cameraMessage: String
    let lastFrameReceived: Bool
    let lastFrameReceivedAt: String?
    let registrationState: String
    let updatedAt: String

    static func origin(_ value: String) -> String? {
        guard var url = URLComponents(string: value), let host = url.host, !host.isEmpty,
              ["https", "wss"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil else { return nil }
        url.scheme = "https"; url.path = ""; url.query = nil; url.fragment = nil
        return url.string
    }

    static func redact(_ value: String, secrets: [String]) -> String {
        var result = value
        for secret in secrets where !secret.isEmpty { result = result.replacingOccurrences(of: secret, with: "[redacted]") }
        for pattern in ["(?i)[a-f0-9]{32,}", "(?i)[a-f0-9]{8}-[a-f0-9-]{27,}", "(?i)(?:[a-f0-9]{2}:){5}[a-f0-9]{2}", "\\b[A-HJ-NP-Z2-9]{8}\\b", "[a-zA-Z][a-zA-Z0-9+.-]*://[^\\s]+"] {
            result = result.replacingOccurrences(of: pattern, with: "[redacted]", options: .regularExpression)
        }
        return String(result.prefix(400))
    }

    func write() {
        do {
            let directory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let url = directory.appendingPathComponent("kith-camera-status.json")
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(self).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        } catch { NSLog("Kith: could not update private camera diagnostics") }
    }
}
