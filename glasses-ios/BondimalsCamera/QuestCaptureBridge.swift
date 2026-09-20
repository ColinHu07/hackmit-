import Foundation
import SwiftUI
import UIKit

enum QuestCameraState: String { case ready, starting, permission, paused, error, idle }

/// Pairs a camera to one active game player without taking over their play socket.
/// Frames stay in memory and only leave the phone after a capture command from
/// that player. Grading starts only after the player's explicit game action.
@MainActor
final class QuestCaptureBridge: ObservableObject {
    @Published var enabled = false
    @Published var serverURL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "KithGameServerURL") as? String ?? ""
        return value.hasPrefix("$(") ? "" : value
    }() {
        didSet {
            guard (try? Self.serverOrigin(oldValue)) != (try? Self.serverOrigin(serverURL)) else { return }
            if paired || connecting { disconnect("Game server changed. Pair with the code from this game.") }
            else { QuestCameraCredentials.clear() }
        }
    }
    @Published var pairingCode = ""
    @Published private(set) var paired = false
    @Published private(set) var connecting = false
    @Published private(set) var status = "Pair with the eight-character camera code in Kith on your glasses."
    @Published private(set) var capturing = false
    @Published private(set) var preview: UIImage?
    @Published private(set) var cameraReady = false
    @Published private(set) var cameraState: QuestCameraState = .idle
    @Published private(set) var cameraMessage = "The camera opens only for a requested quest photo or clip."

    var requestPhoto: () -> Bool = { false }
    var prepareCamera: (String) async throws -> Void = { _ in }
    var finishCamera: (String, Bool) async -> Bool = { _, _ in true }
    var onPaired: () -> Void = {}
    var onUnpaired: () -> Void = {}
    private var endpoint: URL?
    private var cameraToken: String?
    private var setupLinkKey: String?
    private var pollTask: Task<Void, Never>?
    private var captureTask: Task<Void, Never>?
    private var connectionTask: Task<Void, Never>?
    private var progressTask: Task<Void, Never>?
    private var progressUploadID: UUID?
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
    private var restoring = false
    private let noRedirects = QuestNoRedirects()
    private lazy var network: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 12
        return URLSession(configuration: configuration, delegate: noRedirects, delegateQueue: nil)
    }()

    func openSetupLink(_ url: URL) throws {
        let setup = try QuestCameraSetupLink(url, trustedServer: Self.serverOrigin(serverURL))
        let key = setup.server.absoluteString + "|" + setup.code
        if setupLinkKey == key {
            if paired { onPaired(); return }
            if connecting { return }
        }
        disconnect("Connecting your glasses camera…")
        enabled = true
        serverURL = setup.server.absoluteString
        pairingCode = setup.code
        setupLinkKey = key
        pair()
    }

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
                    guard let token = response["cameraToken"] as? String,
                          token.range(of: "^[a-f0-9]{48}$", options: .regularExpression) != nil else {
                        throw BridgeError.message("Camera pairing returned no session. Make a new code in the game.")
                    }
                    self.cameraToken = token
                    if let endpoint = self.endpoint { QuestCameraCredentials.save(origin: endpoint, token: token) }
                    self.paired = true
                    self.pairingCode = ""
                    self.status = "Game connected. Request a photo or clip on your glasses when ready."
                    self.startPolling()
                    self.onPaired()
                } catch {
                    guard generation == self.generation, !Task.isCancelled else { return }
                    self.setupLinkKey = nil
                    self.status = error.localizedDescription
                }
            }
        } catch { status = error.localizedDescription }
    }

    func restoreConnection() {
        guard foreground, UIApplication.shared.applicationState == .active, !paired, !connecting,
              let origin = try? Self.serverOrigin(serverURL),
              let token = QuestCameraCredentials.load(origin: origin) else { return }
        endpoint = origin; cameraToken = token
        enabled = true; paired = true; restoring = true
        status = "Checking your saved game camera connection…"
        generation += 1
        startPolling()
    }

    func disconnect(_ message: String = "Camera unpaired. Make a new code in the game to reconnect.") {
        onUnpaired()
        if let request = activeRequest { Task { _ = await finishCamera(request, false) } }
        QuestCameraCredentials.clear()
        generation += 1
        connectionTask?.cancel(); connectionTask = nil
        pollTask?.cancel(); pollTask = nil
        captureTask?.cancel(); captureTask = nil
        stopProgress()
        paired = false; connecting = false; capturing = false; restoring = false
        cameraToken = nil; endpoint = nil; activeRequest = nil; setupLinkKey = nil
        handledCommands.removeAll(); preview = nil; previewRequest = nil; photoData = nil
        status = message
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active { refreshReadiness(); startPolling() }
        else {
            pollTask?.cancel(); pollTask = nil
            cameraStopped("Keep Kith Camera open on the phone to use the glasses camera.", state: .paused)
        }
    }

    func setCameraRunning(_ running: Bool) {
        if running {
            cameraRunning = true
            setCameraState(.starting, message: "Glasses stream started. Waiting for a fresh image…")
            refreshReadiness()
        }
        else { cameraStopped("Glasses camera paused. Start it again before capturing a quest.") }
    }

    func setCameraState(_ state: QuestCameraState, message: String) {
        cameraState = state
        cameraMessage = String(message.prefix(200))
        if state != .ready { cameraReady = false }
    }

    func receive(_ frame: PhoneCameraFrame) { latestFrame = frame; refreshReadiness() }

    private func refreshReadiness() {
        let age = latestFrame.map { ProcessInfo.processInfo.systemUptime - $0.receivedAt } ?? .infinity
        let active = foreground && UIApplication.shared.applicationState == .active
        let ready = active && cameraRunning && age >= 0 && age < 2
        if cameraReady != ready { cameraReady = ready }
        if ready {
            if cameraState != .ready { cameraState = .ready; cameraMessage = "Glasses camera live. Ready to take a photo or record a clip." }
        } else if !active {
            if cameraState != .paused { cameraState = .paused; cameraMessage = "Keep Kith Camera open on the phone to use the glasses camera." }
        } else if cameraState == .ready {
            cameraState = .starting; cameraMessage = "No recent glasses camera image. Keep the glasses connected and Kith Camera open."
        }
    }

    private func heartbeat() -> [String: Any] {
        refreshReadiness()
        return ["cameraReady": cameraReady, "cameraState": cameraState.rawValue, "message": cameraMessage, "onDemandCapture": true]
    }

    func receivePhoto(_ data: Data) {
        guard let request = outstandingPhotoRequest else { return }
        // DAT photos have no request identifier. A canceled/timed-out request
        // remains outstanding until its callback or a full camera restart, so
        // a delayed photo can never be reused for a later quest.
        outstandingPhotoRequest = nil
        if activeRequest == request, foreground, cameraRunning { photoData = data }
    }

    func cameraStopped(_ message: String, state: QuestCameraState = .paused, preservePreview: Bool = false) {
        cameraGeneration += 1
        cameraRunning = false; latestFrame = nil
        if !preservePreview { preview = nil }
        stopProgress()
        setCameraState(state, message: message)
        if capturing, !preservePreview { status = message }
        // The capture loop observes this and reports an error to the game.
    }

    func cameraSessionReleased(state: QuestCameraState = .idle, message: String = "The camera is closed until the next requested photo or clip.", preservePreview: Bool = false) {
        cameraStopped(message, state: state, preservePreview: preservePreview)
        outstandingPhotoRequest = nil; photoData = nil
    }

    private func startPolling() {
        guard foreground, UIApplication.shared.applicationState == .active, paired, pollTask == nil else { return }
        let generation = self.generation
        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, generation == self.generation {
                let loopStarted = ProcessInfo.processInfo.systemUptime
                do {
                    // A connected phone is not sufficient: capture is enabled
                    // only while its actual DAT stream has fresh frames.
                    _ = try await self.api("/glasses/heartbeat", body: self.heartbeat(), timeout: 4)
                    guard generation == self.generation, !Task.isCancelled else { return }
                    let response = try await self.api("/glasses/command")
                    guard generation == self.generation, !Task.isCancelled else { return }
                    if self.restoring {
                        self.restoring = false
                        self.status = "Game connection restored. Camera stays closed until your next capture."
                        self.onPaired()
                    }
                    if self.pollFailures > 0, !self.capturing { self.status = "Game camera connection restored." }
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
                let delay = max(0.1, 1 - (ProcessInfo.processInfo.systemUptime - loopStarted))
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
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
                if let request = activeRequest { Task { _ = await finishCamera(request, false) } }
                captureTask?.cancel(); captureTask = nil
                stopProgress()
                activeRequest = nil; capturing = false; preview = nil; previewRequest = nil; photoData = nil
                status = "Capture discarded. Ready for another quest."
            }
            return
        }
        // A discard and a new capture may both happen between polls, replacing
        // the cancel command. The server's newest capture supersedes any local
        // work; do not swallow the new id while the canceled task is finishing.
        captureTask?.cancel(); captureTask = nil
        if let previous = activeRequest { Task { _ = await finishCamera(previous, false) } }
        stopProgress()
        activeRequest = id; previewRequest = id; capturing = true; preview = nil; photoData = nil
        let generation = self.generation
        captureTask = Task { [weak self] in
            guard let self else { return }
            defer {
                Task { _ = await self.finishCamera(id, false) }
                if self.activeRequest == id {
                    self.stopProgress()
                    self.activeRequest = nil; self.capturing = false; self.captureTask = nil
                }
            }
            do {
                self.status = "Opening the glasses camera for your quest…"
                try await self.prepareCamera(id)
                try Task.checkCancellation()
                guard generation == self.generation, self.activeRequest == id else { return }
                var evidence = kind == "photo" ? try await self.capturePhoto() : try await self.captureClip()
                try Task.checkCancellation()
                guard generation == self.generation, self.activeRequest == id else { return }
                guard self.foreground, UIApplication.shared.applicationState == .active, self.cameraRunning else {
                    throw BridgeError.message("The camera was interrupted. Keep Kith Camera open and retry.")
                }
                self.stopProgress()
                // Close DAT before upload so the glasses can leave camera mode.
                // The encoded evidence and phone review thumbnail stay in memory.
                let released = await self.finishCamera(id, true)
                try Task.checkCancellation()
                guard generation == self.generation, self.activeRequest == id else { return }
                evidence["requestId"] = id
                evidence["status"] = "ready"
                self.status = "Captured. Sending the result while the glasses camera closes…"
                _ = try await self.api("/glasses/result", body: evidence)
                guard generation == self.generation, self.activeRequest == id, !Task.isCancelled else { return }
                self.status = released ? "Capture sent. Reopen Kith on your glasses to review it, then choose Submit to Muse." : "Capture sent. Close camera mode in Meta AI, then reopen Kith on your glasses to review and Submit to Muse."
            } catch {
                _ = await self.finishCamera(id, false)
                guard generation == self.generation, self.activeRequest == id, !Task.isCancelled else { return }
                self.stopProgress()
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
        guard foreground, UIApplication.shared.applicationState == .active, cameraRunning, let frame = latestFrame,
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
            guard foreground, UIApplication.shared.applicationState == .active, cameraRunning, cameraGeneration == self.cameraGeneration else {
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
        guard let requestID = activeRequest else { throw CancellationError() }
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
            if frame.receivedAt > lastSample, frames.isEmpty || frame.receivedAt - lastSample >= 0.5 {
                let image = UIImage(cgImage: frame.image)
                let data = try Self.jpeg(image)
                frames.append("data:image/jpeg;base64," + data.base64EncodedString())
                sampleTimes.append(frame.receivedAt)
                lastSample = frame.receivedAt
                preview = UIImage(data: data)
                status = "Recording glasses clip · \(frames.count)/12 frames · no audio"
                offerProgress(image, requestID: requestID, sequence: frames.count, elapsedSeconds: max(0, frame.receivedAt - start))
            }
            if frames.count < 12 { try await Task.sleep(for: .milliseconds(50)) }
        }
        let duration = (sampleTimes.last ?? start) - (sampleTimes.first ?? start)
        guard duration >= 1, duration <= 10 else { throw BridgeError.message("The glasses clip timing was interrupted. Please retry.") }
        return ["frames": frames, "durationSeconds": duration]
    }

    private func stopProgress() {
        progressUploadID = nil
        progressTask?.cancel(); progressTask = nil
    }

    private func offerProgress(_ image: UIImage, requestID: String, sequence: Int, elapsedSeconds: Double) {
        // No preview is encoded or sent outside an explicit clip command. Slow
        // networking drops preview samples instead of delaying evidence capture.
        guard foreground, UIApplication.shared.applicationState == .active, cameraRunning, cameraReady, activeRequest == requestID, progressTask == nil,
              let jpeg = try? Self.jpeg(image, dimension: 320, quality: 0.5, byteLimit: 100 * 1024) else { return }
        let uploadID = UUID(), generation = self.generation
        progressUploadID = uploadID
        progressTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.progressUploadID == uploadID { self.progressUploadID = nil; self.progressTask = nil } }
            guard self.foreground, UIApplication.shared.applicationState == .active, self.activeRequest == requestID, !Task.isCancelled else { return }
            do {
                _ = try await self.api("/glasses/progress", body: [
                    "requestId": requestID, "sequence": sequence, "elapsedSeconds": elapsedSeconds,
                    "previewDataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString(),
                ], timeout: 3)
            } catch {
                guard generation == self.generation, self.activeRequest == requestID, !Task.isCancelled else { return }
                if case QuestHTTPError.rejected(401, _) = error { self.disconnect("Your game session changed. Pair the camera again.") }
                // Dropped preview packets do not discard a valid local clip.
            }
        }
    }

    private static func jpeg(_ image: UIImage, dimension: CGFloat = 640, quality: CGFloat = 0.68, byteLimit: Int = 300_000) throws -> Data {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { throw BridgeError.message("The camera image was empty.") }
        let scale = min(1, dimension / longest)
        let size = CGSize(width: max(1, (image.size.width * scale).rounded()), height: max(1, (image.size.height * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: quality), data.count < byteLimit else {
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
        url.scheme = "https"; url.host = host.lowercased(); url.path = ""
        if url.port == 443 { url.port = nil }
        guard let result = url.url else { throw BridgeError.message("The game server address is invalid.") }
        return result
    }

    private func api(_ path: String, body: [String: Any]? = nil, authenticated: Bool = true, timeout: TimeInterval = 12) async throws -> [String: Any] {
        guard let endpoint, let url = URL(string: path, relativeTo: endpoint)?.absoluteURL else { throw BridgeError.message("Pair the camera with your game first.") }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = timeout
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
                Text("Pairing keeps the camera closed. Request a photo or clip from Kith on your glasses, and keep this phone app open for any Meta permission prompt. The camera closes after capture; reopen Kith to review and choose Submit to Muse. Clips contain no audio.").font(.footnote)
                Text("Your glasses may leave the game during camera capture. Returning to the game is manual; the app does not claim to resume the display automatically.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
