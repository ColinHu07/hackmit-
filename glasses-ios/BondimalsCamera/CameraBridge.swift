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
    @Published var deviceStatus = "Checking glasses connection…"
    @Published var sessionStatus = "Session: idle · Camera: off"
    private var webConnected = false
    private let wearables = Wearables.shared
    private let deviceSelector: AutoDeviceSelector
    private var deviceMonitor: Task<Void, Never>?
    private let relay = LandmarkRelay()
    private var session: DeviceSession?
    private var camera: MWDATCamera.Camera?
    private var streamTokens: [any AnyListenerToken] = []
    private var sessionStateTask: Task<Void, Never>?
    private var sessionErrorTask: Task<Void, Never>?
    private var firstFrameTask: Task<Void, Never>?
    private var lastSessionError: DeviceSessionError?
    private var processor: HandFrameProcessor?
    private var generation = 0
    private var startTask: Task<Void, Never>?
    private var webTask: Task<Void, Never>?
    private var lastReadout = 0.0
    private var hasStreamed = false

    init() {
        let selector = AutoDeviceSelector(wearables: Wearables.shared)
        deviceSelector = selector
        // DAT resolves eligible devices asynchronously. Retain and monitor the
        // selector before Start, as in Meta's CameraAccess sample.
        deviceMonitor = Task { [weak self] in
            for await _ in selector.activeDeviceStream() {
                guard !Task.isCancelled else { return }
                self?.refreshDevices()
            }
        }
        refreshDevices()
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
    deinit { deviceMonitor?.cancel() }

    func refreshDevices() {
        let devices = wearables.devices.compactMap { wearables.deviceForIdentifier($0) }
        let details = devices.map {
            "\($0.nameOrId()): \($0.linkState), \($0.compatibility().displayString)"
        }
        deviceStatus = details.isEmpty ? "No glasses discovered by Meta." : details.joined(separator: "\n")
        deviceStatus += deviceSelector.activeDevice == nil ? "\nCamera device not ready." : "\nCamera device ready."
    }

    private func waitForCameraDevice() async throws {
        status = "Waiting for glasses to become ready. Wear them and keep them connected in Meta AI."
        for _ in 0..<25 {
            try Task.checkCancellation()
            refreshDevices()
            if deviceSelector.activeDevice != nil { return }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw BridgeError.message("Meta cannot find a ready glasses camera. Check the connection details below. Wear the glasses, check their connection and Developer Mode in Meta AI, then retry.")
    }
    func register() {
        Task {
            do { try await wearables.startRegistration(); status = "Registration requested. Complete it in Meta AI." }
            catch { status = error.localizedDescription }
        }
    }
    func updateGlassesApp() {
        Task {
            do { try await wearables.openDATGlassesAppUpdate() }
            catch { status = error.localizedDescription }
        }
    }
    func open(_ url: URL) {
        if url.host == "bridge" { pairingLink = url.absoluteString; status = "Pairing link loaded. Register, then Start."; return }
        Task {
            do {
                _ = try await wearables.handleUrl(url)
                if !running { status = "Meta AI callback received. You can start the camera." }
            }
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
                try await waitForCameraDevice()
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
                        if self.firstFrameTask != nil {
                            self.firstFrameTask?.cancel(); self.firstFrameTask = nil
                            self.status = "Glasses camera live. Move your hand into view to see the tracking overlay."
                            print("Bondimals: first glasses-camera image received")
                        }
                    }
                }, onError: { [weak self] message in
                    Task { @MainActor in if generation == self?.generation { self?.status = message } }
                })
                let created = try wearables.createSession(deviceSelector: deviceSelector)
                session = created
                lastSessionError = nil
                observeSession(created, generation: generation)
                status = "Connecting to the glasses camera…"
                try created.start()
                try await waitUntilStarted(created, generation: generation)
                try Task.checkCancellation()
                guard generation == self.generation else { return }
                try attachCamera(created, generation: generation)
                // Optional networking cannot prevent or interrupt the local camera preview.
                if sendToWeb { connectWeb(generation: generation) }
                else { webStatus = "Web sharing is off. The camera preview works locally." }
            } catch {
                if generation == self.generation {
                    refreshDevices()
                    stop(error.localizedDescription)
                }
            }
        }
    }
    private func observeSession(_ target: DeviceSession, generation: Int) {
        // Subscribe synchronously before start(): DAT's startup failures are
        // one-shot events. The sequences retain them until the tasks consume them.
        let states = target.stateStream()
        let errors = target.errorStream()
        sessionErrorTask = Task { [weak self] in
            for await error in errors {
                guard let self, generation == self.generation, !Task.isCancelled else { return }
                self.lastSessionError = error
                self.status = error.localizedDescription
                print("Bondimals: session error: \(error.localizedDescription)")
            }
        }
        sessionStateTask = Task { [weak self] in
            for await state in states {
                guard let self, generation == self.generation, !Task.isCancelled else { return }
                self.sessionStatus = "Session: \(state.description) · Camera: \(self.camera.map { String(describing: $0.stream.state) } ?? "off")"
                print("Bondimals: \(self.sessionStatus)")
                if state == .paused {
                    self.phoneFrame = nil
                    self.status = "Glasses session paused. Wear the glasses and resume on the glasses."
                }
                if state == .stopped, self.camera != nil {
                    // DAT closes errorStream at the terminal state. Drain it so
                    // a generic stopped message cannot erase the actual reason.
                    await self.sessionErrorTask?.value
                    guard generation == self.generation, !Task.isCancelled else { return }
                    self.stop(self.lastSessionError?.localizedDescription ?? "Glasses session stopped. Start again to reconnect.")
                }
            }
        }
    }
    private func waitUntilStarted(_ target: DeviceSession, generation: Int) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + 20
        while target.state != .started {
            try Task.checkCancellation()
            guard generation == self.generation, session === target else { throw CancellationError() }
            if target.state == .stopped {
                await sessionErrorTask?.value
                if let error = lastSessionError { throw error }
                throw BridgeError.message("Meta ended the glasses session before the camera could start. Check Bondimals Camera's Bluetooth and Local Network access in iPhone Settings.")
            }
            if let error = lastSessionError { throw error }
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw BridgeError.message("Glasses session timed out (\(target.state.description)). Stop any other glasses camera app, then retry. If it persists, use Update Meta glasses app below.")
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        print("Bondimals: session confirmed started; attaching camera")
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
    private func attachCamera(_ session: DeviceSession, generation: Int) throws {
        guard camera == nil, let processor else { return }
        let configuration = StreamConfiguration(videoCodec: .raw, resolution: .low, frameRate: 7)
        guard let attached = try session.addCamera(config: configuration) else { throw BridgeError.message("Could not attach glasses camera.") }
        camera = attached
        // Camera capability only: the separate Bondimals web app owns the glasses display.
        streamTokens.append(attached.stream.videoFramePublisher.listen { [weak self] frame in
            guard let buffer = CMSampleBufferGetImageBuffer(frame.sampleBuffer) else {
                Task { @MainActor in
                    guard let self, generation == self.generation else { return }
                    self.status = "Camera frames arrived, but Meta did not provide a decoded image."
                }
                return
            }
            processor.process(buffer)
        })
        streamTokens.append(attached.stream.statePublisher.listen { [weak self] state in
            Task { @MainActor in
                guard let self, generation == self.generation else { return }
                self.sessionStatus = "Session: \(session.state.description) · Camera: \(state)"
                print("Bondimals: \(self.sessionStatus)")
                if state == .streaming { self.hasStreamed = true; self.status = "Camera streaming. Waiting for the first image…" }
                else if state == .paused { self.phoneFrame = nil; self.status = "Glasses camera paused. Waiting for fresh frames." }
                else if state == .stopped && self.hasStreamed { self.stop("Glasses camera stopped. Start again to reconnect.") }
                else if state == .starting { self.status = "Glasses connected. Starting video stream…" }
                else if state == .waitingForDevice { self.status = "Camera waiting for glasses. Keep them on and connected." }
            }
        })
        streamTokens.append(attached.stream.errorPublisher.listen { [weak self] error in
            Task { @MainActor in if generation == self?.generation { self?.stop(error.localizedDescription) } }
        })
        status = "Glasses connected. Starting video stream…"
        attached.stream.start()
        firstFrameTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            guard let self, generation == self.generation, self.phoneFrame == nil else { return }
            self.stop("No camera image arrived after 20 seconds (camera: \(attached.stream.state)). Check Bluetooth and Local Network access for Bondimals Camera in iPhone Settings, and stop any other glasses-camera session before retrying.")
        }
    }
    func stopIfStreamingInBackground() {
        if camera != nil { stop("Camera paused while the phone app is in the background. Reopen and Start.") }
    }
    func stop(_ message: String = "Stopped. Camera and relay released.") {
        generation += 1
        startTask?.cancel(); startTask = nil
        webTask?.cancel(); webTask = nil
        firstFrameTask?.cancel(); firstFrameTask = nil
        sessionStateTask?.cancel(); sessionStateTask = nil
        sessionErrorTask?.cancel(); sessionErrorTask = nil
        let oldTokens = streamTokens; streamTokens.removeAll()
        Task { for token in oldTokens { await token.cancel() } }
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
        print("Bondimals: stopped: \(message)")
    }
}
