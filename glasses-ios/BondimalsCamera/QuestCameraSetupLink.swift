import Foundation

/// A one-use camera capability; it never contains the player's game token.
/// Only the game server already selected in this app may enroll the camera.
struct QuestCameraSetupLink {
    let server: URL
    let code: String

    init(_ url: URL, trustedServer: URL) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "bondimals", parts.host?.lowercased() == "quest-camera",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              let items = parts.queryItems, items.count == 2,
              items.filter({ $0.name == "server" }).count == 1,
              items.filter({ $0.name == "code" }).count == 1,
              let rawServer = items.first(where: { $0.name == "server" })?.value,
              let rawCode = items.first(where: { $0.name == "code" })?.value,
              let candidate = URL(string: rawServer) else { throw SetupError.invalidLink }
        let origin = try Self.origin(candidate)
        guard origin == (try Self.origin(trustedServer)) else { throw SetupError.wrongServer }
        let code = rawCode.uppercased()
        guard code.range(of: "^[A-HJ-NP-Z2-9]{8}$", options: .regularExpression) != nil else { throw SetupError.invalidCode }
        self.server = origin
        self.code = code
    }

    private static func origin(_ url: URL) throws -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { throw SetupError.invalidServer }
        parts.scheme = "https"; parts.host = host.lowercased(); parts.path = ""
        if parts.port == 443 { parts.port = nil }
        guard let origin = parts.url else { throw SetupError.invalidServer }
        return origin
    }

    enum SetupError: LocalizedError {
        case invalidLink, invalidServer, wrongServer, invalidCode
        var errorDescription: String? {
            switch self {
            case .invalidLink: return "This camera setup link is invalid. Open a fresh setup link from Kith."
            case .invalidServer: return "Camera setup requires an HTTPS game-server origin without a path or credentials."
            case .wrongServer: return "This setup link uses a different game server. Set the correct HTTPS server in camera setup first."
            case .invalidCode: return "This camera setup code is invalid. Open a fresh setup link from Kith."
            }
        }
    }
}
