import Foundation
import SwiftUI
import UIKit

/// Pairs a camera to one active game player without taking over their play socket.
/// Frames stay in memory and only leave the phone after a capture command from
/// that player. The game has a separate review/submit step before AI grading.
@MainActor
final class QuestCaptureBridge: ObservableObject {
    @Published var enabled = false
    @Published var serverURL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "KithGameServerURL") as? String ?? ""
        return value.hasPrefix("$(") ? "" : value
    }()
    @Published var pairingCode = ""
    @Published private(set) var paired = false
    @Published private(set) var connecting = false
    @Published private(set) var status = "Pair with the eight-character camera code in Kith on your glasses."
    @Published private(set) var capturing = false
    @Published private(set) var preview: UIImage?

    var requestPhoto: () -> Bool = { false }
    private var endpoint: URL?
    private var cameraToken: String?
    private var pollTask: Task<Void, Never>?
    private var captureTask: Task<Void, Never>?
    private var connectionTask: Task<Void, Never>?
    private var generation = 0
    private var foreground = true
    private var cameraRunning = false
    private var cameraGeneration = 0
    private var latestFrame: PhoneCameraFrame?
    private var activeRequest: String?
    private var previewRequest: String?
    private var handledCommands: [String] = []
    private var outstandingPhotoRequest: String?
    private var photoData: Data?
    private var pollFailures = 0
    private let noRedirects = QuestNoRedirects()
    private lazy var network: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 12
        return URLSession(configuration: configuration, delegate: noRedirects, delegateQueue: nil)
    }()

    func pair() {
        guard enabled, !connecting, !paired else { return }
        do {
            endpoint = try Self.serverOrigin(serverURL)
            let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard code.range(of: "^[A-HJ-NP-Z2-9]{8}$", options: .regularExpression) != nil else {
                throw BridgeError.message("Enter the eight-character camera pairing code from the game.")
            }
            connecting = true
            status = "Pairing with your glasses game…"
            generation += 1
            let generation = self.generation
            connectionTask = Task { [weak self] in
                guard let self else { return }
                defer { if generation == self.generation { self.connecting = false } }
                do {
                    let response = try await self.api("/glasses/claim", body: ["code": code], authenticated: false)
                    guard generation == self.generation, !Task.isCancelled else { return }
                    guard let token = response["cameraToken"] as? String, !token.isEmpty else {
                        throw BridgeError.message("Camera pairing returned no session. Make a new code in the game.")
                    }
                    self.cameraToken = token
                    self.paired = true
                    self.pairingCode = ""
                    self.status = "Paired. Start the glasses camera, then capture from Quests in the game."
                    self.startPolling()
                } catch {
                    guard generation == self.generation, !Task.isCancelled else { return }
                    self.status = error.localizedDescription
                }
            }
        } catch { status = error.localizedDescription }
    }

    func disconnect(_ message: String = "Camera unpaired. Make a new code in the game to reconnect.") {
        generation += 1
        connectionTask?.cancel(); connectionTask = nil
        pollTask?.cancel(); pollTask = nil
        captureTask?.cancel(); captureTask = nil
        paired = false; connecting = false; capturing = false
        cameraToken = nil; endpoint = nil; activeRequest = nil
        handledCommands.removeAll(); preview = nil; previewRequest = nil; photoData = nil
        status = message
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active { startPolling() }
        else {
            pollTask?.cancel(); pollTask = nil
            cameraStopped("Camera capture paused while this app is in the background.")
        }
    }

    func setCameraRunning(_ running: Bool) {
        if running { cameraRunning = true }
        else { cameraStopped("Glasses camera paused. Start it again before capturing a quest.") }
    }

    func receive(_ frame: PhoneCameraFrame) { latestFrame = frame }

    func receivePhoto(_ data: Data) {
        guard let request = outstandingPhotoRequest else { return }
        // DAT photos have no request identifier. A canceled/timed-out request
        // remains outstanding until its callback or a full camera restart, so
        // a delayed photo can never be reused for a later quest.
        outstandingPhotoRequest = nil
        if activeRequest == request, foreground, cameraRunning { photoData = data }
    }

    func cameraStopped(_ message: String) {
        cameraGeneration += 1
        cameraRunning = false; latestFrame = nil; preview = nil
        if capturing { status = message }
        // The capture loop observes this and reports an error to the game.
    }

    func cameraSessionReleased() {
        cameraStopped("Glasses camera stopped. Start it again before capturing a quest.")
        outstandingPhotoRequest = nil; photoData = nil
    }

    private func startPolling() {
        guard foreground, paired, pollTask == nil else { return }
        let generation = self.generation
        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, generation == self.generation {
                do {
                    let response = try await self.api("/glasses/command")
                    guard generation == self.generation, !Task.isCancelled else { return }
                    if self.pollFailures > 0, !self.capturing { self.status = "Camera connection restored. Ready for a quest capture." }
                    self.pollFailures = 0
                    if let command = response["command"] as? [String: Any] { self.handle(command) }
                } catch {
                    guard generation == self.generation, !Task.isCancelled else { return }
                    if case QuestHTTPError.rejected(401, _) = error {
                        self.disconnect("Your game session changed. Make a new camera code in the game and pair again.")
                        return
                    }
                    self.pollFailures += 1
                    if self.pollFailures >= 3 { self.status = "Camera connection unavailable. Check the server and internet connection." }
                }
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }

    private func handle(_ command: [String: Any]) {
        guard let id = command["id"] as? String, let kind = command["kind"] as? String,
              ["photo", "clip", "cancel"].contains(kind), !handledCommands.contains(id) else { return }
        handledCommands.append(id)
        if handledCommands.count > 64 { handledCommands.removeFirst() }
        if kind == "cancel" {
            let target = command["requestId"] as? String
            if target == nil || target == activeRequest || target == previewRequest {
                captureTask?.cancel(); captureTask = nil
                activeRequest = nil; capturing = false; preview = nil; previewRequest = nil; photoData = nil
                status = "Capture discarded. Ready for another quest."
            }
            return
        }
        // A discard and a new capture may both happen between polls, replacing
        // the cancel command. The server's newest capture supersedes any local
        // work; do not swallow the new id while the canceled task is finishing.
        captureTask?.cancel(); captureTask = nil
        activeRequest = id; previewRequest = id; capturing = true; preview = nil; photoData = nil
        let generation = self.generation
        captureTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.activeRequest == id {
                    self.activeRequest = nil; self.capturing = false; self.captureTask = nil
                }
            }
            do {
                var evidence = kind == "photo" ? try await self.capturePhoto() : try await self.captureClip()
                try Task.checkCancellation()
                guard generation == self.generation, self.activeRequest == id else { return }
                evidence["requestId"] = id
                evidence["status"] = "ready"
                self.status = "Sending capture to your game for review…"
                _ = try await self.api("/glasses/result", body: evidence)
                guard generation == self.generation, self.activeRequest == id, !Task.isCancelled else { return }
                self.status = "Capture ready. Review it and choose Submit in the game to check the quest."
            } catch {
                guard generation == self.generation, self.activeRequest == id, !Task.isCancelled else { return }
                self.preview = nil
                self.status = error.localizedDescription
                if case QuestHTTPError.rejected(401, _) = error {
                    self.disconnect("Your game session changed. Pair with a new camera code.")
                    return
                }
                // Never approve locally; errors leave the quest incomplete.
                _ = try? await self.api("/glasses/result", body: ["requestId": id, "status": "error", "error": String(error.localizedDescription.prefix(200))])
            }
        }
    }

    private func requireFreshCamera() throws -> PhoneCameraFrame {
        guard foreground, cameraRunning, let frame = latestFrame,
              ProcessInfo.processInfo.systemUptime - frame.receivedAt <= 0.6 else {
            throw BridgeError.message("No fresh glasses camera image. Keep Kith Camera open, start the camera, and retry.")
        }
        return frame
    }

    private func capturePhoto() async throws -> [String: Any] {
        _ = try requireFreshCamera()
        let cameraGeneration = self.cameraGeneration
        guard outstandingPhotoRequest == nil else { throw BridgeError.message("The previous glasses photo did not finish. Stop and restart the camera, then retry.") }
        guard let activeRequest else { throw CancellationError() }
        status = "Taking a photo with the glasses camera…"
        outstandingPhotoRequest = activeRequest
        guard requestPhoto() else {
            outstandingPhotoRequest = nil
            throw BridgeError.message("The glasses could not take a photo. Check the live camera and retry.")
        }
        let deadline = ProcessInfo.processInfo.systemUptime + 10
        while photoData == nil {
            try Task.checkCancellation()
            // Still capture may temporarily delay video frames. The DAT photo
            // callback itself proves a new capture, so freshness is checked at
            // request time; a stopped/restarted stream always invalidates it.
            guard foreground, cameraRunning, cameraGeneration == self.cameraGeneration else {
                throw BridgeError.message("The glasses camera was interrupted during the photo. Restart it and retry.")
            }
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw BridgeError.message("The glasses photo timed out. Stop and restart the camera, then retry.")
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard let data = photoData, let image = UIImage(data: data) else { throw BridgeError.message("The glasses returned an unreadable photo.") }
        photoData = nil
        let encoded = try Self.jpeg(image)
        preview = UIImage(data: encoded)
        return ["photoDataUrl": "data:image/jpeg;base64," + encoded.base64EncodedString()]
    }

    private func captureClip() async throws -> [String: Any] {
        _ = try requireFreshCamera()
        let cameraGeneration = self.cameraGeneration
        let start = ProcessInfo.processInfo.systemUptime
        var lastSample = start
        var sampleTimes: [Double] = []
        var frames: [String] = []
        while frames.count < 12 {
            try Task.checkCancellation()
            guard cameraGeneration == self.cameraGeneration else { throw BridgeError.message("The glasses camera was interrupted during the clip. Please retry.") }
            let frame = try requireFreshCamera()
            let now = ProcessInfo.processInfo.systemUptime
            guard now - start < 9 else { throw BridgeError.message("The glasses clip was interrupted. Keep the camera live and retry.") }
            if frame.receivedAt > lastSample, frames.isEmpty || frame.receivedAt - lastSample >= 0.48 {
                let image = UIImage(cgImage: frame.image)
                let data = try Self.jpeg(image)
                frames.append("data:image/jpeg;base64," + data.base64EncodedString())
                sampleTimes.append(frame.receivedAt)
                lastSample = frame.receivedAt
                preview = UIImage(data: data)
                status = "Recording glasses clip · \(frames.count)/12 frames · no audio"
            }
            if frames.count < 12 { try await Task.sleep(for: .milliseconds(50)) }
        }
        let duration = (sampleTimes.last ?? start) - (sampleTimes.first ?? start)
        guard duration >= 1, duration <= 10 else { throw BridgeError.message("The glasses clip timing was interrupted. Please retry.") }
        return ["frames": frames, "durationSeconds": duration]
    }

    private static func jpeg(_ image: UIImage) throws -> Data {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { throw BridgeError.message("The camera image was empty.") }
        let scale = min(1, 640 / longest)
        let size = CGSize(width: max(1, (image.size.width * scale).rounded()), height: max(1, (image.size.height * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: 0.68), data.count < 300_000 else {
            throw BridgeError.message("That camera image is too large. Please retry.")
        }
        return data
    }

    static func serverOrigin(_ value: String) throws -> URL {
        guard var url = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "wss"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            throw BridgeError.message("Enter the HTTPS game server address shown in Kith camera setup.")
        }
        url.scheme = "https"; url.path = ""
        guard let result = url.url else { throw BridgeError.message("The game server address is invalid.") }
        return result
    }

    private func api(_ path: String, body: [String: Any]? = nil, authenticated: Bool = true) async throws -> [String: Any] {
        guard let endpoint, let url = URL(string: path, relativeTo: endpoint)?.absoluteURL else { throw BridgeError.message("Pair the camera with your game first.") }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if authenticated {
            guard let cameraToken else { throw BridgeError.message("Pair the camera with your game first.") }
            request.setValue("Bearer " + cameraToken, forHTTPHeaderField: "Authorization")
        }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BridgeError.message("The game server could not be reached.") }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            throw QuestHTTPError.rejected(http.statusCode, String((object["error"] as? String ?? "The game server returned HTTP \(http.statusCode).").prefix(240)))
        }
        return object
    }
}

private enum QuestHTTPError: LocalizedError {
    case rejected(Int, String)
    var errorDescription: String? { if case .rejected(_, let message) = self { return message }; return nil }
}

private final class QuestNoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

struct QuestCapturePanel: View {
    @ObservedObject var quests: QuestCaptureBridge
    var body: some View {
        Section("Glasses game quests") {
            Toggle("Allow quest capture from my game", isOn: $quests.enabled)
                .onChange(of: quests.enabled) { _, enabled in if !enabled { quests.disconnect("Quest camera controls are off.") } }
            if quests.enabled {
                TextField("HTTPS game server", text: $quests.serverURL)
                    .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(quests.paired || quests.connecting)
                TextField("Eight-character pairing code", text: $quests.pairingCode)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled().disabled(quests.paired || quests.connecting)
                if quests.paired { Button("Unpair quest camera", role: .destructive) { quests.disconnect() } }
                else { Button(quests.connecting ? "Pairing…" : "Pair with glasses game") { quests.pair() }.disabled(quests.connecting) }
                Text(quests.status).font(.callout).accessibilityIdentifier("quest-camera-status")
                if let image = quests.preview { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 200).accessibilityLabel("Latest quest capture from the glasses camera") }
                Text("Start the camera below and keep this app open. In the glasses game, choose a quest and capture a photo or a six-second clip. Captures contain no audio and wait for Submit in the game before grading.").font(.footnote)
                Text("Camera and glasses Web App running together still require a test on your glasses firmware.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
