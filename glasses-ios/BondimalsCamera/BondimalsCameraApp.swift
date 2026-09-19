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
                    Section("Glasses camera → Bondimals") {
                        Text("Your iPhone connects the glasses camera to Bondimals. Hand points drive Nova; the desktop web app can also request a small live camera preview. Nothing is recorded.")
                        Text(bridge.status).accessibilityIdentifier("bridge-status")
                        Text(bridge.handStatus).font(.caption.monospaced())
                    }
                    Section("Pair your session") {
                        TextField("Paste phoneLink from pairing.json", text: $bridge.pairingLink, axis: .vertical)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().disabled(bridge.running)
                        Picker("Camera image rotation", selection: $bridge.rotation) {
                            ForEach([0, 90, 180, 270], id: \.self) { Text("\($0)°").tag($0) }
                        }.disabled(bridge.running)
                        Button("Register with Meta AI") { bridge.register() }.disabled(bridge.running)
                    }
                    Section {
                        Button("Start glasses camera") { bridge.start() }.disabled(bridge.running)
                        Button("Stop", role: .destructive) { bridge.stop() }.disabled(!bridge.running)
                    }
                    Section("On the glasses") {
                        Text("Open your paired Bondimals link, place Nova, then choose Hands. Align your index fingertip with the three + markers. Stroke gently across Nova’s head.")
                        Text("Keep this iPhone app open. If opening the web app stops the camera stream, your firmware may not allow both sessions together.").font(.footnote)
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
