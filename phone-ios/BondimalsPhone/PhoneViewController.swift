import UIKit
import WebKit
import CoreLocation
import CoreMotion
import AVFoundation
import AVKit
import UniformTypeIdentifiers

final class PhoneViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, CLLocationManagerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var webView: WKWebView!
    private let loadingLabel = UILabel()
    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private var motionGeneration = 0
    private var receivedMotion = false
    private var lastAttitudeTime: TimeInterval = -Double.infinity
    private var locationPurposes = Set<String>()
    private var isTracking = false
    private var preparingEvidence = false
    private var cameraBusy = false
    private var lastHeadingTime = Date.distantPast
    private var lastFix: CLLocation?
    private var clipStore: QuestClipStore { QuestClipStore(directory: clipsDirectory) }
    private var latestClip: URL? { clipStore.latest }
    private var clipsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("QuestClips", isDirectory: true)
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.93, alpha: 1)
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .fitness
        locationManager.headingFilter = 3
        locationManager.headingOrientation = .portrait
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundledSite(), forURLScheme: "bondimals")
        configuration.userContentController.add(self, name: "bondimals")
        let server = (Bundle.main.object(forInfoDictionaryKey: "BondimalsServerURL") as? String) ?? ""
        let web = (Bundle.main.object(forInfoDictionaryKey: "BondimalsWebURL") as? String) ?? ""
        let data = try! JSONSerialization.data(withJSONObject: ["version": 1, "serverURL": server, "webURL": web])
        let json = String(data: data, encoding: .utf8)!
        configuration.userContentController.addUserScript(WKUserScript(source: "window.bondimalsNative = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.addUserScript(WKUserScript(source: """
            window.addEventListener('error', function(event) {
                window.webkit.messageHandlers.bondimals.postMessage({command:'loadError', message:event.message || 'A bundled resource did not load.'});
            }, true);
            window.addEventListener('unhandledrejection', function(event) {
                window.webkit.messageHandlers.bondimals.postMessage({command:'loadError', message:String(event.reason)});
            });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        loadingLabel.text = "Waking up Kith…"
        loadingLabel.textAlignment = .center
        loadingLabel.numberOfLines = 0
        loadingLabel.font = .systemFont(ofSize: 16, weight: .medium)
        loadingLabel.textColor = .darkGray
        loadingLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loadingLabel)
        NSLayoutConstraint.activate([
            loadingLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            loadingLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            loadingLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        webView.load(URLRequest(url: URL(string: "bondimals://app/index.html")!))
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: locationManager.headingOrientation = .landscapeRight
        case .landscapeRight: locationManager.headingOrientation = .landscapeLeft
        case .portraitUpsideDown: locationManager.headingOrientation = .portraitUpsideDown
        default: locationManager.headingOrientation = .portrait
        }
    }
    private var screenAngle: Double {
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: return 90
        case .landscapeRight: return -90
        case .portraitUpsideDown: return 180
        default: return 0
        }
    }
    private func emit(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('bondimals-native', {detail: \(json)}));", completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "bondimals",
              message.frameInfo.request.url?.host == "app", let body = message.body as? [String: Any], let command = body["command"] as? String else { return }
        switch command {
        case "startLocation":
            guard let purpose = body["purpose"] as? String, ["discovery", "walking"].contains(purpose) else { return }
            locationPurposes.insert(purpose)
            if purpose == "walking" { startWalkingMotion() }
            authorizeLocation()
        case "stopLocation":
            if let purpose = body["purpose"] as? String { locationPurposes.remove(purpose) }
            if !locationPurposes.contains("walking") { stopWalkingMotion() }
            if locationPurposes.isEmpty { stopSensors() }
        case "recordClip": recordClip()
        case "prepareQuestClip":
            guard let requestId = body["requestId"] as? String, requestId.count <= 100 else { return }
            prepareQuestClip(requestId: requestId)
        case "reviewClip": reviewClip()
        case "deleteClip": deleteClip()
        case "loadError":
            loadingLabel.text = "Your world could not start. Close and reopen Kith."
            print("Kith web error: \(body["message"] ?? "Unknown error")")
        case "ready":
            print(body["sceneReady"] as? Bool == true ? "Kith ready: bundled pet scene loaded." : "Kith UI loaded; pet scene unavailable.")
            loadingLabel.isHidden = true
            emit(["type": "recording", "message": latestClip == nil ? "Record a short quest clip, review it, then submit it for verification." : "A quest clip is saved on this device. Submit it for grading."])
        default: break
        }
    }
    private func authorizeLocation() {
        guard !locationPurposes.isEmpty else { return }
        switch locationManager.authorizationStatus {
        case .notDetermined: locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            guard UIApplication.shared.applicationState == .active else { return }
            if !isTracking {
                isTracking = true
                locationManager.startUpdatingLocation()
                if CLLocationManager.headingAvailable() { locationManager.startUpdatingHeading() }
            }
            if let heading = locationManager.heading { publishHeading(heading) }
            if locationPurposes.contains("walking") { startWalkingMotion() }
            if let fix = lastFix, abs(fix.timestamp.timeIntervalSinceNow) < 15 { publish(fix) }
            if locationManager.accuracyAuthorization == .reducedAccuracy {
                emit(["type": "status", "message": "Enable Precise Location in device Settings for nearby pets."])
            } else { emit(["type": "status", "message": "Finding your location…"]) }
        case .denied, .restricted:
            locationPurposes.remove("discovery")
            isTracking = false
            locationManager.stopUpdatingLocation(); locationManager.stopUpdatingHeading()
            // Walking and turning use Core Motion, independently of GPS access.
            if locationPurposes.contains("walking") { startWalkingMotion() }
            emit(["type": "unavailable", "message": "Location is off. Walking, turning, and touch controls still work. Enable Location in Settings → Kith for nearby discovery."])
        @unknown default: break
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { authorizeLocation() }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isTracking, let fix = locations.last, fix.horizontalAccuracy >= 0, abs(fix.timestamp.timeIntervalSinceNow) < 20 else { return }
        lastFix = fix
        publish(fix)
    }
    private func publish(_ fix: CLLocation) {
        emit(["type": "location", "latitude": fix.coordinate.latitude, "longitude": fix.coordinate.longitude,
              "accuracy": fix.horizontalAccuracy, "timestamp": fix.timestamp.timeIntervalSince1970 * 1000])
    }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading heading: CLHeading) {
        guard isTracking, Date().timeIntervalSince(lastHeadingTime) >= 0.2 else { return }
        lastHeadingTime = Date()
        publishHeading(heading)
    }
    private func publishHeading(_ heading: CLHeading) {
        guard isTracking, abs(heading.timestamp.timeIntervalSinceNow) < 10 else { return }
        let useTrue = heading.trueHeading >= 0
        emit(["type": "heading", "degrees": useTrue ? heading.trueHeading : heading.magneticHeading,
              "accuracy": heading.headingAccuracy, "reference": useTrue ? "true" : "magnetic"])
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied { authorizeLocation() }
        else { emit(["type": "status", "message": "Waiting for a usable GPS signal. Keep the app open."]) }
    }
    private func stopSensors() {
        isTracking = false; lastFix = nil; lastHeadingTime = .distantPast
        locationManager.stopUpdatingLocation(); locationManager.stopUpdatingHeading()
        stopWalkingMotion()
    }
    private func startWalkingMotion() {
        guard !motionManager.isDeviceMotionActive, UIApplication.shared.applicationState == .active else { return }
        guard motionManager.isDeviceMotionAvailable else {
            emit(["type": "motionStatus", "available": false, "message": "Motion unavailable. Tap the ground or arrows to move. Check Motion & Fitness access in Settings → Kith."])
            return
        }
        motionGeneration += 1
        let generation = motionGeneration
        receivedMotion = false
        lastAttitudeTime = -Double.infinity
        motionManager.deviceMotionUpdateInterval = 1.0 / 40.0
        motionManager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] motion, error in
            guard let self, self.motionGeneration == generation, self.locationPurposes.contains("walking"),
                  UIApplication.shared.applicationState == .active else { return }
            guard let motion, error == nil else {
                self.stopWalkingMotion()
                self.emit(["type": "motionStatus", "available": false, "message": "Motion unavailable. Tap the ground or arrows to move. Check Motion & Fitness access in Settings → Kith."])
                return
            }
            if !self.receivedMotion {
                self.receivedMotion = true
                self.emit(["type": "motionStatus", "available": true, "message": "Motion ready · walk with your device, turn to look around, or tap to move."])
                print("Kith motion ready")
            }
            let a = motion.userAcceleration
            let g = motion.gravity
            // Gravity is separated by Core Motion. Turning the phone alone
            // produces no vertical walking impulse. Samples stay on this device.
            let vertical = -(a.x * g.x + a.y * g.y + a.z * g.z)
            self.emit(["type": "motion", "verticalG": vertical, "timestamp": motion.timestamp * 1000])
            if motion.timestamp - self.lastAttitudeTime >= 0.05 {
                self.lastAttitudeTime = motion.timestamp
                self.emit(["type": "attitude", "yaw": motion.attitude.yaw,
                           "gravityX": g.x, "gravityY": g.y, "gravityZ": g.z,
                           "screenAngle": self.screenAngle, "timestamp": motion.timestamp * 1000])
            }
        }
    }
    private func stopWalkingMotion() {
        motionGeneration += 1
        receivedMotion = false
        motionManager.stopDeviceMotionUpdates()
    }
    @objc private func becameActive() {
        authorizeLocation()
        if presentedViewController == nil { emit(["type": "active"]) }
    }
    @objc private func backgrounded() {
        locationPurposes.removeAll(); stopSensors()
        emit(["type": "paused", "message": "Location and walking paused while the app was away."])
    }
    private func recordClip() {
        guard !cameraBusy, presentedViewController == nil else { return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            emit(["type": "recording", "message": "Camera recording needs a physical iPhone or iPad."]); return
        }
        cameraBusy = true
        Task { @MainActor in
            let camera = await AVCaptureDevice.requestAccess(for: .video)
            let microphone = camera ? await AVCaptureDevice.requestAccess(for: .audio) : false
            guard camera && microphone else {
                cameraBusy = false
                emit(["type": "recording", "message": "Allow Camera and Microphone in device Settings → Kith to record a clip."]); return
            }
            guard UIApplication.shared.applicationState == .active, presentedViewController == nil else { cameraBusy = false; return }
            // Pause sensors while recording; resume the automatic experience after dismissal.
            backgrounded()
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.mediaTypes = [UTType.movie.identifier]
            picker.cameraCaptureMode = .video
            picker.videoMaximumDuration = 10
            picker.videoQuality = .typeHigh
            picker.delegate = self
            picker.modalPresentationStyle = .fullScreen
            present(picker, animated: true)
        }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { self.emit(["type": "active"]) }; cameraBusy = false
        emit(["type": "recording", "message": "Recording canceled."])
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        defer { picker.dismiss(animated: true) { self.emit(["type": "active"]) }; cameraBusy = false }
        guard let source = info[.mediaURL] as? URL else { return }
        do {
            let saved = try clipStore.save(source)
            guard FileManager.default.isReadableFile(atPath: saved.path) else { throw CocoaError(.fileReadUnknown) }
            emit(["type": "recording", "message": "Clip ready. Submit clip for grading."])
        } catch { emit(["type": "recording", "message": "The clip could not be saved. Please try again."]) }
    }
    private func prepareQuestClip(requestId: String) {
        guard !preparingEvidence else {
            emit(["type": "evidence", "requestId": requestId, "message": "Your clip is already being prepared. Please wait."])
            return
        }
        guard !cameraBusy else {
            emit(["type": "evidence", "requestId": requestId, "message": "Finish saving or canceling the recording before submitting."])
            return
        }
        guard let clip = latestClip else {
            emit(["type": "evidence", "requestId": requestId, "message": "No saved clip was found on this device. Please record it again."])
            return
        }
        preparingEvidence = true
        Task { @MainActor in
            defer { preparingEvidence = false }
            do {
                let asset = AVURLAsset(url: clip)
                let duration = try await asset.load(.duration).seconds
                guard duration.isFinite, duration >= 1, duration <= 11 else {
                    emit(["type": "evidence", "requestId": requestId, "message": "Record a clip between 1 and 10 seconds."])
                    return
                }
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 720, height: 720)
                generator.requestedTimeToleranceBefore = .zero
                generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
                var frames = [String]()
                var byteCount = 0
                for index in 0..<12 {
                    let time = CMTime(seconds: duration * (Double(index) + 0.5) / 12, preferredTimescale: 600)
                    let result = try await generator.image(at: time)
                    guard let data = UIImage(cgImage: result.image).jpegData(compressionQuality: 0.65) else { throw CocoaError(.fileReadCorruptFile) }
                    byteCount += data.count
                    guard byteCount <= 4 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
                    frames.append("data:image/jpeg;base64," + data.base64EncodedString())
                }
                emit(["type": "evidence", "requestId": requestId, "frames": frames, "durationSeconds": duration])
            } catch {
                emit(["type": "evidence", "requestId": requestId, "message": "Could not prepare that clip. Try recording a shorter clip."])
            }
        }
    }
    private func reviewClip() {
        guard presentedViewController == nil else { return }
        guard let clip = latestClip else { emit(["type": "recording", "message": "No saved clip yet. Tap Record clip."]); return }
        let controller = AVPlayerViewController()
        controller.player = AVPlayer(url: clip)
        present(controller, animated: true) { controller.player?.play() }
    }
    private func deleteClip() {
        guard !cameraBusy else { return }
        do {
            if let clip = latestClip { try FileManager.default.removeItem(at: clip) }
            emit(["type": "recording", "message": "Saved clip deleted from this device."])
        } catch { emit(["type": "recording", "message": "Could not delete the clip. Please try again."]) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "bondimals" && url?.host == "app" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadingLabel.text = "The meadow could not open. Close and reopen Kith."
        print("Kith navigation error: \(error.localizedDescription)")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { backgrounded(); webView.reload() }
}
