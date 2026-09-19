import Foundation

struct Pairing {
    let endpoint: URL
    let room: String
    let token: String
    init(_ value: String) throws {
        guard let url = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "bondimals", url.host == "bridge" else { throw BridgeError.message("Paste the phoneLink from your pairing file.") }
        let query = url.queryItems ?? []
        guard let relay = query.first(where: { $0.name == "relay" })?.value,
              let endpoint = URL(string: relay), endpoint.scheme == "wss", endpoint.path == "/ws",
              endpoint.user == nil, endpoint.password == nil, endpoint.query == nil, endpoint.fragment == nil,
              let room = query.first(where: { $0.name == "room" })?.value, room.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil,
              let token = query.first(where: { $0.name == "token" })?.value, token.range(of: "^[a-f0-9]{48}$", options: .regularExpression) != nil
        else { throw BridgeError.message("Pairing needs a public wss:// address and valid room keys.") }
        self.endpoint = endpoint; self.room = room; self.token = token
    }
}
enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

@MainActor
final class LandmarkRelay {
    private var socket: URLSessionWebSocketTask?
    private var reader: Task<Void, Never>?
    private var sending = false
    private var generation = 0
    var onDisconnect: (String) -> Void = { _ in }
    var onPreviewDemand: (Bool) -> Void = { _ in }
    private(set) var previewRequested = false

    func connect(_ pairing: Pairing) async throws {
        stop()
        let generation = self.generation
        var request = URLRequest(url: pairing.endpoint)
        request.timeoutInterval = 12
        let socket = URLSession.shared.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        do {
            let hello = ["type": "hello", "role": "publisher", "room": pairing.room, "token": pairing.token]
            let data = try JSONSerialization.data(withJSONObject: hello)
            try await socket.send(.string(String(decoding: data, as: UTF8.self)))
            let response = try await socket.receive()
            guard case .string(let text) = response,
                  let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  object["type"] as? String == "ready", object["role"] as? String == "publisher"
            else { throw BridgeError.message("Camera pairing was rejected.") }
            guard generation == self.generation else { throw CancellationError() }
            previewRequested = object["previewRequested"] as? Bool ?? false
            onPreviewDemand(previewRequested)
            reader = Task { [weak self] in
                do {
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        guard let self, generation == self.generation else { return }
                        if case .string(let text) = message,
                           let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                           object["type"] as? String == "preview-demand", let enabled = object["enabled"] as? Bool {
                            self.previewRequested = enabled
                            self.onPreviewDemand(enabled)
                        }
                    }
                }
                catch {
                    guard let self, generation == self.generation, !Task.isCancelled else { return }
                    self.onDisconnect("Camera bridge disconnected. Restart when connected.")
                }
            }
        } catch { socket.cancel(with: .goingAway, reason: nil); throw error }
    }
    func send(_ frame: HandFrame) {
        guard !sending, let socket, let data = try? JSONEncoder().encode(frame), data.count < 98_304 else { return }
        // One in-flight send. A slow network drops observations rather than accumulating lag.
        sending = true
        let generation = self.generation
        socket.send(.string(String(decoding: data, as: UTF8.self))) { [weak self] error in
            Task { @MainActor in
                guard let self, generation == self.generation else { return }
                self.sending = false
                if error != nil { self.onDisconnect("Could not send hand points. Restart the bridge.") }
            }
        }
    }
    func stop() {
        generation += 1
        reader?.cancel(); reader = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        sending = false
        previewRequested = false
        onPreviewDemand(false)
    }
}
