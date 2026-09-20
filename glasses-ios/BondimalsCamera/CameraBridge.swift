import SwiftUI
import CoreMedia
import Combine
import MWDATCore
import MWDATCamera

@MainActor
final class CameraBridge: ObservableObject {
    let quests = QuestCaptureBridge()
    @Published var pairingLink = ""
    @Published var status = "Connect your game. Quest captures open and close the glasses camera automatically."
    @Published var handStatus = "Source: glasses camera only"
    @Published var running = false
    @Published var rotation = 0
    @Published var phoneFrame: PhoneCameraFrame?
    @Published var sendToWeb = false
    @Published var allowWebPreview = false
    @Published var webStatus = "Web sharing is off. The camera preview works locally."
    @Published var deviceStatus = "Checking glasses connection…"
    @Published var sessionStatus = "Session: idle · Camera: off"
    @Published private(set) var setupEvent = "app-opened"
    private var diagnosticObservers = Set<AnyCancellable>()
    private var lastCameraFrameAt: Date?
    private var webConnected = false
    private let wearables = Wearables.shared
    private let deviceSelector: AutoDeviceSelector
    private var deviceMonitor: Task<Void, Never>?
    private var registrationMonitor: Task<Void, Never>?
    private var setupRegistrationTask: Task<Void, Never>?
    private var questCameraStartRequested = false
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
    private var questCameraRequestID: String?
    private var pendingSessionRelease: Task<Bool, Never>?
    private var releasingSession: DeviceSession?

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
        registrationMonitor = Task { [weak self] in
            for await state in Wearables.shared.registrationStateStream() {
                guard !Task.isCancelled else { return }
                if state == .registered { self?.continueQuestCameraSetup() }
            }
        }
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
        quests.requestPhoto = { [weak self] in
            guard let self, self.running, let camera = self.camera, camera.stream.state == .streaming else { return false }
            return camera.stream.capturePhoto(format: .jpeg)
        }
        quests.prepareCamera = { [weak self] requestID in
            guard let self else { throw BridgeError.message("The camera app is unavailable.") }
            try await self.prepareQuestCamera(requestID)
        }
        quests.finishCamera = { [weak self] requestID, preservePreview in
            guard let self else { return false }
            return await self.finishQuestCamera(requestID, preservePreview: preservePreview)
        }
        quests.onUnpaired = { [weak self] in self?.questCameraStartRequested = false }
        quests.onPaired = { [weak self] in
            guard let self else { return }
            self.setupEvent = "camera-claim-succeeded"
            self.questCameraStartRequested = true
            self.continueQuestCameraSetup()
        }
        // Coalesce lifecycle/setup changes; frame receipt is sampled at most
        // once every ten seconds, without retaining or serializing its image.
        Publishers.MergeMany([
            $status.map { _ in () }.eraseToAnyPublisher(),
            $running.map { _ in () }.eraseToAnyPublisher(),
            $setupEvent.map { _ in () }.eraseToAnyPublisher(),
            $sessionStatus.map { _ in () }.eraseToAnyPublisher(),
            quests.$status.map { _ in () }.eraseToAnyPublisher(),
            quests.$paired.map { _ in () }.eraseToAnyPublisher(),
            quests.$serverURL.map { _ in () }.eraseToAnyPublisher(),
            quests.$cameraReady.map { _ in () }.eraseToAnyPublisher(),
            quests.$cameraState.map { _ in () }.eraseToAnyPublisher(),
            quests.$cameraMessage.map { _ in () }.eraseToAnyPublisher(),
        ]).debounce(for: .milliseconds(100), scheduler: RunLoop.main)
            .sink { [weak self] in self?.writeDiagnostics() }.store(in: &diagnosticObservers)
        $phoneFrame.map { $0 != nil }.filter { $0 }
            .throttle(for: .seconds(10), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] _ in self?.writeDiagnostics() }.store(in: &diagnosticObservers)
        writeDiagnostics()
    }
    deinit { deviceMonitor?.cancel(); registrationMonitor?.cancel(); setupRegistrationTask?.cancel() }

    func refreshDevices() {
        let devices = wearables.devices.compactMap { wearables.deviceForIdentifier($0) }
        let details = devices.map {
            "\($0.nameOrId()): \($0.linkState), \($0.compatibility().displayString)"
        }
        deviceStatus = details.isEmpty ? "No glasses discovered by Meta." : details.joined(separator: "\n")
        deviceStatus += deviceSelector.activeDevice == nil ? "\nCamera device not ready." : "\nCamera device ready."
    }

    private func waitForCameraDevice() async throws {
        updateCameraStatus(.starting, "Waiting for glasses to become ready. Wear them and keep them connected in Meta AI.")
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
        if url.host?.lowercased() == "quest-camera" {
            setupEvent = "setup-link-received"
            do {
                status = "Connecting your glasses game to its camera…"
                try quests.openSetupLink(url)
            } catch { setupEvent = "setup-link-rejected"; status = error.localizedDescription }
            return
        }
        if url.host == "bridge" { pairingLink = url.absoluteString; status = "Pairing link loaded. Register, then Start."; return }
        Task {
            do {
                _ = try await wearables.handleUrl(url)
                if questCameraStartRequested { continueQuestCameraSetup() }
                else if !running { status = "Meta AI callback received. You can start the camera." }
            }
            catch { status = error.localizedDescription }
        }
    }
    func resumeForeground() {
        // Setup and permission handoffs can take longer than auto-lock. The
        // visible camera app stays awake; backgrounding restores normal sleep.
        UIApplication.shared.isIdleTimerDisabled = true
        quests.setForeground(true)
        quests.restoreConnection()
        if quests.paired, !running, quests.cameraState == .paused,
           releasingSession == nil || releasingSession?.state == .stopped {
            updateCameraStatus(.idle, "Game connected. The camera opens only when you request a photo or clip.")
        }
        continueQuestCameraSetup()
        writeDiagnostics()
    }
    private func continueQuestCameraSetup() {
        guard questCameraStartRequested, quests.paired else { return }
        guard UIApplication.shared.applicationState == .active else {
            setupEvent = "waiting-for-foreground"
            updateCameraStatus(.paused, "Keep Kith Camera open on the phone to start the glasses camera.")
            return
        }
        if running { questCameraStartRequested = false; status = quests.cameraMessage; return }
        if wearables.registrationState == .registered {
            setupEvent = "quest-camera-armed"
            questCameraStartRequested = false
            updateCameraStatus(.idle, "Game connected. The camera opens only when you request a photo or clip.")
            return
        }
        updateCameraStatus(.permission, "Complete camera registration in Meta AI. Then request a photo or clip from Kith on your glasses.")
        setupEvent = "meta-registration-required"
        guard setupRegistrationTask == nil, wearables.registrationState != .registering else { return }
        setupRegistrationTask = Task { [weak self] in
            guard let self else { return }
            defer { self.setupRegistrationTask = nil }
            do { try await self.wearables.startRegistration() }
            catch {
                self.questCameraStartRequested = false
                self.updateCameraStatus(.error, error.localizedDescription)
            }
        }
    }
    private func prepareQuestCamera(_ requestID: String) async throws {
        if let previous = questCameraRequestID, previous != requestID {
            _ = await finishQuestCamera(previous, preservePreview: false)
        }
        if let release = pendingSessionRelease {
            _ = await release.value
            if let releasingSession, releasingSession.state != .stopped {
                throw BridgeError.message("Meta has not confirmed the previous camera session closed. Stop the camera in Meta AI and reopen Kith Camera.")
            }
        }
        try Task.checkCancellation()
        guard UIApplication.shared.applicationState == .active else {
            throw BridgeError.message("Keep Kith Camera open on the phone while capturing a quest.")
        }
        guard wearables.registrationState == .registered else {
            throw BridgeError.message("Complete registration in Meta AI on the phone, then request the capture again.")
        }
        questCameraRequestID = requestID
        setupEvent = "quest-camera-start-requested"
        start()
        let deadline = ProcessInfo.processInfo.systemUptime + 20
        while !quests.cameraReady {
            try Task.checkCancellation()
            guard questCameraRequestID == requestID else { throw CancellationError() }
            guard running else { throw BridgeError.message(status) }
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw BridgeError.message("The glasses camera did not become ready in time. Check the phone's Meta permission prompt and retry.")
            }
            try await Task.sleep(for: .milliseconds(100))
        }
    }
    private func finishQuestCamera(_ requestID: String, preservePreview: Bool) async -> Bool {
        guard questCameraRequestID == requestID else { return await pendingSessionRelease?.value ?? true }
        questCameraRequestID = nil
        setupEvent = "quest-camera-releasing"
        stop("Quest camera closed. Reopen Kith on your glasses to review the capture.", preserveQuestCapture: preservePreview)
        return await pendingSessionRelease?.value ?? true
    }
    func start() {
        guard !running else { return }
        guard !quests.capturing || questCameraRequestID != nil else { return }
        if let releasingSession, releasingSession.state != .stopped {
            updateCameraStatus(.error, "The previous camera session is still closing. Wait for the camera light to turn off, then retry.")
            return
        }
        guard UIApplication.shared.applicationState == .active else {
            updateCameraStatus(.paused, "Keep Kith Camera open on the phone to start the glasses camera.")
            return
        }
        running = true
        updateCameraStatus(.starting, "Starting the glasses camera…")
        lastCameraFrameAt = nil
        generation += 1
        let generation = self.generation
        startTask = Task {
            do {
                guard wearables.registrationState == .registered else { throw BridgeError.message("Register this app with Meta AI first.") }
                try await waitForCameraDevice()
                updateCameraStatus(.permission, "Allow glasses-camera access in Meta AI, then return to Kith Camera.")
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
                        self.lastCameraFrameAt = Date()
                        self.phoneFrame = frame
                        self.quests.receive(frame)
                        if self.firstFrameTask != nil {
                            self.firstFrameTask?.cancel(); self.firstFrameTask = nil
                            self.status = "Glasses camera live. Move your hand into view to see the tracking overlay."
                            self.setupEvent = "camera-frame-received"
                            print("Kith: first glasses-camera image received")
                        }
                    }
                }, onError: { [weak self] message in
                    Task { @MainActor in if generation == self?.generation { self?.status = message } }
                })
                let created = try wearables.createSession(deviceSelector: deviceSelector)
                session = created
                lastSessionError = nil
                observeSession(created, generation: generation)
                updateCameraStatus(.starting, "Connecting to the glasses camera…")
                try created.start()
                try await waitUntilStarted(created, generation: generation)
                try Task.checkCancellation()
                guard generation == self.generation else { return }
                try attachCamera(created, generation: generation)
                // Quest captures do not silently start the optional hand relay.
                if sendToWeb, questCameraRequestID == nil { connectWeb(generation: generation) }
                else { webStatus = "Web sharing is off. The camera preview works locally." }
            } catch {
                if generation == self.generation {
                    refreshDevices()
                    stop(error.localizedDescription, cameraState: .error)
                }
            }
        }
    }
    private func updateCameraStatus(_ state: QuestCameraState, _ message: String) {
        status = message
        quests.setCameraState(state, message: CameraDiagnostics.redact(message, secrets: wearables.devices))
    }
    private func writeDiagnostics() {
        let secrets = wearables.devices + [quests.pairingCode]
        let formatter = ISO8601DateFormatter()
        CameraDiagnostics(
            buildVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            serverOrigin: CameraDiagnostics.origin(quests.serverURL),
            setupEvent: setupEvent,
            setupStatus: CameraDiagnostics.redact(quests.status, secrets: secrets),
            cameraStatus: CameraDiagnostics.redact(status, secrets: secrets),
            paired: quests.paired, running: running,
            cameraReady: quests.cameraReady, cameraState: quests.cameraState.rawValue,
            cameraMessage: CameraDiagnostics.redact(quests.cameraMessage, secrets: secrets),
            lastFrameReceived: lastCameraFrameAt != nil,
            lastFrameReceivedAt: lastCameraFrameAt.map { formatter.string(from: $0) },
            registrationState: wearables.registrationState.description,
            updatedAt: formatter.string(from: Date())
        ).write()
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
                self.updateCameraStatus(.error, error.localizedDescription)
                print("Kith: session error: \(error.localizedDescription)")
            }
        }
        sessionStateTask = Task { [weak self] in
            for await state in states {
                guard let self, generation == self.generation, !Task.isCancelled else { return }
                self.sessionStatus = "Session: \(state.description) · Camera: \(self.camera.map { String(describing: $0.stream.state) } ?? "off")"
                print("Kith: \(self.sessionStatus)")
                if state == .paused {
                    self.phoneFrame = nil
                    self.quests.setCameraRunning(false)
                    self.updateCameraStatus(.paused, "Glasses session paused. Wear the glasses and resume on the glasses.")
                }
                if state == .stopped, self.camera != nil {
                    // DAT closes errorStream at the terminal state. Drain it so
                    // a generic stopped message cannot erase the actual reason.
                    await self.sessionErrorTask?.value
                    guard generation == self.generation, !Task.isCancelled else { return }
                    self.stop(self.lastSessionError?.localizedDescription ?? "Glasses session stopped. Start again to reconnect.", cameraState: self.lastSessionError == nil ? .paused : .error)
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
                throw BridgeError.message("Meta ended the glasses session before the camera could start. Check Kith Camera's Bluetooth and Local Network access in device Settings.")
            }
            if let error = lastSessionError { throw error }
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw BridgeError.message("Glasses session timed out (\(target.state.description)). Stop any other glasses camera app, then retry. If it persists, use Update Meta glasses app below.")
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        print("Kith: session confirmed started; attaching camera")
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
                    self.updateCameraStatus(.error, "Camera frames arrived, but Meta did not provide a decoded image.")
                }
                return
            }
            processor.process(buffer)
        })
        streamTokens.append(attached.stream.photoDataPublisher.listen { [weak self] photo in
            Task { @MainActor in
                guard let self, generation == self.generation, self.running else { return }
                self.quests.receivePhoto(photo.data)
            }
        })
        streamTokens.append(attached.stream.statePublisher.listen { [weak self] state in
            Task { @MainActor in
                guard let self, generation == self.generation else { return }
                self.sessionStatus = "Session: \(session.state.description) · Camera: \(state)"
                print("Kith: \(self.sessionStatus)")
                if state == .streaming { self.hasStreamed = true; UIApplication.shared.isIdleTimerDisabled = true; self.quests.setCameraRunning(true); self.status = "Camera streaming. Waiting for the first image…" }
                else if state == .paused { self.phoneFrame = nil; self.quests.setCameraRunning(false); self.updateCameraStatus(.paused, "Glasses camera paused. Waiting for fresh frames.") }
                else if state == .stopped && self.hasStreamed { self.stop("Glasses camera stopped. Start again to reconnect.", cameraState: .paused) }
                else if state == .starting {
                    self.quests.cameraStopped("Glasses connected. Starting video stream…", state: .starting)
                    self.updateCameraStatus(.starting, "Glasses connected. Starting video stream…")
                }
                else if state == .waitingForDevice {
                    self.quests.cameraStopped("Camera waiting for glasses. Keep them on and connected.", state: .starting)
                    self.updateCameraStatus(.starting, "Camera waiting for glasses. Keep them on and connected.")
                }
            }
        })
        streamTokens.append(attached.stream.errorPublisher.listen { [weak self] error in
            Task { @MainActor in if generation == self?.generation { self?.stop(error.localizedDescription, cameraState: .error) } }
        })
        updateCameraStatus(.starting, "Glasses connected. Starting video stream…")
        attached.stream.start()
        firstFrameTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            guard let self, generation == self.generation, self.phoneFrame == nil else { return }
            self.stop("No camera image arrived after 20 seconds (camera: \(attached.stream.state)). Check Bluetooth and Local Network access for Kith Camera in device Settings, and stop any other glasses-camera session before retrying.", cameraState: .error)
        }
    }
    func stopIfStreamingInBackground() {
        UIApplication.shared.isIdleTimerDisabled = false
        quests.setForeground(false)
        if camera != nil { stop("Camera paused while the phone app is in the background. Reopen and Start.", cameraState: .paused) }
    }
    func stop(_ message: String = "Stopped. Camera and relay released.", cameraState: QuestCameraState = .idle, preserveQuestCapture: Bool = false) {
        questCameraStartRequested = false
        setupRegistrationTask?.cancel(); setupRegistrationTask = nil
        UIApplication.shared.isIdleTimerDisabled = UIApplication.shared.applicationState == .active
        generation += 1
        let stopGeneration = generation
        startTask?.cancel(); startTask = nil
        webTask?.cancel(); webTask = nil
        firstFrameTask?.cancel(); firstFrameTask = nil
        sessionStateTask?.cancel(); sessionStateTask = nil
        sessionErrorTask?.cancel(); sessionErrorTask = nil
        let oldTokens = streamTokens; streamTokens.removeAll()
        Task { for token in oldTokens { await token.cancel() } }
        camera?.stop(); camera = nil
        let closingSession = session ?? (releasingSession?.state == .stopped ? nil : releasingSession)
        releasingSession = closingSession
        closingSession?.stop(); session = nil
        processor = nil
        phoneFrame = nil
        quests.cameraSessionReleased(state: closingSession == nil ? cameraState : .starting,
            message: closingSession == nil ? CameraDiagnostics.redact(message, secrets: wearables.devices) : "Closing the glasses camera session…",
            preservePreview: preserveQuestCapture)
        webConnected = false
        hasStreamed = false
        relay.stop()
        running = false
        handStatus = "Source: glasses camera only"
        status = message
        webStatus = "Web sharing is stopped."
        if let closingSession {
            // DAT stop is asynchronous. Keep the session alive until its
            // terminal state, even when the capture task was canceled.
            pendingSessionRelease = Task { [weak self] in
                let released = await CameraSessionRelease.waitUntilStopped { closingSession.state == .stopped }
                if let self, self.generation == stopGeneration {
                    self.sessionStatus = "Session: \(closingSession.state.description) · Camera: off"
                    self.setupEvent = released ? "quest-camera-released" : "camera-release-unconfirmed"
                    let finalState: QuestCameraState = cameraState == .paused && UIApplication.shared.applicationState == .active && self.quests.paired ? .idle : cameraState
                    self.updateCameraStatus(released ? finalState : .error, released ? message : "Meta has not confirmed the camera stopped. Close the camera in Meta AI, then reopen Kith on your glasses.")
                }
                return released
            }
        }
        print("Kith: stopped: \(message)")
    }
}
