import SwiftUI
import CoreMedia
import MWDATCore
import MWDATCamera

@MainActor
final class CameraBridge: ObservableObject {
    @Published var pairingLink = ""
    @Published var status = "Register with Meta AI, then start the glasses camera."
    @Published var handStatus = "Source: glasses camera only"
    @Published var running = false
    @Published var rotation = 0
    @Published var phoneFrame: PhoneCameraFrame?
    @Published var sendToWeb = false
    @Published var allowWebPreview = false
    @Published var webStatus = "Web sharing is off. The camera preview works locally."
    private var webConnected = false
    private let wearables = Wearables.shared
    private let relay = LandmarkRelay()
    private var session: DeviceSession?
    private var camera: MWDATCamera.Camera?
    private let sessionTokens = ListenerTokenBag()
    private let streamTokens = ListenerTokenBag()
    private var processor: HandFrameProcessor?
    private var generation = 0
    private var startTask: Task<Void, Never>?
    private var webTask: Task<Void, Never>?
    private var lastReadout = 0.0
    private var hasStreamed = false

    init() {
        relay.onDisconnect = { [weak self] message in
            guard let self else { return }
            self.webConnected = false
            self.relay.stop()
            self.webStatus = message + " Phone preview continues."
        }
        relay.onPreviewDemand = { [weak self] enabled in
            guard let self else { return }
            self.processor?.setPreviewEnabled(enabled && self.allowWebPreview)
        }
    }
    func register() {
        Task {
            do { try await wearables.startRegistration(); status = "Registration requested. Complete it in Meta AI." }
            catch { status = error.localizedDescription }
        }
    }
    func open(_ url: URL) {
        if url.host == "bridge" { pairingLink = url.absoluteString; status = "Pairing link loaded. Register, then Start."; return }
        Task {
            do { _ = try await wearables.handleUrl(url); status = "Meta AI callback received. You can start the camera." }
            catch { status = error.localizedDescription }
        }
    }
    func start() {
        guard !running else { return }
        running = true
        generation += 1
        let generation = self.generation
        startTask = Task {
            do {
                guard wearables.registrationState == .registered else { throw BridgeError.message("Register this app with Meta AI first.") }
                guard !wearables.devices.isEmpty else { throw BridgeError.message("No glasses connected. Check Meta AI and put them on.") }
                status = "Requesting glasses-camera permission…"
                var permission = try await wearables.checkPermissionStatus(.camera)
                if permission != .granted { permission = try await wearables.requestPermission(.camera) }
                guard permission == .granted else { throw BridgeError.message("Glasses-camera permission was denied.") }
                guard generation == self.generation, !Task.isCancelled else { return }
                processor = HandFrameProcessor(rotation: rotation, onFrame: { [weak self] frame in
                    Task { @MainActor in
                        guard let self, generation == self.generation, self.running else { return }
                        if self.webConnected { self.relay.send(frame) }
                        let now = ProcessInfo.processInfo.systemUptime
                        if now - self.lastReadout > 0.3 {
                            self.lastReadout = now
                            self.handStatus = "Glasses camera · \(frame.hands.count) hand(s) · frame \(frame.seq)"
                        }
                    }
                }, onPhoneFrame: { [weak self] frame in
                    Task { @MainActor in
                        guard let self, generation == self.generation, self.running else { return }
                        self.phoneFrame = frame
                    }
                }, onError: { [weak self] message in
                    Task { @MainActor in if generation == self?.generation { self?.status = message } }
                })
                let created = try wearables.createSession(deviceSelector: AutoDeviceSelector(wearables: wearables))
                session = created
                created.statePublisher.listen { [weak self] state in
                    Task { @MainActor in
                        guard let self, generation == self.generation else { return }
                        if state == .started { self.attachCamera(created, generation: generation) }
                        if state == .stopped { self.stop("Glasses session stopped. Start again to reconnect.") }
                    }
                }.store(in: sessionTokens)
                created.errorPublisher.listen { [weak self] error in
                    Task { @MainActor in if generation == self?.generation { self?.stop(error.localizedDescription) } }
                }.store(in: sessionTokens)
                status = "Connecting to the glasses camera…"
                try created.start()
                // Optional networking cannot prevent or interrupt the local camera preview.
                if sendToWeb { connectWeb(generation: generation) }
                else { webStatus = "Web sharing is off. The camera preview works locally." }
            } catch {
                if generation == self.generation { stop(error.localizedDescription) }
            }
        }
    }
    private func connectWeb(generation: Int) {
        webStatus = "Connecting hand points to the web app…"
        webTask = Task {
            do {
                let pairing = try Pairing(pairingLink)
                try await relay.connect(pairing)
                guard generation == self.generation, !Task.isCancelled else { return }
                webConnected = true
                processor?.setPreviewEnabled(allowWebPreview && relay.previewRequested)
                webStatus = "Web connected · " + (allowWebPreview ? "Desktop preview allowed when requested" : "Hand points only")
            } catch {
                guard generation == self.generation else { return }
                relay.stop(); webConnected = false
                webStatus = "Web unavailable: \(error.localizedDescription) Phone preview continues."
            }
        }
    }
    private func attachCamera(_ session: DeviceSession, generation: Int) {
        guard camera == nil, let processor else { return }
        do {
            let configuration = StreamConfiguration(videoCodec: .raw, resolution: .low, frameRate: 15)
            guard let attached = try session.addCamera(config: configuration) else { throw BridgeError.message("Could not attach glasses camera.") }
            camera = attached
            // Camera capability only: the separate Bondimals web app owns the glasses display.
            attached.stream.videoFramePublisher.listen { frame in
                guard let buffer = CMSampleBufferGetImageBuffer(frame.sampleBuffer) else { return }
                processor.process(buffer)
            }.store(in: streamTokens)
            attached.stream.statePublisher.listen { [weak self] state in
                Task { @MainActor in
                    guard let self, generation == self.generation else { return }
                    if state == .streaming { self.hasStreamed = true; self.status = "Glasses camera live. Move your hand into view to see the tracking overlay." }
                    else if state == .paused { self.phoneFrame = nil; self.status = "Glasses camera paused. Waiting for fresh frames." }
                    else if state == .stopped && self.hasStreamed { self.stop("Glasses camera stopped. Start again to reconnect.") }
                }
            }.store(in: streamTokens)
            attached.stream.errorPublisher.listen { [weak self] error in
                Task { @MainActor in if generation == self?.generation { self?.stop(error.localizedDescription) } }
            }.store(in: streamTokens)
            attached.stream.start()
        } catch { stop(error.localizedDescription) }
    }
    func stopIfStreamingInBackground() {
        if camera != nil { stop("Camera paused while the phone app is in the background. Reopen and Start.") }
    }
    func stop(_ message: String = "Stopped. Camera and relay released.") {
        generation += 1
        startTask?.cancel(); startTask = nil
        webTask?.cancel(); webTask = nil
        streamTokens.clear(); sessionTokens.clear()
        camera?.stop(); camera = nil
        session?.stop(); session = nil
        processor = nil
        phoneFrame = nil
        webConnected = false
        hasStreamed = false
        relay.stop()
        running = false
        handStatus = "Source: glasses camera only"
        status = message
        webStatus = "Web sharing is stopped."
    }
}
