import UIKit
import WebKit
import CoreLocation
import AVFoundation
import AVKit
import UniformTypeIdentifiers

final class PhoneViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, CLLocationManagerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var webView: WKWebView!
    private let loadingLabel = UILabel()
    private let locationManager = CLLocationManager()
    private var locationPurposes = Set<String>()
    private var isTracking = false
    private var cameraBusy = false
    private var lastHeadingTime = Date.distantPast
    private var lastFix: CLLocation?
    private var latestClip: URL? {
        let folder = clipsDirectory
        return (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey]))?
            .filter { $0.pathExtension.lowercased() == "mov" || $0.pathExtension.lowercased() == "mp4" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }.first
    }
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
        let data = try! JSONSerialization.data(withJSONObject: ["version": 1, "serverURL": server])
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
        loadingLabel.text = "Waking up Bondimals…"
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
            authorizeLocation()
        case "stopLocation":
            if let purpose = body["purpose"] as? String { locationPurposes.remove(purpose) }
            if locationPurposes.isEmpty { stopSensors() }
        case "recordClip": recordClip()
        case "reviewClip": reviewClip()
        case "deleteClip": deleteClip()
        case "loadError":
            loadingLabel.text = "The meadow could not start. Close and reopen Bondimals."
            print("Bondimals web error: \(body["message"] ?? "Unknown error")")
        case "ready":
            print(body["sceneReady"] as? Bool == true ? "Bondimals ready: bundled pet scene loaded." : "Bondimals UI loaded; pet scene unavailable.")
            loadingLabel.isHidden = true
            emit(["type": "recording", "message": latestClip == nil ? "Record a short quest clip. AI verification comes later." : "A quest clip is saved on this iPhone. Tap Review clip."])
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
            if let fix = lastFix, abs(fix.timestamp.timeIntervalSinceNow) < 15 { publish(fix) }
            if locationManager.accuracyAuthorization == .reducedAccuracy {
                emit(["type": "status", "message": "Enable Precise Location in iPhone Settings for nearby pets and walking."])
            } else { emit(["type": "status", "message": "Finding your location…"]) }
        case .denied, .restricted:
            locationPurposes.removeAll(); stopSensors()
            emit(["type": "unavailable", "message": "Location is off. Open iPhone Settings → Bondimals → Location and allow While Using the App with Precise Location."])
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
        let useTrue = heading.trueHeading >= 0
        emit(["type": "heading", "degrees": useTrue ? heading.trueHeading : heading.magneticHeading,
              "accuracy": heading.headingAccuracy, "reference": useTrue ? "true" : "magnetic"])
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied { authorizeLocation() }
        else { emit(["type": "status", "message": "Waiting for a usable GPS signal. Keep the app open."]) }
    }
    private func stopSensors() {
        isTracking = false; lastFix = nil
        locationManager.stopUpdatingLocation(); locationManager.stopUpdatingHeading()
    }
    @objc private func becameActive() { authorizeLocation() }
    @objc private func backgrounded() {
        locationPurposes.removeAll(); stopSensors()
        emit(["type": "paused", "message": "Location and walking paused while the app was away."])
    }
    private func recordClip() {
        guard !cameraBusy, presentedViewController == nil else { return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            emit(["type": "recording", "message": "Camera recording needs a physical iPhone."]); return
        }
        cameraBusy = true
        Task { @MainActor in
            let camera = await AVCaptureDevice.requestAccess(for: .video)
            let microphone = camera ? await AVCaptureDevice.requestAccess(for: .audio) : false
            guard camera && microphone else {
                cameraBusy = false
                emit(["type": "recording", "message": "Allow Camera and Microphone in iPhone Settings → Bondimals to record a clip."]); return
            }
            guard UIApplication.shared.applicationState == .active, presentedViewController == nil else { cameraBusy = false; return }
            // Pausing is explicit in the UI; dismissal does not silently resume discovery.
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
        picker.dismiss(animated: true); cameraBusy = false
        emit(["type": "recording", "message": "Recording canceled. Nothing was saved."])
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        defer { picker.dismiss(animated: true); cameraBusy = false }
        guard let source = info[.mediaURL] as? URL else { return }
        do {
            try FileManager.default.createDirectory(at: clipsDirectory, withIntermediateDirectories: true)
            let destination = clipsDirectory.appendingPathComponent("\(Int(Date().timeIntervalSince1970))_\(UUID().uuidString).\(source.pathExtension)")
            try FileManager.default.copyItem(at: source, to: destination)
            // Keep one clip, with explicit review/delete. No recording is uploaded automatically.
            for old in try FileManager.default.contentsOfDirectory(at: clipsDirectory, includingPropertiesForKeys: nil) where old != destination {
                try? FileManager.default.removeItem(at: old)
            }
            emit(["type": "recording", "message": "Clip saved on this iPhone. Review it below. It has not been AI verified."])
        } catch { emit(["type": "recording", "message": "The clip could not be saved. Please try again."]) }
    }
    private func reviewClip() {
        guard presentedViewController == nil else { return }
        guard let clip = latestClip else { emit(["type": "recording", "message": "No saved clip yet. Tap Record quest clip."]); return }
        let controller = AVPlayerViewController()
        controller.player = AVPlayer(url: clip)
        present(controller, animated: true) { controller.player?.play() }
    }
    private func deleteClip() {
        guard !cameraBusy else { return }
        do {
            if let clip = latestClip { try FileManager.default.removeItem(at: clip) }
            emit(["type": "recording", "message": "Saved clip deleted from this iPhone."])
        } catch { emit(["type": "recording", "message": "Could not delete the clip. Please try again."]) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "bondimals" && url?.host == "app" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadingLabel.text = "The meadow could not open. Close and reopen Bondimals."
        print("Bondimals navigation error: \(error.localizedDescription)")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { backgrounded(); webView.reload() }
}
