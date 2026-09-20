import SwiftUI
import MWDATCore

@main
struct BondimalsCameraApp: App {
    @StateObject private var bridge: CameraBridge
    @Environment(\.scenePhase) private var phase
    init() {
        do { try Wearables.configure() }
        catch { NSLog("Kith DAT configuration failed: %@", error.localizedDescription) }
        _bridge = StateObject(wrappedValue: CameraBridge())
    }
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Section {
                        Text("Camera \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")")
                            .font(.caption.bold()).accessibilityIdentifier("camera-build-version")
                        Text(bridge.status).accessibilityIdentifier("bridge-status")
                        QuestSetupSummary(quests: bridge.quests)
                    }
                    Section("Live glasses view") {
                        PhoneCameraPreview(frame: bridge.phoneFrame, running: bridge.running)
                        Text("Quest photos and clips open the glasses camera briefly, then close it. The glasses may switch away from Kith while recording; reopen Kith afterward to review and submit the result.")
                        Text(bridge.handStatus).font(.caption.monospaced())
                        Text(bridge.sessionStatus).font(.caption.monospaced())
                    }
                    Section("Camera setup") {
                        Text(bridge.deviceStatus).font(.caption)
                        Button("Refresh glasses connection") { bridge.refreshDevices() }
                        Picker("Camera image rotation", selection: $bridge.rotation) {
                            ForEach([0, 90, 180, 270], id: \.self) { Text("\($0)°").tag($0) }
                        }.disabled(bridge.running)
                        Button("Register with Meta AI") { bridge.register() }.disabled(bridge.running)
                        Button("Update Meta glasses app") { bridge.updateGlassesApp() }.disabled(bridge.running)
                    }
                    Section {
                        DisclosureGroup("Optional web connection") {
                            Toggle("Send hand points to Nova", isOn: $bridge.sendToWeb).disabled(bridge.running)
                            if bridge.sendToWeb {
                                TextField("Paste phoneLink from pairing.json", text: $bridge.pairingLink, axis: .vertical)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled().disabled(bridge.running)
                                Toggle("Allow desktop camera preview", isOn: $bridge.allowWebPreview).disabled(bridge.running)
                                Text("Hand points need a reachable relay to make Nova react in the web app. Leave the camera-preview switch off to keep images on this phone.").font(.footnote)
                            }
                            Text(bridge.webStatus).font(.caption)
                        }
                    }
                    QuestCapturePanel(quests: bridge.quests)
                    ManualCameraControls(bridge: bridge, quests: bridge.quests)
                    Section("While previewing") {
                        Text("Keep this app open. The feed comes from the glasses camera; the phone camera is never used.")
                        if bridge.sendToWeb {
                            Text("Open the paired Kith link on the glasses, place Nova, then choose Hands to align your fingertip. Camera and web display running together still need a hardware test.").font(.footnote)
                        }
                    }
                }.navigationTitle("Kith Camera")
            }.onOpenURL { bridge.open($0) }
             .onChange(of: phase) { _, phase in
                 // Do not interrupt registration permission prompts while no camera is running.
                 if phase == .background { bridge.stopIfStreamingInBackground() }
                 else if phase == .active { bridge.resumeForeground() }
             }
             .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                 bridge.resumeForeground()
             }
        }
    }
}

private struct QuestSetupSummary: View {
    @ObservedObject var quests: QuestCaptureBridge
    var body: some View {
        if quests.enabled || quests.connecting || quests.paired {
            VStack(alignment: .leading, spacing: 4) {
                Text(quests.cameraReady && quests.paired ? "Glasses camera live" : quests.paired ? "Game linked · camera \(quests.cameraState.rawValue)" : quests.connecting ? "Connecting game camera…" : "Game camera setup")
                    .font(.caption.bold())
                Text(quests.status).font(.callout)
                if quests.paired { Text(quests.cameraMessage).font(.callout) }
                if quests.lastCaptureStage != "none" {
                    Text("Last capture: \(quests.lastCaptureStage)").font(.caption.bold())
                    Text(quests.lastCaptureOutcome).font(.caption)
                }
                if let image = quests.preview, !quests.capturing {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 160)
                        .accessibilityLabel("Latest frame of your glasses quest capture")
                    Text("Capture thumbnail. Reopen Kith on your glasses to review the photo or full clip and choose Submit to Muse.")
                        .font(.caption)
                }
            }.accessibilityIdentifier("quest-setup-summary")
        }
    }
}

private struct ManualCameraControls: View {
    @ObservedObject var bridge: CameraBridge
    @ObservedObject var quests: QuestCaptureBridge
    var body: some View {
        Section("Optional continuous preview") {
            Text("Manual preview keeps camera mode open and may hide Kith on the glasses. Quest capture closes the camera afterward, including an existing manual preview.").font(.footnote)
            Button("Start manual camera preview") { bridge.start() }.disabled(bridge.running || quests.capturing)
            Button("Stop camera", role: .destructive) { bridge.stop() }.disabled(!bridge.running)
        }
    }
}
