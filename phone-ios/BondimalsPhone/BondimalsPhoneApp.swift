import SwiftUI

@main
struct BondimalsPhoneApp: App {
    var body: some Scene {
        WindowGroup {
            PhoneView().ignoresSafeArea(.container, edges: .bottom)
                .preferredColorScheme(.light)
        }
    }
}

struct PhoneView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> PhoneViewController { PhoneViewController() }
    func updateUIViewController(_ controller: PhoneViewController, context: Context) {}
}
