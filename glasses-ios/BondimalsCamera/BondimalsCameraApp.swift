import SwiftUI
import MWDATCore

@main
struct BondimalsCameraApp: App {
    @StateObject private var bridge: CameraBridge
    @Environment(\.scenePhase) private var phase
    init() {
        do { try Wearables.configure() }
        catch { NSLog("Bondimals DAT configuration failed: %@", error.localizedDescription) }
        _bridge = StateObject(wrappedValue: CameraBridge())
    }
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Section("Live glasses view") {
                        PhoneCameraPreview(frame: bridge.phoneFrame, running: bridge.running)
                        Text("See the glasses camera and tracked hands here. No relay or pairing link is needed for this preview. Nothing is recorded.")
                        Text(bridge.status).accessibilityIdentifier("bridge-status")
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
                    Section {
                        Button("Start glasses camera") { bridge.start() }.disabled(bridge.running)
                        Button("Stop", role: .destructive) { bridge.stop() }.disabled(!bridge.running)
                    }
                    Section("While previewing") {
                        Text("Keep this app open. The feed comes from the glasses camera; the phone camera is never used.")
                        if bridge.sendToWeb {
                            Text("Open the paired Bondimals link on the glasses, place Nova, then choose Hands to align your fingertip. Camera and web display running together still need a hardware test.").font(.footnote)
                        }
                    }
                }.navigationTitle("Bondimals Camera")
            }.onOpenURL { bridge.open($0) }
             .onChange(of: phase) { _, phase in
                 // Do not interrupt registration permission prompts while no camera is running.
                 if phase == .background { bridge.stopIfStreamingInBackground() }
             }
        }
    }
}
